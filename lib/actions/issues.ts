"use server";

// Settings → Report a problem (phase 2.2d). The last consumer of the 0157 data
// layer: issue_reports plus the private issue-report-images bucket.
//
// ==========================================================================
// EVERY EXPORT HERE IS AN ASYNC FUNCTION. THAT IS A HARD RULE.
// ==========================================================================
// A "use server" module turns each export into a callable server reference, so
// a plain const or object is not a legal export. Breaking it stuck the
// Notifications section on a permanent "Loading…" in 2.2b, and `next build` did
// not flag it. Vocabularies and validators live in lib/issues.ts.
//
// ==========================================================================
// THIS QUEUE IS SHARED ON PURPOSE — RLS SAYS SO AND SO DOES THE PRODUCT
// ==========================================================================
// 0157 grants insert-own, select-ALL and update-ALL. Two colleagues share one
// queue: either can triage, resolve or reopen the other's ticket, because a
// per-reporter restriction would mean a report can only be fixed by the person
// who cannot fix it. There is NO delete policy and none is wanted — a report is
// closed by status, never removed, or the same problem gets rediscovered from
// scratch in six months.
//
// The one pinned write is authorship: reporter_id is filled from auth.uid() and
// is never a parameter, so a ticket cannot be filed under someone else's name.
// The RLS WITH CHECK enforces the same thing a second time.
//
// ==========================================================================
// NO ERROR IS EVER RETURNED EMPTY, AND NOTHING THROWS PAST THE BOUNDARY
// ==========================================================================
// Every action wraps its body. A rejected promise from a server action leaves
// the caller's await in its error branch — or, with no catch, the UI on its
// loading state forever. An empty error string is the same hazard one level
// down, because `if (res.error)` is false for "". Both are closed here.

import { createClient } from "@/lib/supabase/server";
import { blankToNull } from "@/lib/utils";
import {
  isIssueStatus, validateIssueDraft, validateAttachmentFile, RESOLVED,
  type IssueRow,
} from "@/lib/issues";

const ATTACHMENT_BUCKET = "issue-report-images";

/** Signed-URL lifetime. 300s, matching every other private bucket read. */
const SIGNED_URL_TTL = 300;

const SELECT_COLS =
  "id, reporter_id, category, title, description, page_route, attachment_path, status, resolution_note, resolved_by, resolved_at, created_at, updated_at";

function msg(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}" && s !== "null") return s;
  } catch {
    /* fall through to the fallback */
  }
  return fallback;
}

export type IssueQueue = {
  rows: IssueRow[];
  /**
   * The caller's own id, so the UI can say "You" instead of a uuid.
   *
   * WHY THE QUEUE CANNOT NAME THE OTHER REPORTER. reporter_id points at
   * auth.users, which is not readable by a normal client, and user_profiles is
   * RLS'd to the owner's own row (0159) — so there is no path from someone
   * else's uuid to their name, by design. Showing "Someone else" is the honest
   * answer for a two-person team; a real name needs a deliberate policy change,
   * exactly the one 0159's header says must be separate and explicit. Inventing
   * a name from a uuid would be a guess presented as fact.
   */
  currentUserId: string | null;
};

/**
 * The whole queue, newest first, with the caller's identity for labelling.
 *
 * ORDERED IN SQL BY created_at ONLY. The resolved-sinks-to-the-bottom rule is
 * applied in the component through statusRank, because it is a presentation
 * choice — the same reasoning the notification panel uses for its ordering.
 * Sorting by `status` in SQL would order the four values alphabetically, which
 * is meaningless here and happens to look right only by coincidence.
 *
 * AN EMPTY QUEUE IS NOT AN ERROR. Zero tickets is the state this feature hopes
 * for; it returns [] with no error, and the component renders a real empty
 * state rather than a failure.
 */
export async function fetchIssues(): Promise<
  { data: IssueQueue; error: null } | { data: null; error: string }
> {
  try {
    const supabase = createClient();

    const { data: auth } = await supabase.auth.getUser();
    const currentUserId = auth?.user?.id ?? null;

    const { data, error } = await supabase
      .from("issue_reports")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[issues] queue read failed", error);
      return { data: null, error: msg(error, "Could not load the reports.") };
    }

    return { data: { rows: (data ?? []) as IssueRow[], currentUserId }, error: null };
  } catch (e) {
    console.error("[issues] fetchIssues threw", e);
    return { data: null, error: msg(e, "Could not load the reports.") };
  }
}

/**
 * File a new ticket.
 *
 * FormData because of the optional image — a File cannot cross a server-action
 * boundary in a plain object.
 *
 * BYTES FIRST, POINTER SECOND, and the object is removed if the row fails. Same
 * order as every other upload in this app: an orphaned file wastes storage,
 * while a row pointing at bytes that never landed renders as a broken image in
 * the queue forever.
 *
 * status is NOT a parameter. A new ticket is 'open' — letting the client choose
 * would allow filing something pre-resolved, which is not a state anyone needs.
 */
export async function createIssue(
  formData: FormData,
): Promise<{ id: string; error: null } | { id: null; error: string }> {
  try {
    const category = String(formData.get("category") ?? "").trim();
    const title = String(formData.get("title") ?? "");
    const description = String(formData.get("description") ?? "");
    const pageRoute = String(formData.get("pageRoute") ?? "");
    const file = formData.get("file");

    // The same validator the form runs, so nothing can pass the UI and then
    // fail 0157's CHECK constraints with a 23514 the user cannot act on.
    const problem = validateIssueDraft({ category, title });
    if (problem) return { id: null, error: problem };

    const supabase = createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { id: null, error: msg(authErr, "Could not read the session.") };
    const userId = auth?.user?.id;
    if (!userId) return { id: null, error: "Not signed in." };

    let attachmentPath: string | null = null;
    if (file instanceof File && file.size > 0) {
      // THE REAL GATE. The form checks the same thing for instant feedback, but
      // a client-side check is an affordance, not a control.
      const bad = validateAttachmentFile(file);
      if (bad) return { id: null, error: bad };

      // App-generated key, never the user's filename — it can collide, can
      // carry path separators, and leaks whatever they called the file.
      const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
      const ext = extMatch ? extMatch[1].toLowerCase() : "png";
      attachmentPath = `${userId}/issue-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(attachmentPath, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (upErr) {
        console.error("[issues] attachment upload failed", upErr);
        return { id: null, error: `Upload failed: ${msg(upErr, "storage rejected the file")}` };
      }
    }

    const { data: row, error } = await supabase
      .from("issue_reports")
      .insert({
        reporter_id: userId,
        category,
        title: title.trim(),
        // '' -> NULL on every optional field. '' is falsy but not nullish, and
        // 0157's attachment_path CHECK rejects a blank outright.
        description: blankToNull(description),
        page_route: blankToNull(pageRoute),
        attachment_path: attachmentPath,
        // status omitted: the column defaults to 'open'.
      })
      .select("id")
      .single();

    if (error) {
      // Do not leave bytes behind for a pointer that never landed.
      if (attachmentPath) {
        await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachmentPath]);
      }
      console.error("[issues] insert failed", error);
      return { id: null, error: msg(error, "Could not file the report.") };
    }

    return { id: row.id as string, error: null };
  } catch (e) {
    console.error("[issues] createIssue threw", e);
    return { id: null, error: msg(e, "Could not file the report.") };
  }
}

/**
 * Change a ticket's status and/or its note.
 *
 * ==========================================================================
 * THE RESOLVED STAMP IS DERIVED HERE, NOT SENT BY THE CLIENT
 * ==========================================================================
 * Three cases, and all three are handled explicitly because the middle one is
 * the easy thing to get wrong:
 *
 *   1. Moving INTO resolved       -> stamp resolved_by = auth.uid(), resolved_at = now()
 *   2. Already resolved, staying  -> leave BOTH alone
 *   3. Moving OFF resolved        -> clear BOTH to null
 *
 * Case 3 is the one the brief calls out: without it a reopened ticket still
 * carries a resolver and a resolution time, so the row claims to be open and
 * resolved at once, and any future "who closed this" report is wrong.
 *
 * Case 2 matters almost as much and is quieter. Re-stamping on every save would
 * move the resolution time each time somebody edited the note of an
 * already-resolved ticket — so "resolved at" would silently become "last
 * touched at". That is why the CURRENT status is read first: the transition,
 * not the target, decides the stamp.
 *
 * updated_at is NOT written. 0157 attaches the shared set_updated_at() trigger,
 * which fires only when the row actually changed. Setting it from here would
 * both duplicate the trigger and defeat its WHEN clause.
 */
export async function updateIssue(input: {
  id: string;
  status: string;
  resolutionNote: string;
}): Promise<{ error: string | null }> {
  try {
    const id = input.id?.trim();
    if (!id) return { error: "Missing report id." };
    if (!isIssueStatus(input.status)) return { error: "That is not a valid status." };

    const supabase = createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { error: msg(authErr, "Could not read the session.") };
    const userId = auth?.user?.id;
    if (!userId) return { error: "Not signed in." };

    // Read the CURRENT status: the stamp depends on the transition, not the
    // target. maybeSingle so a deleted/missing row is a clean message rather
    // than a throw.
    const { data: current, error: readErr } = await supabase
      .from("issue_reports")
      .select("status, resolved_by, resolved_at")
      .eq("id", id)
      .maybeSingle();

    if (readErr) {
      console.error("[issues] pre-update read failed", readErr);
      return { error: msg(readErr, "Could not read the report.") };
    }
    if (!current) return { error: "That report no longer exists." };

    const wasResolved = current.status === RESOLVED;
    const willBeResolved = input.status === RESOLVED;

    const patch: Record<string, unknown> = {
      status: input.status,
      resolution_note: blankToNull(input.resolutionNote),
    };

    if (willBeResolved && !wasResolved) {
      patch.resolved_by = userId;
      patch.resolved_at = new Date().toISOString();
    } else if (!willBeResolved) {
      // REOPENED. Both cleared together — one without the other leaves a row
      // that is half-resolved, which is worse than either state alone.
      patch.resolved_by = null;
      patch.resolved_at = null;
    }
    // else: still resolved. Neither field is in the patch, so the original
    // resolver and time survive an edit to the note.

    const { error } = await supabase.from("issue_reports").update(patch).eq("id", id);
    if (error) {
      console.error("[issues] update failed", error);
      return { error: msg(error, "Could not update the report.") };
    }

    return { error: null };
  } catch (e) {
    console.error("[issues] updateIssue threw", e);
    return { error: msg(e, "Could not update the report.") };
  }
}

/**
 * A signed URL for one attachment.
 *
 * FETCHED PER TICKET, ON EXPAND — not for the whole queue at load. A list of
 * twenty tickets would otherwise mean twenty storage round trips to render
 * thumbnails nobody has asked to see, and the URLs would start expiring while
 * the list sat open.
 *
 * Returns null rather than an error: a missing image must not turn a readable
 * ticket into an error state. The component shows the ticket and says the image
 * could not be loaded.
 */
export async function fetchAttachmentUrl(path: string): Promise<string | null> {
  try {
    const p = path?.trim();
    if (!p) return null;
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(p, SIGNED_URL_TTL);
    if (error) console.error("[issues] attachment signed URL failed", error);
    return data?.signedUrl ?? null;
  } catch (e) {
    console.error("[issues] fetchAttachmentUrl threw", e);
    return null;
  }
}
