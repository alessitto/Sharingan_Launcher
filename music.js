// =====================================================================
// Música
// =====================================================================
// Control de lo que suena en Spotify (o en cualquier reproductor que salga
// en los controles multimedia de Windows) y su letra. No necesita iniciar
// sesión en Spotify ni ninguna API de desarrollador: main.js lee los
// controles multimedia de Windows (media-bridge.ps1) y las letras salen de
// LRCLIB, sincronizadas con la canción cuando las tiene.
//
// Usa helpers globales de index.html: icon y escapeHtml.
(() => {
  "use strict";

  let root = null;
  let visible = false;
  let state = { active: false };
  let base = { pos: 0, at: 0 }; // posición conocida y cuándo se supo
  let trackKey = "";
  let lyrics = null; // { lines: [{ t, text }] | null, plain, status }
  let activeLine = -1;
  let userScrollAt = 0;
  let raf = 0;

  const esc = (s) => escapeHtml(String(s ?? ""));
  const fmt = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  };

  function appName(id) {
    const a = String(id || "").toLowerCase();
    if (a.includes("spotify")) return "Spotify";
    if (a.includes("chrome")) return "Google Chrome";
    if (a.includes("msedge")) return "Microsoft Edge";
    if (a.includes("firefox")) return "Firefox";
    if (a.includes("zune") || a.includes("media")) return "Reproductor multimedia";
    return "Windows";
  }

  // Posición estimada: la que dio Windows más lo que ha pasado desde
  // entonces si está sonando (Spotify solo la avisa al cambiar algo).
  function position() {
    if (!state.active) return 0;
    const p = state.playing ? base.pos + (Date.now() - base.at) / 1000 : base.pos;
    return state.duration ? Math.min(p, state.duration) : p;
  }

  // ------------------------------------------------------------ Letras
  function parseLrc(text) {
    const out = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!stamps.length) continue;
      const words = raw.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: words });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  async function loadLyrics(key) {
    lyrics = { status: "loading" };
    renderLyrics();
    const res = await window.electronAPI
      .mediaLyrics({ artist: state.artist, title: state.title, album: state.album, duration: state.duration })
      .catch(() => ({ error: true }));
    if (key !== trackKey) return; // ya ha cambiado de canción
    if (res.error) lyrics = { status: "error" };
    else if (res.instrumental) lyrics = { status: "instrumental" };
    else if (res.synced) lyrics = { status: "synced", lines: parseLrc(res.synced) };
    else if (res.plain) lyrics = { status: "plain", plain: res.plain };
    else lyrics = { status: "none" };
    activeLine = -1;
    renderLyrics();
  }

  function renderLyrics() {
    const box = root?.querySelector(".mu-lyrics-inner");
    if (!box) return;
    const note = (t) => `<p class="mu-lyrics-note">${t}</p>`;
    const st = lyrics?.status;
    if (st === "loading") box.innerHTML = note("Buscando la letra…");
    else if (st === "error") box.innerHTML = note("No se ha podido cargar la letra. Revisa la conexión.");
    else if (st === "instrumental") box.innerHTML = note("♪ Instrumental ♪");
    else if (st === "none") box.innerHTML = note("No hay letra para esta canción.");
    else if (st === "plain")
      box.innerHTML =
        `<p class="mu-lyrics-tag">Letra sin sincronizar</p>` +
        lyrics.plain
          .split(/\r?\n/)
          .map((l) => `<p class="mu-line is-plain">${esc(l) || "&nbsp;"}</p>`)
          .join("");
    else if (st === "synced")
      box.innerHTML = lyrics.lines
        .map((l, i) => `<p class="mu-line" data-i="${i}" data-t="${l.t}">${esc(l.text) || "♪"}</p>`)
        .join("");
    else box.innerHTML = "";
    box.scrollTop = 0;
  }

  function syncLyrics(pos) {
    if (lyrics?.status !== "synced") return;
    const lines = lyrics.lines;
    let i = -1;
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].t <= pos + 0.2) i = k;
      else break;
    }
    if (i === activeLine) return;
    activeLine = i;
    const box = root.querySelector(".mu-lyrics-inner");
    box.querySelectorAll(".mu-line").forEach((el, k) => {
      el.classList.toggle("is-active", k === i);
      el.classList.toggle("is-past", k < i);
    });
    // Se centra la línea actual salvo que el usuario esté moviendo la letra.
    const el = box.querySelector(`.mu-line[data-i="${i}"]`);
    if (el && Date.now() - userScrollAt > 4000) {
      box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
    }
  }

  // ------------------------------------------------------------ Render
  function shell() {
    root.innerHTML = `
      <div class="mu-ambient" aria-hidden="true"></div>
      <div class="mu-empty" hidden>
        <span class="mu-empty-icon">${MUSIC_SVG}</span>
        <h3>No suena nada</h3>
        <p>Abre Spotify en este PC y pon una canción: aquí podrás controlarla y leer su letra. No hace falta iniciar sesión en nada más.</p>
        <button type="button" class="sl-btn sl-btn-primary" data-mu="spotify">${MUSIC_SVG}Abrir Spotify</button>
        <small>También funciona con cualquier reproductor que salga en los controles multimedia de Windows.</small>
      </div>
      <div class="mu-player" hidden>
        <div class="mu-card">
          <div class="mu-cover"><img alt="" draggable="false"><span class="mu-cover-empty">${MUSIC_SVG}</span></div>
          <span class="mu-app"></span>
          <h2 class="mu-title"></h2>
          <p class="mu-artist"></p>
          <div class="mu-progress">
            <div class="mu-bar" data-mu="seek" title="Ir a este punto"><span class="mu-fill"></span><span class="mu-knob"></span></div>
            <div class="mu-times"><span class="mu-cur">0:00</span><span class="mu-dur">0:00</span></div>
          </div>
          <div class="mu-controls">
            <button type="button" class="mu-btn" data-mu="prev" title="Anterior" aria-label="Anterior">${PREV_SVG}</button>
            <button type="button" class="mu-btn mu-play" data-mu="toggle" title="Reproducir / pausar" aria-label="Reproducir o pausar"></button>
            <button type="button" class="mu-btn" data-mu="next" title="Siguiente" aria-label="Siguiente">${NEXT_SVG}</button>
          </div>
        </div>
        <div class="mu-lyrics">
          <div class="mu-lyrics-head"><span class="section-eyebrow">Letra</span></div>
          <div class="mu-lyrics-inner"></div>
        </div>
      </div>`;

    root.addEventListener("click", onClick);
    const box = root.querySelector(".mu-lyrics-inner");
    box.addEventListener("wheel", () => (userScrollAt = Date.now()), { passive: true });
    box.addEventListener("pointerdown", () => (userScrollAt = Date.now()));
  }

  function render() {
    if (!root) return;
    const on = !!state.active;
    root.querySelector(".mu-empty").hidden = on;
    root.querySelector(".mu-player").hidden = !on;
    root.classList.toggle("has-cover", on && !!state.cover);
    if (!on) {
      // Mientras arranca el puente con Windows no se dice "no suena nada".
      root.querySelector(".mu-empty").classList.toggle("is-pending", !!state.pending);
      root.querySelector(".mu-empty h3").textContent = state.pending ? "Conectando con el reproductor…" : "No suena nada";
      return;
    }

    const img = root.querySelector(".mu-cover img");
    if (state.cover && img.getAttribute("src") !== state.cover) img.src = state.cover;
    img.hidden = !state.cover;
    root.querySelector(".mu-cover-empty").hidden = !!state.cover;
    root.querySelector(".mu-ambient").style.backgroundImage = state.cover ? `url("${state.cover}")` : "";
    root.querySelector(".mu-app").textContent = `Sonando en ${appName(state.app)}`;
    root.querySelector(".mu-title").textContent = state.title || "Sin título";
    root.querySelector(".mu-artist").textContent = [state.artist, state.album].filter(Boolean).join(" · ");
    root.querySelector(".mu-dur").textContent = fmt(state.duration);
    const play = root.querySelector(".mu-play");
    play.innerHTML = state.playing ? PAUSE_SVG : PLAY_SVG;
    play.classList.toggle("is-playing", !!state.playing);
    tickUi();
  }

  function tickUi() {
    if (!state.active || !root) return;
    const pos = position();
    const pct = state.duration ? Math.min(100, (pos / state.duration) * 100) : 0;
    root.querySelector(".mu-fill").style.width = `${pct}%`;
    root.querySelector(".mu-knob").style.left = `${pct}%`;
    root.querySelector(".mu-cur").textContent = fmt(pos);
    syncLyrics(pos);
  }

  function loop() {
    raf = 0;
    if (!visible) return;
    tickUi();
    raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ Estado
  function onState(s) {
    const key = s.active ? `${s.artist}|${s.title}` : "";
    const wasPlaying = state.playing;
    state = s;
    // Spotify a veces repite la última posición conocida: si sigue sonando
    // la misma canción y la estimación local va por delante, se respeta.
    const reported = Number(s.position) || 0;
    const at = s.updated && s.updated <= Date.now() ? s.updated : Date.now();
    const estimate = position();
    if (key !== trackKey || !s.playing || !wasPlaying || Math.abs(reported + (Date.now() - at) / 1000 - estimate) > 1.5) {
      base = { pos: reported, at };
    }
    if (key !== trackKey) {
      trackKey = key;
      lyrics = null;
      activeLine = -1;
      if (s.active && s.title) loadLyrics(key);
      else renderLyrics();
    }
    render();
  }

  function command(cmd) {
    window.electronAPI.mediaCommand(cmd);
  }

  function onClick(e) {
    const line = e.target.closest(".mu-line[data-t]");
    if (line) {
      const t = Number(line.dataset.t);
      base = { pos: t, at: Date.now() };
      command(`seek ${t.toFixed(2)}`);
      userScrollAt = 0;
      tickUi();
      return;
    }
    const t = e.target.closest("[data-mu]");
    if (!t) return;
    const act = t.dataset.mu;
    if (act === "spotify") window.electronAPI.mediaOpenSpotify();
    else if (act === "toggle") {
      // Respuesta inmediata; el estado real llega en un segundo.
      base = { pos: position(), at: Date.now() };
      state = { ...state, playing: !state.playing };
      render();
      command("toggle");
    } else if (act === "next" || act === "prev") command(act);
    else if (act === "seek" && state.duration) {
      const r = t.getBoundingClientRect();
      const sec = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * state.duration;
      base = { pos: sec, at: Date.now() };
      command(`seek ${sec.toFixed(2)}`);
      tickUi();
    }
  }

  // ------------------------------------------------------------ SVG
  const MUSIC_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>';
  const PREV_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="5" width="2.5" height="14" rx="1"/><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9 12.83a1 1 0 0 1 0-1.66l8.45-5.8A1 1 0 0 1 19 6.2Z"/></svg>';
  const NEXT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="17.5" y="5" width="2.5" height="14" rx="1"/><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83L15 12.83a1 1 0 0 0 0-1.66L6.55 5.37A1 1 0 0 0 5 6.2Z"/></svg>';

  // ------------------------------------------------------------ Init
  function init() {
    root = document.getElementById("muRoot");
    if (!root) return;
    shell();
    render();
    window.electronAPI.onMediaState(onState);
  }

  window.Music = {
    async setVisible(on) {
      if (on === visible) return;
      visible = on;
      if (on) {
        const s = await window.electronAPI.mediaStart().catch(() => null);
        if (s) onState(s);
        if (!raf) raf = requestAnimationFrame(loop);
      } else {
        window.electronAPI.mediaStop();
      }
    },
  };

  init();
})();
