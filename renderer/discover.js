// Descubrir: catálogo de IGDB, búsqueda, filtros, índice A-Z y Jarvis.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Descubrir (populares / búsqueda / filtros) — IGDB
// ===============================
let lastSearchTimeout = null;

function onSearchInput() {
  const q = document.getElementById("searchInput").value.trim();
  // Easter egg: "Dartacan"
  const normalized = q.toLowerCase();
  if (normalized === "dartacan") {
    if (!dartacanPlayed) {
      dartacanPlayed = true;

      const audio = document.getElementById("easter-audio");
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch((err) => {
          console.warn(
            "No se pudo reproducir el easter egg (autoplay/política):",
            err
          );
        });
      }
    }
  } else {
    dartacanPlayed = false;
  }
  clearTimeout(lastSearchTimeout);
  lastSearchTimeout = setTimeout(() => {
    loadDiscoverGames();
    renderOwnedMatches(document.getElementById("searchInput").value);
  }, 350);
}

// Carga la lista de géneros de IGDB una vez, para el desplegable.
async function loadGenreOptions() {
  try {
    const genres = await window.electronAPI.getGenres();
    const select = document.getElementById("genreFilter");
    if (!select || !Array.isArray(genres)) return;
    for (const g of genres) {
      if (!g.name) continue;
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error("No se pudieron cargar los géneros", err);
  }
}

// Punto único: con texto de búsqueda o sin él, con o sin filtros — todo
// pasa por aquí. Antes había dos funciones casi iguales (populares y
// búsqueda) que no compartían ni el filtro de género ni el de orden.
//
// Paginación: sin búsqueda de texto, main.js pagina de verdad contra
// IGDB (offset), así que aquí solo se pide la siguiente página. Con
// búsqueda, main.js trae de una vez el pool completo (hasta 500, el
// máximo de IGDB) ya ordenado, y aquí se pagina en local sobre ese
// array sin volver a llamar a la API - así ya no hay tope de 60.
let DISCOVER_PAGE_SIZE = 60;
let discoverOffset = 0;
let discoverHasMore = false;
let discoverSearchPool = null;
let discoverSearchShown = 0;
// Letra activa del índice (solo aplica navegando, sin texto de
// búsqueda) - "Cargar más" la mantiene para seguir paginando DENTRO
// de esa letra en vez de volver al listado general.
let discoverActiveLetter = null;
// Cada petición lleva un número: si llega tarde la respuesta de una
// búsqueda anterior (escribiendo rápido), se descarta en vez de pisar
// la buena.
let discoverSeq = 0;

// Mientras llega la primera página: tarjetas fantasma con la misma
// forma que las de verdad.
function showDiscoverSkeleton() {
  const grid = document.getElementById("gamesList");
  if (!grid) return;
  const cols = currentGridColumns();
  grid.innerHTML = Array.from({ length: cols * 2 }, () => `
    <div class="game-card is-skeleton" aria-hidden="true">
      <div class="card-cover"><span class="sk-cover"></span></div>
      <div class="card-info"><span class="sk-line"></span><span class="sk-line is-short"></span></div>
    </div>`).join("");
  updateLoadMoreButton(false);
}

async function loadDiscoverGames() {
  // Buscar, cambiar filtros o volver al catálogo sale del modo Jarvis.
  if (jarvisMode) setJarvisUi(false);
  renderDiscoverIndexBar();
  const seq = ++discoverSeq;
  discoverOffset = 0;
  discoverSearchPool = null;
  discoverSearchShown = 0;
  discoverActiveLetter = null;
  markDiscoverLetter(null);
  gamesTemp = [];
  currentSearchGames = [];

  const query = document.getElementById("searchInput")?.value.trim() || "";
  const genreId = document.getElementById("genreFilter")?.value || null;
  const sort = document.getElementById("sortFilter")?.value || "popular";

  // El índice de letras solo tiene sentido navegando en alfabético sin
  // texto de búsqueda (con "más popular"/año/próximamente o buscando
  // por nombre, saltar a una letra no corresponde a nada coherente).
  const bar = document.getElementById("discoverIndexBar");
  if (bar) bar.style.display = (sort === "az" || sort === "za") && !query ? "" : "none";

  showDiscoverSkeleton();
  const res = await window.electronAPI
    .discoverGames({ query, genreId, sort, offset: 0, pageSize: DISCOVER_PAGE_SIZE })
    .catch(() => null);
  if (seq !== discoverSeq) return;
  await applyDiscoverPage(res, true, seq);
  updateGamepadFocus(true);
}

let discoverLoadingMore = false;
async function loadMoreDiscoverGames() {
  if (discoverSearchPool) {
    const next = discoverSearchPool.slice(
      discoverSearchShown,
      discoverSearchShown + DISCOVER_PAGE_SIZE
    );
    discoverSearchShown += next.length;
    appendDiscoverGames(next);
    updateLoadMoreButton(discoverSearchShown < discoverSearchPool.length);
    return;
  }
  if (discoverLoadingMore) return;

  const seq = discoverSeq;
  const genreId = document.getElementById("genreFilter")?.value || null;
  const sort = document.getElementById("sortFilter")?.value || "popular";
  const btn = document.getElementById("loadMoreBtn");
  discoverLoadingMore = true;
  btn?.classList.add("is-loading");
  try {
    const res = await window.electronAPI.discoverGames({
      query: "",
      genreId,
      sort,
      offset: discoverOffset + DISCOVER_PAGE_SIZE,
      letterPrefix: discoverActiveLetter,
      pageSize: DISCOVER_PAGE_SIZE,
    });
    if (seq !== discoverSeq) return;
    discoverOffset += DISCOVER_PAGE_SIZE;
    await applyDiscoverPage(res, false, seq);
  } catch (err) {
    console.error(err);
    showNotification("No se han podido cargar más juegos.", "error");
  } finally {
    discoverLoadingMore = false;
    btn?.classList.remove("is-loading");
  }
}

// ===============================
// Jarvis: recomendaciones con IA
// ===============================
// Aquí no hay orden ni filtros: el orden es el que da la IA (de más a
// menos recomendable). Nunca salen juegos que ya tengas.
let jarvisMode = false;
let jarvisBusy = false;
const jarvisShown = []; // ya recomendados en esta sesión (para "Otra tanda")

function setJarvisUi(on) {
  jarvisMode = on;
  document.getElementById("popular")?.classList.toggle("is-jarvis", on);
  for (const id of ["sortFilter", "genreFilter"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = on;
  }
  const bar = document.getElementById("jarvisBar");
  if (bar) bar.hidden = !on;
  if (on) {
    const idx = document.getElementById("discoverIndexBar");
    if (idx) idx.style.display = "none";
    updateLoadMoreButton(false);
  }
}

async function openJarvis(more = false) {
  if (jarvisBusy || isGuest()) return;
  const status = await window.electronAPI.aiStatus().catch(() => ({ configured: false }));
  if (!status.configured) {
    const go = await confirmDialog({
      title: "Jarvis necesita tu clave de IA",
      text: "Añade tu clave de API en Ajustes › Inteligencia artificial.",
      confirmText: "Ir a Ajustes",
      iconName: "sparkles",
    });
    if (go) openSettingsModal();
    return;
  }

  jarvisBusy = true;
  const search = document.getElementById("searchInput");
  if (search) search.value = "";
  setJarvisUi(true);
  const btn = document.getElementById("jarvisBtn");
  const moreBtn = document.getElementById("jarvisMoreBtn");
  btn?.classList.add("is-loading");
  if (moreBtn) moreBtn.disabled = true;
  document.getElementById("jarvisBarText").textContent = "Pensando en tus gustos…";
  document.getElementById("gamesList").innerHTML = `
    <div class="jarvis-loading">
      <span class="jarvis-orb"></span>
      <p><b>Jarvis está mirando tu biblioteca</b>Puede tardar un poco.</p>
    </div>`;

  try {
    const res = await window.electronAPI.aiRecommend({ exclude: more ? jarvisShown : [] });
    if (!jarvisMode) return; // el usuario se ha ido mientras pensaba
    if (!res?.ok) {
      showNotification(res?.error || "Jarvis no ha podido recomendarte nada.", "error");
      setJarvisUi(false);
      loadDiscoverGames();
      return;
    }
    await libraryReady;
    const items = notOwned(res.items || []);
    jarvisShown.push(...items.map((g) => g.name));
    window.Achievements?.track("jarvis");
    gamesTemp = [];
    currentSearchGames = items.slice();
    displayGames("gamesList", items, "add");
    // El porqué de cada recomendación, bajo el título.
    const cards = document.querySelectorAll("#gamesList > .game-card");
    items.forEach((g, i) => {
      const card = cards[i];
      if (!card || !g.jarvisReason) return;
      const p = document.createElement("p");
      p.className = "jarvis-reason";
      p.textContent = g.jarvisReason;
      card.querySelector(".card-actions")?.before(p);
      const rank = document.createElement("span");
      rank.className = "jarvis-rank";
      rank.textContent = i + 1;
      card.querySelector(".card-cover")?.appendChild(rank);
    });
    document.getElementById("jarvisBarText").textContent = items.length
      ? `${items.length} juegos para ti`
      : "Nada nuevo. Prueba otra tanda.";
    updateGamepadFocus(true);
  } finally {
    jarvisBusy = false;
    btn?.classList.remove("is-loading");
    if (moreBtn) moreBtn.disabled = false;
  }
}

function exitJarvis() {
  if (!jarvisMode) return;
  loadDiscoverGames();
}

// Ajustes > Inteligencia artificial
async function setupAiSettings() {
  const row = document.getElementById("settingsAiRow");
  const msg = document.getElementById("settingsAiMsg");
  if (!row) return;
  const status = await window.electronAPI.aiStatus().catch(() => ({ configured: false }));
  msg.textContent = "";
  if (status.configured) {
    row.innerHTML = `
      <span class="settings-ai-ok">${icon("check")}Clave guardada · modelo ${escapeHtml(status.model)}</span>
      <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-ai="clear">Quitar clave</button>`;
  } else {
    row.innerHTML = `
      <input type="password" class="settings-ai-input" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" aria-label="Clave de la API de Claude">
      <button type="button" class="sl-btn sl-btn-primary" data-ai="save">Guardar</button>`;
    msg.innerHTML = `Consíguela en <a href="#" data-ai="console">console.anthropic.com</a> (API Keys). Cada uso se cobra en tu cuenta de la API.`;
  }
  const container = document.getElementById("settingsAi");
  container.onclick = async (e) => {
    const t = e.target.closest("[data-ai]");
    if (!t) return;
    e.preventDefault();
    if (t.dataset.ai === "console") {
      window.electronAPI.openExternal?.("https://console.anthropic.com/settings/keys");
    } else if (t.dataset.ai === "clear") {
      await window.electronAPI.aiClearKey();
      setupAiSettings();
    } else if (t.dataset.ai === "save") {
      const input = row.querySelector(".settings-ai-input");
      t.disabled = true;
      msg.textContent = "Comprobando la clave…";
      const res = await window.electronAPI.aiSetKey(input.value);
      t.disabled = false;
      if (res.ok) {
        setupAiSettings();
        showNotification("Clave guardada. Jarvis ya está listo.");
      } else {
        msg.textContent = res.error;
      }
    }
  };
  row.querySelector(".settings-ai-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") row.querySelector('[data-ai="save"]')?.click();
  });
}

// Lo que ya tienes (biblioteca o pasados) no sale en Descubrir.
const notOwned = (items) => items.filter((g) => !isOwnedGame(g));

async function applyDiscoverPage(res, replace, seq = discoverSeq) {
  await libraryReady;
  if (seq !== discoverSeq) return;
  const items = notOwned((res && res.items) || []);

  if (res && res.fullPool) {
    discoverSearchPool = items;
    discoverSearchShown = Math.min(DISCOVER_PAGE_SIZE, items.length);
    const firstPage = items.slice(0, discoverSearchShown);
    gamesTemp = [];
    currentSearchGames = firstPage.slice();
    displayGames("gamesList", firstPage, "add");
    updateLoadMoreButton(discoverSearchShown < items.length);
    if (!items.length) renderDiscoverEmpty(!!res.failed);
    return;
  }

  discoverHasMore = !!(res && res.hasMore);
  if (replace) {
    gamesTemp = [];
    currentSearchGames = items.slice();
    displayGames("gamesList", items, "add");
    if (!items.length) renderDiscoverEmpty(!res || !!res.failed);
  } else {
    appendDiscoverGames(items);
  }
  updateLoadMoreButton(discoverHasMore);
}

// Sin resultados (o sin conexión): en vez de una rejilla vacía, se
// dice qué pasa y cómo salir de ahí.
function renderDiscoverEmpty(failed = false) {
  const grid = document.getElementById("gamesList");
  if (!grid) return;
  const query = document.getElementById("searchInput")?.value.trim() || "";
  const filtered = !!document.getElementById("genreFilter")?.value || document.getElementById("sortFilter")?.value === "upcoming";
  const title = failed
    ? "No se ha podido cargar el catálogo"
    : query
      ? `Nada para «${query}»`
      : "No hay juegos con estos filtros";
  const text = failed
    ? "Revisa tu conexión."
    : query
      ? "Prueba con otro nombre o en inglés."
      : "";
  grid.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">${icon(failed ? "alert" : "searchX")}</span>
      <p class="empty-title">${escapeHtml(title)}</p>
      ${text ? `<p class="empty-text">${escapeHtml(text)}</p>` : ""}
      <button class="primary" data-empty-act>${failed ? "Reintentar" : query || filtered ? "Ver todo el catálogo" : "Recargar"}</button>
    </div>`;
  grid.querySelector("[data-empty-act]").onclick = () => {
    if (!failed) {
      document.getElementById("searchInput").value = "";
      document.getElementById("genreFilter").value = "";
      if (document.getElementById("sortFilter").value === "upcoming") document.getElementById("sortFilter").value = "popular";
    }
    loadDiscoverGames();
  };
}

function appendDiscoverGames(items) {
  const container = document.getElementById("gamesList");
  if (!container) return;
  items = notOwned(items);
  currentSearchGames.push(...items);
  items.forEach((game) => container.appendChild(buildDiscoverCard(game)));
}

function updateLoadMoreButton(show) {
  const btn = document.getElementById("loadMoreBtn");
  if (btn) btn.style.display = show ? "" : "none";
}
