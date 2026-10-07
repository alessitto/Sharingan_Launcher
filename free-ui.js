// =====================================================================
// Juegos gratis: página dentro de Descubrir
// =====================================================================
// Los datos los trae freegames.js (main) al arrancar y cada hora; aquí se
// pintan, se quitan los que terminan (cada minuto se recalcula) y el botón
// "Gratis" de Descubrir lleva la cuenta de los que hay ahora.
(function () {
  const STORES = { steam: "Steam", epic: "Epic Games", gog: "GOG" };
  let list = { items: [], fetchedAt: 0, stores: {} };
  let notify = true;
  let loading = false;

  const root = () => document.getElementById("freeRoot");
  const active = () => list.items.filter((x) => !x.end || x.end > Date.now());
  const nowFree = () => active().filter((x) => !x.upcoming || (x.start && x.start <= Date.now()));
  const soon = () => active().filter((x) => x.upcoming && !(x.start && x.start <= Date.now()));

  function left(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h`;
    return `${Math.floor(h / 24)} días`;
  }
  const when = (t) =>
    new Date(t).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const money = (n) => (n ? n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "");
  const ago = (t) => {
    if (!t) return "todavía no";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "ahora mismo";
    if (m < 60) return `hace ${m} min`;
    return `hace ${Math.floor(m / 60)} h`;
  };

  function card(x) {
    const upcoming = soon().includes(x);
    const time = upcoming
      ? `<span class="fg-time">${icon("clock")}Gratis desde el ${escapeHtml(when(x.start))}</span>`
      : x.end
        ? `<span class="fg-time${x.end - Date.now() < 24 * 3600000 ? " is-soon" : ""}" title="Hasta el ${escapeHtml(when(x.end))}">${icon("clock")}Quedan ${left(x.end - Date.now())}</span>`
        : `<span class="fg-time">${icon("clock")}Por tiempo limitado</span>`;
    return `
      <article class="fg-card${upcoming ? " is-upcoming" : ""}">
        <div class="fg-img">
          ${x.image ? `<img src="${escapeHtml(x.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
          <span class="fg-store is-${x.store}">${storeLogo(x.store)}${STORES[x.store]}</span>
        </div>
        <div class="fg-body">
          <h3>${escapeHtml(x.title)}</h3>
          <p class="fg-price">${x.price ? `<s>${money(x.price)}</s>` : ""}<b>${upcoming ? "Próximamente gratis" : "Gratis"}</b></p>
          ${time}
          ${
            upcoming
              ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-url="${escapeHtml(x.url)}">${icon("external")}Ver en ${STORES[x.store]}</button>`
              : `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-url="${escapeHtml(x.url)}">${icon("gift")}${x.giveaway ? "Reclamar en GOG" : "Conseguir"}</button>`
          }
        </div>
      </article>`;
  }

  function render() {
    updateButton();
    const el = root();
    if (!el) return;
    const now = nowFree();
    const next = soon();
    const failed = Object.entries(list.stores || {}).filter(([, v]) => v && v.ok === false).map(([k]) => STORES[k]);
    el.innerHTML = `
      <header class="page-head">
        <div class="page-head-title">
          <span class="section-eyebrow">Descubrir</span>
          <h2 class="section-title">Juegos gratis</h2>
        </div>
        <div class="page-head-actions">
          <label class="fg-notify" title="Aviso de Windows cuando salga uno nuevo">
            <input type="checkbox" data-notify ${notify ? "checked" : ""}><span class="fg-switch"></span>Avisarme
          </label>
          <button type="button" class="filter-btn" data-refresh ${loading ? "disabled" : ""}>${icon("refresh")}${loading ? "Buscando…" : "Actualizar"}</button>
          <button type="button" class="filter-btn" data-back>${icon("back")}Volver a Descubrir</button>
        </div>
      </header>
      <p class="fg-sub">Juegos de pago de Steam, Epic Games y GOG que puedes quedarte gratis. Se actualiza solo cada hora · ${ago(list.fetchedAt)}${
        failed.length ? ` · ${failed.join(" y ")} no responde ahora` : ""
      }</p>
      ${
        now.length
          ? `<div class="fg-grid">${now.map(card).join("")}</div>`
          : `<div class="empty-state fg-empty">${icon("gift")}<p>Ahora mismo no hay ningún juego gratis.</p><span>Te avisamos en cuanto salga uno.</span></div>`
      }
      ${next.length ? `<h3 class="fg-h">Próximamente</h3><div class="fg-grid">${next.map(card).join("")}</div>` : ""}`;
  }

  function updateButton() {
    const n = nowFree().length;
    const b = document.querySelector("#freeBtn .free-count");
    if (!b) return;
    b.hidden = !n;
    b.textContent = n || "";
  }

  async function load(force) {
    loading = !!force;
    if (force) render();
    try {
      list = force ? await window.electronAPI.freeRefresh() : await window.electronAPI.freeGames();
    } catch {}
    loading = false;
    render();
  }

  function open() {
    showSection("free", document.querySelector('.topnav-item[aria-label="Descubrir"]'));
    render();
    load(false);
  }

  document.addEventListener("click", (e) => {
    const r = root();
    if (!r || !r.contains(e.target)) return;
    const go = e.target.closest("[data-url]");
    if (go) return window.electronAPI.openExternal(go.dataset.url);
    if (e.target.closest("[data-back]")) return showSection("popular", document.querySelector('.topnav-item[aria-label="Descubrir"]'));
    if (e.target.closest("[data-refresh]")) return load(true);
  });
  document.addEventListener("change", (e) => {
    if (!e.target.matches?.("#freeRoot [data-notify]")) return;
    notify = e.target.checked;
    window.electronAPI.setSettings({ freeNotify: notify });
  });

  window.electronAPI.onFreeGames?.((d) => {
    list = d || list;
    render();
  });
  window.electronAPI.onFreeOpen?.(() => open());
  window.electronAPI.getSettings?.().then((s) => {
    notify = s?.freeNotify !== false;
  });
  // Cuenta atrás y lo que termina: cada minuto.
  setInterval(() => (document.getElementById("free")?.classList.contains("active") ? render() : updateButton()), 60 * 1000);
  load(false);

  window.FreeGames = { open, refresh: () => load(true), _list: () => list };
})();
