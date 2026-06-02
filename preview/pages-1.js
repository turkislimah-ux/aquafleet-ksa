// Pages: Dashboard, Fleet (list), Fleet Detail, Drivers, Trips, Routes
window.PAGES_1 = (function () {
  const { fmtNum, fmtSar, escapeHtml, toneFor, pageHeader, stat, pill, bar, btn, section } = UI;
  const D = () => window.DATA;
  const lang = () => window.APP_STATE.lang;
  const depotLabel = (d) => T(`depot.${d}`);

  // ---- Driver detail (small drawer-modal) ----
  window.DRV = {
    setTab(v) { window.APP_STATE.driversTab = v; window.app.render(); },

    /** Show the full driver profile in a modal with quick links. */
    openDriver(driverId) {
      const d = D().findDriver(driverId);
      if (!d) return;
      const truck = d.assignedTruckId ? D().findTruck(d.assignedTruckId) : null;
      const driverTrips = D().trips.filter(t => t.driverId === driverId).slice(-6).reverse();
      const com = D().findCommission(driverId, D().CURRENT_MONTH_KEY);
      const expSoon = new Date(d.licenseExpiry) < new Date(2026, 11, 31);

      const tripsHTML = driverTrips.length === 0
        ? `<p class="muted text-sm">${T("c.noTrips")}</p>`
        : driverTrips.map(tr => `
            <div class="py-2 border-t border-app first:border-0">
              <div class="flex justify-between gap-2">
                <div class="font-medium text-sm">${tr.ref} → ${escapeHtml(lang()==='ar'?tr.destination.nameAr:tr.destination.name)}</div>
                ${pill(tr.status, T(`status.${tr.status}`))}
              </div>
              <div class="text-xs muted">${fmtNum(tr.waterLiters)} L · ${tr.distanceKm} km · ${new Date(tr.scheduledStart).toLocaleDateString()}</div>
            </div>`).join("");

      const html = `
        <div class="space-y-4">
          <!-- Identity strip -->
          <div class="card p-3 flex items-center gap-3">
            <div class="h-12 w-12 rounded-full text-white grid place-items-center font-semibold text-lg" style="background:#0c66bf">${initials(d.name)}</div>
            <div class="flex-1">
              <div class="font-semibold">${escapeHtml(lang()==='ar'?d.nameAr:d.name)}</div>
              <div class="text-xs muted">${d.id} · ${depotLabel(d.homeDepot)}</div>
            </div>
            <div>${pill(d.status, T(`status.${d.status}`))}</div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <!-- Contact & ID -->
            <div class="card p-3">
              <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.phone()}${T("drv.contact")}</h4>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div><div class="field-label">${T("drv.phone")}</div><div>${escapeHtml(d.phone)}</div></div>
                <div><div class="field-label">${T("drv.iqama")}</div><div class="font-mono text-xs">${d.iqama}</div></div>
                <div><div class="field-label">${T("c.licenseExp")}</div><div class="${expSoon ? 'text-amber-600 font-medium' : ''}">${d.licenseExpiry}</div></div>
                <div><div class="field-label">${T("drv.hireDate")}</div><div>${d.hireDate}</div></div>
              </div>
            </div>

            <!-- Employment -->
            <div class="card p-3">
              <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.shield()}${T("drv.employment")}</h4>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div><div class="field-label">${T("c.safetyScore")}</div><div class="font-semibold tabular">${d.safetyScore}</div></div>
                <div><div class="field-label">${T("c.rating")}</div><div class="flex items-center gap-1"><span style="color:#f59e0b">${ICONS.star()}</span><span class="font-semibold">${d.rating}</span></div></div>
                <div><div class="field-label">${T("c.trips30d")}</div><div class="font-semibold tabular">${d.trips30d}</div></div>
                <div><div class="field-label">${T("drv.hoursWk")}</div><div class="font-semibold tabular">${d.hoursThisWeek}</div></div>
                <div><div class="field-label">${T("c.incidents")} (12mo)</div><div class="${d.incidents12mo > 0 ? 'text-rose-600 font-semibold' : 'font-semibold'}">${d.incidents12mo}</div></div>
              </div>
            </div>
          </div>

          <!-- Assignment -->
          <div class="card p-3">
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.truck()}${T("drv.assignment")}</h4>
            ${truck ? `
              <div class="flex items-center gap-3 text-sm">
                <div class="h-10 w-10 rounded-lg grid place-items-center" style="background:rgba(11,126,234,.12); color:#0b7eea">${ICONS.truck()}</div>
                <div class="flex-1">
                  <div class="font-medium">
                    <a class="text-brand-600 cursor-pointer" onclick="window.app.closeModal(); window.app.navigate('/fleet/${truck.id}')">${truck.id}</a>
                    · ${escapeHtml(lang()==='ar'?truck.plateAr:truck.plate)}
                  </div>
                  <div class="text-xs muted">${escapeHtml(truck.model)} · ${depotLabel(truck.homeDepot)}</div>
                </div>
                <div class="text-xs">${pill(truck.status, T(`status.${truck.status}`))}</div>
              </div>` : `<p class="muted text-sm">${T("drv.noAssignedTruck")}</p>`}
          </div>

          <!-- Recent trips -->
          <div class="card p-3">
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.route()}${T("drv.recentTrips")}</h4>
            ${tripsHTML}
          </div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        ${com ? `<button class="btn btn-primary" onclick="window.app.closeModal(); window.APP_STATE.driversTab='commissions'; window.app.render(); setTimeout(() => COM.openBreakdown('${driverId}'), 60)">${ICONS.money()}${T("drv.openCommission")}</button>` : ""}
      `;
      window.app.openModal({ title: `${T("drv.viewDriver")} — ${escapeHtml(lang()==='ar'?d.nameAr:d.name)}`, html, size: "lg", footer });
    },
  };

  // ---- Driver commissions module ----
  window.COM = {
    // Filter state lives directly on APP_STATE
    setFilter(v) { window.APP_STATE.comFilter = v; window.app.render(); },
    setMonth(v) { window.APP_STATE.comMonth = v; window.app.render(); },

    /** Render the commissions section (used as the body of the Commissions tab). */
    section() {
      const filter = window.APP_STATE.comFilter || "all"; // all | pending | approved | paid
      const monthKey = window.APP_STATE.comMonth || D().CURRENT_MONTH_KEY;
      const months = D().COMMISSION_MONTHS;
      const monthMeta = months.find(m => m.key === monthKey) || months[months.length - 1];
      const isCurrentMonth = monthKey === D().CURRENT_MONTH_KEY;
      const all = D().commissionsForMonth(monthKey);
      const list = filter === "all" ? all : all.filter(c => c.payoutStatus === filter);

      const totals = all.reduce((acc, c) => {
        const t = D().commissionTotal(c);
        acc.total += t;
        if (c.payoutStatus === "paid") acc.paid += t;
        else if (c.payoutStatus === "approved") acc.approved += t;
        else acc.pending += t;
        return acc;
      }, { total: 0, paid: 0, approved: 0, pending: 0 });
      const avg = totals.total / Math.max(1, all.length);

      return `
        <div class="card p-4 mb-5">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span class="text-emerald-600">${ICONS.money()}</span>
              <div>
                <h3 class="font-semibold">${T("com.commissions")}</h3>
                <p class="text-xs muted">${escapeHtml(lang()==='ar'?monthMeta.labelAr:monthMeta.labelEn)} ${isCurrentMonth ? `· <span class="text-brand-600">${T("com.monthCurrent")}</span>` : `· <span class="muted">${T("com.monthClosed")}</span>`}</p>
              </div>
            </div>
            <div class="com-toolbar">
              <div class="com-month">
                <span class="muted text-xs">${T("com.month")}:</span>
                <select class="select" onchange="COM.setMonth(this.value)">
                  ${months.slice().reverse().map(m => `<option value="${m.key}" ${m.key === monthKey ? 'selected' : ''}>${escapeHtml(lang()==='ar'?m.labelAr:m.labelEn)}</option>`).join("")}
                </select>
              </div>
              <div class="flex items-center gap-1 flex-wrap">
                ${["all","pending","approved","paid"].map(s => {
                  const label = s === "all" ? T("c.all") : T(`com.${s}`);
                  const count = s === "all" ? all.length : all.filter(c => c.payoutStatus === s).length;
                  return `<button class="btn-chip ${filter===s?'active':''}" onclick="COM.setFilter('${s}')">${label} <span class="muted ms-1">${count}</span></button>`;
                }).join("")}
              </div>
              <button class="btn btn-outline" onclick="window.app.toast('${lang()==='en' ? 'CSV export (demo)' : 'تصدير CSV (تجريبي)'}')">${ICONS.download()}${T("com.exportCsv")}</button>
            </div>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            ${stat({ label: T("com.payoutPool"), value: fmtSar(totals.total), tone: "info" })}
            ${stat({ label: T("com.paidOut"), value: fmtSar(totals.paid), tone: "ok" })}
            ${stat({ label: T("com.pendingApproval"), value: fmtSar(totals.pending), tone: "warn" })}
            ${stat({ label: T("com.avgDriver"), value: fmtSar(avg) })}
          </div>

          <div class="overflow-x-auto scroll-thin">
            <table class="tbl">
              <thead><tr>
                <th>${T("com.driver")}</th>
                <th>${T("com.baseProjects")}</th>
                <th>${T("com.specials")}</th>
                <th>${T("com.adjustments")}</th>
                <th>${T("com.monthTotal")}</th>
                <th>${T("com.payoutStatus")}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${list.length === 0 ? `<tr><td colspan="7" class="text-center muted py-6">${T("com.noCommissionRow")}</td></tr>` : list.map(c => {
                  const driver = D().findDriver(c.driverId);
                  if (!driver) return "";
                  const base = c.lines.reduce((s, l) => s + l.amountSar, 0);
                  const specials = c.specials.reduce((s, x) => s + x.amountSar, 0);
                  const adj = c.adjustments.reduce((s, a) => s + a.amountSar, 0);
                  const total = D().commissionTotal(c);
                  const tripsTotal = c.lines.reduce((s, l) => s + l.tripsCount, 0);
                  const editable = isCurrentMonth && c.payoutStatus !== "paid";
                  const inlineActions = editable ? `
                    <button class="btn btn-outline" title="${T("com.quickAddSpecial")}" onclick="COM.openSpecialForm('${c.driverId}')">${ICONS.plus()}${T("com.quickAddSpecial")}</button>
                    <button class="btn btn-outline" title="${T("com.quickAdjust")}" onclick="COM.openAdjustForm('${c.driverId}')">${ICONS.edit()}${T("com.quickAdjust")}</button>
                  ` : "";
                  return `
                  <tr>
                    <td>
                      <div class="flex items-center gap-2">
                        <div class="h-8 w-8 rounded-full text-white grid place-items-center text-xs font-semibold" style="background:#0c66bf">${initials(driver.name)}</div>
                        <div>
                          <div class="font-medium">${escapeHtml(lang()==='ar'?driver.nameAr:driver.name)}</div>
                          <div class="text-[11px] muted">${driver.id} · ${depotLabel(driver.homeDepot)}</div>
                        </div>
                      </div>
                    </td>
                    <td class="tabular">
                      <span class="font-medium">${fmtSar(base)}</span>
                      <span class="muted text-[11px] ms-1">(${tripsTotal} ${T("com.tripsCount").toLowerCase()} · ${c.lines.length} ${lang()==='en'?'projects':'مشاريع'})</span>
                    </td>
                    <td class="tabular">${specials > 0 ? `<span class="text-emerald-600 font-medium">+${fmtSar(specials)}</span>` : '<span class="muted">—</span>'}</td>
                    <td class="tabular">${adj !== 0 ? `<span class="${adj>0?'text-emerald-600':'text-rose-600'} font-medium">${adj>0?'+':''}${fmtSar(adj)}</span>` : '<span class="muted">—</span>'}</td>
                    <td class="tabular font-semibold text-brand-600">${fmtSar(total)}</td>
                    <td>${pill(c.payoutStatus === "paid" ? "active" : c.payoutStatus === "approved" ? "info" : "warning", T(`com.${c.payoutStatus}`))}</td>
                    <td>
                      <div class="row-actions">
                        ${inlineActions}
                        ${btn({ label: T("com.viewBreakdown"), icon: ICONS.eye(), variant: "outline", onclick: `COM.openBreakdown('${c.driverId}')` })}
                      </div>
                    </td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>

          <div class="text-[11px] muted mt-3 leading-relaxed">${T("com.commissionRules")}</div>
        </div>`;
    },

    /** Open the full breakdown modal for a single driver (in the currently
     *  selected month). Read-only when the month is closed or already paid. */
    openBreakdown(driverId) {
      const monthKey = window.APP_STATE.comMonth || D().CURRENT_MONTH_KEY;
      const c = D().findCommission(driverId, monthKey);
      const driver = D().findDriver(driverId);
      if (!c || !driver) {
        window.app.toast(T("com.noCommissionRow"));
        return;
      }
      const editable = monthKey === D().CURRENT_MONTH_KEY && c.payoutStatus !== "paid";

      const base = c.lines.reduce((s, l) => s + l.amountSar, 0);
      const specials = c.specials.reduce((s, x) => s + x.amountSar, 0);
      const adj = c.adjustments.reduce((s, a) => s + a.amountSar, 0);
      const total = D().commissionTotal(c);

      const ro = editable ? "" : "disabled";
      const linesHTML = c.lines.length === 0
        ? `<p class="muted text-sm">${lang()==='en'?'No delivered trips for this driver this period.':'لا توجد رحلات مسلَّمة في هذه الفترة.'}</p>`
        : c.lines.map(l => {
            const project = D().findProject(l.projectId);
            return `
              <div class="rounded-lg border border-app p-3 flex items-center gap-3 flex-wrap">
                <div class="flex-1 min-w-[180px]">
                  <div class="font-medium text-sm">${escapeHtml(lang()==='ar'?project.nameAr:project.name)}</div>
                  <div class="text-[11px] muted">${project.id}</div>
                </div>
                <div class="text-xs">
                  <label class="field-label">${T("com.tripsCount")}</label>
                  <input type="number" min="0" class="input" style="width:6rem" id="cl-trips-${l.id}" value="${l.tripsCount}" ${ro}/>
                </div>
                <div class="text-xs">
                  <label class="field-label">${T("com.ratePerTripLbl")} (${T("c.sar")})</label>
                  <input type="number" min="0" step="0.5" class="input" style="width:7rem" id="cl-rate-${l.id}" value="${l.ratePerTrip}" ${ro}/>
                </div>
                <div class="text-xs">
                  <label class="field-label">${T("com.lineTotal")}</label>
                  <div class="font-semibold tabular" id="cl-total-${l.id}">${fmtSar(l.amountSar)}</div>
                </div>
                ${editable ? `<button class="btn btn-outline" onclick="COM.saveLine('${driverId}','${l.id}')">${ICONS.save()}${T("com.saveRow")}</button>` : ""}
              </div>`;
          }).join("");

      const specialsHTML = c.specials.length === 0
        ? `<p class="muted text-sm">${lang()==='en'?'No special trips logged.':'لا توجد رحلات خاصة مسجَّلة.'}</p>`
        : c.specials.map(sp => `
            <div class="rounded-lg border border-app p-3 flex items-center gap-3 flex-wrap">
              <div class="flex-1 min-w-[200px]">
                <div class="font-medium text-sm flex items-center gap-2">
                  ${sp.isSpecialTrip ? `<span class="pill pill-info" style="height:1.05rem; padding:0 .4rem; font-size:.6rem"><span class="dot"></span>${T("com.isSpecialTrip")}</span>` : ""}
                  ${escapeHtml(lang()==='ar'?sp.labelAr:sp.label)}
                </div>
                <div class="text-[11px] muted">${sp.date} · ${escapeHtml(sp.note || "")}</div>
              </div>
              <div class="text-emerald-600 font-semibold tabular">+${fmtSar(sp.amountSar)}</div>
              ${editable ? `<button class="icon-btn" onclick="COM.removeSpecial('${driverId}','${sp.id}')" title="${T("c.delete")}" style="color:#be123c">${ICONS.trash()}</button>` : ""}
            </div>`).join("");

      const adjustmentsHTML = c.adjustments.length === 0
        ? `<p class="muted text-sm">${lang()==='en'?'No adjustments.':'لا توجد تعديلات.'}</p>`
        : c.adjustments.map(a => `
            <div class="rounded-lg border border-app p-3 flex items-center gap-3 flex-wrap">
              <div class="flex-1 min-w-[200px]">
                <div class="font-medium text-sm">${escapeHtml(a.label)}</div>
                <div class="text-[11px] muted">${a.date || ""} ${a.note ? "· " + escapeHtml(a.note) : ""}</div>
              </div>
              <div class="${a.amountSar > 0 ? 'text-emerald-600' : 'text-rose-600'} font-semibold tabular">${a.amountSar > 0 ? '+' : ''}${fmtSar(a.amountSar)}</div>
              ${editable ? `<button class="icon-btn" onclick="COM.removeAdjustment('${driverId}','${a.id}')" title="${T("c.delete")}" style="color:#be123c">${ICONS.trash()}</button>` : ""}
            </div>`).join("");

      const monthMeta = D().COMMISSION_MONTHS.find(m => m.key === monthKey);
      const monthLbl = monthMeta ? (lang()==='ar' ? monthMeta.labelAr : monthMeta.labelEn) : monthKey;
      const banner = editable ? "" : `
        <div class="rounded-lg p-3 text-xs flex items-start gap-2" style="background:rgba(100,116,139,.10); border:1px solid rgb(var(--border))">
          <span class="muted mt-0.5">${ICONS.info()}</span>
          <span>${T("com.monthClosed")} — ${escapeHtml(monthLbl)}</span>
        </div>`;

      const html = `
        <div class="space-y-4">
          ${banner}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="card p-3">
              <div class="field-label">${T("com.driver")}</div>
              <div class="font-medium">${escapeHtml(lang()==='ar'?driver.nameAr:driver.name)}</div>
              <div class="text-[11px] muted">${driver.id} · ${depotLabel(driver.homeDepot)}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("com.baseProjects")}</div>
              <div class="text-lg font-semibold tabular">${fmtSar(base)}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("com.specials")} + ${T("com.adjustments")} + ${T("com.bonus")}</div>
              <div class="text-lg font-semibold tabular ${specials+adj+c.bonusSar>0?'text-emerald-600':''}">${fmtSar(specials + adj + c.bonusSar)}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("com.monthTotal")}</div>
              <div class="text-lg font-semibold tabular text-brand-600">${fmtSar(total)}</div>
              <div class="text-[10px] muted mt-0.5">${escapeHtml(monthLbl)}</div>
            </div>
          </div>

          <div>
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.list()}${T("com.projectsRates")}</h4>
            <div class="space-y-2">${linesHTML}</div>
            <div class="text-[11px] muted mt-2">${T("com.commissionRules")}</div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-semibold text-sm">${T("com.specials")}</h4>
              ${editable ? `<button class="btn btn-outline" onclick="COM.openSpecialForm('${driverId}')">${ICONS.plus()}${T("com.addSpecial")}</button>` : ""}
            </div>
            <div class="space-y-2">${specialsHTML}</div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-semibold text-sm">${T("com.adjustments")}</h4>
              ${editable ? `<button class="btn btn-outline" onclick="COM.openAdjustForm('${driverId}')">${ICONS.plus()}${T("com.addAdjustment")}</button>` : ""}
            </div>
            <div class="space-y-2">${adjustmentsHTML}</div>
          </div>

          <div class="card p-3 flex items-center gap-3 flex-wrap">
            <div class="flex-1">
              <div class="font-semibold text-sm">${T("com.bonus")}</div>
              <div class="text-[11px] muted">${lang()==='en'?'Manager-discretionary monthly bonus.':'مكافأة شهرية تقديرية من الإدارة.'}</div>
            </div>
            <input type="number" min="0" step="50" class="input" style="width:8rem" id="cm-bonus" value="${c.bonusSar}" ${ro}/>
            ${editable ? `<button class="btn btn-outline" onclick="COM.saveBonus('${driverId}')">${ICONS.save()}${T("com.setBonus")}</button>` : ""}
          </div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        ${editable && c.payoutStatus === "pending" ? `<button class="btn btn-outline" onclick="COM.setStatus('${driverId}','approved')">${ICONS.check()}${T("com.approve")}</button>` : ""}
        ${editable && c.payoutStatus !== "paid" ? `<button class="btn btn-primary" onclick="COM.setStatus('${driverId}','paid')">${ICONS.money()}${T("com.markPaid")}</button>` : ""}
      `;

      window.app.openModal({ title: `${T("com.breakdownTitle")} — ${escapeHtml(lang()==='ar'?driver.nameAr:driver.name)}`, html, size: "lg", footer });
    },

    _activeMonth() { return window.APP_STATE.comMonth || D().CURRENT_MONTH_KEY; },

    saveLine(driverId, lineId) {
      const c = D().findCommission(driverId, this._activeMonth());
      const line = c && c.lines.find(l => l.id === lineId);
      if (!line) return;
      const trips = parseInt(document.getElementById(`cl-trips-${lineId}`).value, 10) || 0;
      const rate = parseFloat(document.getElementById(`cl-rate-${lineId}`).value) || 0;
      line.tripsCount = trips;
      line.ratePerTrip = rate;
      line.amountSar = trips * rate;
      line.manual = true;
      window.app.toast(`${line.projectId}: ${trips} × ${fmtSar(rate)} = ${fmtSar(line.amountSar)}`);
      this.openBreakdown(driverId);
    },

    openSpecialForm(driverId) {
      const today = "2026-05-13";
      const html = `
        <div class="space-y-3">
          <div><label class="field-label">${T("com.specialLabel")}</label>
            <input class="input w-full" id="sp-label" placeholder="${lang()==='en'?'e.g. Emergency desert run':'مثال: رحلة طوارئ صحراوية'}"/></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("com.specialAmount")}</label>
              <input type="number" min="0" step="10" class="input w-full" id="sp-amount" value="250"/></div>
            <div><label class="field-label">${T("com.specialDate")}</label>
              <input type="date" class="input w-full" id="sp-date" value="${today}"/></div>
          </div>
          <div><label class="field-label">${T("com.specialNote")}</label>
            <input class="input w-full" id="sp-note"/></div>
          <label class="flex items-center gap-2 text-sm muted">
            <input type="checkbox" id="sp-isTrip" checked/> <span>${T("com.isSpecialTrip")}</span>
          </label>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="COM.openBreakdown('${driverId}')">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="COM.saveSpecial('${driverId}')">${ICONS.save()}${T("com.addRow")}</button>`;
      window.app.openModal({ title: T("com.addSpecial"), html, footer });
    },

    saveSpecial(driverId) {
      const c = D().findCommission(driverId, this._activeMonth());
      if (!c) return;
      const label = document.getElementById("sp-label").value.trim() || (lang()==='en'?"Special trip":"رحلة خاصة");
      const amount = parseFloat(document.getElementById("sp-amount").value) || 0;
      const date = document.getElementById("sp-date").value || "";
      const note = document.getElementById("sp-note").value || "";
      const isTrip = !!document.getElementById("sp-isTrip") && document.getElementById("sp-isTrip").checked;
      if (amount <= 0) { window.app.toast(lang()==='en'?"Enter a valid amount":"أدخل مبلغًا صحيحًا"); return; }
      c.specials.push({
        id: `CS-${driverId}-${c.specials.length + 1}-${Date.now().toString(36)}`,
        label, labelAr: label,
        amountSar: amount, date, manual: true, note: note || "Manual entry",
        isSpecialTrip: isTrip,
      });
      window.app.toast(`+${fmtSar(amount)} → ${driverId}`);
      this.openBreakdown(driverId);
    },

    removeSpecial(driverId, sid) {
      const c = D().findCommission(driverId, this._activeMonth());
      if (!c) return;
      c.specials = c.specials.filter(x => x.id !== sid);
      window.app.toast(lang()==='en'?"Special removed":"تم الحذف");
      this.openBreakdown(driverId);
    },

    openAdjustForm(driverId) {
      const today = "2026-05-13";
      const html = `
        <div class="space-y-3">
          <p class="text-xs muted">${lang()==='en'?'Use positive amounts to add, negative to deduct (e.g., uniform deduction).':'استخدم قيمة موجبة للإضافة وسالبة للخصم (مثال: خصم زي العمل).'}</p>
          <div><label class="field-label">${T("com.specialLabel")}</label>
            <input class="input w-full" id="ad-label" placeholder="${lang()==='en'?'e.g. Uniform deduction':'مثال: خصم زي العمل'}"/></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("com.specialAmount")}</label>
              <input type="number" step="10" class="input w-full" id="ad-amount" value="-100"/></div>
            <div><label class="field-label">${T("com.specialDate")}</label>
              <input type="date" class="input w-full" id="ad-date" value="${today}"/></div>
          </div>
          <div><label class="field-label">${T("com.specialNote")}</label>
            <input class="input w-full" id="ad-note"/></div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="COM.openBreakdown('${driverId}')">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="COM.saveAdjust('${driverId}')">${ICONS.save()}${T("com.addRow")}</button>`;
      window.app.openModal({ title: T("com.addAdjustment"), html, footer });
    },

    saveAdjust(driverId) {
      const c = D().findCommission(driverId, this._activeMonth());
      if (!c) return;
      const label = document.getElementById("ad-label").value.trim() || (lang()==='en'?"Adjustment":"تعديل");
      const amount = parseFloat(document.getElementById("ad-amount").value);
      const date = document.getElementById("ad-date").value || "";
      const note = document.getElementById("ad-note").value || "";
      if (!isFinite(amount) || amount === 0) { window.app.toast(lang()==='en'?"Enter a non-zero amount":"أدخل قيمة غير صفرية"); return; }
      c.adjustments.push({
        id: `CA-${driverId}-${c.adjustments.length + 1}-${Date.now().toString(36)}`,
        label, amountSar: amount, date, note,
      });
      window.app.toast(`${amount > 0 ? "+" : ""}${fmtSar(amount)} → ${driverId}`);
      this.openBreakdown(driverId);
    },

    removeAdjustment(driverId, aid) {
      const c = D().findCommission(driverId, this._activeMonth());
      if (!c) return;
      c.adjustments = c.adjustments.filter(a => a.id !== aid);
      window.app.toast(lang()==='en'?"Adjustment removed":"تم الحذف");
      this.openBreakdown(driverId);
    },

    saveBonus(driverId) {
      const c = D().findCommission(driverId, this._activeMonth());
      if (!c) return;
      const bonus = parseFloat(document.getElementById("cm-bonus").value) || 0;
      c.bonusSar = bonus;
      window.app.toast(`${T("com.bonus")}: ${fmtSar(bonus)}`);
      this.openBreakdown(driverId);
    },

    setStatus(driverId, status) {
      const c = D().findCommission(driverId, this._activeMonth());
      if (!c) return;
      c.payoutStatus = status;
      window.app.toast(`${driverId} → ${T(`com.${status}`)}`);
      this.openBreakdown(driverId);
    },
  };

  // ---------- Dashboard ----------
  function dashboard() {
    const k = D().fleetKpis();
    const openWO = D().workOrders.filter(w => w.status !== "completed" && w.status !== "cancelled").length;
    const critical = D().predictiveAlerts.filter(a => a.severity === "critical").length;
    const onDuty = D().drivers.filter(d => d.status === "on_duty").length;

    const liveTrips = D().trips.filter(t => t.status === "in_transit" || t.status === "loading").slice(0, 5);
    const topAlerts = D().predictiveAlerts.slice(0, 5);

    setTimeout(() => {
      drawAreaChart("litersChart", lastNDays(14), Array.from({length: 14}, (_,i) => 90000 + ((i*7919)%60000)), { color: "#0b7eea" });
      drawPie("fleetPie", [
        { label: T("status.active"), value: k.active, color: "#10b981" },
        { label: T("status.idle"), value: k.idle, color: "#3b82f6" },
        { label: T("status.maintenance"), value: k.maint, color: "#f59e0b" },
        { label: T("status.out_of_service"), value: k.oos, color: "#ef4444" },
      ]);
      drawDualBar("tripsChart", lastNDays(14),
        Array.from({length: 14}, (_,i) => 22 + ((i*13)%14)),
        Array.from({length: 14}, (_,i) => 18 + ((i*7)%9)),
        { c1: "#0b7eea", c2: "#f59e0b", l1: T("c.trips"), l2: T("c.fuel") + " (L×100)" });
    }, 0);

    return `
      ${pageHeader({
        title: T("nav.dashboard"),
        subtitle: T("c.period"),
        actions: btn({ label: T("c.liveIoT"), icon: ICONS.activity(), variant: "outline" })
                + btn({ label: T("c.newTrip"), icon: ICONS.plus(), variant: "primary", onclick: "alert('Demo: open new trip wizard')" }),
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
        ${stat({ label: T("kpi.activeTrucks"), value: `${k.active}/${D().trucks.length}`, sub: `${k.maint} ${T("status.maintenance")}`, tone: "ok" })}
        ${stat({ label: T("kpi.utilization"), value: `${k.utilization}%`, sub: lang() === "en" ? "30-day avg" : "متوسط 30 يوم", tone: "info" })}
        ${stat({ label: T("kpi.avgHealth"), value: k.avgHealth, sub: lang() === "en" ? "out of 100" : "من 100", tone: k.avgHealth > 75 ? "ok" : "warn" })}
        ${stat({ label: T("kpi.onTime"), value: `${k.onTimePct}%`, sub: lang() === "en" ? "on schedule" : "في الموعد", tone: "ok" })}
        ${stat({ label: T("kpi.openWO"), value: openWO, sub: lang() === "en" ? "active work orders" : "نشطة", tone: "warn" })}
        ${stat({ label: T("kpi.criticalAlerts"), value: critical, sub: lang() === "en" ? "predictive AI" : "ذكاء تنبؤي", tone: "bad" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div class="lg:col-span-2 card p-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="font-semibold">${T("kpi.litersDelivered")}</h3>
              <p class="text-xs muted">${fmtNum(k.litersDelivered30d)} ${lang() === "en" ? "liters · 30 days" : "لتر · 30 يوم"}</p>
            </div>
            <div class="text-emerald-600 text-xs flex items-center gap-1">${ICONS.trendUp()} +12.4%</div>
          </div>
          <div class="h-64"><canvas id="litersChart"></canvas></div>
        </div>
        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("c.fleetStatus")}</h3>
          <div class="h-52"><canvas id="fleetPie"></canvas></div>
          <div class="space-y-1.5 mt-2 text-xs">
            ${legendRow("#10b981", T("status.active"), k.active)}
            ${legendRow("#3b82f6", T("status.idle"), k.idle)}
            ${legendRow("#f59e0b", T("status.maintenance"), k.maint)}
            ${legendRow("#ef4444", T("status.out_of_service"), k.oos)}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div class="card p-4 lg:col-span-2">
          <h3 class="font-semibold mb-3">${T("c.dailyTrips")}</h3>
          <div class="h-56"><canvas id="tripsChart"></canvas></div>
        </div>
        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("c.operatingCost")}</h3>
          <div class="text-2xl font-semibold tabular">${fmtSar(k.opCost30d)}</div>
          <p class="text-xs muted mb-4 flex items-center gap-1">${ICONS.trendDown()} -4.8% ${lang() === "en" ? "vs last period" : "مقابل الفترة السابقة"}</p>
          <div class="space-y-2">
            ${costRow("Fuel", 142000, 142000)}
            ${costRow("Maintenance", 58000, 142000)}
            ${costRow("Drivers", 96000, 142000)}
            ${costRow("Parts", 31000, 142000)}
            ${costRow("Other", 18000, 142000)}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        ${section({
          title: T("c.criticalPredAlerts"),
          action: `<a class="text-brand-600 text-xs font-medium cursor-pointer" onclick="window.app.navigate('/predictive')">${T("c.viewAll")} →</a>`,
          body: topAlerts.map(a => alertRow(a)).join(""),
        })}
        ${section({
          title: T("c.liveTrips"),
          action: `<a class="text-brand-600 text-xs font-medium cursor-pointer" onclick="window.app.navigate('/trips')">${T("c.viewAll")} →</a>`,
          body: liveTrips.map(tr => tripRow(tr)).join(""),
        })}
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${stat({ label: T("kpi.todayTrips"), value: k.todayTrips, sub: lang() === "en" ? "scheduled today" : "مجدولة اليوم" })}
        ${stat({ label: T("c.driverOnDuty"), value: `${onDuty}/${D().drivers.length}`, tone: "ok" })}
        ${stat({ label: T("kpi.fuelCost"), value: fmtSar(k.fuelCost30d), tone: "warn" })}
        ${stat({ label: T("kpi.revenue"), value: fmtSar(k.revenue30d), tone: "ok" })}
      </div>
    `;
  }

  function legendRow(color, label, value) {
    return `<div class="flex items-center justify-between"><span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full" style="background:${color}"></span>${escapeHtml(label)}</span><span class="font-medium tabular">${value}</span></div>`;
  }
  function costRow(label, value, max) {
    return `<div>
      <div class="flex justify-between text-xs mb-1"><span>${label}</span><span class="font-medium tabular">${fmtSar(value)}</span></div>
      ${bar(value, max, "ok")}
    </div>`;
  }
  function alertRow(a) {
    const t = a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info";
    return `
      <div class="flex items-start gap-3 p-2 rounded-lg hover:bg-black/5">
        <div class="h-8 w-8 rounded-lg grid place-items-center shrink-0" style="background:rgba(${t==='bad'?'244,63,94':t==='warn'?'245,158,11':'59,130,246'},.1); color:${t==='bad'?'#be123c':t==='warn'?'#b45309':'#1d4ed8'}">${ICONS.alert()}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="font-medium text-sm truncate">${escapeHtml(a.truckId)} · ${escapeHtml(lang()==='ar'?a.componentAr:a.component)}</div>
            ${pill(a.severity, T(`status.${a.severity}`))}
          </div>
          <div class="text-xs muted truncate">${escapeHtml(lang()==='ar'?a.recommendedActionAr:a.recommendedAction)}</div>
          <div class="text-[11px] muted mt-0.5">${T("c.failureIn")} ${a.predictedFailureInDays} ${T("c.days")} · ${a.confidencePct}% ${T("c.confidence")}</div>
        </div>
      </div>`;
  }
  function tripRow(tr) {
    return `
      <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5">
        <span class="text-brand-500">${ICONS.droplet()}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="font-medium text-sm truncate">${escapeHtml(tr.ref)}</div>
            ${pill(tr.status, T(`status.${tr.status}`))}
          </div>
          <div class="text-xs muted truncate">${escapeHtml(tr.truckId)} → ${escapeHtml(lang()==='ar'?tr.destination.nameAr:tr.destination.name)}</div>
          <div class="text-[11px] muted">${fmtNum(tr.waterLiters)} L · ${tr.distanceKm} km</div>
        </div>
      </div>`;
  }

  // ---- Fleet handler namespace (Add Truck, Assign Driver) ----
  window.FLEET = {
    /** Format capacity for display: "33 m³". */
    capacity(tr) {
      const m3 = tr.capacityM3 != null ? tr.capacityM3 : Math.round(tr.capacityLiters / 1000);
      return `${m3} ${T("c.cubicMeters")}`;
    },

    /** Format the last-service date with i18n locale (falls back to ISO). */
    lastServiceLabel(tr) {
      if (!tr.lastServiceDate) return "—";
      const d = new Date(tr.lastServiceDate);
      const locale = lang() === "ar" ? "ar-SA-u-ca-gregory" : "en-GB";
      try { return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }); }
      catch { return tr.lastServiceDate; }
    },

    /** Modal: create a new truck. Plate must be unique. Saved to D().trucks. */
    openAddTruck() {
      const nextIdx = D().trucks.length + 1;
      const proposedId = `TRK-${String(nextIdx).padStart(3, "0")}`;
      const html = `
        <div class="space-y-3 add-truck-form">
          <p class="text-sm muted">${lang()==='en'?'Register a new water truck. All fields are required.':'تسجيل شاحنة مياه جديدة. كل الحقول مطلوبة.'}</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("c.truck")} ID</label>
              <input id="atId" class="input w-full" value="${proposedId}" readonly /></div>
            <div><label class="field-label">${T("c.depot")}</label>
              <select id="atDepot" class="select w-full">
                ${D().DEPOTS.map(d => `<option value="${d}">${depotLabel(d)}</option>`).join("")}
              </select></div>
            <div><label class="field-label">${T("c.plateEn")}</label>
              <input id="atPlate" class="input w-full" placeholder="e.g. 5041 ABJ" /></div>
            <div><label class="field-label">${T("c.plateAr")}</label>
              <input id="atPlateAr" class="input w-full" placeholder="مثال: 5041 ا ب ج" /></div>
            <div><label class="field-label">${T("c.truckModel")}</label>
              <input id="atModel" class="input w-full" placeholder="e.g. Mercedes-Benz Actros 3340" /></div>
            <div><label class="field-label">${T("c.truckYear")}</label>
              <input id="atYear" class="input w-full" type="number" min="2010" max="2026" value="2024" /></div>
            <div><label class="field-label">${T("c.pickCapacity")}</label>
              <select id="atCap" class="select w-full">
                ${D().CAPACITY_OPTIONS_M3.map(c => `<option value="${c}">${c} ${T("c.cubicMeters")}</option>`).join("")}
              </select></div>
            <div><label class="field-label">${T("c.fuelType")}</label>
              <select id="atFuel" class="select w-full">
                <option value="diesel">Diesel</option>
                <option value="petrol">Petrol</option>
              </select></div>
            <div><label class="field-label">${T("c.initialOdo")}</label>
              <input id="atOdo" class="input w-full" type="number" min="0" value="0" /></div>
            <div><label class="field-label">${T("c.status")}</label>
              <select id="atStatus" class="select w-full">
                <option value="active">${T("status.active")}</option>
                <option value="maintenance">${T("status.maintenance")}</option>
                <option value="out_of_service">${T("status.out_of_service")}</option>
              </select></div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="FLEET.saveAddTruck()">${ICONS.save()}${T("c.save")}</button>`;
      window.app.openModal({ title: T("c.addTruckTitle"), html, footer });
    },

    saveAddTruck() {
      const get = (id) => document.getElementById(id).value;
      const plate = get("atPlate").trim();
      const plateAr = get("atPlateAr").trim();
      const model = get("atModel").trim();
      if (!plate || !plateAr || !model) {
        window.app.toast(lang()==='en' ? "Plate and model are required" : "اللوحة والموديل مطلوبان");
        return;
      }
      // Reject duplicate plates
      if (D().trucks.some(t => t.plate === plate)) {
        window.app.toast(lang()==='en' ? `Plate ${plate} already exists` : `اللوحة ${plate} موجودة`);
        return;
      }
      const capacityM3 = +get("atCap") || 18;
      const odometer = +get("atOdo") || 0;
      const depot = get("atDepot");
      const status = get("atStatus");
      const today = new Date(2026, 4, 11).toISOString().slice(0, 10);
      const t = {
        id: get("atId"),
        plate, plateAr,
        model, year: +get("atYear") || 2024,
        capacityM3,
        capacityLiters: capacityM3 * 1000,
        tankMaterial: "stainless_steel",
        fuelType: get("atFuel"),
        odometerKm: odometer,
        engineHours: 0,
        status,
        driverId: null,
        homeDepot: depot,
        lastServiceKm: odometer,
        lastServiceDate: today,
        nextServiceKm: odometer + 15000,
        vin: `NEW${Date.now().toString(36).toUpperCase()}`,
        healthScore: 98,
        fuelEfficiencyKmPerL: 3.0,
        utilizationPct: 0,
        acquiredOn: today,
        // Build a baseline IoT snapshot for the new truck (clean readings)
        iot: (function buildClean() {
          const componentsList = D().ENGINE_COMPONENTS;
          const engineComponents = {};
          componentsList.forEach(c => {
            engineComponents[c.key] = { vibrationRms: c.vibBase, soundDb: c.sndBase, condition: "ok" };
          });
          return {
            speedKph: 0, fuelLevelPct: 100, tankLevelPct: 0,
            gps: { lat: D().DEPOT_COORDS[depot][0], lng: D().DEPOT_COORDS[depot][1] },
            engineComponents,
            vibrationRms: componentsList.reduce((s, c) => s + c.vibBase, 0) / componentsList.length,
            lastUpdate: new Date().toISOString(),
          };
        })(),
      };
      D().trucks.push(t);
      window.app.toast(`${t.id} · ${plate} · ${T("status.active")}`);
      window.app.closeModal();
      window.app.render();
    },

    /** Assign / change / unassign the driver of a truck. */
    openAssignDriver(truckId) {
      const truck = D().findTruck(truckId);
      if (!truck) return;
      // A driver is "available" if not assigned to a different truck.
      const driverList = D().drivers.map(d => {
        const otherTruck = D().trucks.find(t => t.driverId === d.id && t.id !== truckId);
        return { d, busyOn: otherTruck };
      });
      const currentDriver = truck.driverId ? D().findDriver(truck.driverId) : null;
      const rows = driverList.map(({ d, busyOn }) => {
        const isSelected = d.id === truck.driverId;
        const label = lang()==='ar' ? d.nameAr : d.name;
        const statusLabel = busyOn
          ? `${T("c.driverBusy")} · ${busyOn.id}`
          : T("c.driverAvailable");
        const tone = busyOn ? "muted" : "ok";
        return `
          <tr class="driver-pick-row ${isSelected ? 'selected' : ''} ${busyOn ? 'busy' : ''}"
              onclick="${busyOn && !isSelected ? '' : `FLEET.saveAssignDriver('${truck.id}','${d.id}')`}">
            <td>
              <div class="flex items-center gap-2">
                <div class="h-7 w-7 rounded-full text-white grid place-items-center text-[10px] font-semibold" style="background:#0c66bf">${initials(d.name)}</div>
                <div>
                  <div class="font-medium text-sm">${escapeHtml(label)}</div>
                  <div class="text-[11px] muted">${d.id} · ${d.homeDepot}</div>
                </div>
              </div>
            </td>
            <td>${pill(d.status, T(`status.${d.status}`))}</td>
            <td class="text-xs ${tone==='muted' ? 'muted' : 'text-emerald-600 font-medium'}">${statusLabel}</td>
            <td class="tabular text-xs">${d.safetyScore}</td>
            <td class="tabular text-xs">${d.trips30d}</td>
            <td>${isSelected ? `<span class="pill pill-ok"><span class="dot"></span>${lang()==='en'?'Current':'الحالي'}</span>` : ''}</td>
          </tr>`;
      }).join("");
      const html = `
        <div class="space-y-3">
          <p class="text-sm muted">${T("c.pickDriver")} · ${truck.id} · ${escapeHtml(lang()==='ar'?truck.plateAr:truck.plate)}</p>
          <div class="overflow-x-auto scroll-thin">
            <table class="tbl">
              <thead><tr>
                <th>${T("c.driver")}</th>
                <th>${T("c.status")}</th>
                <th>${T("c.availableDrivers")}</th>
                <th>${T("c.safetyScore")}</th>
                <th>${T("c.trips30d")}</th>
                <th></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
      const footer = `
        ${currentDriver ? `<button class="btn btn-outline" onclick="FLEET.unassignDriver('${truck.id}')">${T("c.unassign")} · ${escapeHtml(lang()==='ar'?currentDriver.nameAr:currentDriver.name)}</button>` : ''}
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>`;
      window.app.openModal({ title: `${T("c.assignDriver")} — ${truck.id}`, html, footer, size: "lg" });
    },

    saveAssignDriver(truckId, driverId) {
      const truck = D().findTruck(truckId);
      const driver = D().findDriver(driverId);
      if (!truck || !driver) return;
      // Free any other truck currently holding this driver
      D().trucks.forEach(t => { if (t.id !== truckId && t.driverId === driverId) t.driverId = null; });
      truck.driverId = driverId;
      window.app.toast(`${truck.id} ← ${lang()==='ar'?driver.nameAr:driver.name}`);
      window.app.closeModal();
      window.app.render();
    },

    unassignDriver(truckId) {
      const truck = D().findTruck(truckId);
      if (!truck) return;
      truck.driverId = null;
      window.app.toast(`${truck.id} · ${T("c.unassign")}`);
      window.app.closeModal();
      window.app.render();
    },
  };

  // ---------- Fleet ----------
  function fleet() {
    const filters = window.APP_STATE.fleetFilters || { status: "all", depot: "all", q: "" };
    window.APP_STATE.fleetFilters = filters;
    const trucks = D().trucks;

    // Primary KPIs (top-of-page)
    const totalTrucks = trucks.length;
    const activeCount = trucks.filter(t => t.status === "active").length;
    const maintCount  = trucks.filter(t => t.status === "maintenance").length;
    const oosCount    = trucks.filter(t => t.status === "out_of_service").length;
    const totalCapM3  = trucks.reduce((s, t) => s + (t.capacityM3 ?? t.capacityLiters/1000), 0);
    const avgHealth   = +(trucks.reduce((s, t) => s + t.healthScore, 0) / Math.max(1, totalTrucks)).toFixed(1);

    const list = trucks.filter(tr => {
      if (filters.status !== "all" && tr.status !== filters.status) return false;
      if (filters.depot !== "all" && tr.homeDepot !== filters.depot) return false;
      if (filters.q) {
        const s = filters.q.toLowerCase();
        if (!(tr.id.toLowerCase().includes(s) || tr.plate.toLowerCase().includes(s) || tr.model.toLowerCase().includes(s))) return false;
      }
      return true;
    });

    // Only 3 status options now (idle removed)
    const STATUS_OPTIONS = ["all", "active", "maintenance", "out_of_service"];

    return `
      ${pageHeader({
        title: T("nav.fleet"),
        subtitle: `${totalTrucks} ${T("c.trucks")} · ${T("c.fleetSubtitle")}`,
        actions: btn({ label: T("c.addTruck"), icon: ICONS.plus(), variant: "primary", onclick: "FLEET.openAddTruck()" }),
      })}

      <!-- Primary data strip -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        ${stat({ label: T("c.fleetTotal"),     value: totalTrucks, tone: "info" })}
        ${stat({ label: T("c.activeTrucks"),   value: activeCount, tone: "ok" })}
        ${stat({ label: T("c.inMaintenance"), value: maintCount, tone: maintCount > 6 ? "warn" : "info" })}
        ${stat({ label: T("c.outOfService"),  value: oosCount, tone: oosCount > 0 ? "bad" : "ok" })}
        ${stat({ label: T("c.totalCapacity"), value: `${fmtNum(totalCapM3)} ${T("c.cubicMeters")}`, tone: "info" })}
        ${stat({ label: T("c.avgFleetHealth"), value: avgHealth, tone: avgHealth > 75 ? "ok" : "warn" })}
      </div>

      <div class="card p-3 mb-5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="muted mx-1">${ICONS.filter()}</span>
          <input id="fleetSearch" class="input flex-1 min-w-[200px]" placeholder="${T("c.searchTruck")}" value="${escapeHtml(filters.q)}"
                 oninput="window.APP_STATE.fleetFilters.q=this.value; window.app.render()"/>
          <div class="flex items-center gap-1 flex-wrap">
            ${STATUS_OPTIONS.map(s => `<button class="btn-chip ${filters.status===s?'active':''}" onclick="window.APP_STATE.fleetFilters.status='${s}'; window.app.render()">${s==='all'?T('c.all'):T(`status.${s}`)}</button>`).join("")}
          </div>
          <select class="select" onchange="window.APP_STATE.fleetFilters.depot=this.value; window.app.render()">
            <option value="all" ${filters.depot==='all'?'selected':''}>${T("c.allDepots")}</option>
            ${D().DEPOTS.map(d => `<option value="${d}" ${filters.depot===d?'selected':''}>${depotLabel(d)}</option>`).join("")}
          </select>
          <span class="muted text-xs ms-auto">${list.length} ${T("c.results")}</span>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto scroll-thin">
          <table class="tbl">
            <thead>
              <tr>
                <th>${T("c.truck")}</th><th>${T("c.plate")}</th><th>${T("c.model")}</th>
                <th>${T("c.depot")}</th><th>${T("c.status")}</th><th>${T("c.driver")}</th>
                <th>${T("c.health")}</th><th>${T("c.capacity")}</th><th>${T("c.odometer")}</th>
                <th>${T("c.lastService")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${list.map(tr => fleetRow(tr)).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function fleetRow(tr) {
    const driver = tr.driverId ? D().findDriver(tr.driverId) : null;
    const driverCell = driver
      ? `<span class="truck-driver">${escapeHtml(lang()==='ar'?driver.nameAr:driver.name)}</span>
         <button class="btn btn-ghost btn-xs ms-1" title="${T("c.changeDriver")}" onclick="event.stopPropagation(); FLEET.openAssignDriver('${tr.id}')">${ICONS.users()}</button>`
      : `<button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); FLEET.openAssignDriver('${tr.id}')">${ICONS.plus()}${T("c.assignDriver")}</button>`;
    return `
      <tr>
        <td><div class="flex items-center gap-2">
          <div class="h-8 w-8 rounded-lg grid place-items-center" style="background:rgba(11,126,234,.1); color:#0b7eea">${ICONS.truck()}</div>
          <div class="font-medium">${tr.id}</div>
        </div></td>
        <td class="font-mono text-xs">${lang()==='ar'?tr.plateAr:tr.plate}</td>
        <td>${escapeHtml(tr.model)} <span class="muted">· ${tr.year}</span></td>
        <td>${depotLabel(tr.homeDepot)}</td>
        <td>${pill(tr.status, T(`status.${tr.status}`))}</td>
        <td>${driverCell}</td>
        <td><div class="w-28"><div class="text-[11px] tabular mb-0.5">${tr.healthScore}</div>${bar(tr.healthScore)}</div></td>
        <td class="tabular font-medium">${FLEET.capacity(tr)}</td>
        <td class="tabular">${fmtNum(tr.odometerKm)} km</td>
        <td class="text-xs">${FLEET.lastServiceLabel(tr)}</td>
        <td><button class="btn btn-outline" onclick="window.app.navigate('/fleet/${tr.id}')">${ICONS.eye()}${T("c.view")}</button></td>
      </tr>`;
  }

  // ---------- Fleet Detail ----------
  function fleetDetail(id) {
    const tr = D().findTruck(id);
    if (!tr) return `<div class="card p-6 text-center"><p>Not found.</p><button class="btn btn-outline mt-3" onclick="window.app.navigate('/fleet')">Back</button></div>`;
    const driver = tr.driverId ? D().findDriver(tr.driverId) : null;
    // Maintenance history = every WO ever opened against this truck (newest first).
    const woHistory = D().workOrders
      .filter(w => w.truckId === tr.id)
      .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
    const alerts = D().predictiveAlerts.filter(a => a.truckId === tr.id);
    const componentsList = D().ENGINE_COMPONENTS || [];

    return `
      <button class="btn btn-ghost mb-2" onclick="window.app.navigate('/fleet')">${ICONS.arrowLeft()}${T("c.back")}</button>
      ${pageHeader({
        title: `${tr.id} · ${lang()==='ar'?tr.plateAr:tr.plate}`,
        subtitle: `${tr.model} · ${tr.year} · ${FLEET.capacity(tr)} · ${depotLabel(tr.homeDepot)}`,
        actions: `${pill(tr.status, T(`status.${tr.status}`))}
                  ${btn({ label: T("c.assignDriver"), icon: ICONS.users(), variant: "outline", onclick: `FLEET.openAssignDriver('${tr.id}')` })}
                  ${btn({ label: T("mt.addJob"), icon: ICONS.calendar(), variant: "primary", onclick: "MT.openNewJob()" })}`,
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
        ${stat({ label: T("c.health"), value: tr.healthScore, tone: tr.healthScore > 75 ? "ok" : tr.healthScore > 55 ? "warn" : "bad" })}
        ${stat({ label: T("kpi.utilization"), value: `${tr.utilizationPct}%`, tone: "info" })}
        ${stat({ label: T("c.capacity"), value: FLEET.capacity(tr), tone: "info" })}
        ${stat({ label: T("c.fuelEff"), value: `${tr.fuelEfficiencyKmPerL} km/L` })}
        ${stat({ label: T("c.odometer"), value: `${fmtNum(tr.odometerKm)} km` })}
        ${stat({ label: T("c.lastService"), value: FLEET.lastServiceLabel(tr), tone: "ok" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div class="lg:col-span-2 card p-4">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 class="font-semibold flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-emerald-500 pulse-dot"></span>
                ${T("c.engineHealth")}
              </h3>
              <p class="text-[11px] muted mt-0.5">${T("c.engineHealthSub")}</p>
            </div>
            <span class="text-xs muted">${T("c.lastUpdate")}: 12s</span>
          </div>

          <div class="overflow-x-auto scroll-thin">
            <table class="tbl engine-tbl">
              <thead><tr>
                <th>${T("c.component")}</th>
                <th>${T("c.vibrationRms")}</th>
                <th>${T("c.soundLevel")}</th>
                <th>${T("c.condition")}</th>
              </tr></thead>
              <tbody>
                ${componentsList.map(c => {
                  const reading = tr.iot.engineComponents && tr.iot.engineComponents[c.key];
                  if (!reading) return "";
                  const vibPct = Math.min(100, ((reading.vibrationRms - c.vibBase) / (c.vibMax - c.vibBase)) * 100);
                  const sndPct = Math.min(100, ((reading.soundDb - c.sndBase) / (c.sndMax - c.sndBase)) * 100);
                  const condLabel = reading.condition === "ok" ? T("c.nominal")
                                  : reading.condition === "warn" ? T("c.elevated")
                                  : T("c.criticalCondition");
                  const condStatus = reading.condition === "ok" ? "active"
                                   : reading.condition === "warn" ? "warning"
                                   : "critical";
                  return `<tr>
                    <td>
                      <div class="font-medium text-sm">${escapeHtml(lang()==='ar'?c.ar:c.en)}</div>
                      <div class="text-[10px] muted">${c.vibBase}–${c.vibMax} mm/s · ${c.sndBase}–${c.sndMax} dB</div>
                    </td>
                    <td>
                      <div class="flex items-center gap-2">
                        <span class="tabular text-sm font-semibold ${reading.condition==='bad'?'text-rose-600':reading.condition==='warn'?'text-amber-600':'text-emerald-600'}">${reading.vibrationRms}</span>
                        <div class="w-20 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                          <div class="h-full ${reading.condition==='bad'?'bg-rose-500':reading.condition==='warn'?'bg-amber-500':'bg-emerald-500'}" style="width:${vibPct.toFixed(0)}%"></div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="flex items-center gap-2">
                        <span class="tabular text-sm font-semibold ${reading.condition==='bad'?'text-rose-600':reading.condition==='warn'?'text-amber-600':'text-emerald-600'}">${reading.soundDb}</span>
                        <div class="w-20 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                          <div class="h-full ${reading.condition==='bad'?'bg-rose-500':reading.condition==='warn'?'bg-amber-500':'bg-emerald-500'}" style="width:${sndPct.toFixed(0)}%"></div>
                        </div>
                      </div>
                    </td>
                    <td>${pill(condStatus, condLabel)}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-4">
          ${section({
            title: T("c.driver"),
            action: btn({ label: driver ? T("c.changeDriver") : T("c.assignDriver"), variant: "outline", onclick: `FLEET.openAssignDriver('${tr.id}')` }),
            body: driver ? `
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-full text-white grid place-items-center font-semibold" style="background:#0c66bf">${initials(driver.name)}</div>
                <div><div class="font-medium">${escapeHtml(lang()==='ar'?driver.nameAr:driver.name)}</div><div class="text-xs muted">${driver.id} · ${driver.phone}</div></div>
              </div>
              <div class="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div><span class="muted">${T("c.safetyScore")}:</span> <span class="font-medium">${driver.safetyScore}</span></div>
                <div><span class="muted">${T("c.trips30d")}:</span> <span class="font-medium">${driver.trips30d}</span></div>
                <div><span class="muted">${T("c.rating")}:</span> <span class="font-medium">${driver.rating} / 5</span></div>
                <div>${pill(driver.status, T(`status.${driver.status}`))}</div>
              </div>` : `<p class="text-sm muted">${T("c.noDriver")}</p>`
          })}

          ${section({
            title: T("nav.predictive"),
            body: alerts.length === 0 ? `<p class="text-sm muted">${T("c.noAlerts")}</p>` :
              alerts.map(a => `
                <div class="flex items-start gap-2 py-2 border-t border-app first:border-0">
                  <span class="${a.severity === 'critical' ? 'text-rose-500' : a.severity === 'warning' ? 'text-amber-500' : 'text-blue-500'}">${ICONS.alert()}</span>
                  <div class="flex-1">
                    <div class="text-sm font-medium">${escapeHtml(lang()==='ar'?a.componentAr:a.component)}</div>
                    <div class="text-xs muted">${escapeHtml(lang()==='ar'?a.recommendedActionAr:a.recommendedAction)}</div>
                    <div class="text-[11px] muted">${a.predictedFailureInDays}d · ${a.confidencePct}%</div>
                  </div>
                </div>`).join(""),
          })}
        </div>
      </div>

      <!-- Unified maintenance history (replaces recent WO + recent trips) -->
      <div class="card overflow-hidden">
        <div class="flex items-center justify-between p-3 border-b border-app">
          <h3 class="font-semibold flex items-center gap-2">${ICONS.history ? ICONS.history() : ICONS.wrench()}${T("c.maintHistory")}</h3>
          <span class="muted text-xs">${woHistory.length} ${T("c.allJobs")}</span>
        </div>
        ${woHistory.length === 0 ? `<p class="text-sm muted p-6 text-center">${T("c.noHistory")}</p>` : `
          <div class="overflow-x-auto scroll-thin">
            <table class="tbl">
              <thead><tr>
                <th>${T("c.opened")}</th>
                <th>WO</th>
                <th>${T("c.title")}</th>
                <th>${T("c.type")}</th>
                <th>${T("c.status")}</th>
                <th>${T("c.mechanic")}</th>
                <th>${T("mt.partsChanged")}</th>
                <th>${T("mt.totalCost")}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${woHistory.map(w => {
                  const mech = w.assignedMechanicId ? D().findPerson(w.assignedMechanicId) : null;
                  const cost = w.actualCostSar ?? w.estimatedCostSar;
                  const partN = w.partsUsed.reduce((s, p) => s + p.qty, 0);
                  return `<tr style="cursor:pointer" onclick="MT.openJob('${w.id}')">
                    <td class="text-xs">${new Date(w.openedAt).toLocaleDateString()}</td>
                    <td class="font-mono text-xs">${w.id}</td>
                    <td>${escapeHtml(lang()==='ar'?w.titleAr:w.title)}</td>
                    <td>${T(`status.${w.type}`)}</td>
                    <td>${pill(w.status, T(`status.${w.status}`))}</td>
                    <td class="text-xs">${mech ? escapeHtml(lang()==='ar'?mech.nameAr:mech.name) : '<span class="muted">—</span>'}</td>
                    <td class="tabular">${partN}</td>
                    <td class="tabular">${fmtSar(cost)}</td>
                    <td>${btn({ label: T("mt.viewJob"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); MT.openJob('${w.id}')` })}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  function initials(name) {
    return name.split(" ").map(w => w[0]).slice(0, 2).join("");
  }

  // ---------- Drivers ----------
  function drivers() {
    const S = window.APP_STATE;
    if (!S.driversTab) S.driversTab = "drivers";
    const tab = S.driversTab;

    const ds = D().drivers;
    const onDuty = ds.filter(d => d.status === "on_duty").length;
    const expiring = ds.filter(d => new Date(d.licenseExpiry) < new Date(2026, 11, 31)).length;
    const avgSafety = +(ds.reduce((s, d) => s + d.safetyScore, 0) / ds.length).toFixed(1);
    const incidents = ds.reduce((s, d) => s + d.incidents12mo, 0);

    // Compute commission totals for the current month so the tab badge tells the truth.
    const curCommissions = D().commissionsForMonth(D().CURRENT_MONTH_KEY);
    const pendingCount = curCommissions.filter(c => c.payoutStatus === "pending").length;

    const tabsBar = `
      <div class="page-tabs">
        <button class="page-tab ${tab === "drivers" ? "active" : ""}" onclick="DRV.setTab('drivers')">${ICONS.users()}${T("drv.tabDrivers")}<span class="badge">${ds.length}</span></button>
        <button class="page-tab ${tab === "commissions" ? "active" : ""}" onclick="DRV.setTab('commissions')">${ICONS.money()}${T("drv.tabCommissions")}${pendingCount > 0 ? `<span class="badge">${pendingCount}</span>` : ""}</button>
        <button class="page-tab ${tab === "staff" ? "active" : ""}" onclick="DRV.setTab('staff')">${ICONS.users()}${T("drv.tabStaff")}<span class="badge">${D().people.length}</span></button>
      </div>`;

    const header = pageHeader({
      title: T("nav.drivers"),
      subtitle: `${ds.length} ${T("c.drivers")} · ${D().people.length} ${lang()==='en'?'support staff':'موظف دعم'}`,
      actions: btn({ label: T("c.addPerson"), icon: ICONS.plus(), variant: "primary", onclick: "alert('Demo: add person')" })
    });

    if (tab === "commissions") {
      return `${header}${tabsBar}${COM.section()}`;
    }

    if (tab === "staff") {
      return `${header}${tabsBar}${section({
        title: T("c.mgmtStaff"),
        body: `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          ${D().people.map(p => `
            <div class="rounded-lg border border-app p-3 flex items-center gap-3">
              <div class="h-10 w-10 rounded-full text-white grid place-items-center text-sm font-semibold" style="background:#bd8b3f">${initials(p.name)}</div>
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate">${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</div>
                <div class="text-xs muted truncate">${T(`role.${p.role}`)} · ${depotLabel(p.depot)}</div>
                <div class="text-[11px] muted truncate">${escapeHtml(p.phone)}</div>
              </div>
            </div>`).join("")}
        </div>`
      })}`;
    }

    // Default tab: Drivers (slim table — details in DRV.openDriver)
    return `
      ${header}
      ${tabsBar}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        ${stat({ label: T("c.onDutyNow"), value: `${onDuty}/${ds.length}`, tone: "ok" })}
        ${stat({ label: T("c.avgSafety"), value: avgSafety, tone: avgSafety > 80 ? "ok" : "warn" })}
        ${stat({ label: T("c.incidents12"), value: incidents, tone: incidents > 5 ? "warn" : "ok" })}
        ${stat({ label: T("c.licExp2026"), value: expiring, tone: expiring > 5 ? "warn" : "info" })}
      </div>

      <div class="card overflow-hidden mb-5">
        <div class="overflow-x-auto scroll-thin">
          <table class="tbl">
            <thead>
              <tr>
                <th>${T("c.driver")}</th>
                <th>${T("c.depot")}</th>
                <th>${T("c.status")}</th>
                <th>${T("c.truck")}</th>
                <th>${T("c.safety")}</th>
                <th>${T("c.trips30d")}</th>
                <th>${T("c.rating")}</th>
                <th>${T("c.licenseExp")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${ds.map(d => {
                const truck = d.assignedTruckId ? D().findTruck(d.assignedTruckId) : null;
                const expSoon = new Date(d.licenseExpiry) < new Date(2026, 11, 31);
                return `
                <tr style="cursor:pointer" onclick="DRV.openDriver('${d.id}')">
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="h-8 w-8 rounded-full text-white grid place-items-center text-xs font-semibold" style="background:#0c66bf">${initials(d.name)}</div>
                      <div>
                        <div class="font-medium">${escapeHtml(lang()==='ar'?d.nameAr:d.name)}</div>
                        <div class="text-[11px] muted">${d.id}</div>
                      </div>
                    </div>
                  </td>
                  <td>${depotLabel(d.homeDepot)}</td>
                  <td>${pill(d.status, T(`status.${d.status}`))}</td>
                  <td>${truck ? `<span class="font-mono text-xs">${truck.id}</span>` : '<span class="muted">—</span>'}</td>
                  <td><div class="w-24"><div class="text-[11px] tabular mb-0.5">${d.safetyScore}</div>${bar(d.safetyScore)}</div></td>
                  <td class="tabular">${d.trips30d}</td>
                  <td><span class="flex items-center gap-1"><span style="color:#f59e0b">${ICONS.star()}</span> ${d.rating}</span></td>
                  <td class="${expSoon ? 'text-amber-600 font-medium' : ''}">${d.licenseExpiry}</td>
                  <td>${btn({ label: T("c.view"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); DRV.openDriver('${d.id}')` })}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---------- Trips ----------
  function trips() {
    const filter = window.APP_STATE.tripFilter || "all";
    window.APP_STATE.tripFilter = filter;
    const all = D().trips;
    const list = filter === "all" ? all : all.filter(t => t.status === filter);

    const delivered = all.filter(t => t.status === "delivered");
    const totalLiters = delivered.reduce((s, t) => s + t.waterLiters, 0);
    const totalRev = delivered.reduce((s, t) => s + t.revenueSar, 0);
    const totalCost = delivered.reduce((s, t) => s + t.costSar, 0);
    const onTime = delivered.filter(t => (t.actualDurationMin ?? 0) <= t.plannedDurationMin + 10).length;
    const STATUS = ["all", "scheduled", "loading", "in_transit", "delivered", "cancelled"];

    return `
      ${pageHeader({
        title: T("nav.trips"),
        subtitle: `${all.length} ${T("c.tripsSubtitle")}`,
        actions: btn({ label: T("c.schedule"), icon: ICONS.calendar(), variant: "outline" })
              + btn({ label: T("c.newTrip"), icon: ICONS.plus(), variant: "primary", onclick: "alert('Demo: new trip')" })
      })}

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        ${stat({ label: lang()==='en'?"Total Liters Delivered":"إجمالي اللترات الموردة", value: fmtNum(totalLiters), tone: "info" })}
        ${stat({ label: lang()==='en'?"Trips Delivered":"رحلات مكتملة", value: delivered.length, tone: "ok" })}
        ${stat({ label: lang()==='en'?"On-Time":"في الوقت", value: `${Math.round((onTime/Math.max(1,delivered.length))*100)}%`, tone: "ok" })}
        ${stat({ label: T("c.revenue"), value: fmtSar(totalRev), tone: "ok" })}
        ${stat({ label: lang()==='en'?"Op Cost":"تكلفة التشغيل", value: fmtSar(totalCost), tone: "warn" })}
      </div>

      <div class="card p-3 mb-5">
        <div class="flex items-center gap-1 flex-wrap">
          ${STATUS.map(s => `<button class="btn-chip ${filter===s?'active':''}" onclick="window.APP_STATE.tripFilter='${s}'; window.app.render()">
            ${s==='all'?T('c.all'):T(`status.${s}`)}
            <span class="muted ms-1">${s==='all'?all.length:all.filter(x=>x.status===s).length}</span>
          </button>`).join("")}
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto scroll-thin">
          <table class="tbl">
            <thead>
              <tr>
                <th>Ref</th><th>${T("c.status")}</th><th>${T("c.customer")}</th><th>${T("c.route")}</th>
                <th>${T("c.truck")}</th><th>${T("c.driver")}</th><th>${T("c.liters")}</th>
                <th>${T("c.distance")}</th><th>${T("c.schedule")}</th><th>${T("c.cost")}</th><th>${T("c.revenue")}</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(t => {
                const driver = D().findDriver(t.driverId);
                const truck = D().findTruck(t.truckId);
                const margin = t.revenueSar - t.costSar;
                return `
                <tr>
                  <td><div class="font-medium">${t.ref}</div><div class="text-[11px] muted">${t.id}</div></td>
                  <td>${pill(t.status, T(`status.${t.status}`))}</td>
                  <td><div class="font-medium">${escapeHtml(lang()==='ar'?t.customerAr:t.customer)}</div><div class="text-[11px] muted">${T(`water.${t.waterType}`)}</div></td>
                  <td>
                    <div class="flex items-center gap-1.5 text-xs">
                      <span class="muted truncate" style="max-width:110px">${escapeHtml(lang()==='ar'?t.origin.nameAr:t.origin.name)}</span>
                      <span class="muted">${ICONS.arrowRight()}</span>
                      <span class="font-medium truncate" style="max-width:110px">${escapeHtml(lang()==='ar'?t.destination.nameAr:t.destination.name)}</span>
                    </div>
                  </td>
                  <td class="font-mono text-xs">${truck?.id}</td>
                  <td>${driver ? escapeHtml(lang()==='ar'?driver.nameAr:driver.name) : '—'}</td>
                  <td class="tabular"><span class="text-brand-500">${ICONS.droplet()}</span> ${fmtNum(t.waterLiters)}</td>
                  <td class="tabular">${t.distanceKm} km</td>
                  <td class="text-xs">${new Date(t.scheduledStart).toLocaleDateString()}</td>
                  <td class="tabular">${fmtSar(t.costSar)}</td>
                  <td class="tabular">${fmtSar(t.revenueSar)} <span class="text-[11px] ${margin>0?'text-emerald-600':'text-rose-600'}">(${margin>0?'+':''}${fmtSar(margin)})</span></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---------- Routes (map) ----------
  function routes() {
    const opt = window.APP_STATE.routeOpt !== false;
    window.APP_STATE.routeOpt = opt;
    const active = D().trips.filter(t => t.status === "in_transit" || t.status === "loading" || t.status === "scheduled").slice(0, 18);

    const points = [];
    D().trucks.forEach(tr => {
      if (tr.status === "active" || tr.status === "idle") {
        points.push({ id: tr.id, lat: tr.iot.gps.lat, lng: tr.iot.gps.lng,
          color: tr.status === "active" ? "#10b981" : "#3b82f6", size: 0.9, label: `${tr.id} · ${tr.plate}` });
      }
    });
    active.forEach(t => {
      points.push({ id: `dest-${t.id}`, lat: t.destination.lat, lng: t.destination.lng,
        color: "#ef4444", size: 1.1, label: t.destination.name });
    });
    const routeLines = active.map(t => ({
      id: t.id,
      points: opt ? t.routeWaypoints : [t.routeWaypoints[0], t.routeWaypoints[t.routeWaypoints.length - 1]],
      color: opt ? "#0b7eea" : "#94a3b8", dashed: !opt,
    }));

    const totalKm = active.reduce((s, t) => s + t.distanceKm, 0);
    const fuelSaved = Math.round(totalKm * 0.08);
    const timeSaved = +(totalKm * 0.012).toFixed(1);
    const costSaved = Math.round(fuelSaved * 2.18);

    return `
      ${pageHeader({
        title: T("nav.routes"),
        subtitle: T("c.routesSubtitle"),
        actions: btn({ label: T("c.recluster"), variant: "outline" })
              + btn({ label: T("c.runOptimizer"), icon: ICONS.sparkles(), variant: "primary", onclick: "alert('Demo: re-run optimizer')" })
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        ${stat({ label: T("c.activeRoutes"), value: active.length, tone: "info" })}
        ${stat({ label: T("c.totalDistance"), value: `${fmtNum(totalKm)} km` })}
        ${stat({ label: T("c.fuelSaved"), value: `${fuelSaved} L`, sub: `= ${fmtSar(costSaved)}`, tone: "ok" })}
        ${stat({ label: T("c.timeSaved"), value: `${timeSaved} h`, tone: "ok" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 card p-4">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 class="font-semibold">${T("c.liveFleet")}</h3>
            <div class="inline-flex rounded-lg overflow-hidden text-xs border border-app">
              <button class="px-3 py-1.5 ${!opt ? 'bg-brand-600 text-white' : 'muted'}" onclick="window.APP_STATE.routeOpt=false; window.app.render()">${T("c.direct")}</button>
              <button class="px-3 py-1.5 ${opt ? 'bg-brand-600 text-white' : 'muted'}" onclick="window.APP_STATE.routeOpt=true; window.app.render()">${T("c.optimized")}</button>
            </div>
          </div>
          ${KSAMap.render({ points, routes: routeLines, height: 520, lang: lang() })}
          <div class="flex items-center gap-4 mt-3 text-xs muted flex-wrap">
            <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#10b981"></span>${T("c.activeTruck")}</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#3b82f6"></span>${T("c.idleTruck")}</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#ef4444"></span>${T("c.destination")}</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#0b7eea"></span>${T("c.optimizedRoute")}</span>
          </div>
        </div>

        <div class="space-y-4">
          ${section({
            title: T("c.optResult"),
            body: `<div class="space-y-3">
              ${optRow(ICONS.fuel(), T("c.fuelReduction"), `-${fuelSaved} L`)}
              ${optRow(ICONS.clock(), T("c.timeReduction"), `-${timeSaved} h`)}
              ${optRow(ICONS.trendDown(), T("c.costSaved"), `-${fmtSar(costSaved)}`)}
              ${optRow(ICONS.route(), T("c.avgDetour"), "-7.2%")}
            </div>
            <div class="mt-3 text-[11px] muted">${T("c.optAlgo")}</div>`
          })}

          ${section({
            title: T("c.activeTrips"),
            body: `<div class="space-y-2">
              ${active.slice(0, 8).map(t => `
                <div class="flex items-center gap-2 text-sm">
                  ${pill(t.status, T(`status.${t.status}`))}
                  <span class="font-mono text-xs">${t.truckId}</span>
                  <span class="muted text-xs truncate flex-1">${escapeHtml(lang()==='ar'?t.destination.nameAr:t.destination.name)}</span>
                  <span class="tabular text-xs">${t.distanceKm} km</span>
                </div>`).join("")}
            </div>`
          })}
        </div>
      </div>
    `;
  }
  function optRow(icon, label, value) {
    return `<div class="flex items-center justify-between">
      <span class="flex items-center gap-2 text-sm"><span class="muted">${icon}</span>${escapeHtml(label)}</span>
      <span class="text-sm font-semibold tabular text-emerald-600">${escapeHtml(value)}</span>
    </div>`;
  }

  // ---- helpers
  function lastNDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(2026, 4, 11 - i);
      out.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    return out;
  }

  // chart helpers (Chart.js)
  function drawAreaChart(id, labels, data, { color = "#0b7eea" } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.__charts && window.__charts[id]) window.__charts[id].destroy();
    window.__charts = window.__charts || {};
    window.__charts[id] = new Chart(el, {
      type: "line",
      data: { labels, datasets: [{
        data, borderColor: color, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280);
          g.addColorStop(0, color + "70"); g.addColorStop(1, color + "00"); return g;
        }
      }]},
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
                  y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } } } }
    });
  }
  function drawPie(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.__charts && window.__charts[id]) window.__charts[id].destroy();
    window.__charts = window.__charts || {};
    window.__charts[id] = new Chart(el, {
      type: "doughnut",
      data: { labels: items.map(i=>i.label), datasets: [{ data: items.map(i=>i.value), backgroundColor: items.map(i=>i.color), borderWidth: 2, borderColor: "#fff" }]},
      options: { maintainAspectRatio: false, cutout: "60%", plugins: { legend: { display: false } } }
    });
  }
  function drawDualBar(id, labels, d1, d2, { c1 = "#0b7eea", c2 = "#f59e0b", l1, l2 } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.__charts && window.__charts[id]) window.__charts[id].destroy();
    window.__charts = window.__charts || {};
    window.__charts[id] = new Chart(el, {
      type: "bar",
      data: { labels, datasets: [
        { label: l1, data: d1, backgroundColor: c1, borderRadius: 4, maxBarThickness: 14 },
        { label: l2, data: d2, backgroundColor: c2, borderRadius: 4, maxBarThickness: 14 },
      ]},
      options: { maintainAspectRatio: false, plugins: { legend: { position: "top", align: "end", labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#64748b" } },
                  y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } } } }
    });
  }
  function drawDualLine(id, labels, d1, d2, { c1 = "#ef4444", c2 = "#f59e0b", l1, l2 } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.__charts && window.__charts[id]) window.__charts[id].destroy();
    window.__charts = window.__charts || {};
    window.__charts[id] = new Chart(el, {
      type: "line",
      data: { labels, datasets: [
        { label: l1, data: d1, borderColor: c1, borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: l2, data: d2, borderColor: c2, borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: "y1" },
      ]},
      options: { maintainAspectRatio: false, plugins: { legend: { position: "top", align: "end", labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: { x: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
                  y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
                  y1: { position: "right", grid: { display: false }, ticks: { font: { size: 11 }, color: "#64748b" } } } }
    });
  }

  return { dashboard, fleet, fleetDetail, drivers, trips, routes, drawAreaChart, drawPie, drawDualBar, drawDualLine };
})();
