// Reusable HTML component builders (return strings).
window.UI = (function () {
  function fmtNum(n, digits = 0) {
    if (n == null) return "—";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
  }
  function fmtSar(n) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " " + T("c.sar");
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toneFor(status) {
    if (["active","on_duty","delivered","completed"].includes(status)) return "ok";
    if (["idle","scheduled","loading","off_duty","info"].includes(status)) return "info";
    if (["maintenance","in_progress","awaiting_parts","warning","training","in_transit"].includes(status)) return "warn";
    if (["out_of_service","cancelled","critical"].includes(status)) return "bad";
    return "muted";
  }

  function pageHeader({ title, subtitle, actions }) {
    return `
      <div class="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="muted text-sm mt-1">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        ${actions ? `<div class="flex items-center gap-2 flex-wrap">${actions}</div>` : ""}
      </div>`;
  }

  function stat({ label, value, sub, tone }) {
    const t = tone === "ok" ? "text-emerald-600" :
              tone === "warn" ? "text-amber-600" :
              tone === "bad" ? "text-rose-600" :
              tone === "info" ? "text-brand-600" : "";
    return `
      <div class="card p-4">
        <div class="text-xs muted uppercase tracking-wide">${escapeHtml(label)}</div>
        <div class="text-2xl font-semibold mt-1 tabular ${t}">${value}</div>
        ${sub ? `<div class="text-xs muted mt-1">${escapeHtml(sub)}</div>` : ""}
      </div>`;
  }

  function pill(status, label) {
    return `<span class="pill pill-${toneFor(status)}"><span class="dot"></span>${escapeHtml(label)}</span>`;
  }

  function bar(value, max = 100, tone = "auto") {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    let c = "#0b7eea";
    if (tone === "auto") c = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#f43f5e";
    else if (tone === "ok") c = "#10b981";
    else if (tone === "warn") c = "#f59e0b";
    else if (tone === "bad") c = "#f43f5e";
    return `<div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${c}"></div></div>`;
  }

  function btn({ label, icon, variant = "default", onclick, cls }) {
    return `<button class="btn btn-${variant} ${cls || ''}" ${onclick ? `onclick="${onclick}"` : ""}>${icon || ""}${escapeHtml(label)}</button>`;
  }

  function section({ title, action, body }) {
    return `
      <div class="card p-4">
        <div class="flex items-center justify-between mb-3 gap-2">
          <h3 class="font-semibold text-sm">${escapeHtml(title)}</h3>
          ${action || ""}
        </div>
        ${body}
      </div>`;
  }

  return { fmtNum, fmtSar, escapeHtml, toneFor, pageHeader, stat, pill, bar, btn, section };
})();
