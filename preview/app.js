// App shell + router for the static SPA preview.
window.APP_STATE = window.APP_STATE || {
  lang: localStorage.getItem("aqua_lang") || "en",
  theme: localStorage.getItem("aqua_theme") || "light",
  // Maintenance page state
  mtMonth: null,          // 0..11
  mtYear: null,           // e.g. 2026
  mtSelectedDate: null,   // YYYY-MM-DD
  mtTruckFilter: "all",
  mtSection: "scheduled", // scheduled | in_progress | completed
  // Inventory state
  invDrawerPartId: null,  // open the detail panel for this part
  // Commission state (per-driver overrides edited live)
  comOverrides: {},       // { driverId: { lines: {projectId: {ratePerTrip}}, specials: [...], adjustments: [...], bonusSar, payoutStatus } }
  // Auth session: { personId, email, signedInAt } | null. Restored from localStorage on boot.
  session: (function () {
    try { return JSON.parse(localStorage.getItem("aqua_session") || "null"); } catch { return null; }
  })(),
  loginError: null,
  // Modal stack
  modal: null,            // { html, onClose }
  toast: null,            // { msg, until }
};

const NAV = [
  { hash: "/", key: "dashboard", icon: "dashboard" },
  { hash: "/fleet", key: "fleet", icon: "truck" },
  { hash: "/drivers", key: "drivers", icon: "users" },
  { hash: "/trips", key: "trips", icon: "route" },
  { hash: "/routes", key: "routes", icon: "map" },
  { hash: "/maintenance", key: "maintenance", icon: "wrench" },
  { hash: "/predictive", key: "predictive", icon: "brain" },
  { hash: "/iot", key: "iot", icon: "activity" },
  { hash: "/inventory", key: "inventory", icon: "boxes" },
  { hash: "/reports", key: "reports", icon: "chart" },
  { hash: "/archive", key: "archive", icon: "archive" },
];

window.app = {
  navigate(path) { window.location.hash = "#" + path; },
  render() { renderApp(); },
  openModal(opts) {
    // Accept either a string (legacy) or an options object { title, html, size, footer }
    if (typeof opts === "string") opts = { html: opts };
    window.APP_STATE.modal = opts || null;
    renderApp();
  },
  closeModal() { window.APP_STATE.modal = null; renderApp(); },
  toast(msg) {
    window.APP_STATE.toast = { msg, until: Date.now() + 2200 };
    renderApp();
    setTimeout(() => {
      if (window.APP_STATE.toast && Date.now() >= window.APP_STATE.toast.until) {
        window.APP_STATE.toast = null;
        renderApp();
      }
    }, 2400);
  },
};

// ---- Auth (window.AUTH) — sign-in / sign-out / current-user helpers ----
window.AUTH = {
  currentUser() {
    const s = window.APP_STATE.session;
    if (!s) return null;
    return window.DATA && window.DATA.findPerson ? window.DATA.findPerson(s.personId) : null;
  },
  isSignedIn() { return !!window.APP_STATE.session; },

  /** Sign in with email + password. On success: persist session, navigate to /. */
  signIn(email, password) {
    const r = window.DATA.authenticate(email, password);
    if (!r || !r.person) {
      window.APP_STATE.loginError = T("auth.invalidCreds");
      renderApp();
      return false;
    }
    window.APP_STATE.session = {
      personId: r.person.id,
      email: r.user.email,
      signedInAt: new Date().toISOString(),
    };
    window.APP_STATE.loginError = null;
    try { localStorage.setItem("aqua_session", JSON.stringify(window.APP_STATE.session)); } catch {}
    window.app.toast(`${T("auth.welcomeBack")}, ${window.DATA.findPerson(r.person.id).name.split(" ")[0]}`);
    window.app.navigate("/");
    return true;
  },

  /** Quick sign-in from a demo-account row (no password prompt). */
  signInAs(email) {
    const u = window.DATA.AUTH_USERS.find(x => x.email === email);
    if (!u) return false;
    return this.signIn(email, u.password);
  },

  /** Sign out → clear session, navigate to /login. */
  signOut() {
    window.APP_STATE.session = null;
    try { localStorage.removeItem("aqua_session"); } catch {}
    window.app.toast(T("auth.sessionEnded"));
    window.app.navigate("/login");
  },
};

// ---- Sign-in handler used by the login form ----
window.submitSignIn = function (ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const email = (document.getElementById("siEmail")?.value || "").trim();
  const pwd = document.getElementById("siPwd")?.value || "";
  window.AUTH.signIn(email, pwd);
  return false;
};

function currentRoute() {
  const h = (window.location.hash || "#/").slice(1);
  return h === "" ? "/" : h;
}

function setLang(l) {
  window.APP_STATE.lang = l;
  localStorage.setItem("aqua_lang", l);
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = l;
  renderApp();
}
function setTheme(t) {
  window.APP_STATE.theme = t;
  localStorage.setItem("aqua_theme", t);
  document.documentElement.classList.toggle("dark", t === "dark");
  renderApp();
}
window.setLang = setLang;
window.setTheme = setTheme;

// ---- Login page ----
function loginPage() {
  const lang = window.APP_STATE.lang;
  const err = window.APP_STATE.loginError;
  const themeBtn = `<button class="btn btn-outline w-9 px-0 justify-center" onclick="setTheme('${window.APP_STATE.theme === 'light' ? 'dark' : 'light'}')">${window.APP_STATE.theme === 'light' ? ICONS.moon() : ICONS.sun()}</button>`;
  const langBtn = `<button class="btn btn-outline" onclick="setLang('${lang === 'en' ? 'ar' : 'en'}')">${ICONS.globe()}<span class="font-medium">${lang === 'en' ? 'العربية' : 'English'}</span></button>`;

  // Demo accounts list
  const users = (window.DATA && window.DATA.AUTH_USERS) || [];
  const demoRows = users.map(u => {
    const person = window.DATA.findPerson(u.personId);
    if (!person) return "";
    const initials = person.name.split(" ").map(w => w[0]).slice(0, 2).join("");
    const name = lang === "ar" ? person.nameAr : person.name;
    return `
      <button type="button" class="login-demo-row" onclick="AUTH.signInAs('${u.email}')">
        <span class="login-demo-ava">${initials}</span>
        <span class="login-demo-info">
          <span class="login-demo-name">${UI.escapeHtml(name)}</span>
          <span class="login-demo-meta">${UI.escapeHtml(u.email)} · ${T(`role.${person.role}`)}</span>
        </span>
        <span class="login-demo-go">${ICONS.arrowRight()}</span>
      </button>`;
  }).join("");

  const defaultEmail = users[0]?.email || "";

  return `
    <div class="login-wrap">
      <div class="login-topbar">
        <div class="flex items-center gap-2">
          <div class="h-9 w-9 rounded-xl logo-grad grid place-items-center text-white font-bold">A</div>
          <div class="font-semibold">${T("appName")}</div>
        </div>
        <div class="flex items-center gap-2">${langBtn}${themeBtn}</div>
      </div>

      <div class="login-card-wrap">
        <div class="login-card">
          <div class="login-hero">
            <div class="login-hero-badge">${ICONS.lock ? ICONS.lock() : ICONS.activity()}</div>
            <h1 class="login-hero-title">${T("auth.signInTitle")}</h1>
            <p class="login-hero-sub">${T("auth.signInSubtitle")}</p>
          </div>

          <form class="login-form" onsubmit="return submitSignIn(event)">
            ${err ? `<div class="login-error">${UI.escapeHtml(err)}</div>` : ""}
            <div class="login-field">
              <label class="field-label" for="siEmail">${T("auth.email")}</label>
              <input id="siEmail" class="input w-full" type="email" autocomplete="username" required value="${UI.escapeHtml(defaultEmail)}" placeholder="you@aquafleet.sa"/>
            </div>
            <div class="login-field">
              <div class="login-field-row">
                <label class="field-label" for="siPwd">${T("auth.password")}</label>
                <a class="login-forgot" tabindex="-1">${T("auth.forgotPwd")}</a>
              </div>
              <input id="siPwd" class="input w-full" type="password" autocomplete="current-password" required placeholder="aquafleet"/>
            </div>
            <label class="login-remember">
              <input type="checkbox" checked />
              <span>${T("auth.rememberMe")}</span>
            </label>
            <button type="submit" class="btn btn-primary w-full justify-center" style="height:2.6rem">
              ${ICONS.arrowRight()} <span>${T("auth.signIn")}</span>
            </button>
          </form>

          ${users.length > 0 ? `
            <div class="login-divider"><span>${T("auth.or")}</span></div>
            <div class="login-demo">
              <div class="login-demo-head">${T("auth.demoAccounts")}</div>
              <div class="login-demo-list">${demoRows}</div>
            </div>` : ""}
        </div>

        <div class="login-footer">${T("auth.footer")}</div>
      </div>
    </div>
    ${toastLayer()}
  `;
}

function shell(inner) {
  const lang = window.APP_STATE.lang;
  const theme = window.APP_STATE.theme;
  const route = currentRoute();
  const navHTML = NAV.map(n => {
    const active = (n.hash === "/" && route === "/") || (n.hash !== "/" && route.startsWith(n.hash));
    return `<a class="nav-item ${active ? 'active' : ''}" onclick="window.app.navigate('${n.hash}')">
      ${ICONS[n.icon]()}<span>${T(`nav.${n.key}`)}</span>
    </a>`;
  }).join("");

  const langBtn = `<button class="btn btn-outline" onclick="setLang('${lang === 'en' ? 'ar' : 'en'}')">${ICONS.globe()}<span class="font-medium">${lang === 'en' ? 'العربية' : 'English'}</span></button>`;
  const themeBtn = `<button class="btn btn-outline w-9 px-0 justify-center" onclick="setTheme('${theme === 'light' ? 'dark' : 'light'}')">${theme === 'light' ? ICONS.moon() : ICONS.sun()}</button>`;

  // Current user chip + sign-out
  const me = window.AUTH.currentUser();
  const meInitials = me ? me.name.split(" ").map(w => w[0]).slice(0, 2).join("") : "??";
  const meName = me ? (lang==='ar' ? me.nameAr : me.name) : "";
  const meRole = me ? T(`role.${me.role}`) : "";
  const userChip = me ? `
    <div class="topbar-user" title="${UI.escapeHtml(meName)} · ${UI.escapeHtml(meRole)}">
      <div class="h-9 w-9 rounded-full text-white grid place-items-center text-sm font-semibold" style="background:#0c66bf">${meInitials}</div>
      <div class="topbar-user-info">
        <div class="topbar-user-name">${UI.escapeHtml(meName)}</div>
        <div class="topbar-user-role">${UI.escapeHtml(meRole)}</div>
      </div>
      <button class="icon-btn" title="${T("auth.signOut")}" onclick="AUTH.signOut()">${ICONS.logout ? ICONS.logout() : ICONS.x()}</button>
    </div>` : "";

  return `
    <div class="flex min-h-screen">
      <aside class="w-64 shrink-0 border-app p-4 hidden md:flex flex-col" style="background:rgb(var(--card)); border-${lang==='ar'?'left':'right'}: 1px solid rgb(var(--border))">
        <div class="flex items-center gap-2 mb-6 px-2">
          <div class="h-9 w-9 rounded-xl logo-grad grid place-items-center text-white font-bold">A</div>
          <div>
            <div class="font-semibold leading-tight">${T("appName")}</div>
            <div class="text-[11px] muted leading-tight">${T("tagline")}</div>
          </div>
        </div>
        <nav class="flex flex-col gap-1">${navHTML}</nav>
        <div class="mt-auto pt-4 text-[11px] muted px-2">
          <div>v0.1 · ${lang === 'en' ? 'MVP demo' : 'نسخة تجريبية'}</div>
          <div>© 2026 AquaFleet KSA</div>
        </div>
      </aside>

      <div class="flex-1 flex flex-col min-w-0">
        <header class="h-14 border-b border-app flex items-center justify-between px-4 sticky top-0 z-10" style="background:rgb(var(--bg))">
          <div class="flex items-center gap-3 flex-1 max-w-xl">
            <div class="relative w-full">
              <span class="absolute top-1/2 -translate-y-1/2 ${lang==='ar'?'right-3':'left-3'} muted">${ICONS.search()}</span>
              <input placeholder="${T("c.search")}" class="input w-full ${lang==='ar'?'pr-9 pl-3':'pl-9 pr-3'}"/>
            </div>
          </div>
          <div class="flex items-center gap-2">
            ${langBtn}${themeBtn}
            <button class="btn btn-outline w-9 px-0 justify-center relative">${ICONS.bell()}<span class="absolute top-1.5 ${lang==='ar'?'left-1.5':'right-1.5'} h-2 w-2 rounded-full bg-rose-500"></span></button>
            ${userChip}
          </div>
        </header>

        <main class="p-4 md:p-6 flex-1 min-w-0" id="page">${inner}</main>
      </div>
    </div>
    ${modalLayer()}
    ${toastLayer()}
  `;
}

function modalLayer() {
  const m = window.APP_STATE.modal;
  if (!m) return "";
  const size = m.size || "default";
  const title = m.title || "";
  const footer = m.footer != null
    ? m.footer
    : `<button class="btn btn-outline" onclick="window.app.closeModal()">${T("c.close")}</button>`;
  return `
    <div class="modal-backdrop" onclick="if(event.target===this) window.app.closeModal()">
      <div class="modal-shell ${size}">
        <div class="modal-head">
          <h2 class="font-semibold text-lg">${title}</h2>
          <button class="icon-btn" onclick="window.app.closeModal()" aria-label="close">${ICONS.x()}</button>
        </div>
        <div class="modal-body">${m.html || ""}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
      </div>
    </div>`;
}

function toastLayer() {
  const t = window.APP_STATE.toast;
  if (!t) return "";
  return `<div class="toast">${UI.escapeHtml(t.msg)}</div>`;
}

function renderRoute() {
  const r = currentRoute();
  if (r === "/" || r === "") return PAGES_1.dashboard();
  if (r === "/fleet") return PAGES_1.fleet();
  if (r.startsWith("/fleet/")) return PAGES_1.fleetDetail(r.slice("/fleet/".length));
  if (r === "/drivers") return PAGES_1.drivers();
  if (r === "/trips") return PAGES_1.trips();
  if (r === "/routes") return PAGES_1.routes();
  if (r === "/maintenance") return PAGES_2.maintenance();
  if (r === "/predictive") return PAGES_2.predictive();
  if (r === "/iot") return PAGES_2.iot();
  if (r === "/inventory") return PAGES_2.inventory();
  if (r === "/reports") return PAGES_2.reports();
  if (r === "/archive") return PAGES_ARCHIVE.archive();
  return `<div class="card p-6">Not found: ${r}</div>`;
}

function renderApp() {
  const lang = window.APP_STATE.lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle("dark", window.APP_STATE.theme === "dark");

  const route = currentRoute();
  const root = document.getElementById("root");

  // Auth gate: any route except /login requires a session.
  if (!window.AUTH.isSignedIn() && route !== "/login") {
    // Bounce silently to the login route (preserves the previously requested
    // hash via APP_STATE so we could deep-link back to it after sign-in).
    window.APP_STATE._postLoginRoute = route !== "/" ? route : null;
    window.location.hash = "#/login";
    root.innerHTML = loginPage();
    return;
  }
  if (route === "/login") {
    // If already signed in, kick back to dashboard.
    if (window.AUTH.isSignedIn()) {
      window.location.hash = "#/";
      root.innerHTML = shell(renderRoute());
      return;
    }
    root.innerHTML = loginPage();
    return;
  }

  root.innerHTML = shell(renderRoute());
}

window.addEventListener("hashchange", renderApp);
document.addEventListener("DOMContentLoaded", renderApp);
