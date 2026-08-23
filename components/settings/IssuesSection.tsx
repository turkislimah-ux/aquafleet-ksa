"use client";

// Settings → Report a problem (phase 2.2d). The last section of Feature 2, and
// the only consumer of the 0157 data layer.
//
// ==========================================================================
// TWO VIEWS BEHIND A TOGGLE, NOT ONE LONG PAGE
// ==========================================================================
// This section does two unrelated jobs: filing a ticket and working the queue.
// Stacked in one scroll they fight — the form is what you came for, and the
// queue grows without bound underneath it, so over time the thing you opened
// this for sits above an ever-longer list you have to scroll past.
//
// The toggle keeps each job whole and lets the queue carry a count, which is
// the one piece of information worth showing before you click: whether anything
// is waiting. It opens on the FORM, because the rail item says "Report a
// problem" — that is the stated intent of the click.
//
// ==========================================================================
// WHY THE QUEUE SAYS "Someone else" INSTEAD OF A NAME
// ==========================================================================
// reporter_id points at auth.users, which a normal client cannot read, and
// user_profiles is RLS'd to the owner's own row (0159). There is therefore NO
// path from another person's uuid to their name — by design, not by oversight.
// With two people sharing the queue, "You" versus "Someone else" is complete
// information. Inventing a name would be a guess presented as fact; a real one
// needs the deliberate, explicit policy change 0159's header describes.
//
// ==========================================================================
// THE RESOLVED STAMP IS THE SERVER'S JOB
// ==========================================================================
// This component sends a status and a note, never resolved_by or resolved_at.
// updateIssue derives those from the TRANSITION — stamping on the way into
// resolved, clearing on the way out, and leaving them alone while a resolved
// ticket is merely edited. Sending them from here would make the client
// authoritative about who closed a ticket and when.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Upload, X, Paperclip, Inbox, ChevronDown } from "lucide-react";
import { Btn, PILL_TONE_CLS } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  fetchIssues, createIssue, updateIssue, fetchAttachmentUrl,
  type IssueQueue,
} from "@/lib/actions/issues";
import {
  ISSUE_CATEGORIES, ISSUE_STATUSES, ATTACHMENT_ACCEPT, RESOLVED,
  categoryLabel, statusMeta, statusRank, validateIssueDraft, validateAttachmentFile,
  type IssueRow,
} from "@/lib/issues";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;
const CARD_STYLE = { borderColor: "rgb(var(--border))" } as const;

/** "24 Aug, 14:32" — short, local, and unambiguous inside one office. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function StatusPillSmall({ status, ar }: { status: string; ar: boolean }) {
  const m = statusMeta(status);
  const tone = PILL_TONE_CLS[m.tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tone.chip,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
      {ar ? m.ar : m.en}
    </span>
  );
}

export default function IssuesSection({ open, lang }: { open: boolean; lang: "en" | "ar" }) {
  const ar = lang === "ar";
  const fileRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<"report" | "queue">("report");
  const [queue, setQueue] = useState<IssueQueue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The route the user was on when they opened Settings. Captured from
  // window.location rather than usePathname/useSearchParams: the settings popup
  // is state, not a route, so the location never changes while it is open — and
  // reading it directly avoids forcing a Suspense boundary for useSearchParams.
  // The QUERY STRING is included on purpose: "/trips" and "/trips?tab=finance"
  // are different screens, and the tab is often the whole context of the bug.
  const [pageRoute, setPageRoute] = useState("");

  const [category, setCategory] = useState<string>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>("open");
  const [draftNote, setDraftNote] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowSaved, setRowSaved] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

  const load = useCallback(async () => {
    // WRAPPED so a rejected action becomes a visible error rather than leaving
    // the queue null forever behind a spinner — the 2.2b failure, closed here.
    let res: Awaited<ReturnType<typeof fetchIssues>>;
    try {
      res = await fetchIssues();
    } catch (e) {
      console.error("[IssuesSection] load threw", e);
      setLoadError(e instanceof Error && e.message ? e.message : "Could not load the reports.");
      return;
    }
    // NARROW ON `data`, NOT ON `error`: `error: string` includes "", which is
    // falsy, so `if (res.error)` does not discriminate this union.
    if (!res.data) { setLoadError(res.error); return; }
    setLoadError(null);
    setQueue(res.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    setView("report");
    setFormError(null);
    setSubmitted(false);
    setRowError(null);
    setRowSaved(null);
    setExpandedId(null);
    if (typeof window !== "undefined") {
      setPageRoute(window.location.pathname + window.location.search);
    }
    void load();
  }, [open, load]);

  if (!open) return null;

  function resetForm() {
    setCategory("bug");
    setTitle("");
    setDescription("");
    setFile(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitted(false);

    // Same validator the server runs, so nothing can pass here and then fail
    // 0157's CHECK constraints.
    const problem = validateIssueDraft({ category, title });
    if (problem) { setFormError(problem); return; }
    if (file) {
      const bad = validateAttachmentFile(file);
      if (bad) { setFormError(bad); return; }
    }

    const fd = new FormData();
    fd.append("category", category);
    fd.append("title", title);
    fd.append("description", description);
    fd.append("pageRoute", pageRoute);
    if (file) fd.append("file", file);

    setSubmitting(true);
    const res = await createIssue(fd);
    setSubmitting(false);
    // Narrow on `id`, not on `error`.
    if (!res.id) { setFormError(res.error); return; }
    setSubmitted(true);
    resetForm();
    await load();
  }

  async function onExpand(row: IssueRow) {
    setRowError(null);
    setRowSaved(null);
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    setDraftStatus(row.status);
    setDraftNote(row.resolution_note ?? "");
    setAttachmentUrl(null);
    if (row.attachment_path) {
      // Lazily, per ticket. Signing every attachment at load would be N storage
      // round trips for images nobody has asked to see, and the URLs would
      // start expiring while the list sat open.
      setAttachmentLoading(true);
      const url = await fetchAttachmentUrl(row.attachment_path);
      setAttachmentUrl(url);
      setAttachmentLoading(false);
    }
  }

  async function onSaveRow(row: IssueRow) {
    setRowError(null);
    setRowSaved(null);
    setSavingId(row.id);
    const res = await updateIssue({ id: row.id, status: draftStatus, resolutionNote: draftNote });
    setSavingId(null);
    if (res.error) { setRowError(res.error); return; }
    setRowSaved(row.id);
    await load();
  }

  const rows = queue?.rows ?? [];
  // Resolved sinks; everything else keeps the newest-first order the query
  // returned. A stable sort, so equal ranks are not reshuffled on every render.
  const ordered = [...rows].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  const openCount = rows.filter((r) => r.status !== RESOLVED).length;

  return (
    <div>
      <h2 className="text-lg font-semibold">{ar ? "الإبلاغ عن مشكلة" : "Report a problem"}</h2>
      <p className="mt-1 text-sm muted">
        {ar
          ? "قائمة مشتركة — كلاكما يرى كل البلاغات ويستطيع حلّها."
          : "A shared list — you both see every report and either can resolve it."}
      </p>

      {/* View toggle. The count is the one thing worth knowing before clicking. */}
      <div
        className="mt-4 inline-flex rounded-lg border p-0.5"
        style={CARD_STYLE}
        role="tablist"
      >
        {([
          { key: "report" as const, label: ar ? "بلاغ جديد" : "New report" },
          { key: "queue" as const, label: ar ? "القائمة" : "Queue" },
        ]).map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={cn(
              "focus-ring inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              view === v.key ? "bg-brand-600 text-white shadow-soft" : "muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {v.label}
            {v.key === "queue" && openCount > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  view === "queue" ? "bg-white/25" : PILL_TONE_CLS.info.chip,
                )}
              >
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="mt-4 rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20">
          {loadError}{" "}
          <button onClick={() => void load()} className="focus-ring underline underline-offset-2">
            {ar ? "إعادة المحاولة" : "Try again"}
          </button>
        </div>
      )}

      {/* ================= NEW REPORT ================= */}
      {view === "report" && (
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <p className="mb-1.5 text-sm muted">{ar ? "ما نوع المشكلة؟" : "What kind of problem?"}</p>
            {/* Chips, not a dropdown: five short options, and this is the first
                decision — one visible click beats open-scan-select. */}
            <div className="flex flex-wrap gap-1.5">
              {ISSUE_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => { setSubmitted(false); setFormError(null); setCategory(c.key); }}
                  aria-pressed={category === c.key}
                  className={cn(
                    "focus-ring rounded-full border px-3 py-1.5 text-sm transition-colors",
                    category === c.key
                      ? "border-transparent bg-brand-600 text-white shadow-soft"
                      : "hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                  style={category === c.key ? undefined : CARD_STYLE}
                >
                  {ar ? c.ar : c.en}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{ar ? "عنوان قصير *" : "Short title *"}</span>
            <input
              value={title}
              onChange={(e) => { setSubmitted(false); setFormError(null); setTitle(e.target.value); }}
              className={INPUT}
              style={INPUT_STYLE}
              maxLength={200}
              placeholder={ar ? "مثال: زر الحفظ لا يستجيب" : "e.g. Save button does nothing"}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{ar ? "التفاصيل" : "Details"}</span>
            <textarea
              value={description}
              onChange={(e) => { setSubmitted(false); setFormError(null); setDescription(e.target.value); }}
              rows={4}
              className={cn(INPUT, "resize-y")}
              style={INPUT_STYLE}
              placeholder={
                ar
                  ? "ماذا كنت تحاول أن تفعل؟ وماذا حدث بدلًا من ذلك؟"
                  : "What were you trying to do, and what happened instead?"
              }
            />
          </label>

          {/* Attachment. Optional, and it says so. */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                // Reset immediately so re-picking the SAME file still fires a
                // change event — otherwise a rejected file cannot be retried.
                e.target.value = "";
                setFormError(null);
                if (f) {
                  const bad = validateAttachmentFile(f);
                  if (bad) { setFormError(bad); return; }
                }
                setFile(f);
              }}
            />
            {file ? (
              <div
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                style={CARD_STYLE}
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-[11px] muted tabular-nums">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label={ar ? "إزالة المرفق" : "Remove attachment"}
                  className="focus-ring shrink-0 rounded-md p-1 muted hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : (
              <Btn onClick={() => fileRef.current?.click()}>
                <span className="inline-flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  {ar ? "إرفاق لقطة شاشة" : "Attach a screenshot"}
                </span>
              </Btn>
            )}
            <p className="mt-1.5 text-[11px] muted">
              {ar
                ? "اختياري. JPEG أو PNG أو WebP أو GIF، بحد أقصى ٥ ميجابايت."
                : "Optional. JPEG, PNG, WebP or GIF, up to 5 MB."}
            </p>
          </div>

          {/* The captured route, shown rather than hidden. Someone filing a
              report should be able to see what is being sent with it — and if
              they opened Settings from the wrong page, this is the only clue
              that the report will point somewhere unhelpful. */}
          {pageRoute && (
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] muted">
              {ar ? "سيُرفق مع البلاغ:" : "Filed against:"}
              <code
                dir="ltr"
                className="rounded px-1.5 py-0.5 font-mono"
                style={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))" }}
              >
                {pageRoute}
              </code>
            </p>
          )}

          {formError && <p className="text-sm text-rose-600 dark:text-rose-400">{formError}</p>}

          <div className="flex items-center justify-end gap-3">
            {submitted && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <Check className="h-4 w-4" aria-hidden />
                {ar ? "تم الإرسال" : "Sent"}
                <button
                  type="button"
                  onClick={() => setView("queue")}
                  className="focus-ring underline underline-offset-2"
                >
                  {ar ? "عرضه" : "See it"}
                </button>
              </span>
            )}
            <Btn
              type="submit"
              variant="primary"
              className={submitting ? "opacity-50 pointer-events-none" : ""}
            >
              {submitting ? (ar ? "جارٍ الإرسال…" : "Sending…") : ar ? "إرسال" : "Send report"}
            </Btn>
          </div>
        </form>
      )}

      {/* ================= QUEUE ================= */}
      {view === "queue" && (
        <div className="mt-5">
          {queue === null && !loadError ? (
            <div className="py-8 text-center text-sm muted">{ar ? "جارٍ التحميل…" : "Loading…"}</div>
          ) : ordered.length === 0 ? (
            // A real empty state. Zero reports is the outcome this feature hopes
            // for, so it should not look like a failed load.
            <div className="rounded-xl border py-10 text-center" style={CARD_STYLE}>
              <Inbox className="mx-auto h-6 w-6 muted" aria-hidden />
              <p className="mt-2 text-sm muted">
                {ar ? "لا توجد بلاغات. جيد." : "No reports. That is the good outcome."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {ordered.map((row) => {
                const isOpen = expandedId === row.id;
                const mine = queue?.currentUserId != null && row.reporter_id === queue.currentUserId;
                return (
                  <div
                    key={row.id}
                    className={cn("rounded-xl border", row.status === RESOLVED && "opacity-70")}
                    style={CARD_STYLE}
                  >
                    <button
                      type="button"
                      onClick={() => void onExpand(row)}
                      aria-expanded={isOpen}
                      className="focus-ring flex w-full items-start gap-3 rounded-xl p-3 text-start"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPillSmall status={row.status} ar={ar} />
                          <span className="text-[11px] muted">
                            {categoryLabel(row.category, ar)}
                          </span>
                          {row.attachment_path && (
                            <Paperclip className="h-3 w-3 muted" aria-hidden />
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm font-medium">{row.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] muted">
                          <span>{mine ? (ar ? "أنت" : "You") : (ar ? "زميلك" : "Someone else")}</span>
                          <span aria-hidden>·</span>
                          <span>{when(row.created_at)}</span>
                          {row.page_route && (
                            <>
                              <span aria-hidden>·</span>
                              <code dir="ltr" className="font-mono">{row.page_route}</code>
                            </>
                          )}
                        </p>
                      </div>
                      <ChevronDown
                        className={cn("mt-1 h-4 w-4 shrink-0 muted transition-transform", isOpen && "rotate-180")}
                        aria-hidden
                      />
                    </button>

                    {isOpen && (
                      <div
                        className="space-y-3 border-t p-3"
                        style={CARD_STYLE}
                      >
                        {row.description && (
                          <p className="whitespace-pre-wrap text-sm">{row.description}</p>
                        )}

                        {row.attachment_path && (
                          <div>
                            {attachmentLoading ? (
                              <p className="text-[11px] muted">{ar ? "جارٍ تحميل الصورة…" : "Loading image…"}</p>
                            ) : attachmentUrl ? (
                              // Plain <img>: a signed URL with a query string and
                              // a five-minute life, on a host that would need a
                              // remotePatterns entry, and the optimiser cannot
                              // cache something that expires.
                              // eslint-disable-next-line @next/next/no-img-element
                              <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={attachmentUrl}
                                  alt={ar ? "مرفق البلاغ" : "Report attachment"}
                                  className="max-h-56 rounded-lg border object-contain"
                                  style={CARD_STYLE}
                                />
                              </a>
                            ) : (
                              <p className="text-[11px] muted">
                                {ar ? "تعذّر تحميل الصورة." : "The image could not be loaded."}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="muted">{ar ? "الحالة" : "Status"}</span>
                            <select
                              value={draftStatus}
                              onChange={(e) => { setRowSaved(null); setRowError(null); setDraftStatus(e.target.value); }}
                              className={cn(INPUT, "sm:w-40")}
                              style={INPUT_STYLE}
                            >
                              {/* All four, always. 0157 constrains no
                                  transitions, so neither does this. */}
                              {ISSUE_STATUSES.map((s) => (
                                <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>
                              ))}
                            </select>
                          </label>

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="muted">
                              {/* Dual-purpose, and the label says which one it is
                                  right now — 0157 stores one column and lets the
                                  status decide its meaning. */}
                              {draftStatus === "needs_info"
                                ? ar ? "ما المطلوب توضيحه؟" : "What do you need to know?"
                                : ar ? "ملاحظة" : "Note"}
                            </span>
                            <textarea
                              value={draftNote}
                              onChange={(e) => { setRowSaved(null); setRowError(null); setDraftNote(e.target.value); }}
                              rows={2}
                              className={cn(INPUT, "resize-y")}
                              style={INPUT_STYLE}
                            />
                          </label>
                        </div>

                        {row.resolved_at && row.status === RESOLVED && (
                          <p className="text-[11px] muted">
                            {ar ? "تم الحل في " : "Resolved "}
                            {when(row.resolved_at)}
                            {queue?.currentUserId != null && row.resolved_by === queue.currentUserId
                              ? ar ? " — بواسطتك" : " by you"
                              : ar ? " — بواسطة زميلك" : " by someone else"}
                          </p>
                        )}

                        {rowError && expandedId === row.id && (
                          <p className="text-sm text-rose-600 dark:text-rose-400">{rowError}</p>
                        )}

                        <div className="flex items-center justify-end gap-3">
                          {rowSaved === row.id && (
                            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                              <Check className="h-4 w-4" aria-hidden />
                              {ar ? "تم الحفظ" : "Saved"}
                            </span>
                          )}
                          <Btn
                            variant="primary"
                            onClick={() => void onSaveRow(row)}
                            className={savingId === row.id ? "opacity-50 pointer-events-none" : ""}
                          >
                            {savingId === row.id ? (ar ? "جارٍ الحفظ…" : "Saving…") : ar ? "حفظ" : "Save"}
                          </Btn>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
