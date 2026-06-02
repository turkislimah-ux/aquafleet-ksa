// Archive page + ARC module — project documents, named/sortable groups,
// and a simulated AI scanner that pre-fills metadata from a filename.
window.PAGES_ARCHIVE = (function () {
  const { fmtNum, fmtSar, escapeHtml, pageHeader, stat, pill, btn, section } = UI;
  const D = () => window.DATA;
  const lang = () => window.APP_STATE.lang;

  // ---- Local helpers ----
  const fmtBytes = (kb) => kb < 1024
    ? `${Math.round(kb)} KB`
    : `${(kb / 1024).toFixed(1)} MB`;

  const fmtDate = (iso) => new Date(iso).toLocaleDateString();

  /** Compose a friendly display name for the file type (icon + label). */
  function typeBadge(type) {
    const label = T(`doc.${type}`);
    return `<span class="pill pill-info">${label}</span>`;
  }

  /** File-extension → icon color (cosmetic only). */
  function fileColor(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return ({ pdf: "#dc2626", docx: "#2563eb", xlsx: "#059669", jpg: "#7c3aed", png: "#7c3aed" })[ext] || "#64748b";
  }

  // Initialize archive page state on first visit.
  function ensureState() {
    const S = window.APP_STATE;
    if (!S.arc) S.arc = {
      projectId: D().PROJECTS[0].id,
      groupSort: "manual",   // manual | name | count
      docSort: "dateNew",    // name | nameDesc | dateNew | dateOld | type
      // For the upload-AI flow
      upload: null,          // { filename, type, extracted, confidence, scanning }
    };
  }

  // ============================================================
  //                          ARC module
  // ============================================================
  window.ARC = {
    setProject(id) { ensureState(); window.APP_STATE.arc.projectId = id; window.app.render(); },
    setGroupSort(v) { ensureState(); window.APP_STATE.arc.groupSort = v; window.app.render(); },
    setDocSort(v) { ensureState(); window.APP_STATE.arc.docSort = v; window.app.render(); },

    addGroup() {
      ensureState();
      const project = D().findProject(window.APP_STATE.arc.projectId);
      if (!project) return;
      const html = `
        <div class="space-y-3">
          <p class="text-sm muted">${lang()==='en'?'Create a named group to organize related documents within this project.':'أنشئ مجموعة مسمّاة لتنظيم المستندات داخل هذا المشروع.'}</p>
          <div>
            <label class="field-label">${T("arc.newGroup")}</label>
            <input class="input w-full" id="gName" placeholder="${T("arc.groupNamePh")}"/>
          </div>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="ARC.saveGroup('${project.id}')">${ICONS.save()}${T("c.save")}</button>`;
      window.app.openModal({ title: T("arc.newGroup"), html, footer });
    },

    saveGroup(projectId) {
      const project = D().findProject(projectId);
      if (!project) return;
      const name = (document.getElementById("gName").value || "").trim();
      if (!name) { window.app.toast(lang()==='en'?"Enter a name":"أدخل اسماً"); return; }
      const id = `GRP-${projectId}-${Date.now().toString(36)}`;
      const order = project.groups.reduce((m, g) => Math.max(m, g.order), -1) + 1;
      project.groups.push({ id, name, nameAr: name, order, types: ["other"] });
      window.app.toast(`+ ${name}`);
      window.app.closeModal();
    },

    renameGroup(projectId, groupId) {
      const g = D().findGroup(projectId, groupId);
      if (!g) return;
      const html = `
        <div>
          <label class="field-label">${T("arc.renameGroup")}</label>
          <input class="input w-full" id="gName" value="${escapeHtml(lang()==='ar'?g.nameAr:g.name)}"/>
        </div>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" onclick="ARC.commitRename('${projectId}','${groupId}')">${ICONS.save()}${T("c.save")}</button>`;
      window.app.openModal({ title: T("arc.renameGroup"), html, footer });
    },

    commitRename(projectId, groupId) {
      const g = D().findGroup(projectId, groupId);
      if (!g) return;
      const name = (document.getElementById("gName").value || "").trim();
      if (!name) return;
      if (lang() === "ar") g.nameAr = name; else g.name = name;
      window.app.toast(name);
      window.app.closeModal();
    },

    deleteGroup(projectId, groupId) {
      const project = D().findProject(projectId);
      if (!project) return;
      const g = project.groups.find(x => x.id === groupId);
      if (!g) return;
      const docCount = D().documents.filter(d => d.groupId === groupId).length;
      // Confirm with a small modal
      const html = `
        <p class="text-sm">${T("arc.confirmDeleteGroup")}</p>
        <p class="text-xs muted mt-1">${escapeHtml(lang()==='ar'?g.nameAr:g.name)} · ${docCount} ${T("arc.docCount")}</p>`;
      const footer = `
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.cancel")}</button>
        <button class="btn btn-primary" style="background:#be123c" onclick="ARC.commitDeleteGroup('${projectId}','${groupId}')">${ICONS.trash()}${T("c.delete")}</button>`;
      window.app.openModal({ title: T("arc.deleteGroup"), html, footer, size: "sm" });
    },

    commitDeleteGroup(projectId, groupId) {
      const project = D().findProject(projectId);
      project.groups = project.groups.filter(g => g.id !== groupId);
      // Re-bucket orphan docs into first group or drop them.
      const fallback = project.groups[0];
      D().documents.forEach(d => {
        if (d.groupId === groupId) {
          if (fallback) d.groupId = fallback.id;
          else d.groupId = null;
        }
      });
      window.app.toast(T("arc.deleteGroup"));
      window.app.closeModal();
    },

    moveGroup(projectId, groupId, dir) {
      const project = D().findProject(projectId);
      if (!project) return;
      // Sort by current order to be safe, then swap.
      project.groups.sort((a, b) => a.order - b.order);
      const i = project.groups.findIndex(g => g.id === groupId);
      const j = i + dir;
      if (j < 0 || j >= project.groups.length) return;
      const a = project.groups[i], b = project.groups[j];
      const tmp = a.order; a.order = b.order; b.order = tmp;
      window.app.render();
    },

    // ----- Upload + AI scanner -----
    openUpload(projectId, groupId) {
      ensureState();
      const S = window.APP_STATE.arc;
      S.upload = { projectId, groupId, filename: "", type: null, extracted: null, confidence: 0, scanning: false };
      this.renderUploadModal();
    },

    pickSample(filename) {
      ensureState();
      const S = window.APP_STATE.arc;
      S.upload.filename = filename;
      this.renderUploadModal();
    },

    onFilenameInput(value) {
      ensureState();
      const S = window.APP_STATE.arc;
      S.upload.filename = value;
      // Keep the modal alive while the user types — only refresh on Scan click.
    },

    runScan() {
      ensureState();
      const S = window.APP_STATE.arc;
      const filename = (document.getElementById("upFilename")?.value || S.upload.filename || "").trim();
      if (!filename) { window.app.toast(lang()==='en'?"Type or pick a filename first":"اكتب أو اختر اسم الملف أولاً"); return; }
      S.upload.filename = filename;
      S.upload.scanning = true;
      S.upload.type = null;
      S.upload.extracted = null;
      S.upload.confidence = 0;
      this.renderUploadModal();
      // Simulate async AI work.
      setTimeout(() => {
        const type = D().detectDocType(filename);
        const refs = D().detectRefs(filename);
        const extracted = D().aiExtract(type, refs);
        S.upload.type = type;
        S.upload.extracted = extracted;
        S.upload.confidence = 78 + Math.floor(Math.random() * 20);
        S.upload.scanning = false;
        this.renderUploadModal();
      }, 1100);
    },

    saveScanned() {
      ensureState();
      const S = window.APP_STATE.arc;
      const u = S.upload;
      if (!u || !u.extracted) return;
      const projectId = document.getElementById("upProject").value;
      const groupId = document.getElementById("upGroup").value;
      // Read back any edits from the field inputs.
      const extracted = {};
      Object.keys(u.extracted).forEach(k => {
        const el = document.getElementById(`xf-${k}`);
        if (el) extracted[k] = el.value; else extracted[k] = u.extracted[k];
      });
      const id = `DOC-${String(D().documents.length + 1).padStart(5, "0")}`;
      D().documents.push({
        id,
        filename: u.filename,
        type: u.type,
        projectId, groupId,
        sizeKb: 200 + Math.floor(Math.random() * 4000),
        uploadedOn: new Date().toISOString(),
        scannedByAI: true,
        aiConfidence: u.confidence,
        extracted,
        notes: "",
      });
      window.app.toast(`${T("arc.saveDoc")} · ${id}`);
      S.upload = null;
      window.app.closeModal();
    },

    /** Render (or re-render) the upload+scan modal in-place. */
    renderUploadModal() {
      const S = window.APP_STATE.arc;
      const u = S.upload;
      if (!u) return;
      const samples = D().AI_SAMPLES;

      const samplesHTML = samples.map(s => `
        <button class="rounded-lg border border-app p-2 text-start hover:bg-black/5 transition flex items-center gap-2 text-xs"
          onclick="ARC.pickSample('${escapeHtml(s.filename).replace(/'/g, "\\'")}')">
          <span class="h-7 w-7 rounded grid place-items-center shrink-0" style="background:${s.iconBg}; color:${s.iconColor}">${ICONS.fileText()}</span>
          <span class="truncate">${escapeHtml(s.filename)}</span>
        </button>`).join("");

      let extractedHTML = "";
      if (u.scanning) {
        extractedHTML = `
          <div class="card p-6 text-center">
            <div class="inline-flex items-center gap-3">
              <div class="h-3 w-3 rounded-full bg-emerald-500 pulse-dot"></div>
              <div class="h-3 w-3 rounded-full bg-emerald-500 pulse-dot" style="animation-delay:.2s"></div>
              <div class="h-3 w-3 rounded-full bg-emerald-500 pulse-dot" style="animation-delay:.4s"></div>
            </div>
            <div class="mt-3 font-medium text-sm">${T("arc.aiScanning")}</div>
            <div class="text-[11px] muted mt-1">${escapeHtml(u.filename)}</div>
          </div>`;
      } else if (u.extracted) {
        const keys = Object.keys(u.extracted);
        extractedHTML = `
          <div class="card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="text-purple-600">${ICONS.sparkles()}</span>
                <h4 class="font-semibold text-sm">${T("arc.aiDone")}</h4>
                <span class="pill pill-ok">${u.confidence}% ${T("arc.aiConfidence").toLowerCase()}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="pill pill-info">${T(`doc.${u.type}`)}</span>
                <button class="btn btn-outline" onclick="ARC.runScan()">${ICONS.sparkles()}${T("arc.rerunAI")}</button>
              </div>
            </div>
            <p class="text-[11px] muted mb-3">${T("arc.aiNote")}</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              ${keys.map(k => `
                <div>
                  <label class="field-label">${T(`af.${k}`) === `af.${k}` ? escapeHtml(k) : T(`af.${k}`)}</label>
                  <input class="input w-full" id="xf-${escapeHtml(k)}" value="${escapeHtml(u.extracted[k])}"/>
                </div>`).join("")}
            </div>
          </div>`;
      }

      const projects = D().PROJECTS;
      const selectedProject = projects.find(p => p.id === (u.projectId || projects[0].id)) || projects[0];
      const groups = selectedProject.groups.slice().sort((a, b) => a.order - b.order);

      const html = `
        <div class="space-y-4">
          <div class="rounded-lg p-3 text-xs flex items-start gap-2" style="background:rgba(139,92,246,.08); border:1px solid rgba(139,92,246,.25)">
            <span class="text-purple-600 mt-0.5">${ICONS.wand()}</span>
            <span>${T("arc.aiTip")}</span>
          </div>

          <div>
            <label class="field-label">${T("arc.fileName")}</label>
            <input class="input w-full" id="upFilename" value="${escapeHtml(u.filename)}" placeholder="${T("arc.typing")}"
                   oninput="ARC.onFilenameInput(this.value)"/>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="field-label" style="margin:0">${T("arc.samples")}</label>
              <button class="btn btn-primary" onclick="ARC.runScan()">${ICONS.sparkles()}${T("arc.runAI")}</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">${samplesHTML}</div>
          </div>

          ${extractedHTML}

          ${u.extracted ? `
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label">${T("arc.targetProject")}</label>
                <select class="select w-full" id="upProject" onchange="ARC.onProjectPicked(this.value)">
                  ${projects.map(p => `<option value="${p.id}" ${p.id === selectedProject.id ? 'selected' : ''}>${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</option>`).join("")}
                </select>
              </div>
              <div>
                <label class="field-label">${T("arc.targetGroup")}</label>
                <select class="select w-full" id="upGroup">
                  ${groups.map(g => `<option value="${g.id}" ${g.id === (u.groupId || groups[0]?.id) ? 'selected' : ''}>${escapeHtml(lang()==='ar'?g.nameAr:g.name)}</option>`).join("")}
                </select>
              </div>
            </div>
          ` : ""}
        </div>`;

      const footer = `
        <button class="btn btn-outline" onclick="window.APP_STATE.arc.upload=null; window.app.closeModal()">${T("c.cancel")}</button>
        ${u.extracted ? `<button class="btn btn-primary" onclick="ARC.saveScanned()">${ICONS.save()}${T("arc.saveDoc")}</button>` : ""}
      `;
      window.app.openModal({ title: T("arc.uploadDoc"), html, footer, size: "lg" });
    },

    onProjectPicked(projectId) {
      ensureState();
      const S = window.APP_STATE.arc;
      S.upload.projectId = projectId;
      const project = D().findProject(projectId);
      if (project) {
        const first = project.groups.slice().sort((a, b) => a.order - b.order)[0];
        S.upload.groupId = first ? first.id : null;
      }
      this.renderUploadModal();
    },

    // ----- Document drawer -----
    openDoc(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      const project = D().findProject(d.projectId);
      const group = D().findGroup(d.projectId, d.groupId);
      const keys = Object.keys(d.extracted);

      const html = `
        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="card p-3 md:col-span-2">
              <div class="flex items-center gap-3">
                <div class="h-12 w-12 rounded-lg grid place-items-center" style="background:${fileColor(d.filename)}1a; color:${fileColor(d.filename)}">${ICONS.fileText()}</div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold truncate">${escapeHtml(d.filename)}</div>
                  <div class="text-[11px] muted">${escapeHtml(lang()==='ar'?project.nameAr:project.name)} · ${escapeHtml(group ? (lang()==='ar'?group.nameAr:group.name) : "—")}</div>
                </div>
                ${typeBadge(d.type)}
              </div>
              <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><span class="muted">${T("arc.uploadedOn")}:</span> <b>${fmtDate(d.uploadedOn)}</b></div>
                <div><span class="muted">${T("arc.size")}:</span> <b>${fmtBytes(d.sizeKb)}</b></div>
                <div><span class="muted">${T("arc.aiConfidence")}:</span> <b class="${d.aiConfidence >= 85 ? 'text-emerald-600' : 'text-amber-600'}">${d.aiConfidence}%</b></div>
              </div>
            </div>
            <div class="card p-3">
              <div class="field-label">${T("arc.docType")}</div>
              <select class="select w-full" id="dt-type">
                ${["invoice","contract","permit","inspection","license","insurance","registration","delivery","quote","po","letter","other"].map(t => `<option value="${t}" ${t===d.type?'selected':''}>${T(`doc.${t}`)}</option>`).join("")}
              </select>
              <div class="text-[11px] muted mt-3">${escapeHtml(d.id)}</div>
            </div>
          </div>

          <div>
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2"><span class="text-purple-600">${ICONS.sparkles()}</span>${T("arc.extractedFields")} <span class="muted text-xs font-normal">(${keys.length} ${T("arc.fields")})</span></h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              ${keys.map(k => `
                <div>
                  <label class="field-label">${T(`af.${k}`) === `af.${k}` ? escapeHtml(k) : T(`af.${k}`)}</label>
                  <input class="input w-full" id="dt-x-${escapeHtml(k)}" value="${escapeHtml(d.extracted[k])}"/>
                </div>`).join("")}
            </div>
            <button class="btn btn-outline mt-3" onclick="ARC.rescan('${d.id}')">${ICONS.sparkles()}${T("arc.rerunAI")}</button>
          </div>

          <div>
            <h4 class="font-semibold text-sm mb-2">${T("af.notes")}</h4>
            <textarea class="input w-full" id="dt-notes" rows="2">${escapeHtml(d.notes || "")}</textarea>
          </div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" style="color:#be123c; border-color:rgba(190,18,60,.3)" onclick="ARC.deleteDoc('${d.id}')">${ICONS.trash()}${T("arc.deleteDoc")}</button>
        <div class="flex-1"></div>
        <button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>
        <button class="btn btn-primary" onclick="ARC.saveDoc('${d.id}')">${ICONS.save()}${T("arc.updateDoc")}</button>
      `;
      window.app.openModal({ title: `${T("arc.docPreview")} — ${escapeHtml(d.filename)}`, html, footer, size: "lg" });
    },

    saveDoc(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      d.type = document.getElementById("dt-type").value;
      d.notes = document.getElementById("dt-notes").value;
      Object.keys(d.extracted).forEach(k => {
        const el = document.getElementById(`dt-x-${k}`);
        if (el) d.extracted[k] = el.value;
      });
      window.app.toast(`${d.id} · ${T("arc.updateDoc")}`);
      window.app.closeModal();
    },

    rescan(docId) {
      const d = D().findDocument(docId);
      if (!d) return;
      const type = D().detectDocType(d.filename);
      const refs = D().detectRefs(d.filename);
      const extracted = D().aiExtract(type, refs);
      d.type = type;
      d.extracted = extracted;
      d.aiConfidence = 80 + Math.floor(Math.random() * 18);
      window.app.toast(T("arc.rerunAI"));
      this.openDoc(docId);
    },

    deleteDoc(docId) {
      D().documents = D().documents.filter(d => d.id !== docId);
      window.app.toast(T("arc.deleteDoc"));
      window.app.closeModal();
    },
  };

  // ============================================================
  //                          Page render
  // ============================================================
  function archive() {
    ensureState();
    const S = window.APP_STATE.arc;
    const project = D().findProject(S.projectId) || D().PROJECTS[0];
    if (!project) return `<div class="card p-6 muted">No projects.</div>`;
    S.projectId = project.id;

    const projects = D().PROJECTS;
    const allDocs = D().documents;
    const projDocs = allDocs.filter(d => d.projectId === project.id);

    // Sort groups
    const groups = project.groups.slice();
    if (S.groupSort === "name") {
      groups.sort((a, b) => (lang()==='ar'?a.nameAr:a.name).localeCompare(lang()==='ar'?b.nameAr:b.name));
    } else if (S.groupSort === "count") {
      groups.sort((a, b) => projDocs.filter(d => d.groupId === b.id).length - projDocs.filter(d => d.groupId === a.id).length);
    } else {
      groups.sort((a, b) => a.order - b.order);
    }

    // Sort docs
    function sortDocs(arr) {
      const a = arr.slice();
      if (S.docSort === "name") a.sort((x, y) => x.filename.localeCompare(y.filename));
      else if (S.docSort === "nameDesc") a.sort((x, y) => y.filename.localeCompare(x.filename));
      else if (S.docSort === "dateOld") a.sort((x, y) => new Date(x.uploadedOn) - new Date(y.uploadedOn));
      else if (S.docSort === "type") a.sort((x, y) => x.type.localeCompare(y.type));
      else a.sort((x, y) => new Date(y.uploadedOn) - new Date(x.uploadedOn));
      return a;
    }

    const totalDocs = allDocs.length;
    const projTotal = projDocs.length;
    const aiScanned = projDocs.filter(d => d.scannedByAI).length;
    const avgConf = projDocs.length ? Math.round(projDocs.reduce((s, d) => s + d.aiConfidence, 0) / projDocs.length) : 0;

    // Project rail
    const railHTML = `
      <div class="card p-2">
        <div class="px-2 pt-1 pb-2">
          <div class="text-xs font-semibold muted uppercase tracking-wide">${T("arc.projects")}</div>
        </div>
        <div class="flex flex-col gap-0.5">
          ${projects.map(p => {
            const count = allDocs.filter(d => d.projectId === p.id).length;
            const active = p.id === project.id;
            return `<button class="text-start px-2 py-2 rounded-lg ${active ? 'bg-brand-600 text-white' : 'hover:bg-black/5'}" onclick="ARC.setProject('${p.id}')">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium truncate">${escapeHtml(lang()==='ar'?p.nameAr:p.name)}</span>
                <span class="text-[11px] tabular ${active?'text-white/80':'muted'}">${count}</span>
              </div>
              <div class="text-[11px] ${active?'text-white/70':'muted'}">${p.groups.length} ${T("arc.groupCount")}</div>
            </button>`;
          }).join("")}
        </div>
      </div>`;

    // Group sections
    const sectionsHTML = groups.length === 0
      ? `<div class="card p-6 text-center muted text-sm">${T("arc.noGroups")}</div>`
      : groups.map((g, idx) => {
          const docs = sortDocs(projDocs.filter(d => d.groupId === g.id));
          const canManualUp = S.groupSort === "manual" && idx > 0;
          const canManualDown = S.groupSort === "manual" && idx < groups.length - 1;
          return `
            <div class="card p-3 mb-3">
              <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  <span style="color:#bd8b3f">${ICONS.folder()}</span>
                  <h4 class="font-semibold truncate">${escapeHtml(lang()==='ar'?g.nameAr:g.name)}</h4>
                  <span class="pill pill-muted">${docs.length} ${T("arc.docCount")}</span>
                </div>
                <div class="flex items-center gap-1 flex-wrap">
                  <button class="icon-btn ${canManualUp?'':'opacity-30 cursor-not-allowed'}" title="${T("arc.moveUp")}" ${canManualUp?`onclick="ARC.moveGroup('${project.id}','${g.id}',-1)"`:''}>${ICONS.arrowUp()}</button>
                  <button class="icon-btn ${canManualDown?'':'opacity-30 cursor-not-allowed'}" title="${T("arc.moveDown")}" ${canManualDown?`onclick="ARC.moveGroup('${project.id}','${g.id}',1)"`:''}>${ICONS.arrowDown()}</button>
                  <button class="icon-btn" title="${T("arc.renameGroup")}" onclick="ARC.renameGroup('${project.id}','${g.id}')">${ICONS.pencil()}</button>
                  <button class="icon-btn" style="color:#be123c" title="${T("arc.deleteGroup")}" onclick="ARC.deleteGroup('${project.id}','${g.id}')">${ICONS.trash()}</button>
                  <button class="btn btn-outline" onclick="ARC.openUpload('${project.id}','${g.id}')">${ICONS.upload()}${T("arc.uploadInto")}</button>
                </div>
              </div>
              ${docs.length === 0
                ? `<div class="text-center py-6 muted text-sm">${T("arc.noDocs")}</div>`
                : `<div class="overflow-x-auto scroll-thin">
                    <table class="tbl">
                      <thead><tr>
                        <th>${T("arc.fileName")}</th>
                        <th>${T("arc.docType")}</th>
                        <th>${T("arc.uploadedOn")}</th>
                        <th>${T("arc.size")}</th>
                        <th>${T("arc.aiConfidence")}</th>
                        <th></th>
                      </tr></thead>
                      <tbody>
                        ${docs.map(d => `
                          <tr style="cursor:pointer" onclick="ARC.openDoc('${d.id}')">
                            <td>
                              <div class="flex items-center gap-2">
                                <span style="color:${fileColor(d.filename)}">${ICONS.fileText()}</span>
                                <div>
                                  <div class="font-medium">${escapeHtml(d.filename)}</div>
                                  ${d.extracted.docNumber ? `<div class="text-[11px] muted">#${escapeHtml(d.extracted.docNumber)}</div>` : ""}
                                </div>
                              </div>
                            </td>
                            <td>${typeBadge(d.type)}</td>
                            <td class="text-xs">${fmtDate(d.uploadedOn)}</td>
                            <td class="text-xs tabular">${fmtBytes(d.sizeKb)}</td>
                            <td class="text-xs"><span class="${d.aiConfidence>=85?'text-emerald-600':'text-amber-600'} font-medium tabular">${d.aiConfidence}%</span></td>
                            <td>${btn({ label: T("arc.open"), icon: ICONS.eye(), variant: "outline", onclick: `event.stopPropagation(); ARC.openDoc('${d.id}')` })}</td>
                          </tr>`).join("")}
                      </tbody>
                    </table>
                  </div>`}
            </div>`;
        }).join("");

    return `
      ${pageHeader({
        title: T("arc.title"),
        subtitle: T("arc.subtitle"),
        actions: btn({ label: T("arc.aiScan"), icon: ICONS.wand(), variant: "outline", onclick: `ARC.openUpload('${project.id}','${(project.groups[0]||{}).id||''}')` })
              + btn({ label: T("arc.uploadDoc"), icon: ICONS.upload(), variant: "primary", onclick: `ARC.openUpload('${project.id}','${(project.groups[0]||{}).id||''}')` })
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        ${stat({ label: T("arc.projects"), value: projects.length, tone: "info" })}
        ${stat({ label: T("arc.docCount"), value: totalDocs })}
        ${stat({ label: `${T("arc.aiScan")} (${escapeHtml(lang()==='ar'?project.nameAr:project.name)})`, value: `${aiScanned}/${projTotal}`, tone: "ok" })}
        ${stat({ label: T("arc.aiConfidence"), value: `${avgConf}%`, tone: avgConf > 85 ? "ok" : "warn" })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div class="lg:col-span-1">${railHTML}</div>
        <div class="lg:col-span-3">

          <div class="card p-3 mb-4 flex items-center justify-between gap-2 flex-wrap">
            <div class="min-w-0">
              <div class="font-semibold">${escapeHtml(lang()==='ar'?project.nameAr:project.name)}</div>
              <div class="text-[11px] muted">${project.id} · ${project.groups.length} ${T("arc.groupCount")} · ${projTotal} ${T("arc.docCount")}</div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs muted">${T("arc.groupSort")}:</span>
              <select class="select" onchange="ARC.setGroupSort(this.value)">
                <option value="manual" ${S.groupSort==='manual'?'selected':''}>${T("arc.groupSortManual")}</option>
                <option value="name" ${S.groupSort==='name'?'selected':''}>${T("arc.groupSortName")}</option>
                <option value="count" ${S.groupSort==='count'?'selected':''}>${T("arc.groupSortCount")}</option>
              </select>
              <span class="text-xs muted ms-2">${T("arc.sortBy")}:</span>
              <select class="select" onchange="ARC.setDocSort(this.value)">
                <option value="dateNew" ${S.docSort==='dateNew'?'selected':''}>${T("arc.sortDateNew")}</option>
                <option value="dateOld" ${S.docSort==='dateOld'?'selected':''}>${T("arc.sortDateOld")}</option>
                <option value="name" ${S.docSort==='name'?'selected':''}>${T("arc.sortName")}</option>
                <option value="nameDesc" ${S.docSort==='nameDesc'?'selected':''}>${T("arc.sortNameDesc")}</option>
                <option value="type" ${S.docSort==='type'?'selected':''}>${T("arc.sortType")}</option>
              </select>
              <button class="btn btn-outline" onclick="ARC.addGroup()">${ICONS.plus()}${T("arc.newGroup")}</button>
            </div>
          </div>

          ${sectionsHTML}
        </div>
      </div>
    `;
  }

  return { archive };
})();
