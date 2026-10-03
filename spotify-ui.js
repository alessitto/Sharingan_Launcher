// =====================================================================
// Spotify: botón en la barra de arriba + reproductor a pantalla completa
// =====================================================================
// Solo existe para los admins que no son testers: para el resto el botón
// sigue oculto y no se hace ninguna petición. Todo pasa por main.js
// (spotify.js), que es quien habla con Spotify y con LRCLIB (letras).
//
// Usa de index.html: escapeHtml y showNotification.
(() => {
  "use strict";

  const sp = (action, ...args) => window.electronAPI.spotify(action, ...args).catch(() => ({ ok: false, error: "No se puede conectar con Spotify." }));
  const esc = (s) => escapeHtml(String(s ?? ""));

  const POLL_OPEN_MS = 1500;
  const POLL_CLOSED_MS = 5000;
  const POLL_HIDDEN_MS = 20000;
  const POLL_LIMITED_MS = 15000;
  const LYRICS_LEAD_MS = 250; // la línea se enciende un pelín antes de cantarse

  // ------------------------------------------------------------ Iconos
  const SPOTIFY_LOGO =
    '<svg class="sp-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z"/></svg>';
  const PATHS = {
    play: '<path class="fill" d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2Z"/>',
    pause: '<rect class="fill" x="6" y="4.5" width="4" height="15" rx="1.2"/><rect class="fill" x="14" y="4.5" width="4" height="15" rx="1.2"/>',
    previous: '<path class="fill" d="M18 19.2V4.8a.8.8 0 0 0-1.25-.66L7.5 11.34a.8.8 0 0 0 0 1.32l9.25 7.2A.8.8 0 0 0 18 19.2Z"/><path d="M5.5 5v14"/>',
    next: '<path class="fill" d="M6 4.8v14.4a.8.8 0 0 0 1.25.66l9.25-7.2a.8.8 0 0 0 0-1.32L7.25 4.14A.8.8 0 0 0 6 4.8Z"/><path d="M18.5 5v14"/>',
    shuffle:
      '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h2a4 4 0 0 0 3.3-1.7l5.4-7.6A4 4 0 0 1 16 7h6"/><path d="M2 6h2a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6a4 4 0 0 1-3.3-1.8l-.4-.45"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    volume:
      '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>',
    volumeLow: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    mute: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
    computer: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    smartphone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    speaker: '<rect width="16" height="20" x="4" y="2" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2"/><path d="m17 2-5 5-5-5"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
    shrink: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  };
  const ic = (name, cls = "") => `<svg class="sp-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ""}</svg>`;
  const deviceIcon = (type) =>
    ic({ computer: "computer", smartphone: "smartphone", tablet: "smartphone", speaker: "speaker", avr: "speaker", stb: "tv", tv: "tv", castvideo: "tv", castaudio: "speaker", automobile: "speaker" }[type] || "speaker");

  // ------------------------------------------------------------ Estado
  let allowed = false;
  let connected = false;
  let connecting = false;
  let open = false;
  let state = null; // lo que suena (o null si no hay nada)
  let fetchedAt = 0; // cuándo llegó `state` (para mover la barra entre consultas)
  let devices = null;
  let devicesOpen = false;
  let pollTimer = null;
  let tickTimer = null;
  let limitedUntil = 0;
  let seeking = false;
  let volumeHoldUntil = 0; // tras mover el volumen, no se pisa con lo que diga Spotify
  let volumeTimer = null;
  let lastVolume = 50;
  let mode = ""; // qué esqueleto tiene pintado el reproductor
  let btnKey = "";
  let errorTimer = null;
  let lastCover = null;
  // Letras
  let lyricsKey = null; // canción de la que son las letras pintadas
  let lyrics = null; // null = cargando
  let lyricIdx = -2;
  let manualScrollUntil = 0;
  let fsExitAt = 0;

  const btn = document.getElementById("spotifyBtn");
  const view = document.createElement("div");
  view.className = "sp-full";
  view.setAttribute("role", "dialog");
  view.setAttribute("aria-modal", "true");
  view.setAttribute("aria-label", "Spotify");
  view.tabIndex = -1;
  view.innerHTML = `
    <div class="sp-full-bg" aria-hidden="true"></div>
    <div class="sp-full-shade" aria-hidden="true"></div>
    <header class="sp-full-top">
      <span class="sp-brand">${SPOTIFY_LOGO}<span>Spotify</span></span>
      <div class="sp-full-actions">
        <button type="button" class="sp-link sp-open" data-act="open" hidden>${ic("external")}Abrir en Spotify</button>
        <button type="button" class="sp-icon-btn" data-act="fullscreen" title="Pantalla completa (F)">${ic("expand")}</button>
        <button type="button" class="sp-icon-btn" data-act="close" title="Cerrar (Esc)">${ic("close")}</button>
      </div>
    </header>
    <div class="sp-full-body"></div>`;
  document.body.appendChild(view);
  const body = view.querySelector(".sp-full-body");
  const bg = view.querySelector(".sp-full-bg");
  const q = (s) => view.querySelector(s);

  // ------------------------------------------------------------ Utilidades
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  };

  // Posición actual: la última que dio Spotify más lo que ha pasado desde entonces.
  const position = () => {
    if (!state?.item) return 0;
    const extra = state.isPlaying ? performance.now() - fetchedAt : 0;
    return Math.min(state.item.durationMs || 0, state.progressMs + extra);
  };

  const setFill = (range) => {
    const max = Number(range.max) || 1;
    range.style.setProperty("--fill", `${(Number(range.value) / max) * 100}%`);
  };

  function showError(res) {
    if (!res || res.ok) return;
    if (res.code === "not_connected") {
      connected = false;
      state = null;
      render();
    }
    if (res.code === "rate_limited") limitedUntil = Date.now() + POLL_LIMITED_MS;
    const el = open && q(".sp-error");
    if (el) {
      el.textContent = res.error;
      el.hidden = false;
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => (el.hidden = true), 5000);
      return;
    }
    showNotification(res.error, "error");
  }

  // ------------------------------------------------------------ Consultas
  function schedule(ms) {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!allowed || !connected) return;
    let wait = ms ?? (document.hidden ? POLL_HIDDEN_MS : open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    if (limitedUntil > Date.now()) wait = Math.max(wait, limitedUntil - Date.now());
    pollTimer = setTimeout(poll, wait);
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (!allowed || !connected) return;
    const res = await sp("state");
    if (res.ok) {
      const prevVolume = state?.device?.volume;
      state = res.state;
      fetchedAt = performance.now();
      if (state?.device && Date.now() < volumeHoldUntil && prevVolume != null) state.device.volume = prevVolume;
      if (state?.device?.volume > 0) lastVolume = state.device.volume;
      render();
    } else if (res.code !== "network") {
      showError(res);
    }
    schedule();
  }

  async function loadDevices() {
    const res = await sp("devices");
    if (res.ok) devices = res.devices;
    else showError(res);
    render();
  }

  // Tras una orden, Spotify tarda un poco en reflejarla.
  const refreshSoon = () => schedule(400);

  async function run(action, ...args) {
    const res = await sp(action, ...args);
    if (!res.ok) {
      showError(res);
      schedule(0);
    } else refreshSoon();
    return res;
  }

  // ------------------------------------------------------------ Botón de arriba
  function renderButton() {
    btn.hidden = !allowed;
    if (!allowed) return;
    const it = state?.item;
    const key = it ? `${it.name}|${it.artists}|${it.thumb}|${state.isPlaying}` : `none|${connected}`;
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (key === btnKey) return;
    btnKey = key;
    btn.classList.toggle("has-track", !!it);
    btn.classList.toggle("is-playing", !!state?.isPlaying);
    btn.title = it ? `${it.name} · ${it.artists}` : "Spotify";
    btn.innerHTML = it
      ? `${it.thumb ? `<img class="sp-btn-cover" src="${esc(it.thumb)}" alt="">` : `<span class="sp-btn-cover is-empty">${ic("music")}</span>`}
         <span class="sp-btn-text"><b>${esc(it.name)}</b><small>${esc(it.artists)}</small></span>
         <span class="sp-eq" aria-hidden="true"><i></i><i></i><i></i></span>`
      : SPOTIFY_LOGO;
  }

  // ------------------------------------------------------------ Reproductor
  function devicesList() {
    if (!devices) return `<p class="sp-muted sp-dev-msg">Buscando dispositivos…</p>`;
    if (!devices.length) return `<p class="sp-muted sp-dev-msg">Abre Spotify en algún dispositivo.</p>`;
    return devices
      .map(
        (d) => `
        <button type="button" class="dropdown-item sp-dev ${d.active ? "is-active" : ""}" data-act="transfer" data-id="${esc(d.id)}" ${d.restricted ? "disabled" : ""}>
          ${deviceIcon(d.type)}<span>${esc(d.name)}</span>${d.active ? ic("check", "sp-dev-check") : ""}
        </button>`
      )
      .join("");
  }

  const errorLine = `<p class="sp-error" role="alert" hidden></p>`;

  function skeleton(next) {
    mode = next;
    view.dataset.mode = next;
    lastCover = null;
    if (next !== "player") {
      bg.style.backgroundImage = "";
      q(".sp-open").hidden = true;
    }
    if (next === "off") {
      body.innerHTML = `
        <div class="sp-center">
          <span class="sp-center-logo">${SPOTIFY_LOGO}</span>
          <p class="sp-center-title">Conecta tu Spotify</p>
          <button type="button" class="sl-btn sl-btn-primary sp-connect" data-act="connect">${SPOTIFY_LOGO}Conectar</button>
          ${errorLine}
        </div>`;
    } else if (next === "connecting") {
      body.innerHTML = `
        <div class="sp-center">
          <span class="sp-wait" aria-hidden="true"><i></i><i></i><i></i></span>
          <p class="sp-center-title">Autoriza en el navegador</p>
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="cancel">Cancelar</button>
        </div>`;
    } else if (next === "idle") {
      body.innerHTML = `
        <div class="sp-center sp-idle">
          <p class="sp-center-title">No suena nada</p>
          <div class="sp-idle-head"><span class="sp-muted">Elige dónde escuchar</span><button type="button" class="sp-icon-btn" data-act="refresh" title="Actualizar">${ic("refresh")}</button></div>
          <div class="sp-devices"></div>
          ${errorLine}
          <button type="button" class="sp-link" data-act="disconnect">Desconectar Spotify</button>
        </div>`;
    } else {
      body.innerHTML = `
        <section class="sp-player">
          <div class="sp-cover"></div>
          <div class="sp-meta">
            <p class="sp-title"></p>
            <p class="sp-artist"></p>
          </div>
          <div class="sp-seek">
            <input type="range" class="sp-range sp-progress" min="0" max="1" step="1000" value="0" aria-label="Posición">
            <div class="sp-times"><span class="sp-pos">0:00</span><span class="sp-dur">0:00</span></div>
          </div>
          <div class="sp-controls">
            <button type="button" class="sp-ctl sp-toggle" data-act="shuffle" title="Aleatorio">${ic("shuffle")}</button>
            <button type="button" class="sp-ctl" data-act="previous" title="Anterior">${ic("previous")}</button>
            <button type="button" class="sp-play" data-act="toggle"></button>
            <button type="button" class="sp-ctl" data-act="next" title="Siguiente">${ic("next")}</button>
            <button type="button" class="sp-ctl sp-toggle sp-repeat" data-act="repeat">${ic("repeat")}<span class="sp-one">1</span></button>
          </div>
          <div class="sp-bottom">
            <div class="sp-volume">
              <button type="button" class="sp-ctl sp-mute" data-act="mute"></button>
              <input type="range" class="sp-range sp-vol" min="0" max="100" step="1" value="50" aria-label="Volumen">
            </div>
            <div class="sp-device">
              <button type="button" class="sp-device-btn" data-act="devices" aria-expanded="false" title="Elegir dispositivo">
                <span class="sp-device-ic"></span><b></b>${ic("chevron", "sp-chev")}
              </button>
              <div class="dropdown-content sp-dev-pop"></div>
            </div>
          </div>
          ${errorLine}
        </section>
        <section class="sp-lyrics" aria-label="Letra"></section>`;
    }
  }

  function fillPlayer() {
    const it = state.item;
    if (it) {
      const coverKey = it.cover || "none";
      if (coverKey !== lastCover) {
        lastCover = coverKey;
        q(".sp-cover").innerHTML = it.cover ? `<img src="${esc(it.cover)}" alt="">` : `<span class="is-empty">${ic("music")}</span>`;
        bg.style.backgroundImage = it.cover ? `url("${it.cover.replace(/"/g, "%22")}")` : "";
      }
      q(".sp-title").textContent = it.name;
      q(".sp-title").title = it.name;
      q(".sp-artist").textContent = [it.artists, it.album].filter(Boolean).join(" · ");
      q(".sp-open").hidden = !it.url;
    } else {
      q(".sp-cover").innerHTML = `<span class="is-empty">${ic("music")}</span>`;
      lastCover = null;
      bg.style.backgroundImage = "";
      q(".sp-title").textContent = "Sin datos";
      q(".sp-artist").textContent = "";
      q(".sp-open").hidden = true;
    }

    const progress = q(".sp-progress");
    progress.max = String(it?.durationMs || 1);
    progress.disabled = !it || !state.canSeek;
    q(".sp-dur").textContent = fmt(it?.durationMs);
    if (!seeking) tick();

    const play = q(".sp-play");
    play.innerHTML = ic(state.isPlaying ? "pause" : "play");
    play.title = state.isPlaying ? "Pausar" : "Reproducir";
    play.setAttribute("aria-label", play.title);

    const shuffle = q('[data-act="shuffle"]');
    shuffle.classList.toggle("is-on", state.shuffle);
    shuffle.setAttribute("aria-pressed", String(state.shuffle));
    const repeat = q('[data-act="repeat"]');
    repeat.classList.toggle("is-on", state.repeat !== "off");
    repeat.classList.toggle("is-track", state.repeat === "track");
    repeat.title = { off: "Repetir", context: "Repetir: todo", track: "Repetir: esta canción" }[state.repeat];
    repeat.setAttribute("aria-pressed", String(state.repeat !== "off"));

    const dev = state.device;
    const vol = q(".sp-vol");
    const canVol = !!dev?.supportsVolume;
    q(".sp-volume").classList.toggle("is-disabled", !canVol);
    vol.disabled = !canVol;
    q(".sp-mute").disabled = !canVol;
    if (Date.now() >= volumeHoldUntil && document.activeElement !== vol) {
      vol.value = String(dev?.volume ?? 0);
      setFill(vol);
    }
    paintVolume(Number(vol.value), canVol);

    q(".sp-device-ic").innerHTML = deviceIcon(dev?.type);
    q(".sp-device-btn b").textContent = dev?.name || "Ningún dispositivo";
    const pop = q(".sp-dev-pop");
    pop.classList.toggle("is-shown", devicesOpen);
    q(".sp-device-btn").setAttribute("aria-expanded", String(devicesOpen));
    q(".sp-device").classList.toggle("is-open", devicesOpen);
    if (devicesOpen) pop.innerHTML = devicesList();

    loadLyrics();
  }

  function paintVolume(v, canVol = true) {
    const mute = q(".sp-mute");
    if (!mute) return;
    mute.innerHTML = ic(v === 0 ? "mute" : v < 50 ? "volumeLow" : "volume");
    mute.title = !canVol ? "Este dispositivo no deja cambiar el volumen" : v === 0 ? "Activar sonido" : `Volumen ${v}%`;
  }

  // Barra de progreso y letra entre consultas (sin pedir nada a Spotify).
  function tick() {
    const progress = q(".sp-progress");
    if (!progress || !state?.item) return;
    const pos = position();
    if (!seeking) {
      progress.value = String(pos);
      setFill(progress);
      q(".sp-pos").textContent = fmt(pos);
    }
    syncLyrics(pos);
    // Se ha acabado la canción: se pregunta ya qué viene.
    if (state.isPlaying && pos >= state.item.durationMs && performance.now() - fetchedAt > 800) {
      fetchedAt = performance.now();
      schedule(300);
    }
  }

  // ------------------------------------------------------------ Letras
  async function loadLyrics() {
    const it = state?.item;
    const box = q(".sp-lyrics");
    if (!box) return;
    const key = it && state.type !== "episode" ? String(it.id || `${it.artist}|${it.name}`) : "";
    if (key === lyricsKey) return;
    lyricsKey = key;
    lyrics = null;
    lyricIdx = -2;
    if (!key) return paintLyrics({ kind: "none" });
    paintLyrics(null);
    const res = await sp("lyrics", { id: it.id, name: it.name, artist: it.artist, album: it.album, durationMs: it.durationMs });
    if (lyricsKey !== key) return; // ha cambiado de canción mientras tanto
    paintLyrics(res.ok ? res.lyrics : { kind: "error" });
  }

  function paintLyrics(l) {
    lyrics = l;
    lyricIdx = -2;
    const box = q(".sp-lyrics");
    if (!box) return;
    const msg = (icon, text) => `<div class="sp-lyrics-msg">${ic(icon)}<p>${text}</p></div>`;
    box.classList.remove("is-synced", "is-plain");
    box.scrollTop = 0;
    if (!l) return (box.innerHTML = `<div class="sp-lyrics-msg is-loading"><span class="sp-wait"><i></i><i></i><i></i></span></div>`);
    if (l.kind === "instrumental") return (box.innerHTML = msg("music", "Instrumental"));
    if (l.kind === "error") return (box.innerHTML = msg("music", "No se ha podido cargar la letra"));
    if (!l.lines?.length) return (box.innerHTML = msg("music", "Sin letra"));
    const synced = l.kind === "synced";
    box.classList.add(synced ? "is-synced" : "is-plain");
    box.innerHTML = `<div class="sp-lines">${l.lines
      .map((x, i) => `<p class="sp-line${x.text ? "" : " is-gap"}" data-i="${i}"${synced ? ` data-t="${x.t}"` : ""}>${x.text ? esc(x.text) : "♪"}</p>`)
      .join("")}</div><p class="sp-lyrics-src">Letra: LRCLIB</p>`;
    if (synced) syncLyrics(position(), true);
  }

  function syncLyrics(pos, instant = false) {
    if (lyrics?.kind !== "synced" || !open) return;
    const lines = lyrics.lines;
    const t = pos + LYRICS_LEAD_MS;
    let idx = -1;
    for (let i = 0; i < lines.length && lines[i].t <= t; i++) idx = i;
    if (idx === lyricIdx) return;
    lyricIdx = idx;
    const box = q(".sp-lyrics");
    const els = box.querySelectorAll(".sp-line");
    els.forEach((el, i) => {
      el.classList.toggle("is-current", i === idx);
      el.classList.toggle("is-past", i < idx);
    });
    if (Date.now() < manualScrollUntil) return;
    const cur = els[Math.max(0, idx)];
    if (cur) box.scrollTo({ top: cur.offsetTop - box.clientHeight * 0.38 + cur.offsetHeight / 2, behavior: instant ? "auto" : "smooth" });
  }

  // ------------------------------------------------------------ Pintar
  function render() {
    renderButton();
    if (!allowed || !open) return;
    const next = !connected ? (connecting ? "connecting" : "off") : state ? "player" : "idle";
    if (next !== mode) {
      skeleton(next);
      if (next === "player") lyricsKey = null; // se vuelve a pintar la letra
    }
    if (next === "player") fillPlayer();
    if (next === "idle") q(".sp-devices").innerHTML = devicesList();
  }

  // ------------------------------------------------------------ Abrir / cerrar
  function setOpen(on) {
    if (on === open) return;
    open = on;
    devicesOpen = false;
    mode = "";
    clearInterval(tickTimer);
    if (open) {
      render();
      view.classList.add("is-shown");
      document.documentElement.classList.add("sp-full-open");
      tickTimer = setInterval(tick, 100);
      if (connected) {
        poll();
        if (!state) loadDevices();
      }
      view.focus({ preventScroll: true });
    } else {
      view.classList.remove("is-shown");
      document.documentElement.classList.remove("sp-full-open");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      renderButton();
      schedule();
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else view.requestFullscreen?.().catch(() => {});
  }

  document.addEventListener("fullscreenchange", () => {
    const fs = document.fullscreenElement === view;
    if (!fs) fsExitAt = performance.now();
    const b = q('[data-act="fullscreen"]');
    b.innerHTML = ic(fs ? "shrink" : "expand");
    b.title = fs ? "Salir de pantalla completa (F)" : "Pantalla completa (F)";
  });

  btn.addEventListener("click", () => setOpen(!open));
  document.addEventListener("keydown", (e) => {
    if (!open || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "Escape") {
      if (devicesOpen) {
        devicesOpen = false;
        render();
      } else if (!document.fullscreenElement && performance.now() - fsExitAt > 400) setOpen(false);
      return;
    }
    if (e.target.closest?.("button, input")) return;
    if (e.key === "f" || e.key === "F") toggleFullscreen();
    else if (e.key === " " && state) {
      e.preventDefault();
      q('[data-act="toggle"]')?.click();
    }
  });
  window.addEventListener("resize", () => {
    if (open && lyrics?.kind === "synced") {
      lyricIdx = -2;
      syncLyrics(position(), true);
    }
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? schedule() : connected && allowed && schedule(0)));

  // Si se mueve la letra a mano, se deja de seguir un rato.
  view.addEventListener("wheel", (e) => e.target.closest(".sp-lyrics") && (manualScrollUntil = Date.now() + 4000), { passive: true });

  // Cerrar la lista de dispositivos al pulsar fuera de ella.
  view.addEventListener("pointerdown", (e) => {
    if (devicesOpen && !e.target.closest(".sp-device")) {
      devicesOpen = false;
      render();
    }
  });

  // ------------------------------------------------------------ Acciones
  view.addEventListener("click", async (e) => {
    const line = e.target.closest(".sp-line[data-t]");
    if (line && state?.item) {
      const ms = Math.max(0, Number(line.dataset.t) - 100);
      state.progressMs = ms;
      fetchedAt = performance.now();
      manualScrollUntil = 0;
      tick();
      await run("seek", ms);
      return;
    }
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const act = el.dataset.act;

    if (act === "close") {
      setOpen(false);
    } else if (act === "fullscreen") {
      toggleFullscreen();
    } else if (act === "connect") {
      connecting = true;
      render();
      const res = await sp("connect");
      connecting = false;
      if (res.ok) {
        connected = true;
        state = null;
        render();
        poll();
        loadDevices();
      } else {
        render();
        if (res.code !== "login_cancelled") showError(res);
      }
    } else if (act === "cancel") {
      await sp("cancelConnect");
    } else if (act === "disconnect") {
      await sp("disconnect");
      connected = false;
      state = null;
      devices = null;
      render();
      schedule();
    } else if (act === "refresh") {
      devices = null;
      render();
      loadDevices();
      poll();
    } else if (act === "open") {
      if (state?.item?.url) window.electronAPI.openExternal(state.item.url);
    } else if (act === "toggle") {
      if (!state) return;
      const playing = state.isPlaying;
      state.progressMs = position();
      fetchedAt = performance.now();
      state.isPlaying = !playing;
      render();
      await run(playing ? "pause" : "play");
    } else if (act === "previous" || act === "next") {
      await run(act);
    } else if (act === "shuffle") {
      state.shuffle = !state.shuffle;
      render();
      await run("shuffle", state.shuffle);
    } else if (act === "repeat") {
      state.repeat = { off: "context", context: "track", track: "off" }[state.repeat] || "off";
      render();
      await run("repeat", state.repeat);
    } else if (act === "mute") {
      const vol = q(".sp-vol");
      const now = Number(vol.value);
      const target = now === 0 ? lastVolume || 50 : 0;
      if (now > 0) lastVolume = now;
      vol.value = String(target);
      setFill(vol);
      paintVolume(target);
      setVolume(target);
    } else if (act === "devices") {
      devicesOpen = !devicesOpen;
      if (devicesOpen) devices = null;
      render();
      if (devicesOpen) loadDevices();
    } else if (act === "transfer") {
      const id = el.dataset.id;
      devicesOpen = false;
      if (state?.device?.id === id) return render();
      if (state?.device) {
        const d = devices?.find((x) => x.id === id);
        if (d) state.device = { ...d, active: true };
      }
      render();
      // Si no sonaba nada, se empieza a reproducir en ese dispositivo.
      await run("transfer", id, state ? state.isPlaying : true);
      setTimeout(() => schedule(0), 1200);
    }
  });

  // Posición: se mueve la barra a mano y se manda al soltar.
  view.addEventListener("input", (e) => {
    if (e.target.classList.contains("sp-progress")) {
      seeking = true;
      setFill(e.target);
      q(".sp-pos").textContent = fmt(Number(e.target.value));
    } else if (e.target.classList.contains("sp-vol")) {
      const v = Number(e.target.value);
      setFill(e.target);
      paintVolume(v);
      setVolume(v);
    }
  });

  view.addEventListener("change", async (e) => {
    if (!e.target.classList.contains("sp-progress")) return;
    const ms = Number(e.target.value);
    if (state) {
      state.progressMs = ms;
      fetchedAt = performance.now();
    }
    seeking = false;
    manualScrollUntil = 0;
    lyricIdx = -2;
    await run("seek", ms);
  });

  // Volumen: se manda como mucho cada 250 ms mientras se arrastra.
  function setVolume(v) {
    volumeHoldUntil = Date.now() + 2500;
    if (state?.device) state.device.volume = v;
    if (v > 0) lastVolume = v;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(async () => {
      const res = await sp("volume", v);
      if (!res.ok) showError(res);
    }, 250);
  }

  // ------------------------------------------------------------ Quién puede
  async function applyUser(user) {
    const now = !!user?.admin && !user?.tester;
    if (now === allowed) return;
    allowed = now;
    if (!allowed) {
      setOpen(false);
      clearTimeout(pollTimer);
      state = null;
      devices = null;
      connected = false;
      btnKey = "";
      renderButton();
      return;
    }
    const res = await sp("status");
    connected = !!res.ok && !!res.connected;
    btnKey = "";
    renderButton();
    if (connected) poll();
  }

  window.electronAPI.onCloudStatus((s) => applyUser(s?.user));
  window.electronAPI
    .cloud("status")
    .then((s) => applyUser(s?.user))
    .catch(() => {});
})();
