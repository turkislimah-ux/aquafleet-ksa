# AquaFleet KSA — Finance / Invoice Feature Spec (v3)

**Status:** Approved for build. Revised with locked decisions (Turki). Build in staged commits (see §14). **v3 revision (Turki): the prepaid balance is now VAT-inclusive** — see §2, §5.
**Owner:** Turki. **Author of record:** senior-architect review.
**Scope boundary:** Full internal billing system with correct VAT math and PDF generation. **ZATCA Phase-2 cryptographic clearance (signing, CSID, TLV QR, API reporting) is explicitly DEFERRED** to a separate compliance project. The invoice data model must be *ZATCA-ready* (capture the fields ZATCA will need) but must NOT attempt cryptographic signing or API clearance now.

---

## 1. Purpose

Add a **Finance / Invoice** tab to the Trips page that lets the accountant/user manage customer payment obligations and issue invoices. This is the customer-billing (money-in) side of the system, distinct from the existing driver-commission (money-out) side. The two must never be conflated.

## 2. Core concepts & vocabulary

- **Rate** — the price a customer pays per delivered trip to their location. Already exists on the project. This is the **pre-VAT** amount.
- **VAT** — 15%, added **on top** of rate and special charges (amount × 1.15). ZATCA-coherent. The rate stored is pre-VAT; VAT is computed, never stored baked-in.
- **Payment mode** — per **customer** (1:1 with project): **Postpaid** or **Prepaid**. Set in Add/Manage Project.
- **Billable event** — a trip becomes billable when it is **delivered**. Reversing a delivery (via the existing phase picker) reverses its billable effect, unless the trip is locked (see §6).
- **Balance (prepaid only)** — a **continuous derived ledger**: `sum(top-ups) − sum(all consumption)`. Not a stored mutable number. Never resets. Months are only reporting windows over this continuous ledger. **VAT-INCLUSIVE (v3 — reversed from v2):** top-ups are plain money credits with no VAT concept of their own; consumption (a delivered trip, a special charge) draws `amount × 1.15` from the balance — see §5. Balance **can go negative** (a shortfall), shown in the Finance tab in red.
  **Rationale for the reversal:** under v2's pre-VAT model, when the balance couldn't stretch to cover a trip's VAT, Bin Slimah absorbed that VAT instead of the customer. The customer must bear the VAT — so it's now drawn from their own balance, same as the rate.
- **Unpaid trip** — a delivered trip whose payment has not been settled. **One unified concept across both modes**: postpaid trips are unpaid until invoiced+paid; prepaid over-balance trips are unpaid until covered. Unpaid trips carry forward until settled (see §5).
- **Locked trip** — a trip included in a **paid** invoice. Locked = no edits, no stage changes, no reversal, no delete. (Extends the existing paid-commission lock, but this is a *separate* lock driven by *customer-invoice* payment, not driver-commission payment.)

## 3. The two "paid" states — DO NOT CONFLATE

A trip carries two independent financial relationships:
1. **Driver commission** (existing) — what you pay the driver. Governed by `payout_id` / the commission pay flow.
2. **Customer invoice** (this feature) — what the customer pays you. Governed by a new invoice linkage.

A trip can be commission-paid but not invoice-paid, or vice versa. The "paid trips can't be edited" rule in this spec refers to **customer-invoice-paid**. Both locks independently freeze a trip; the trip is editable only if neither lock applies.

## 4. Data model (new)

> Exact column names/types are Claude Code's call; this specifies what must be captured. Prefer derived over stored, consistent with the app.

### 4.1 Customer / project additions (set via Add/Manage Project, all optional)
- `payment_mode`: `postpaid` | `prepaid` — **NO default.** The create form forces an explicit choice; the user must pick one when creating a customer/project. The column is **nullable** in the DB so an "unset" state on pre-existing customers is detectable — never silently defaulted.
- Buyer tax identity (optional, for the invoice): VAT number, CR number, billing address. Optional because some clients pay cash / aren't registered.
- The existing **"Customer rate / trip (SAR)"** field's UI in the project modal adapts to reflect payment mode (behavior only — design is Claude Code's).

### 4.2 Prepaid top-ups (credits) — ledger
- A table of top-up records: customer, amount (SAR — **plain money, no VAT concept**, see §2), date, note/reference, entered_by, and (v3) a **required photo attachment** — proof of the top-up. This was optional in v2; it is now **REQUIRED** on the record-top-up input.
- Balance is **derived** = `sum(top-ups) − sum(all consumption)`, VAT-inclusive on the consumption side (see §2, §5). A reversed/unlocked trip, or a removed special charge, automatically restores balance (nothing to undo manually).
- Top-ups get their own **history list** in the Finance tab (same shape as the invoice list), with a **"Record Top-up"** button in the top corner opening the existing record-top-up popup (see §11).

### 4.3 Invoices
- Invoice record: customer, period (start/end dates), status (`draft` | `issued` | `paid`), sequential invoice number, created/issued/paid timestamps, seller snapshot, buyer snapshot, payment method (`cash` | `bank_transfer`), **exactly one** proof-of-payment file reference (see §7), totals (subtotal, VAT, grand total), and the set of trips + special charges it covers.
- **Invoice numbering — locked requirement:** gap-free, sequential (ZATCA-readiness). This needs a **dedicated counter mechanism**, not a plain auto-increment column (which gaps on rollback and isn't concurrency-safe). Mechanism to be designed in Commit 1 (§14).
- **Snapshot on issue:** an issued invoice captures its line items at issue time (see §6 — issued invoices are point-in-time snapshots that can go stale until paid).

### 4.4 Special charges
- Per-invoice, added at issue time: free-text label + amount (SAR). VAT 15% applies (charge × 1.15). Optional — only appear on the invoice if present.
- A special charge is an expense for the client for that period. Once the period's invoice is **paid**, special charges reset to zero (they don't carry) — **except** an unpaid prepaid special charge, which rolls forward instead of resetting (v3, see §5, §7).

### 4.5 Company (seller) settings
- Bin Slimah Group seller details (legal name, VAT number, CR, address) stored as configurable company settings — appear on every invoice.

## 5. The covered / unpaid engine (prepaid) — HIGHEST-RISK LOGIC

**Consumption events, VAT-inclusive (v3 — reversed from v2's pre-VAT model, see §2):** a delivered trip consumes `rate × 1.15` from the balance the moment it's delivered. A special charge consumes `amount × 1.15` from the balance the moment it's added to a draft invoice. Both are consumption events against the **same** balance — no separate pools for trips vs charges.

**Billing period boundary:** a trip belongs to a billing period by its **`trip_date`** (scheduled date) — not `delivered_at`. Consistent with how the commission engine scales (per-`trip_date` bucketing, not click-time). A special charge belongs to whichever invoice it was added to.

**ONE FIFO queue, trips and special charges together (v3 — this is the material change from v2, which only queued trips):**

**Algorithm (pure function — build with a test harness, like the commission engine):**
1. Build a single queue of every unsettled consumption event for the customer — delivered trips **and** added special charges — ordered oldest-first by date: `trip_date` for trips, the date it was added for special charges (tiebreak: `delivered_at` for trips, `created_at` for special charges).
2. Walk the **continuous** available balance (as of the period, carrying forward prior balance). Each item's VAT-inclusive amount (§2, §5 above) either fits or it doesn't.
3. An item is **Covered** only if its **full VAT-inclusive amount fits** in remaining balance. Subtract the whole amount. **No splitting — an item is atomic**, whether trip or charge.
4. The first item whose full amount does **NOT** fit → that item **and every later item in the queue** go to **Unpaid** — even if a later item alone would have fit.
5. Leftover balance (that couldn't cover the next whole item) **stays in the balance** and rolls forward. Balance is only ever consumed in whole-item increments.
6. **Unpaid items roll forward** — they reappear in the queue on the customer's next draft invoice, never written off.
7. If nothing overflows (balance covered the whole queue) → the **Unpaid table does not appear**.

**Single source of truth:** the balance derivation (§4.2's `sum(top-ups) − sum(all consumption)`) and this Covered/Unpaid engine **MUST share one "what consumes balance" function** — trips and special charges together, VAT-inclusive, one queue. The displayed balance and the engine's Covered/Unpaid split can never be computed by two different implementations — that would let them disagree.

**This remains the total-balance model:** Covered/Unpaid is a **presentation split of the single derived balance**, not a separate allocation mechanism — unchanged principle from v2, now just applied over a combined trips+charges queue.

**Postpaid** has no balance; all delivered-unsettled trips in the period are simply the billable set (effectively all "unpaid" until the invoice is paid). Special charges on a postpaid invoice are billed directly each period — no consumption/balance/rollover concept applies to postpaid.

## 6. Invoice lifecycle

```
Draft ──issue──> Issued ──pay(+proof)──> Paid
  │                 │                       │
  editable      snapshot; trips             trips LOCKED
                still reversible/           (no edit/stage/
                editable; invoice           reversal/delete)
                can be re-issued            invoice closed
                if trips change
```

- **Draft:** editable working invoice.
- **Issued:** a **point-in-time snapshot**, sendable. Supports the **mid-period request** use case (customer asks "what have I spent / what's my balance so far"). **Issuing does NOT lock trips** — trips can still be reversed/edited afterward; the invoice may go **stale** and can be **re-issued/refreshed** to a new snapshot.
- **Paid:** requires the payment step (§7). Invoices are **ALWAYS paid in full** — there is no partial-payment state, no `payments` table, no `partially_paid` status. On payment, the invoice's trips **lock** permanently. Only payment locks trips — never issue. (For **prepaid**, "payment" means confirming settlement of the already-consumed Covered items, not new money changing hands — see §7.)

### 6.1 Billing periods & period-based settlement (the installment mechanism)

- **Period boundary = `trip_date`.** A trip belongs to a billing period by its `trip_date` (scheduled date), not `delivered_at` — consistent with the commission engine's per-`trip_date` scaling (see §5, §8, §11).
- **Full-only invoices, period-based "installments":** since invoices are never partially paid, flexibility comes entirely from the **period boundary**. To "pay part now," the user issues an invoice for a **shorter period** (e.g. up to a chosen date), pays it in full, then issues a **separate** invoice later for the remainder. Two full invoices over two periods — never one partially-paid invoice.

## 7. Payment step (mirrors commission pay flow)

- Payment is a **separate second step** after issuing (like commission approval → pay). Payment is always for the **full invoice total** — no partial payment.
- **Postpaid — unchanged from v2.** Payment method captured: `bank_transfer` or `cash`.
  - **Bank transfer:** requires **proof-of-payment upload** — a PDF or image of the bank transaction, **stored in the app** (Supabase Storage; new infrastructure — see §12). **Exactly one** proof file per invoice (consistent with full-only invoices — one payment event, one proof). The stored file is referenced from the invoice record.
  - **Cash:** in the future will require **direct-manager approval** instead of a proof upload. **DEFERRED** — depends on the not-yet-built role/user system. For now, treat cash like a recorded method; the approval gate is a documented future dependency.
- **Prepaid — v3, new; reverses v2's "Unpaid trips follow the same settle-in-full path."** Prepaid has **no `cash`/`bank_transfer`** — its payment method is **"payment from balance."** Every Covered trip and Covered special charge already consumed the balance at the moment it happened (delivery, or add-to-draft — §5), so there's nothing new to collect for them by the time the invoice is issued. Mark Paid shows `Total − balance = what's left`, then a single **Confirm payment** action. Mark Paid does **not** deduct the balance again — it only **records settlement and locks the Covered items** (§3/§6); the display just shows a state that's already true.
  - The **Unpaid table is never paid on a prepaid invoice** — those items were never part of this invoice's settlement; they've rolled forward per §5. A historical **paid** prepaid invoice still displays its Unpaid table, as a record of what didn't clear at that point — those trips/charges remain billable on a later invoice, they were never written off.
- On successful payment → the invoice's Covered trips/charges lock, invoice → Paid. Special charges reset to zero after Paid — true as before for **postpaid** (one-off, no carry) and for a prepaid invoice's **Covered** special charges (now settled and locked). A prepaid invoice's **Unpaid** special charges do **not** reset — they roll forward per §5, same as Unpaid trips (v3; see §4.4).

## 8. Prepaid vs Postpaid invoice differences

| | Postpaid | Prepaid |
|---|---|---|
| Meaning of invoice | A **bill** — customer owes the total | A **receipt/statement** — documents balance drawdown |
| Collectible amount | Yes (the invoice total, paid in full) | Only the **Covered** trips + charges (already drawn from balance) settle on this invoice. **Unpaid** items are not collectible here — they roll forward to a later invoice (§5); Amount Due is shown for context only, not as a bill (§9) |
| Tables shown | Trips for the period + charges | **Covered table** + **Unpaid table** (if any) + **Special charges table** — structure and ordering in §9 |
| Payment step | Yes — issue → pay (full) → lock | **"Payment from balance"** (v3) — Mark Paid records settlement of the already-consumed Covered items and locks them; no new money changes hands on this invoice (§7) |
| Balance | N/A | Continuous derived ledger, **VAT-inclusive** (v3 — reversed from v2's pre-VAT model, see §2); can go negative |

*Period membership (the "period" row/column above) is always by `trip_date` (§6.1), not `delivered_at`.*

## 9. Invoice structure (prepaid) — v3, new

This section covers the layout/content of a **prepaid** invoice's tables and totals. Postpaid keeps its existing simple structure (trips for the period + charges, one collectible total — §8) and is not affected by this section.

- **Rows stay pre-VAT** — no per-row VAT column. Each of the Covered and Unpaid tables shows three summary lines beneath its rows, **always shown, even at zero**:
  - **Subtotal** — that table's items total, VAT-inclusive (`Σ amount × 1.15`, trips + any special charges in that table).
  - **Balance** — the running balance available going into that table's items (§5's walk).
  - **Remaining** — Balance minus Subtotal, what's left after that table draws. On the **Unpaid** table this goes **negative** — that's the shortfall that pushed those items to Unpaid in the first place (§5).
- **Special charges** keep their **own table**, positioned **below** the Unpaid trips table. Order: Covered trips → Unpaid trips → Special charges.
- **Grand Total block** — replaces v2's "Grand Total = all trips incl. unpaid," which is **reversed** in v3. Built only from what's actually settled on this invoice:
  - **Subtotal** — Covered trips, pre-VAT.
  - **Special Charges** — pre-VAT, **Covered only** (an Unpaid special charge doesn't contribute — it rolled forward per §5).
  - **Total VAT** — 15% on (Subtotal + Special Charges).
  - **TOTAL** — the sum of the three above.
  Displayed one line below the other. **Unpaid trips are NOT part of the Grand Total** — they roll to a later invoice (§5), never inflating this invoice's collectible total.
- **Amount Due** = the Unpaid trips subtotal, VAT-inclusive. This is the customer's outstanding shortfall shown **for information only — it is NOT collectible on this invoice** (nothing is actually billed here; it exists so the customer can see why some trips didn't clear). Gets a **hide toggle** (top-right of that table's title) controlling whether Amount Due appears in print / PDF / email.

## 10. VAT math (exact)

- Trip line: `rate` (pre-VAT). Line VAT = `rate × 0.15`. Line total = `rate × 1.15`.
- Special charge line: `charge` (pre-VAT). Line VAT = `charge × 0.15`. Line total = `charge × 1.15`.
- Invoice **subtotal** = Σ pre-VAT (rates + charges) — for prepaid, the **Covered/settled items only** (§9); postpaid sums the full period. **VAT total** = subtotal × 0.15. **Grand total** = subtotal × 1.15.
- **Prepaid balance is a VAT-INCLUSIVE ledger (v3 — reversed from v2)** (§2, §4.2, §5): a trip or special charge draws `amount × 1.15` from the balance the moment it's consumed. This is a **consumption-side** rule, distinct from the invoice's own display math above (rows still render pre-VAT with VAT shown at the document/grand-total level, §9) — the two aren't the same computation, they just both use the 15% rate.
- **Rounding — DECIDED (commit `9acf22f`):** document-level (per-invoice) rounding, half-up, 2 decimals (SAR halalas) — **not** a summation of independently-rounded per-line VAT amounts. Per ZATCA's XML Implementation Standard: tax is rounded on the document total. Implemented in `lib/vat.ts` (`calculateVat`), reusing `round2` from `lib/prepaid.ts` so every Finance money computation rounds identically. `scripts/vat-check.ts` proves both the convention (document-level vs naive per-line-sum diverge, document-level wins) and the half-up tie-break (`0.125 → 0.13`).

## 11. The Finance / Invoice tab (UI — behavior only; all visual design is Claude Code's)

- A **customer table** listing every customer with: payment mode, period trip count, period billable amount (pre-VAT + VAT), current balance (prepaid) or outstanding (postpaid), and an **over-balance flag** for prepaid customers who've exceeded balance (show the negative margin — balance can go negative, v3, §2/§5).
- Per-customer drill-in: the **statement/transaction history** (prepaid: every top-up + every consumption debit — trips **and** special charges, VAT-inclusive, bank-statement style, §5; postpaid: delivered trips + settlement status).
- **Reporting period selector:** monthly (month-end) as standard, with a **custom date-range** option. Trips are assigned to a period by `trip_date` (§6.1), not `delivered_at`.
- **Top-ups (v3):** their own **history list** (same shape as the invoice list) plus a **"Record Top-up"** button in the top corner, opening the existing record-top-up popup — the popup now **requires** a photo attachment (§4.2), was optional in v2.
- Actions: record top-up (prepaid), create/issue invoice, take payment + upload proof (postpaid) / confirm payment from balance (prepaid, §7), generate/print the invoice PDF.
- **Breakdown/analysis** of trip activity per the period (counts, revenue, VAT) — reuses the existing breakdown-report patterns where possible.

## 12. New infrastructure

- **File storage** (Supabase Storage) for proof-of-payment files, and (v3) the now-required top-up photo attachments (§4.2) — the app has not stored uploaded files before. Needs a bucket + upload/download handling + access control. Scope this as its own commit.
- **PDF generation** for the invoice document (content-complete: seller/buyer details, sequential number, line items, VAT breakdown, totals, payment method, bilingual AR/EN fields as ZATCA-readiness). No cryptographic signing/QR/clearance.

## 13. Deferred (explicit)

1. **ZATCA Phase-2 compliance** — cryptographic signing, CSID onboarding, TLV-encoded QR, UBL 2.1 XML, API clearance/reporting. Separate compliance project, likely via a certified provider. The invoice model here is designed to feed it.
2. **Cash-payment manager approval** — depends on the role/user system (not built). Documented as a future gate on cash payments.
3. **Payment gateway** for prepaid top-ups — manual entry for now.

## 14. Proposed commit sequence (staged, each verified before the next)

1. **Migration + data model** — payment_mode + buyer tax fields on customer/project; top-ups (credits) table; invoices table; special-charges; company seller settings. Reviewed SQL before running.
2. **Prepaid balance ledger** — derived balance function + top-up recording + the transaction statement. Test harness for the derivation.
3. **Covered/unpaid engine** — the FIFO whole-item algorithm (trips + special charges, §5) as a pure function with a dedicated test harness (mirror the commission 43/43 harness discipline).
4. **VAT + special charges math** — pure, tested.
5. **Invoice lifecycle** — draft → issue (snapshot) → pay. Trip-lock on payment. The two-paid-states separation (§3).
6. **Proof-of-payment storage** — Supabase Storage bucket + upload.
7. **PDF generation** — content-complete, ZATCA-ready fields.
8. **Finance/Invoice tab UI** — the customer table, drill-in statement, period selector, actions.

Order may adjust; each commit is independently verifiable. The two engines (§5 covered/unpaid, §10 VAT) get test harnesses **before** any UI, because a wrong number here is a wrong bill.

## 15. Open items to confirm before/if they arise during build

- **Effective-dated rate history (mixed-rate invoice rows)** — still open/deferred. A project's rate is a single current value with no history; a rate change mid-period should split that period's invoice into two rows (old rate up to the change, new rate after) rather than applying the current rate retroactively to the whole period. Prepaid consumption (§5) would need to walk old-then-new by date too. Likely pairs with the existing effective-dated-commission deferral — same underlying mechanism, driver-pay side vs customer-billing side.
- **Multi-project customers with separate finance** — still open/deferred. Currently impossible (`projects_customer_id_unique`, migration 0015, enforces 1 customer = 1 project), and invoices key off `customer_id` only, never `project_id` (§4.3). Supporting this would need invoices to become project-scoped.

*(Resolved since v2, dropped from this list: rounding convention — resolved to document-level VAT rounding, half-up, verified by the VAT test harness; invoice number format — resolved to `YYY-NNNNNN`, migration 0034.)*
