// Archive page v2 — simple, doc-focused.
//
// The page is one clean stream of documents (no project rail, no KPI tiles,
// no general-info tabs). Each card shows ONLY the fields specific to that
// document (e.g. license expiry, issuing authority, plate, CR number).
// Upload flow is autonomous: pick a file → AI reads it → fields are
// auto-populated → user clicks Finish.
window.PAGES_ARCHIVE = (function () {
  const { fmtNum, fmtSar, escapeHtml, pageHeader, stat, pill, btn, section } = UI;
  const D = () => window.DATA;
  const lang = () => window.APP_STATE.lang;

  // Reference "today" for expiry math (matches the data seed)
  const TODAY = new Date(2026, 5, 7);

  // ---- Local helpers ----
  const fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const locale = lang() === "ar" ? "ar-SA-u-ca-gregory" : "en-GB";
    try { return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
  };

  function ensureState() {
    const S = window.APP_STATE;
    if (!S.arc) S.arc = {
      groupBy: "type",   // type | issuer | expiry | none
      typeFilter: "all",
      q: "",
      upload: null,      // { filename, type, extracted, confidence, scanning, dataUrl, mime }
    };
    if (!S.arc.groupBy) S.arc.groupBy = "type";
    if (!S.arc.typeFilter) S.arc.typeFilter = "all";
    if (S.arc.q == null) S.arc.q = "";
  }

  /** Compose the small expiry pill that sits at the top-right of every card. */
  function expiryPill(doc) {
    const status = D().docExpiryStatus(doc);
    const days = D().docDaysUntilExpiry(doc);
    const exp = doc.extracted?.expiryDate;
    if (status === "n_a") return `<span class="exp-pill exp-na">${T("arc.notDated")}</span>`;
    if (status === "expired") return `<span class="exp-pill exp-bad">${T("arc.expired")} · ${Math.abs(days)} ${T("arc.daysAgo")}</span>`;
    if (status === "expiring_soon") return `<span class="exp-pill exp-warn">${days === 0 ? T("arc.todayLabel") : `${days} ${T("arc.daysLeft")}`}</span>`;
    return `<span class="exp-pill exp-ok">${T("arc.valid")} · ${days} ${T("arc.daysLeft")}</span>`;
  }

  /** Render a field's value with light formatting (dates, currency). */
  function fmtField(key, value) {
    if (value == null || value === "") return "—";
    if (/(Date|expiry|due|nextDue|effective)/i.test(key)) return fmtDate(value);
    if (key === "amount" || key === "capitalSar" || key === "premium" || key === "sumInsured") return fmtSar(value);
    return String(value);
  }

  /** Doc-card layout: heading (type-specific), 3–4 fields, expiry pill, View. */
  function docCard(doc) {
    const type = doc.type;
    const heading = D().docPrimaryHeading(doc);
    const summary = D().docSummaryFields(doc) || [];
    const issuerLine = D().docIssuer(doc);
    return `
      <div class="doc-card" onclick="ARC.openDoc('${doc.id}')">
        <div class="doc-card-head">
          <div class="doc-type-chip doc-type-${type}">${T(`doc.${type}`)}</div>
          ${expiryPill(doc)}
        </div>
        <div class="doc-card-title">${escapeHtml(heading)}</div>
        <div class="doc-card-issuer">${escapeHtml(issuerLine)}</div>
        ${groupChip(doc)}
        <div class="doc-card-fields">
          ${summary.map(([k, v]) => `
            <div class="doc-field">
              <div class="doc-field-label">${T(`af.${k}`) === `af.${k}` ? escapeHtml(k) : T(`af.${k}`)}</div>
              <div class="doc-field-value">${escapeHtml(fmtField(k, v))}</div>
            </div>`).join("")}
        </div>
        <div class="doc-card-foot">
          <button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); ARC.openDoc('${doc.id}')">${ICONS.eye()}${T("arc.open")}</button>
          <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); ARC.viewOriginal('${doc.id}')">${T("arc.viewOriginal")}</button>
        </div>
      </div>`;
  }

  /** Group key for the current "Group by" mode. Returns { key, label } so
   *  the section header reads naturally. */
  function groupOf(doc, mode) {
    if (mode === "type") return { key: doc.type, label: T(`doc.${doc.type}`) };
    if (mode === "issuer") return { key: D().docIssuer(doc), label: D().docIssuer(doc) };
    if (mode === "expiry") {
      const s = D().docExpiryStatus(doc);
      const lbl = s === "expired" ? T("arc.expired")
                : s === "expiring_soon" ? T("arc.expiringSoon")
                : s === "valid" ? T("arc.valid")
                : T("arc.notDated");
      // Sort so "expired" always sits at the top.
      const ord = { expired: 0, expiring_soon: 1, valid: 2, n_a: 3 }[s];
      return { key: `${ord}-${s}`, label: lbl };
    }
    if (mode === "custom") {
      const g = doc.customGroupId ? D().findArchiveGroup(doc.customGroupId) : null;
      if (!g) return { key: "zzz-ungrouped", label: T("arc.ungrouped"), color: null };
      // Sort newest groups last so the order is stable + predictable.
      return { key: `${g.id}`, label: (lang()==='ar'?g.nameAr:g.name), color: g.color };
    }
    return { key: "all", label: T("arc.docs") };
  }

  /** Compact colored chip rendered on a doc card when it belongs to a custom group. */
  function groupChip(doc) {
    if (!doc.customGroupId) return "";
    const g = D().findArchiveGroup(doc.customGroupId);
    if (!g) return "";
    const name = lang()==='ar' ? g.nameAr : g.name;
    return `<span class="grp-chip" style="--c:${g.color}">${ICONS.folder ? ICONS.folder() : ''}${escapeHtml(name)}</span>`;
  }

  /** Build the section list from the current filters + group mode. */
  function buildSections(docs) {
    const S = window.APP_STATE.arc;
    const mode = S.groupBy;
    if (mode === "none") {
      return [{ key: "all", label: T("arc.docs"), docs }];
    }
    const map = new Map();
    docs.forEach(d => {
      const g = groupOf(d, mode);
      if (!map.has(g.key)) map.set(g.key, { key: g.key, label: g.label, docs: [] });
      map.get(g.key).docs.push(d);
    });
    return [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  // ---- ARC handlers ----
  window.ARC = {
    setGroupBy(v) { ensureState(); window.APP_STATE.arc.groupBy = v; window.app.render(); },
    setTypeFilter(v) { ensureState(); window.APP_STATE.arc.typeFilter = v; window.app.render(); },
    onSearch(v) {
      ensureState();
      window.APP_STATE.arc.q = v || "";
      // Re-render only the doc grid so the search input keeps focus.
      const wrap = document.getElementById("arc-grid");
      if (wrap) wrap.innerHTML = renderGrid();
    },
    clearSearch() {
      ensureState();
      window.APP_STATE.arc.q = "";
      window.app.render();
    },

    // ---- Upload flow ----
    // ---- Custom-group management ----
    openNewGroup() {
      const swatches = ["#0b7eea","#f59e0b","#7c3aed","#10b981","#be123c","#64748b","#0ea5e9","#db2777"];
      // Draft for which documents will land in the new group (none picked yet)
      window.APP_STATE.arc.newGroupDocIds = new Set();
      const docs = D().documents.slice().sort((a, b) => D().docPrimaryHeading(a).localeCompare(D().docPrimaryHeading(b)));
      const html = `
        <div class="space-y-3">
          <p class="text-sm muted">${lang()==='en'?'Custom groups cut across document types — like binders or project folders.':'مجموعات مخصصة تقسّم المستندات حسب احتياجك (مثل: ملفات أو مشاريع).'}</p>
          <div>
            <label class="field-label">${T("arc.groupName")}</label>
            <input id="agName" class="input w-full" placeholder="${lang()==='en'?'e.g. Saudi Aramco contract — 2026':'مثال: عقد أرامكو السعودية — 2026'}"/>
          </div>
          <div>
            <label class="field-label">${T("arc.groupColor")}</label>
            <div class="grp-swatch-row">
              ${swatches.map((c, i) => `
                <label class="grp-swatch" style="--c:${c}">
                  <input type="radio" name="agColor" value="${c}" ${i===0?'checked':''}/>
                  <span class="grp-swatch-dot" style="background:${c}"></span>
                </label>`).join("")}
            </div>
          </div>

          <!-- Pick documents to drop into this group right away -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="field-label !mb-0">${T("arc.pickDocsForGroup")}</label>
              <span id="ngDocCount" class="muted text-[11px]">0 ${T("arc.selectedNDocs")}</span>
            </div>
            <p class="text-[11px] muted mb-2">${T("arc.pickDocsHint")}</p>
            <div class="doc-checklist">
              <input type="search" class="input w-full mb-2" placeholder="${T("arc.searchPlaceholder")}" oninput="ARC._filterChecklist(this.value, 'ng')"/>
              <div id="ng-doc-rows" class="doc-checklist-rows">
                ${docs.map(d => `
                  <label class="doc-check-row" data-search="${escapeHtml((d.filename + " " + D().docPrimaryHeading(d) + " " + Object.values(d.extracted||{}).join(" ")).toLowerCase())}">
                    <input type="checkbox" value="${d.id}" onchange="ARC._toggleNewGroupDoc('${d.id}', this.checked)"/>
                    <span class="doc-type-chip doc-type-${d.type}">${T(`doc.${d.type}`)}</span>
                    <span class="doc-check-title">${escapeHtml(D().docPrimaryHeading(d))}</span>
                    ${d.customGroupId ? `<span class="muted text-[11px]">· ${escapeHtml((D().findArchiveGroup(d.customGroupId)||{}).name || '')}</span>` : ""}
                  </label>`).join("")}
              </div>
            </div>
          </div>

          ${D().archiveCustomGroups.length > 0 ? `
            <div>
              <div class="field-label">${lang()==='en'?'Existing groups':'المجموعات الحالية'}</div>
              <div class="grp-list">
                ${D().archiveCustomGroups.map(g => {
                  const count = D().documents.filter(d => d.customGroupId === g.id).length;
                  return `<div class="grp-row" style="--c:${g.color}">
                    <span class="grp-swatch-dot" style="background:${g.color}"></span>
                    <span class="flex-1 truncate text-sm">${escapeHtml(lang()==='ar'?g.nameAr:g.name)}</span>
                    <span class="muted text-[11px]">${count} ${T("arc.docs").toLowerCase()}</span>
                    <button class="icon-btn" title="${T("arc.manageMembers")}" onclick="ARC.openManageMembers('${g.id}')">${ICONS.users()}</button>
                    <button class="icon-btn" title="${T("arc.deleteGroup")}" onclick="ARC.deleteGroup('${g.id}')">${ICONS.trash()}</button>
                  </div>`;
                }).join("")}
              </div>
            </div>` : ""}
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="ARC.saveNewGroup()">${ICONS.save()}${T("arc.addGroup")}</button>`;
      window.app.openModal({ title: T("arc.newGroup"), html, footer, size: "lg" });
    },

    _toggleNewGroupDoc(docId, checked) {
      const set = window.APP_STATE.arc.newGroupDocIds;
      if (!set) return;
      if (checked) set.add(docId); else set.delete(docId);
      const counter = document.getElementById("ngDocCount");
      if (counter) counter.textContent = `${set.size} ${T("arc.selectedNDocs")}`;
    },

    /** Lightweight client-side filter for the doc checklist. */
    _filterChecklist(query, scope) {
      const wrap = document.getElementById(scope === "mm" ? "mm-doc-rows" : "ng-doc-rows");
      if (!wrap) return;
      const q = (query || "").toLowerCase().trim();
      wrap.querySelectorAll(".doc-check-row").forEach(row => {
        if (!q) { row.style.display = ""; return; }
        const hay = row.getAttribute("data-search") || "";
        row.style.display = hay.includes(q) ? "" : "none";
      });
    },

    saveNewGroup() {
      const name = document.getElementById("agName").value.trim();
      const colorEl = document.querySelector('input[name="agColor"]:checked');
      const color = colorEl ? colorEl.value : "#0b7eea";
      if (!name) {
        window.app.toast(lang()==='en' ? "Enter a group name" : "أدخل اسم المجموعة");
        return;
      }
      const id = `AGRP-${String(Date.now()).slice(-6)}`;
      D().archiveCustomGroups.push({
        id, name, nameAr: name, color,
        createdAt: new Date().toISOString().slice(0, 10),
      });
      // Bulk-assign every picked doc into this new group.
      const picks = window.APP_STATE.arc.newGroupDocIds;
      let assigned = 0;
      if (picks && picks.size > 0) {
        picks.forEach(docId => {
          const d = D().findDocument(docId);
          if (d) { d.customGroupId = id; assigned++; }
        });
      }
      window.APP_STATE.arc.newGroupDocIds = null;
      window.app.toast(`${T("arc.groupCreated")} · ${name}${assigned > 0 ? ` · ${assigned} ${T("arc.bulkAssigned")}` : ""}`);
      window.app.closeModal();
      // Switch to Custom group view so the new group is visible immediately.
      window.APP_STATE.arc.groupBy = "custom";
      window.app.render();
    },

    /** Manage members of an existing group — full checklist with current
     *  members pre-checked. Saving diffs the new set against the current. */
    openManageMembers(groupId) {
      const g = D().findArchiveGroup(groupId);
      if (!g) return;
      const docs = D().documents.slice().sort((a, b) => D().docPrimaryHeading(a).localeCompare(D().docPrimaryHeading(b)));
      const current = new Set(D().documents.filter(d => d.customGroupId === groupId).map(d => d.id));
      window.APP_STATE.arc.mmDraft = { groupId, set: new Set(current) };
      const html = `
        <div class="space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="grp-swatch-dot" style="background:${g.color}"></span>
            <span class="font-semibold">${escapeHtml(lang()==='ar'?g.nameAr:g.name)}</span>
            <span id="mmDocCount" class="muted text-[11px]">· ${current.size} ${T("arc.selectedNDocs")}</span>
          </div>
          <p class="text-[11px] muted">${T("arc.pickDocsHint")}</p>
          <input type="search" class="input w-full" placeholder="${T("arc.searchPlaceholder")}" oninput="ARC._filterChecklist(this.value, 'mm')"/>
          <div class="doc-checklist" style="max-height:24rem">
            <div id="mm-doc-rows" class="doc-checklist-rows">
              ${docs.map(d => `
                <label class="doc-check-row" data-search="${escapeHtml((d.filename + " " + D().docPrimaryHeading(d) + " " + Object.values(d.extracted||{}).join(" ")).toLowerCase())}">
                  <input type="checkbox" value="${d.id}" ${current.has(d.id) ? 'checked' : ''} onchange="ARC._toggleMmDoc('${d.id}', this.checked)"/>
                  <span class="doc-type-chip doc-type-${d.type}">${T(`doc.${d.type}`)}</span>
                  <span class="doc-check-title">${escapeHtml(D().docPrimaryHeading(d))}</span>
                  ${d.customGroupId && d.customGroupId !== groupId
                    ? `<span class="muted text-[11px]">· ${escapeHtml((D().findArchiveGroup(d.customGroupId)||{}).name || '')}</span>`
                    : ""}
                </label>`).join("")}
            </div>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="ARC.openNewGroup()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="ARC.saveManageMembers()">${ICONS.save()}${T("arc.saveChanges")}</button>`;
      window.app.openModal({ title: `${T("arc.manageMembers")} — ${escapeHtml(lang()==='ar'?g.nameAr:g.name)}`, html, footer, size: "lg" });
    },

    _toggleMmDoc(docId, checked) {
      const d = window.APP_STATE.arc.mmDraft;
      if (!d) return;
      if (checked) d.set.add(docId); else d.set.delete(docId);
      const counter = document.getElementById("mmDocCount");
      if (counter) counter.textContent = `· ${d.set.size} ${T("arc.selectedNDocs")}`;
    },

    saveManageMembers() {
      const d = window.APP_STATE.arc.mmDraft;
      if (!d) return;
      const target = d.groupId;
      let added = 0, removed = 0;
      D().documents.forEach(doc => {
        const shouldBeIn = d.set.has(doc.id);
        const isCurrentlyIn = doc.customGroupId === target;
        if (shouldBeIn && !isCurrentlyIn) { doc.customGroupId = target; added++; }
        else if (!shouldBeIn && isCurrentlyIn) { doc.customGroupId = null; removed++; }
      });
      window.APP_STATE.arc.mmDraft = null;
      if (added === 0 && removed === 0) {
        window.app.toast(T("arc.nothingChanged"));
      } else {
        window.app.toast(`+${added} / -${removed} · ${T("arc.bulkAssigned")}`);
      }
      window.app.closeModal();
      window.APP_STATE.arc.groupBy = "custom";
      window.app.render();
    },

    deleteGroup(groupId) {
      const g = D().findArchiveGroup(groupId);
      if (!g) return;
      const docCount = D().documents.filter(d => d.customGroupId === groupId).length;
      const html = `
        <p class="text-sm">${T("arc.confirmDeleteGroup")}</p>
        <p class="text-xs muted mt-1">${escapeHtml(lang()==='ar'?g.nameAr:g.name)} · ${docCount} ${T("arc.docs").toLowerCase()}</p>`;
      const footer = `
        <button class="btn btn-outline" onclick="ARC.openNewGroup()">${T("c.cancel")}</button>
        <button class="btn btn-primary" style="background:#be123c" onclick="ARC.commitDeleteGroup('${groupId}')">${ICONS.trash()}${T("arc.deleteGroup")}</button>`;
      window.app.openModal({ title: T("arc.deleteGroup"), html, footer, size: "sm" });
    },

    commitDeleteGroup(groupId) {
      // Unassign any docs in this group, then delete it.
      D().documents.forEach(d => { if (d.customGroupId === groupId) d.customGroupId = null; });
      const arr = D().archiveCustomGroups;
      const i = arr.findIndex(g => g.id === groupId);
      if (i >= 0) arr.splice(i, 1);
      window.app.toast(T("arc.deleteGroup"));
      window.app.closeModal();
      window.app.render();
    },

    /** Open the upload modal. Step 0 picks between AI-from-file or manual
     *  entry; the rest of the flow branches on `upload.mode`. */
    openUpload() {
      ensureState();
      window.APP_STATE.arc.upload = {
        mode: null,            // null | "file" | "manual"
        filename: "",
        type: null,
        extracted: null,
        confidence: 0,
        scanning: false,
        dataUrl: null,
        mime: null,
      };
      ARC._renderUpload();
    },

    /** Pick a mode in step 0. "file" jumps to the OS file picker; "manual"
     *  opens an empty type-picker form. */
    setUploadMode(mode) {
      ensureState();
      const u = window.APP_STATE.arc.upload;
      u.mode = mode;
      if (mode === "file") {
        ARC._renderUpload();
        ARC.pickFile();
      } else {
        // Manual mode — start with the most common type so users see fields immediately.
        u.type = "license";
        u.extracted = ARC._blankExtractedFor("license");
        u.confidence = 100;
        ARC._renderUpload();
      }
    },

    /** Manual-entry: change the document type → blank out the fields for the new type. */
    setManualType(type) {
      const u = window.APP_STATE.arc.upload;
      u.type = type;
      u.extracted = ARC._blankExtractedFor(type);
      ARC._renderUpload();
    },

    /** Build an "empty" extracted record for a given type. Uses the existing
     *  aiExtract to know which keys belong to the type, then blanks every
     *  value so the user fills them in. */
    _blankExtractedFor(type) {
      try {
        const seeded = D().aiExtract(type, {});
        const blank = {};
        Object.keys(seeded).forEach(k => { blank[k] = ""; });
        return blank;
      } catch { return {}; }
    },

    /** Trigger the native file picker. */
    pickFile() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,application/pdf";
      input.style.display = "none";
      document.body.appendChild(input);
      input.onchange = (e) => {
        const file = (e.target.files || [])[0];
        if (!file) { document.body.removeChild(input); return; }
        if (file.size > 5 * 1024 * 1024) {
          window.app.toast(lang() === "en" ? "File too large (max 5 MB)" : "الملف كبير جداً (الحد 5 ميغابايت)");
          document.body.removeChild(input);
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const u = window.APP_STATE.arc.upload;
          u.filename = file.name;
          u.mime = file.type;
          u.dataUrl = ev.target.result;
          document.body.removeChild(input);
          // Kick off the autonomous AI read.
          ARC._runAutoScan();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },

    /** Simulate the autonomous AI read of the uploaded file. */
    _runAutoScan() {
      const u = window.APP_STATE.arc.upload;
      if (!u) return;
      u.scanning = true;
      u.type = null;
      u.extracted = null;
      u.confidence = 0;
      ARC._renderUpload();
      setTimeout(() => {
        const type = D().detectDocType(u.filename);
        const refs = D().detectRefs(u.filename);
        const extracted = D().aiExtract(type, refs);
        u.type = type;
        u.extracted = extracted;
        u.confidence = 82 + Math.floor(Math.random() * 16);  // 82–97
        u.scanning = false;
        ARC._renderUpload();
      }, 900);
    },

    /** Finish — save the extracted record onto window.DATA.documents.
     *  Works for both AI-from-file and manual entry. */
    finishUpload() {
      const S = window.APP_STATE.arc;
      const u = S.upload;
      if (!u || !u.extracted) return;
      const isManual = u.mode === "manual";
      // Read back any field edits.
      const extracted = {};
      Object.keys(u.extracted).forEach(k => {
        const el = document.getElementById(`auf-${k}`);
        extracted[k] = el ? el.value : u.extracted[k];
      });
      const groupEl = document.getElementById("auf-customGroupId");
      const customGroupId = groupEl ? (groupEl.value || null) : null;
      const id = `DOC-${String(D().documents.length + 1).padStart(5, "0")}`;
      D().documents.push({
        id,
        filename: u.filename || (isManual
          ? `${T(`doc.${u.type}`)} — ${new Date().toISOString().slice(0, 10)}.manual`
          : "untitled.pdf"),
        type: u.type,
        // Project/group remain on the record for legacy filters.
        projectId: D().PROJECTS[0]?.id || null,
        groupId: D().PROJECTS[0]?.groups[0]?.id || null,
        customGroupId,
        sizeKb: isManual ? 0 : Math.round((u.dataUrl?.length || 0) / 1400),
        uploadedOn: new Date().toISOString(),
        scannedByAI: !isManual,
        aiConfidence: isManual ? null : u.confidence,
        extracted,
        notes: isManual ? T("arc.manualEntryNote") : "",
        originalDataUrl: isManual ? null : u.dataUrl,
        originalMime: isManual ? null : u.mime,
      });
      window.app.toast(`${id} · ${T("arc.finish")}`);
      S.upload = null;
      window.app.closeModal();
      window.app.render();
    },

    _renderUpload() {
      const u = window.APP_STATE.arc.upload;
      if (!u) return;

      // ---- Doc type list shared by manual entry + filters ----
      const ALL_TYPES = ["license","registration","insurance","commercial_registration","national_address","permit","inspection","contract","delivery","quote","po","invoice","letter","other"];

      let body = "";
      if (!u.mode) {
        // Step 0 — pick mode (AI from file OR manual entry)
        body = `
          <div class="upload-mode-pick">
            <div class="upload-mode-head">${T("arc.uploadModePick")}</div>
            <div class="upload-mode-grid">
              <button type="button" class="upload-mode-tile" onclick="ARC.setUploadMode('file')">
                <span class="upload-mode-icon ai">${ICONS.upload()}</span>
                <div class="upload-mode-title">${T("arc.uploadFromFile")}</div>
                <div class="upload-mode-sub">${T("arc.uploadFromFileSub")}</div>
                <span class="ai-chip" style="margin-top:.5rem">${ICONS.zap ? ICONS.zap() : "★"} AI</span>
              </button>
              <button type="button" class="upload-mode-tile" onclick="ARC.setUploadMode('manual')">
                <span class="upload-mode-icon manual">${ICONS.pencil()}</span>
                <div class="upload-mode-title">${T("arc.uploadManual")}</div>
                <div class="upload-mode-sub">${T("arc.uploadManualSub")}</div>
              </button>
            </div>
          </div>`;
      } else if (u.mode === "manual") {
        // Manual entry — type picker + editable form
        const keys = Object.keys(u.extracted || {});
        body = `
          <div class="upload-result">
            <div class="upload-result-head">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="pill pill-info"><span class="dot"></span>${T("arc.uploadManual")}</span>
                <span class="doc-type-chip doc-type-${u.type}">${T(`doc.${u.type}`)}</span>
              </div>
              <button type="button" class="btn btn-ghost btn-xs" onclick="ARC.setUploadMode(null); ARC._renderUpload()">${ICONS.arrowLeft()}${lang()==='en'?'Back':'العودة'}</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label class="field-label">${T("arc.pickDocType")}</label>
                <select class="select w-full" onchange="ARC.setManualType(this.value)">
                  ${ALL_TYPES.map(t => `<option value="${t}" ${u.type===t?'selected':''}>${T(`doc.${t}`)}</option>`).join("")}
                </select>
                <div class="text-[10px] muted mt-1">${T("arc.pickDocTypeHint")}</div>
              </div>
              <div>
                <label class="field-label">${T("arc.assignToGroup")}</label>
                <select id="auf-customGroupId" class="select w-full">
                  <option value="">${T("arc.noGroup")}</option>
                  ${D().archiveCustomGroups.map(g => `<option value="${g.id}">${escapeHtml(lang()==='ar'?g.nameAr:g.name)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              ${keys.map(k => `
                <div>
                  <label class="field-label">${T(`af.${k}`) === `af.${k}` ? escapeHtml(k) : T(`af.${k}`)}</label>
                  <input class="input w-full" id="auf-${escapeHtml(k)}" value=""/>
                </div>`).join("")}
            </div>
            <p class="text-[11px] muted mt-3">${T("arc.manualEntryNote")}</p>
          </div>`;
      } else if (!u.filename) {
        // Step 1 (file mode) — drop zone
        body = `
          <div class="upload-drop" onclick="ARC.pickFile()">
            <span class="upload-drop-icon">${ICONS.upload()}</span>
            <div class="upload-drop-title">${T("arc.pickFile")}</div>
            <div class="upload-drop-hint">${T("arc.pickFileHint")}</div>
          </div>`;
      } else if (u.scanning) {
        // Step 2 — AI reading
        body = `
          <div class="upload-drop">
            <div class="ai-reading">
              <div class="h-3 w-3 rounded-full bg-purple-500 pulse-dot"></div>
              <div class="h-3 w-3 rounded-full bg-purple-500 pulse-dot" style="animation-delay:.2s"></div>
              <div class="h-3 w-3 rounded-full bg-purple-500 pulse-dot" style="animation-delay:.4s"></div>
            </div>
            <div class="upload-drop-title">${T("arc.aiReading")}</div>
            <div class="upload-drop-hint">${escapeHtml(u.filename)}</div>
          </div>`;
      } else if (u.extracted) {
        // Step 3 — review + Finish
        const keys = Object.keys(u.extracted);
        body = `
          <div class="upload-result">
            <div class="upload-result-head">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="ai-chip">${ICONS.zap ? ICONS.zap() : "★"} AI</span>
                <span class="doc-type-chip doc-type-${u.type}">${T(`doc.${u.type}`)}</span>
                <span class="muted text-xs">${u.confidence}% ${T("arc.aiConfidence").toLowerCase()}</span>
              </div>
              <div class="text-[11px] muted truncate" style="max-width:260px">${escapeHtml(u.filename)}</div>
            </div>
            <p class="text-xs muted mb-3">${T("arc.aiAutoFilled")}</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              ${keys.map(k => `
                <div>
                  <label class="field-label">${T(`af.${k}`) === `af.${k}` ? escapeHtml(k) : T(`af.${k}`)}</label>
                  <input class="input w-full" id="auf-${escapeHtml(k)}" value="${escapeHtml(u.extracted[k])}"/>
                </div>`).join("")}
            </div>
          </div>`;
      }

      const html = `<div class="space-y-3">${body}</div>`;
      const canFinish = u && (u.extracted || u.mode === "manual");
      const footer = canFinish
        ? `<button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
           <button class="btn btn-primary" onclick="ARC.finishUpload()">${ICONS.check()}${T("arc.finish")}</button>`
        : `<button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>`;
      window.app.openModal({ title: T("arc.uploadDoc"), html, footer, size: "lg" });
    },

    // ---- Doc detail ----
    openDoc(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      const fields = D().docDetailFields(d);
      const heading = D().docPrimaryHeading(d);
      const hasOriginal = !!d.originalDataUrl;

      const body = `
        <div class="space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="doc-type-chip doc-type-${d.type}">${T(`doc.${d.type}`)}</span>
              ${expiryPill(d)}
              <span class="muted text-xs">${T("arc.issuer")}: <b>${escapeHtml(D().docIssuer(d))}</b></span>
            </div>
            <span class="muted text-[11px] font-mono">${d.id}</span>
          </div>
          <div class="doc-detail-heading">${escapeHtml(heading)}</div>

          <div class="doc-detail-grid">
            ${fields.map(f => `
              <div class="doc-detail-row">
                <div class="doc-field-label">${T(`af.${f.key}`) === `af.${f.key}` ? escapeHtml(f.key) : T(`af.${f.key}`)}</div>
                <div class="doc-field-value">${escapeHtml(fmtField(f.key, f.value))}</div>
              </div>`).join("")}
          </div>

          <div class="text-[11px] muted">${escapeHtml(d.filename)}</div>
        </div>`;
      const footer = `
        ${hasOriginal
          ? `<button class="btn btn-outline" onclick="ARC.viewOriginal('${d.id}')">${ICONS.eye()}${T("arc.viewOriginal")}</button>`
          : `<button class="btn btn-outline" disabled title="${T("arc.originalUnavailable")}" style="opacity:.5;cursor:not-allowed">${ICONS.eye()}${T("arc.viewOriginal")}</button>`}
        <button class="btn btn-outline" style="color:#be123c" onclick="ARC.deleteDoc('${d.id}')">${ICONS.trash()}${T("arc.deleteDoc2")}</button>
        <button class="btn btn-primary" onclick="ARC.editDoc('${d.id}')">${ICONS.pencil()}${T("arc.editFields")}</button>`;
      window.app.openModal({ title: heading, html: body, footer, size: "lg" });
    },

    editDoc(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      const fields = D().docDetailFields(d);
      const heading = D().docPrimaryHeading(d);
      const html = `
        <div class="space-y-3">
          <p class="text-xs muted">${heading}</p>
          <!-- Group assignment (custom-group bucket for the Archive) -->
          <div>
            <label class="field-label">${T("arc.assignToGroup")}</label>
            <select id="ed-customGroupId" class="select w-full">
              <option value="">${T("arc.noGroup")}</option>
              ${D().archiveCustomGroups.map(g => `
                <option value="${g.id}" ${d.customGroupId===g.id?'selected':''}>${escapeHtml(lang()==='ar'?g.nameAr:g.name)}</option>`).join("")}
            </select>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            ${fields.map(f => `
              <div>
                <label class="field-label">${T(`af.${f.key}`) === `af.${f.key}` ? escapeHtml(f.key) : T(`af.${f.key}`)}</label>
                <input class="input w-full" id="ed-${escapeHtml(f.key)}" value="${escapeHtml(f.value)}"/>
              </div>`).join("")}
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="ARC.openDoc('${d.id}')">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="ARC.saveEdit('${d.id}')">${ICONS.save()}${T("arc.saveChanges")}</button>`;
      window.app.openModal({ title: T("arc.editFields"), html, footer, size: "lg" });
    },

    saveEdit(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      Object.keys(d.extracted).forEach(k => {
        const el = document.getElementById(`ed-${k}`);
        if (el) d.extracted[k] = el.value;
      });
      const gEl = document.getElementById("ed-customGroupId");
      if (gEl) d.customGroupId = gEl.value || null;
      window.app.toast(T("arc.saveChanges"));
      ARC.openDoc(docId);
    },

    deleteDoc(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      const html = `<p class="text-sm">${T("arc.confirmDeleteDoc")}</p>
        <p class="text-xs muted mt-1">${escapeHtml(D().docPrimaryHeading(d))}</p>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" style="background:#be123c" onclick="ARC.commitDeleteDoc('${d.id}')">${ICONS.trash()}${T("arc.deleteDoc2")}</button>`;
      window.app.openModal({ title: T("arc.deleteDoc2"), html, footer, size: "sm" });
    },

    commitDeleteDoc(docId) {
      const arr = D().documents;
      const i = arr.findIndex(x => x.id === docId);
      if (i >= 0) arr.splice(i, 1);
      window.app.toast(T("arc.deleteDoc2"));
      window.app.closeModal();
      window.app.render();
    },

    /** Open the original file. If it was uploaded in-session, we have its
     *  data URL; otherwise (seeded docs) we show a friendly "not stored". */
    viewOriginal(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      if (d.originalDataUrl) {
        const isPdf = (d.originalMime || "").includes("pdf") || /\.pdf$/i.test(d.filename || "");
        if (isPdf) {
          window.open(d.originalDataUrl, "_blank");
          return;
        }
        const html = `
          <div class="orig-wrap">
            <img src="${d.originalDataUrl}" alt="${escapeHtml(d.filename)}"/>
          </div>
          <div class="text-center text-[11px] muted mt-2">${escapeHtml(d.filename)}</div>`;
        const footer = `<button class="btn btn-outline" onclick="ARC.openDoc('${d.id}')">${ICONS.arrowLeft()}${lang()==='en'?'Back':'العودة'}</button>`;
        window.app.openModal({ title: d.filename, html, footer, size: "lg" });
      } else {
        window.app.toast(T("arc.originalUnavailable"));
      }
    },
  };

  // ---- Render helpers ----
  function renderGrid() {
    const S = window.APP_STATE.arc;
    const all = D().documents;
    const q = (S.q || "").toLowerCase();

    let list = all.filter(d => {
      if (S.typeFilter !== "all" && d.type !== S.typeFilter) return false;
      if (q) {
        // Search: filename, type, issuer, primary heading, every extracted value
        const hay = [
          d.filename, d.type, D().docIssuer(d), D().docPrimaryHeading(d),
          ...Object.values(d.extracted || {}).map(x => String(x))
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (list.length === 0) {
      return `<div class="card p-8 text-center muted">${T("arc.noDocsMatch")}</div>`;
    }

    const sections = buildSections(list);
    return sections.map(sec => `
      <div class="arc-section">
        <div class="arc-section-head">
          <h3 class="font-semibold">${escapeHtml(sec.label)}</h3>
          <span class="muted text-xs">${sec.docs.length} ${T("arc.docs").toLowerCase()}</span>
        </div>
        <div class="doc-grid">
          ${sec.docs.map(docCard).join("")}
        </div>
      </div>`).join("");
  }

  // ---- Page entry ----
  function archive() {
    ensureState();
    const S = window.APP_STATE.arc;
    const totalDocs = D().documents.length;

    // Build the type-filter dropdown options from the unique types in the data.
    const usedTypes = [...new Set(D().documents.map(d => d.type))].sort();

    return `
      ${pageHeader({
        title: T("arc.title"),
        subtitle: `${totalDocs} ${T("arc.totalDocs")} · ${T("arc.subtitleV2")}`,
        actions: btn({ label: T("arc.uploadDoc"), icon: ICONS.upload(), variant: "primary", onclick: "ARC.openUpload()" })
      })}

      <!-- Toolbar: prominent search + Group by + Type filter -->
      <div class="arc-toolbar">
        <div class="arc-search">
          <span class="arc-search-icon">${ICONS.search ? ICONS.search() : ""}</span>
          <input type="search" class="arc-search-input" placeholder="${T("arc.searchPlaceholder")}"
                 value="${escapeHtml(S.q || "")}"
                 oninput="ARC.onSearch(this.value)"/>
          ${S.q ? `<button class="arc-search-clear" onclick="ARC.clearSearch()" title="${T("c.cancel")}">×</button>` : ""}
        </div>
        <div class="arc-toolbar-controls">
          <label class="arc-toolbar-label">${T("arc.groupBy")}</label>
          <select class="select" onchange="ARC.setGroupBy(this.value)">
            <option value="type"   ${S.groupBy==='type'?'selected':''}>${T("arc.groupType")}</option>
            <option value="issuer" ${S.groupBy==='issuer'?'selected':''}>${T("arc.groupIssuer")}</option>
            <option value="expiry" ${S.groupBy==='expiry'?'selected':''}>${T("arc.groupExpiry")}</option>
            <option value="custom" ${S.groupBy==='custom'?'selected':''}>${T("arc.groupCustom")}</option>
            <option value="none"   ${S.groupBy==='none'?'selected':''}>${T("arc.groupNone")}</option>
          </select>
          ${S.groupBy === 'custom'
            ? `<button class="btn btn-outline" onclick="ARC.openNewGroup()">${ICONS.plus()}${T("arc.newGroup")}</button>`
            : ""}
          <label class="arc-toolbar-label">${T("arc.typeFilter")}</label>
          <select class="select" onchange="ARC.setTypeFilter(this.value)">
            <option value="all" ${S.typeFilter==='all'?'selected':''}>${T("arc.allTypes")}</option>
            ${usedTypes.map(t => `<option value="${t}" ${S.typeFilter===t?'selected':''}>${T(`doc.${t}`)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div id="arc-grid">${renderGrid()}</div>
    `;
  }

  return { archive };
})();
