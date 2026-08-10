"use server";

// Global search — the ONE call into the database for record results.
//
// SECURITY, stated because it is the whole design:
// `public.search_everything` (migration 0102) is SECURITY INVOKER, and this
// action uses the request-scoped Supabase client from lib/supabase/server,
// which carries the caller's own auth cookies. So every SELECT inside the
// function runs under the CALLER's RLS policies. This path cannot surface a
// row the user could not already read. Do not "optimise" this by moving to a
// service-role client — that would silently turn search into a data leak the
// moment RBAC lands (parked in HANDOFF.md §6).
//
// The action returns entity + id and nothing routable; the href is resolved
// in lib/search-routes.ts. The database does not know about URLs.

import { createClient } from "@/lib/supabase/server";
import {
  ENTITY_ORDER, isSearchEntity, hrefForHit, precisionForEntity,
  type SearchEntity, type HitPrecision,
} from "@/lib/search-routes";
import { SEARCH_MIN_CHARS } from "@/lib/search-match";

/**
 * Invoice deep-link resolution — NAVIGATION, resolved in the app.
 *
 * The Finance tab opens invoices through InvoicesModal, which is keyed by
 * CUSTOMER, while `search_everything` returns only the invoice id. Rather
 * than widen 0102's return shape (a drop-and-recreate migration, since a
 * function's OUT columns cannot change under create-or-replace), the
 * customer is looked up here at click time. That keeps route/navigation
 * concerns in the app, which is 0102's own stated design — "the DB knows
 * what a record IS; the app knows where it LIVES".
 *
 * Also worth noting: FinanceTab's own `paidInvoices` prop could NOT have
 * served here. It is paid invoices only, and a search hit can be a draft,
 * confirmed, unpaid or void invoice — resolving locally would have silently
 * failed on every invoice that is not already paid.
 *
 * Runs on the caller's session, so RLS decides. An invoice the user cannot
 * read resolves to null and the click lands on the Finance tab instead of
 * revealing a customer name through the back door.
 */
export type InvoiceTarget = { customerId: string; customerName: string; customerEmail: string | null };

export async function resolveInvoiceCustomer(invoiceId: string): Promise<InvoiceTarget | null> {
  if (!invoiceId) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("customer_id, customers(id, name, email)")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    console.error("[resolveInvoiceCustomer] failed:", error.message);
    return null;
  }
  if (!data?.customer_id) return null;

  // PostgREST types an embedded to-one relation as an array in some
  // configurations and an object in others; normalise rather than assume.
  const rawCustomer = (data as { customers?: unknown }).customers;
  const customer = (Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer) as
    | { id: string; name: string | null; email: string | null }
    | undefined;

  return {
    customerId: data.customer_id as string,
    customerName: customer?.name ?? "—",
    customerEmail: customer?.email ?? null,
  };
}

export type RecordHit = {
  id: string;            // "<entity>:<uuid>" — unique across groups
  entity: SearchEntity;
  entityId: string;
  group: SearchEntity;   // group heading key (search.g_<group>)
  title: string;
  subtitle: string | null;
  badge: string | null;
  href: string;
  precision: HitPrecision;
  score: number;
};

type RawRow = {
  entity: string | null;
  entity_id: string | null;
  title: string | null;
  subtitle: string | null;
  badge: string | null;
  score: number | string | null;
  matched: string | null;
};

/**
 * @param query   raw user input; normalisation happens in SQL, not here
 * @param perType max hits PER ENTITY (the RPC's own p_limit)
 */
export async function searchRecords(query: string, perType = 5): Promise<RecordHit[]> {
  const q = query.trim();
  // Mirrors the RPC's own floor so a 1-character keystroke never becomes a
  // round trip. The DB enforces it too; this just avoids the request.
  if (q.length < SEARCH_MIN_CHARS) return [];

  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_everything", {
    p_q: q,
    p_limit: perType,
  });

  if (error) {
    // Never surface a raw Postgres error into the header UI, and never throw
    // — a failed search must degrade to "no results", not break the shell on
    // every page. Logged server-side so it is still diagnosable.
    console.error("[searchRecords] search_everything failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as RawRow[];

  const hits: RecordHit[] = [];
  for (const r of rows) {
    if (!r.entity || !r.entity_id) continue;
    // An entity the app has no route for must not render as a dead row.
    // This triggers if 0102 ever gains a block before this file learns about
    // it — skip it rather than produce a result that goes nowhere.
    if (!isSearchEntity(r.entity)) {
      console.warn("[searchRecords] unmapped entity from search_everything:", r.entity);
      continue;
    }
    const entity = r.entity;
    hits.push({
      id: `${entity}:${r.entity_id}`,
      entity,
      entityId: r.entity_id,
      group: entity,
      // A record with no title would render as a blank row; fall back to the
      // subtitle, then to a visible marker, never to an empty string.
      title: r.title?.trim() || r.subtitle?.trim() || "—",
      subtitle: r.title?.trim() ? r.subtitle : null,
      badge: r.badge,
      href: hrefForHit(entity, r.entity_id),
      precision: precisionForEntity(entity),
      // `score` is Postgres `real`. Postgres numerics can arrive as STRINGS
      // over PostgREST (documented lesson — CLAUDE.md §7, Reports), and a
      // string here would make the sort below compare lexically: "0.9" would
      // rank above "1". Coerce once, at the boundary.
      score: Number(r.score ?? 0),
    });
  }

  // The RPC already orders by score, but the grouping in the panel needs a
  // stable, meaningful group order too — score first so the best match wins
  // outright, then the canonical entity order as the tiebreak.
  const orderIndex = new Map(ENTITY_ORDER.map((e, i) => [e, i]));
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (orderIndex.get(a.entity) ?? 99) - (orderIndex.get(b.entity) ?? 99) ||
      a.title.localeCompare(b.title)
  );

  return hits;
}
