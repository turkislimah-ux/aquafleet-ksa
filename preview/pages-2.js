// Pages: Maintenance, Predictive, IoT, Inventory, Reports
window.PAGES_2 = (function () {
  const { fmtNum, fmtSar, escapeHtml, pageHeader, stat, pill, bar, btn, section } = UI;
  const D = () => window.DATA;
  const lang = () => window.APP_STATE.lang;
  const depotLabel = (d) => T(`depot.${d}`);

  // ---- Date helpers ----
  const ymd = (d) => d.toISOString().slice(0, 10);
  const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const WEEKDAYS_EN = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const WEEKDAYS_AR = ["أحد","اثن","ثلا","أرب","خمي","جمع","سبت"];
  const monthName = (m) => (lang() === "ar" ? MONTHS_AR : MONTHS_EN)[m];

  // ---- Maintenance helper module (calendar, per-truck, job drawer) ----
  window.MT = {
    /** ISO date (Sunday) of the week containing TODAY. */
    weekStartOf(d) {
      const x = new Date(d.getTime());
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - x.getDay());
      return x;
    },
    prevWeek() {
      const S = window.APP_STATE;
      const d = new Date(S.mtWeekStart || MT.weekStartOf(new Date(2026, 4, 13)));
      d.setDate(d.getDate() - 7);
      S.mtWeekStart = ymd(d);
      window.app.render();
    },
    nextWeek() {
      const S = window.APP_STATE;
      const d = new Date(S.mtWeekStart || MT.weekStartOf(new Date(2026, 4, 13)));
      d.setDate(d.getDate() + 7);
      S.mtWeekStart = ymd(d);
      window.app.render();
    },
    pickDay(iso) {
      const S = window.APP_STATE;
      S.mtSelectedDate = S.mtSelectedDate === iso ? null : iso;
      window.app.render();
    },

    /** Render a forward-looking 7-day strip (Sun–Sat) for the current week.
     *  History (completed/cancelled WOs) is excluded — those still appear in
     *  the Historical tab below, not on the schedule. Out-Sourced jobs are
     *  included as small "OS" badges on the same strip. */
    calendar(_year, _month, truckFilter, selectedISO) {
      const S = window.APP_STATE;
      // Initialize the week to TODAY's week on first render
      if (!S.mtWeekStart) {
        S.mtWeekStart = ymd(MT.weekStartOf(new Date(2026, 4, 13)));
      }

      const inHouse = D().workOrders.filter(w => {
        if (w.status === "completed" || w.status === "cancelled") return false;
        return truckFilter === "all" || w.truckId === truckFilter;
      });
      const outsourced = (D().outsourcedJobs || []).filter(o => {
        if (o.status === "completed") return false;
        return truckFilter === "all" || o.truckId === truckFilter;
      });
      const isDelayed = (w) => MT.isDelayed(w);

      // Bucket by date — WOs by dueBy, outsourced by startDate.
      const byDay = {};
      inHouse.forEach(w => {
        const k = ymd(new Date(w.dueBy));
        (byDay[k] = byDay[k] || []).push({ kind: "wo", w });
      });
      outsourced.forEach(o => {
        const k = o.startDate;
        (byDay[k] = byDay[k] || []).push({ kind: "os", o });
      });

      // Build 7 cells starting at S.mtWeekStart
      const start = new Date(S.mtWeekStart);
      const cells = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start.getTime());
        d.setDate(start.getDate() + i);
        return { date: d, iso: ymd(d), dow: i };
      });
      const todayKey = ymd(new Date(2026, 4, 13));
      const WEEK = lang() === "ar" ? WEEKDAYS_AR : WEEKDAYS_EN;
      const monthFmt = (d) => `${monthName(d.getMonth()).slice(0,3)} ${d.getDate()}`;
      const weekHeader = `${monthFmt(cells[0].date)} – ${monthFmt(cells[6].date)}, ${cells[0].date.getFullYear()}`;

      // Counts visible in this week (legend totals)
      let cActive = 0, cPlanned = 0, cDelayed = 0;
      cells.forEach(c => (byDay[c.iso] || []).forEach(item => {
        if (item.kind === "wo") {
          if (isDelayed(item.w)) cDelayed++;
          else if (item.w.status === "in_progress" || item.w.status === "awaiting_parts") cActive++;
          else if (item.w.status === "open") cPlanned++;
        } else {
          if (item.o.status === "in_progress") cActive++;
          else cPlanned++;
        }
      }));

      const dayCell = (c) => {
        const items = byDay[c.iso] || [];
        const sel = c.iso === selectedISO;
        const today = c.iso === todayKey;
        const lines = [];
        items.forEach(item => {
          if (item.kind === "wo") {
            const truck = D().findTruck(item.w.truckId);
            const plate = truck ? (lang()==='ar' ? truck.plateAr : truck.plate) : item.w.truckId;
            const tone = isDelayed(item.w) ? "delayed"
                       : (item.w.status === "in_progress" || item.w.status === "awaiting_parts") ? "active"
                       : "planned";
            lines.push({ tone, text: `${truck?.id || item.w.truckId} · ${plate}`, woId: item.w.id });
          } else {
            const truck = D().findTruck(item.o.truckId);
            const plate = lang()==='ar' ? (item.o.plateAr || truck?.plateAr || "") : (item.o.plate || truck?.plate || "");
            const tone = item.o.status === "in_progress" ? "active" : "planned";
            lines.push({ tone, text: `<span class="os-badge">${T("mt.osBadge")}</span> ${truck?.id || item.o.truckId} · ${plate}`, osId: item.o.id });
          }
        });
        const maxLines = 3;
        const shown = lines.slice(0, maxLines);
        const more = lines.length - shown.length;
        const linesHtml = shown.map(l => {
          const click = l.woId ? `event.stopPropagation(); MT.openJob('${l.woId}')`
                                : `event.stopPropagation(); MT.openOutsourced('${l.osId}')`;
          return `<div class="week-line week-${l.tone}" onclick="${click}">${l.text}</div>`;
        }).join("");
        return `
          <div class="week-day ${today ? 'today' : ''} ${sel ? 'selected' : ''}" onclick="MT.pickDay('${c.iso}')">
            <div class="week-day-head">
              <span class="dow">${WEEK[c.dow]}</span>
              <span class="dnum">${c.date.getDate()}</span>
              ${today ? `<span class="today-flag">${T("c.today")}</span>` : ""}
            </div>
            <div class="week-lines">
              ${linesHtml || `<div class="week-empty">${T("mt.weekNoJobs")}</div>`}
              ${more > 0 ? `<div class="week-more">+${more} ${T("mt.moreCount")}</div>` : ""}
            </div>
          </div>`;
      };

      return `
        <div class="card p-4 mb-4">
          <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="text-brand-600">${ICONS.calendar()}</span>
              <h3 class="font-semibold">${T("mt.calendar")}</h3>
            </div>
            <div class="flex items-center gap-1">
              <button class="icon-btn" onclick="MT.prevWeek()" title="${T("mt.prevWeek")}">${ICONS.chevronLeft()}</button>
              <div class="px-3 py-1.5 rounded-lg border border-app text-sm font-medium min-w-[180px] text-center">${T("mt.weekOf")} ${escapeHtml(weekHeader)}</div>
              <button class="icon-btn" onclick="MT.nextWeek()" title="${T("mt.nextWeek")}">${ICONS.chevronRight()}</button>
            </div>
            <div class="flex items-center gap-3 text-xs flex-wrap">
              <span class="flex items-center gap-1.5"><span class="cal-pill cal-pill-in_progress">●</span>${T("mt.weekActive")}: <b>${cActive}</b></span>
              <span class="flex items-center gap-1.5"><span class="cal-pill cal-pill-open">●</span>${T("mt.weekPlanned")}: <b>${cPlanned}</b></span>
              <span class="flex items-center gap-1.5"><span class="cal-pill cal-pill-delayed">●</span>${T("mt.weekDelayed")}: <b>${cDelayed}</b></span>
            </div>
          </div>

          <div class="week-strip">
            ${cells.map(dayCell).join("")}
          </div>
        </div>`;
    },

    /** Per-truck rollup card showing work done + parts changed history. */
    perTruckSummary() {
      const S = window.APP_STATE;
      const all = D().workOrders;

      // If a specific truck is selected, show a detailed history for just it.
      if (S.mtTruckFilter !== "all") {
        const truck = D().findTruck(S.mtTruckFilter);
        if (!truck) return "";
        const truckWO = all.filter(w => w.truckId === truck.id).sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
        const completed = truckWO.filter(w => w.status === "completed");
        const totalSpent = completed.reduce((s, w) => s + (w.actualCostSar ?? w.estimatedCostSar), 0);
        const totalParts = completed.reduce((s, w) => s + w.partsUsed.reduce((q, p) => q + p.qty, 0), 0);

        return `
          <div class="card p-4 mb-5">
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 class="font-semibold flex items-center gap-2">${ICONS.history()} ${T("mt.perTruck")} — ${truck.id}</h3>
                <p class="text-xs muted">${escapeHtml(truck.model)} · ${escapeHtml(lang()==='ar'?truck.plateAr:truck.plate)} · ${depotLabel(truck.homeDepot)}</p>
              </div>
              <div class="flex gap-3 text-xs">
                <span>${T("c.odometer")}: <b class="tabular">${fmtNum(truck.odometerKm)} km</b></span>
                <span>${T("c.nextService")}: <b class="tabular">${fmtNum(truck.nextServiceKm - truck.odometerKm)} km</b></span>
                <span>${T("mt.totalCost")}: <b class="tabular">${fmtSar(totalSpent)}</b></span>
                <span>${T("mt.partsChanged")}: <b class="tabular">${totalParts}</b></span>
              </div>
            </div>
            ${truckWO.length === 0 ? `<p class="muted text-sm py-4 text-center">${T("c.noWO")}</p>` : `
              <div class="overflow-x-auto scroll-thin">
                <table class="tbl">
                  <thead><tr>
                    <th>${T("c.opened")}</th><th>WO</th><th>${T("c.title")}</th>
                    <th>${T("c.status")}</th><th>${T("mt.odoAtService")}</th>
                    <th>${T("mt.tasksCompleted")}</th><th>${T("mt.partsChanged")}</th>
                    <th>${T("mt.totalCost")}</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${truckWO.map(w => {
                      const taskN = `${w.tasks.filter(t => t.done).length}/${w.tasks.length}`;
                      const partN = w.partsUsed.reduce((s, p) => s + p.qty, 0);
                      const cost = w.actualCostSar ?? w.estimatedCostSar;
                      return `<tr>
                        <td class="text-xs">${new Date(w.openedAt).toLocaleDateString()}</td>
                        <td class="font-mono text-xs">${w.id}</td>
                        <td>${escapeHtml(lang()==='ar'?w.titleAr:w.title)}</td>
                        <td>${pill(w.status, T(`status.${w.status}`))}</td>
                        <td class="tabular">${fmtNum(w.odometerAtService)} km</td>
                        <td class="tabular">${taskN}</td>
                        <td class="tabular">${partN}</td>
                        <td class="tabular">${fmtSar(cost)}</td>
                        <td>${btn({ label: T("mt.viewJob"), icon: ICONS.eye(), variant: "outline", onclick: `MT.openJob('${w.id}')` })}</td>
                      </tr>`;
                    }).join("")}
                  </tbody>
                </table>
              </div>
            `}
          </div>`;
      }

      // Otherwise show top trucks by recent activity.
      const trucksByActivity = D().trucks.map(tr => {
        const woList = all.filter(w => w.truckId === tr.id);
        const completed = woList.filter(w => w.status === "completed");
        const open = woList.filter(w => w.status !== "completed");
        const cost = completed.reduce((s, w) => s + (w.actualCostSar ?? w.estimatedCostSar), 0);
        return { tr, completed: completed.length, open: open.length, cost, last: woList.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))[0] };
      }).filter(x => x.completed + x.open > 0).sort((a, b) => b.cost - a.cost).slice(0, 8);

      return `
        <div class="card p-4 mb-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold flex items-center gap-2">${ICONS.history()} ${T("mt.perTruck")}</h3>
            <span class="muted text-xs">${lang() === 'en' ? 'Filter to a single truck above for full history' : 'صفِّ شاحنة بعينها أعلاه لعرض السجل الكامل'}</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            ${trucksByActivity.map(({tr, completed, open, cost, last}) => `
              <div class="rounded-lg border border-app p-3 cursor-pointer" onclick="window.APP_STATE.mtTruckFilter='${tr.id}'; window.app.render()">
                <div class="flex items-center gap-2 mb-1"><span class="text-amber-500">${ICONS.wrench()}</span><span class="font-mono text-xs">${tr.id}</span></div>
                <div class="text-sm font-medium truncate">${escapeHtml(tr.model)}</div>
                <div class="text-[11px] muted">${escapeHtml(lang()==='ar'?tr.plateAr:tr.plate)} · ${depotLabel(tr.homeDepot)}</div>
                <div class="grid grid-cols-3 gap-1 mt-2 text-[11px]">
                  <div><span class="muted">${T("mt.completedJobs")}:</span> <b class="tabular">${completed}</b></div>
                  <div><span class="muted">${T("mt.activeJobs")}:</span> <b class="tabular">${open}</b></div>
                  <div><span class="muted">${T("mt.totalCost")}:</span> <b class="tabular">${fmtSar(cost)}</b></div>
                </div>
                ${last ? `<div class="text-[11px] muted mt-1 truncate">${T("c.recentWO")}: ${escapeHtml(lang()==='ar'?last.titleAr:last.title)}</div>` : ""}
              </div>`).join("")}
          </div>
        </div>`;
    },

    /** Open the full job detail modal — work performed, parts replaced (with
     *  per-part photo gallery + upload), cost breakdown, mechanic notes. */
    openJob(woId) {
      const w = D().findWO(woId);
      if (!w) return;
      const truck = D().findTruck(w.truckId);
      const mech = w.assignedMechanicId ? D().findPerson(w.assignedMechanicId) : null;
      const partsCost = w.partsUsed.reduce((s, pu) => {
        const unit = pu.unitPriceSar != null ? pu.unitPriceSar : (D().findPart(pu.partId)?.currentPriceSar || 0);
        return s + unit * pu.qty;
      }, 0);
      const laborCost = w.laborHours * w.laborRate;
      const total = w.actualCostSar ?? (partsCost + laborCost);
      const isDel = MT.isDelayed(w);
      const editable = w.status !== "completed" && w.status !== "cancelled";
      // Photo upload is allowed on completed jobs too (for retroactive
      // documentation of replaced parts) but not on cancelled jobs.
      const canUploadPhotos = w.status !== "cancelled";

      // ----- Header strip -----
      const headerStrip = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div><div class="field-label">${T("c.truck")}</div>
            <div class="font-medium">
              <a class="text-brand-600 cursor-pointer" onclick="window.app.closeModal(); window.app.navigate('/fleet/${truck.id}')">${truck.id}</a>
              · ${escapeHtml(lang()==='ar'?truck.plateAr:truck.plate)}
            </div></div>
          <div><div class="field-label">${T("c.status")}</div>
            <div>${isDel ? `<span class="pill pill-delayed"><span class="dot"></span>${T("mt.delayed")}</span>` : pill(w.status, T(`status.${w.status}`))}</div></div>
          <div><div class="field-label">${T("c.type")}</div><div>${T(`status.${w.type}`)}</div></div>
          <div><div class="field-label">${T("c.priority")}</div><div class="font-medium">${T(`status.${w.priority}`) || w.priority}</div></div>
          <div><div class="field-label">${T("c.mechanic")}</div><div>${mech ? escapeHtml(lang()==='ar'?mech.nameAr:mech.name) : '—'}</div></div>
          <div><div class="field-label">${T("c.opened")}</div><div>${new Date(w.openedAt).toLocaleDateString()}</div></div>
          <div><div class="field-label">${T("c.due")}</div>
            <div class="${isDel ? 'text-rose-600 font-semibold' : ''}">${new Date(w.dueBy).toLocaleDateString()}</div></div>
          <div><div class="field-label">${T("mt.odoAtService")}</div><div class="tabular">${fmtNum(w.odometerAtService)} km</div></div>
        </div>`;

      // ----- Work performed -----
      const workSection = `
        <div class="card p-3">
          <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.check()}${T("mt.workPerformed")}</h4>
          ${w.tasks.length === 0 ? `<p class="muted text-sm">—</p>` : `
            <ul class="space-y-1.5">
              ${w.tasks.map((tk, i) => `
                <li class="flex items-start gap-2 text-sm">
                  <button class="icon-btn" style="width:1.25rem;height:1.25rem;color:${tk.done?'#10b981':'rgb(var(--muted))'}" onclick="MT.toggleTask('${w.id}', ${i})" ${editable ? '' : 'disabled'}>
                    ${tk.done ? ICONS.check() : `<span style="width:.85rem;height:.85rem;border:1.5px solid currentColor;border-radius:.2rem;display:inline-block"></span>`}
                  </button>
                  <span class="${tk.done?'line-through muted':''}">${escapeHtml(lang()==='ar'?tk.ar:tk.en)}</span>
                </li>`).join("")}
            </ul>
            <div class="mt-3 text-xs muted">${w.tasks.filter(t=>t.done).length} / ${w.tasks.length} ${T("mt.tasksCompleted").toLowerCase()}</div>`}
        </div>`;

      // ----- Parts replaced (with photo gallery) -----
      const partsSection = `
        <div class="card p-3">
          <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.package()}${T("mt.partsReplacedTitle")}</h4>
          ${w.partsUsed.length === 0 ? `<p class="muted text-sm">${T("mt.noPartsUsed")}</p>` : `
            <div class="overflow-x-auto scroll-thin">
              <table class="tbl">
                <thead><tr>
                  <th>${T("c.part")}</th>
                  <th>${T("c.qty")}</th>
                  <th>${T("mt.unitPriceAtTime")}</th>
                  <th>${T("c.subtotal")}</th>
                  <th>${T("mt.photoOfOld")}</th>
                </tr></thead>
                <tbody>
                  ${w.partsUsed.map((pu, idx) => {
                    const p = D().findPart(pu.partId);
                    if (!p) return "";
                    const unit = pu.unitPriceSar != null ? pu.unitPriceSar : p.currentPriceSar;
                    const lineCost = unit * pu.qty;
                    const photos = pu.photos || [];
                    const photoCells = photos.map(ph => `
                      <span class="photo-thumb" onclick="MT.openLightbox('${w.id}', ${idx}, '${ph.id}')">
                        <img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/>
                        ${canUploadPhotos ? `<span class="x-btn" onclick="event.stopPropagation(); MT.removePhoto('${w.id}', ${idx}, '${ph.id}')">×</span>` : ""}
                      </span>`).join("");
                    return `<tr>
                      <td>
                        <div class="font-medium text-sm">${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</div>
                        <div class="text-[11px] muted font-mono">${p.sku}</div>
                      </td>
                      <td class="tabular">${pu.qty}</td>
                      <td class="tabular">${fmtSar(unit)}</td>
                      <td class="tabular font-medium">${fmtSar(lineCost)}</td>
                      <td>
                        <div class="photo-grid">
                          ${photoCells || `<span class="photo-empty">${T("mt.noPhotos")}</span>`}
                          ${canUploadPhotos && photos.length < 4 ? `
                            <button class="upload-btn" onclick="MT.uploadPhoto('${w.id}', ${idx})">${ICONS.upload()}${T("mt.uploadPhoto")}</button>` : ""}
                        </div>
                      </td>
                    </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>
            <p class="text-[11px] muted mt-2">${T("inv.appliedFromMaint")}</p>`}
        </div>`;

      // ----- Cost breakdown -----
      const costSection = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div class="card p-3"><div class="field-label">${T("mt.laborHrs")}</div><div class="text-lg font-semibold tabular">${w.laborHours}</div></div>
          <div class="card p-3"><div class="field-label">${T("mt.laborCost")}</div><div class="text-lg font-semibold tabular">${fmtSar(laborCost)}</div></div>
          <div class="card p-3"><div class="field-label">${T("mt.partsCost")}</div><div class="text-lg font-semibold tabular">${fmtSar(partsCost)}</div></div>
          <div class="card p-3"><div class="field-label">${T("mt.totalCost")}</div><div class="text-lg font-semibold tabular text-brand-600">${fmtSar(total)}</div>
            <div class="text-[10px] muted mt-0.5">${T("mt.estimated")}: ${fmtSar(w.estimatedCostSar)}</div>
          </div>
        </div>`;

      // ----- Mechanic notes (editable) -----
      const notesSection = `
        <div class="card p-3">
          <label class="field-label">${T("mt.mechanicNotes")}</label>
          ${editable
            ? `<textarea class="input w-full" id="wo-notes" style="height:4rem; padding:.5rem .75rem; resize:vertical">${escapeHtml(w.mechanicNotes || "")}</textarea>
               <div class="text-end mt-2"><button class="btn btn-outline" onclick="MT.saveNotes('${w.id}')">${ICONS.save()}${T("c.save")}</button></div>`
            : `<div class="text-sm">${escapeHtml(w.mechanicNotes || "—")}</div>`}
        </div>`;

      // ----- AI signal banner -----
      const aiSignal = w.predictiveSignal ? `
        <div class="rounded-lg border p-3" style="background:rgba(139,92,246,.06); border-color:rgba(139,92,246,.25)">
          <div class="text-[10px] uppercase tracking-wide font-semibold" style="color:#7c3aed">AI signal</div>
          <div class="text-sm mt-1">${escapeHtml(w.predictiveSignal)}</div>
        </div>` : "";

      const html = `
        <div class="space-y-4">
          ${headerStrip}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            ${workSection}
            ${notesSection}
          </div>
          ${partsSection}
          ${costSection}
          ${aiSignal}
        </div>`;

      const footer = `
        ${w.status === "open" ? btn({ label: T("mt.markInProg"), icon: ICONS.play(), variant: "outline", onclick: `MT.advance('${w.id}','in_progress')` }) : ""}
        ${(w.status === "in_progress" || w.status === "awaiting_parts") ? btn({ label: T("mt.markComplete"), icon: ICONS.check(), variant: "primary", onclick: `MT.advance('${w.id}','completed')` }) : ""}
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
      `;

      window.app.openModal({ title: `${w.id} — ${escapeHtml(lang()==='ar'?w.titleAr:w.title)}`, html, size: "lg", footer });
    },

    toggleTask(woId, idx) {
      const w = D().findWO(woId);
      if (!w) return;
      w.tasks[idx].done = !w.tasks[idx].done;
      this.openJob(woId);
    },

    advance(woId, to) {
      const w = D().findWO(woId);
      if (!w) return;
      w.status = to;
      // Deduct inventory the first time a WO enters "in_progress" (or skips
      // ahead directly to "completed" from "open" without ever being started).
      if ((to === "in_progress" || to === "completed") && !w.inventoryDeductedAt) {
        const cost = D().consumePartsForWO(w);
        if (cost > 0) window.app.toast(`${w.id} · ${T("mt.deducted")} · ${fmtSar(cost)}`);
      }
      if (to === "completed") {
        w.closedAt = new Date().toISOString();
        w.tasks.forEach(t => t.done = true);
        w.actualCostSar = w.estimatedCostSar;
      }
      window.app.toast(`${w.id} → ${T(`status.${to}`)}`);
      this.openJob(woId);
    },

    /** Persist mechanic notes from the modal textarea. */
    saveNotes(woId) {
      const w = D().findWO(woId);
      if (!w) return;
      const el = document.getElementById("wo-notes");
      if (!el) return;
      w.mechanicNotes = el.value || "";
      window.app.toast(lang() === "en" ? "Notes saved" : "تم حفظ الملاحظات");
    },

    /** A WO is "delayed" when it has not finished and dueBy is in the past. */
    isDelayed(w) {
      return w.status !== "completed" && w.status !== "cancelled" && new Date(w.dueBy) < TODAY;
    },

    setSection(s) {
      window.APP_STATE.mtSection = s;
      window.app.render();
    },

    toggleGroupByTruck() {
      const S = window.APP_STATE;
      S.mtGroupByTruckExplicit = !S.mtGroupByTruckExplicit;
      window.app.render();
    },

    toggleTruckExpand(truckId) {
      const S = window.APP_STATE;
      S.mtExpandedTrucks = S.mtExpandedTrucks || {};
      S.mtExpandedTrucks[truckId] = !S.mtExpandedTrucks[truckId];
      window.app.render();
    },

    /** In-House vs Out-Sourced track switch. */
    setTrack(t) {
      window.APP_STATE.mtTrack = t;
      // Reset the section filter to a sensible default for each track
      if (t === "out_sourced") window.APP_STATE.mtOsStatus = window.APP_STATE.mtOsStatus || "all";
      window.app.render();
    },
    setOsStatus(s) {
      window.APP_STATE.mtOsStatus = s;
      window.app.render();
    },

    /** Open the modal to create a new outsourced job (truck plate, repairer,
     *  invoices, descriptions). Title comes from D().trucks, same source as
     *  in-house jobs, so any newly added truck flows through automatically. */
    openNewOutsourced() {
      window.APP_STATE.osDraft = { chips: [], invoices: [] };
      const trucks = D().trucks;
      const today = ymd(new Date(2026, 4, 13));
      const truckOptions = trucks.map(tr => `<option value="${tr.id}" data-plate="${escapeHtml(tr.plate)}" data-plate-ar="${escapeHtml(tr.plateAr)}">${tr.id} · ${escapeHtml(lang()==='ar'?tr.plateAr:tr.plate)} · ${escapeHtml(tr.model)}</option>`).join("");
      const initialPlate = lang() === 'ar' ? trucks[0].plateAr : trucks[0].plate;

      const html = `
        <div class="space-y-3 os-form">
          <p class="text-sm muted">${lang()==='en'?'Log a job sent to an external repair shop. Inventory is not deducted (external shop sources parts).':'تسجيل عمل أُرسل إلى ورشة خارجية. المخزون الداخلي لا يُخصم.'}</p>

          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("c.truck")}</label>
              <select class="select w-full" id="osTruck" onchange="MT.onOsTruckChange()">${truckOptions}</select></div>
            <div><label class="field-label">${T("c.title")} <span class="muted text-[10px]">(${T("mt.titleAuto")})</span></label>
              <input id="osTitlePlate" class="input w-full" readonly value="${escapeHtml(initialPlate)}"/></div>
            <div><label class="field-label">${T("mt.startDate")}</label>
              <input type="date" class="input w-full" id="osStart" value="${today}"/></div>
            <div><label class="field-label">${T("c.type")}</label>
              <select class="select w-full" id="osType">
                <option value="preventive">${T("status.preventive")}</option>
                <option value="corrective" selected>${T("status.corrective")}</option>
                <option value="inspection">${T("status.inspection")}</option>
                <option value="predictive">${T("status.predictive")}</option>
              </select></div>
            <div><label class="field-label">${T("mt.repairerName")}</label>
              <input id="osRepairer" class="input w-full" placeholder="${T("mt.repairerName")}"/></div>
            <div><label class="field-label">${T("mt.repairerPhone")}</label>
              <input id="osPhone" class="input w-full" placeholder="+966 ..."/></div>
            <div><label class="field-label">${T("mt.estCost")}</label>
              <input id="osCost" class="input w-full" type="number" min="0" value="0"/></div>
          </div>

          <div>
            <label class="field-label">${T("mt.description")} <span class="muted text-[10px]">${T("mt.chipsHelp")}</span></label>
            <div id="os-chips" class="chip-strip">${MT.renderOsChips()}</div>
            <div class="flex gap-2 mt-2">
              <input id="os-new-chip" class="input flex-1" placeholder="${T("mt.addDescription")}" onkeydown="if(event.key==='Enter'){event.preventDefault();MT.addOsChip();}"/>
              <button type="button" class="btn btn-outline" onclick="MT.addOsChip()">${ICONS.plus()}${T("c.add")}</button>
            </div>
            <div class="mt-2">
              <label class="field-label">${T("mt.freeDesc")}</label>
              <textarea id="osNotes" class="input w-full" style="min-height:60px"></textarea>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="field-label !mb-0">${T("mt.invoices")}</label>
              <button type="button" class="btn btn-outline" onclick="MT.uploadInvoiceDraft()">${ICONS.upload()}${T("mt.addInvoice")}</button>
            </div>
            <div id="os-invoice-grid" class="invoice-gallery"></div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="MT.saveNewOutsourced()">${ICONS.save()}${T("c.save")}</button>`;
      window.app.openModal({ title: T("mt.newOutsourced"), html, footer, size: "lg" });
      setTimeout(() => { MT.onOsTruckChange(); MT.refreshOsInvoiceGrid(); }, 0);
    },

    onOsTruckChange() {
      const sel = document.getElementById("osTruck");
      const t = document.getElementById("osTitlePlate");
      if (!sel || !t) return;
      const opt = sel.options[sel.selectedIndex];
      t.value = lang() === 'ar' ? (opt.dataset.plateAr || "") : (opt.dataset.plate || "");
    },

    toggleOsChip(id) {
      const S = window.APP_STATE;
      S.osDraft = S.osDraft || { chips: [], invoices: [] };
      const idx = S.osDraft.chips.indexOf(id);
      if (idx >= 0) S.osDraft.chips.splice(idx, 1);
      else S.osDraft.chips.push(id);
      const root = document.getElementById("os-chips");
      if (root) root.innerHTML = MT.renderOsChips();
    },
    addOsChip() {
      const inp = document.getElementById("os-new-chip");
      if (!inp) return;
      const text = (inp.value || "").trim();
      if (!text) return;
      const id = `RD-X${Date.now().toString(36)}`;
      D().repairDescriptions.push({ id, en: text, ar: text });
      const S = window.APP_STATE;
      S.osDraft = S.osDraft || { chips: [], invoices: [] };
      S.osDraft.chips.push(id);
      inp.value = "";
      const root = document.getElementById("os-chips");
      if (root) root.innerHTML = MT.renderOsChips();
    },
    renderOsChips() {
      const S = window.APP_STATE;
      const selected = (S.osDraft && S.osDraft.chips) || [];
      return D().repairDescriptions.map(d => {
        const on = selected.includes(d.id);
        const label = escapeHtml(lang() === 'ar' ? d.ar : d.en);
        return `<button type="button" class="chip ${on ? 'chip-selected' : ''}" onclick="MT.toggleOsChip('${d.id}')">${on ? '✓ ' : ''}${label}</button>`;
      }).join("");
    },
    refreshOsInvoiceGrid() {
      const S = window.APP_STATE;
      const list = (S.osDraft && S.osDraft.invoices) || [];
      const root = document.getElementById("os-invoice-grid");
      if (!root) return;
      if (list.length === 0) {
        root.innerHTML = `<div class="muted text-sm">${T("mt.noInvoices")}</div>`;
        return;
      }
      root.innerHTML = list.map((inv, i) => MT.invoiceTile(inv, () => `MT.removeInvoiceDraft(${i})`, null)).join("");
    },
    /** Common invoice tile renderer (image thumb OR PDF icon). */
    invoiceTile(inv, removeOnclick, openOnclick) {
      const isPdf = (inv.mime || "").includes("pdf") || /\.pdf$/i.test(inv.name || "");
      const click = openOnclick ? `onclick="${openOnclick}"` : "";
      const body = isPdf
        ? `<div class="invoice-pdf"><span class="invoice-pdf-icon">PDF</span><span class="invoice-name">${escapeHtml(inv.name)}</span></div>`
        : `<img src="${inv.dataUrl}" alt="${escapeHtml(inv.name)}"/><span class="invoice-name">${escapeHtml(inv.name)}</span>`;
      return `<div class="invoice-tile" ${click}>
        ${body}
        ${removeOnclick ? `<span class="x-btn" onclick="event.stopPropagation(); ${removeOnclick()}">×</span>` : ""}
      </div>`;
    },
    /** Pick files (img / pdf) and stash data URLs into the modal draft. */
    uploadInvoiceDraft() {
      MT._uploadInvoice((inv) => {
        const S = window.APP_STATE;
        S.osDraft = S.osDraft || { chips: [], invoices: [] };
        S.osDraft.invoices.push(inv);
        MT.refreshOsInvoiceGrid();
      });
    },
    removeInvoiceDraft(i) {
      const S = window.APP_STATE;
      if (!S.osDraft) return;
      S.osDraft.invoices.splice(i, 1);
      MT.refreshOsInvoiceGrid();
    },
    /** Upload to an existing outsourced job (in the View modal). */
    uploadInvoice(osId) {
      MT._uploadInvoice((inv) => {
        const o = D().findOutsourced(osId);
        if (!o) return;
        o.invoices = o.invoices || [];
        o.invoices.push(inv);
        MT.openOutsourced(osId);
      });
    },
    removeInvoice(osId, invoiceId) {
      const o = D().findOutsourced(osId);
      if (!o) return;
      o.invoices = (o.invoices || []).filter(x => x.id !== invoiceId);
      MT.openOutsourced(osId);
    },
    _uploadInvoice(onAdded) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,application/pdf";
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      input.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        let added = 0;
        const total = files.length;
        files.forEach(file => {
          if (file.size > 2 * 1024 * 1024) {
            window.app.toast(T("mt.invoiceTooLarge"));
            added++;
            if (added === total) document.body.removeChild(input);
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            onAdded({
              id: `INV-${Date.now().toString(36)}-${Math.floor(Math.random()*1e5)}`,
              name: file.name,
              dataUrl: ev.target.result,
              mime: file.type,
              uploadedAt: new Date().toISOString(),
            });
            added++;
            if (added === total) document.body.removeChild(input);
          };
          reader.readAsDataURL(file);
        });
        if (total === 0) document.body.removeChild(input);
      };
      input.click();
    },

    saveNewOutsourced() {
      const S = window.APP_STATE;
      const draft = S.osDraft || { chips: [], invoices: [] };
      const truckId = document.getElementById("osTruck").value;
      const startDate = document.getElementById("osStart").value;
      const type = document.getElementById("osType").value;
      const repairerName = document.getElementById("osRepairer").value.trim();
      const repairerPhone = document.getElementById("osPhone").value.trim();
      const estimatedCostSar = +document.getElementById("osCost").value || 0;
      const notes = document.getElementById("osNotes").value || "";
      const truck = D().findTruck(truckId);
      if (!repairerName) {
        window.app.toast(lang() === 'en' ? "Please enter the repairer name" : "الرجاء إدخال اسم الفنّي");
        return;
      }
      const next = `OS-${String(D().outsourcedJobs.length + 1).padStart(4, "0")}`;
      D().outsourcedJobs.push({
        id: next, truckId,
        plate: truck.plate, plateAr: truck.plateAr,
        startDate, type,
        descriptionIds: draft.chips.slice(),
        descriptionsFreeText: notes,
        repairerName, repairerPhone,
        estimatedCostSar,
        status: "scheduled",
        invoices: draft.invoices.slice(),
        createdAt: new Date().toISOString(),
      });
      window.APP_STATE.osDraft = { chips: [], invoices: [] };
      window.app.toast(`${next} · ${T("status.scheduled")}`);
      window.app.closeModal();
      window.app.render();
    },

    /** View / edit an existing outsourced job. */
    openOutsourced(osId) {
      const o = D().findOutsourced(osId);
      if (!o) return;
      const truck = D().findTruck(o.truckId);
      const plate = lang()==='ar' ? (o.plateAr || truck?.plateAr) : (o.plate || truck?.plate);
      const descriptions = (o.descriptionIds || []).map(id => {
        const d = D().repairDescriptions.find(x => x.id === id);
        return d ? (lang()==='ar' ? d.ar : d.en) : null;
      }).filter(Boolean);

      const invoicesHtml = (o.invoices || []).length === 0
        ? `<div class="muted text-sm">${T("mt.noInvoices")}</div>`
        : (o.invoices || []).map(inv => {
            const isPdf = (inv.mime || "").includes("pdf") || /\.pdf$/i.test(inv.name || "");
            const open = isPdf
              ? `window.open('${inv.dataUrl}', '_blank')`
              : `MT.openInvoiceLightbox('${o.id}', '${inv.id}')`;
            return MT.invoiceTile(
              inv,
              () => `MT.removeInvoice('${o.id}', '${inv.id}')`,
              open
            );
          }).join("");

      const html = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><div class="field-label">${T("c.truck")}</div>
              <div class="font-medium"><a class="text-brand-600 cursor-pointer" onclick="window.app.closeModal(); window.app.navigate('/fleet/${truck.id}')">${truck.id}</a> · ${escapeHtml(plate)}</div></div>
            <div><div class="field-label">${T("c.status")}</div><div>${pill(o.status, T(`status.${o.status}`))}</div></div>
            <div><div class="field-label">${T("c.type")}</div><div>${T(`status.${o.type}`)}</div></div>
            <div><div class="field-label">${T("mt.startDate")}</div><div>${o.startDate}</div></div>
            <div><div class="field-label">${T("mt.repairerName")}</div><div class="font-medium">${escapeHtml(o.repairerName)}</div></div>
            <div><div class="field-label">${T("mt.repairerPhone")}</div><div>${escapeHtml(o.repairerPhone || '—')}</div></div>
            <div><div class="field-label">${T("mt.estCost")}</div><div class="tabular font-medium">${fmtSar(o.estimatedCostSar)}</div></div>
          </div>

          <div class="card p-3">
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.check()}${T("mt.description")}</h4>
            ${descriptions.length === 0 && !o.descriptionsFreeText
              ? `<p class="muted text-sm">—</p>`
              : `
                ${descriptions.length > 0 ? `<ul class="space-y-1.5">${descriptions.map(d => `<li class="text-sm">• ${escapeHtml(d)}</li>`).join("")}</ul>` : ""}
                ${o.descriptionsFreeText ? `<div class="text-sm mt-2 muted" style="white-space:pre-wrap">${escapeHtml(o.descriptionsFreeText)}</div>` : ""}
              `}
          </div>

          <div class="card p-3">
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-semibold text-sm flex items-center gap-2">${ICONS.package()}${T("mt.invoices")} <span class="muted text-xs font-normal">(${(o.invoices||[]).length})</span></h4>
              <button class="btn btn-outline" onclick="MT.uploadInvoice('${o.id}')">${ICONS.upload()}${T("mt.addInvoice")}</button>
            </div>
            <div class="invoice-gallery">${invoicesHtml}</div>
          </div>
        </div>`;
      const footer = `
        ${o.status === "scheduled" ? btn({ label: T("mt.markInProg"), icon: ICONS.play(), variant: "outline", onclick: `MT.advanceOs('${o.id}','in_progress')` }) : ""}
        ${o.status === "in_progress" ? btn({ label: T("mt.markComplete"), icon: ICONS.check(), variant: "primary", onclick: `MT.advanceOs('${o.id}','completed')` }) : ""}
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>`;
      window.app.openModal({ title: `${o.id} — ${escapeHtml(plate)}`, html, size: "lg", footer });
    },
    advanceOs(osId, to) {
      const o = D().findOutsourced(osId);
      if (!o) return;
      o.status = to;
      window.app.toast(`${o.id} → ${T(`status.${to}`)}`);
      MT.openOutsourced(osId);
    },
    openInvoiceLightbox(osId, invId) {
      const o = D().findOutsourced(osId);
      const inv = o && (o.invoices || []).find(i => i.id === invId);
      if (!inv) return;
      const html = `<div class="lightbox-wrap"><img src="${inv.dataUrl}" alt="${escapeHtml(inv.name)}"/></div>
        <div class="text-center text-xs muted mt-2">${escapeHtml(inv.name)} · ${new Date(inv.uploadedAt).toLocaleDateString()}</div>`;
      const footer = `<button class="btn btn-outline" onclick="MT.openOutsourced('${osId}')">${ICONS.arrowLeft()}${lang()==='en'?'Back':'العودة'}</button>`;
      window.app.openModal({ title: inv.name + " — " + T("mt.invoices"), html, footer });
    },

    expandAll(value) {
      const S = window.APP_STATE;
      S.mtExpandedTrucks = {};
      if (value) {
        // Populate with all truck ids currently visible
        D().workOrders.forEach(w => { S.mtExpandedTrucks[w.truckId] = true; });
      }
      window.app.render();
    },

    /** Trigger a file picker for a part-photo upload; on selection, read each
     *  file as a data URL and push into w.partsUsed[partIdx].photos[]. */
    uploadPhoto(woId, partIdx) {
      const w = D().findWO(woId);
      if (!w) return;
      const pu = w.partsUsed[partIdx];
      if (!pu) return;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      input.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        let remainingSlots = 4 - (pu.photos || []).length;
        if (remainingSlots <= 0) {
          window.app.toast(T("mt.photoCapReached"));
          document.body.removeChild(input);
          return;
        }
        const toRead = files.slice(0, remainingSlots);
        let processed = 0;
        toRead.forEach(file => {
          if (file.size > 2 * 1024 * 1024) {
            window.app.toast(T("mt.photoTooLarge"));
            processed++;
            if (processed === toRead.length) {
              document.body.removeChild(input);
              MT.openJob(woId);
            }
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            pu.photos = pu.photos || [];
            pu.photos.push({
              id: `PH-${Date.now().toString(36)}-${Math.floor(Math.random()*1e5)}`,
              name: file.name,
              dataUrl: ev.target.result,
              uploadedAt: new Date().toISOString(),
            });
            processed++;
            if (processed === toRead.length) {
              document.body.removeChild(input);
              MT.openJob(woId);
              window.app.toast(lang() === "en" ? `${toRead.length} photo(s) added` : `أُضيفت ${toRead.length} صورة`);
            }
          };
          reader.readAsDataURL(file);
        });
        if (toRead.length === 0) {
          document.body.removeChild(input);
        }
      };
      input.click();
    },

    removePhoto(woId, partIdx, photoId) {
      const w = D().findWO(woId);
      if (!w) return;
      const pu = w.partsUsed[partIdx];
      if (!pu || !pu.photos) return;
      pu.photos = pu.photos.filter(p => p.id !== photoId);
      this.openJob(woId);
    },

    /** Show a single photo full-size in a secondary modal. */
    openLightbox(woId, partIdx, photoId) {
      const w = D().findWO(woId);
      const pu = w && w.partsUsed[partIdx];
      const photo = pu && pu.photos && pu.photos.find(p => p.id === photoId);
      if (!photo) return;
      const part = D().findPart(pu.partId);
      const title = part ? (lang()==='ar' ? part.nameAr : part.name) : T("mt.photos");
      const html = `
        <div class="lightbox-wrap">
          <img src="${photo.dataUrl}" alt="${escapeHtml(photo.name)}"/>
        </div>
        <div class="text-center text-xs muted mt-2">${escapeHtml(photo.name)} · ${new Date(photo.uploadedAt).toLocaleDateString()}</div>`;
      const footer = `
        <button class="btn btn-outline" onclick="MT.openJob('${woId}')">${ICONS.arrowLeft()}${lang()==='en'?'Back to job':'العودة للعمل'}</button>`;
      window.app.openModal({ title: title + " — " + T("mt.photos"), html, footer });
    },

    /** Toggle a repair description chip in the new-WO draft state. */
    toggleChip(id) {
      const S = window.APP_STATE;
      S.njDraft = S.njDraft || { chips: [], parts: {} };
      const idx = S.njDraft.chips.indexOf(id);
      if (idx >= 0) S.njDraft.chips.splice(idx, 1);
      else S.njDraft.chips.push(id);
      const root = document.getElementById("nj-chips");
      if (root) root.innerHTML = MT.renderChips();
    },
    /** Add a brand-new description from the inline input; auto-select it. */
    addChip() {
      const inp = document.getElementById("nj-new-chip");
      if (!inp) return;
      const text = (inp.value || "").trim();
      if (!text) return;
      const id = `RD-X${Date.now().toString(36)}`;
      D().repairDescriptions.push({ id, en: text, ar: text });
      const S = window.APP_STATE;
      S.njDraft = S.njDraft || { chips: [], parts: {} };
      S.njDraft.chips.push(id);
      inp.value = "";
      const root = document.getElementById("nj-chips");
      if (root) root.innerHTML = MT.renderChips();
    },
    renderChips() {
      const S = window.APP_STATE;
      const selected = (S.njDraft && S.njDraft.chips) || [];
      return D().repairDescriptions.map(d => {
        const on = selected.includes(d.id);
        const label = escapeHtml(lang() === 'ar' ? d.ar : d.en);
        return `<button type="button" class="chip ${on ? 'chip-selected' : ''}" onclick="MT.toggleChip('${d.id}')">${on ? '✓ ' : ''}${label}</button>`;
      }).join("");
    },
    /** Adjust the qty draft for a part in the parts picker (handles +/- and direct input). */
    bumpPart(partId, delta) {
      const S = window.APP_STATE;
      S.njDraft = S.njDraft || { chips: [], parts: {} };
      const cur = S.njDraft.parts[partId] || 0;
      const next = Math.max(0, cur + delta);
      S.njDraft.parts[partId] = next;
      const el = document.getElementById(`nj-pq-${partId}`);
      if (el) el.value = next;
      MT.refreshPartsSummary();
    },
    setPartQty(partId, val) {
      const S = window.APP_STATE;
      S.njDraft = S.njDraft || { chips: [], parts: {} };
      const n = Math.max(0, parseInt(val, 10) || 0);
      S.njDraft.parts[partId] = n;
      MT.refreshPartsSummary();
    },
    refreshPartsSummary() {
      const S = window.APP_STATE;
      const draft = (S.njDraft && S.njDraft.parts) || {};
      const lines = Object.entries(draft).filter(([, q]) => q > 0);
      const total = lines.reduce((s, [pid, q]) => {
        const p = D().findPart(pid);
        return p ? s + p.currentPriceSar * q : s;
      }, 0);
      const el = document.getElementById("nj-parts-summary");
      if (!el) return;
      el.innerHTML = lines.length === 0
        ? `<span class="muted">${lang()==='en'?'No parts reserved yet':'لم تُحجز قطع بعد'}</span>`
        : `<b class="tabular">${lines.length}</b> ${lang()==='en'?'parts':'قطع'} · <b class="tabular">${fmtSar(total)}</b>`;
    },

    openNewJob() {
      // Reset draft state
      window.APP_STATE.njDraft = { chips: [], parts: {} };
      const trucks = D().trucks;
      const today = ymd(TODAY);
      const truckOptions = trucks.map(tr => `<option value="${tr.id}" data-plate="${escapeHtml(tr.plate)}" data-plate-ar="${escapeHtml(tr.plateAr)}">${tr.id} · ${escapeHtml(lang()==='ar'?tr.plateAr:tr.plate)} · ${escapeHtml(tr.model)}</option>`).join("");

      // Parts table grouped by category
      const parts = D().parts.slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      const byCat = {};
      parts.forEach(p => { (byCat[p.category] = byCat[p.category] || []).push(p); });
      const partsTable = Object.entries(byCat).map(([cat, items]) => `
        <tr class="parts-cat-row"><td colspan="5" class="parts-cat">${escapeHtml(cat)}</td></tr>
        ${items.map(p => `
          <tr>
            <td>
              <div class="font-medium text-sm">${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</div>
              <div class="text-[11px] muted font-mono">${p.sku}</div>
            </td>
            <td class="tabular">
              <span class="${p.qtyOnHand <= p.reorderLevel ? 'text-rose-600 font-semibold' : ''}">${p.qtyOnHand}</span>
              <span class="muted text-[11px]"> ${p.unit}</span>
            </td>
            <td class="tabular text-xs">${fmtSar(p.currentPriceSar)}</td>
            <td>
              <div class="qty-stepper">
                <button type="button" class="qty-btn" onclick="MT.bumpPart('${p.id}', -1)">−</button>
                <input id="nj-pq-${p.id}" class="qty-input" type="number" min="0" value="0" onchange="MT.setPartQty('${p.id}', this.value)"/>
                <button type="button" class="qty-btn" onclick="MT.bumpPart('${p.id}', 1)">+</button>
              </div>
            </td>
          </tr>
        `).join("")}
      `).join("");

      const initialPlate = lang() === 'ar' ? trucks[0].plateAr : trucks[0].plate;
      const html = `
        <div class="space-y-3 nj-form">
          <p class="text-sm muted">${lang()==='en'?'Schedule a new maintenance job. Inventory is reserved now and deducted when work starts.':'جدولة عمل صيانة جديد. تُحجز المخزون الآن ويُخصم عند بدء العمل.'}</p>

          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("c.truck")}</label>
              <select class="select w-full" id="njTruck" onchange="MT.onTruckChange()">${truckOptions}</select></div>
            <div><label class="field-label">${T("c.title")} <span class="muted text-[10px]">(${T("mt.titleAuto")})</span></label>
              <input id="njTitlePlate" class="input w-full" readonly value="${escapeHtml(initialPlate)}" /></div>
            <div><label class="field-label">${T("c.type")}</label>
              <select class="select w-full" id="njType">
                <option value="preventive">${T("status.preventive")}</option>
                <option value="corrective">${T("status.corrective")}</option>
                <option value="inspection">${T("status.inspection")}</option>
                <option value="predictive">${T("status.predictive")}</option>
              </select></div>
            <div><label class="field-label">${T("c.priority")}</label>
              <select class="select w-full" id="njPriority">
                <option value="low">${T("status.low")}</option>
                <option value="medium" selected>${T("status.medium")}</option>
                <option value="high">${T("status.high")}</option>
                <option value="critical">${T("status.critical")}</option>
              </select></div>
            <div><label class="field-label">${T("c.due")}</label>
              <input type="date" class="input w-full" id="njDue" value="${today}"/></div>
            <div><label class="field-label">${T("c.mechanic")}</label>
              <select class="select w-full" id="njMech">
                ${D().people.filter(p => p.role==='mechanic').map(p => `<option value="${p.id}">${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</option>`).join("")}
              </select></div>
          </div>

          <div>
            <label class="field-label">${T("mt.description")} <span class="muted text-[10px]">${T("mt.chipsHelp")}</span></label>
            <div id="nj-chips" class="chip-strip">${MT.renderChips()}</div>
            <div class="flex gap-2 mt-2">
              <input id="nj-new-chip" class="input flex-1" placeholder="${T("mt.addDescription")}" onkeydown="if(event.key==='Enter'){event.preventDefault();MT.addChip();}"/>
              <button type="button" class="btn btn-outline" onclick="MT.addChip()">${ICONS.plus()}${T("c.add")}</button>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="field-label !mb-0">${T("mt.partsAndEquipment")}</label>
              <span id="nj-parts-summary" class="text-xs"><span class="muted">${lang()==='en'?'No parts reserved yet':'لم تُحجز قطع بعد'}</span></span>
            </div>
            <p class="text-[11px] muted mb-2">${T("mt.partsHelp")}</p>
            <div class="parts-picker">
              <div class="overflow-y-auto scroll-thin" style="max-height: 280px">
                <table class="tbl">
                  <thead><tr>
                    <th>${T("c.part")}</th>
                    <th>${T("mt.onHand")}</th>
                    <th>${T("c.unitPrice") || T("mt.unitPriceAtTime")}</th>
                    <th>${T("c.qty")}</th>
                  </tr></thead>
                  <tbody>${partsTable}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="MT.saveNewJob()">${ICONS.save()}${T("c.save")}</button>`;
      window.app.openModal({ title: T("mt.addJob"), html, footer, size: "lg" });
      // Sync the title field to the initially-selected truck's plate
      setTimeout(() => MT.onTruckChange(), 0);
    },

    /** When the truck dropdown changes, copy that truck's plate into the
     *  Title field (Title = plate per the redesign). */
    onTruckChange() {
      const sel = document.getElementById("njTruck");
      const titleEl = document.getElementById("njTitlePlate");
      if (!sel || !titleEl) return;
      const opt = sel.options[sel.selectedIndex];
      titleEl.value = lang() === 'ar' ? (opt.dataset.plateAr || "") : (opt.dataset.plate || "");
    },

    saveNewJob() {
      const S = window.APP_STATE;
      const draft = S.njDraft || { chips: [], parts: {} };
      const truckId = document.getElementById("njTruck").value;
      const type = document.getElementById("njType").value;
      const priority = document.getElementById("njPriority").value;
      const due = document.getElementById("njDue").value;
      const mechanic = document.getElementById("njMech").value;
      const truck = D().findTruck(truckId);
      const next = `WO-${String(D().workOrders.length + 1).padStart(4, "0")}`;

      // Title = truck plate (en) — bilingual title stored for table cells.
      const title = `${lang()==='en' ? 'Maintenance' : 'صيانة'} — ${truck.plate}`;
      const titleAr = `صيانة — ${truck.plateAr}`;

      // Tasks come from the chip selections.
      const tasks = draft.chips.map(id => {
        const d = D().repairDescriptions.find(x => x.id === id);
        return d ? { en: d.en, ar: d.ar, done: false } : null;
      }).filter(Boolean);

      // Parts come from the picker. We DO NOT deduct yet — that happens on
      // transition to in_progress via consumePartsForWO().
      const partsUsed = Object.entries(draft.parts)
        .filter(([, q]) => q > 0)
        .map(([partId, qty]) => ({ partId, qty, unitPriceSar: D().findPart(partId).currentPriceSar, photos: [] }));

      const partsCost = partsUsed.reduce((s, pu) => s + pu.unitPriceSar * pu.qty, 0);
      const laborHours = 4, laborRate = 145;
      const estimatedCostSar = Math.round(partsCost + laborHours * laborRate);

      // Soft-warn if any line would overdraw stock.
      const overdraw = partsUsed.some(pu => {
        const p = D().findPart(pu.partId);
        return p && pu.qty > p.qtyOnHand;
      });

      D().workOrders.push({
        id: next, truckId, type, priority, status: "open",
        title, titleAr,
        openedAt: new Date().toISOString(),
        dueBy: new Date(due + "T08:00:00Z").toISOString(),
        assignedMechanicId: mechanic,
        estimatedCostSar, laborHours, laborRate,
        partsUsed, tasks,
        mechanicNotes: "",
        odometerAtService: truck.odometerKm,
        // inventoryDeductedAt is intentionally undefined until "Start Job"
      });
      // Clear the draft so the next "New WO" starts fresh.
      window.APP_STATE.njDraft = { chips: [], parts: {} };

      if (overdraw) {
        window.app.toast(T("mt.stockLowWarn"));
      } else {
        window.app.toast(`${next} · ${T("status.scheduled")}`);
      }
      window.app.closeModal();
      window.app.render();
    },
  };

  // ---------- Maintenance ----------
  // Today's reference date (matches the seeded data window).
  const TODAY = new Date(2026, 4, 13); // May 13, 2026

  /** Decide whether a WO belongs in a given workflow bucket. Delayed takes
   *  priority — a scheduled-but-overdue WO appears ONLY in Delayed. */
  function woInSection(w, section) {
    const delayed = MT.isDelayed(w);
    if (section === "delayed")     return delayed;
    if (section === "scheduled")   return w.status === "open" && !delayed;
    if (section === "in_progress") return (w.status === "in_progress" || w.status === "awaiting_parts") && !delayed;
    if (section === "completed")   return w.status === "completed" || w.status === "cancelled";
    return false;
  }

  function maintenance() {
    const S = window.APP_STATE;
    if (S.mtMonth == null) { S.mtMonth = TODAY.getMonth(); S.mtYear = TODAY.getFullYear(); }
    if (!S.mtSection) S.mtSection = "scheduled";
    if (!S.mtTruckFilter) S.mtTruckFilter = "all";
    if (S.mtGroupByTruckExplicit == null) S.mtGroupByTruckExplicit = true;
    if (!S.mtTrack) S.mtTrack = "in_house";
    if (!S.mtOsStatus) S.mtOsStatus = "all";

    const all = D().workOrders;
    const scheduledCount = all.filter(w => woInSection(w, "scheduled")).length;
    const inProgressCount = all.filter(w => woInSection(w, "in_progress")).length;
    const delayedCount = all.filter(w => woInSection(w, "delayed")).length;
    const completedCount = all.filter(w => woInSection(w, "completed")).length;
    const totalEst = all.filter(w => w.status !== "completed" && w.status !== "cancelled").reduce((s, w) => s + w.estimatedCostSar, 0);
    const completedCost = all.filter(w => w.status === "completed").reduce((s, w) => s + (w.actualCostSar ?? 0), 0);
    const osList = D().outsourcedJobs || [];
    const osCount = osList.length;

    // Per-truck filter list
    const trucksWithWO = Array.from(new Set(all.map(w => w.truckId)))
      .map(id => D().findTruck(id)).filter(Boolean).sort((a,b) => a.id.localeCompare(b.id));

    // Build the visible WO list for the active section, truck, and (optionally) selected day.
    let list = all.filter(w => woInSection(w, S.mtSection));
    if (S.mtTruckFilter !== "all") list = list.filter(w => w.truckId === S.mtTruckFilter);
    if (S.mtSelectedDate) {
      list = list.filter(w => {
        const key = S.mtSection === "completed"
          ? (w.closedAt || w.dueBy)
          : (S.mtSection === "in_progress" ? w.openedAt : w.dueBy);
        return new Date(key).toISOString().slice(0,10) === S.mtSelectedDate;
      });
    }
    list = list.sort((a, b) => new Date(a.dueBy) - new Date(b.dueBy));

    // ---- Table body (grouped vs flat) ----
    let tableBody = "";
    if (list.length === 0) {
      tableBody = `<tr><td colspan="7" class="text-center muted py-6">${T("mt.noJobsToday")}</td></tr>`;
    } else if (S.mtGroupByTruckExplicit && S.mtTruckFilter === "all") {
      // Group jobs by truckId in their existing sorted order.
      const byTruck = {};
      list.forEach(w => { (byTruck[w.truckId] = byTruck[w.truckId] || []).push(w); });
      const truckIds = Object.keys(byTruck).sort();
      const expanded = S.mtExpandedTrucks || {};
      tableBody = truckIds.map(tid => {
        const tr = D().findTruck(tid);
        const jobs = byTruck[tid];
        const isOpen = expanded[tid] !== false; // default expanded
        const counts = {
          sched: jobs.filter(j => woInSection(j, "scheduled")).length,
          prog: jobs.filter(j => woInSection(j, "in_progress")).length,
          delayed: jobs.filter(j => woInSection(j, "delayed")).length,
          done: jobs.filter(j => woInSection(j, "completed")).length,
        };
        const countsHTML = [
          counts.sched && `<span class="gc-pill gc-sched">${counts.sched} ${T("mt.scheduled")}</span>`,
          counts.prog  && `<span class="gc-pill gc-prog">${counts.prog} ${T("mt.inProgress")}</span>`,
          counts.delayed && `<span class="gc-pill gc-delayed">${counts.delayed} ${T("mt.delayed")}</span>`,
          counts.done  && `<span class="gc-pill gc-done">${counts.done} ${T("mt.completedJobs")}</span>`,
        ].filter(Boolean).join(" ");
        const groupHeader = `
          <tr class="group-row ${isOpen ? 'expanded' : ''}" onclick="MT.toggleTruckExpand('${tid}')">
            <td colspan="7">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="group-caret">${ICONS.chevronRight()}</span>
                <span class="font-mono">${tr?.id || tid}</span>
                <span class="muted">·</span>
                <span class="font-mono text-xs">${escapeHtml(tr ? (lang()==='ar'?tr.plateAr:tr.plate) : "")}</span>
                <span class="muted">·</span>
                <span class="text-xs muted">${escapeHtml(tr?.model || "")}</span>
                <span class="group-counts ms-auto">${countsHTML} <span class="muted text-[11px]">${jobs.length} ${T("mt.jobCount")}</span></span>
              </div>
            </td>
          </tr>`;
        const rows = isOpen ? jobs.map(mtFlatRow).join("") : "";
        return groupHeader + rows;
      }).join("");
    } else {
      tableBody = list.map(mtFlatRow).join("");
    }

    // ---- Out-Sourced track table body ----
    let osBody = "";
    if (S.mtTrack === "out_sourced") {
      let filtered = osList.slice();
      if (S.mtOsStatus !== "all") filtered = filtered.filter(o => o.status === S.mtOsStatus);
      if (S.mtTruckFilter !== "all") filtered = filtered.filter(o => o.truckId === S.mtTruckFilter);
      filtered.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
      osBody = filtered.length === 0
        ? `<tr><td colspan="7" class="text-center muted py-6">${T("mt.weekNoJobs")}</td></tr>`
        : filtered.map(o => {
            const truck = D().findTruck(o.truckId);
            const plate = lang()==='ar' ? (o.plateAr || truck?.plateAr) : (o.plate || truck?.plate);
            return `<tr style="cursor:pointer" onclick="MT.openOutsourced('${o.id}')">
              <td class="font-mono text-xs">${o.id}</td>
              <td class="font-mono text-xs">${truck?.id || o.truckId} · ${escapeHtml(plate || '')}</td>
              <td>${escapeHtml(o.repairerName)} <div class="text-[11px] muted">${escapeHtml(o.repairerPhone || '')}</div></td>
              <td>${T(`status.${o.type}`)}</td>
              <td class="text-xs">${o.startDate}</td>
              <td>${pill(o.status, T(`status.${o.status}`))}</td>
              <td class="tabular">${fmtSar(o.estimatedCostSar)} <span class="muted text-[11px]">· ${(o.invoices||[]).length} ${T("mt.invoices")}</span></td>
              <td>${btn({ label: T("mt.viewJob"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); MT.openOutsourced('${o.id}')` })}</td>
            </tr>`;
          }).join("");
    }

    const osStatusCounts = {
      all: osList.length,
      scheduled: osList.filter(o => o.status === "scheduled").length,
      in_progress: osList.filter(o => o.status === "in_progress").length,
      completed: osList.filter(o => o.status === "completed").length,
    };

    return `
      ${pageHeader({
        title: T("nav.maintenance"),
        subtitle: T("c.pmHelp"),
        actions: (S.mtTrack === "out_sourced"
          ? btn({ label: T("mt.newOutsourced"), icon: ICONS.plus(), variant: "primary", onclick: "MT.openNewOutsourced()" })
          : btn({ label: T("c.newWO"), icon: ICONS.plus(), variant: "primary", onclick: "MT.openNewJob()" }))
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        ${stat({ label: T("mt.scheduled"), value: scheduledCount, tone: "info" })}
        ${stat({ label: T("mt.inProgress"), value: inProgressCount, tone: "warn" })}
        ${stat({ label: T("mt.delayed"), value: delayedCount, tone: delayedCount > 0 ? "bad" : "ok" })}
        ${stat({ label: T("mt.outsourcedJobs"), value: osCount, tone: "info" })}
      </div>

      <!-- Week strip -->
      ${MT.calendar(S.mtYear, S.mtMonth, S.mtTruckFilter, S.mtSelectedDate)}

      <!-- Track switch: In-House vs Out-Sourced -->
      <div class="track-switch mb-3">
        <button class="track-tab ${S.mtTrack === 'in_house' ? 'active' : ''}" onclick="MT.setTrack('in_house')">
          ${ICONS.wrench()} ${T("mt.inHouse")}
          <span class="muted ms-1">(${all.length})</span>
        </button>
        <button class="track-tab ${S.mtTrack === 'out_sourced' ? 'active' : ''}" onclick="MT.setTrack('out_sourced')">
          ${ICONS.package()} ${T("mt.outsourced")}
          <span class="muted ms-1">(${osCount})</span>
        </button>
      </div>

      ${S.mtTrack === "in_house" ? `
        <!-- In-House: section tabs + truck filter + jobs table -->
        <div class="card mb-4 overflow-hidden">
          <div class="flex items-end gap-1 px-3 pt-2 border-b border-app flex-wrap">
            ${[["scheduled",   T("mt.scheduled"),   scheduledCount],
               ["in_progress", T("mt.inProgress"),  inProgressCount],
               ["delayed",     T("mt.delayed"),     delayedCount],
               ["completed",   T("mt.historical"),  completedCount]].map(([k, lbl, n]) => `
              <button class="subtab ${S.mtSection === k ? 'active' : ''}" onclick="MT.setSection('${k}')">
                ${lbl} <span class="muted ms-1">(${n})</span>
              </button>`).join("")}
            <div class="ms-auto mt-toolbar" style="margin-top:0">
              <span class="muted text-xs">${T("c.truck")}:</span>
              <select class="select" onchange="window.APP_STATE.mtTruckFilter=this.value; window.app.render()">
                <option value="all" ${S.mtTruckFilter==='all'?'selected':''}>${T("c.all")} (${all.length})</option>
                ${trucksWithWO.map(tr => {
                  const count = all.filter(w => w.truckId === tr.id).length;
                  return `<option value="${tr.id}" ${S.mtTruckFilter===tr.id?'selected':''}>${tr.id} · ${escapeHtml(lang()==='ar'?tr.plateAr:tr.plate)} (${count})</option>`;
                }).join("")}
              </select>
              ${S.mtTruckFilter === "all" ? `
                <label class="btn-chip ${S.mtGroupByTruckExplicit ? 'active' : ''}" style="cursor:pointer" onclick="MT.toggleGroupByTruck()">
                  ${T("mt.groupByTruck")}
                </label>` : ""}
              ${S.mtSelectedDate ? `<button class="btn btn-outline" onclick="window.APP_STATE.mtSelectedDate=null; window.app.render()">${ICONS.x()}${escapeHtml(S.mtSelectedDate)}</button>` : ""}
            </div>
          </div>

          <div class="overflow-x-auto scroll-thin">
            <table class="tbl">
              <thead><tr>
                <th>WO</th>
                ${(S.mtGroupByTruckExplicit && S.mtTruckFilter === "all") ? "" : `<th>${T("c.truck")}</th>`}
                <th>${T("c.title")}</th>
                <th>${T("c.mechanic")}</th>
                <th>${S.mtSection === "completed" ? T("c.opened") : T("c.due")}</th>
                <th>${T("c.status")}</th>
                <th>${T("c.estCost")}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${tableBody}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        <!-- Out-Sourced: status filter + jobs table -->
        <div class="card mb-4 overflow-hidden">
          <div class="flex items-end gap-1 px-3 pt-2 border-b border-app flex-wrap">
            ${[["all",          T("c.all"),            osStatusCounts.all],
               ["scheduled",    T("mt.scheduled"),     osStatusCounts.scheduled],
               ["in_progress",  T("mt.inProgress"),    osStatusCounts.in_progress],
               ["completed",    T("mt.historical"),    osStatusCounts.completed]].map(([k, lbl, n]) => `
              <button class="subtab ${S.mtOsStatus === k ? 'active' : ''}" onclick="MT.setOsStatus('${k}')">
                ${lbl} <span class="muted ms-1">(${n})</span>
              </button>`).join("")}
            <div class="ms-auto mt-toolbar" style="margin-top:0">
              <span class="muted text-xs">${T("c.truck")}:</span>
              <select class="select" onchange="window.APP_STATE.mtTruckFilter=this.value; window.app.render()">
                <option value="all" ${S.mtTruckFilter==='all'?'selected':''}>${T("c.all")} (${osList.length})</option>
                ${Array.from(new Set(osList.map(o => o.truckId))).map(tid => {
                  const tr = D().findTruck(tid);
                  if (!tr) return "";
                  const count = osList.filter(o => o.truckId === tid).length;
                  return `<option value="${tid}" ${S.mtTruckFilter===tid?'selected':''}>${tr.id} · ${escapeHtml(lang()==='ar'?tr.plateAr:tr.plate)} (${count})</option>`;
                }).join("")}
              </select>
            </div>
          </div>

          <div class="overflow-x-auto scroll-thin">
            <table class="tbl">
              <thead><tr>
                <th>OS</th>
                <th>${T("c.truck")}</th>
                <th>${T("mt.repairerName")}</th>
                <th>${T("c.type")}</th>
                <th>${T("mt.startDate")}</th>
                <th>${T("c.status")}</th>
                <th>${T("mt.estCost")}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${osBody}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;
  }

  /** Slim "flat" job row. Truck cell is hidden when the table is grouped. */
  function mtFlatRow(w) {
    const S = window.APP_STATE;
    const grouped = S.mtGroupByTruckExplicit && S.mtTruckFilter === "all";
    const truck = D().findTruck(w.truckId);
    const mech = w.assignedMechanicId ? D().findPerson(w.assignedMechanicId) : null;
    const delayed = MT.isDelayed(w);
    const dateField = S.mtSection === "completed" ? w.openedAt : w.dueBy;
    const statusBadge = delayed
      ? `<span class="pill pill-delayed"><span class="dot"></span>${T("mt.delayed")}</span>`
      : pill(w.status, T(`status.${w.status}`));
    const truckCell = grouped ? "" : `<td class="font-mono text-xs">${truck?.id} · ${escapeHtml(lang()==='ar'?truck?.plateAr:truck?.plate)}</td>`;
    return `
      <tr style="cursor:pointer" onclick="MT.openJob('${w.id}')">
        <td class="font-mono text-xs">${w.id}</td>
        ${truckCell}
        <td>
          <div class="flex items-center gap-2">
            ${w.type === "predictive" ? `<span class="text-[10px] rounded px-1.5 py-0.5 font-medium" style="background:rgba(139,92,246,.12);color:#7c3aed">AI</span>` : ""}
            <span class="font-medium">${escapeHtml(lang()==='ar'?w.titleAr:w.title)}</span>
          </div>
        </td>
        <td class="text-xs">${mech ? escapeHtml(lang()==='ar'?mech.nameAr:mech.name) : '<span class="muted">—</span>'}</td>
        <td class="text-xs ${delayed ? 'text-rose-600 font-medium' : ''}">${delayed ? `<span class="me-1">${ICONS.alert()}</span>` : ''}${new Date(dateField).toLocaleDateString()}</td>
        <td>${statusBadge}</td>
        <td class="tabular">${fmtSar(w.estimatedCostSar)}</td>
        <td>${btn({ label: T("mt.viewJob"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); MT.openJob('${w.id}')` })}</td>
      </tr>`;
  }

  // ---------- Predictive ----------
  function predictive() {
    const alerts = D().predictiveAlerts;
    const critical = alerts.filter(a => a.severity === "critical");
    const warning = alerts.filter(a => a.severity === "warning");
    const info = alerts.filter(a => a.severity === "info");
    const avgConf = +(alerts.reduce((s, a) => s + a.confidencePct, 0) / Math.max(1, alerts.length)).toFixed(1);
    const savings = critical.length * 12500 + warning.length * 5500 + info.length * 1200;

    setTimeout(() => {
      const scatter = D().trucks.map(t => ({ x: t.healthScore, y: t.iot.vibrationRms }));
      drawScatter("hvChart", scatter);
    }, 0);

    return `
      ${pageHeader({
        title: T("nav.predictive"),
        subtitle: T("c.predSubtitle"),
        actions: btn({ label: lang()==='en'?"Model v3.2":"النموذج 3.2", icon: ICONS.cpu(), variant: "outline" })
              + btn({ label: T("c.rerun"), icon: ICONS.sparkles(), variant: "primary", onclick: "alert('Demo: re-run analysis')" })
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        ${stat({ label: T("c.criticalPredAlerts"), value: critical.length, tone: "bad" })}
        ${stat({ label: lang()==='en'?"Warnings":"تحذيرات", value: warning.length, tone: "warn" })}
        ${stat({ label: T("c.avgConfidence"), value: `${avgConf}%`, tone: "info" })}
        ${stat({ label: T("c.estSavings"), value: fmtSar(savings), sub: T("c.reactive"), tone: "ok" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 card p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold flex items-center gap-2"><span style="color:#8b5cf6">${ICONS.brain()}</span>${T("c.activeAlerts")}</h3>
            <span class="text-xs muted">${alerts.length} ${lang()==='en'?'alerts':'تنبيه'}</span>
          </div>
          <div class="space-y-2 max-h-[520px] overflow-auto scroll-thin pe-1">
            ${alerts.map(a => {
              const truck = D().findTruck(a.truckId);
              const c = a.severity === "critical" ? "background:rgba(244,63,94,.05); border-color:rgba(244,63,94,.3)" :
                        a.severity === "warning" ? "background:rgba(245,158,11,.05); border-color:rgba(245,158,11,.3)" : "";
              const icCls = a.severity === "critical" ? "background:rgba(244,63,94,.1); color:#be123c" :
                            a.severity === "warning" ? "background:rgba(245,158,11,.12); color:#b45309" : "background:rgba(59,130,246,.12); color:#1d4ed8";
              return `
              <div class="rounded-lg border p-3" style="${c}">
                <div class="flex items-start gap-3">
                  <div class="h-9 w-9 rounded-lg grid place-items-center shrink-0" style="${icCls}">${ICONS.alert()}</div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                      <div class="font-medium">${a.truckId} · ${escapeHtml(lang()==='ar'?a.componentAr:a.component)}
                        <span class="muted text-xs ms-2 font-normal">(${escapeHtml(truck?.model || "")})</span>
                      </div>
                      <div class="flex items-center gap-2">
                        ${pill(a.severity, T(`status.${a.severity}`))}
                        <span class="text-xs font-medium tabular">${a.confidencePct}% ${T("c.confidence")}</span>
                      </div>
                    </div>
                    <div class="text-xs muted mt-1"><span class="font-medium">${T("c.signal")}:</span> ${escapeHtml(lang()==='ar'?a.signalAr:a.signal)}</div>
                    <div class="text-sm mt-2"><span class="font-medium">${T("c.recommended")}:</span> ${escapeHtml(lang()==='ar'?a.recommendedActionAr:a.recommendedAction)}</div>
                    <div class="flex items-center justify-between mt-2 text-xs">
                      <span class="muted">${T("c.failureIn")}: <b>${a.predictedFailureInDays} ${T("c.days")}</b></span>
                      <div class="flex gap-2">
                        ${btn({ label: T("c.dismiss"), variant: "outline" })}
                        ${btn({ label: T("c.createWO"), variant: "primary", onclick: "alert('Demo: WO created')" })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;
            }).join("")}
          </div>
        </div>

        <div class="space-y-4">
          ${section({
            title: T("c.modelPerf"),
            body: `<div class="space-y-3">
              ${perfRow(T("c.precision"), 92.4)}
              ${perfRow(T("c.recall"), 88.7)}
              ${perfRow(T("c.f1"), 90.5)}
              ${perfRow(T("c.meanLead"), 73, 100, "d")}
            </div>
            <div class="text-[11px] muted mt-3 leading-relaxed">${T("c.modelTrained")}</div>`
          })}
          ${section({
            title: T("c.healthVibration"),
            body: `<div class="h-48"><canvas id="hvChart"></canvas></div>
              <div class="text-[11px] muted mt-1">${T("c.highVibPattern")}</div>`
          })}
        </div>
      </div>
    `;
  }
  function perfRow(label, value, max = 100, suffix = "%") {
    return `<div>
      <div class="flex justify-between text-xs mb-1"><span>${label}</span><span class="font-medium tabular">${value}${suffix}</span></div>
      ${bar(value, max, "ok")}
    </div>`;
  }
  function drawScatter(id, points) {
    const el = document.getElementById(id); if (!el) return;
    if (window.__charts && window.__charts[id]) window.__charts[id].destroy();
    window.__charts = window.__charts || {};
    window.__charts[id] = new Chart(el, {
      type: "scatter",
      data: { datasets: [{ data: points, backgroundColor: "#0b7eea", pointRadius: 4 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: lang()==='en'?"Health":"الحالة", color:"#64748b", font:{size:10} }, grid: { color: "#eef2f7" }, ticks: { font: { size: 10 } } },
                  y: { title: { display: true, text: lang()==='en'?"Vibration (mm/s)":"اهتزاز (mm/s)", color:"#64748b", font:{size:10} }, grid: { color: "#eef2f7" }, ticks: { font: { size: 10 } } } }
      }
    });
  }

  // ---------- IoT ----------
  function iot() {
    const ts = D().trucks;
    const online = ts.filter(t => t.status !== "out_of_service").length;
    const overheat = ts.filter(t => t.iot.engineTempC > 95).length;
    const lowOil = ts.filter(t => t.iot.oilPressureKpa < 350).length;
    const tireIssues = ts.filter(t => Math.min(t.iot.tirePressureBarFL, t.iot.tirePressureBarFR, t.iot.tirePressureBarRL, t.iot.tirePressureBarRR) < 7.5).length;
    const lowBat = ts.filter(t => t.iot.batteryV < 12.5).length;
    const highVib = ts.filter(t => t.iot.vibrationRms > 4.5).length;

    return `
      ${pageHeader({
        title: T("nav.iot"),
        subtitle: T("c.iotSubtitle"),
        actions: btn({ label: T("c.liveIoT"), icon: ICONS.activity(), variant: "primary" })
      })}

      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        ${stat({ label: T("c.trucksOnline"), value: `${online}/${ts.length}`, tone: "ok" })}
        ${stat({ label: T("c.overheating"), value: overheat, tone: overheat > 0 ? "bad" : "ok" })}
        ${stat({ label: T("c.lowOil"), value: lowOil, tone: lowOil > 0 ? "warn" : "ok" })}
        ${stat({ label: T("c.tireIssues"), value: tireIssues, tone: tireIssues > 0 ? "warn" : "ok" })}
        ${stat({ label: T("c.lowBattery"), value: lowBat, tone: lowBat > 0 ? "warn" : "ok" })}
        ${stat({ label: T("c.highVib"), value: highVib, tone: highVib > 0 ? "warn" : "ok" })}
      </div>

      ${section({
        title: T("c.liveSensors"),
        action: `<span class="text-xs muted flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-emerald-500 pulse-dot"></span>${T("c.streaming")}</span>`,
        body: `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          ${ts.slice(0, 16).map(tr => {
            const tempBad = tr.iot.engineTempC > 95;
            const oilBad = tr.iot.oilPressureKpa < 350;
            const battBad = tr.iot.batteryV < 12.5;
            const vibBad = tr.iot.vibrationRms > 4.5;
            return `
            <div class="rounded-xl border border-app p-3 cursor-pointer hover:shadow-md transition" onclick="window.app.navigate('/fleet/${tr.id}')">
              <div class="flex items-center justify-between mb-2">
                <div><div class="font-mono text-xs muted">${tr.id}</div><div class="font-semibold text-sm">${escapeHtml(lang()==='ar'?tr.plateAr:tr.plate)}</div></div>
                <div class="flex items-center gap-1 text-xs">
                  <span class="${tr.status === 'out_of_service' ? 'text-rose-500' : 'text-emerald-500'}">${ICONS.wifi()}</span>
                  <span class="muted">${tr.iot.speedKph} km/h</span>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-1.5 text-xs">
                ${sensor(ICONS.thermo(), `${tr.iot.engineTempC}°C`, tempBad)}
                ${sensor(ICONS.gauge(), `${tr.iot.oilPressureKpa} kPa`, oilBad)}
                ${sensor(ICONS.battery(), `${tr.iot.batteryV}V`, battBad)}
                ${sensor(ICONS.zap(), `${tr.iot.vibrationRms} mm/s`, vibBad)}
                ${sensor(ICONS.droplet(), `${tr.iot.tankLevelPct}% ${lang()==='en'?'tank':'خزان'}`)}
                ${sensor(ICONS.fuel(), `${tr.iot.fuelLevelPct}% ${lang()==='en'?'fuel':'وقود'}`, tr.iot.fuelLevelPct < 25)}
              </div>
              <div class="mt-2 text-[10px] muted text-end">${T("c.updated")}: 8s</div>
            </div>`;
          }).join("")}
        </div>`
      })}
    `;
  }
  function sensor(icon, label, bad) {
    const cls = bad ? "background:rgba(244,63,94,.10); color:#be123c" : "background:rgba(0,0,0,.04)";
    return `<div class="flex items-center gap-1.5 px-2 py-1 rounded-md" style="${cls}"><span>${icon}</span><span class="tabular truncate">${escapeHtml(label)}</span></div>`;
  }

  // ---------- Inventory ----------
  window.INV = {
    /** Open part detail drawer (modal).
     *  Sections: identity → pricing snapshot → stock batches (qtyPurchased
     *  vs qtyRemaining vs status) → maintenance usage log → reorder info. */
    openPart(partId) {
      const p = D().findPart(partId);
      if (!p) return;
      const usage = D().partUsage[partId] || [];
      const totalUsed = usage.reduce((s, u) => s + u.qty, 0);
      const totalUsedCost = usage.reduce((s, u) => s + u.costSar, 0);
      const avg = D().partAvgCost(p);
      const totalValue = p.priceTiers.reduce((s, t) => s + t.qty * t.priceSar, 0);
      const priceDeltaPct = p.previousPriceSar != null
        ? +(((p.currentPriceSar - p.previousPriceSar) / p.previousPriceSar) * 100).toFixed(1)
        : null;
      const low = p.qtyOnHand <= p.reorderLevel;

      // Stock batches with qtyPurchased + qtyRemaining + status badge
      const batchesHTML = `
        <table class="tbl batch-tbl">
          <thead><tr>
            <th>${T("inv.receivedOn")}</th>
            <th>${T("inv.qtyPurchased")}</th>
            <th>${T("inv.qtyRemaining")}</th>
            <th>${T("c.unitCost")}</th>
            <th>${T("c.subtotal")}</th>
            <th>${T("c.status")}</th>
          </tr></thead>
          <tbody>
            ${p.priceTiers.map((t, i) => {
              const isCurrent = i === p.priceTiers.length - 1;
              const purchased = t.qtyPurchased != null ? t.qtyPurchased : t.qty;
              const remaining = t.qty;
              const depleted = remaining === 0;
              let badge, badgeCls;
              if (depleted) { badge = T("inv.depleted"); badgeCls = "tier-exhausted"; }
              else if (isCurrent) { badge = T("inv.currentBatch"); badgeCls = "tier-new"; }
              else { badge = T("inv.oldBatch"); badgeCls = "tier-old"; }
              const subtotal = remaining * t.priceSar;
              return `<tr class="${depleted ? 'tier-depleted' : ''}">
                <td class="text-xs">${t.receivedOn}</td>
                <td class="tabular">${purchased} ${p.unit}</td>
                <td class="tabular ${depleted ? '' : 'font-semibold'}">${remaining} ${p.unit}</td>
                <td class="tabular">${fmtSar(t.priceSar)}</td>
                <td class="tabular">${fmtSar(subtotal)}</td>
                <td><span class="tier-badge ${badgeCls}">${badge}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;

      // Maintenance usage log
      const usageHTML = usage.length === 0
        ? `<p class="muted text-sm">${lang()==='en'?'No consumption recorded yet.':'لا توجد عمليات استهلاك مسجلة بعد.'}</p>`
        : `<table class="tbl">
            <thead><tr>
              <th>${T("c.date")}</th>
              <th>${T("inv.woRef")}</th>
              <th>${T("c.truck")}</th>
              <th>${T("c.qty")}</th>
              <th>${T("c.unitCost")}</th>
              <th>${T("c.cost")}</th>
            </tr></thead>
            <tbody>
              ${usage.slice().reverse().slice(0, 20).map(u => `<tr>
                <td class="text-xs">${new Date(u.date).toLocaleDateString()}</td>
                <td class="font-mono text-xs"><a class="text-brand-600 cursor-pointer" onclick="window.app.closeModal(); MT.openJob('${u.woId}')">${u.woId}</a></td>
                <td class="font-mono text-xs">${u.truckId}</td>
                <td class="tabular">${u.qty}</td>
                <td class="tabular">${fmtSar(u.unitPriceSar != null ? u.unitPriceSar : (u.qty > 0 ? u.costSar/u.qty : 0))}</td>
                <td class="tabular">${fmtSar(u.costSar)}</td>
              </tr>`).join("")}
            </tbody></table>`;

      const html = `
        <div class="space-y-4">
          <!-- Identity -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div class="card p-3">
              <div class="field-label">${T("c.sku")}</div>
              <div class="font-mono text-sm">${p.sku}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("c.category")}</div>
              <div>${T(`cat.${p.category}`)}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("c.warehouse")}</div>
              <div>${depotLabel(p.warehouse)}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("c.supplier")}</div>
              <div class="text-xs">${escapeHtml(p.supplier)}</div>
            </div>
          </div>

          <!-- Pricing snapshot + Stock health -->
          <div class="card p-4">
            <h4 class="font-semibold text-sm mb-3 flex items-center gap-2">${ICONS.money()}${T("inv.priceSnapshot")}</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div class="field-label">${T("inv.currPrice")}</div>
                <div class="text-xl font-semibold tabular text-brand-600">${fmtSar(p.currentPriceSar)}</div>
                <div class="text-[11px] muted">${lang()==='en'?'per':'لكل'} ${p.unit}</div>
              </div>
              <div>
                <div class="field-label">${T("inv.prevPrice")}</div>
                <div class="text-xl font-semibold tabular">${p.previousPriceSar != null ? `<span class="line-through muted">${fmtSar(p.previousPriceSar)}</span>` : '<span class="muted">—</span>'}</div>
                ${priceDeltaPct != null
                  ? `<div class="text-[11px] ${priceDeltaPct > 0 ? 'delta-up' : 'delta-down'} font-semibold">${priceDeltaPct > 0 ? '↑' : '↓'} ${Math.abs(priceDeltaPct)}%</div>`
                  : `<div class="text-[11px] muted">${lang()==='en'?'Single tier':'دفعة وحيدة'}</div>`}
              </div>
              <div>
                <div class="field-label">${T("inv.avgCost")}</div>
                <div class="text-xl font-semibold tabular">${fmtSar(avg)}</div>
                <div class="text-[11px] muted">${T("inv.stockValue")}: ${fmtSar(totalValue)}</div>
              </div>
              <div>
                <div class="field-label">${T("inv.stockLabel")}</div>
                <div class="text-xl font-semibold tabular ${low ? 'text-rose-600' : ''}">${p.qtyOnHand} ${p.unit}</div>
                <div class="text-[11px] ${low ? 'text-rose-600' : 'muted'}">${low ? T("inv.belowReorder") : T("inv.inStock")} · ${T("inv.reorderAt")} ${p.reorderLevel}</div>
              </div>
            </div>
            <div class="text-[11px] muted mt-3">${T("inv.olderStillActive")}</div>
          </div>

          <!-- Stock batches -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-semibold text-sm flex items-center gap-2">${ICONS.boxes()}${T("inv.batchesTitle")}</h4>
              <button class="btn btn-outline" onclick="INV.openPriceLot('${p.id}')">${ICONS.plus()}${T("inv.addNewPrice")}</button>
            </div>
            <div class="overflow-x-auto scroll-thin">${batchesHTML}</div>
            <div class="text-[11px] muted mt-2">${T("inv.legendOld")} · ${T("inv.legendNew")}</div>
          </div>

          <!-- Maintenance usage log -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-semibold text-sm flex items-center gap-2">${ICONS.list()}${T("inv.consumedBy")}</h4>
              <span class="text-[11px] muted">${T("inv.totalUsed")}: <b class="tabular">${totalUsed} ${p.unit}</b> · ${fmtSar(totalUsedCost)}</span>
            </div>
            ${usageHTML}
          </div>

          <!-- Financial summary (per-part) + AI insight -->
          ${(() => {
            const fin = D().partFinance(p.id);
            const trendCls = fin.priceTrendPct > 0 ? "delta-up" : fin.priceTrendPct < 0 ? "delta-down" : "muted";
            const trendArrow = fin.priceTrendPct > 0 ? "↑" : fin.priceTrendPct < 0 ? "↓" : "→";
            // Per-part AI tip
            const aiTip = (() => {
              if (p.qtyOnHand <= p.reorderLevel * 0.5)
                return { tone: "bad", text: lang()==='en'
                  ? `Stock critical — only ${p.qtyOnHand} ${p.unit} left vs reorder level of ${p.reorderLevel}. Recommend issuing a PO of ${p.reorderQty} ${p.unit} immediately.`
                  : `المخزون حرج — يتبقى ${p.qtyOnHand} ${p.unit} مقابل حد إعادة طلب ${p.reorderLevel}. يُوصى بإصدار أمر شراء بكمية ${p.reorderQty} ${p.unit} فورًا.` };
              if (fin.priceTrendPct >= 10)
                return { tone: "warn", text: lang()==='en'
                  ? `Price up ${fin.priceTrendPct}% over historical batches. Compare quotes from alternative suppliers before next PO.`
                  : `ارتفع السعر ${fin.priceTrendPct}% مقارنة بالدفعات السابقة. قارن العروض من موردين بدلاء قبل أمر الشراء التالي.` };
              if (fin.totalConsumed === 0 && fin.purchases.length > 0)
                return { tone: "warn", text: lang()==='en'
                  ? `Purchased but not yet consumed — review storage and assignment.`
                  : `تم الشراء ولم يُستهلك بعد — راجع التخزين والإسناد.` };
              if (p.qtyOnHand > p.reorderLevel * 3)
                return { tone: "info", text: lang()==='en'
                  ? `Overstocked at ${p.qtyOnHand} ${p.unit} (>3× reorder level). Consider postponing the next PO.`
                  : `مخزون زائد عند ${p.qtyOnHand} ${p.unit} (>3× حد الطلب). فكّر في تأجيل أمر الشراء التالي.` };
              return { tone: "ok", text: lang()==='en'
                ? `Stock and pricing look healthy. No action recommended.`
                : `المخزون والسعر في حالة جيدة. لا حاجة لإجراء.` };
            })();
            return `
              <div class="card p-3">
                <h4 class="font-semibold text-sm mb-3 flex items-center gap-2">${ICONS.money()}${T("inv.perPartFinance")}</h4>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                  <div><div class="field-label">${T("inv.purchases")} (90d)</div><div class="text-lg font-semibold tabular">${fmtSar(fin.totalPurchased)}</div><div class="text-[11px] muted">${fin.purchases.length} ${lang()==='en'?'PO lines':'بنود أوامر'}</div></div>
                  <div><div class="field-label">${T("inv.consumption")} (${lang()==='en'?'all time':'الإجمالي'})</div><div class="text-lg font-semibold tabular">${fmtSar(fin.spentByConsumption)}</div><div class="text-[11px] muted">${fin.totalConsumed} ${p.unit}</div></div>
                  <div><div class="field-label">${T("inv.stockValue")}</div><div class="text-lg font-semibold tabular text-brand-600">${fmtSar(fin.stockValue)}</div></div>
                  <div><div class="field-label">${T("inv.priceTrend")}</div><div class="text-lg font-semibold tabular ${trendCls}">${trendArrow} ${Math.abs(fin.priceTrendPct)}%</div><div class="text-[11px] muted">${lang()==='en'?'vs historical batches':'مقابل الدفعات السابقة'}</div></div>
                </div>
                <div class="insight insight-${aiTip.tone === 'bad' ? 'warn' : aiTip.tone}">
                  <div class="flex items-start gap-2">
                    <span class="ai-chip" style="flex-shrink:0">${ICONS.zap ? ICONS.zap() : '★'} AI</span>
                    <div class="text-sm">${aiTip.text}</div>
                  </div>
                </div>
              </div>`;
          })()}

          <!-- Reorder info -->
          <div class="card p-3">
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.cart()}${T("inv.reorderInfo")}</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div class="field-label">${T("inv.suggestedQty")}</div><div class="font-semibold tabular">${p.reorderQty} ${p.unit}</div></div>
              <div><div class="field-label">${T("c.supplier")}</div><div class="text-sm">${escapeHtml(p.supplier)}</div></div>
              <div><div class="field-label">${T("inv.leadDays")}</div><div class="font-semibold tabular">${p.leadTimeDays} ${T("c.days")}</div></div>
              <div><div class="field-label">${T("c.totalValue")}</div><div class="font-semibold tabular">${fmtSar(p.reorderQty * p.currentPriceSar)}</div></div>
            </div>
          </div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        ${low ? `<button class="btn btn-primary" onclick="INV.openReorder('${p.id}')">${ICONS.cart()}${T("inv.createPO")}</button>` : ""}
      `;
      window.app.openModal({ title: `${T("inv.viewPart")} — ${escapeHtml(lang()==='ar'?p.nameAr:p.name)}`, html, size: "lg", footer });
    },

    /** Open price-lot form: lets the user record a new market price + incoming qty. */
    openPriceLot(partId) {
      const p = D().findPart(partId);
      if (!p) return;
      const today = ymd(TODAY);
      const html = `
        <div class="space-y-3">
          <p class="text-sm muted">${lang()==='en'?'Add a new price lot. Older stock is consumed first (FIFO) so the previous price stays active until it runs out.':'أضف دفعة سعر جديدة. يتم استهلاك المخزون الأقدم أولاً (FIFO) فيظل السعر السابق فعّالًا حتى نفاد كميته.'}</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("inv.newPrice")} (${T("c.sar")})</label>
              <input type="number" class="input w-full" id="plPrice" value="${p.currentPriceSar}" min="0.01" step="0.01"/></div>
            <div><label class="field-label">${T("inv.incomingQty")} (${p.unit})</label>
              <input type="number" class="input w-full" id="plQty" value="${p.reorderQty}" min="1"/></div>
            <div><label class="field-label">${T("inv.receivedOn")}</label>
              <input type="date" class="input w-full" id="plDate" value="${today}"/></div>
            <div><label class="field-label">${T("c.note")}</label>
              <input class="input w-full" id="plNote" placeholder="${lang()==='en'?'e.g. Market increase':'مثال: ارتفاع السوق'}"/></div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="INV.openPart('${p.id}')">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="INV.savePriceLot('${p.id}')">${ICONS.save()}${T("inv.saveLot")}</button>`;
      window.app.openModal({ title: `${T("inv.updateMarketPrice")} — ${escapeHtml(lang()==='ar'?p.nameAr:p.name)}`, html, footer });
    },

    savePriceLot(partId) {
      const p = D().findPart(partId);
      if (!p) return;
      const price = parseFloat(document.getElementById("plPrice").value) || 0;
      const qty = parseInt(document.getElementById("plQty").value, 10) || 0;
      const date = document.getElementById("plDate").value;
      const note = document.getElementById("plNote").value || (lang()==='en'?"Market update":"تحديث السوق");
      if (price <= 0 || qty <= 0) { window.app.toast(lang()==='en'?"Enter valid values":"أدخل قيمًا صالحة"); return; }
      // Mark previous current tier as "Previous price" if a new tier is added at a different price.
      if (p.priceTiers.length > 0) {
        const last = p.priceTiers[p.priceTiers.length - 1];
        if (last.note === "Current price" || last.note === "السعر الحالي") last.note = "Previous price";
      }
      p.priceTiers.push({ priceSar: price, qty, qtyPurchased: qty, receivedOn: date, note: "Current price" });
      p.previousPriceSar = p.currentPriceSar;
      p.currentPriceSar = price;
      p.qtyOnHand = p.priceTiers.reduce((s, t) => s + t.qty, 0);
      p.lastReceived = date;
      window.app.toast(`${p.sku} · ${fmtSar(price)} +${qty}`);
      this.openPart(p.id);
    },

    openReorder(partId) {
      // Legacy quick-reorder — kept for the table's red flag button. Now seeds
      // a draft PO with that single part instead of just toasting.
      const p = D().findPart(partId);
      if (!p) return;
      window.app.closeModal();
      INV.openNewPO({ initialLines: [{ partId: p.id, qty: p.reorderQty, unitPriceSar: p.currentPriceSar }] });
    },

    /** ===== Tab navigation ===== */
    setTab(tab) {
      window.APP_STATE.invTab = tab;
      window.app.render();
    },

    /** ===== Modal: list of open purchase orders (draft + issued).
     *  Opens from the "Active procurement" strip on the Inventory sub-page. */
    openPOList() {
      const open = D().purchaseOrders
        .filter(o => o.status === "draft" || o.status === "issued")
        .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
      const html = open.length === 0 ? `<p class="muted text-sm py-6 text-center">${T("inv.noOpenPOs")}</p>` : `
        <div class="overflow-x-auto scroll-thin">
          <table class="tbl">
            <thead><tr>
              <th>${T("inv.poNumber")}</th>
              <th>${T("c.status")}</th>
              <th>${T("c.supplier")}</th>
              <th>${T("inv.requestDate")}</th>
              <th>${T("inv.expectedDelivery")}</th>
              <th>${T("inv.poTotal")}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${open.map(o => `
                <tr style="cursor:pointer" onclick="INV.openPO('${o.id}')">
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs font-semibold">${o.id}</span>
                      ${o.aiGenerated ? `<span class="ai-pill" title="${T("inv.aiGeneratedBy")}">★ AI</span>` : ''}
                    </div>
                  </td>
                  <td>${INV._poStatusPill(o.status)}</td>
                  <td>
                    <div class="font-medium text-sm">${escapeHtml(o.supplier.name)}</div>
                    <div class="text-[11px] muted">${o.supplier.phone}</div>
                  </td>
                  <td class="text-xs">${o.requestDate}</td>
                  <td class="text-xs">${o.expectedDelivery}</td>
                  <td class="tabular font-medium">${fmtSar(o.estimatedTotalSar)}</td>
                  <td>${btn({ label: T("inv.viewPO"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); INV.openPO('${o.id}')` })}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        ${btn({ label: T("inv.newPO"), icon: ICONS.cart(), variant: "primary", onclick: "window.app.closeModal(); INV.openNewPO()" })}`;
      window.app.openModal({ title: T("inv.viewAllPOs"), html, footer, size: "lg" });
    },

    /** ===== Modal: list of issued POs awaiting receipt (Add Parts step). */
    openReceiveList() {
      const issued = D().purchaseOrders.filter(p => p.status === "issued")
        .sort((a, b) => new Date(a.expectedDelivery) - new Date(b.expectedDelivery));
      const html = issued.length === 0 ? `<p class="muted text-sm py-6 text-center">${T("inv.noPendingReceipts")}</p>` : `
        <p class="text-sm muted mb-3">${lang()==='en'?'Pick an issued PO to record what physically arrived. Step 2 of purchasing.':'اختر أمرًا صادرًا لتسجيل ما وصل فعلاً. الخطوة الثانية من الشراء.'}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          ${issued.map(o => `
            <div class="rounded-lg border border-app p-3 cursor-pointer hover:shadow-soft" onclick="window.app.closeModal(); INV.openReceive('${o.id}')">
              <div class="flex items-center justify-between mb-1">
                <span class="font-mono text-xs font-semibold">${o.id}</span>
                ${o.aiGenerated ? `<span class="ai-pill">★ AI</span>` : ''}
              </div>
              <div class="font-medium text-sm">${escapeHtml(o.supplier.name)}</div>
              <div class="text-[11px] muted mb-2">${T("inv.expectedDelivery")}: ${o.expectedDelivery}</div>
              <div class="flex justify-between text-xs">
                <span class="muted">${o.lines.length} ${lang()==='en'?'line items':'بنود'}</span>
                <span class="tabular font-medium">${fmtSar(o.estimatedTotalSar)}</span>
              </div>
            </div>`).join("")}
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        ${btn({ label: T("inv.addPartsBtn"), icon: ICONS.boxes(), variant: "primary", onclick: "window.app.closeModal(); INV.openReceive()" })}`;
      window.app.openModal({ title: T("inv.viewReceipts"), html, footer, size: "lg" });
    },

    /** ===== Focused financial report for a single part.
     *  Opens from the chart-icon button next to "View" on the inventory table.
     *  Shows: per-part finance summary + AI tip + 90-day purchase log.
     *  Pulls the same numbers shown inside the full View modal — just isolated. */
    openPartFinance(partId) {
      const p = D().findPart(partId);
      if (!p) return;
      const fin = D().partFinance(p.id);
      const usage = D().partUsage[partId] || [];
      const totalUsed = usage.reduce((s, u) => s + u.qty, 0);
      const totalUsedCost = usage.reduce((s, u) => s + u.costSar, 0);
      const trendCls = fin.priceTrendPct > 0 ? "delta-up" : fin.priceTrendPct < 0 ? "delta-down" : "muted";
      const trendArrow = fin.priceTrendPct > 0 ? "↑" : fin.priceTrendPct < 0 ? "↓" : "→";

      // AI recommendation tailored to this part's stock + price posture.
      const aiTip = (() => {
        if (p.qtyOnHand <= p.reorderLevel * 0.5)
          return { tone: "warn", text: lang()==='en'
            ? `Stock critical — only ${p.qtyOnHand} ${p.unit} left vs reorder level of ${p.reorderLevel}. Recommend issuing a PO of ${p.reorderQty} ${p.unit} immediately.`
            : `المخزون حرج — يتبقى ${p.qtyOnHand} ${p.unit} مقابل حد إعادة طلب ${p.reorderLevel}. يُوصى بإصدار أمر شراء بكمية ${p.reorderQty} ${p.unit} فورًا.` };
        if (fin.priceTrendPct >= 10)
          return { tone: "warn", text: lang()==='en'
            ? `Price up ${fin.priceTrendPct}% over historical batches. Compare quotes from alternative suppliers before next PO.`
            : `ارتفع السعر ${fin.priceTrendPct}% مقارنة بالدفعات السابقة. قارن العروض من موردين بدلاء قبل أمر الشراء التالي.` };
        if (fin.totalConsumed === 0 && fin.purchases.length > 0)
          return { tone: "warn", text: lang()==='en'
            ? `Purchased but not yet consumed — review storage and assignment.`
            : `تم الشراء ولم يُستهلك بعد — راجع التخزين والإسناد.` };
        if (p.qtyOnHand > p.reorderLevel * 3)
          return { tone: "info", text: lang()==='en'
            ? `Overstocked at ${p.qtyOnHand} ${p.unit} (>3× reorder level). Consider postponing the next PO.`
            : `مخزون زائد عند ${p.qtyOnHand} ${p.unit} (>3× حد الطلب). فكّر في تأجيل أمر الشراء التالي.` };
        return { tone: "ok", text: lang()==='en'
          ? `Stock and pricing look healthy. No action recommended.`
          : `المخزون والسعر في حالة جيدة. لا حاجة لإجراء.` };
      })();

      // Recent purchases — newest first, cap at 8
      const purchaseRows = fin.purchases.length === 0
        ? `<tr><td colspan="5" class="text-center muted py-3">${lang()==='en'?'No purchases in the last 90 days':'لا توجد مشتريات خلال 90 يومًا'}</td></tr>`
        : fin.purchases.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8).map(pu => `
          <tr>
            <td class="text-xs">${pu.date}</td>
            <td class="font-mono text-xs"><a class="text-brand-600 cursor-pointer" onclick="window.app.closeModal(); INV.openPO('${pu.poId}')">${pu.poId}</a></td>
            <td class="tabular">${pu.qty} ${p.unit}</td>
            <td class="tabular">${fmtSar(pu.unit)}</td>
            <td class="tabular font-medium">${fmtSar(pu.cost)}</td>
          </tr>`).join("");

      const html = `
        <div class="space-y-4">
          <div class="text-xs muted flex items-center gap-2">
            <span class="font-mono">${p.sku}</span> · <span>${T(`cat.${p.category}`)}</span> · <span>${depotLabel(p.warehouse)}</span>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div class="card p-3">
              <div class="field-label">${T("inv.purchases")} (90d)</div>
              <div class="text-lg font-semibold tabular">${fmtSar(fin.totalPurchased)}</div>
              <div class="text-[11px] muted">${fin.purchases.length} ${lang()==='en'?'PO lines':'بنود أوامر'}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("inv.consumption")} (${lang()==='en'?'all time':'الإجمالي'})</div>
              <div class="text-lg font-semibold tabular">${fmtSar(fin.spentByConsumption)}</div>
              <div class="text-[11px] muted">${totalUsed} ${p.unit}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("inv.stockValue")}</div>
              <div class="text-lg font-semibold tabular text-brand-600">${fmtSar(fin.stockValue)}</div>
              <div class="text-[11px] muted">${p.qtyOnHand} ${p.unit} ${T("inv.inStock")}</div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("inv.priceTrend")}</div>
              <div class="text-lg font-semibold tabular ${trendCls}">${trendArrow} ${Math.abs(fin.priceTrendPct)}%</div>
              <div class="text-[11px] muted">${lang()==='en'?'vs historical batches':'مقابل الدفعات السابقة'}</div>
            </div>
          </div>

          <div class="insight insight-${aiTip.tone === 'bad' ? 'warn' : aiTip.tone}">
            <div class="flex items-start gap-2">
              <span class="ai-chip" style="flex-shrink:0">${ICONS.zap ? ICONS.zap() : '★'} AI</span>
              <div class="text-sm">${aiTip.text}</div>
            </div>
          </div>

          <div>
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.cart()}${lang()==='en'?'Recent purchases (90d)':'المشتريات الأخيرة (90 يوم)'}</h4>
            <div class="overflow-x-auto scroll-thin">
              <table class="tbl">
                <thead><tr>
                  <th>${T("c.date")}</th>
                  <th>${T("inv.poNumber")}</th>
                  <th>${T("c.qty")}</th>
                  <th>${T("c.unitCost")}</th>
                  <th>${T("c.cost")}</th>
                </tr></thead>
                <tbody>${purchaseRows}</tbody>
              </table>
            </div>
          </div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        ${btn({ label: T("inv.viewPart"), icon: ICONS.eye(), variant: "primary", onclick: `INV.openPart('${p.id}')` })}`;
      window.app.openModal({
        title: `${T("inv.finReportTitle")} — ${escapeHtml(lang()==='ar'?p.nameAr:p.name)}`,
        html, footer, size: "lg",
      });
    },

    /** ===== Stock cell — replaces the old bar with a level pill + clear qty. */
    stockCell(p) {
      const ratio = p.qtyOnHand / Math.max(1, p.reorderLevel);
      let level, cls;
      if (p.qtyOnHand <= p.reorderLevel * 0.5)       { level = T("inv.stockCritical"); cls = "stock-critical"; }
      else if (p.qtyOnHand <= p.reorderLevel)        { level = T("inv.stockLow");      cls = "stock-low"; }
      else if (p.qtyOnHand >= p.reorderLevel * 3)    { level = T("inv.stockOver");     cls = "stock-over"; }
      else                                            { level = T("inv.stockOk");       cls = "stock-ok"; }
      return `
        <div class="stock-cell">
          <div class="stock-num ${cls}">
            <span class="stock-qty">${p.qtyOnHand}</span>
            <span class="stock-unit">${p.unit}</span>
          </div>
          <div class="stock-meta">
            <span class="stock-pill ${cls}"><span class="dot"></span>${level}</span>
            <span class="stock-reorder muted">${T("inv.reorderAt")} ${p.reorderLevel}</span>
          </div>
        </div>`;
    },

    /** ===== Purchase Order — create / edit ===== */
    openNewPO(opts) {
      opts = opts || {};
      // Build the draft state held in APP_STATE so the modal can be re-rendered.
      const lines = opts.initialLines && opts.initialLines.length
        ? opts.initialLines
        : [];
      const draft = {
        lines: lines.map(l => Object.assign({}, l)),
        supplierName: opts.supplierName || (lines[0] && D().findPart(lines[0].partId)?.supplier) || D().SUPPLIERS[0].name,
        warehouse: opts.warehouse || "Riyadh",
        requestDate: new Date().toISOString().slice(0, 10),
        expectedDelivery: (function () { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })(),
        notes: opts.notes || "",
        aiGenerated: !!opts.aiGenerated,
        aiRationale: opts.aiRationale || null,
      };
      window.APP_STATE.poDraft = draft;
      INV._renderPOModal();
    },

    /** Generate a draft from AI suggestions and open the editor. */
    openAIPO() {
      const sugg = D().suggestAIPurchaseLines();
      if (sugg.length === 0) {
        window.app.toast(lang() === "en" ? "Nothing to reorder — all parts above threshold." : "لا شيء للطلب — كل القطع فوق الحد.");
        return;
      }
      // Group by supplier — issue one PO per supplier; open the first group, others as toast.
      const bySupplier = {};
      sugg.forEach(l => { (bySupplier[l.supplier] = bySupplier[l.supplier] || []).push({ partId: l.partId, qty: l.qty, unitPriceSar: l.unitPriceSar }); });
      const firstSupplier = Object.keys(bySupplier)[0];
      INV.openNewPO({
        initialLines: bySupplier[firstSupplier],
        supplierName: firstSupplier,
        aiGenerated: true,
        aiRationale: D().AI_RATIONALES[0],
        notes: lang()==='en'
          ? `AI suggestion · ${sugg.length} parts at/below reorder level · grouped by supplier (${Object.keys(bySupplier).length} groups).`
          : `اقتراح ذكي · ${sugg.length} قطعة عند/تحت حد الطلب · مجمعة حسب المورّد (${Object.keys(bySupplier).length} مجموعة).`,
      });
    },

    _renderPOModal() {
      const draft = window.APP_STATE.poDraft;
      if (!draft) return;
      const suppliers = D().SUPPLIERS;
      const sel = D().findSupplierByName(draft.supplierName);

      const linesHtml = draft.lines.length === 0
        ? `<tr><td colspan="5" class="text-center muted py-3">${lang()==='en'?'No line items yet':'لا توجد بنود بعد'}</td></tr>`
        : draft.lines.map((l, idx) => {
            const part = D().findPart(l.partId);
            return `<tr>
              <td>
                <div class="font-mono text-[11px] muted">${part?.sku || ''}</div>
                <div class="text-sm font-medium">${escapeHtml(part ? (lang()==='ar'?part.nameAr:part.name) : '—')}</div>
              </td>
              <td><input type="number" class="input w-20" min="1" value="${l.qty}" onchange="INV.poLineUpdate(${idx},'qty',this.value)"/></td>
              <td><input type="number" class="input w-24" min="0" step="0.01" value="${l.unitPriceSar}" onchange="INV.poLineUpdate(${idx},'unitPriceSar',this.value)"/></td>
              <td class="tabular font-semibold">${fmtSar((l.qty || 0) * (l.unitPriceSar || 0))}</td>
              <td><button class="btn btn-ghost btn-xs" onclick="INV.poLineRemove(${idx})">${ICONS.x()}</button></td>
            </tr>`;
          }).join("");

      const total = draft.lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPriceSar || 0), 0);
      const allParts = D().parts.slice().sort((a, b) => a.name.localeCompare(b.name));

      const aiBanner = draft.aiGenerated ? `
        <div class="ai-banner">
          <span class="ai-chip">${ICONS.zap ? ICONS.zap() : '★'} ${T("inv.aiGeneratedBy")}</span>
          ${draft.aiRationale ? `<span class="ai-text">${escapeHtml(lang()==='ar'?draft.aiRationale.ar:draft.aiRationale.en)}</span>` : ''}
        </div>` : "";

      const html = `
        <div class="space-y-3 po-form">
          ${aiBanner}
          <p class="text-sm muted">${lang()==='en'?'A Purchase Order is an internal request to procure parts. Once issued, it can be received via the "Add Parts" tab.':'أمر الشراء طلب داخلي لاقتناء القطع. بعد إصداره يمكن استلامه عبر تبويب "استلام قطع".'}</p>

          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label class="field-label">${T("c.supplier")}</label>
              <div class="flex gap-2">
                <select id="poSupplier" class="select flex-1" onchange="window.APP_STATE.poDraft.supplierName=this.value; INV._refreshSupplierCard()">
                  ${suppliers.map(s => `<option ${s.name===draft.supplierName?'selected':''}>${escapeHtml(s.name)}</option>`).join("")}
                </select>
                <button type="button" class="btn btn-outline" onclick="INV.openNewSupplier()">${T("inv.newSupplier")}</button>
              </div>
            </div>
            <div><label class="field-label">${T("c.warehouse")}</label>
              <div class="flex gap-2">
                <select id="poWarehouse" class="select flex-1" onchange="window.APP_STATE.poDraft.warehouse=this.value">
                  ${D().WAREHOUSES.map(w => `<option value="${escapeHtml(w.name)}" ${w.name===draft.warehouse?'selected':''}>${escapeHtml(lang()==='ar'?w.nameAr:w.name)}</option>`).join("")}
                </select>
                <button type="button" class="btn btn-outline" onclick="INV.openNewWarehouse()">${T("inv.newWarehouse")}</button>
              </div>
            </div>
            <div><label class="field-label">${T("inv.expectedDelivery")}</label>
              <input id="poETA" type="date" class="input w-full" value="${draft.expectedDelivery}" onchange="window.APP_STATE.poDraft.expectedDelivery=this.value"/></div>
          </div>

          <div id="poSupplierCard" class="supplier-card">${INV._supplierCardHtml(sel)}</div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="field-label !mb-0">${T("inv.poLines")}</label>
              <div class="flex items-center gap-2">
                <select id="poAddPart" class="select" style="max-width:280px">
                  <option value="">${lang()==='en'?'Pick a part to add…':'اختر قطعة للإضافة…'}</option>
                  ${allParts.map(p => `<option value="${p.id}">${p.sku} · ${escapeHtml(lang()==='ar'?p.nameAr:p.name)} · ${T("inv.stockLabel")}: ${p.qtyOnHand}</option>`).join("")}
                </select>
                <button class="btn btn-outline" onclick="INV.poLineAdd()">${ICONS.plus()}${T("inv.addLine")}</button>
              </div>
            </div>
            <div class="card overflow-hidden">
              <table class="tbl">
                <thead><tr>
                  <th>${T("c.part")}</th>
                  <th>${T("c.qty")}</th>
                  <th>${T("c.unitCost")} (${T("c.sar")})</th>
                  <th>${T("c.subtotal")}</th>
                  <th></th>
                </tr></thead>
                <tbody id="poLinesBody">${linesHtml}</tbody>
                <tfoot><tr>
                  <td colspan="3" class="text-end font-semibold">${T("inv.estimatedTotal")}</td>
                  <td class="tabular font-bold text-brand-600" id="poTotalCell">${fmtSar(total)}</td>
                  <td></td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          <div>
            <label class="field-label">${T("inv.notes")}</label>
            <textarea id="poNotes" class="input w-full" style="min-height:60px" onchange="window.APP_STATE.poDraft.notes=this.value">${escapeHtml(draft.notes)}</textarea>
          </div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-outline" onclick="INV.savePO('draft')">${ICONS.save()}${T("inv.saveDraft")}</button>
        <button class="btn btn-primary" onclick="INV.savePO('issued')">${ICONS.cart()}${T("inv.issueNow")}</button>`;
      window.app.openModal({ title: T("inv.newPO"), html, footer, size: "lg" });
    },

    _supplierCardHtml(s) {
      if (!s) return "";
      return `
        <div class="text-[11px] muted uppercase tracking-wide mb-1">${T("inv.supplierContact")}</div>
        <div class="grid grid-cols-3 gap-3 text-xs">
          <div><div class="muted">${T("inv.contactPerson")}</div><div class="font-medium">${escapeHtml(s.contactPerson)}</div></div>
          <div><div class="muted">${T("inv.supplierPhone")}</div><div class="font-mono">${s.phone}</div></div>
          <div><div class="muted">${T("inv.supplierEmail")}</div><div class="font-mono text-[11px]">${s.email}</div></div>
        </div>`;
    },
    _refreshSupplierCard() {
      const draft = window.APP_STATE.poDraft;
      const s = D().findSupplierByName(draft.supplierName);
      const el = document.getElementById("poSupplierCard");
      if (el) el.innerHTML = INV._supplierCardHtml(s);
    },

    poLineAdd() {
      const sel = document.getElementById("poAddPart");
      if (!sel || !sel.value) return;
      const p = D().findPart(sel.value);
      if (!p) return;
      const draft = window.APP_STATE.poDraft;
      // Don't add the same part twice — bump qty instead
      const existing = draft.lines.find(l => l.partId === p.id);
      if (existing) existing.qty += p.reorderQty;
      else draft.lines.push({ partId: p.id, qty: p.reorderQty, unitPriceSar: p.currentPriceSar });
      sel.value = "";
      INV._renderPOModal();
    },
    poLineUpdate(idx, field, val) {
      const draft = window.APP_STATE.poDraft;
      const n = parseFloat(val);
      draft.lines[idx][field] = isNaN(n) ? 0 : n;
      const total = draft.lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPriceSar || 0), 0);
      const cell = document.getElementById("poTotalCell");
      if (cell) cell.textContent = fmtSar(total);
    },
    poLineRemove(idx) {
      const draft = window.APP_STATE.poDraft;
      draft.lines.splice(idx, 1);
      INV._renderPOModal();
    },

    savePO(status) {
      const draft = window.APP_STATE.poDraft;
      if (!draft) return;
      if (draft.lines.length === 0) {
        window.app.toast(lang()==='en' ? "Add at least one line item" : "أضف بندًا واحدًا على الأقل");
        return;
      }
      const supplier = D().findSupplierByName(draft.supplierName);
      const id = D().nextPOId();
      const total = draft.lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPriceSar || 0), 0);
      D().purchaseOrders.push({
        id, status,
        lines: draft.lines.map(l => Object.assign({ receivedQty: 0, receivedUnitPriceSar: null }, l)),
        supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone, email: supplier.email, contactPerson: supplier.contactPerson },
        warehouse: draft.warehouse,
        requestedById: "PER-008",
        requestDate: draft.requestDate,
        expectedDelivery: draft.expectedDelivery,
        receivedDate: null, receivedById: null,
        notes: draft.notes,
        aiGenerated: !!draft.aiGenerated,
        aiRationale: draft.aiRationale,
        approvals: [], rejection: null,
        estimatedTotalSar: total, actualTotalSar: null,
      });
      window.APP_STATE.poDraft = null;
      window.app.toast(`${id} · ${status === "issued" ? T("inv.poStatusIssued") : T("inv.poStatusDraft")}`);
      window.app.closeModal();
      window.APP_STATE.invTab = "pos";
      window.app.render();
    },

    /** Open a single PO in read-only mode (with state-appropriate actions). */
    openPO(poId) {
      const po = D().findPO(poId);
      if (!po) return;
      const requester = D().findPerson(po.requestedById);
      const receiver = po.receivedById ? D().findPerson(po.receivedById) : null;
      const total = po.lines.reduce((s, l) => {
        const unit = l.receivedUnitPriceSar != null ? l.receivedUnitPriceSar : l.unitPriceSar;
        const qty = l.receivedQty || l.qty;
        return s + qty * unit;
      }, 0);

      const aiBanner = po.aiGenerated ? `
        <div class="ai-banner">
          <span class="ai-chip">${ICONS.zap ? ICONS.zap() : '★'} ${T("inv.aiGeneratedBy")}</span>
          ${po.aiRationale ? `<span class="ai-text">${escapeHtml(lang()==='ar'?po.aiRationale.ar:po.aiRationale.en)}</span>` : ''}
        </div>` : "";

      // Visible everywhere this PO is opened, not only on the Approvals tab.
      const reviewBanner = po.status === "pending_approval" ? `
        <div class="insight insight-warn">
          <div class="flex items-center gap-2 text-sm font-medium">
            <span>⏳</span>
            <span>${T("inv.awaitingReviewBanner")} · ${po.approvals.length}/${D().MIN_APPROVALS} ${T("inv.approvalsReceived")}</span>
          </div>
        </div>` : "";

      const linesHtml = po.lines.map(l => {
        const part = D().findPart(l.partId);
        return `<tr>
          <td>
            <div class="font-mono text-[11px] muted">${part?.sku || ''}</div>
            <div class="text-sm font-medium">${escapeHtml(part ? (lang()==='ar'?part.nameAr:part.name) : '—')}</div>
          </td>
          <td class="tabular">${l.qty}${l.receivedQty && l.receivedQty !== l.qty ? ` <span class="muted text-[11px]">(${T("inv.actualQty")}: ${l.receivedQty})</span>` : ''}</td>
          <td class="tabular">${fmtSar(l.unitPriceSar)}${l.receivedUnitPriceSar != null && l.receivedUnitPriceSar !== l.unitPriceSar ? ` <span class="muted text-[11px]">→ ${fmtSar(l.receivedUnitPriceSar)}</span>` : ''}</td>
          <td class="tabular font-medium">${fmtSar((l.receivedQty || l.qty) * (l.receivedUnitPriceSar != null ? l.receivedUnitPriceSar : l.unitPriceSar))}</td>
        </tr>`;
      }).join("");

      const approvalsHtml = (po.status === "pending_approval" || po.status === "approved" || po.status === "rejected") ? `
        <div class="card p-3">
          <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">${ICONS.check()}${T("inv.approvedBy")} <span class="muted text-xs font-normal">(${po.approvals.length}/${D().MIN_APPROVALS})</span></h4>
          ${po.approvals.length === 0 ? `<p class="muted text-sm">${T("inv.awaitingApproval")}</p>` : `
            <ul class="space-y-2">${po.approvals.map(a => {
              const per = D().findPerson(a.personId);
              return `<li class="flex items-start gap-2 text-sm">
                <span class="text-emerald-500">${ICONS.check()}</span>
                <div class="flex-1">
                  <div class="font-medium">${escapeHtml(per ? (lang()==='ar'?per.nameAr:per.name) : a.personId)} <span class="muted text-[11px]">· ${per?.role.replace(/_/g,' ')}</span></div>
                  <div class="text-[11px] muted">${new Date(a.approvedAt).toLocaleString()} ${a.comment ? `· "${escapeHtml(a.comment)}"` : ''}</div>
                </div>
              </li>`;
            }).join("")}</ul>`}
          ${po.rejection ? `
            <div class="rejection-block">
              <div class="font-semibold text-sm text-rose-600">${T("inv.rejectedBy")}: ${escapeHtml((D().findPerson(po.rejection.personId)||{}).name || po.rejection.personId)}</div>
              <div class="text-xs muted mt-1">${new Date(po.rejection.rejectedAt).toLocaleString()}</div>
              ${po.rejection.reason ? `<div class="text-sm mt-1">"${escapeHtml(po.rejection.reason)}"</div>` : ''}
            </div>` : ''}
        </div>` : "";

      const html = `
        <div class="space-y-4 po-printable">
          ${aiBanner}
          ${reviewBanner}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><div class="field-label">${T("inv.poNumber")}</div><div class="font-mono font-semibold">${po.id}</div></div>
            <div><div class="field-label">${T("c.status")}</div><div>${INV._poStatusPill(po.status)}</div></div>
            <div><div class="field-label">${T("inv.requestDate")}</div><div>${po.requestDate}</div></div>
            <div><div class="field-label">${T("inv.expectedDelivery")}</div><div>${po.expectedDelivery}</div></div>
            <div><div class="field-label">${T("inv.requestedBy")}</div><div>${escapeHtml(requester ? (lang()==='ar'?requester.nameAr:requester.name) : '—')}</div></div>
            <div><div class="field-label">${T("inv.receivedBy")}</div><div>${receiver ? escapeHtml(lang()==='ar'?receiver.nameAr:receiver.name) : '<span class="muted">—</span>'}</div></div>
            <div><div class="field-label">${T("inv.receivedDate")}</div><div>${po.receivedDate || '<span class="muted">—</span>'}</div></div>
            <div><div class="field-label">${T("c.warehouse")}</div><div>${po.warehouse}</div></div>
          </div>

          <div class="card p-3"><div class="field-label">${T("inv.supplierContact")}</div>
            <div class="font-semibold text-sm">${escapeHtml(po.supplier.name)}</div>
            <div class="grid grid-cols-3 gap-3 text-xs mt-1">
              <div><span class="muted">${T("inv.contactPerson")}:</span> ${escapeHtml(po.supplier.contactPerson)}</div>
              <div><span class="muted">${T("inv.supplierPhone")}:</span> <span class="font-mono">${po.supplier.phone}</span></div>
              <div><span class="muted">${T("inv.supplierEmail")}:</span> <span class="font-mono text-[11px]">${po.supplier.email}</span></div>
            </div>
          </div>

          <div class="card overflow-hidden">
            <table class="tbl">
              <thead><tr>
                <th>${T("c.part")}</th>
                <th>${T("c.qty")}</th>
                <th>${T("inv.actualUnitPrice")}</th>
                <th>${T("c.subtotal")}</th>
              </tr></thead>
              <tbody>${linesHtml}</tbody>
              <tfoot><tr>
                <td colspan="3" class="text-end font-semibold">${po.status === "approved" || po.status === "pending_approval" ? T("inv.actualTotal") : T("inv.estimatedTotal")}</td>
                <td class="tabular font-bold text-brand-600">${fmtSar(po.actualTotalSar != null ? po.actualTotalSar : total)}</td>
              </tr></tfoot>
            </table>
          </div>

          ${po.notes ? `<div class="card p-3"><div class="field-label">${T("inv.notes")}</div><div class="text-sm" style="white-space:pre-wrap">${escapeHtml(po.notes)}</div></div>` : ""}

          ${approvalsHtml}
        </div>`;

      // Footer actions depend on state
      const printBtn = btn({ label: T("inv.printInvoice"), icon: ICONS.printer ? ICONS.printer() : "🖨", variant: "outline", onclick: `INV.printPO('${po.id}')` });
      let actions = printBtn + `<button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>`;
      if (po.status === "issued" || po.status === "draft") {
        actions = btn({ label: T("inv.tabReceive"), icon: ICONS.boxes(), variant: "primary", onclick: `INV.openReceive('${po.id}')` }) + actions;
      } else if (po.status === "pending_approval") {
        actions = btn({ label: T("inv.approveBtn"), icon: ICONS.check(), variant: "primary", onclick: `INV.openApprove('${po.id}')` }) + actions;
      }
      window.app.openModal({ title: `${po.id} — ${escapeHtml(po.supplier.name)}`, html, footer: actions, size: "lg" });
    },

    /** Trigger browser print for the currently-open PO modal. The CSS rule
     *  `@media print` in app.css isolates `.po-printable` so only the PO
     *  prints (header bar, sidebar, action footer are hidden). */
    printPO(_poId) {
      document.body.classList.add("printing-po");
      // Defer so the class is applied before print dialog measures the page.
      setTimeout(() => {
        window.print();
        // Clean up shortly after the dialog closes — afterprint event is
        // unreliable across browsers, so we just clear on a 600ms delay.
        setTimeout(() => document.body.classList.remove("printing-po"), 600);
      }, 50);
    },

    _poStatusPill(status) {
      const labelKey = {
        draft: "poStatusDraft", issued: "poStatusIssued", received: "poStatusReceived",
        pending_approval: "poStatusPending", approved: "poStatusApproved", rejected: "poStatusRejected",
      }[status] || "poStatusDraft";
      const cls = {
        draft: "po-pill po-draft", issued: "po-pill po-issued", received: "po-pill po-received",
        pending_approval: "po-pill po-pending", approved: "po-pill po-approved", rejected: "po-pill po-rejected",
      }[status] || "po-pill";
      return `<span class="${cls}"><span class="dot"></span>${T(`inv.${labelKey}`)}</span>`;
    },

    /** ===== Add Parts (Receive) — works WITH or WITHOUT a Purchase Order.
     *  Always requires an invoice. If a PO number is provided + looked up,
     *  the lines/supplier/warehouse auto-fill from the PO; otherwise the
     *  user fills everything manually. */
    openReceive(prefillPOId) {
      window.APP_STATE.receiveDraft = {
        mode: prefillPOId ? "po" : "manual",   // "po" | "manual" — toggled by Lookup
        poId: prefillPOId || "",
        supplierName: "",
        warehouse: D().WAREHOUSES[0]?.name || "Riyadh",
        lines: [],
        invoices: [],
        note: "",
      };
      INV._renderReceiveModal();
    },

    /** "Lookup" the entered PO number. On success, populate supplier +
     *  warehouse + lines from the PO and flip the modal into PO mode.
     *  On miss, toast and stay in manual mode. */
    receivePOLookup() {
      const v = document.getElementById("rcvPONum").value.trim();
      if (!v) return;
      const po = D().findPO(v);
      if (!po) { window.app.toast(T("inv.poNotFound")); return; }
      if (po.status !== "issued" && po.status !== "draft") {
        window.app.toast(T("inv.poAlreadyReceived"));
        return;
      }
      const d = window.APP_STATE.receiveDraft;
      d.mode = "po";
      d.poId = po.id;
      d.supplierName = po.supplier.name;
      d.warehouse = po.warehouse || d.warehouse;
      d.lines = po.lines.map(l => ({ partId: l.partId, plannedQty: l.qty, qty: l.qty, unitPriceSar: l.unitPriceSar, plannedPrice: l.unitPriceSar }));
      INV._renderReceiveModal();
      window.app.toast(`${po.id} · ${lang()==='en'?'Lines auto-filled':'تم تعبئة البنود تلقائياً'}`);
    },

    /** Add a fresh empty part-line in manual mode (and in PO mode if extra
     *  parts are received alongside the PO). The user picks the part from
     *  the dropdown labelled "Pick a part to add…". */
    rcvAddLine() {
      const sel = document.getElementById("rcvAddPart");
      if (!sel || !sel.value) return;
      const p = D().findPart(sel.value);
      if (!p) return;
      const d = window.APP_STATE.receiveDraft;
      const existing = d.lines.find(l => l.partId === p.id);
      if (existing) { existing.qty += p.reorderQty || 1; }
      else {
        d.lines.push({ partId: p.id, qty: p.reorderQty || 1, unitPriceSar: p.currentPriceSar });
      }
      sel.value = "";
      INV._renderReceiveModal();
    },

    rcvRemoveLine(idx) {
      const d = window.APP_STATE.receiveDraft;
      d.lines.splice(idx, 1);
      INV._renderReceiveModal();
    },

    /** Trigger the native file picker, then read each file as a data URL
     *  and push into the receipt draft's `invoices[]`. Cap 6 files × 4 MB. */
    rcvUploadInvoice() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,application/pdf";
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      input.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        let processed = 0, total = files.length;
        const finish = () => { if (++processed === total) { document.body.removeChild(input); INV._renderReceiveModal(); } };
        files.forEach(file => {
          if (file.size > 4 * 1024 * 1024) { window.app.toast(T("inv.invoiceTooLargeInv")); finish(); return; }
          const reader = new FileReader();
          reader.onload = (ev) => {
            window.APP_STATE.receiveDraft.invoices.push({
              id: `INV-${Date.now().toString(36)}-${Math.floor(Math.random()*1e5)}`,
              name: file.name,
              dataUrl: ev.target.result,
              mime: file.type,
              uploadedAt: new Date().toISOString(),
            });
            finish();
          };
          reader.readAsDataURL(file);
        });
        if (total === 0) document.body.removeChild(input);
      };
      input.click();
    },

    rcvRemoveInvoice(invoiceId) {
      const d = window.APP_STATE.receiveDraft;
      d.invoices = d.invoices.filter(x => x.id !== invoiceId);
      INV._renderReceiveModal();
    },

    _renderReceiveModal() {
      const d = window.APP_STATE.receiveDraft;
      if (!d) return;
      const po = d.poId ? D().findPO(d.poId) : null;
      const suppliers = D().SUPPLIERS;
      const warehouses = D().WAREHOUSES;
      const allParts = D().parts;

      const linesHtml = d.lines.length === 0
        ? `<tr><td colspan="5" class="text-center muted py-3">${lang()==='en'?'No lines yet — pick a part below to add one.':'لا توجد بنود — اختر قطعة بالأسفل لإضافتها.'}</td></tr>`
        : d.lines.map((l, idx) => {
            const part = D().findPart(l.partId);
            const variance = l.plannedQty != null && (l.qty !== l.plannedQty || l.unitPriceSar !== l.plannedPrice);
            return `<tr>
              <td>
                <div class="font-mono text-[11px] muted">${part?.sku || ''}</div>
                <div class="text-sm font-medium">${escapeHtml(part ? (lang()==='ar'?part.nameAr:part.name) : '—')}</div>
                ${l.plannedQty != null ? `<div class="text-[10px] muted">${T("inv.poStatusIssued")}: ${l.plannedQty} × ${fmtSar(l.plannedPrice)}</div>` : ''}
              </td>
              <td><input type="number" class="input w-20" min="0" value="${l.qty}" onchange="window.APP_STATE.receiveDraft.lines[${idx}].qty=+this.value; INV._renderReceiveModal()"/></td>
              <td><input type="number" class="input w-24" min="0" step="0.01" value="${l.unitPriceSar}" onchange="window.APP_STATE.receiveDraft.lines[${idx}].unitPriceSar=+this.value; INV._renderReceiveModal()"/></td>
              <td class="tabular font-semibold">${fmtSar(l.qty * l.unitPriceSar)}</td>
              <td>
                ${l.plannedQty != null
                  ? (variance
                      ? `<span class="pill pill-warn"><span class="dot"></span>${lang()==='en'?'Variance':'فرق'}</span>`
                      : `<span class="pill pill-ok"><span class="dot"></span>${lang()==='en'?'Match':'مطابق'}</span>`)
                  : `<button class="icon-btn" style="color:#be123c" title="${T("c.delete")}" onclick="INV.rcvRemoveLine(${idx})">${ICONS.trash()}</button>`}
              </td>
            </tr>`;
          }).join("");
      const total = d.lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPriceSar || 0), 0);

      // Invoice gallery
      const invHtml = d.invoices.length === 0
        ? `<div class="invoice-empty">${T("inv.invoiceUploadHelp")}</div>`
        : d.invoices.map(inv => {
            const isPdf = (inv.mime || "").includes("pdf") || /\.pdf$/i.test(inv.name);
            return `
              <div class="invoice-tile">
                ${isPdf
                  ? `<div class="invoice-pdf"><span class="invoice-pdf-icon">PDF</span><span class="invoice-name">${escapeHtml(inv.name)}</span></div>`
                  : `<img src="${inv.dataUrl}" alt="${escapeHtml(inv.name)}"/><span class="invoice-name">${escapeHtml(inv.name)}</span>`}
                <span class="x-btn" onclick="INV.rcvRemoveInvoice('${inv.id}')" title="${T("inv.invoiceRemove")}">×</span>
              </div>`;
          }).join("");

      const html = `
        <div class="space-y-3">
          <p class="text-sm" style="color:rgba(255,255,255,.9)">${T("inv.addPartsIntro")}</p>

          <!-- Optional PO lookup -->
          <div class="card p-3" style="background: rgba(11,126,234,.08); border-color: rgba(11,126,234,.25)">
            <label class="field-label">${T("inv.poOptional")}</label>
            <div class="flex gap-2 items-center">
              <input id="rcvPONum" class="input flex-1" value="${escapeHtml(d.poId)}" placeholder="PO-2026-0001" onkeydown="if(event.key==='Enter'){event.preventDefault();INV.receivePOLookup()}"/>
              <button class="btn btn-outline" onclick="INV.receivePOLookup()">${ICONS.search ? ICONS.search() : ''}${T("inv.lookupBtn")}</button>
            </div>
            <div class="text-[11px] muted mt-1">${T("inv.poOptionalHelp")}</div>
            ${(function () {
              const issued = D().purchaseOrders
                .filter(o => o.status === "issued")
                .slice().sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate))
                .slice(0, 6);
              if (issued.length === 0) return "";
              return `
                <div class="recent-po-strip" style="margin-top:.5rem">
                  <span class="strip-label">${T("inv.recentIssuedPOs")}:</span>
                  ${issued.map(o => `
                    <button class="po-chip" onclick="document.getElementById('rcvPONum').value='${o.id}'; INV.receivePOLookup()" title="${escapeHtml(o.supplier.name)} · ${o.requestDate}">${o.id}</button>
                  `).join("")}
                </div>`;
            })()}
          </div>

          <!-- Supplier + Warehouse -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="field-label">${T("c.supplier")}</label>
              <div class="flex gap-2">
                <select id="rcvSupplier" class="select flex-1" onchange="window.APP_STATE.receiveDraft.supplierName=this.value">
                  <option value="">${lang()==='en'?'— Pick a supplier —':'— اختر مورّداً —'}</option>
                  ${suppliers.map(s => `<option value="${escapeHtml(s.name)}" ${d.supplierName === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join("")}
                </select>
                <button type="button" class="btn btn-outline" onclick="INV.openNewSupplier()">${T("inv.newSupplier")}</button>
              </div>
            </div>
            <div>
              <label class="field-label">${T("c.warehouse")}</label>
              <div class="flex gap-2">
                <select id="rcvWarehouse" class="select flex-1" onchange="window.APP_STATE.receiveDraft.warehouse=this.value">
                  ${warehouses.map(w => `<option value="${escapeHtml(w.name)}" ${d.warehouse === w.name ? 'selected' : ''}>${escapeHtml(lang()==='ar'?w.nameAr:w.name)}</option>`).join("")}
                </select>
                <button type="button" class="btn btn-outline" onclick="INV.openNewWarehouse()">${T("inv.newWarehouse")}</button>
              </div>
            </div>
          </div>

          ${po ? `
            <div class="card p-3">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div><div class="field-label">${T("inv.poNumber")}</div><div class="font-medium">${po.id}</div></div>
                <div><div class="field-label">${T("c.status")}</div><div>${INV._poStatusPill(po.status)}</div></div>
                <div><div class="field-label">${T("inv.requestDate")}</div><div>${po.requestDate}</div></div>
                <div><div class="field-label">${T("inv.expectedDelivery")}</div><div>${po.expectedDelivery}</div></div>
              </div>
            </div>
          ` : ""}

          <!-- Line items -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="field-label !mb-0">${T("inv.poLines")}</label>
              <div class="flex items-center gap-2">
                <select id="rcvAddPart" class="select" style="max-width:280px">
                  <option value="">${T("inv.addLineFromPart")}</option>
                  ${allParts.map(p => `<option value="${p.id}">${p.sku} · ${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</option>`).join("")}
                </select>
                <button type="button" class="btn btn-outline" onclick="INV.rcvAddLine()">${ICONS.plus()}${T("inv.addLine")}</button>
              </div>
            </div>
            <div class="card overflow-hidden">
              <table class="tbl">
                <thead><tr>
                  <th>${T("c.part")}</th>
                  <th>${T("inv.actualQty")}</th>
                  <th>${T("inv.actualUnitPrice")}</th>
                  <th>${T("c.subtotal")}</th>
                  <th></th>
                </tr></thead>
                <tbody>${linesHtml}</tbody>
                <tfoot><tr>
                  <td colspan="3" class="text-end font-semibold">${T("inv.actualTotal")}</td>
                  <td class="tabular font-bold text-brand-600">${fmtSar(total)}</td>
                  <td></td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          <!-- Mandatory invoice upload -->
          <div class="invoice-required ${d.invoices.length === 0 ? 'is-missing' : 'is-met'}">
            <div class="flex items-center justify-between mb-1">
              <label class="field-label !mb-0">
                ${T("inv.invoiceUpload")}
                <span class="inline-block w-1.5 h-1.5 rounded-full ms-1" style="background:${d.invoices.length === 0 ? '#f43f5e' : '#10b981'}"></span>
              </label>
              <button type="button" class="btn btn-outline" onclick="INV.rcvUploadInvoice()">${ICONS.upload()}${T("inv.invoiceAdd")}</button>
            </div>
            <div class="invoice-gallery" style="min-height:3rem">${invHtml}</div>
            ${d.invoices.length > 0 ? `<div class="text-[11px] muted mt-1">${d.invoices.length} ${T("inv.invoiceAttached")}</div>` : ''}
          </div>
        </div>`;

      const canSave = d.lines.length > 0 && d.invoices.length > 0 && d.supplierName;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" ${canSave ? '' : 'disabled style="opacity:.5;cursor:not-allowed"'} onclick="INV.confirmReceipt()">${ICONS.check()}${T("inv.saveReceipt")}</button>`;
      window.app.openModal({ title: T("inv.addPartsTitle"), html, footer, size: "lg" });
    },

    confirmReceipt() {
      const d = window.APP_STATE.receiveDraft;
      if (!d || d.lines.length === 0) return;
      if (d.invoices.length === 0) { window.app.toast(T("inv.invoiceRequired")); return; }
      if (!d.supplierName) { window.app.toast(T("inv.requireField")); return; }

      // PO mode → mirror actuals back, then drive the existing PO receive flow.
      if (d.mode === "po" && d.poId) {
        const po = D().findPO(d.poId);
        if (po) {
          po.lines.forEach(l => {
            const draftLine = d.lines.find(x => x.partId === l.partId);
            if (draftLine) { l.receivedQty = draftLine.qty; l.receivedUnitPriceSar = draftLine.unitPriceSar; }
          });
          po.receivedDate = new Date().toISOString().slice(0, 10);
          po.warehouse = d.warehouse || po.warehouse;
          po.receiptInvoices = (po.receiptInvoices || []).concat(d.invoices);
          D().receivePO(po.id, "PER-008");
          window.app.toast(`${po.id} · ${T("inv.receiptSent")}`);
          window.APP_STATE.receiveDraft = null;
          window.app.closeModal();
          window.APP_STATE.invTab = "approvals";
          window.app.render();
          return;
        }
      }

      // Manual mode (no PO) → write loose receipt + adjust stock directly.
      const out = D().receiveLooseParts({
        supplierName: d.supplierName,
        warehouse: d.warehouse,
        lines: d.lines.map(l => ({ partId: l.partId, qty: l.qty, unitPriceSar: l.unitPriceSar })),
        invoices: d.invoices,
        receivedById: "PER-008",
        note: d.note,
      });
      window.app.toast(`${T("inv.receiptSavedNoPO")} · ${fmtSar(out.totalCost)}`);
      window.APP_STATE.receiveDraft = null;
      window.app.closeModal();
      window.app.render();
    },

    /** ===== Inline +Supplier / +Warehouse modals ===== */
    openNewSupplier() {
      const html = `
        <div class="space-y-3">
          <p class="text-sm" style="color:rgba(255,255,255,.85)">${lang()==='en'?'Quickly add a supplier. They\'ll be available in every PO and Add Parts dropdown.':'إضافة مورّد بسرعة. سيظهر فوراً في جميع القوائم.'}</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">${T("inv.supplierName")}</label>
              <input id="nsName" class="input w-full" placeholder="${lang()==='en'?'e.g. Al-Khaleej Heavy Trucks':'مثال: الخليج للشاحنات الثقيلة'}"/></div>
            <div><label class="field-label">${T("inv.supplierPhoneLabel")}</label>
              <input id="nsPhone" class="input w-full" placeholder="+966 11 ..."/></div>
            <div><label class="field-label">${T("inv.supplierEmailLabel")}</label>
              <input id="nsEmail" class="input w-full" placeholder="orders@..."/></div>
            <div><label class="field-label">${T("inv.supplierContactLabel")}</label>
              <input id="nsContact" class="input w-full" placeholder="${lang()==='en'?'Contact person':'جهة الاتصال'}"/></div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="INV._renderReceiveModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="INV.saveNewSupplier()">${ICONS.save()}${T("inv.newSupplierTitle")}</button>`;
      window.app.openModal({ title: T("inv.newSupplierTitle"), html, footer });
    },
    saveNewSupplier() {
      const name = (document.getElementById("nsName").value || "").trim();
      if (!name) { window.app.toast(T("inv.requireField")); return; }
      const rec = D().addSupplier({
        name,
        phone: document.getElementById("nsPhone").value,
        email: document.getElementById("nsEmail").value,
        contactPerson: document.getElementById("nsContact").value,
      });
      if (rec) {
        // Auto-select the new supplier in the draft so the user lands ready.
        const d = window.APP_STATE.receiveDraft;
        if (d) d.supplierName = rec.name;
        const poDraft = window.APP_STATE.poDraft;
        if (poDraft) poDraft.supplierName = rec.name;
        window.app.toast(`${T("inv.supplierCreated")} · ${rec.name}`);
      }
      // Return to whichever flow opened this modal
      if (window.APP_STATE.receiveDraft) INV._renderReceiveModal();
      else if (window.APP_STATE.poDraft) INV._renderPOModal();
      else window.app.closeModal();
    },

    openNewWarehouse() {
      const html = `
        <div class="space-y-3">
          <p class="text-sm" style="color:rgba(255,255,255,.85)">${lang()==='en'?'Define a new storage location. Parts received into this warehouse will appear with its name in the inventory.':'حدّد موقع تخزين جديد. القطع المستلمة فيه ستظهر باسمه في المخزون.'}</p>
          <div class="grid grid-cols-1 gap-3">
            <div><label class="field-label">${T("inv.warehouseName")}</label>
              <input id="nwName" class="input w-full" placeholder="${lang()==='en'?'e.g. Yanbu South Yard':'مثال: مستودع ينبع الجنوبي'}"/></div>
            <div><label class="field-label">${T("inv.warehouseCity")}</label>
              <input id="nwCity" class="input w-full" placeholder="${lang()==='en'?'Yanbu':'ينبع'}"/></div>
            <div><label class="field-label">${T("inv.warehouseAddress")}</label>
              <input id="nwAddress" class="input w-full" placeholder="${lang()==='en'?'Street / district / landmarks':'الشارع / الحي / علامة مميزة'}"/></div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="INV._renderReceiveModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="INV.saveNewWarehouse()">${ICONS.save()}${T("inv.newWarehouseTitle")}</button>`;
      window.app.openModal({ title: T("inv.newWarehouseTitle"), html, footer });
    },
    saveNewWarehouse() {
      const name = (document.getElementById("nwName").value || "").trim();
      if (!name) { window.app.toast(T("inv.requireField")); return; }
      const rec = D().addWarehouse({
        name,
        city: document.getElementById("nwCity").value,
        address: document.getElementById("nwAddress").value,
      });
      if (rec) {
        const d = window.APP_STATE.receiveDraft;
        if (d) d.warehouse = rec.name;
        const poDraft = window.APP_STATE.poDraft;
        if (poDraft) poDraft.warehouse = rec.name;
        window.app.toast(`${T("inv.warehouseCreated")} · ${rec.name}`);
      }
      if (window.APP_STATE.receiveDraft) INV._renderReceiveModal();
      else if (window.APP_STATE.poDraft) INV._renderPOModal();
      else window.app.closeModal();
    },

    /** ===== Approvals ===== */
    openApprove(poId) {
      const po = D().findPO(poId);
      if (!po) return;
      // Active "approver" persona = first manager in the list that hasn't yet approved.
      const approvers = D().approverList();
      const eligible = approvers.find(a => !po.approvals.some(x => x.personId === a.id));
      const html = `
        <div class="space-y-3">
          <p class="text-sm muted">${T("inv.minApprovals")}: <b>${D().MIN_APPROVALS}</b> · ${T("inv.approvedBy")}: <b>${po.approvals.length}</b></p>

          ${eligible ? `
            <div class="grid grid-cols-2 gap-3">
              <div><label class="field-label">${T("inv.approveAs")}</label>
                <select id="apvPerson" class="select w-full">
                  ${approvers.filter(a => !po.approvals.some(x => x.personId === a.id)).map(a => `
                    <option value="${a.id}">${escapeHtml(lang()==='ar'?a.nameAr:a.name)} · ${a.role.replace(/_/g,' ')}</option>
                  `).join("")}
                </select></div>
              <div><label class="field-label">${T("inv.optionalComment")}</label>
                <input id="apvComment" class="input w-full" placeholder="${T("inv.optionalComment")}"/></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <button class="btn btn-outline w-full" onclick="INV.openReject('${po.id}')">${ICONS.x()}${T("inv.rejectBtn")}</button>
              <button class="btn btn-primary w-full" onclick="INV.doApprove('${po.id}')">${ICONS.check()}${T("inv.approveBtn")}</button>
            </div>
          ` : `
            <p class="text-sm muted">${T("inv.youCannotApprove")}</p>
          `}
        </div>`;
      window.app.openModal({ title: `${T("inv.approveBtn")} — ${po.id}`, html });
    },
    doApprove(poId) {
      const personId = document.getElementById("apvPerson").value;
      const comment = document.getElementById("apvComment").value;
      D().approvePO(poId, personId, comment);
      const po = D().findPO(poId);
      window.app.toast(`${po.id} · ${po.approvals.length}/${D().MIN_APPROVALS} ${T("inv.approvalsNeeded")}`);
      window.app.closeModal();
      window.app.render();
    },
    openReject(poId) {
      const po = D().findPO(poId);
      if (!po) return;
      const approvers = D().approverList();
      const html = `
        <div class="space-y-3">
          <p class="text-sm muted">${lang()==='en'?'Rejection ends this PO. Stock changes from the receipt are not reversed automatically.':'الرفض ينهي هذا الأمر. التغييرات في المخزون لا تُعكس تلقائيًا.'}</p>
          <div><label class="field-label">${T("inv.approveAs")}</label>
            <select id="rejPerson" class="select w-full">
              ${approvers.map(a => `<option value="${a.id}">${escapeHtml(lang()==='ar'?a.nameAr:a.name)} · ${a.role.replace(/_/g,' ')}</option>`).join("")}
            </select></div>
          <div><label class="field-label">${T("inv.rejectionReason")}</label>
            <textarea id="rejReason" class="input w-full" style="min-height:80px"></textarea></div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="INV.openApprove('${po.id}')">${T("c.cancel")}</button>
        <button class="btn btn-primary" style="background:#be123c;border-color:#be123c" onclick="INV.doReject('${po.id}')">${ICONS.x()}${T("inv.rejectBtn")}</button>`;
      window.app.openModal({ title: `${T("inv.rejectBtn")} — ${po.id}`, html, footer });
    },
    doReject(poId) {
      const personId = document.getElementById("rejPerson").value;
      const reason = document.getElementById("rejReason").value;
      D().rejectPO(poId, personId, reason);
      window.app.toast(`${poId} · ${T("inv.poStatusRejected")}`);
      window.app.closeModal();
      window.app.render();
    },
  };

  function inventory() {
    const S = window.APP_STATE;
    // Migrate any legacy tab key to the 3-tab structure
    if (!S.invTab || ["parts","pos","receive"].includes(S.invTab)) S.invTab = "inventory";
    if (S.invTab === "reports") S.invTab = "analysis";  // legacy

    const allParts = D().parts;
    const totalValue = allParts.reduce((s, p) => s + p.priceTiers.reduce((q, t) => q + t.qty * t.priceSar, 0), 0);
    const lowStock = allParts.filter(p => p.qtyOnHand <= p.reorderLevel).length;
    const pos = D().purchaseOrders;
    const openPOs = pos.filter(o => o.status === "draft" || o.status === "issued").length;
    const awaitingReceipt = pos.filter(o => o.status === "issued").length;
    const pendingApprovals = pos.filter(o => o.status === "pending_approval").length;

    // 3 sub-pages now: Inventory Levels · Approvals · Financial Analysis
    const tabs = [
      ["inventory", T("inv.tabInventory"), allParts.length],
      ["approvals", T("inv.tabApprovals"), pendingApprovals],
      ["analysis",  T("inv.tabAnalysis"),  null],
    ];

    // Header action buttons — only show on the Inventory Levels sub-page.
    // The two procurement processes (Purchase Order + Add Parts) live here.
    // Buttons follow the two-step purchasing flow the user described:
    //   1) Purchase Order  →  2) Add Parts  →  (AI helper alongside).
    const headerActions = S.invTab === "inventory" ? (
        btn({ label: T("inv.newPO"),        icon: ICONS.cart(),  variant: "primary", onclick: "INV.openNewPO()" })
      + btn({ label: T("inv.addPartsBtn"),  icon: ICONS.boxes(), variant: "outline", onclick: "INV.openReceive()" })
      + btn({ label: T("inv.aiSuggestPO"), icon: ICONS.zap ? ICONS.zap() : "", variant: "outline", onclick: "INV.openAIPO()" })
    ) : "";

    return `
      ${pageHeader({
        title: T("nav.inventory"),
        subtitle: T("c.invSubtitle"),
        actions: headerActions,
      })}

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        ${stat({ label: T("c.invValue"),     value: fmtSar(totalValue), tone: "info" })}
        ${stat({ label: T("c.skus"),         value: allParts.length })}
        ${stat({ label: T("c.lowStock"),     value: lowStock, tone: lowStock > 0 ? "warn" : "ok" })}
        ${stat({ label: T("inv.poCountOpen"), value: openPOs, tone: openPOs > 0 ? "info" : "ok" })}
        ${stat({ label: T("inv.poStatusPending"), value: pendingApprovals, tone: pendingApprovals > 0 ? "warn" : "ok" })}
      </div>

      <div class="inv-tabs mb-4">
        ${tabs.map(([k, lbl, count]) => `
          <button class="inv-tab ${S.invTab === k ? 'active' : ''}" onclick="INV.setTab('${k}')">
            ${lbl}${count != null ? ` <span class="muted">(${count})</span>` : ''}
          </button>`).join("")}
      </div>

      ${S.invTab === "inventory" ? invInventoryView({ openPOs, awaitingReceipt, pendingApprovals }) :
        S.invTab === "approvals" ? invApprovalsView() :
        S.invTab === "analysis"  ? invReportsView() :
        ""}
    `;
  }

  // ===== Tab views =====

  /** Sub-page 1 — Inventory Levels.
   *  Combines: parts table + per-row financial columns (Spend 90d, Used $, Trend)
   *  with a slim "Active procurement" strip linking to the open POs and pending
   *  receipts (their lists open as compact modals).
   */
  function invInventoryView(counts) {
    counts = counts || {};
    const f = window.APP_STATE.invFilters || { cat: "all", warehouse: "all", q: "" };
    window.APP_STATE.invFilters = f;
    const CATS = ["all", "engine", "brake", "tire", "fluid", "electrical", "tank", "filter", "consumable"];

    const list = D().parts.filter(p => {
      if (f.cat !== "all" && p.category !== f.cat) return false;
      if (f.warehouse !== "all" && p.warehouse !== f.warehouse) return false;
      if (f.q) {
        const s = f.q.toLowerCase();
        if (!(p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.nameAr.includes(f.q))) return false;
      }
      return true;
    });

    // Active procurement strip — links the procurement processes that live
    // around the inventory levels (open POs awaiting issue / receipt /
    // approval). Clicking opens a compact list modal.
    const procStrip = `
      <div class="proc-strip mb-4">
        <div class="proc-label">${ICONS.cart()} ${T("inv.procActivity")}</div>
        <button class="proc-chip" onclick="INV.openPOList()">
          <span class="proc-chip-num">${counts.openPOs || 0}</span>
          <span class="proc-chip-label">${T("inv.openPOs")}</span>
        </button>
        <button class="proc-chip" onclick="INV.openReceiveList()">
          <span class="proc-chip-num">${counts.awaitingReceipt || 0}</span>
          <span class="proc-chip-label">${T("inv.awaitingReceipt")}</span>
        </button>
        <button class="proc-chip proc-chip-warn" onclick="INV.setTab('approvals')">
          <span class="proc-chip-num">${counts.pendingApprovals || 0}</span>
          <span class="proc-chip-label">${T("inv.pendingReview")}</span>
        </button>
      </div>`;

    return `
      ${procStrip}

      <div class="card p-3 mb-4">
        <div class="flex items-center gap-2 flex-wrap">
          <input class="input flex-1 min-w-[220px]" placeholder="${T("c.searchPart")}" value="${escapeHtml(f.q)}"
                 oninput="window.APP_STATE.invFilters.q=this.value; window.app.render()"/>
          <div class="flex items-center gap-1 flex-wrap">
            ${CATS.map(c => `<button class="btn-chip ${f.cat===c?'active':''}" onclick="window.APP_STATE.invFilters.cat='${c}'; window.app.render()">${c==='all'?T('c.all'):T(`cat.${c}`)}</button>`).join("")}
          </div>
          <select class="select" onchange="window.APP_STATE.invFilters.warehouse=this.value; window.app.render()">
            <option value="all" ${f.warehouse==='all'?'selected':''}>${T("c.allWarehouses")}</option>
            ${["Riyadh", "Jeddah", "Dammam"].map(w => `<option value="${w}" ${f.warehouse===w?'selected':''}>${depotLabel(w)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto scroll-thin">
          <table class="tbl">
            <thead><tr>
              <th>${T("c.sku")}</th>
              <th>${T("c.part")}</th>
              <th>${T("c.category")}</th>
              <th>${T("c.warehouse")}</th>
              <th>${T("inv.stockLabel")}</th>
              <th>${T("inv.currPrice")}</th>
              <th>${T("inv.stockValue")}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="8" class="text-center muted py-6">${T("inv.inventoryListEmpty")}</td></tr>` : list.map(p => {
                const low = p.qtyOnHand <= p.reorderLevel;
                const totVal = p.priceTiers.reduce((s, t) => s + t.qty * t.priceSar, 0);
                const priceDelta = p.previousPriceSar != null
                  ? `<span class="text-[10px] ${p.currentPriceSar > p.previousPriceSar ? 'delta-up' : 'delta-down'} ms-1">${p.currentPriceSar > p.previousPriceSar ? '↑' : '↓'}${Math.abs(+(((p.currentPriceSar - p.previousPriceSar)/p.previousPriceSar)*100).toFixed(0))}%</span>`
                  : "";
                return `
                <tr class="${low ? 'row-low' : ''}" style="cursor:pointer" onclick="INV.openPart('${p.id}')">
                  <td class="font-mono text-xs">${p.sku}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="muted">${ICONS.package()}</span>
                      <div>
                        <div class="font-medium">${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</div>
                        <div class="text-[11px] muted">${escapeHtml(lang()==='ar'?p.name:p.nameAr)}</div>
                      </div>
                    </div>
                  </td>
                  <td>${T(`cat.${p.category}`)}</td>
                  <td>${depotLabel(p.warehouse)}</td>
                  <td>${INV.stockCell(p)}</td>
                  <td class="tabular">
                    <span class="font-semibold">${fmtSar(p.currentPriceSar)}</span>${priceDelta}
                  </td>
                  <td class="tabular font-medium">${fmtSar(totVal)}</td>
                  <td>
                    <div class="row-actions">
                      ${btn({ label: T("c.view"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); INV.openPart('${p.id}')` })}
                      <button class="btn btn-outline btn-xs btn-icon" title="${T("inv.finReport")}" onclick="event.stopPropagation(); INV.openPartFinance('${p.id}')">${ICONS.chart()}</button>
                      ${low ? `<button class="btn btn-primary btn-xs" title="${T("inv.createPO")}" onclick="event.stopPropagation(); INV.openReorder('${p.id}')">${ICONS.cart()}</button>` : ""}
                    </div>
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function invPOsView() {
    const f = window.APP_STATE.poFilter || "all";
    window.APP_STATE.poFilter = f;
    const all = D().purchaseOrders;
    const counts = {
      all: all.length,
      draft: all.filter(p => p.status === "draft").length,
      issued: all.filter(p => p.status === "issued").length,
      pending_approval: all.filter(p => p.status === "pending_approval").length,
      approved: all.filter(p => p.status === "approved").length,
      rejected: all.filter(p => p.status === "rejected").length,
    };
    const list = (f === "all" ? all : all.filter(p => p.status === f))
      .slice().sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

    const tabs = [
      ["all",              T("c.all"),               counts.all],
      ["draft",            T("inv.poStatusDraft"),   counts.draft],
      ["issued",           T("inv.poStatusIssued"),  counts.issued],
      ["pending_approval", T("inv.poStatusPending"), counts.pending_approval],
      ["approved",         T("inv.poStatusApproved"),counts.approved],
      ["rejected",         T("inv.poStatusRejected"),counts.rejected],
    ];

    return `
      <div class="card mb-4 overflow-hidden">
        <div class="flex items-end gap-1 px-3 pt-2 border-b border-app flex-wrap">
          ${tabs.map(([k, lbl, n]) => `
            <button class="subtab ${f === k ? 'active' : ''}" onclick="window.APP_STATE.poFilter='${k}'; window.app.render()">
              ${lbl} <span class="muted ms-1">(${n})</span>
            </button>`).join("")}
        </div>
        <div class="overflow-x-auto scroll-thin">
          <table class="tbl">
            <thead><tr>
              <th>${T("inv.poNumber")}</th>
              <th>${T("c.status")}</th>
              <th>${T("c.supplier")}</th>
              <th>${T("inv.requestDate")}</th>
              <th>${T("inv.expectedDelivery")}</th>
              <th>${lang()==='en'?'Lines':'البنود'}</th>
              <th>${T("inv.poTotal")}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="8" class="text-center muted py-6">${lang()==='en'?'No purchase orders':'لا توجد أوامر شراء'}</td></tr>` : list.map(o => {
                const total = o.actualTotalSar != null ? o.actualTotalSar : o.estimatedTotalSar;
                return `<tr style="cursor:pointer" onclick="INV.openPO('${o.id}')">
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs font-semibold">${o.id}</span>
                      ${o.aiGenerated ? `<span class="ai-pill" title="${T("inv.aiGeneratedBy")}">★ AI</span>` : ''}
                    </div>
                  </td>
                  <td>${INV._poStatusPill(o.status)}</td>
                  <td>
                    <div class="font-medium text-sm">${escapeHtml(o.supplier.name)}</div>
                    <div class="text-[11px] muted">${o.supplier.phone}</div>
                  </td>
                  <td class="text-xs">${o.requestDate}</td>
                  <td class="text-xs">${o.expectedDelivery}</td>
                  <td class="tabular text-xs">${o.lines.length}</td>
                  <td class="tabular font-medium">${fmtSar(total)}</td>
                  <td>${btn({ label: T("inv.viewPO"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); INV.openPO('${o.id}')` })}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function invReceiveView() {
    const issued = D().purchaseOrders.filter(p => p.status === "issued");
    return `
      <div class="card p-4 mb-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="font-semibold">${T("inv.tabReceive")}</h3>
            <p class="text-sm muted mt-0.5">${lang()==='en'?'Step 2 of purchasing. Pick an issued PO below or enter its number directly.':'الخطوة الثانية من الشراء. اختر أمرًا صادرًا أدناه أو أدخل رقمه مباشرة.'}</p>
          </div>
          <button class="btn btn-primary" onclick="INV.openReceive()">${ICONS.boxes()}${T("inv.tabReceive")}</button>
        </div>
        ${issued.length === 0 ? `<p class="muted text-sm py-3 text-center">${lang()==='en'?'No issued POs awaiting delivery.':'لا توجد أوامر صادرة بانتظار التسليم.'}</p>` : `
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            ${issued.map(o => `
              <div class="rounded-lg border border-app p-3 cursor-pointer hover:shadow-soft" onclick="INV.openReceive('${o.id}')">
                <div class="flex items-center justify-between mb-1">
                  <span class="font-mono text-xs font-semibold">${o.id}</span>
                  ${o.aiGenerated ? `<span class="ai-pill">★ AI</span>` : ''}
                </div>
                <div class="font-medium text-sm">${escapeHtml(o.supplier.name)}</div>
                <div class="text-[11px] muted mb-2">${T("inv.expectedDelivery")}: ${o.expectedDelivery}</div>
                <div class="flex justify-between text-xs">
                  <span class="muted">${o.lines.length} ${lang()==='en'?'line items':'بنود'}</span>
                  <span class="tabular font-medium">${fmtSar(o.estimatedTotalSar)}</span>
                </div>
              </div>`).join("")}
          </div>
        `}
      </div>
    `;
  }

  function invApprovalsView() {
    const queue = D().purchaseOrders.filter(p => p.status === "pending_approval")
      .sort((a, b) => new Date(a.receivedDate) - new Date(b.receivedDate));
    return `
      <div class="card overflow-hidden">
        <div class="p-3 border-b border-app">
          <h3 class="font-semibold">${T("inv.approvalsQueue")}</h3>
          <p class="text-sm muted">${T("inv.minApprovals")}: <b>${D().MIN_APPROVALS}</b></p>
        </div>
        ${queue.length === 0 ? `<p class="muted text-sm py-6 text-center">${lang()==='en'?'No POs awaiting approval.':'لا توجد أوامر بانتظار الاعتماد.'}</p>` : `
          <table class="tbl">
            <thead><tr>
              <th>${T("inv.poNumber")}</th>
              <th>${T("c.supplier")}</th>
              <th>${T("inv.receivedDate")}</th>
              <th>${T("inv.actualTotal")}</th>
              <th>${T("inv.approvedBy")}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${queue.map(o => {
                const approverNames = o.approvals.map(a => {
                  const per = D().findPerson(a.personId);
                  return escapeHtml(per ? (lang()==='ar'?per.nameAr:per.name) : a.personId);
                }).join(", ");
                return `<tr style="cursor:pointer" onclick="INV.openPO('${o.id}')">
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs font-semibold">${o.id}</span>
                      ${o.aiGenerated ? `<span class="ai-pill">★ AI</span>` : ''}
                    </div>
                  </td>
                  <td><div class="text-sm">${escapeHtml(o.supplier.name)}</div></td>
                  <td class="text-xs">${o.receivedDate || '—'}</td>
                  <td class="tabular font-medium">${fmtSar(o.actualTotalSar != null ? o.actualTotalSar : o.estimatedTotalSar)}</td>
                  <td class="text-xs">
                    <div class="approval-dots">
                      ${Array.from({length: D().MIN_APPROVALS}).map((_, i) =>
                        `<span class="approval-dot ${i < o.approvals.length ? 'on' : ''}"></span>`
                      ).join("")}
                      <span class="muted ms-1">${o.approvals.length}/${D().MIN_APPROVALS}</span>
                    </div>
                    ${approverNames ? `<div class="text-[11px] muted">${approverNames}</div>` : ''}
                  </td>
                  <td><button class="btn btn-primary btn-xs" onclick="event.stopPropagation(); INV.openApprove('${o.id}')">${ICONS.check()}${T("inv.approveBtn")}</button></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  function invReportsView() {
    const allParts = D().parts;
    const pos = D().purchaseOrders;
    // Spend 90d / 30d
    const today = new Date(2026, 4, 20);
    const ndaysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    const spend30 = pos.filter(p => p.receivedDate && new Date(p.receivedDate) >= ndaysAgo(30) && p.status === "approved")
      .reduce((s, p) => s + (p.actualTotalSar || 0), 0);
    const spend90 = pos.filter(p => p.receivedDate && new Date(p.receivedDate) >= ndaysAgo(90) && (p.status === "approved" || p.status === "pending_approval"))
      .reduce((s, p) => s + (p.actualTotalSar || p.estimatedTotalSar || 0), 0);
    const totalValue = allParts.reduce((s, p) => s + p.priceTiers.reduce((q, t) => q + t.qty * t.priceSar, 0), 0);

    // Per-category spend (from POs)
    const spendByCat = {};
    pos.filter(p => p.status === "approved" || p.status === "pending_approval").forEach(po => {
      po.lines.forEach(l => {
        const part = D().findPart(l.partId);
        if (!part) return;
        const cost = (l.receivedQty || l.qty) * (l.receivedUnitPriceSar != null ? l.receivedUnitPriceSar : l.unitPriceSar);
        spendByCat[part.category] = (spendByCat[part.category] || 0) + cost;
      });
    });
    const catRows = Object.entries(spendByCat).sort((a,b) => b[1]-a[1]).slice(0, 6);
    const catMax = catRows[0] ? catRows[0][1] : 1;

    // Spend by supplier
    const spendBySup = {};
    pos.filter(p => p.status === "approved" || p.status === "pending_approval").forEach(po => {
      spendBySup[po.supplier.name] = (spendBySup[po.supplier.name] || 0) + (po.actualTotalSar || po.estimatedTotalSar || 0);
    });
    const supRows = Object.entries(spendBySup).sort((a,b) => b[1]-a[1]);
    const supMax = supRows[0] ? supRows[0][1] : 1;

    // AI insights
    const lowParts = allParts.filter(p => p.qtyOnHand <= p.reorderLevel);
    const pricedUp = allParts.filter(p => p.previousPriceSar && (p.currentPriceSar - p.previousPriceSar) / p.previousPriceSar > 0.1);
    const supplierPOCount = {};
    pos.forEach(po => { supplierPOCount[po.supplier.name] = (supplierPOCount[po.supplier.name] || 0) + 1; });
    const consolidate = Object.entries(supplierPOCount).filter(([, n]) => n >= 3);

    return `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${stat({ label: T("inv.spend30d"), value: fmtSar(spend30), tone: "info" })}
        ${stat({ label: T("inv.spend90d"), value: fmtSar(spend90), tone: "info" })}
        ${stat({ label: T("c.invValue"), value: fmtSar(totalValue), tone: "ok" })}
        ${stat({ label: T("inv.poCountOpen"), value: pos.filter(p => p.status === "draft" || p.status === "issued").length, tone: "warn" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("inv.topSpendCats")}</h3>
          ${catRows.length === 0 ? `<p class="muted text-sm">${lang()==='en'?'No approved spend yet':'لا يوجد إنفاق معتمد بعد'}</p>` : `
            <div class="space-y-2">
              ${catRows.map(([cat, val]) => `
                <div>
                  <div class="flex justify-between text-xs mb-1">
                    <span class="capitalize">${T(`cat.${cat}`)}</span>
                    <span class="font-medium tabular">${fmtSar(val)}</span>
                  </div>
                  ${bar((val/catMax)*100, 100, "ok")}
                </div>`).join("")}
            </div>
          `}
        </div>

        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("inv.supplierSpend")}</h3>
          ${supRows.length === 0 ? `<p class="muted text-sm">${lang()==='en'?'No approved spend yet':'لا يوجد إنفاق معتمد بعد'}</p>` : `
            <div class="space-y-2">
              ${supRows.map(([sup, val]) => `
                <div>
                  <div class="flex justify-between text-xs mb-1">
                    <span>${escapeHtml(sup)}</span>
                    <span class="font-medium tabular">${fmtSar(val)}</span>
                  </div>
                  ${bar((val/supMax)*100, 100, "ok")}
                </div>`).join("")}
            </div>
          `}
        </div>
      </div>

      <div class="card p-4 ai-insights-card">
        <div class="flex items-center gap-2 mb-3">
          <span class="ai-chip">${ICONS.zap ? ICONS.zap() : '★'} ${T("inv.aiInsights")}</span>
        </div>
        <div class="space-y-3">
          ${lowParts.length > 0 ? `
            <div class="insight insight-warn">
              <div class="font-medium text-sm">${T("inv.insightsLowStock")} <span class="ai-count">${lowParts.length}</span></div>
              <div class="text-xs muted mt-1">${lowParts.slice(0,4).map(p => p.sku).join(", ")}${lowParts.length > 4 ? '…' : ''}</div>
              <button class="btn btn-outline btn-xs mt-2" onclick="INV.openAIPO()">${T("inv.aiSuggestPO")} →</button>
            </div>` : ""}
          ${pricedUp.length > 0 ? `
            <div class="insight insight-info">
              <div class="font-medium text-sm">${T("inv.insightsPriceUp")} <span class="ai-count">${pricedUp.length}</span></div>
              <div class="text-xs muted mt-1">${pricedUp.slice(0,4).map(p => `${p.sku} (${(((p.currentPriceSar - p.previousPriceSar)/p.previousPriceSar)*100).toFixed(0)}%)`).join(", ")}</div>
            </div>` : ""}
          ${consolidate.length > 0 ? `
            <div class="insight insight-info">
              <div class="font-medium text-sm">${T("inv.insightsConsolidate")}</div>
              <div class="text-xs muted mt-1">${consolidate.map(([s, n]) => `${s} (${n})`).join(", ")}</div>
            </div>` : ""}
          ${lowParts.length === 0 && pricedUp.length === 0 && consolidate.length === 0 ? `
            <p class="muted text-sm">${lang()==='en'?'No recommendations at this time — inventory looks healthy.':'لا توصيات حالياً — المخزون في حالة جيدة.'}</p>` : ""}
        </div>
      </div>
    `;
  }

  // ---------- Reports ----------
  function reports() {
    const k = D().fleetKpis();
    const margin = k.revenue30d - k.opCost30d;
    const marginPct = +((margin / Math.max(1, k.revenue30d)) * 100).toFixed(1);
    const costPerLiter = +(k.opCost30d / Math.max(1, k.litersDelivered30d) * 1000).toFixed(2);

    const monthly = [
      { m: "Dec", revenue: 320000, cost: 215000, liters: 3120000, trips: 412 },
      { m: "Jan", revenue: 358000, cost: 224000, liters: 3450000, trips: 438 },
      { m: "Feb", revenue: 345000, cost: 218000, liters: 3290000, trips: 421 },
      { m: "Mar", revenue: 392000, cost: 232000, liters: 3580000, trips: 467 },
      { m: "Apr", revenue: 412000, cost: 241000, liters: 3720000, trips: 489 },
      { m: "May", revenue: 428000, cost: 235000, liters: 3870000, trips: 502 },
    ];
    const depotPerf = [
      { depot: "Riyadh", trips: 168, liters: 1240000, util: 78 },
      { depot: "Jeddah", trips: 142, liters: 1080000, util: 71 },
      { depot: "Dammam", trips: 118, liters: 920000, util: 68 },
      { depot: "Madinah", trips: 74, liters: 630000, util: 62 },
    ];
    const costMix = [
      { name: lang()==='en'?"Fuel":"وقود", value: 142000, color: "#0b7eea" },
      { name: lang()==='en'?"Maintenance":"صيانة", value: 58000, color: "#f59e0b" },
      { name: lang()==='en'?"Drivers":"سائقون", value: 96000, color: "#10b981" },
      { name: lang()==='en'?"Parts":"قطع", value: 31000, color: "#8b5cf6" },
      { name: lang()==='en'?"Insurance":"تأمين", value: 14000, color: "#06b6d4" },
      { name: lang()==='en'?"Other":"أخرى", value: 18000, color: "#94a3b8" },
    ];

    setTimeout(() => {
      drawAreaPair("rvcChart", monthly.map(m=>m.m), monthly.map(m=>m.revenue), monthly.map(m=>m.cost),
        { l1: lang()==='en'?"Revenue":"الإيرادات", l2: lang()==='en'?"Cost":"التكلفة", c1: "#10b981", c2: "#f59e0b" });
      PAGES_1.drawPie("costPie", costMix.map(c => ({ label: c.name, value: c.value, color: c.color })));
      PAGES_1.drawDualLine("litersTrend", monthly.map(m=>m.m), monthly.map(m=>m.liters/1000), monthly.map(m=>m.trips),
        { c1: "#0b7eea", c2: "#8b5cf6", l1: lang()==='en'?"Liters (×1000)":"لتر (×1000)", l2: lang()==='en'?"Trips":"رحلات" });
      PAGES_1.drawDualBar("depotChart", depotPerf.map(d=>depotLabel(d.depot)), depotPerf.map(d=>d.trips), depotPerf.map(d=>d.util),
        { c1: "#0b7eea", c2: "#10b981", l1: lang()==='en'?"Trips":"رحلات", l2: lang()==='en'?"Util %":"% استخدام" });
    }, 0);

    return `
      ${pageHeader({
        title: T("nav.reports"),
        subtitle: T("c.reportsSubtitle"),
        actions: btn({ label: T("c.exportPDF"), icon: ICONS.download(), variant: "outline" })
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-5">
        ${stat({ label: T("c.revenue"), value: fmtSar(k.revenue30d), sub: "+8.4%", tone: "ok" })}
        ${stat({ label: T("kpi.opCost"), value: fmtSar(k.opCost30d), sub: "-4.8%", tone: "ok" })}
        ${stat({ label: T("c.margin"), value: fmtSar(margin), sub: `${marginPct}%`, tone: marginPct > 25 ? "ok" : "warn" })}
        ${stat({ label: T("c.costPer1000"), value: `${costPerLiter} ${T("c.sar")}`, tone: "info" })}
        ${stat({ label: T("c.revPerKm"), value: `17.5 ${T("c.sar")}`, tone: "info" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div class="lg:col-span-2 card p-4">
          <h3 class="font-semibold mb-3">${T("c.revVsCost")}</h3>
          <div class="h-64"><canvas id="rvcChart"></canvas></div>
        </div>
        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("c.costMix")}</h3>
          <div class="h-56"><canvas id="costPie"></canvas></div>
          <div class="space-y-1 mt-2 text-xs">
            ${costMix.map(c => `<div class="flex justify-between"><span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full" style="background:${c.color}"></span>${escapeHtml(c.name)}</span><span class="font-medium tabular">${fmtSar(c.value)}</span></div>`).join("")}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("c.litersChart")}</h3>
          <div class="h-56"><canvas id="litersTrend"></canvas></div>
        </div>
        <div class="card p-4">
          <h3 class="font-semibold mb-3">${T("c.depotPerf")}</h3>
          <div class="h-56"><canvas id="depotChart"></canvas></div>
        </div>
      </div>

      ${section({
        title: T("c.costSaving"),
        body: `<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          ${oppCard(T("c.routeOpt"), 28000, T("c.routeOptDesc"))}
          ${oppCard(T("c.predMaint"), 42000, T("c.predMaintDesc"))}
          ${oppCard(T("c.idleRealloc"), 18000, T("c.idleReallocDesc"))}
        </div>`
      })}
    `;
  }
  function oppCard(title, saving, desc) {
    return `<div class="rounded-lg border border-app p-3">
      <div class="flex items-center gap-2 mb-1"><span class="text-emerald-500">${ICONS.trendDown()}</span><span class="font-medium text-sm">${UI.escapeHtml(title)}</span></div>
      <div class="text-2xl font-semibold tabular text-emerald-600">${UI.fmtSar(saving)}</div>
      <p class="text-xs muted mt-1">${UI.escapeHtml(desc)}</p>
    </div>`;
  }
  function drawAreaPair(id, labels, d1, d2, { l1, l2, c1, c2 }) {
    const el = document.getElementById(id); if (!el) return;
    if (window.__charts && window.__charts[id]) window.__charts[id].destroy();
    window.__charts = window.__charts || {};
    window.__charts[id] = new Chart(el, {
      type: "line",
      data: { labels, datasets: [
        { label: l1, data: d1, borderColor: c1, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
          backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280); g.addColorStop(0, c1 + "55"); g.addColorStop(1, c1 + "00"); return g; } },
        { label: l2, data: d2, borderColor: c2, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
          backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280); g.addColorStop(0, c2 + "55"); g.addColorStop(1, c2 + "00"); return g; } },
      ]},
      options: { maintainAspectRatio: false, plugins: { legend: { position: "top", align: "end", labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: { x: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
                  y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } } } }
    });
  }

  return { maintenance, predictive, iot, inventory, reports };
})();
