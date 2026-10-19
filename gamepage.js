// =====================================================================
// Página del juego
// =====================================================================
// La misma página para cualquier juego (de la biblioteca, de pasados o de
// Descubrir); solo cambian los datos. Arriba la cabecera con el arte del
// juego y la barra de acciones (Jugar, marcar como pasado...), y debajo
// las pestañas:
//   Resumen     descripción, capturas y vídeos, duración, ficha y enlaces
//   Logros      los de Steam: tuyos (cuenta vinculada o archivos del PC)
//   Reseñas     la nota media, tu reseña (nota y comentario) y las demás
//   Mods        Nexus Mods y Steam Workshop (se abren en su web / en Steam)
//   Requisitos  mínimos y recomendados contra tu equipo
// Se abre al hacer clic en una tarjeta; Esc, el botón "atrás" del ratón o
// B en el mando vuelven a donde estabas.
//
// Usa de index.html: icon, escapeHtml, coverOf, openModal, confirmDialog,
// showNotification, showSection y las acciones de la biblioteca.
(() => {
  "use strict";

  const root = document.getElementById("gpRoot");
  if (!root) return;
  const esc = (s) => escapeHtml(String(s ?? ""));
  const IMG = (size, id) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;
  const nf = new Intl.NumberFormat("es-ES");
  const compact = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
  const dec = (n, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d).replace(".", ",");

  // Iconos que no están en index.html (mismo trazo que el resto)
  const EXTRA = {
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    puzzle: '<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>',
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    thumb: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  };
  const ic = (name, cls = "") =>
    EXTRA[name]
      ? `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA[name]}</svg>`
      : icon(name, cls);

  const starsHtml = (score, cls = "") =>
    `<span class="gp-stars ${cls}" aria-label="${dec(score)} de 5">${[1, 2, 3, 4, 5]
      .map((n) => `<i class="${score >= n - 0.25 ? "is-on" : score >= n - 0.75 ? "is-half" : ""}">${icon("star")}</i>`)
      .join("")}</span>`;

  // ------------------------------------------------------------ Estado
  let seq = 0;
  let st = null; // juego abierto
  let from = null; // de dónde se vino: { section, nav, scroll }

  const allOwned = () => [...libraryGamesCache, ...completedGamesCache];
  function findGame(id) {
    const sid = String(id);
    const owned = allOwned().find((g) => String(g.id) === sid);
    if (owned) return { game: owned, owned: true, done: completedGamesCache.some((g) => String(g.id) === sid) };
    const other =
      currentSearchGames.find((g) => String(g.id) === sid) || gamesTemp.find((g) => String(g.id) === sid) || (st && String(st.id) === sid ? st.game : null);
    return other ? { game: other, owned: false, done: false } : null;
  }

  const isActive = () => document.getElementById("game")?.classList.contains("active");
  const alive = (s) => s === seq && st && isActive();

  // ------------------------------------------------------------ Abrir / volver
  function open(id, opts = {}) {
    const found = findGame(id);
    if (!found) return showNotification("No se ha encontrado ese juego.", "error");
    const main = document.querySelector(".main-content");
    if (!isActive()) {
      from = { section: getActiveSectionId(), nav: document.querySelector(".topnav-item.active"), scroll: main?.scrollTop || 0 };
    }
    closeMenus();
    achView.revealed.clear();
    achView.showHidden = false;
    st = {
      id: String(found.game.id),
      ...found,
      tab: opts.tab || "overview",
      details: undefined,
      media: null,
      ach: null,
      reviews: null,
      community: null,
      igdbId: null,
      mods: { source: "nexus", sort: "popular", query: "", page: 0, data: null, items: [], loading: false },
      revPage: 0,
    };
    const s = ++seq;
    document.querySelectorAll(".section").forEach((x) => x.classList.toggle("active", x.id === "game"));
    document.body.classList.add("in-game");
    document.body.classList.remove("in-pokepark", "in-community");
    window.Community?.setVisible(false);
    main?.scrollTo(0, 0);
    document.getElementById("scrollTopBtn")?.classList.remove("show");
    render();
    load(s);
  }

  function back() {
    const f = from;
    from = null;
    const navs = [...document.querySelectorAll(".topnav-item")];
    const section = f?.section && f.section !== "game" ? f.section : "library";
    showSection(section, f?.nav || navs[1]);
    if (f?.scroll) requestAnimationFrame(() => document.querySelector(".main-content")?.scrollTo(0, f.scroll));
  }

  function onLeave() {
    document.body.classList.remove("in-game");
    closeMenus();
    closeLightbox();
  }

  // Tras cualquier cambio en la biblioteca (jugar, pasarlo, platino...)
  function refresh() {
    if (!st || !isActive()) return;
    const found = findGame(st.id);
    if (found) Object.assign(st, found);
    else st.owned = st.done = false;
    paintHead();
    paintBar();
    if (st.tab === "overview") paintAsidePlay();
    if (st.tab === "reviews") paintReviews();
    if (st.tab === "achievements") paintTab();
  }

  function refreshPlay() {
    if (!st || !isActive()) return;
    paintBar();
    paintAsidePlay();
  }

  // ------------------------------------------------------------ Carga
  async function load(s) {
    const g = st.game;
    // Ficha de IGDB (los importados se buscan por nombre)
    const details = await window.electronAPI.getGameDetails({ id: g.id, name: g.name }).catch(() => null);
    if (!alive(s)) return;
    st.details = details || null;
    st.igdbId = details?.id || g.igdbId || (!st.owned ? Number(g.id) : null) || null;
    paintHead();
    paintBar();
    if (st.tab === "overview") paintTab();

    const igdbId = st.igdbId;
    // En paralelo: capturas, la nota de la gente y los logros
    window.electronAPI
      .gameMedia({ igdbId })
      .then((m) => {
        if (!alive(s)) return;
        st.media = m || { screenshots: [], artworks: [], videos: [], links: [] };
        paintHero();
        if (st.tab === "overview") paintTab();
      })
      .catch(() => {});
    window.Community?.avgOf?.(igdbId)
      .then((r) => {
        if (!alive(s)) return;
        st.community = r || null;
        paintBar();
        paintTabs();
        if (st.tab === "reviews" && st.reviews?.legacy) paintReviews();
      })
      .catch(() => {});
    loadAchievements(s);
    if (st.tab !== "overview") paintTab();
  }

  async function loadAchievements(s, force) {
    if (st.ach && !force) return;
    const g = st.game;
    const r = await window.electronAPI
      .gameAchievements({ id: g.id, name: g.name, igdbId: st.igdbId })
      .catch(() => ({ ok: false, reason: "network" }));
    if (!alive(s)) return;
    st.ach = r;
    paintBar();
    paintTabs();
    if (st.tab === "achievements") paintTab();
    autoPlatinum();
  }

  // Todos los logros conseguidos: platino (y a pasados) sin tener que
  // marcarlo. Si lo quitaste tú a mano, no se vuelve a poner.
  async function autoPlatinum() {
    const a = st?.ach;
    const g = st?.game;
    if (!a?.ok || !a.total || a.unlocked < a.total || !st.owned || g.isPlatinum || g.platinumOff) return;
    const done = await window.electronAPI.setPlatinum(g.id, "auto").catch(() => false);
    if (!done) return;
    showNotification(`¡Platino! Tienes los ${a.total} logros de ${g.name}.`);
    await loadLibrary();
  }

  // Platino que llega del proceso principal (lo completaste jugando)
  window.electronAPI.onPlatinum?.(async (g) => {
    showNotification(`¡Platino! Tienes todos los logros de ${g.name}.`);
    await loadLibrary();
  });

  // ------------------------------------------------------------ Pintar: esqueleto
  const TABS = [
    { id: "overview", name: "Resumen" },
    { id: "achievements", name: "Logros" },
    { id: "reviews", name: "Reseñas" },
    { id: "mods", name: "Mods" },
    { id: "reqs", name: "Requisitos" },
  ];

  function render() {
    const g = st.game;
    const backTo = { popular: "Descubrir", library: "Biblioteca", completed: "Pasados", community: "Comunidad", pokepark: "PokéPark" }[from?.section] || "Biblioteca";
    root.innerHTML = `
      <article class="gp" data-game="${esc(st.id)}">
        <header class="gp-hero">
          <div class="gp-hero-bg is-cover" style="background-image:url('${esc(coverOf(g))}')"></div>
          <div class="gp-hero-shade"></div>
          <button type="button" class="gp-back" data-act="back">${icon("arrowLeft")}<span>${esc(backTo)}</span></button>
          <div class="gp-hero-content">
            <div class="gp-cover"><img src="${esc(coverOf(g))}" alt="${esc(g.name)}" onerror="this.onerror=null;this.src=noCoverSvg(this.alt)"></div>
            <div class="gp-head"></div>
          </div>
        </header>
        <div class="gp-bar"></div>
        <nav class="gp-tabs" role="tablist"></nav>
        <div class="gp-body"></div>
      </article>`;
    paintHead();
    paintBar();
    paintTabs();
    paintTab();
  }

  function paintHero() {
    const bg = root.querySelector(".gp-hero-bg");
    const m = st.media;
    const art = m?.hero || m?.screenshots?.[0];
    if (!bg || !art) return;
    const url = IMG("1080p", art);
    const img = new Image();
    img.onload = () => {
      if (!bg.isConnected) return;
      const next = document.createElement("div");
      next.className = "gp-hero-bg is-art";
      next.style.backgroundImage = `url('${url}')`;
      bg.after(next);
      requestAnimationFrame(() => next.classList.add("is-in"));
    };
    img.src = url;
  }

  function paintHead() {
    const head = root.querySelector(".gp-head");
    if (!head) return;
    const g = st.game;
    const d = st.details;
    const year = d?.first_release_date ? new Date(d.first_release_date * 1000).getFullYear() : releaseYear(g);
    const devs = [...new Set((d?.involved_companies || []).filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean))];
    const genres = (d?.genres || g.genres || []).map((x) => x.name).filter(Boolean);
    const sub = [year, devs.slice(0, 2).join(", ")].filter(Boolean).map((x) => esc(x));
    const tags = [];
    if (st.done) tags.push(g.isPlatinum ? `<span class="gp-tag is-gold">${icon("crown")}Platinado</span>` : `<span class="gp-tag is-ok">${icon("check")}Pasado</span>`);
    else if (st.owned) tags.push(`<span class="gp-tag">${icon("grid")}En tu biblioteca</span>`);
    if (st.owned && g.notInstalled) tags.push(`<span class="gp-tag is-muted">${icon("download")}Sin instalar</span>`);
    if (st.owned && STORE_NAMES[g.platform]) tags.push(`<span class="gp-tag is-store">${storeLogo(g.platform)}${STORE_NAMES[g.platform]}</span>`);
    if (playingNow.has(st.id)) tags.push(`<span class="gp-tag is-live"><i></i>Jugando ahora</span>`);
    head.innerHTML = `
      ${tags.length ? `<div class="gp-tags">${tags.join("")}</div>` : ""}
      <h1 class="gp-title">${esc(g.name)}</h1>
      ${sub.length ? `<p class="gp-sub">${sub.join('<span class="gp-dot">·</span>')}</p>` : d === undefined ? `<p class="gp-sub gp-shimmer">&nbsp;</p>` : ""}
      ${genres.length ? `<div class="gp-genres">${genres.slice(0, 4).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}`;
  }

  // ------------------------------------------------------------ Barra de acciones
  function primaryHtml() {
    const g = st.game;
    const id = esc(st.id);
    if (!st.owned) return `<button type="button" class="sl-btn sl-btn-primary gp-primary" data-act="add">${icon("plus")}<span>Añadir a la biblioteca</span></button>`;
    if (g.notInstalled)
      return `<button type="button" class="sl-btn sl-btn-primary gp-primary dl-btn${downloads.has(st.id) ? " is-busy" : ""}" data-dl="${id}" data-act="download">${icon("download")}<span>${esc(downloadLabel(st.id))}</span></button>`;
    if (canPlay(g)) {
      const live = playingNow.has(st.id);
      return `<button type="button" class="sl-btn sl-btn-primary gp-primary gp-play${live ? " is-live" : ""}" data-act="play">${icon("play")}<span>${live ? "Jugando" : "Jugar"}</span></button>`;
    }
    return `<button type="button" class="sl-btn sl-btn-primary gp-primary" data-act="link">${icon("link")}<span>Vincular ejecutable</span></button>`;
  }

  function statTiles() {
    const g = st.game;
    const tiles = [];
    if (st.owned) {
      const live = playingNow.has(st.id);
      tiles.push(["Tiempo jugado", g.playSecs > 0 ? fmtPlaytime(g.playSecs) : canTrack(g) ? "Sin jugar" : "—", "clock"]);
      tiles.push(["Última vez", live ? "Ahora mismo" : g.lastPlayed ? cap(playAgo(g.lastPlayed)) : "—", "calendar"]);
    } else {
      const d = st.details;
      const y = d?.first_release_date ? new Date(d.first_release_date * 1000).getFullYear() : releaseYear(g);
      tiles.push(["Lanzamiento", y || "—", "calendar"]);
    }
    const a = st.ach;
    const achText = !a ? "…" : a.ok && a.total ? (a.steamData || a.emus?.length || a.unlocked ? `${a.unlocked} / ${a.total}` : `${a.total}`) : "—";
    tiles.push(["Logros", achText, "trophy", "achievements"]);
    const c = st.community;
    const d = st.details;
    const rating = c?.count ? `${dec(c.avg)} ${icon("star")}` : d?.total_rating_count >= 5 ? `${Math.round(d.total_rating)}<small>/100</small>` : "—";
    tiles.push([c?.count ? `Nota (${c.count})` : "Nota IGDB", rating, "star", "reviews"]);
    return tiles
      .map(
        ([k, v, ico, tab]) =>
          `<${tab ? `button type="button" data-tab="${tab}"` : "div"} class="gp-stat">${ic(ico)}<span><small>${k}</small><b>${v}</b></span></${tab ? "button" : "div"}>`
      )
      .join("");
  }

  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

  function paintBar() {
    const bar = root.querySelector(".gp-bar");
    if (!bar || !st) return;
    const g = st.game;
    const second = !st.owned
      ? ""
      : st.done
        ? `<button type="button" class="sl-btn sl-btn-ghost" data-act="platinum">${icon("crown")}${g.isPlatinum ? "Quitar platino" : "Marcar platino"}</button>`
        : `<button type="button" class="sl-btn sl-btn-ghost" data-act="complete">${icon("check")}Marcar como pasado</button>`;
    bar.innerHTML = `
      <div class="gp-actions">
        ${primaryHtml()}
        ${second}
        ${st.owned ? `<div class="gp-more"><button type="button" class="sl-btn sl-btn-ghost gp-more-btn" data-act="menu" aria-label="Más opciones" title="Más opciones">${icon("more")}</button><div class="gp-menu" hidden>${menuHtml()}</div></div>` : ""}
      </div>
      <div class="gp-stats">${statTiles()}</div>`;
  }

  function menuHtml() {
    const g = st.game;
    const saga = sagaForGame(st.id);
    const items = [];
    items.push(saga ? ["saga-out", "layers", `Quitar de "${saga.name}"`] : ["saga-in", "layers", "Añadir a una saga"]);
    if (g.executable) items.push(["unlink", "link", "Desvincular ejecutable"]);
    else if (!g.notInstalled) items.push(["link", "link", "Vincular ejecutable"]);
    if (st.done) items.push(["return", "arrowUp", "Volver a la biblioteca"]);
    else items.push(["sortkey", "pencil", "Nombre para ordenar"]);
    items.push(["remove", "trash", st.done ? "Quitar de pasados" : "Quitar de la biblioteca", true]);
    return items
      .map(([act, ico, label, danger]) => `<button type="button" class="gp-menu-item${danger ? " is-danger" : ""}${act.startsWith("saga") ? " needs-account" : ""}" data-act="${act}">${icon(ico)}${esc(label)}</button>`)
      .join("");
  }

  function closeMenus() {
    root.querySelectorAll(".gp-menu").forEach((m) => (m.hidden = true));
  }

  function paintTabs() {
    const nav = root.querySelector(".gp-tabs");
    if (!nav || !st) return;
    const a = st.ach;
    const count = {
      achievements: a?.ok && a.total ? (a.unlocked ? `${a.unlocked}/${a.total}` : a.total) : "",
      reviews: (st.reviews?.legacy ? st.community?.count : st.reviews?.count) ?? st.community?.count ?? "",
      mods: st.mods.data?.nexusGame ? compact.format(st.mods.data.nexusGame.modCount) : "",
    };
    nav.innerHTML = TABS.map(
      (t) =>
        `<button type="button" role="tab" class="gp-tab${t.id === st.tab ? " is-active" : ""}" data-tab="${t.id}" aria-selected="${t.id === st.tab}">${t.name}${
          count[t.id] !== "" && count[t.id] != null ? `<em>${esc(count[t.id])}</em>` : ""
        }</button>`
    ).join("");
  }

  function switchTab(t) {
    if (!st || st.tab === t) return;
    st.tab = t;
    paintTabs();
    paintTab();
    const tabs = root.querySelector(".gp-tabs");
    const main = document.querySelector(".main-content");
    if (tabs && main && tabs.getBoundingClientRect().top < main.getBoundingClientRect().top) tabs.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function paintTab() {
    const body = root.querySelector(".gp-body");
    if (!body || !st) return;
    body.dataset.view = st.tab;
    if (st.tab === "overview") paintOverview(body);
    else if (st.tab === "achievements") paintAchievements(body);
    else if (st.tab === "reviews") paintReviews();
    else if (st.tab === "mods") paintMods(body);
    else paintReqs(body);
  }

  const loadingHtml = (text) => `<div class="gp-loading"><span class="sl-spinner"></span><p>${esc(text)}</p></div>`;
  const emptyHtml = (ico, title, text = "", extra = "") =>
    `<div class="gp-empty"><span class="gp-empty-icon">${ic(ico)}</span><p class="gp-empty-title">${esc(title)}</p>${text ? `<p class="gp-empty-text">${text}</p>` : ""}${extra}</div>`;

  // ------------------------------------------------------------ Resumen
  function paintOverview(body) {
    const g = st.game;
    const d = st.details;
    const m = st.media;
    if (d === undefined) {
      body.innerHTML = loadingHtml("Cargando la ficha…");
      return;
    }
    const year = d?.first_release_date ? new Date(d.first_release_date * 1000) : null;
    const devs = [...new Set((d?.involved_companies || []).filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean))];
    const pubs = [...new Set((d?.involved_companies || []).filter((c) => c.publisher).map((c) => c.company?.name).filter(Boolean))];
    const facts = [
      year ? ["Lanzamiento", year.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })] : null,
      devs.length ? [devs.length > 1 ? "Desarrolladores" : "Desarrollador", devs.slice(0, 3).join(", ")] : null,
      pubs.length ? [pubs.length > 1 ? "Editores" : "Editor", pubs.slice(0, 3).join(", ")] : null,
      d?.genres?.length ? ["Géneros", d.genres.map((x) => x.name).join(", ")] : null,
      d?.game_modes?.length ? ["Modos", d.game_modes.map((x) => x.name).join(", ")] : null,
      d?.platforms?.length ? ["Plataformas", d.platforms.map((p) => p.abbreviation).filter(Boolean).slice(0, 8).join(" · ")] : null,
    ].filter(Boolean);

    const shots = m ? [...m.screenshots.map((id) => ({ id, kind: "shot" })), ...m.artworks.map((id) => ({ id, kind: "art" }))] : [];
    const vids = m?.videos || [];
    const mediaHtml = !m
      ? `<div class="gp-media is-loading">${'<span class="gp-shimmer"></span>'.repeat(4)}</div>`
      : shots.length || vids.length
        ? `<div class="gp-media">${shots
            .slice(0, 6)
            .map((x, i) => `<button type="button" class="gp-shot" data-shot="${i}" aria-label="Ver captura ${i + 1}"><img src="${IMG("screenshot_big", x.id)}" alt="" loading="lazy"></button>`)
            .join("")}${vids
            .slice(0, 3)
            .map(
              (v) =>
                `<button type="button" class="gp-shot is-video" data-video="${esc(v.id)}" title="${esc(v.name)}"><img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy"><span class="gp-play-badge">${icon("play")}</span><span class="gp-video-name">${esc(v.name)}</span></button>`
            )
            .join("")}</div>${shots.length > 6 ? `<button type="button" class="cm-link gp-more-shots" data-shot="6">Ver las ${shots.length} imágenes</button>` : ""}`
        : `<p class="gp-muted">No hay capturas de este juego.</p>`;

    const summary = d?.summary || g.summary || "";
    const story = m?.storyline || "";
    const played = st.owned ? g.playSecs : 0;
    const saga = st.owned ? sagaForGame(st.id) : null;
    const sagaGames = saga ? saga.gameIds.map((gid) => allOwned().find((x) => Number(x.id) === Number(gid))).filter(Boolean) : [];

    body.innerHTML = `
      <div class="gp-cols">
        <div class="gp-main">
          <section class="gp-sec">
            <h2 class="gp-h">Acerca del juego</h2>
            ${summary ? `<p class="gp-summary">${esc(summary)}</p>` : `<p class="gp-muted">No hay descripción de este juego.</p>`}
            ${story ? `<details class="gp-story"><summary>Historia</summary><p>${esc(story)}</p></details>` : ""}
          </section>
          <section class="gp-sec">
            <h2 class="gp-h">Capturas y vídeos</h2>
            ${mediaHtml}
          </section>
          <section class="gp-sec">
            <h2 class="gp-h">Duración</h2>
            <div class="info-hltb" data-hltb>${hltbHtml(null, played)}</div>
          </section>
        </div>
        <aside class="gp-aside">
          <div class="gp-play-card"></div>
          ${facts.length ? `<div class="gp-card"><h3 class="gp-card-title">Ficha</h3><dl class="gp-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>` : ""}
          ${
            sagaGames.length > 1
              ? `<div class="gp-card"><h3 class="gp-card-title">${icon("layers")}${esc(saga.name)}</h3><div class="gp-saga">${sagaGames
                  .map(
                    (x, i) =>
                      `<button type="button" class="gp-saga-item${String(x.id) === st.id ? " is-current" : ""}" data-open="${esc(x.id)}"><span>${i + 1}</span><img src="${esc(coverOf(x))}" alt="" loading="lazy"><b>${esc(x.name)}</b></button>`
                  )
                  .join("")}</div></div>`
              : ""
          }
          ${
            m?.links?.length
              ? `<div class="gp-card"><h3 class="gp-card-title">Enlaces</h3><div class="gp-links">${m.links
                  .map((l) => `<button type="button" class="gp-link" data-ext="${esc(l.url)}">${l.kind === "steam" ? storeLogo("steam") : l.kind === "gog" ? storeLogo("gog") : l.kind === "epic" ? storeLogo("epic") : icon("globe")}<span>${esc(l.label)}</span>${icon("external", "gp-link-ext")}</button>`)
                  .join("")}</div></div>`
              : ""
          }
          <p class="gp-source">Ficha y capturas: IGDB</p>
        </aside>
      </div>`;
    paintAsidePlay();
    fillHltb(body);
  }

  function paintAsidePlay() {
    const box = root.querySelector(".gp-play-card");
    if (!box || !st) return;
    if (!st.owned) {
      box.innerHTML = "";
      return;
    }
    const html = infoPlayHtml(st.game);
    box.innerHTML = html ? `<div class="gp-card">${html}</div>` : "";
  }

  async function fillHltb(body) {
    const s = seq;
    const g = st.game;
    const d = st.details;
    const year = d?.first_release_date ? new Date(d.first_release_date * 1000).getFullYear() : releaseYear(g);
    const r = await window.electronAPI.hltb({ name: d?.name || g.name, year, igdbId: st.igdbId }).catch(() => null);
    if (!alive(s) || st.tab !== "overview") return;
    const el = body.querySelector("[data-hltb]");
    if (el) el.innerHTML = hltbHtml(r || false, st.owned ? g.playSecs : 0);
  }

  // ------------------------------------------------------------ Lightbox
  let lb = null;
  function openLightbox(index) {
    const m = st?.media;
    if (!m) return;
    const list = [...m.screenshots, ...m.artworks];
    if (!list.length) return;
    closeLightbox();
    let i = Math.max(0, Math.min(list.length - 1, index));
    lb = document.createElement("div");
    lb.className = "gp-lightbox";
    lb.innerHTML = `
      <button type="button" class="gp-lb-close" aria-label="Cerrar">${icon("x")}</button>
      <button type="button" class="gp-lb-nav is-prev" aria-label="Anterior">${ic("chevL")}</button>
      <figure><img alt=""><figcaption></figcaption></figure>
      <button type="button" class="gp-lb-nav is-next" aria-label="Siguiente">${ic("chevR")}</button>`;
    const img = lb.querySelector("img");
    const cap = lb.querySelector("figcaption");
    const show = () => {
      img.src = IMG("1080p", list[i]);
      cap.textContent = `${i + 1} / ${list.length}`;
    };
    lb.addEventListener("click", (e) => {
      if (e.target.closest(".is-prev")) i = (i - 1 + list.length) % list.length;
      else if (e.target.closest(".is-next")) i = (i + 1) % list.length;
      else if (e.target.closest("img")) return;
      else return closeLightbox();
      show();
    });
    lb._key = (e) => {
      if (e.key === "ArrowLeft") (i = (i - 1 + list.length) % list.length), show();
      else if (e.key === "ArrowRight") (i = (i + 1) % list.length), show();
      else if (e.key === "Escape") closeLightbox();
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener("keydown", lb._key, true);
    document.body.appendChild(lb);
    show();
    requestAnimationFrame(() => lb?.classList.add("is-open"));
  }

  function closeLightbox() {
    if (!lb) return;
    document.removeEventListener("keydown", lb._key, true);
    lb.remove();
    lb = null;
  }

  // ------------------------------------------------------------ Logros
  // revealed: logros ocultos destapados con un clic (como en Steam)
  const achView = { filter: "all", sort: "default", revealed: new Set(), showHidden: false };

  function paintAchievements(body) {
    const a = st.ach;
    if (!a) {
      body.innerHTML = loadingHtml("Buscando los logros en Steam…");
      return;
    }
    if (!a.ok) {
      body.innerHTML =
        a.reason === "no_steam"
          ? emptyHtml("trophy", "Sin logros de Steam", "No hemos encontrado este juego en Steam, así que no hay lista de logros que enseñar.")
          : a.reason === "no_key"
            ? emptyHtml("trophy", "Falta la clave de Steam", "Esta versión del launcher no lleva la clave de la Web API de Steam.")
            : emptyHtml("alert", "No se han podido cargar los logros", "Revisa tu conexión.", `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="ach-retry">${icon("refresh")}Reintentar</button>`);
      return;
    }
    if (!a.total) {
      body.innerHTML = emptyHtml("trophy", "Este juego no tiene logros", "En Steam no tiene ninguno.");
      return;
    }
    const known = a.steamData || a.emus?.length || a.unlocked > 0;
    const pct = Math.round((a.unlocked / a.total) * 100);
    let src;
    if (a.steamData && a.emus?.length) src = `Tus logros de Steam y los de este PC (${esc(a.emus.join(", "))}).`;
    else if (a.steamData) src = "Sincronizado con tu cuenta de Steam.";
    else if (a.emus?.length) src = `Leídos de los archivos del juego en este PC (${esc(a.emus.join(", "))}). Se avisan solos mientras juegas.`;
    else if (!a.steamLinked)
      src = `¿Lo juegas en Steam? <button type="button" class="cm-link" data-act="link-steam">Vincula tu cuenta</button> para ver los que tienes. Si no, aparecerán al conseguirlos jugando.`;
    else src = "Steam no deja ver tus logros de este juego: no lo tienes en esa cuenta o tu perfil es privado. Los que consigas jugando en este PC aparecerán aquí.";

    let list = a.list.slice();
    if (achView.filter === "got") list = list.filter((x) => x.unlocked);
    if (achView.filter === "todo") list = list.filter((x) => !x.unlocked);
    if (achView.sort === "rare") list.sort((x, y) => (x.percent ?? 101) - (y.percent ?? 101));
    if (achView.sort === "recent") list.sort((x, y) => (y.unlockedAt || 0) - (x.unlockedAt || 0));

    const secretLeft = a.list.filter((x) => x.hidden && !x.unlocked).length;
    const rarity = (p) => (p == null ? "" : p < 1 ? `<span class="gp-rarity is-ultra">Ultra raro</span>` : p < 5 ? `<span class="gp-rarity">Raro</span>` : "");
    body.innerHTML = `
      <div class="gp-ach-head">
        <div class="gp-ach-progress">
          <div class="gp-ach-count">${known ? `<b>${a.unlocked}</b><span>de ${a.total}</span>` : `<b>${a.total}</b><span>logros</span>`}</div>
          ${known ? `<div class="gp-ach-bar"><i style="width:${pct}%"></i></div><span class="gp-ach-pct">${pct} %</span>` : ""}
        </div>
        <p class="gp-ach-src">${src}</p>
        <div class="gp-ach-tools">
          <div class="gp-seg" data-group="ach-filter">
            ${[["all", "Todos"], ["got", "Conseguidos"], ["todo", "Pendientes"]].map(([k, l]) => `<button type="button" class="${achView.filter === k ? "is-active" : ""}" data-ach-filter="${k}">${l}</button>`).join("")}
          </div>
          ${
            secretLeft
              ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm gp-ach-reveal" data-act="ach-hidden">${ic(achView.showHidden ? "eyeOff" : "eye")}${
                  achView.showHidden ? "Ocultar" : "Mostrar"
                } ${secretLeft} ${secretLeft === 1 ? "oculto" : "ocultos"}</button>`
              : ""
          }
          <select class="gp-select" data-ach-sort aria-label="Ordenar logros">
            <option value="default"${achView.sort === "default" ? " selected" : ""}>Orden del juego</option>
            <option value="rare"${achView.sort === "rare" ? " selected" : ""}>Más raros primero</option>
            <option value="recent"${achView.sort === "recent" ? " selected" : ""}>Últimos conseguidos</option>
          </select>
        </div>
      </div>
      <div class="gp-ach-list">
        ${
          list.length
            ? list
                .map((x) => {
                  const hid = x.hidden && !x.unlocked;
                  const shown = !hid || achView.showHidden || achView.revealed.has(x.name);
                  return `
            <div class="gp-ach${x.unlocked ? " is-on" : ""}${hid ? (shown ? " is-secret is-revealed" : " is-secret") : ""}"${
                    hid ? ` data-reveal="${esc(x.name)}" role="button" tabindex="0" title="${shown ? "Clic para volver a ocultarlo" : "Clic para ver el logro oculto"}"` : ""
                  }>
              ${shown ? `<img src="${esc(x.unlocked ? x.icon : x.iconGray)}" alt="" loading="lazy">` : `<span class="gp-ach-mystery">${ic("eyeOff")}</span>`}
              <div class="gp-ach-text">
                <b>${shown ? esc(x.title) : "Logro oculto"}${shown ? rarity(x.percent) : ""}</b>
                <p>${shown ? `${hid ? `<em class="gp-ach-spoiler">Oculto</em>` : ""}${esc(x.desc || "")}` : "Sus detalles se revelan al conseguirlo. Haz clic para verlo ya."}</p>
              </div>
              <div class="gp-ach-meta">
                ${x.unlocked ? `<span class="gp-ach-date">${icon("check")}${x.unlockedAt ? new Date(x.unlockedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "Conseguido"}</span>` : `<span class="gp-ach-lock">${ic("lock")}</span>`}
                ${x.percent != null ? `<span class="gp-ach-global" title="Jugadores de Steam que lo tienen"><i style="--w:${Math.max(2, Math.min(100, x.percent))}%"></i><em>${dec(x.percent)} %</em></span>` : ""}
              </div>
            </div>`;
                })
                .join("")
            : `<p class="gp-muted gp-pad">${achView.filter === "got" ? "Todavía no tienes ninguno." : "¡Los tienes todos!"}</p>`
        }
      </div>
      ${manualPlatinumHtml(a, known)}
      <p class="gp-source">Lista y porcentajes: Steam</p>`;
  }

  // Platino a mano, plegado y al final: para copias que no guardan los
  // logros donde el launcher los busca. Escondido a propósito, para que
  // primero se intente de verdad.
  function manualPlatinumHtml(a, known) {
    const g = st.game;
    if (!st.owned) return "";
    if (g.isPlatinum)
      return `<p class="gp-ach-plat">${icon("crown")}${g.platinumBy === "manual" ? "Platino marcado a mano." : a.unlocked >= a.total ? "¡Platino! Los tienes todos." : "Platinado."}</p>`;
    if (known && a.unlocked >= a.total) return "";
    return `
      <details class="gp-ach-manual">
        <summary>¿Ya los tienes todos y no se registran?</summary>
        <div>
          <p>Si tu copia del juego no guarda los logros donde el launcher sabe leerlos, puedes marcar el platino tú. Solo si de verdad los has conseguido todos.</p>
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="plat-manual">${icon("crown")}Marcar como platino</button>
        </div>
      </details>`;
  }

  // Aviso al desbloquear (archivos del emulador, mientras juegas)
  window.electronAPI.onAchievementUnlocked?.((a) => {
    const t = document.createElement("div");
    t.className = "ach-toast";
    t.innerHTML = `${a.icon ? `<img src="${esc(a.icon)}" alt="">` : `<span class="ach-toast-ico">${icon("trophy")}</span>`}<div><small>Logro desbloqueado · ${esc(a.gameName)}</small><b>${esc(a.title)}</b>${a.desc ? `<p>${esc(a.desc)}</p>` : ""}</div>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("is-in"));
    setTimeout(() => {
      t.classList.remove("is-in");
      setTimeout(() => t.remove(), 500);
    }, 6000);
    if (st && String(a.gameId) === st.id) loadAchievements(seq, true);
  });

  // ------------------------------------------------------------ Reseñas
  // La nota va por el id de IGDB (los importados lo buscan y lo guardan).
  async function ratingIdOf() {
    if (!st.owned) return st.igdbId || null;
    const id = await window.electronAPI.ratingId(st.game.id).catch(() => null);
    if (id) st.igdbId = st.igdbId || id;
    return id;
  }

  let draft = null; // { score, comment } mientras escribes
  async function loadReviews(s, offset = 0) {
    const id = await ratingIdOf();
    if (!alive(s)) return;
    if (!id) {
      st.reviews = { error: "no_id" };
      return paintReviews();
    }
    const res = await window.electronAPI.cloud("reviews", id, offset).catch(() => ({ ok: false }));
    if (!alive(s)) return;
    if (!res.ok) {
      // Servidor sin reseñas todavía: al menos la media
      st.reviews = { legacy: true, gameId: id, avg: st.community?.avg ?? null, count: st.community?.count || 0, distribution: null, reviews: [], mine: null };
    } else if (offset && st.reviews?.reviews) {
      st.reviews.reviews.push(...res.reviews);
      st.reviews.more = res.reviews.length === 30;
    } else {
      st.reviews = { ...res, gameId: id, more: res.reviews.length === 30 };
    }
    if (!offset) draft = null;
    paintTabs();
    paintReviews();
  }

  function paintReviews() {
    const body = root.querySelector(".gp-body");
    if (!body || st.tab !== "reviews") return;
    const r = st.reviews;
    if (!r) {
      body.innerHTML = loadingHtml("Cargando reseñas…");
      loadReviews(seq);
      return;
    }
    if (r.error === "no_id") {
      body.innerHTML = emptyHtml("star", "No se puede reseñar", "No hemos encontrado este juego en el catálogo.");
      return;
    }
    const me = window.Community?.user?.();
    // Servidor sin reseñas: la media que haya (puede llegar después)
    if (r.legacy && st.community) {
      r.avg = st.community.avg;
      r.count = st.community.count;
    }
    const dist = r.distribution || {};
    const max = Math.max(1, ...Object.values(dist));
    const summary = `
      <div class="gp-rev-sum">
        <div class="gp-rev-avg">
          ${r.avg != null ? `<b>${dec(r.avg)}</b>` : `<b class="is-none">Sin nota</b>`}
          ${starsHtml(r.avg || 0, "is-lg")}
          <span>${r.count ? `${nf.format(r.count)} ${r.count === 1 ? "valoración" : "valoraciones"}` : "Sin valoraciones todavía"}</span>
        </div>
        ${
          r.distribution
            ? `<div class="gp-rev-dist">${[5, 4, 3, 2, 1]
                .map((n) => `<div><span>${n}${icon("star")}</span><i><em style="width:${Math.round(((dist[n] || 0) / max) * 100)}%"></em></i><small>${dist[n] || 0}</small></div>`)
                .join("")}</div>`
            : ""
        }
      </div>`;

    let mine;
    if (!me) {
      mine = `<div class="gp-card gp-rev-mine is-locked">${icon("user")}<p>Inicia sesión para puntuar este juego y dejar tu opinión.</p><button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-act="login">Entrar</button></div>`;
    } else if (!st.done) {
      mine = `<div class="gp-card gp-rev-mine is-locked">${icon("trophy")}<p>Podrás reseñarlo cuando lo tengas en <b>Juegos pasados</b>.</p>${
        st.owned ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="complete">${icon("check")}Marcar como pasado</button>` : ""
      }</div>`;
    } else {
      const saved = r.mine || (r.legacy ? { score: window.Community?.myRating?.(r.gameId) || 0, comment: "" } : null);
      draft ||= { score: saved?.score || 0, comment: saved?.comment || "" };
      mine = `
        <div class="gp-card gp-rev-mine">
          <div class="gp-rev-mine-head">
            ${window.Community?.avatar(me.username, "is-md", me) || ""}
            <div><b>Tu reseña</b><small>${saved?.score ? `Publicada${saved.updatedAt ? ` · ${new Date(saved.updatedAt).toLocaleDateString("es-ES")}` : ""}` : "Aún no lo has puntuado"}</small></div>
          </div>
          <div class="gp-rate" role="radiogroup" aria-label="Tu nota">${[1, 2, 3, 4, 5]
            .map((n) => `<button type="button" class="gp-rate-star${n <= draft.score ? " is-on" : ""}" data-rate="${n}" aria-label="${n} de 5">${icon("star")}</button>`)
            .join("")}<span class="gp-rate-label">${["Elige tu nota", "Malo", "Flojo", "Está bien", "Muy bueno", "Imprescindible"][draft.score]}</span></div>
          <textarea class="gp-rev-text" maxlength="2000" rows="3" placeholder="¿Qué te ha parecido? (opcional)">${esc(draft.comment)}</textarea>
          <div class="gp-rev-actions">
            <small class="gp-rev-left">${r.legacy ? "El servidor aún no guarda comentarios: de momento solo se publica la nota." : `${2000 - draft.comment.length} caracteres`}</small>
            ${saved?.score ? `<button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-act="rev-delete">${icon("trash")}Borrar</button>` : ""}
            <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-act="rev-save" ${draft.score ? "" : "disabled"}>${saved?.score ? "Guardar cambios" : "Publicar"}</button>
          </div>
        </div>`;
    }

    const others = (r.reviews || []).filter((x) => !me || x.userId !== me.id);
    const list = others.length
      ? others
          .map(
            (x) => `
        <article class="gp-rev">
          ${window.Community?.avatar(x.author, "", { id: x.userId, avatarV: x.avatarV }) || ""}
          <div class="gp-rev-main">
            <p class="gp-rev-head"><b>${esc(x.author)}</b>${x.admin ? `<span class="cm-admin">${icon("crown")}Admin</span>` : ""}${starsHtml(x.score)}<time>${x.updatedAt ? new Date(x.updatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : ""}</time></p>
            ${x.comment ? `<p class="gp-rev-body">${esc(x.comment).replace(/\n/g, "<br>")}</p>` : `<p class="gp-rev-body is-empty">Solo ha puntuado.</p>`}
          </div>
          ${me?.admin && x.comment ? `<button type="button" class="icon-btn gp-rev-mod" data-act="rev-moderate" data-user="${x.userId}" title="Quitar comentario">${icon("trash")}</button>` : ""}
        </article>`
          )
          .join("")
      : `<p class="gp-muted gp-pad">${r.legacy ? "Las reseñas de la gente se verán aquí cuando se actualice el servidor." : "Nadie más ha reseñado este juego todavía."}</p>`;

    body.innerHTML = `
      <div class="gp-cols is-reviews">
        <div class="gp-main">
          ${mine}
          <h2 class="gp-h">Opiniones de la comunidad</h2>
          <div class="gp-rev-list">${list}</div>
          ${r.more ? `<button type="button" class="sl-btn sl-btn-ghost gp-rev-more" data-act="rev-more">Cargar más</button>` : ""}
        </div>
        <aside class="gp-aside">${summary}<p class="gp-source">Valoraciones de usuarios de Sharingan Launcher</p></aside>
      </div>`;
    const ta = body.querySelector(".gp-rev-text");
    ta?.addEventListener("input", () => {
      draft.comment = ta.value;
      const left = body.querySelector(".gp-rev-left");
      if (left && !r.legacy) left.textContent = `${2000 - ta.value.length} caracteres`;
    });
  }

  async function saveReview(score) {
    if (!window.Community?.needLogin?.("Para reseñar juegos necesitas una cuenta.")) return;
    const r = st.reviews;
    const s = seq;
    root.querySelectorAll(".gp-rev-actions button").forEach((b) => (b.disabled = true));
    const res = await window.electronAPI.cloud("review", r.gameId, score, score ? draft.comment.trim() : "").catch(() => ({ ok: false, error: "No se puede conectar con el servidor." }));
    if (!alive(s)) return;
    if (!res.ok) {
      root.querySelectorAll(".gp-rev-actions button").forEach((b) => (b.disabled = false));
      return showNotification(res.error || "No se ha podido guardar.", "error");
    }
    window.Community?.noteRated(r.gameId, score);
    showNotification(score ? "Reseña publicada." : "Reseña borrada.");
    st.community = await window.Community?.avgOf?.(r.gameId).catch(() => null);
    draft = null;
    st.reviews = null;
    paintBar();
    paintReviews();
  }

  // ------------------------------------------------------------ Mods
  const MOD_SORTS = [
    ["popular", "Populares"],
    ["downloads", "Más descargados"],
    ["updated", "Actualizados"],
    ["new", "Nuevos"],
  ];

  async function loadMods(s, { append = false } = {}) {
    const m = st.mods;
    m.loading = true;
    if (!append) {
      m.page = 0;
      m.items = [];
    }
    paintModsList();
    const g = st.game;
    const res = await window.electronAPI
      .gameMods({ id: g.id, name: st.details?.name || g.name, igdbId: st.igdbId }, { source: m.source, sort: m.sort, query: m.query, page: m.page, nexusOverride: m.override || null })
      .catch(() => null);
    if (!alive(s)) return;
    m.loading = false;
    if (!res) {
      m.error = true;
      return paintMods(root.querySelector(".gp-body"));
    }
    m.error = false;
    m.data = { ...(m.data || {}), ...res, workshopCount: res.workshopCount ?? m.data?.workshopCount };
    const part = m.source === "workshop" ? res.workshop : res.nexus;
    m.total = part?.total || 0;
    m.items = append ? [...m.items, ...(part?.items || [])] : part?.items || [];
    paintTabs();
    if (st.tab === "mods") paintMods(root.querySelector(".gp-body"));
  }

  function paintMods(body) {
    if (!body) return;
    const m = st.mods;
    if (!m.data && !m.loading && !m.error) {
      body.innerHTML = loadingHtml("Buscando mods…");
      loadMods(seq);
      return;
    }
    if (!m.data && m.loading) {
      body.innerHTML = loadingHtml("Buscando mods…");
      return;
    }
    if (m.error && !m.data) {
      body.innerHTML = emptyHtml("alert", "No se han podido cargar los mods", "Revisa tu conexión.", `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="mods-retry">${icon("refresh")}Reintentar</button>`);
      return;
    }
    const d = m.data || {};
    const hasWs = (d.workshopCount || 0) > 0 || (m.source === "workshop" && d.workshop);
    const nexusName = d.nexusGame?.name;
    const note =
      m.source === "nexus"
        ? nexusName
          ? `Mods de Nexus Mods para <b>${esc(nexusName)}</b> · <button type="button" class="cm-link" data-act="nexus-change">¿No es este juego?</button><br>Para instalarlos, en Nexus usa <b>Mod Manager Download</b> con Vortex o Mod Organizer 2.`
          : `No hemos encontrado este juego en Nexus Mods. <button type="button" class="cm-link" data-act="nexus-change">Buscarlo a mano</button>`
        : `Mods del Steam Workshop. Con <b>Suscribirse</b> se abre en Steam: al suscribirte, Steam lo descarga e instala solo.`;
    body.innerHTML = `
      <div class="gp-mods-head">
        <div class="gp-seg">
          <button type="button" class="${m.source === "nexus" ? "is-active" : ""}" data-mod-src="nexus">Nexus Mods${d.nexusGame ? `<em>${compact.format(d.nexusGame.modCount)}</em>` : ""}</button>
          ${hasWs ? `<button type="button" class="${m.source === "workshop" ? "is-active" : ""}" data-mod-src="workshop">${storeLogo("steam")}Workshop${d.workshopCount ? `<em>${compact.format(d.workshopCount)}</em>` : ""}</button>` : ""}
        </div>
        <label class="search-field gp-mods-search">${icon("search")}<input type="text" placeholder="Buscar mods…" value="${esc(m.query)}" aria-label="Buscar mods" data-mod-q></label>
        <select class="gp-select" data-mod-sort aria-label="Ordenar mods">${MOD_SORTS.map(([k, l]) => `<option value="${k}"${m.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <p class="gp-mods-note">${note}</p>
      <div class="gp-mods-list"></div>`;
    paintModsList();
  }

  function paintModsList() {
    const box = root.querySelector(".gp-mods-list");
    if (!box) return;
    const m = st.mods;
    const ws = m.source === "workshop";
    if (!m.items.length) {
      box.innerHTML = m.loading
        ? `<div class="gp-mods-grid">${'<div class="gp-mod is-skeleton"><span class="gp-shimmer"></span></div>'.repeat(8)}</div>`
        : (m.source === "nexus" && !m.data?.nexusGame) ? "" : `<p class="gp-muted gp-pad">${m.query ? "No hay mods que coincidan con la búsqueda." : "No hay mods para este juego."}</p>`;
      return;
    }
    box.innerHTML = `
      <div class="gp-mods-grid">${m.items
        .map(
          (x) => `
        <article class="gp-mod" data-ext="${esc(x.url)}" tabindex="0">
          <div class="gp-mod-img">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${ic("puzzle", "gp-mod-ph")}</div>
          <div class="gp-mod-body">
            <b>${esc(x.name)}</b>
            <small>${ws ? (x.tags || []).map(esc).join(" · ") : `${x.author ? `por ${esc(x.author)}` : ""}${x.category ? ` · ${esc(x.category)}` : ""}`}</small>
            <p>${esc(x.summary)}</p>
            <div class="gp-mod-stats">
              ${ws ? `<span title="Suscripciones">${icon("users")}${compact.format(x.subscriptions)}</span>${x.score != null ? `<span title="Valoración">${ic("thumb")}${Math.round(x.score * 100)} %</span>` : ""}` : `<span title="Endorsements">${icon("heart")}${compact.format(x.endorsements)}</span><span title="Descargas">${icon("download")}${compact.format(x.downloads)}</span>`}
              ${ws ? `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm gp-mod-sub" data-steam="steam://url/CommunityFilePage/${esc(x.id)}">Suscribirse</button>` : ""}
            </div>
          </div>
        </article>`
        )
        .join("")}</div>
      ${m.items.length < m.total ? `<div class="gp-center"><button type="button" class="sl-btn sl-btn-ghost" data-act="mods-more" ${m.loading ? "disabled" : ""}>${m.loading ? "Cargando…" : "Cargar más"}</button></div>` : ""}
      <p class="gp-source">${ws ? "Steam Workshop" : "Nexus Mods"} · ${nf.format(m.total)} mods</p>`;
  }

  async function changeNexusGame() {
    const name = st.details?.name || st.game.name;
    const pick = await openModal({
      eyebrow: "Mods",
      title: "Elegir el juego en Nexus Mods",
      width: 480,
      html: `
        <div class="gp-nexus-pick">
          <label class="search-field">${icon("search")}<input type="text" class="gp-nx-q" value="${esc(name)}" aria-label="Buscar juego"></label>
          <div class="gp-nx-list">${loadingHtml("Buscando…")}</div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: (popup) => {
        const q = popup.querySelector(".gp-nx-q");
        const list = popup.querySelector(".gp-nx-list");
        let t = 0;
        let n = 0;
        const run = async () => {
          const my = ++n;
          const res = await window.electronAPI.nexusSearch(q.value.trim()).catch(() => []);
          if (my !== n) return;
          list.innerHTML = res.length
            ? res
                .sort((a, b) => b.modCount - a.modCount)
                .map((g) => `<button type="button" class="gp-nx-item" data-domain="${esc(g.domain)}" data-name="${esc(g.name)}" data-count="${g.modCount}"><b>${esc(g.name)}</b><small>${nf.format(g.modCount)} mods</small></button>`)
                .join("")
            : `<p class="gp-muted gp-pad">No hay ningún juego con ese nombre en Nexus Mods.</p>`;
        };
        q.addEventListener("input", () => {
          clearTimeout(t);
          t = setTimeout(run, 300);
        });
        list.addEventListener("click", (e) => {
          const b = e.target.closest(".gp-nx-item");
          if (!b) return;
          Swal.close({ isConfirmed: true, value: { domain: b.dataset.domain, name: b.dataset.name, modCount: Number(b.dataset.count) } });
        });
        q.select();
        run();
      },
    });
    if (!pick?.value || !st) return;
    st.mods.override = pick.value;
    st.mods.source = "nexus";
    st.mods.data = null;
    paintMods(root.querySelector(".gp-body"));
  }

  // ------------------------------------------------------------ Requisitos
  async function paintReqs(body) {
    const s = seq;
    body.innerHTML = loadingHtml("Comparando con tu equipo…");
    const g = st.game;
    const [reqsResult, mySpecs] = await Promise.all([
      window.electronAPI.getRealRequirements({ igdbId: st.igdbId, steamAppId: g.steamAppId, gameName: st.details?.name || g.name }).catch(() => null),
      window.electronAPI.getSystemSpecs().catch(() => null),
    ]);
    if (!alive(s) || st.tab !== "reqs") return;
    const reqs = reqsResult || { min: "", rec: "" };
    const hwCheck = reqsResult ? await window.electronAPI.hardwareCheck({ min: reqs.min, rec: reqs.rec }).catch(() => null) : null;
    if (!alive(s) || st.tab !== "reqs") return;
    if (!reqsResult) {
      body.innerHTML = emptyHtml("cpu", "Sin requisitos", "Steam no tiene los requisitos de este juego.");
      return;
    }

    // Semáforo (hardware/compare.js en main): cada componente se compara
    // por puntuación con el mínimo y el recomendado; el global es el peor.
    const REQ_CLS = { green: "req-pass", yellow: "req-warn", red: "req-fail", unknown: "req-unknown" };
    const REQ_ICON = { green: "check", yellow: "alert", red: "x", unknown: "help" };
    const COMP_NAME = { cpu: "Procesador", gpu: "Gráfica", ram: "RAM", vram: "VRAM", storage: "Disco", os: "Windows", dx: "DirectX" };
    const lineStatus = (line, level) => {
      const cat = hwCheck?.cats?.[line];
      const comp = cat && hwCheck?.[level]?.components?.[cat];
      return comp && REQ_CLS[comp.status] ? comp : null;
    };
    const formatSteamReqs = (text, level) => {
      if (!text || /no especificado|no disponible/i.test(text)) return `<p class="req-empty">Steam no indica requisitos.</p>`;
      const rows = text
        .split("\n")
        .map((l) => l.replace(/•/g, "").trim())
        .filter((l) => l && !/^(mínimos?|recomendados?|minimum|recommended):?$/i.test(l));
      return `<div class="req-list">${rows
        .map((line) => {
          const at = line.indexOf(":");
          if (at > -1 && at < 24) {
            const key = line.slice(0, at).replace(/\*/g, "").trim();
            const val = line.slice(at + 1).trim();
            const c = lineStatus(line, level);
            return `<div class="req-line ${c ? REQ_CLS[c.status] : ""}"${c?.why ? ` title="${esc(c.why)}"` : ""}><span class="req-key">${esc(key)}${
              c ? `<i class="req-mark">${icon(REQ_ICON[c.status])}</i>` : ""
            }</span><span class="req-val">${esc(val)}</span></div>`;
          }
          return `<div class="req-line is-note"><span class="req-val">${esc(line)}</span></div>`;
        })
        .join("")}</div>`;
    };
    const verdictHtml = () => {
      const r = hwCheck?.min;
      if (!r) return "";
      const head = {
        green: Object.values(r.components).every((c) => c.status !== "green" || c.meetsRec !== false) && hwCheck.rec?.global === "green" ? "Cumple los recomendados" : "Tu equipo lo mueve",
        yellow: "Justo: al límite del mínimo",
        red: `No llega al mínimo: ${r.culprits.map((k) => COMP_NAME[k].toLowerCase()).join(", ")}`,
        unknown: "No hay datos suficientes para compararlo",
      }[r.global];
      const chips = Object.entries(r.components)
        .filter(([, c]) => REQ_CLS[c.status])
        .map(([k, c]) => `<span class="req-chip is-${c.status}" title="${esc(c.why || "")}">${icon(REQ_ICON[c.status])}${COMP_NAME[k]}</span>`)
        .join("");
      const whyRows = ["cpu", "gpu"]
        .map((k) => r.components[k])
        .filter((c) => c?.why && c.status !== "na")
        .map((c) => `<li>${esc(c.why)}</li>`)
        .join("");
      const unknown = r.unknown.length ? `<p class="req-verdict-note">Sin verificar: ${r.unknown.map((k) => COMP_NAME[k].toLowerCase()).join(", ")}.</p>` : "";
      const h = hwCheck.hw;
      const channelTip =
        h?.gpu?.integrated && h.channels === "single" && ["yellow", "red"].includes(r.components.gpu?.status)
          ? `<p class="req-verdict-note">Tu RAM va en un solo canal: con un segundo módulo igual, la gráfica integrada rendiría alrededor de un ${Math.round((Math.pow(2, hwCheck.k2 ?? 0.2) - 1) * 100)} % más.</p>`
          : "";
      return `
        <div class="req-verdict is-${r.global}">
          <p class="req-verdict-title"><i class="req-dot"></i>${esc(head)}</p>
          <div class="req-chips">${chips}</div>
          ${whyRows ? `<ul class="req-verdict-why">${whyRows}</ul>` : ""}
          ${unknown}
          ${channelTip}
        </div>`;
    };
    const hw = hwCheck?.hw || mySpecs?.hw;
    const sameGameName = (x, y) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "") === String(y).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const specsLine = hw
      ? [
          hw.cpu.label,
          `${hw.ram} GB RAM${hw.channels === "single" ? " (un solo canal)" : ""}`,
          `${hw.gpu.label}${hw.gpu.notes?.length ? ` (${hw.gpu.notes.join(", ")})` : ""}`,
          hw.freeStorage != null ? `${hw.freeStorage} GB libres` : null,
          hw.laptop ? "portátil" : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
    body.innerHTML = `
      <div class="gp-reqs">
        ${reqsResult.matchedName && !sameGameName(reqsResult.matchedName, g.name) ? `<p class="req-matched">${icon("info")}<span>Requisitos de «${esc(reqsResult.matchedName)}» en Steam (encontrado por el nombre).</span></p>` : ""}
        ${verdictHtml()}
        <div class="req-real-container">
          <div class="req-box"><h5 class="req-title">Mínimos</h5>${formatSteamReqs(reqs.min, "min")}</div>
          <div class="req-box"><h5 class="req-title">Recomendados</h5>${formatSteamReqs(reqs.rec, "rec")}</div>
        </div>
        ${specsLine ? `<p class="my-specs">${icon("info")}<span>Tu equipo: ${esc(specsLine)}. Verde: de sobra · amarillo: justo · rojo: no llega · gris: sin datos para comparar.</span></p>` : ""}
        <p class="gp-source">Requisitos: Steam · Rendimiento: Blender Open Data y Wikipedia</p>
      </div>`;
  }

  // Ajustes › Tiendas con Steam resaltado (sin cuenta del launcher no hay
  // tiendas: primero entrar).
  async function linkSteam() {
    if (!window.Community?.user?.()) return window.Community?.openAuth("login", "Para vincular tu cuenta de Steam primero entra en tu cuenta del launcher.");
    openSettingsModal("stores");
    for (let i = 0; i < 60; i++) {
      const btn = document.querySelector('.st-modal [data-store="steam"]');
      if (btn) {
        const row = btn.closest(".st-store");
        row?.classList.add("is-attention");
        row?.scrollIntoView({ block: "center" });
        btn.focus({ preventScroll: true });
        setTimeout(() => row?.classList.remove("is-attention"), 2600);
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // ------------------------------------------------------------ Eventos
  root.addEventListener("click", async (e) => {
    if (!st) return;
    const t = e.target;
    const tab = t.closest("button[data-tab]");
    if (tab) return switchTab(tab.dataset.tab);
    const open2 = t.closest("[data-open]");
    if (open2 && open2.dataset.open !== st.id) return open(open2.dataset.open);
    const shot = t.closest("[data-shot]");
    if (shot) return openLightbox(Number(shot.dataset.shot));
    const vid = t.closest("[data-video]");
    if (vid) return window.electronAPI.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(vid.dataset.video)}`);
    const steam = t.closest("[data-steam]");
    if (steam) {
      e.stopPropagation();
      return window.electronAPI.openExternal(steam.dataset.steam);
    }
    const ext = t.closest("[data-ext]");
    if (ext) return window.electronAPI.openExternal(ext.dataset.ext);
    const rateBtn = t.closest("[data-rate]");
    if (rateBtn && draft) {
      const n = Number(rateBtn.dataset.rate);
      draft.score = n;
      root.querySelectorAll(".gp-rate-star").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.rate) <= n));
      const label = root.querySelector(".gp-rate-label");
      if (label) label.textContent = ["Elige tu nota", "Malo", "Flojo", "Está bien", "Muy bueno", "Imprescindible"][n];
      const save = root.querySelector('[data-act="rev-save"]');
      if (save) save.disabled = false;
      return;
    }
    const rev = t.closest("[data-reveal]");
    if (rev) {
      const n = rev.dataset.reveal;
      if (achView.revealed.has(n)) achView.revealed.delete(n);
      else achView.revealed.add(n);
      return paintTab();
    }
    const f = t.closest("[data-ach-filter]");
    if (f) {
      achView.filter = f.dataset.achFilter;
      return paintTab();
    }
    const src = t.closest("[data-mod-src]");
    if (src && src.dataset.modSrc !== st.mods.source) {
      st.mods.source = src.dataset.modSrc;
      st.mods.query = "";
      return loadMods(seq);
    }

    const actEl = t.closest("[data-act]");
    if (!actEl) {
      if (!t.closest(".gp-more")) closeMenus();
      return;
    }
    const act = actEl.dataset.act;
    const id = st.id;
    if (act !== "menu") closeMenus();
    switch (act) {
      case "back":
        return back();
      case "menu": {
        const menu = actEl.parentElement.querySelector(".gp-menu");
        if (menu) menu.hidden = !menu.hidden;
        return;
      }
      case "play":
        return launchGame(id);
      case "download":
        return downloadGame(id);
      case "link":
        return setExecutable(id);
      case "unlink":
        return confirmUnlink(id);
      case "add": {
        actEl.disabled = true;
        await addFromJson(st.game);
        return refresh();
      }
      case "complete":
        await markCompleted(id);
        return;
      case "return":
        await returnToLibrary(id);
        return;
      case "platinum":
        return togglePlatinum(id);
      case "saga-in":
        return openAddToSagaModal(id);
      case "saga-out":
        return removeGameFromItsSaga(id);
      case "sortkey":
        return openSortKeyEditor(id);
      case "remove":
        return removeFromLibrary(id);
      case "plat-manual": {
        const ok = await confirmDialog({
          title: "¿Marcar como platino?",
          text: `Pasa a Juegos pasados con la corona. Hazlo solo si de verdad tienes los ${st.ach?.total || ""} logros.`,
          confirmText: "Marcar platino",
          iconName: "crown",
        });
        if (!ok) return;
        if (await window.electronAPI.setPlatinum(st.game.id, "manual").catch(() => false)) {
          showNotification(`${st.game.name}: platino marcado.`);
          await loadLibrary();
          paintTab();
        }
        return;
      }
      case "ach-hidden":
        achView.showHidden = !achView.showHidden;
        if (!achView.showHidden) achView.revealed.clear();
        return paintTab();
      case "ach-retry":
        st.ach = null;
        paintTab();
        return loadAchievements(seq, true);
      case "link-steam":
        return linkSteam();
      case "login":
        return window.Community?.openAuth("login", "Entra para reseñar juegos.");
      case "rev-save":
        return saveReview(draft?.score || 0);
      case "rev-delete": {
        const ok = await confirmDialog({ title: "¿Borrar tu reseña?", text: "Se quitan tu nota y tu comentario.", confirmText: "Borrar", danger: true });
        if (ok) saveReview(0);
        return;
      }
      case "rev-more":
        actEl.disabled = true;
        return loadReviews(seq, st.reviews?.reviews?.length || 0);
      case "rev-moderate": {
        const ok = await confirmDialog({ title: "¿Quitar este comentario?", text: "La nota se queda.", confirmText: "Quitar", danger: true });
        if (!ok) return;
        const res = await window.electronAPI.cloud("moderateReview", st.reviews.gameId, Number(actEl.dataset.user));
        if (!res.ok) return showNotification(res.error, "error");
        st.reviews = null;
        return paintReviews();
      }
      case "mods-more":
        st.mods.page++;
        return loadMods(seq, { append: true });
      case "mods-retry":
        st.mods.error = false;
        st.mods.data = null;
        return paintMods(root.querySelector(".gp-body"));
      case "nexus-change":
        return changeNexusGame();
    }
  });

  root.addEventListener("change", (e) => {
    if (!st) return;
    if (e.target.matches("[data-ach-sort]")) {
      achView.sort = e.target.value;
      paintTab();
    } else if (e.target.matches("[data-mod-sort]")) {
      st.mods.sort = e.target.value;
      loadMods(seq);
    }
  });

  let modQ = 0;
  root.addEventListener("input", (e) => {
    if (!st || !e.target.matches("[data-mod-q]")) return;
    clearTimeout(modQ);
    modQ = setTimeout(() => {
      st.mods.query = e.target.value.trim();
      loadMods(seq);
    }, 400);
  });

  root.addEventListener("keydown", (e) => {
    const rev = e.target.closest?.("[data-reveal]");
    if (rev && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      rev.click();
      return;
    }
    const mod = e.target.closest?.(".gp-mod[data-ext]");
    if (mod && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      window.electronAPI.openExternal(mod.dataset.ext);
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".gp-more")) closeMenus();
  });

  // Esc y el botón "atrás" del ratón vuelven
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isActive() || lb || Swal.isVisible()) return;
    if (document.querySelector(".sp-full.is-open")) return;
    if (e.target.closest?.("input, textarea, select")) return e.target.blur();
    back();
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3 && isActive() && !Swal.isVisible()) {
      e.preventDefault();
      back();
    }
  });

  // La sesión cambia: la reseña propia depende de ella
  window.electronAPI.onCloudStatus?.(() => {
    if (st?.tab === "reviews" && isActive()) {
      st.reviews = null;
      draft = null;
      paintReviews();
    }
  });

  window.GamePage = { open, back, onLeave, refresh, refreshPlay };
})();
