// Tarjetas, tiempo jugado, barra lateral (recientes) y notificaciones.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Pintar cards reutilizable
// ===============================
// Card de un juego "pasado" (completado) — usada tanto para sueltos
// como para los que van dentro de un bloque de saga.
// mode: "library" (sin pasar), "completed" (pasado) o "play" (Jugar
// ahora: sin marcas de pasado ni platino, eso se ve en su página).
function buildGameCard(game, mode) {
  const div = document.createElement("div");
  div.className = "game-card";
  div.dataset.gameId = game.id;

  const name = game.name || "Sin nombre";
  const marks = mode === "completed";
  if (marks && game.isPlatinum) div.classList.add("platinum-card");
  if (game.notInstalled) div.classList.add("is-not-installed");
  const crownHtml = !marks
    ? ""
    : game.isPlatinum
    ? `<span class="platinum-crown" title="Pasado con platino">${icon("crown")}</span>`
    : `<span class="done-badge" title="Pasado">${icon("check")}</span>`;

  // La portada es la tarjeta: las acciones salen encima al pasar el
  // ratón (o con el foco del mando) y el clic abre la página del juego.
  div.innerHTML = `
    ${crownHtml}
    <div class="card-cover">
      <div class="card-art"><img src="${coverOf(game)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.onerror=null;this.src=noCoverSvg(this.alt)"></div>
      <div class="card-actions">${cardActionsHtml(game, mode)}</div>
    </div>
    <div class="card-info">
      <h3 title="${escapeHtml(name)}">${escapeHtml(name)}</h3>
      ${mode === "library" || mode === "completed" || mode === "play" ? `<p class="card-play" data-play="${game.id}">${playLineHtml(game)}</p>` : ""}
    </div>
  `;

  return div;
}

// ===============================
// Tiempo jugado (lo mide playtime.js en main)
// ===============================
// Los juegos con carpeta o .exe se miden solos; los demás no se pueden.
let playingNow = new Set();
const canTrack = (g) => !!(g && !g.notInstalled && (g.installDir || g.executable));

function fmtPlaytime(secs) {
  const m = Math.round((secs || 0) / 60);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 10) return `${h.toLocaleString("es-ES")} h`;
  return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

const localDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function playAgo(ms) {
  if (!ms) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}

// Días seguidos jugando hasta hoy (o hasta ayer, si hoy aún no).
function playStreak(days) {
  const set = new Set(days || []);
  const d = new Date();
  if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function playLineHtml(g) {
  if (playingNow.has(String(g.id))) return `<span class="cp-live"><i></i>Jugando ahora · ${fmtPlaytime(g.playSecs)}</span>`;
  if (!(g.playSecs > 0)) return canTrack(g) ? `<span class="cp-none">Sin jugar todavía</span>` : "";
  const streak = playStreak(g.playDays);
  return `${icon("clock")}<span>${fmtPlaytime(g.playSecs)} · ${playAgo(g.lastPlayed)}</span>${
    streak >= 2 ? `<b class="cp-streak" title="${streak} días seguidos">${icon("flame")}${streak}</b>` : ""
  }`;
}

function refreshPlayLines() {
  for (const g of [...libraryGamesCache, ...completedGamesCache]) {
    document.querySelectorAll(`.card-play[data-play="${CSS.escape(String(g.id))}"]`).forEach((el) => (el.innerHTML = playLineHtml(g)));
  }
}

// Solo se repintan las tarjetas de los juegos que han cambiado.
window.electronAPI.onPlaytime?.(({ running, games }) => {
  const before = playingNow;
  playingNow = new Set((running || []).map(String));
  const touched = new Set([...before, ...playingNow, ...(games || []).map((u) => String(u.id))]);
  for (const upd of games || []) {
    for (const g of [...libraryGamesCache, ...completedGamesCache]) {
      if (String(g.id) === String(upd.id)) Object.assign(g, upd);
    }
  }
  for (const g of [...libraryGamesCache, ...completedGamesCache]) {
    if (!touched.has(String(g.id))) continue;
    document.querySelectorAll(`.card-play[data-play="${CSS.escape(String(g.id))}"]`).forEach((el) => (el.innerHTML = playLineHtml(g)));
  }
  renderRecent();
  window.GamePage?.refreshPlay();
  window.Social?.presenceChanged();
});
window.electronAPI.playtimeRunning?.().then((ids) => {
  playingNow = new Set((ids || []).map(String));
  refreshPlayLines();
  renderRecent();
});
// A medianoche cambian "hoy/ayer" y las rachas.
setInterval(refreshPlayLines, 10 * 60 * 1000);

// Card de Descubrir ("add"). Aparte porque además de renderizarse en
// bloque (displayGames) se necesita para ir añadiendo una a una al
// pulsar "Cargar más", sin repintar lo que ya había.
function buildDiscoverCard(game) {
  const div = document.createElement("div");
  div.className = "game-card";
  div.dataset.gameId = game.id;
  div.dataset.letter = letterBucket(game.name);

  const name = game.name || "Sin nombre";
  const safeAttrName = name.replace(/"/g, "&quot;");
  const coverUrl =
    game.coverUrl ||
    (game.cover && game.cover.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
      : noCoverSvg(name));

  const index = gamesTemp.length;
  gamesTemp.push(game);

  const buttonsHtml = isOwnedGame(game)
    ? `<span class="badge-owned">${icon("check")}En tu biblioteca</span>`
    : `<button class="primary add-btn" data-index='${index}' title="Agregar a biblioteca">${icon("plus")}<span class="add-long">Agregar a biblioteca</span><span class="add-short">Agregar</span></button>`;
  const year = releaseYear(game);
  const genre = game.genres?.[0]?.name;
  const meta = [year, genre].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");

  div.innerHTML = `
    <div class="card-cover">
      <div class="card-art"><img src="${coverUrl}" alt="${safeAttrName}" loading="lazy" decoding="async"></div>
      <div class="card-actions">${buttonsHtml}</div>
    </div>
    <div class="card-info">
      <h3 title="${safeAttrName}">${escapeHtml(name)}</h3>
      <p class="card-meta">${meta || "&nbsp;"}</p>
    </div>
  `;

  return div;
}

// Cubetas del índice A-Z (biblioteca y Descubrir): símbolos, números y
// letras (con la Ñ en su sitio, como en cualquier listado en español).
const INDEX_BUCKETS = [
  "#", "0-9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
  "M", "N", "Ñ", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
];

function letterBucket(str) {
  const s = (str || "").trim();
  if (!s) return "#";
  const raw = s[0].toUpperCase();
  if (raw === "Ñ") return "Ñ";
  // "Ōkami" o "Éxodo" van con su letra, no con los símbolos.
  const ch = raw.normalize("NFD")[0];
  if (/[A-Z]/.test(ch)) return ch;
  if (/[0-9]/.test(ch)) return "0-9";
  return "#";
}

function renderLibraryIndexBar(keysShown) {
  const bar = document.getElementById("libraryIndexBar");
  if (!bar) return;

  const present = new Set(keysShown.map((k) => letterBucket(k)));
  bar.innerHTML = INDEX_BUCKETS.map((b) => {
    const has = present.has(b);
    return `<button type="button" class="index-btn" data-bucket="${b}" ${has ? "" : "disabled"}>${b}</button>`;
  }).join("");

  bar.querySelectorAll(".index-btn:not([disabled])").forEach((btn) => {
    btn.onclick = () => {
      // Primero el juego suelto con esa letra; si solo hay una saga, la saga.
      const sel = `[data-letter="${CSS.escape(btn.dataset.bucket)}"]`;
      const target =
        document.querySelector(`#libraryList > .game-card${sel}`) ||
        document.querySelector(`#libraryList > ${sel}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

// Índice de Descubrir: aquí NO se sabe de antemano qué letras existen
// (hay paginación, tanto server-side como sobre el pool de búsqueda),
// así que nunca se deshabilita ningún botón - al pulsar una letra que
// aún no está pintada, se van pidiendo más páginas (o revelando más
// del pool ya descargado en el caso de búsqueda) hasta encontrarla o
// agotar los resultados.
let discoverIndexBarBuilt = false;

function renderDiscoverIndexBar() {
  const bar = document.getElementById("discoverIndexBar");
  if (!bar || discoverIndexBarBuilt) return;
  discoverIndexBarBuilt = true;

  bar.innerHTML = INDEX_BUCKETS.map(
    (b) => `<button type="button" class="index-btn" data-bucket="${b}">${b}</button>`
  ).join("");

  bar.querySelectorAll(".index-btn").forEach((btn) => {
    btn.onclick = () => jumpToDiscoverLetter(btn.dataset.bucket);
  });
}

// IGDB soporta un filtro de prefijo ("name = \"P\"*") que devuelve
// solo los juegos que empiezan por esa letra en una única petición,
// sea cual sea el tamaño del catálogo - por eso esto es instantáneo y
// no puede "no encontrar" una letra que sí existe (antes se pedían
// páginas en serie desde donde se había quedado la búsqueda, lo que
// con catálogos grandes podía tardar mucho y acabar fallando igual).
// La letra elegida se queda marcada en el índice.
function markDiscoverLetter(bucket) {
  document.querySelectorAll("#discoverIndexBar .index-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.bucket === bucket));
}

async function jumpToDiscoverLetter(bucket) {
  const genreId = document.getElementById("genreFilter")?.value || null;
  const sort = document.getElementById("sortFilter")?.value || "popular";

  const seq = ++discoverSeq;
  discoverActiveLetter = bucket;
  discoverOffset = 0;
  discoverSearchPool = null;
  discoverSearchShown = 0;
  gamesTemp = [];
  currentSearchGames = [];
  markDiscoverLetter(bucket);

  const res = await window.electronAPI
    .discoverGames({ query: "", genreId, sort, offset: 0, letterPrefix: bucket, pageSize: DISCOVER_PAGE_SIZE })
    .catch(() => null);
  if (seq !== discoverSeq) return;
  await applyDiscoverPage(res, true, seq);

  if (res?.items?.length) {
    document.getElementById("gamesList")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    showNotification(`No hay ningún juego por "${bucket}" con estos filtros.`, "error");
  }
}

function displayGames(containerId, games, mode) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!Array.isArray(games)) return;

  if (games.length === 0) {
    if (mode === "library") {
      container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">${icon("grid")}</span>
        <p class="empty-title">${showOnlyLinked && allLibraryCount() ? "No tienes ningún juego instalado" : "Tu biblioteca está vacía"}</p>
        <p class="empty-text">${
          showOnlyLinked && allLibraryCount()
            ? "Importa los del PC o vincula el .exe de alguno."
            : "Importa tus juegos o añádelos desde Descubrir."
        }</p>
        <div class="empty-actions">${
          showOnlyLinked && allLibraryCount()
            ? `<button class="primary" onclick="toggleLinkedFilter()">Quitar el filtro</button>`
            : `<button class="primary" onclick="openImportModal()">Importar instalados</button>
               <button onclick="showSection('popular', document.querySelectorAll('.topnav-item')[0])">Ir a Descubrir</button>`
        }</div>
      </div>
    `;
      return;
    }

  }

  if (mode === "add") {
    games.forEach((game) => container.appendChild(buildDiscoverCard(game)));
    return;
  }

  // Biblioteca: primero las sagas (cada una un bloque con sus juegos en
  // el orden de la saga) y debajo los juegos sueltos por orden
  // alfabético, separados por un título.
  const entries = buildLibraryEntries(games);
  const hasSagas = entries.some((e) => e.type === "saga");
  const hasLoose = entries.some((e) => e.type === "game");
  entries.forEach((entry, i) => {
    if (entry.type === "saga") {
      container.appendChild(buildSagaGroup(entry.saga, entry.games, libraryCard, letterBucket(entry.key)));
      return;
    }
    if (hasSagas && entries[i - 1]?.type === "saga") {
      const divider = document.createElement("div");
      divider.className = "library-divider";
      divider.innerHTML = `<span>Juegos sueltos</span>`;
      container.appendChild(divider);
    }
    const card = libraryCard(entry.game);
    card.dataset.letter = letterBucket(entry.key);
    container.appendChild(card);
  });
  container.classList.toggle("has-sagas-only", hasSagas && !hasLoose);
  layoutSagaGrid(container);

  if (mode === "library") renderLibraryIndexBar(entries.map((e) => e.key));
}

function buildLibraryEntries(list) {
  const byId = new Map(list.map((g) => [Number(g.id), g]));
  const grouped = new Set();
  const entries = [];

  sagasCache.forEach((saga) => {
    const members = saga.gameIds.map((id) => byId.get(Number(id))).filter(Boolean);
    if (!members.length) return;
    members.forEach((m) => grouped.add(Number(m.id)));
    entries.push({ type: "saga", saga, games: members, key: saga.name || "" });
  });

  const byKey = (a, b) => a.key.localeCompare(b.key, "es", { sensitivity: "base", numeric: true });
  const loose = list
    .filter((g) => !grouped.has(Number(g.id)))
    .map((g) => ({ type: "game", game: g, key: g.sortKey || g.name || "" }))
    .sort(byKey);

  return [...packSagaRows(entries.sort(byKey)), ...loose];
}

// Coloca las sagas por filas dejando los menos huecos posibles (el
// "tetris"). Las sagas con más juegos que columnas ocupan filas enteras
// y su última fila deja sitio al lado (buildSagaGroup / layoutSagaGrid).
// Al empezar fila van primero las grandes (en orden
// alfabético); cada hueco se llena con la saga que mejor encaje (la
// más grande que quepa). Ej. con 5 columnas: Zelda (6) llena una fila
// y su sexto juego queda con 4 huecos al lado, donde entra una de 4.
function packSagaRows(sagaEntries) {
  const cols = currentGridColumns();
  const pending = sagaEntries.slice();
  const out = [];
  let free = cols;
  while (pending.length) {
    let idx;
    if (free === cols) {
      idx = pending.findIndex((e) => e.games.length >= cols);
      if (idx === -1) idx = 0;
    } else {
      idx = -1;
      pending.forEach((e, i) => {
        const n = e.games.length;
        if (n <= free && (idx === -1 || n > pending[idx].games.length)) idx = i;
      });
      if (idx === -1) {
        free = cols; // no cabe ninguna: fila nueva
        continue;
      }
    }
    const [entry] = pending.splice(idx, 1);
    out.push(entry);
    const n = entry.games.length;
    if (n >= cols) free = n % cols ? cols - (n % cols) : cols;
    else free = free - n || cols;
  }
  return out;
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("add-btn")) {
    const idx = Number(e.target.dataset.index);
    if (gamesTemp[idx]) addFromJson(gamesTemp[idx]);
  }
});

// ===============================
// Notificaciones
// ===============================
// Solo una a la vez: la nueva sustituye a la que hubiera.
function showNotification(message, type = "success") {
  const container = document.getElementById("notification-container");
  container.replaceChildren();
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.innerText = message;
  container.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}
