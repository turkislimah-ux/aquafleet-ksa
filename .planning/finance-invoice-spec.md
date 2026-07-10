# AquaFleet KSA — Finance / Invoice Feature Spec (v2)

**Status:** Approved for build. Revised with locked decisions (Turki). Build in staged commits (see §12).
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
- **Balance (prepaid only)** — a **continuous derived ledger**: `sum(top-ups) − sum(billable trip rates consumed)`. Not a stored mutable number. Never resets. Months are only reporting windows over this continuous ledger. **PRE-VAT**: top-ups and the derived balance are pre-VAT SAR amounts; balance is consumed at the pre-VAT trip rate. VAT is computed only on the statement/invoice output — never drawn from or added to the balance itself.
- **Unpaid trip** — a delivered trip whose payment has not been settled. **One unified concept across both modes**: postpaid trips are unpaid until invoiced+paid; prepaid over-balance trips are unpaid until settled. Unpaid trips carry forward until settled.
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
- A table of top-up records: customer, amount (SAR, **pre-VAT**), date, note/reference, entered_by. Manual entry in the Finance tab (no payment gateway now).
- Balance is **derived** = `sum(top-ups) − sum(consumed billable trip rates)`, both sides pre-VAT (see §2). A reversed/unlocked trip automatically restores balance (nothing to undo manually).

### 4.3 Invoices
- Invoice record: customer, period (start/end dates), status (`draft` | `issued` | `paid`), sequential invoice number, created/issued/paid timestamps, seller snapshot, buyer snapshot, payment method (`cash` | `bank_transfer`), **exactly one** proof-of-payment file reference (see §7), totals (subtotal, VAT, grand total), and the set of trips + special charges it covers.
- **Invoice numbering — locked requirement:** gap-free, sequential (ZATCA-readiness). This needs a **dedicated counter mechanism**, not a plain auto-increment column (which gaps on rollback and isn't concurrency-safe). Mechanism to be designed in Commit 1 (§13).
- **Snapshot on issue:** an issued invoice captures its line items at issue time (see §6 — issued invoices are point-in-time snapshots that can go stale until paid).

### 4.4 Special charges
- Per-invoice, added at issue time: free-text label + amount (SAR). VAT 15% applies (charge × 1.15). Optional — only appear on the invoice if present.
- A special charge is an expense for the client for that period. Once the period's invoice is **paid**, special charges reset to zero (they don't carry) until new charges occur.

### 4.5 Company (seller) settings
- Bin Slimah Group seller details (legal name, VAT number, CR, address) stored as configurable company settings — appear on every invoice.

## 5. The covered / unpaid engine (prepaid) — HIGHEST-RISK LOGIC

**Billing period boundary:** a trip belongs to a billing period by its **`trip_date`** (scheduled date) — not `delivered_at`. Consistent with how the commission engine now scales (per-`trip_date` bucketing, not click-time). State this wherever "period" is used in this spec.

For a prepaid customer over a reporting period, split delivered trips into **Covered** and **Unpaid** tables:

**Algorithm (pure function — build with a test harness, like the commission engine):**
1. Take the customer's delivered trips whose `trip_date` falls in the period, ordered **oldest-first by `trip_date`, FIFO** (tiebreak: `delivered_at`) — the day the trip was FOR, not when it was clicked delivered.
2. Walk the **continuous** available balance (as of the period, carrying forward prior balance). Balance and rate here are **pre-VAT** (see §2, §4.2) — VAT never enters this walk.
3. For each trip: a trip is **Covered** only if the **full rate fits** in remaining balance. Subtract the whole rate.
4. The first trip whose full rate does **NOT** fit → that trip **and all later trips** go to the **Unpaid** table. **No trip splitting** — a trip is atomic.
5. Leftover balance (that couldn't cover a whole trip) **stays in the balance** and rolls forward. Balance is only ever consumed in whole-trip-rate increments.
6. If no trips overflow (balance covered all) → the **Unpaid table does not appear**.

**Single source of truth:** the prepaid balance derivation (§4.2's `sum(top-ups) − sum(consumed billable trip rates)`) and this Covered/Unpaid engine **MUST share one "what consumes balance" function**. The displayed balance and the engine's Covered/Unpaid split can never be computed by two different implementations — that would let them disagree.

**Postpaid** has no balance; all delivered-unsettled trips in the period are simply the billable set (effectively all "unpaid" until the invoice is paid).

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
- **Paid:** requires the payment step (§7). Invoices are **ALWAYS paid in full** — there is no partial-payment state, no `payments` table, no `partially_paid` status. On payment, the invoice's trips **lock** permanently. Only payment locks trips — never issue.

### 6.1 Billing periods & period-based settlement (the installment mechanism)

- **Period boundary = `trip_date`.** A trip belongs to a billing period by its `trip_date` (scheduled date), not `delivered_at` — consistent with the commission engine's per-`trip_date` scaling (see §5, §8, §10).
- **Full-only invoices, period-based "installments":** since invoices are never partially paid, flexibility comes entirely from the **period boundary**. To "pay part now," the user issues an invoice for a **shorter period** (e.g. up to a chosen date), pays it in full, then issues a **separate** invoice later for the remainder. Two full invoices over two periods — never one partially-paid invoice.

## 7. Payment step (mirrors commission pay flow)

- Payment is a **separate second step** after issuing (like commission approval → pay). Payment is always for the **full invoice total** — no partial payment.
- **Payment method** captured: `bank_transfer` or `cash`.
  - **Bank transfer:** requires **proof-of-payment upload** — a PDF or image of the bank transaction, **stored in the app** (Supabase Storage; new infrastructure — see §11). **Exactly one** proof file per invoice (consistent with full-only invoices — one payment event, one proof). The stored file is referenced from the invoice record.
  - **Cash:** in the future will require **direct-manager approval** instead of a proof upload. **DEFERRED** — depends on the not-yet-built role/user system. For now, treat cash like a recorded method; the approval gate is a documented future dependency.
- On successful payment → trips lock, invoice → Paid, special charges for the period reset to zero.

## 8. Prepaid vs Postpaid invoice differences

| | Postpaid | Prepaid |
|---|---|---|
| Meaning of invoice | A **bill** — customer owes the total | A **receipt/statement** — documents balance drawdown |
| Collectible amount | Yes (the invoice total, paid in full) | The **Covered** trips were already paid from balance; only **Unpaid** (over-balance) trips are collectible, in full |
| Tables shown | Trips for the period + charges | **Covered table** + **Unpaid table** (Unpaid only if over-balance) + charges |
| Payment step | Yes — issue → pay (full) → lock | Covered portion needs no collection; Unpaid trips follow the same settle-in-full→lock path |
| Balance | N/A | Continuous derived ledger, pre-VAT; statement shows drawdown |

*Period membership (the "period" row/column above) is always by `trip_date` (§6.1), not `delivered_at`.*

## 9. VAT math (exact)

- Trip line: `rate` (pre-VAT). Line VAT = `rate × 0.15`. Line total = `rate × 1.15`.
- Special charge line: `charge` (pre-VAT). Line VAT = `charge × 0.15`. Line total = `charge × 1.15`.
- Invoice **subtotal** = Σ pre-VAT (rates + charges). **VAT total** = subtotal × 0.15. **Grand total** = subtotal × 1.15.
- **Prepaid balance is a PRE-VAT ledger** (§2, §4.2, §5) — the VAT math here is for invoice/statement display only; VAT is never drawn from or added to the balance.
- Rounding: to 2 decimals (SAR halalas). Confirm rounding convention (per-line vs per-invoice) during build — prefer per-line round then sum, ZATCA-typical; verify with a test harness.

## 10. The Finance / Invoice tab (UI — behavior only; all visual design is Claude Code's)

- A **customer table** listing every customer with: payment mode, period trip count, period billable amount (pre-VAT + VAT), current balance (prepaid) or outstanding (postpaid), and an **over-balance flag** for prepaid customers who've exceeded balance (show the negative margin).
- Per-customer drill-in: the **statement/transaction history** (prepaid: every top-up + every trip debit, bank-statement style; postpaid: delivered trips + settlement status).
- **Reporting period selector:** monthly (month-end) as standard, with a **custom date-range** option. Trips are assigned to a period by `trip_date` (§6.1), not `delivered_at`.
- Actions: record top-up (prepaid), create/issue invoice, take payment + upload proof, generate/print the invoice PDF.
- **Breakdown/analysis** of trip activity per the period (counts, revenue, VAT) — reuses the existing breakdown-report patterns where possible.

## 11. New infrastructure

- **File storage** (Supabase Storage) for proof-of-payment files — the app has not stored uploaded files before. Needs a bucket + upload/download handling + access control. Scope this as its own commit.
- **PDF generation** for the invoice document (content-complete: seller/buyer details, sequential number, line items, VAT breakdown, totals, payment method, bilingual AR/EN fields as ZATCA-readiness). No cryptographic signing/QR/clearance.

## 12. Deferred (explicit)

1. **ZATCA Phase-2 compliance** — cryptographic signing, CSID onboarding, TLV-encoded QR, UBL 2.1 XML, API clearance/reporting. Separate compliance project, likely via a certified provider. The invoice model here is designed to feed it.
2. **Cash-payment manager approval** — depends on the role/user system (not built). Documented as a future gate on cash payments.
3. **Payment gateway** for prepaid top-ups — manual entry for now.

## 13. Proposed commit sequence (staged, each verified before the next)

1. **Migration + data model** — payment_mode + buyer tax fields on customer/project; top-ups (credits) table; invoices table; special-charges; company seller settings. Reviewed SQL before running.
2. **Prepaid balance ledger** — derived balance function + top-up recording + the transaction statement. Test harness for the derivation.
3. **Covered/unpaid engine** — the FIFO whole-trip algorithm (§5) as a pure function with a dedicated test harness (mirror the commission 43/43 harness discipline).
4. **VAT + special charges math** — pure, tested.
5. **Invoice lifecycle** — draft → issue (snapshot) → pay. Trip-lock on payment. The two-paid-states separation (§3).
6. **Proof-of-payment storage** — Supabase Storage bucket + upload.
7. **PDF generation** — content-complete, ZATCA-ready fields.
8. **Finance/Invoice tab UI** — the customer table, drill-in statement, period selector, actions.

Order may adjust; each commit is independently verifiable. The two engines (§5 covered/unpaid, §9 VAT) get test harnesses **before** any UI, because a wrong number here is a wrong bill.

## 14. Open items to confirm before/if they arise during build

- Rounding convention (per-line vs per-invoice) — resolve in the VAT commit with a test harness.
- Invoice number format/prefix (the gap-free/sequential requirement itself is locked, see §4.3 — only the format/prefix string is open).
