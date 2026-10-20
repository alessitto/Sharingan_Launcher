// =====================================================================
// Inicio
// =====================================================================
// La portada del launcher: "Continuar jugando" con el arte del último
// juego, lo jugado recientemente, tu semana, lo que juegan tus amigos, los
// juegos gratis de ahora y recomendaciones según tus géneros favoritos.
// Se pinta al entrar (y se refresca si cambia la biblioteca).
//
// Usa de index.html: libraryGamesCache, completedGamesCache, playingNow,
// coverOf, launchGame, fmtPlaytime, playAgo, icon, escapeHtml.
(() => {
  "use strict";

  const root = document.getElementById("homeRoot");
  if (!root) return;
  const esc = (s) => escapeHtml(String(s ?? ""));
  const IMG = (size, id) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  let seq = 0;
  let recoCache = null; // { at, key, items }
  let freeCache = null;

  const allGames = () => [...libraryGamesCache, ...completedGamesCache];
  const igdbIdOf = (g) => g.igdbId || (!(g.installDir || g.steamAppId || g.epicAppName || g.gogGameId || g.gogProductId) && Number(g.id) > 0 ? Number(g.id) : null);

  // Segundos jugados en los últimos 7 días (playLog, desde la 4.1)
  function weekSecs() {
    const days = new Set();
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      d.setDate(d.getDate() - 1);
    }
    let s = 0;
    for (const g of allGames()) for (const [k, v] of Object.entries(g.playLog || {})) if (days.has(k)) s += Number(v) || 0;
    return s;
  }

  function render() {
    const my = ++seq;
    const recent = allGames()
      .filter((g) => g.lastPlayed || playingNow.has(String(g.id)))
      .sort((a, b) => (playingNow.has(String(b.id)) ? 1 : 0) - (playingNow.has(String(a.id)) ? 1 : 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
    const hero = recent[0] || libraryGamesCache.find((g) => canPlay(g)) || null;
    const total = allGames().reduce((n, g) => n + (g.playSecs || 0), 0);
    const week = weekSecs();
    const plats = completedGamesCache.filter((g) => g.isPlatinum).length;

    root.innerHTML = `
      <div class="hm">
        ${hero ? heroHtml(hero) : emptyHeroHtml()}
        ${
          recent.length > 1
            ? `<section class="hm-sec">
                 <div class="hm-sec-head"><h2 class="hm-h">Jugado recientemente</h2><button type="button" class="cm-link" data-go="library">Ver biblioteca</button></div>
                 <div class="hm-row">${recent.slice(hero && recent[0] === hero ? 1 : 0, 9).map(miniCard).join("")}</div>
               </section>`
            : ""
        }
        <section class="hm-sec hm-stats">
          <button type="button" class="hm-stat" data-go="stats"><small>Esta semana</small><b>${week ? fmtPlaytime(week) : "—"}</b></button>
          <button type="button" class="hm-stat" data-go="stats"><small>En total</small><b>${total ? fmtPlaytime(total) : "—"}</b></button>
          <button type="button" class="hm-stat" data-go="completed"><small>Pasados</small><b>${completedGamesCache.length}</b></button>
          <button type="button" class="hm-stat" data-go="completed"><small>Platinos</small><b>${plats}</b></button>
          <button type="button" class="hm-stat" data-go="library"><small>En tu biblioteca</small><b>${libraryGamesCache.length}</b></button>
        </section>
        <section class="hm-sec hm-friends" hidden></section>
        <section class="hm-sec hm-free" hidden></section>
        <section class="hm-sec hm-reco" hidden></section>
      </div>`;

    if (hero) loadHeroArt(hero, my);
    renderFriends();
    loadFree(my);
    loadReco(my);
  }

  function heroHtml(g) {
    const live = playingNow.has(String(g.id));
    const meta = [live ? "Jugando ahora" : g.lastPlayed ? `Última vez ${playAgo(g.lastPlayed)}` : "Sin jugar todavía", g.playSecs > 0 ? `${fmtPlaytime(g.playSecs)} jugadas` : null]
      .filter(Boolean)
      .map(esc)
      .join(" · ");
    const action = g.notInstalled
      ? `<button type="button" class="sl-btn sl-btn-primary hm-play" data-download="${esc(g.id)}">${icon("download")}Descargar</button>`
      : canPlay(g)
        ? `<button type="button" class="sl-btn sl-btn-primary hm-play" data-play="${esc(g.id)}">${icon("play")}${live ? "Jugando" : "Jugar"}</button>`
        : "";
    return `
      <section class="hm-hero" data-open="${esc(g.id)}">
        <div class="hm-hero-bg" style="background-image:url('${esc(coverOf(g))}')"></div>
        <div class="hm-hero-shade"></div>
        <div class="hm-hero-body">
          <span class="hm-kicker">${g.lastPlayed || live ? "Continuar jugando" : "Para empezar"}</span>
          <h1 class="hm-title">${esc(g.name)}</h1>
          <p class="hm-meta">${meta}</p>
          <div class="hm-actions">
            ${action}
            <button type="button" class="sl-btn sl-btn-ghost hm-more" data-open="${esc(g.id)}">Ver página</button>
          </div>
        </div>
      </section>`;
  }

  function emptyHeroHtml() {
    return `
      <section class="hm-hero is-empty">
        <div class="hm-hero-body">
          <span class="hm-kicker">Bienvenido</span>
          <h1 class="hm-title">Todos tus juegos en un sitio</h1>
          <p class="hm-meta">Importa lo que tienes instalado o busca juegos en Descubrir.</p>
          <div class="hm-actions">
            <button type="button" class="sl-btn sl-btn-primary" data-import>${icon("download")}Importar instalados</button>
            <button type="button" class="sl-btn sl-btn-ghost" data-go="popular">Ir a Descubrir</button>
          </div>
        </div>
      </section>`;
  }

  // El arte grande de IGDB (si no hay, se queda la portada desenfocada)
  async function loadHeroArt(g, my) {
    let url = null;
    // Steam tiene un arte de biblioteca a lo ancho, pensado para esto
    if (g.steamAppId) url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steamAppId}/library_hero.jpg`;
    else {
      const id = igdbIdOf(g);
      if (!id) return;
      const m = await window.electronAPI.gameMedia({ igdbId: id }).catch(() => null);
      const art = m?.hero || m?.screenshots?.[0];
      if (!art || my !== seq) return;
      url = IMG("1080p", art);
    }
    const img = new Image();
    img.onload = () => {
      const bg = root.querySelector(".hm-hero-bg");
      if (!bg || my !== seq) return;
      bg.classList.add("is-art");
      bg.style.backgroundImage = `url('${url}')`;
    };
    img.src = url;
  }

  function miniCard(g) {
    const live = playingNow.has(String(g.id));
    return `
      <button type="button" class="hm-card" data-open="${esc(g.id)}" title="${esc(g.name)}">
        <span class="hm-card-art"><img src="${esc(coverOf(g))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=noCoverSvg('')"></span>
        <b>${esc(g.name)}</b>
        <small class="${live ? "is-live" : ""}">${live ? "Jugando ahora" : g.lastPlayed ? esc(cap(playAgo(g.lastPlayed))) : ""}</small>
      </button>`;
  }

  // Amigos jugando (community.js los tiene, desde la 4.1)
  function renderFriends() {
    const box = root.querySelector(".hm-friends");
    const list = (window.Community?.friendsNow?.() || []).filter((f) => f.online);
    if (!box) return;
    box.hidden = !list.length;
    if (!list.length) return;
    box.innerHTML = `
      <div class="hm-sec-head"><h2 class="hm-h">Tus amigos</h2><button type="button" class="cm-link" data-friends>Ver todos</button></div>
      <div class="hm-friends-row">${list
        .slice(0, 8)
        .map(
          (f) => `
        <button type="button" class="hm-friend" data-profile="${esc(f.username)}">
          ${window.Community.avatar(f.username, "is-md", f)}
          <span><b>${esc(f.username)}</b><small class="${f.playing ? "is-live" : ""}">${f.playing ? `Jugando a ${esc(f.playing.name)}` : "En línea"}</small></span>
        </button>`
        )
        .join("")}</div>`;
  }

  async function loadFree(my) {
    if (!freeCache || Date.now() - freeCache.at > 30 * 60 * 1000) {
      const r = await window.electronAPI.freeGames().catch(() => null);
      freeCache = { at: Date.now(), items: (r?.items || []).filter((x) => x.image) };
    }
    const box = root.querySelector(".hm-free");
    if (!box || my !== seq) return;
    const items = freeCache.items.slice(0, 4);
    box.hidden = !items.length;
    if (!items.length) return;
    box.innerHTML = `
      <div class="hm-sec-head"><h2 class="hm-h">Gratis ahora</h2><button type="button" class="cm-link" data-free>Ver todos</button></div>
      <div class="hm-free-row">${items
        .map(
          (x) => `
        <button type="button" class="hm-free-card" data-ext="${esc(x.url)}">
          <span class="hm-free-img"><img src="${esc(x.image)}" alt="" loading="lazy"></span>
          <span class="hm-free-text"><b>${esc(x.title)}</b><small>${storeLogo(x.store)}${esc(STORE_NAMES[x.store] || x.store)} · Gratis para quedártelo</small></span>
        </button>`
        )
        .join("")}</div>`;
  }

  // Recomendado: populares de tu género favorito que no tienes
  async function loadReco(my) {
    const count = new Map();
    for (const g of allGames()) for (const gen of g.genres || []) if (gen?.name) count.set(gen.name, (count.get(gen.name) || 0) + 1 + (g.playSecs > 3600 ? 2 : 0));
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!top) return;
    if (!recoCache || recoCache.key !== top || Date.now() - recoCache.at > 60 * 60 * 1000) {
      const genres = (await window.electronAPI.getGenres().catch(() => [])) || [];
      const gid = genres.find((x) => x.name === top)?.id;
      if (!gid) return;
      const res = await window.electronAPI.discoverGames({ query: "", genreId: gid, sort: "popular", offset: 0, pageSize: 40 }).catch(() => null);
      recoCache = { at: Date.now(), key: top, items: res?.items || [] };
    }
    const box = root.querySelector(".hm-reco");
    if (!box || my !== seq) return;
    const items = recoCache.items.filter((x) => !libraryIds.has(x.id)).slice(0, 8);
    box.hidden = !items.length;
    if (!items.length) return;
    // Para que la página del juego los encuentre
    for (const x of items) if (!gamesTemp.some((t) => t.id === x.id)) gamesTemp.push(x);
    box.innerHTML = `
      <div class="hm-sec-head"><h2 class="hm-h">Porque te gusta ${esc(top)}</h2><button type="button" class="cm-link" data-go="popular">Ir a Descubrir</button></div>
      <div class="hm-row">${items
        .map(
          (x) => `
        <button type="button" class="hm-card" data-open="${esc(x.id)}" title="${esc(x.name)}">
          <span class="hm-card-art"><img src="${esc(coverOf(x))}" alt="" loading="lazy"></span>
          <b>${esc(x.name)}</b>
          <small>${esc([releaseYear(x), x.total_rating_count >= 5 ? `${Math.round(x.total_rating)} en IGDB` : null].filter(Boolean).join(" · "))}</small>
        </button>`
        )
        .join("")}</div>`;
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    const play = t.closest("[data-play]");
    if (play) return launchGame(play.dataset.play);
    const dl = t.closest("[data-download]");
    if (dl) return downloadGame(dl.dataset.download);
    const go = t.closest("[data-go]");
    if (go) return showSection(go.dataset.go);
    if (t.closest("[data-import]")) return openImportModal();
    if (t.closest("[data-free]")) return window.FreeGames?.open();
    if (t.closest("[data-friends]")) return window.Community?.openCommunity?.("friends");
    const prof = t.closest("[data-profile]");
    if (prof) return window.Community?.openUserProfile?.(prof.dataset.profile);
    const ext = t.closest("[data-ext]");
    if (ext) return window.electronAPI.openExternal(ext.dataset.ext);
    const open = t.closest("[data-open]");
    if (open) return window.GamePage?.open(open.dataset.open);
  });

  const isActive = () => document.getElementById("home")?.classList.contains("active");
  window.Home = {
    onShow: render,
    refresh: () => isActive() && render(),
    refreshFriends: () => isActive() && renderFriends(),
  };
  if (isActive()) render();
})();
