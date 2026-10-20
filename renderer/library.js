// Biblioteca y pasados: carga, sagas en la rejilla y botones de cada tarjeta.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Biblioteca local
// ===============================
async function loadLibrary() {
  let { games, completedGames } = await window.electronAPI.getGames();
  sagasCache = (await window.electronAPI.getSagas()) || [];

  if (Array.isArray(games)) games.forEach((g, i) => (g._order = i + 1));
  libraryIds.clear();
  ownedIgdbIds = new Set();
  ownedNames = new Set();
  for (const g of [...(games || []), ...(completedGames || [])]) {
    if (Number(g.igdbId) > 0) ownedIgdbIds.add(Number(g.igdbId));
    if (Number(g.igdbParent) > 0) ownedIgdbIds.add(Number(g.igdbParent));
    const k = ownedNameKey(g.name);
    if (k) ownedNames.add(k);
  }
  if (Array.isArray(games)) games.forEach((g) => libraryIds.add(g.id));
  if (Array.isArray(completedGames))
    completedGames.forEach((g) => libraryIds.add(g.id));

  games = games.slice().sort((a, b) => {
    const ak = (a.sortKey || a.name || "").toString();
    const bk = (b.sortKey || b.name || "").toString();
    return ak.localeCompare(bk, "es", { sensitivity: "base" });
  });

  libraryGamesCache = games;
  completedGamesCache = Array.isArray(completedGames) ? completedGames : [];
  window.Achievements?.refresh();
  completedIds = new Set(completedGamesCache.map((g) => String(g.id)));
  applyLibraryFilter();
  renderPlayList();
  renderSideNav();
  window.GamePage?.refresh();
  window.Home?.refresh();
  window.Stats?.refresh();
  updateGamepadFocus(true);
}

// Barra lateral: cuántos juegos hay en cada sitio y lo último jugado.
function renderSideNav() {
  const count = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n ? String(n) : "";
  };
  count("navLibraryCount", allLibraryCount());
  count("navPlayCount", playGames().length);
  renderRecent();
}

function renderRecent() {
  const box = document.getElementById("sideRecent");
  const list = document.getElementById("sideRecentList");
  if (!box || !list) return;
  const live = (g) => (playingNow.has(String(g.id)) ? 1 : 0);
  const recent = [...libraryGamesCache, ...completedGamesCache]
    .filter((g) => g.lastPlayed || live(g))
    .sort((a, b) => live(b) - live(a) || (b.lastPlayed || 0) - (a.lastPlayed || 0))
    .slice(0, 5);
  box.hidden = !recent.length;
  list.innerHTML = recent
    .map((g) => {
      const when = live(g) ? "Jugando ahora" : playAgo(g.lastPlayed);
      return `<button type="button" class="side-game${live(g) ? " is-live" : ""}" data-id="${escapeHtml(String(g.id))}" title="${escapeHtml(g.name)}">
        <img src="${coverOf(g)}" alt="" loading="lazy" onerror="this.onerror=null;this.src=noCoverSvg('')">
        <span><b>${escapeHtml(g.name)}</b><small>${escapeHtml(when.charAt(0).toUpperCase() + when.slice(1))}</small></span>
      </button>`;
    })
    .join("");
}

document.getElementById("sideRecentList")?.addEventListener("click", (e) => {
  const b = e.target.closest(".side-game");
  if (b) window.GamePage?.open(b.dataset.id);
});

// Clic en una tarjeta (fuera de sus botones y menús): la página del juego.
document.addEventListener("click", (e) => {
  const card = e.target.closest(".cards-grid .game-card");
  if (!card || card.classList.contains("is-skeleton") || !card.dataset.gameId) return;
  if (e.target.closest("button, a, input, .action-menu, .dropdown-content")) return;
  window.GamePage?.open(card.dataset.gameId);
});

// Busca la saga (si hay) a la que pertenece un juego.
function sagaForGame(gameId) {
  const gid = Number(gameId);
  return sagasCache.find((s) => s.gameIds.includes(gid));
}

function currentGridColumns() {
  const cols = Number(getComputedStyle(document.documentElement).getPropertyValue("--grid-cols")) || 5;
  return window.innerWidth <= 700 ? Math.min(cols, 2) : cols;
}

// Bloque de saga: UN div (display: contents) con su cabecera, su marco
// y sus cards, que se colocan directamente en la rejilla. Así el
// bloque ocupa justo los huecos de sus juegos: 5 de 5 columnas = una
// fila, 10 = dos filas, 7 = una fila y dos huecos de la siguiente, y
// lo que venga después (otra saga o un juego) se pone al lado. El fondo
// y el borde los dibuja drawSagaFrames() en SVG con la forma real (un
// rectángulo o una L). Cada card lleva su número dentro de la saga (el
// de la saga completa, aunque alguno esté en la otra sección).
function buildSagaGroup(saga, gamesInOrder, buildCard, letter) {
  const wrap = document.createElement("div");
  wrap.className = "saga-group";
  wrap.dataset.sagaId = saga.id;

  wrap.insertAdjacentHTML("beforeend", `<svg class="saga-frame" aria-hidden="true"><path class="sf-bg"/><path class="sf-tint"/></svg>`);

  const total = saga.gameIds.length;
  const header = document.createElement("div");
  header.className = "saga-group-header";
  header.innerHTML = `
    <span class="saga-group-icon">${icon("layers")}</span>
    <span class="saga-group-name">${escapeHtml(saga.name)}</span>
    <span class="saga-group-count">${total} ${total === 1 ? "juego" : "juegos"}</span>
    <button type="button" class="icon-btn saga-group-edit needs-account" title="Editar saga" aria-label="Editar saga">${icon("pencil")}</button>
  `;
  header.querySelector(".saga-group-edit").onclick = () => openSagasModal(saga.id);
  wrap.appendChild(header);

  gamesInOrder.forEach((g, i) => {
    const card = buildCard(g);
    card.classList.add("in-saga");
    // La barra de letras salta a la primera card (el div no tiene caja)
    if (i === 0 && letter) card.dataset.letter = letter;
    const pos = saga.gameIds.indexOf(Number(g.id)) + 1;
    const cover = card.querySelector(".card-cover");
    if (cover && pos > 0) {
      cover.insertAdjacentHTML("beforeend", `<span class="saga-order" title="Orden en la saga">${pos}</span>`);
    }
    wrap.appendChild(card);
  });

  return wrap;
}

// Coloca sagas y juegos en la rejilla igual que lo hará el navegador
// y decide dos cosas: dónde una saga tiene que empezar fila (si no cabe
// en lo que queda, o si es más larga que una fila) y qué filas llevan
// arriba el hueco de la cabecera de una saga (todas sus cards, sueltas
// incluidas, para que queden alineadas).
function layoutSagaGrid(container) {
  const cols = currentGridColumns();
  let col = 0;
  let row = 0;
  const rows = [];
  const startRows = new Set();
  const step = () => {
    col++;
    if (col === cols) {
      col = 0;
      row++;
    }
  };
  for (const el of container.children) {
    if (el.classList.contains("saga-group")) {
      const cards = [...el.querySelectorAll(":scope > .game-card")];
      const n = cards.length;
      if (!n) continue;
      const newRow = col > 0 && (n > cols || col + n > cols);
      if (newRow) {
        row++;
        col = 0;
      }
      cards[0].style.gridColumnStart = newRow ? "1" : "";
      startRows.add(row);
      cards.forEach((c) => {
        (rows[row] ||= []).push(c);
        step();
      });
    } else if (el.classList.contains("game-card")) {
      (rows[row] ||= []).push(el);
      step();
    } else {
      // Separador o aviso: fila entera
      if (col > 0) row++;
      col = 0;
      row++;
    }
  }
  rows.forEach((items, r) => items?.forEach((c) => c.classList.toggle("in-strip-row", startRows.has(r))));
  scheduleSagaFrames(container);
}

// Marco de cada saga: el contorno de sus cards (más un margen), con
// las esquinas redondeadas, también la del escalón de la L.
const sagaFrameObservers = new WeakMap();
function scheduleSagaFrames(container) {
  if (!sagaFrameObservers.has(container)) {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => drawSagaFrames(container));
    });
    ro.observe(container);
    sagaFrameObservers.set(container, ro);
  }
  requestAnimationFrame(() => drawSagaFrames(container));
}

function roundedPath(pts, radius) {
  let d = "";
  pts.forEach((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const lenIn = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const lenOut = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    const a = [p[0] + ((prev[0] - p[0]) / lenIn) * r, p[1] + ((prev[1] - p[1]) / lenIn) * r];
    const b = [p[0] + ((next[0] - p[0]) / lenOut) * r, p[1] + ((next[1] - p[1]) / lenOut) * r];
    d += `${i ? "L" : "M"}${a[0]},${a[1]} Q${p[0]},${p[1]} ${b[0]},${b[1]} `;
  });
  return d + "Z";
}

function drawSagaFrames(container) {
  const PAD = 6; // margen del marco alrededor de las cards
  for (const g of container.querySelectorAll(":scope > .saga-group")) {
    const cards = [...g.querySelectorAll(":scope > .game-card")];
    const svg = g.querySelector(".saga-frame");
    const header = g.querySelector(".saga-group-header");
    if (!cards.length || !svg || !cards[0].offsetWidth) continue;
    // Filas de la saga (por altura), de arriba abajo
    const byTop = new Map();
    for (const c of cards) {
      const t = c.offsetTop;
      const r = byTop.get(t) || { top: t, bottom: 0, left: Infinity, right: -Infinity };
      r.bottom = Math.max(r.bottom, t + c.offsetHeight);
      r.left = Math.min(r.left, c.offsetLeft);
      r.right = Math.max(r.right, c.offsetLeft + c.offsetWidth);
      byTop.set(t, r);
    }
    const rs = [...byTop.values()].sort((a, b) => a.top - b.top);
    const strip = parseFloat(getComputedStyle(cards[0]).marginTop) || 0;
    const last = rs[rs.length - 1];
    const L = Math.min(...rs.map((r) => r.left)) - PAD;
    const T = rs[0].top - (strip || PAD);
    const R = Math.max(...rs.map((r) => r.right)) + PAD;
    const B = last.bottom + PAD;
    let pts = [[L, T], [R, T], [R, B], [L, B]];
    if (rs.length > 1 && last.right + PAD < R - 1) {
      const Yc = rs[rs.length - 2].bottom + PAD;
      const Xr = last.right + PAD;
      pts = [[L, T], [R, T], [R, Yc], [Xr, Yc], [Xr, B], [L, B]];
    }
    const d = roundedPath(pts.map(([x, y]) => [x - L, y - T]), 18);
    svg.style.left = `${L}px`;
    svg.style.top = `${T}px`;
    svg.setAttribute("width", R - L);
    svg.setAttribute("height", B - T);
    svg.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
    // Cabecera: en el hueco de arriba, a lo ancho de la primera fila
    header.style.left = `${L + 10}px`;
    header.style.top = `${T + Math.max(0, (strip - header.offsetHeight) / 2)}px`;
    header.style.width = `${rs[0].right + PAD - L - 20}px`;
  }
}

// Botones de una card de biblioteca o de pasados. "Jugar" sale siempre
// que el juego se pueda lanzar (por .exe o por su launcher); "Vincular"
// solo cuando no hay ninguna forma de lanzarlo.
function cardActionsHtml(game, mode) {
  const id = game.id;
  const playable = canPlay(game);
  const linkBtn = game.executable
    ? `<button class="linked-btn is-icon" onclick="confirmUnlink('${id}')" title="Ejecutable vinculado (clic para desvincular)" aria-label="Ejecutable vinculado">${icon("link")}</button>`
    : playable || game.notInstalled
    ? ""
    : `<button onclick="setExecutable('${id}')">${icon("link")}<span>Vincular</span></button>`;
  // De una cuenta vinculada sin instalar: Descargar en vez de Jugar.
  const playBtn = game.notInstalled
    ? `<button class="primary dl-btn" data-dl="${id}" onclick="downloadGame('${id}')" title="Descargar desde ${STORE_NAMES[game.platform] || "su tienda"}">${icon("download")}<span>${downloadLabel(id)}</span></button>`
    : playable
    ? `<button class="primary" onclick="launchGame('${id}')">${icon("play")}<span>Jugar</span></button>`
    : "";

  const saga = sagaForGame(id);
  const sagaItem = saga
    ? `<div class="dropdown-item needs-account" onclick="removeGameFromItsSaga('${id}')">${icon("layers")}Quitar de "${escapeHtml(saga.name)}"</div>`
    : `<div class="dropdown-item needs-account" onclick="openAddToSagaModal('${id}')">${icon("layers")}Añadir a una saga</div>`;
  const exeItem = !game.executable && (playable || game.notInstalled)
    ? `<div class="dropdown-item" onclick="setExecutable('${id}')">${icon("link")}Vincular ejecutable</div>`
    : "";

  const items =
    mode === "completed"
      ? `
        <div class="dropdown-item" onclick="togglePlatinum('${id}')">${icon("crown")}${game.isPlatinum ? "Quitar platino" : "Marcar platino"}</div>
        ${sagaItem}
        <div class="dropdown-item" onclick="returnToLibrary('${id}')">${icon("arrowUp")}Desmarcar como pasado</div>
        ${exeItem}
        <div class="dropdown-item" onclick="openSortKeyEditor('${id}')">${icon("pencil")}Nombre para ordenar</div>
        <div class="dropdown-item is-danger" onclick="removeFromLibrary('${id}')">${icon("trash")}Quitar de biblioteca</div>`
      : mode === "play"
      ? `
        ${exeItem}
        <div class="dropdown-item" onclick="window.GamePage?.open('${id}')">${icon("info")}Ver la página del juego</div>`
      : `
        <div class="dropdown-item" onclick="markCompleted('${id}')">${icon("check")}Marcar como pasado</div>
        ${sagaItem}
        ${exeItem}
        <div class="dropdown-item" onclick="openSortKeyEditor('${id}')">${icon("pencil")}Nombre para ordenar</div>
        <div class="dropdown-item is-danger" onclick="removeFromLibrary('${id}')">${icon("trash")}Quitar de biblioteca</div>`;

  return `
    ${linkBtn}
    ${playBtn}
    <div class="action-menu">
      <button class="more-btn" onclick="toggleDropdown(event, '${id}')" title="Más opciones" aria-label="Más opciones">${icon("more")}</button>
      <div id="dropdown-${id}" class="dropdown-content">${items}</div>
    </div>
  `;
}

function refreshSearchUI() {
  gamesTemp = [];
  displayGames("gamesList", currentSearchGames, "add");
  updateGamepadFocus(true);
}
