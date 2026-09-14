// PER-PART FINANCE FIGURES, and the one sentence the app says about them.
//
// Lifted OUT of app/inventory/PurchaseOrders.tsx unchanged when the
// part-details print sheet arrived: the sheet has to state the same four
// figures and the same tip, and a view-model in lib/docvm/ may not import from
// app/. Re-deriving them beside the renderer would be a second definition of
// each number — the exact drift the original header warned about when it
// pulled these out of two components into one function.
//
// The JSX stayed behind. PartFinanceSummaryCard still owns the boxes, the
// arrow glyph, the tone colours and the gradient AI badge, because those are
// screen. This file owns only what both surfaces must AGREE on.
//
// Purchases come from real purchase_order_lines (approved/pending_approval POs
// only, actual received qty/price where available — same
// `received_qty ?? qty` / `received_unit_price_sar ?? unit_price_sar`
// convention PODetailModal uses). Price trend compares the latest price_lots
// entry against the AVERAGE of every earlier one — deliberately NOT the
// current-vs-previous `priceDeltaPct` the pricing card shows. Two different
// questions, two different numbers, both correct.
//
// CONSUMPTION: `spentByConsumption` is a hard 0 and stays one, because
// stock_movements carries no per-movement cost column to derive it from
// (qty_delta/qty_after only) — whichever flow eventually attributes cost
// (most likely consume_from_lots, which does know per-lot cost) decides that
// then. `totalConsumed` is NOT zero and has not been for a while: the
// predecessor comment here claimed "nothing writes movement_type='consume'
// rows yet", which was true when it was written and is not now — measured
// 2026-09-14, production holds 30 'consume' movements dated 2026-07-29 to
// 2026-09-10. So a part can honestly report units consumed beside 0 SAR
// spent. That reads oddly and it is the truth; the print sheet mirrors it
// rather than papering over it.

import type {
  Part,
  PriceLot,
  PurchaseOrder,
  PurchaseOrderLine,
  StockMovement,
} from "@/lib/db-types";
import { fill, t } from "@/lib/i18n";

export type PartFinanceStats = {
  totalPurchased: number;
  // VAT (0056) — "Purchases" is the one stat here that's a real
  // purchasing-money figure (a booked cost of parts bought), so it's the one
  // place VAT applies. stockValue/priceTrendPct/totalConsumed/
  // spentByConsumption stay VAT-free. Sourced from each qualifying line's
  // STORED line_vat_sar/received_line_vat_sar, never recomputed — a pre-0056
  // line honestly reads 0 here, not back-computed.
  purchasesVat: number;
  purchasesTotal: number; // totalPurchased + purchasesVat
  purchaseCount: number;
  stockValue: number;
  priceTrendPct: number;
  totalConsumed: number;
  spentByConsumption: number;
};

export function computePartFinanceStats(
  part: Part,
  priceLots: PriceLot[],
  purchaseOrders: PurchaseOrder[],
  purchaseOrderLines: PurchaseOrderLine[],
  movements: StockMovement[],
): PartFinanceStats {
  const lots = priceLots
    .filter((l) => l.part_id === part.id)
    .sort((a, b) =>
      a.received_on !== b.received_on
        ? a.received_on < b.received_on
          ? -1
          : 1
        : a.created_at < b.created_at
        ? -1
        : 1,
    );
  const currentPrice = lots.length > 0 ? lots[lots.length - 1].price_sar : part.unit_cost_sar;
  let priceTrendPct = 0;
  if (lots.length >= 2 && currentPrice != null) {
    const hist = lots.slice(0, -1);
    const avgOld = hist.reduce((s, l) => s + l.price_sar, 0) / hist.length;
    if (avgOld > 0) priceTrendPct = Math.round(((currentPrice - avgOld) / avgOld) * 1000) / 10;
  }
  // unit_cost_sar x qty_on_hand, NOT the pricing card's lots-derived
  // totalValue. Also two different questions; see this file's header.
  const stockValue = part.unit_cost_sar != null ? part.unit_cost_sar * part.qty_on_hand : 0;

  let totalPurchased = 0;
  let purchasesVat = 0;
  let purchaseCount = 0;
  for (const po of purchaseOrders) {
    if (po.status !== "approved" && po.status !== "pending_approval") continue;
    const line = purchaseOrderLines.find(
      (l) => l.purchase_order_id === po.id && l.part_id === part.id,
    );
    if (!line) continue;
    const qty = line.received_qty ?? line.qty;
    const unit = line.received_unit_price_sar ?? line.unit_price_sar;
    totalPurchased += qty * unit;
    purchasesVat += line.received_line_vat_sar ?? line.line_vat_sar;
    purchaseCount += 1;
  }
  const purchasesTotal = totalPurchased + purchasesVat;

  const totalConsumed = movements
    .filter((m) => m.part_id === part.id && m.movement_type === "consume")
    .reduce((s, m) => s + Math.abs(m.qty_delta), 0);
  const spentByConsumption = 0;

  return {
    totalPurchased,
    purchasesVat,
    purchasesTotal,
    purchaseCount,
    stockValue,
    priceTrendPct,
    totalConsumed,
    spentByConsumption,
  };
}

export type PartAiTip = { tone: "warn" | "info" | "ok"; text: string };

// Same 4 branches + healthy fallback preview's own per-part AI tip uses
// (pages-2.js:1772-1792). "purchased but not consumed" fires for most parts
// with purchase history, which is an accurate reflection of today's app
// state, not a bug. Branch ORDER is the rule — critical stock outranks a
// price rise outranks unconsumed stock outranks overstock — so do not sort
// or reorder these.
export function partAiTip(
  part: Part,
  stats: Pick<PartFinanceStats, "priceTrendPct" | "totalConsumed" | "purchaseCount">,
  lang: "en" | "ar",
): PartAiTip {
  if (part.reorder_level != null && part.qty_on_hand <= part.reorder_level * 0.5) {
    return {
      tone: "warn",
      text: fill(t("inventory.po.tipStockCritical", lang), {
        qty: part.qty_on_hand,
        unit: part.unit ?? "",
        level: part.reorder_level,
        reorderQty: part.reorder_qty ?? "?",
      }),
    };
  }
  if (stats.priceTrendPct >= 10) {
    return { tone: "warn", text: fill(t("inventory.po.tipPriceUp", lang), { pct: stats.priceTrendPct }) };
  }
  if (stats.totalConsumed === 0 && stats.purchaseCount > 0) {
    return { tone: "warn", text: t("inventory.po.purchasedButNot", lang) };
  }
  if (
    part.reorder_level != null &&
    part.reorder_level > 0 &&
    part.qty_on_hand > part.reorder_level * 3
  ) {
    return {
      tone: "info",
      text: fill(t("inventory.po.tipOverstocked", lang), {
        qty: part.qty_on_hand,
        unit: part.unit ?? "",
      }),
    };
  }
  return { tone: "ok", text: t("inventory.po.stockPricingLook", lang) };
}
