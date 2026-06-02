"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, Btn, Table, TH, TD, Section, Bar } from "@/components/ui";
import { parts } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatNum, formatSar, cn } from "@/lib/utils";
import { Plus, Boxes, AlertTriangle, Package, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";

const CATEGORIES = ["all", "engine", "brake", "tire", "fluid", "electrical", "tank", "filter", "consumable"] as const;

export default function InventoryPage() {
  const { lang } = useApp();
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("all");
  const [warehouse, setWarehouse] = useState<string>("all");
  const [q, setQ] = useState("");

  const list = useMemo(() => parts.filter(p => {
    if (cat !== "all" && p.category !== cat) return false;
    if (warehouse !== "all" && p.warehouse !== warehouse) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.nameAr.includes(q))) return false;
    }
    return true;
  }), [cat, warehouse, q]);

  const totalValue = parts.reduce((s, p) => s + p.unitCostSar * p.qtyOnHand, 0);
  const lowStock = parts.filter(p => p.qtyOnHand <= p.reorderLevel).length;
  const skus = parts.length;
  const avgLead = +(parts.reduce((s, p) => s + p.leadTimeDays, 0) / parts.length).toFixed(1);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.inventory", lang)}
        subtitle={lang === "en" ? "Parts, fluids, tires & equipment across 3 warehouses" : "قطع وسوائل وإطارات ومعدات في 3 مستودعات"}
        actions={
          <>
            <Btn variant="outline"><ShoppingCart className="h-4 w-4" />{lang === "en" ? "Purchase Order" : "أمر شراء"}</Btn>
            <Btn variant="primary"><Plus className="h-4 w-4" />{lang === "en" ? "Add Part" : "إضافة قطعة"}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={lang === "en" ? "SKUs" : "أصناف"} value={skus} tone="info" />
        <Stat label={lang === "en" ? "Inventory Value" : "قيمة المخزون"} value={formatSar(totalValue)} />
        <Stat label={lang === "en" ? "Low Stock Items" : "أصناف منخفضة"} value={lowStock} tone={lowStock > 3 ? "bad" : "warn"} />
        <Stat label={lang === "en" ? "Avg Lead Time" : "متوسط وقت التوريد"} value={`${avgLead} ${lang === "en" ? "days" : "يوم"}`} />
      </div>

      <Card className="!p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder={lang === "en" ? "Search part name, SKU…" : "بحث بالاسم أو الرمز…"}
            className="h-9 px-3 rounded-lg border text-sm flex-1 min-w-[200px]"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          />
          <div className="flex items-center gap-1 flex-wrap">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCat(c)}
                className={cn("h-9 px-2.5 rounded-lg text-[11px] font-medium border capitalize",
                  cat === c ? "bg-brand-600 text-white border-brand-600" : "")}
                style={cat !== c ? { borderColor: "rgb(var(--border))" } : undefined}>
                {c === "all" ? t("common.all", lang) : c}
              </button>
            ))}
          </div>
          <select value={warehouse} onChange={e => setWarehouse(e.target.value)}
            className="h-9 px-3 rounded-lg border text-sm"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}>
            <option value="all">{lang === "en" ? "All Warehouses" : "كل المستودعات"}</option>
            {["Riyadh", "Jeddah", "Dammam"].map(w => <option key={w}>{w}</option>)}
          </select>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>SKU</TH>
              <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
              <TH>{lang === "en" ? "Category" : "الفئة"}</TH>
              <TH>{lang === "en" ? "Warehouse" : "المستودع"}</TH>
              <TH>{lang === "en" ? "On Hand" : "المتوفر"}</TH>
              <TH>{lang === "en" ? "Reorder Level" : "حد إعادة الطلب"}</TH>
              <TH>{lang === "en" ? "Unit Cost" : "تكلفة الوحدة"}</TH>
              <TH>{lang === "en" ? "Total Value" : "القيمة الإجمالية"}</TH>
              <TH>{lang === "en" ? "Lead Time" : "وقت التوريد"}</TH>
              <TH>{lang === "en" ? "Supplier" : "المورد"}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {list.map(p => {
              const low = p.qtyOnHand <= p.reorderLevel;
              const stockPct = (p.qtyOnHand / Math.max(1, p.reorderLevel * 3)) * 100;
              return (
                <tr key={p.id} className={cn("hover:bg-black/[0.02] dark:hover:bg-white/[0.03]", low ? "bg-rose-500/[0.04]" : "")}>
                  <TD className="font-mono text-xs">{p.sku}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 muted" />
                      <div>
                        <div className="font-medium">{lang === "ar" ? p.nameAr : p.name}</div>
                        <div className="text-[11px] muted">{lang === "ar" ? p.name : p.nameAr}</div>
                      </div>
                    </div>
                  </TD>
                  <TD className="capitalize">{p.category}</TD>
                  <TD>{p.warehouse}</TD>
                  <TD>
                    <div className="w-28">
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className={cn("tabular-nums font-semibold", low ? "text-rose-600" : "")}>{p.qtyOnHand} {p.unit}</span>
                        {low && <AlertTriangle className="h-3 w-3 text-rose-500" />}
                      </div>
                      <Bar value={stockPct} tone={low ? "bad" : stockPct > 60 ? "ok" : "warn"} />
                    </div>
                  </TD>
                  <TD className="tabular-nums">{p.reorderLevel}</TD>
                  <TD className="tabular-nums">{formatSar(p.unitCostSar)}</TD>
                  <TD className="tabular-nums font-medium">{formatSar(p.unitCostSar * p.qtyOnHand)}</TD>
                  <TD className="tabular-nums">{p.leadTimeDays} {lang === "en" ? "d" : "ي"}</TD>
                  <TD className="text-xs muted">{p.supplier}</TD>
                  <TD>
                    {low ? (
                      <Btn variant="primary"><ShoppingCart className="h-3.5 w-3.5" />{lang === "en" ? "Reorder" : "إعادة طلب"}</Btn>
                    ) : (
                      <Btn variant="outline">{lang === "en" ? "View" : "عرض"}</Btn>
                    )}
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Section title={lang === "en" ? "Reorder Suggestions" : "اقتراحات إعادة الطلب"}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {parts.filter(p => p.qtyOnHand <= p.reorderLevel).map(p => (
            <div key={p.id} className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-rose-500" />
                <span className="font-mono text-xs">{p.sku}</span>
              </div>
              <div className="font-medium text-sm">{lang === "ar" ? p.nameAr : p.name}</div>
              <div className="text-xs muted">{p.warehouse} · {p.supplier}</div>
              <div className="text-xs mt-2 flex items-center justify-between">
                <span className="muted">{lang === "en" ? "Reorder qty" : "كمية الطلب"}: <b>{p.reorderQty} {p.unit}</b></span>
                <span className="font-semibold tabular-nums">{formatSar(p.reorderQty * p.unitCostSar)}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
