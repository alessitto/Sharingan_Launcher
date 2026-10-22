// Versiones, aviso de actualización y Ajustes.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Historial de versiones
// ===============================
// Versión instalada (se enseña en Ajustes > Actualizaciones).
window.appVersion = "";
async function loadAppVersion() {
  try {
    const version = await window.electronAPI.getAppVersion();
    if (version) window.appVersion = version;
  } catch (err) {
    console.error("No se pudo leer la versión de la app", err);
  }
}

// ===============================
// Aviso de actualización (esquina inferior derecha)
// ===============================
// main.js busca versiones nuevas en segundo plano y solo avisa aquí
// cuando hay una. Con "Más tarde" el aviso se oculta hasta la próxima
// versión distinta.
let updateDismissedVersion = null;

function renderUpdateToast(state) {
  const el = document.getElementById("updateToast");
  if (!el || !state) return;
  const { status, version, percent = 0 } = state;
  const hidden =
    status === "idle" || (status === "available" && updateDismissedVersion === version);
  if (hidden) {
    el.classList.remove("show");
    return;
  }

  const v = version ? `v${escapeHtml(version)}` : "";
  const views = {
    available: {
      icon: "download",
      title: "Nueva versión disponible",
      text: `La ${v} ya está disponible. La app se reiniciará.`,
      actions: `
        <button type="button" class="sl-btn sl-btn-ghost" data-act="later">Más tarde</button>
        <button type="button" class="sl-btn sl-btn-primary" data-act="install">Actualizar</button>`,
    },
    downloading: {
      icon: "download",
      title: `Descargando ${v}`,
      text: `<span class="upd-bar"><span style="width:${percent}%"></span></span><span class="upd-pct">${percent}%</span>`,
    },
    installing: {
      icon: "sparkles",
      title: "Instalando actualización",
      text: "La app se reiniciará.",
    },
    error: {
      icon: "alert",
      title: "No se pudo actualizar",
      text: "Revisa tu conexión.",
      actions: `
        <button type="button" class="sl-btn sl-btn-ghost" data-act="later">Cerrar</button>
        <button type="button" class="sl-btn sl-btn-primary" data-act="install">Reintentar</button>`,
    },
  };
  const view = views[status];
  if (!view) return;

  el.className = `update-toast is-${status} show`;
  el.innerHTML = `
    <span class="upd-icon">${icon(view.icon)}</span>
    <div class="upd-body">
      <p class="upd-title">${view.title}</p>
      <div class="upd-text">${view.text}</div>
      ${status === "available" ? `<button type="button" class="upd-link" data-act="notes">Ver novedades</button>` : ""}
      ${view.actions ? `<div class="upd-actions">${view.actions}</div>` : ""}
    </div>`;

  el.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      if (act === "install") window.electronAPI.installUpdate();
      if (act === "notes") openChangelogModal();
      if (act === "later") {
        updateDismissedVersion = version;
        el.classList.remove("show");
      }
    };
  });
}

function setupUpdateToast() {
  if (!window.electronAPI.onUpdateState) return;
  window.electronAPI.onUpdateState(renderUpdateToast);
  window.electronAPI.getUpdateState().then(renderUpdateToast).catch(() => {});
}

// Notas de una release (Markdown sencillo de GitHub): viñetas con
// sublistas por sangría, **negrita** y `código`. Los títulos (#) se
// saltan porque cada release ya lleva su nombre.
function changelogHtml(body) {
  const inline = (t) =>
    escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  let html = "";
  let open = false;
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    if (!raw.trim() || /^\s*#+\s/.test(raw)) continue;
    const nested = /^\s{2,}[-*]\s/.test(raw) && open;
    const text = inline(raw.trim().replace(/^[-*]\s*/, ""));
    if (nested) {
      html = html.replace(/(<\/ul>)?<\/li>$/, (m, sub) => (sub ? "" : "<ul>")) + `<li>${text}</li></ul></li>`;
    } else {
      html += `<li>${text}</li>`;
      open = true;
    }
  }
  return html;
}

async function openChangelogModal() {
  const version = window.appVersion;
  let root = null;

  openModal({
    eyebrow: "Sharingan Launcher",
    title: "Historial de versiones",
    html: `<div class="cl-root"><div class="sl-loading"><span class="sl-spinner"></span></div></div>`,
    showConfirmButton: false,
    showCloseButton: true,
    width: 600,
    didOpen: (popup) => (root = popup.querySelector(".cl-root")),
  });

  let releases = [];
  try {
    releases = (await window.electronAPI.getChangelog()) || [];
  } catch (err) {
    console.error(err);
  }
  if (!root || !root.isConnected) return;

  if (!releases.length) {
    root.innerHTML = `<p class="sl-hint cl-empty">No se ha podido cargar el historial.</p>`;
    return;
  }

  root.innerHTML = releases
    .map((r) => {
      const date = r.publishedAt
        ? new Date(r.publishedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
        : "";
      const isCurrent = version && String(r.tag || "").replace(/^v/, "") === version;
      const lines = changelogHtml(r.body || "");
      return `
      <article class="cl-release ${isCurrent ? "is-current" : ""}">
        <header class="cl-head">
          <span class="cl-name">${escapeHtml(r.name)}</span>
          ${isCurrent ? `<span class="cl-badge">Instalada</span>` : ""}
          <span class="cl-date">${date}</span>
        </header>
        ${lines ? `<ul class="cl-list">${lines}</ul>` : ""}
      </article>`;
    })
    .join("");
}

// ===============================
// Ajustes de usuario
// ===============================
// Tema activo: color (paleta de dos colores) + estilo. Todo lo
// calcula themes.js; aquí solo se guarda y se pinta el selector.
let themeState = { palette: "itachi", effect: "default", tint: "clear" };
// Windows con los efectos de transparencia quitados: Liquid Glass va
// siempre en Tintado y sin refracción (lo dice main, system:transparency).
let reduceTransparency = false;

function setReduceTransparency(reduced) {
  reduced = !!reduced;
  document.documentElement.setAttribute("data-reduce-transparency", reduced ? "1" : "0");
  if (reduced === reduceTransparency) return;
  reduceTransparency = reduced;
  applyTheme({ theme: themeState.palette, themeEffect: themeState.effect });
  // Si Ajustes > Tema está abierto (y no cerrándose), se repinta.
  if (document.querySelector(".swal2-popup.st-modal:not(.swal2-hide) .st-theme-page")) openSettingsModal("theme");
}
window.electronAPI.systemTransparency?.().then((r) => setReduceTransparency(r?.reduced)).catch(() => {});
window.electronAPI.onSystemTransparency?.((r) => setReduceTransparency(r?.reduced));

async function loadAppSettings() {
  try {
    const settings = (await window.electronAPI.getSettings()) || {};
    if (settings.gamesPerPage) DISCOVER_PAGE_SIZE = settings.gamesPerPage;
    applyGridColumns(settings.gridColumns);
    applyTheme(settings);
    setAynThorEnabled(settings.hasAynThor);
  } catch (err) {
    console.error("No se pudieron cargar los ajustes", err);
  }
}

function applyGridColumns(value) {
  if (!value) return;
  document.documentElement.style.setProperty("--grid-cols", value);
  // Los bloques de saga calculan su ancho en columnas al pintarse.
  if (document.querySelector(".saga-group")) {
    applyLibraryFilter();
  }
}

function applyTheme(settings) {
  const s = settings || {};
  if (s.glassTint !== undefined) themeState.tint = s.glassTint === "tinted" ? "tinted" : "clear";
  const tint = themeState.tint;
  themeState = { ...window.SLThemes.apply({ ...s, glassTint: reduceTransparency ? "tinted" : tint }), tint };
  window.Achievements?.trackTheme(themeState.palette);
  window.Achievements?.trackTheme(`fx:${themeState.effect}`);
  refreshNoCovers();
}

// Al elegir otro color o estilo, la ventana entera hace un fundido
// del tema viejo al nuevo en vez de cambiar de golpe.
function smoothTheme(settings) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced) return applyTheme(settings);
  document.startViewTransition(() => applyTheme(settings));
}

// Liquid Glass: Transparente o Tintado, con un control segmentado como
// los de iOS (la píldora se desliza a la opción elegida).
function glassTintHtml() {
  const sel = reduceTransparency ? "tinted" : themeState.tint;
  const opt = (id, name, desc) => `
    <button type="button" class="lg-seg-opt${sel === id ? " is-on" : ""}" role="radio" aria-checked="${sel === id}" data-tint="${id}" ${reduceTransparency ? "disabled" : ""}>
      <span class="lg-seg-prev is-${id}" aria-hidden="true"><i></i></span>
      <span class="lg-seg-text"><b>${name}</b><small>${desc}</small></span>
    </button>`;
  return `
    <div class="lg-seg" role="radiogroup" aria-label="Cristal" data-sel="${sel}">
      <span class="lg-seg-thumb" aria-hidden="true"></span>
      ${opt("clear", "Transparente", "Se ve el fondo a través del cristal.")}
      ${opt("tinted", "Tintado", "Más opaco y con más contraste: se lee mejor.")}
    </div>
    ${reduceTransparency ? `<p class="st-glass-note">${icon("info")}<span>Windows tiene quitados los efectos de transparencia, así que se usa Tintado.</span></p>` : ""}`;
}

function themeSwatchHtml(p, selected) {
  return `
    <div class="theme-swatch${selected ? " is-selected" : ""}" data-theme-id="${p.id}" title="${p.name}">
      <span class="theme-swatch-preview" style="background:${p.bg};">
        <span class="theme-swatch-accent" style="background:${p.accent};"></span>
      </span>
      <span class="theme-swatch-name">${p.name}</span>
    </div>`;
}

// Cada ajuste se aplica y se guarda al momento (como un panel de
// ajustes de Linear/Notion) - no hay Guardar/Cancelar, solo cerrar
// con la × o Esc, porque no queda nada pendiente de confirmar.
async function persistSetting(patch) {
  try {
    return await window.electronAPI.setSettings(patch);
  } catch (err) {
    console.error("No se pudo guardar el ajuste", err);
  }
}

// Ajustes por páginas: menú a la izquierda y una página a la derecha,
// sin scroll. Se vuelve a la última página que se miró.
const SETTINGS_PAGES = [
  { id: "account", name: "Cuenta", icon: "user" },
  { id: "general", name: "General", icon: "maximize" },
  { id: "stores", name: "Tiendas", icon: "link", account: true },
  { id: "theme", name: "Tema", icon: "palette", account: true },
  { id: "discover", name: "Descubrir", icon: "grid", account: true },
  { id: "spotify", name: "Spotify", icon: "music", account: true },
  { id: "ai", name: "Inteligencia artificial", icon: "lightbulb", account: true },
  { id: "shortcuts", name: "Atajos de teclado", icon: "keyboard", account: true },
  { id: "data", name: "Datos", icon: "save" },
  { id: "updates", name: "Actualizaciones", icon: "download" },
];
let settingsPage = "account";
const OLD_SETTINGS_PAGES = { color: "theme", style: "theme" };

// Lo personal (PokéPark, Comunidad, IA, Spotify, tiendas) solo se ve
// con la sesión iniciada: body.is-guest oculta todo lo .needs-account.
const isGuest = () => document.body.classList.contains("is-guest");
const visibleSettingsPages = () => SETTINGS_PAGES.filter((p) => !p.account || !isGuest());

function applyAccountGate(loggedIn) {
  if (isGuest() === !loggedIn) return;
  document.body.classList.toggle("is-guest", !loggedIn);
  // Ajustes abiertos: se repinta el menú con las páginas que tocan.
  if (document.querySelector(".st-modal .st-nav")) {
    openSettingsModal(visibleSettingsPages().some((p) => p.id === settingsPage) ? settingsPage : "account");
  }
  if (loggedIn) return;
  loadAppSettings(); // el aspecto vuelve al de serie
  if (jarvisMode) exitJarvis();
  window.SpotifyUI?.close?.();
  const active = document.querySelector(".section.active")?.id;
  if (active === "pokepark" || active === "community") {
    showSection("popular", document.querySelector(".topnav-item"));
  }
}
window.electronAPI.onCloudStatus?.((s) => applyAccountGate(!!s?.user));
// Llegan los ajustes y claves de la cuenta (otro PC o recién entrado).
window.electronAPI.onCloudProfile?.(async () => {
  await loadAppSettings();
  window.SpotifyUI?.refresh?.();
  if (document.querySelector(".st-modal .st-nav")) openSettingsModal(settingsPage);
});
// Al arrancar, la sesión guardada (sin esperar a la API: vale sin conexión).
window.electronAPI.cloud("status").then((s) => applyAccountGate(!!s?.user)).catch(() => {});

const settingsPageHtml = {
  account: () => `<div class="st-account"></div>`,
  shortcuts: () => `<div class="st-shortcuts"></div>`,
  // Ventana y arranque (solo de este PC, no van con la cuenta)
  general: (s) => `
    <div class="settings-data st-general">
      <label class="settings-data-row">
        <div>
          <p class="settings-data-title">Al cerrar, seguir en la bandeja</p>
          <p class="settings-update-text">La × esconde la ventana y el launcher sigue en la bandeja del sistema (junto al reloj). Para salir del todo: clic derecho en el icono › Salir.</p>
        </div>
        <input type="checkbox" class="st-switch" data-pref="closeToTray" ${s.closeToTray !== false ? "checked" : ""}>
      </label>
      <label class="settings-data-row">
        <div>
          <p class="settings-data-title">Arrancar con Windows</p>
          <p class="settings-update-text">Se abre en la bandeja al encender el PC, sin ventana.</p>
        </div>
        <input type="checkbox" class="st-switch" data-pref="startWithWindows" ${s.startWithWindows ? "checked" : ""}>
      </label>
      <label class="settings-data-row">
        <div>
          <p class="settings-data-title">Minimizar al jugar</p>
          <p class="settings-update-text">Al lanzar un juego, la ventana del launcher se minimiza.</p>
        </div>
        <input type="checkbox" class="st-switch" data-pref="minimizeOnLaunch" ${s.minimizeOnLaunch ? "checked" : ""}>
      </label>
      <label class="settings-data-row">
        <div>
          <p class="settings-data-title">Tengo un Ayn Thor</p>
          <p class="settings-update-text">En cada juego podrás marcar que lo vas a jugar en el Ayn Thor, y filtrarlos en la biblioteca.</p>
        </div>
        <input type="checkbox" class="st-switch" data-pref="hasAynThor" ${s.hasAynThor ? "checked" : ""}>
      </label>
    </div>`,
  stores: () => `<div class="st-stores"></div>`,
  // Tema: colores y estilos en la misma página (con scroll propio).
  theme: () => {
    const T = window.SLThemes;
    return `
      <section class="st-theme-sec">
        <p class="st-theme-head">Color</p>
      <div class="st-colors" id="themeColors">${T.CATEGORIES.map(
        (cat) => `
          <div class="tp-cat">
            <p class="tp-cat-title">${cat.name}</p>
            ${cat.groups
              .map(
                (g) => `
                  ${g.name ? `<p class="tp-sub">${g.name}</p>` : ""}
                  <div class="theme-grid">${g.items.map((p) => themeSwatchHtml(p, p.id === themeState.palette)).join("")}</div>`
              )
              .join("")}
          </div>`
      ).join("")}</div>
      </section>
      <section class="st-theme-sec">
        <p class="st-theme-head">Estilo</p>
    <div class="tp-effects" id="themeEffects">${window.SLThemes.EFFECTS.map(
      (e) => `
        <div class="tp-effect${e.id === themeState.effect ? " is-selected" : ""}" data-effect-id="${e.id}">
          <span class="tp-fx tp-fx-${e.id}" aria-hidden="true"><span class="tp-fx-pill"></span><span class="tp-fx-text">Aa</span></span>
          <span class="tp-effect-name">${e.name}</span>
          <span class="tp-effect-desc">${e.desc}</span>
        </div>`
    ).join("")}</div>
      </section>
      <section class="st-theme-sec st-glass-sec" ${themeState.effect === "glass" ? "" : "hidden"}>
        <p class="st-theme-head">Cristal</p>
        ${glassTintHtml()}
      </section>
      <p class="tp-soon">${icon("sparkles")}Más colores y estilos llegarán en próximas actualizaciones.</p>`;
  },
  discover: (s) => `
    <div class="st-field">
      <div class="settings-row-head">
        <label for="settingsGamesPerPage">Juegos por página</label>
        <span id="settingsGamesPerPageValue" class="settings-value">${s.gamesPerPage}</span>
      </div>
      <input id="settingsGamesPerPage" class="settings-slider" type="range" min="12" max="200" step="1" value="${s.gamesPerPage}" />
      <div class="settings-row-ends"><span>12</span><span>200</span></div>
    </div>
    <div class="st-field">
      <div class="settings-row-head">
        <label for="settingsGridColumns">Juegos por fila</label>
        <span id="settingsGridColumnsValue" class="settings-value">${s.gridColumns}</span>
      </div>
      <input id="settingsGridColumns" class="settings-slider" type="range" min="3" max="10" step="1" value="${s.gridColumns}" />
      <div class="settings-row-ends"><span>3</span><span>10</span></div>
    </div>`,
  spotify: () => `<div class="st-spotify"></div>`,
  ai: () => `
    <div class="settings-ai" id="settingsAi">
      <p class="settings-update-text">Para Jarvis y el orden de las sagas. Se guarda cifrada.</p>
      <div class="settings-ai-row" id="settingsAiRow"></div>
      <p class="settings-ai-msg" id="settingsAiMsg"></p>
    </div>`,
  data: () => `
    <div class="settings-data">
      <div class="settings-data-row needs-account">
        <div><p class="settings-data-title">Copia de partidas</p></div>
        <button type="button" id="settingsBackupBtn" class="sl-btn sl-btn-ghost">${icon("save")}Hacer copia</button>
      </div>
      <div class="settings-data-row">
        <div>
          <p class="settings-data-title">Borrar todos los datos</p>
          <p class="settings-update-text">Biblioteca, pasados y sagas.</p>
        </div>
        <button type="button" id="settingsWipeBtn" class="sl-btn sl-btn-danger-ghost">${icon("trash")}Borrar todo</button>
      </div>
    </div>`,
  updates: () => `
    <div class="st-version">
      <span class="st-version-num">v${escapeHtml(window.appVersion || "")}</span>
      <p id="settingsUpdateText" class="settings-update-text">Versión instalada</p>
    </div>
    <div class="st-actions">
      <button type="button" id="settingsUpdateBtn" class="sl-btn sl-btn-primary">${icon("download")}Buscar actualizaciones</button>
      <button type="button" id="settingsNotesBtn" class="sl-btn sl-btn-ghost">${icon("calendar")}Historial de versiones</button>
    </div>`,
};

function bindSettingsPage(id, page) {
  if (id === "general") {
    page.querySelectorAll("[data-pref]").forEach((el) =>
      el.addEventListener("change", () => {
        window.electronAPI.setSettings({ [el.dataset.pref]: el.checked });
        if (el.dataset.pref === "hasAynThor") setAynThorEnabled(el.checked);
      })
    );
  } else if (id === "shortcuts") {
    window.Shortcuts?.renderSettings(page.querySelector(".st-shortcuts"));
  } else if (id === "account") {
    window.Community?.renderAccount(page.querySelector(".st-account"), () => openSettingsModal("account"));
  } else if (id === "theme") {
    const colorsEl = page.querySelector("#themeColors");
    colorsEl.addEventListener("click", (e) => {
      const sw = e.target.closest(".theme-swatch");
      if (!sw) return;
      const theme = sw.dataset.themeId;
      colorsEl.querySelectorAll(".theme-swatch").forEach((el) => el.classList.toggle("is-selected", el === sw));
      smoothTheme({ theme, themeEffect: themeState.effect });
      persistSetting({ theme });
    });
    const effectsEl = page.querySelector("#themeEffects");
    effectsEl.addEventListener("click", (e) => {
      const card = e.target.closest(".tp-effect");
      if (!card) return;
      const themeEffect = card.dataset.effectId;
      effectsEl.querySelectorAll(".tp-effect").forEach((el) => el.classList.toggle("is-selected", el === card));
      smoothTheme({ theme: themeState.palette, themeEffect });
      persistSetting({ themeEffect });
      const glassSec = page.querySelector(".st-glass-sec");
      if (glassSec) glassSec.hidden = themeEffect !== "glass";
    });
    page.querySelector(".st-glass-sec")?.addEventListener("click", (e) => {
      const b = e.target.closest(".lg-seg-opt");
      if (!b || b.disabled) return;
      const glassTint = b.dataset.tint;
      const seg = b.closest(".lg-seg");
      seg.dataset.sel = glassTint;
      seg.querySelectorAll(".lg-seg-opt").forEach((o) => {
        o.classList.toggle("is-on", o === b);
        o.setAttribute("aria-checked", String(o === b));
      });
      smoothTheme({ theme: themeState.palette, themeEffect: themeState.effect, glassTint });
      persistSetting({ glassTint });
    });
  } else if (id === "discover") {
    const pageInput = page.querySelector("#settingsGamesPerPage");
    const pageValue = page.querySelector("#settingsGamesPerPageValue");
    pageInput.addEventListener("input", () => (pageValue.textContent = pageInput.value));
    pageInput.addEventListener("change", async () => {
      const saved = await persistSetting({ gamesPerPage: Math.round(Number(pageInput.value)) });
      if (saved) DISCOVER_PAGE_SIZE = saved.gamesPerPage;
      if (document.getElementById("popular")?.classList.contains("active")) await loadDiscoverGames();
    });
    const colsInput = page.querySelector("#settingsGridColumns");
    const colsValue = page.querySelector("#settingsGridColumnsValue");
    colsInput.addEventListener("input", () => {
      colsValue.textContent = colsInput.value;
      applyGridColumns(colsInput.value);
    });
    colsInput.addEventListener("change", () => persistSetting({ gridColumns: Math.round(Number(colsInput.value)) }));
  } else if (id === "stores") {
    renderStoresSettings(page.querySelector(".st-stores"));
  } else if (id === "spotify") {
    renderSpotifySettings(page.querySelector(".st-spotify"));
  } else if (id === "ai") {
    setupAiSettings();
  } else if (id === "data") {
    page.querySelector("#settingsBackupBtn").addEventListener("click", () => openBackupModal());
    page.querySelector("#settingsWipeBtn").addEventListener("click", () => wipeAllData());
  } else if (id === "updates") {
    const updateBtn = page.querySelector("#settingsUpdateBtn");
    const updateText = page.querySelector("#settingsUpdateText");
    page.querySelector("#settingsNotesBtn").addEventListener("click", () => openChangelogModal());
    updateBtn.addEventListener("click", async () => {
      updateBtn.disabled = true;
      updateText.textContent = "Buscando actualizaciones…";
      // Si había un aviso descartado con "Más tarde", que vuelva a salir.
      updateDismissedVersion = null;
      const res = (await window.electronAPI.checkForUpdates().catch(() => null)) || { status: "error" };
      const messages = {
        available: `Versión nueva disponible (v${res.version}).`,
        downloading: "Ya se está descargando la actualización.",
        installing: "Instalando la actualización, la app se reiniciará.",
        latest: "Ya tienes la última versión.",
        dev: "Las actualizaciones solo funcionan en la app instalada.",
        error: "No se pudo comprobar. Revisa tu conexión.",
      };
      updateText.textContent = messages[res.status] || messages.error;
      updateBtn.disabled = false;
    });
  }
}

// Ajustes › Tiendas: vincular Steam, Epic y GOG. Con una vinculada,
// Importar trae también los juegos de la cuenta que no están instalados.
async function renderStoresSettings(box, msg = "") {
  if (!box) return;
  const st = (await window.electronAPI.stores("status").catch(() => null)) || {};
  const anyLinked = Object.values(st).some((x) => x?.linked);
  box.innerHTML = `
    <div class="settings-data">
      ${Object.entries(STORE_NAMES)
        .map(([k, name]) => {
          const s = st[k] || {};
          return `
            <div class="settings-data-row st-store${s.linked ? " is-on" : ""}">
              <span class="st-store-icon">${storeLogo(k)}<span class="st-store-dot"></span></span>
              <div>
                <p class="settings-data-title">${name}</p>
                <p class="settings-update-text">${s.linked ? `Vinculada${s.name ? ` · ${escapeHtml(s.name)}` : ""}` : "Sin vincular"}</p>
              </div>
              ${
                s.linked
                  ? `<button type="button" class="sl-btn sl-btn-ghost" data-store="${k}" data-act="unlink">Desvincular</button>`
                  : `<button type="button" class="sl-btn sl-btn-primary" data-store="${k}" data-act="link">${icon("link")}Vincular</button>`
              }
            </div>`;
        })
        .join("")}
    </div>
    ${
      anyLinked
        ? `<p class="settings-update-text st-store-note">Vincular una cuenta no añade nada a tu biblioteca: elige tú qué juegos quieres o búscalos en Descubrir.</p>
           <div class="st-actions">
             <button type="button" class="sl-btn sl-btn-primary" data-act="owned">${icon("plus")}Elegir juegos de mis cuentas</button>
             <button type="button" class="sl-btn sl-btn-ghost" data-act="import">${icon("download")}Importar instalados</button>
           </div>`
        : ""
    }
    <p class="settings-ai-msg">${escapeHtml(msg)}</p>`;
  box.onclick = async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || box.classList.contains("is-busy")) return;
    const { act, store } = b.dataset;
    if (act === "import") {
      Swal.close();
      setTimeout(() => openImportModal(), 120);
      return;
    }
    if (act === "owned") {
      Swal.close();
      setTimeout(() => openOwnedPicker(), 120);
      return;
    }
    box.classList.add("is-busy");
    b.disabled = true;
    try {
      if (act === "link") {
        b.lastChild.textContent = "Esperando…";
        const res = await window.electronAPI.stores("link", store);
        if (res?.ok) showNotification(`${STORE_NAMES[store]} vinculada. No se ha añadido ningún juego: elige tú cuáles.`);
        await renderStoresSettings(box, res?.ok || res?.cancelled ? "" : res?.error || "No se ha podido vincular.");
      } else {
        await window.electronAPI.stores("unlink", store);
        await renderStoresSettings(box);
      }
    } finally {
      box.classList.remove("is-busy");
    }
  };
}

// Ajustes › Spotify: estado, conectar / cambiar de app / desconectar y
// si se ve el botón de la barra. El asistente vive en spotify-setup.js.
async function renderSpotifySettings(box) {
  const S = window.SpotifyUI;
  if (!box || !S) return;
  const c = (await S.config()) || {};
  const id = c.clientId || "";
  const short = id ? `${id.slice(0, 4)}…${id.slice(-4)}` : "";
  const state = c.connected ? "on" : id ? "half" : "off";
  const openSp = (step, opts) => {
    Swal.close();
    setTimeout(() => S.open(step, opts), 120);
  };
  box.innerHTML = `
    <div class="st-sp-status is-${state}">
      <span class="st-sp-dot"></span>
      <div>
        <p class="settings-data-title">${{ on: "Conectado", half: "Sin conectar", off: "Sin configurar" }[state]}</p>
        <p class="settings-update-text">${
          id ? `Tu app: <code>${escapeHtml(short)}</code>${c.source === "account" ? " (de tu cuenta)" : ""}` : "Conéctalo en 2 minutos con el asistente."
        }</p>
      </div>
      ${
        c.connected
          ? `<button type="button" class="sl-btn sl-btn-primary" data-sp="player">${icon("music")}Abrir reproductor</button>`
          : `<button type="button" class="sl-btn sl-btn-primary" data-sp="setup">${icon("music")}${id ? "Conectar" : "Empezar"}</button>`
      }
    </div>
    <div class="settings-data">
      ${
        id
          ? `<div class="settings-data-row">
              <div><p class="settings-data-title">Cambiar de app</p><p class="settings-update-text">Usa otro Client ID.</p></div>
              <button type="button" class="sl-btn sl-btn-ghost" data-sp="change">Cambiar Client ID</button>
            </div>`
          : ""
      }
      ${
        c.connected
          ? `<div class="settings-data-row">
              <div><p class="settings-data-title">Desconectar</p><p class="settings-update-text">Tu app se queda guardada.</p></div>
              <button type="button" class="sl-btn sl-btn-ghost" data-sp="disconnect">Desconectar</button>
            </div>`
          : ""
      }
      ${
        id && c.source === "settings"
          ? `<div class="settings-data-row">
              <div><p class="settings-data-title">Quitar mi app</p><p class="settings-update-text">Borra el Client ID y la sesión de este PC.</p></div>
              <button type="button" class="sl-btn sl-btn-danger-ghost" data-sp="forget">${icon("trash")}Quitar</button>
            </div>`
          : ""
      }
      <label class="settings-data-row st-sp-toggle">
        <div><p class="settings-data-title">Botón en la barra lateral</p></div>
        <input type="checkbox" class="st-switch" data-sp="button" ${S.buttonShown() ? "checked" : ""}>
      </label>
      <label class="settings-data-row st-sp-toggle">
        <div><p class="settings-data-title">Enseñar a tus amigos lo que escuchas</p></div>
        <input type="checkbox" class="st-switch" data-sp="share" ${S.shareShown() ? "checked" : ""}>
      </label>
    </div>`;
  box.onclick = async (e) => {
    const act = e.target.closest("button[data-sp]")?.dataset.sp;
    if (act === "player") openSp();
    else if (act === "setup") openSp(id ? 4 : 1);
    else if (act === "change") openSp(3, { setup: true });
    else if (act === "disconnect" || act === "forget") {
      await window.electronAPI.spotify(act);
      renderSpotifySettings(box);
    }
  };
  box.querySelector('[data-sp="button"]').onchange = (e) => S.showButton(e.target.checked);
  box.querySelector('[data-sp="share"]').onchange = (e) => S.setShare(e.target.checked);
}

async function openSettingsModal(start) {
  if (start) settingsPage = start;
  settingsPage = OLD_SETTINGS_PAGES[settingsPage] || settingsPage;
  const settings = (await window.electronAPI.getSettings()) || {};
  const values = {
    gamesPerPage: settings.gamesPerPage || DISCOVER_PAGE_SIZE || 60,
    gridColumns: Number(getComputedStyle(document.documentElement).getPropertyValue("--grid-cols")) || settings.gridColumns || 5,
    closeToTray: settings.closeToTray,
    startWithWindows: settings.startWithWindows,
    minimizeOnLaunch: settings.minimizeOnLaunch,
    hasAynThor: settings.hasAynThor,
  };

  await openModal({
    showConfirmButton: false,
    showCloseButton: true,
    allowEscapeKey: true,
    allowOutsideClick: true,
    width: 880,
    customClass: { popup: "st-modal" },
    html: `
      <div class="st settings-panel theme-picker">
        <nav class="st-nav" aria-label="Secciones de ajustes">
          <p class="st-nav-title">Ajustes</p>
          ${visibleSettingsPages().map(
            (p) => `<button type="button" class="st-tab" data-page="${p.id}">${icon(p.icon)}<span>${p.name}</span></button>`
          ).join("")}
        </nav>
        <section class="st-page" aria-live="polite"></section>
      </div>`,
    didOpen: (popup) => {
      const pageEl = popup.querySelector(".st-page");
      const show = (id) => {
        const pages = visibleSettingsPages();
        const def = pages.find((p) => p.id === id) || pages[0];
        settingsPage = def.id;
        popup.querySelectorAll(".st-tab").forEach((t) => {
          const on = t.dataset.page === def.id;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-current", on ? "page" : "false");
        });
        pageEl.innerHTML = `<h3 class="st-title">${def.name}</h3><div class="st-body st-${def.id}-page">${settingsPageHtml[def.id](values)}</div>`;
        pageEl.classList.remove("is-entering");
        void pageEl.offsetWidth;
        pageEl.classList.add("is-entering");
        bindSettingsPage(def.id, pageEl);
      };
      popup.querySelector(".st-nav").addEventListener("click", (e) => {
        const tab = e.target.closest(".st-tab");
        if (tab && tab.dataset.page !== settingsPage) show(tab.dataset.page);
      });
      show(settingsPage);
    },
  });
}
