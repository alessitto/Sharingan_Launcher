// =====================================================================
// Spotify: botón en la barra de arriba + panel del reproductor
// =====================================================================
// Solo existe para los admins que no son testers: para el resto el botón
// sigue oculto y no se hace ninguna petición. Todo pasa por main.js
// (spotify.js), que es quien habla con Spotify.
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
  let mode = ""; // qué esqueleto tiene pintado el panel
  let btnKey = "";
  let errorTimer = null;

  const btn = document.getElementById("spotifyBtn");
  const panel = document.createElement("div");
  // Es un .dropdown-content para heredar el marco de cada estilo, pero se
  // abre con su propia clase: index.html quita .show a todos los
  // .dropdown-content con cualquier clic.
  panel.className = "dropdown-content sp-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Spotify");
  document.body.appendChild(panel);

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
    if (open) {
      const el = panel.querySelector(".sp-error");
      if (el) {
        el.textContent = res.error;
        el.hidden = false;
        clearTimeout(errorTimer);
        errorTimer = setTimeout(() => (el.hidden = true), 5000);
        return;
      }
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

  // ------------------------------------------------------------ Panel
  const head = (extra = "") => `
    <header class="sp-head">
      <span class="sp-brand">${SPOTIFY_LOGO}<span>Spotify</span></span>
      ${extra}
    </header>`;
  const foot = () => `
    <p class="sp-error" role="alert" hidden></p>
    <footer class="sp-foot"><button type="button" class="sp-link" data-act="disconnect">Desconectar Spotify</button></footer>`;

  function devicesList() {
    if (!devices) return `<p class="sp-muted">Buscando dispositivos…</p>`;
    if (!devices.length) return `<p class="sp-muted">No hay ningún dispositivo con Spotify abierto. Ábrelo en el PC o en el móvil y pulsa actualizar.</p>`;
    return devices
      .map(
        (d) => `
        <button type="button" class="dropdown-item sp-dev ${d.active ? "is-active" : ""}" data-act="transfer" data-id="${esc(d.id)}" ${d.restricted ? "disabled" : ""}>
          ${deviceIcon(d.type)}<span>${esc(d.name)}</span>${d.active ? ic("check", "sp-dev-check") : ""}
        </button>`
      )
      .join("");
  }

  function skeleton(next) {
    mode = next;
    if (next === "off") {
      panel.innerHTML = `${head()}
        <div class="sp-empty">
          <p class="sp-empty-title">Tu música, sin salir del launcher</p>
          <p class="sp-muted">Conecta tu cuenta de Spotify para ver qué suena y controlarlo desde aquí.</p>
          <button type="button" class="sl-btn sl-btn-primary sp-connect" data-act="connect">${SPOTIFY_LOGO}Conectar con Spotify</button>
        </div>
        <p class="sp-error" role="alert" hidden></p>`;
    } else if (next === "connecting") {
      panel.innerHTML = `${head()}
        <div class="sp-empty">
          <span class="sp-wait" aria-hidden="true"><i></i><i></i><i></i></span>
          <p class="sp-empty-title">Esperando a Spotify…</p>
          <p class="sp-muted">Autoriza el acceso en el navegador que se ha abierto y vuelve aquí.</p>
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="cancel">Cancelar</button>
        </div>`;
    } else if (next === "idle") {
      panel.innerHTML = `${head(`<button type="button" class="sp-icon-btn" data-act="refresh" title="Actualizar">${ic("refresh")}</button>`)}
        <div class="sp-idle">
          <p class="sp-empty-title">No suena nada ahora mismo</p>
          <p class="sp-muted">Elige dónde quieres escuchar:</p>
          <div class="sp-devices"></div>
        </div>
        ${foot()}`;
    } else {
      panel.innerHTML = `${head(`<button type="button" class="sp-link sp-open" data-act="open">${ic("external")}Abrir en Spotify</button>`)}
        <div class="sp-now">
          <div class="sp-cover"></div>
          <div class="sp-meta">
            <p class="sp-title"></p>
            <p class="sp-artist"></p>
            <p class="sp-album"></p>
          </div>
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
        <div class="sp-volume">
          <button type="button" class="sp-ctl sp-mute" data-act="mute"></button>
          <input type="range" class="sp-range sp-vol" min="0" max="100" step="1" value="50" aria-label="Volumen">
          <span class="sp-vol-val">50</span>
        </div>
        <div class="sp-device">
          <button type="button" class="sp-device-btn" data-act="devices" aria-expanded="false">
            <span class="sp-device-ic"></span>
            <span class="sp-device-text"><small>Sonando en</small><b></b></span>
            ${ic("chevron", "sp-chev")}
          </button>
          <div class="sp-devices" hidden></div>
        </div>
        ${foot()}`;
      lastCover = null;
    }
  }

  let lastCover = null;
  function fillPlayer() {
    const it = state.item;
    const q = (s) => panel.querySelector(s);
    if (it) {
      const coverKey = it.cover || "none";
      if (coverKey !== lastCover) {
        lastCover = coverKey;
        q(".sp-cover").innerHTML = it.cover ? `<img src="${esc(it.cover)}" alt="">` : `<span class="is-empty">${ic("music")}</span>`;
      }
      q(".sp-title").textContent = it.name;
      q(".sp-title").title = it.name;
      q(".sp-artist").textContent = it.artists;
      q(".sp-album").textContent = it.album;
      q(".sp-open").hidden = !it.url;
    } else {
      q(".sp-cover").innerHTML = `<span class="is-empty">${ic("music")}</span>`;
      lastCover = null;
      q(".sp-title").textContent = "Contenido sin datos";
      q(".sp-artist").textContent = "";
      q(".sp-album").textContent = "";
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
    repeat.title = { off: "Repetir: no", context: "Repetir: todo", track: "Repetir: esta canción" }[state.repeat];
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
    q(".sp-device-text b").textContent = dev?.name || "Ningún dispositivo";
    const list = q(".sp-devices");
    list.hidden = !devicesOpen;
    q(".sp-device-btn").setAttribute("aria-expanded", String(devicesOpen));
    q(".sp-device").classList.toggle("is-open", devicesOpen);
    if (devicesOpen) list.innerHTML = devicesList();
  }

  function paintVolume(v, canVol = true) {
    const mute = panel.querySelector(".sp-mute");
    if (!mute) return;
    mute.innerHTML = ic(v === 0 ? "mute" : v < 50 ? "volumeLow" : "volume");
    mute.title = v === 0 ? "Activar sonido" : "Silenciar";
    panel.querySelector(".sp-vol-val").textContent = canVol ? String(v) : "—";
  }

  // Barra de progreso entre consultas (sin pedir nada a Spotify).
  function tick() {
    const progress = panel.querySelector(".sp-progress");
    if (!progress || seeking || !state?.item) return;
    const pos = position();
    progress.value = String(pos);
    setFill(progress);
    panel.querySelector(".sp-pos").textContent = fmt(pos);
    // Se ha acabado la canción: se pregunta ya qué viene.
    if (state.isPlaying && pos >= state.item.durationMs && performance.now() - fetchedAt > 800) {
      fetchedAt = performance.now();
      schedule(300);
    }
  }

  function render() {
    renderButton();
    if (!allowed) return;
    if (!open) return;
    const next = !connected ? (connecting ? "connecting" : "off") : state ? "player" : "idle";
    if (next !== mode) skeleton(next);
    if (next === "player") fillPlayer();
    if (next === "idle") panel.querySelector(".sp-devices").innerHTML = devicesList();
  }

  // ------------------------------------------------------------ Abrir / cerrar
  function place() {
    const r = btn.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 10)}px`;
    panel.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
  }

  function setOpen(on) {
    if (on === open) return;
    open = on;
    devicesOpen = false;
    mode = "";
    clearInterval(tickTimer);
    if (open) {
      place();
      render();
      panel.classList.add("is-shown");
      tickTimer = setInterval(tick, 250);
      if (connected) {
        poll();
        if (!state) loadDevices();
      }
    } else {
      panel.classList.remove("is-shown");
      renderButton();
      schedule();
    }
  }

  btn.addEventListener("click", () => setOpen(!open));
  document.addEventListener("pointerdown", (e) => {
    if (open && !panel.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) setOpen(false);
  });
  window.addEventListener("resize", () => open && place());
  document.addEventListener("visibilitychange", () => (document.hidden ? schedule() : connected && allowed && schedule(0)));

  // ------------------------------------------------------------ Acciones
  panel.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const act = el.dataset.act;

    if (act === "connect") {
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
      const vol = panel.querySelector(".sp-vol");
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
      if (state?.device?.id === id) {
        devicesOpen = false;
        render();
        return;
      }
      devicesOpen = false;
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
  panel.addEventListener("input", (e) => {
    if (e.target.classList.contains("sp-progress")) {
      seeking = true;
      setFill(e.target);
      panel.querySelector(".sp-pos").textContent = fmt(Number(e.target.value));
    } else if (e.target.classList.contains("sp-vol")) {
      const v = Number(e.target.value);
      setFill(e.target);
      paintVolume(v);
      setVolume(v);
    }
  });

  panel.addEventListener("change", async (e) => {
    if (!e.target.classList.contains("sp-progress")) return;
    const ms = Number(e.target.value);
    if (state) {
      state.progressMs = ms;
      fetchedAt = performance.now();
    }
    seeking = false;
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
