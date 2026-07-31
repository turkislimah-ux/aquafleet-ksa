-- 0071_workshop_payment_discount.sql
-- Maintenance — workshop_payments gains a discount. Additive: existing
-- rows have discount_sar default to 0, which keeps them valid under the
-- new CHECK automatically (0 discount = the old formula exactly).
--
-- VAT IS STILL COMPUTED ON THE FULL SUBTOTAL (subtotal_sar * VAT_RATE,
-- app-side, lib/outsourced-vat.ts — unchanged by this migration). The
-- discount is subtracted ONLY at the very end, in grand_total_sar. This
-- migration does not touch how vat_sar itself is derived — only widens the
-- consistency CHECK that ties all four figures together.
--
-- grand_total_sar >= 0 (existing CHECK) still stands as the guard against
-- a discount larger than subtotal+vat — no separate cap needed.

begin;

alter table public.workshop_payments
  add column if not exists discount_sar numeric(12, 2) not null default 0
    check (discount_sar >= 0);

alter table public.workshop_payments
  drop constraint if exists workshop_payments_grand_total_check;

alter table public.workshop_payments
  add constraint workshop_payments_grand_total_check
    check (grand_total_sar = subtotal_sar + vat_sar - discount_sar);

commit;
