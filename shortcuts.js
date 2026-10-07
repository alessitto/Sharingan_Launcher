// =====================================================================
// Atajos de teclado (Ajustes > Atajos de teclado)
// =====================================================================
// No hay ninguno de serie: el usuario asigna una tecla o combinación a la
// acción que quiera. Se guardan en settings.shortcuts ([{ action, keys,
// global }], viajan con la cuenta) con el formato de Electron (Ctrl+Shift+P).
//  - Normales: funcionan con el launcher delante (este fichero escucha las
//    teclas). Con el cursor en un campo de texto solo valen los que llevan
//    Ctrl/Alt/Win, las F y las teclas multimedia, para no robar letras.
//  - Globales: también con el launcher en segundo plano (globalShortcut en
//    main). Necesitan Ctrl, Alt o Win, una tecla F o una multimedia.
// Solo con sesión iniciada, como el resto de ajustes personales.
(function () {
  const isGuest = () => document.body.classList.contains("is-guest");
  const nav = (label) => document.querySelector(`.topnav-item[aria-label="${label}"]`);
  const go = (id, label) => showSection(id, nav(label));
  const pp = (what) => {
    go("pokepark", "PokéPark");
    window.PokePark?.open?.(what);
  };

  // Último juego jugado (con tiempo jugado medido).
  function lastPlayed() {
    return [...libraryGamesCache, ...completedGamesCache].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
  }

  const ACTIONS = [
    { group: "Navegación", items: [
      { id: "go-discover", label: "Ir a Descubrir", run: () => go("popular", "Descubrir") },
      { id: "go-library", label: "Ir a Mi biblioteca", run: () => go("library", "Mi biblioteca") },
      { id: "go-completed", label: "Ir a Juegos pasados", run: () => go("completed", "Juegos pasados") },
      { id: "go-pokepark", label: "Ir al PokéPark", run: () => go("pokepark", "PokéPark") },
      { id: "go-community", label: "Ir a Comunidad", run: () => go("community", "Comunidad") },
      { id: "go-free", label: "Abrir Juegos gratis", run: () => window.FreeGames?.open() },
      { id: "search", label: "Buscar en Descubrir", run: () => {
        go("popular", "Descubrir");
        setTimeout(() => document.getElementById("searchInput")?.focus(), 50);
      } },
      { id: "settings", label: "Abrir Ajustes", run: () => openSettingsModal() },
      { id: "scroll-top", label: "Volver arriba", run: () => scrollActiveSectionToTop() },
    ] },
    { group: "Juegos", items: [
      { id: "play-last", label: "Jugar al último juego", run: () => {
        const g = lastPlayed();
        if (g) launchGame(g.id);
        else showNotification("Todavía no hay ningún juego con tiempo jugado.", "error");
      } },
      { id: "info-last", label: "Ficha del último juego", run: () => {
        const g = lastPlayed();
        if (g) openInfoModal(g.id);
      } },
      { id: "import", label: "Importar juegos instalados", run: () => openImportModal() },
      { id: "sagas", label: "Abrir Sagas", run: () => openSagasModal() },
      { id: "jarvis", label: "Recomendación por Jarvis", run: () => {
        go("popular", "Descubrir");
        openJarvis();
      } },
      { id: "backup", label: "Copia de partidas", run: () => openBackupModal() },
    ] },
    { group: "PokéPark", items: [
      { id: "pp-shop", label: "Tienda", run: () => pp("shop") },
      { id: "pp-games", label: "Minijuegos", run: () => pp("games") },
      { id: "pp-tasks", label: "Encargos", run: () => pp("tasks") },
      { id: "pp-pokedex", label: "Pokédex", run: () => pp("pokedex") },
      { id: "pp-bag", label: "Bolsa", run: () => pp("bag") },
      { id: "pp-box", label: "Cajas", run: () => pp("box") },
      { id: "pp-trades", label: "Intercambios", run: () => pp("trades") },
      { id: "pp-work", label: "Cobrar el trabajo del equipo", run: () => pp("work") },
      { id: "pp-fullscreen", label: "PokéPark a pantalla completa", run: () => pp("fullscreen") },
    ] },
    { group: "Spotify", items: [
      { id: "sp-toggle", label: "Reproducir o pausar", run: () => window.SpotifyUI?.control?.("toggle") },
      { id: "sp-next", label: "Siguiente canción", run: () => window.SpotifyUI?.control?.("next") },
      { id: "sp-previous", label: "Canción anterior", run: () => window.SpotifyUI?.control?.("previous") },
      { id: "sp-open", label: "Abrir Spotify", run: () => window.SpotifyUI?.open?.() },
    ] },
    { group: "Aplicación", items: [
      { id: "sync", label: "Sincronizar con la cuenta", run: async () => {
        const r = await window.electronAPI.cloud("syncNow");
        showNotification(r?.ok === false ? r.error : "Sincronizado con tu cuenta.", r?.ok === false ? "error" : undefined);
      } },
      { id: "fullscreen", label: "Pantalla completa", run: () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      } },
    ] },
  ];
  const byId = new Map(ACTIONS.flatMap((g) => g.items).map((a) => [a.id, a]));

  // ---------------- Teclas
  const CODE_KEYS = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Space: "Space", Enter: "Enter", NumpadEnter: "Enter", Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Escape: "Escape", Tab: "Tab",
    Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/",
    NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv", NumpadDecimal: "numdec",
    MediaPlayPause: "MediaPlayPause", MediaTrackNext: "MediaNextTrack", MediaTrackPrevious: "MediaPreviousTrack", MediaStop: "MediaStop",
    AudioVolumeUp: "VolumeUp", AudioVolumeDown: "VolumeDown", AudioVolumeMute: "VolumeMute",
  };
  const MOD_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

  // Combinación en formato de Electron, o null si es solo un modificador.
  function comboOf(e) {
    if (MOD_CODES.test(e.code) || ["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
    let key = null;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
    else if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
    else key = CODE_KEYS[e.code] || CODE_KEYS[e.key] || null;
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Super");
    return [...mods, key].join("+");
  }

  const SHOW = {
    Ctrl: "Ctrl", Alt: "Alt", Shift: "Mayús", Super: "Win", Up: "↑", Down: "↓", Left: "←", Right: "→", Space: "Espacio", Enter: "Intro",
    Backspace: "Retroceso", Delete: "Supr", Insert: "Insert", Home: "Inicio", End: "Fin", PageUp: "Re Pág", PageDown: "Av Pág",
    MediaPlayPause: "Play/Pausa", MediaNextTrack: "Siguiente", MediaPreviousTrack: "Anterior", MediaStop: "Stop",
    VolumeUp: "Vol +", VolumeDown: "Vol −", VolumeMute: "Silencio", numadd: "Num +", numsub: "Num −", nummult: "Num *", numdiv: "Num /", numdec: "Num ,",
  };
  const show = (keys) => keys.split("+").map((k) => `<kbd>${escapeHtml(SHOW[k] || (/^num\d$/.test(k) ? `Num ${k.slice(3)}` : k))}</kbd>`).join("");
  const parts = (keys) => keys.split("+");
  const hasMod = (keys) => parts(keys).some((k) => k === "Ctrl" || k === "Alt" || k === "Super");
  const isFn = (keys) => /^F\d{1,2}$/.test(parts(keys).pop());
  const isMedia = (keys) => /^(Media|Volume)/.test(parts(keys).pop());
  const globalOk = (keys) => hasMod(keys) || isFn(keys) || isMedia(keys);
  // Las que ya usa la app o Windows.
  const RESERVED = new Set(["Escape", "Tab", "Shift+Tab", "Enter", "Space", "F5", "F12", "Ctrl+R", "Ctrl+Shift+I", "Ctrl+Shift+J", "Alt+F4", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+A", "Ctrl+Z"]);

  // ---------------- Estado
  let list = [];
  async function load() {
    const s = (await window.electronAPI.getSettings().catch(() => null)) || {};
    list = Array.isArray(s.shortcuts) ? s.shortcuts.filter((x) => byId.has(x.action)) : [];
    syncGlobals();
  }

  async function syncGlobals() {
    const res = await window.electronAPI.setGlobalShortcuts(isGuest() ? [] : list).catch(() => null);
    return res?.failed || [];
  }

  async function save() {
    await window.electronAPI.setSettings({ shortcuts: list });
    const failed = await syncGlobals();
    if (failed.length) showNotification(`Windows no deja usar ${failed.join(", ")} como atajo global (lo tiene otro programa).`, "error");
  }

  function run(actionId) {
    if (isGuest()) return;
    const a = byId.get(actionId);
    if (!a) return;
    try {
      a.run();
    } catch (err) {
      console.error("atajo", actionId, err);
    }
  }

  // ---------------- Teclas en la ventana
  let recording = null; // { action, done }
  window.addEventListener(
    "keydown",
    (e) => {
      if (recording) return onRecordKey(e);
      if (isGuest() || !list.length || e.repeat) return;
      const keys = comboOf(e);
      if (!keys) return;
      const sc = list.find((x) => x.keys === keys);
      if (!sc) return;
      const typing = e.target.closest?.("input, textarea, select, [contenteditable='true']");
      if (typing && !hasMod(keys) && !isFn(keys) && !isMedia(keys)) return;
      e.preventDefault();
      e.stopPropagation();
      run(sc.action);
    },
    true
  );
  window.electronAPI.onShortcut?.((action) => run(action));

  function onRecordKey(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return stopRecording();
    const keys = comboOf(e);
    if (!keys) return;
    if (RESERVED.has(keys)) {
      recording.msg = `${keys.replace("Shift", "Mayús")} ya la usa el launcher o Windows. Prueba otra.`;
      return recording.paint();
    }
    const { action } = recording;
    const prev = list.find((x) => x.keys === keys && x.action !== action);
    const mine = list.find((x) => x.action === action);
    list = list.filter((x) => x.action !== action && x.keys !== keys);
    list.push({ action, keys, global: !!(mine?.global && globalOk(keys)) });
    if (prev) showNotification(`Se ha quitado de "${byId.get(prev.action)?.label}" para ponerla aquí.`);
    stopRecording();
    save();
  }

  function stopRecording() {
    const r = recording;
    recording = null;
    r?.paint();
  }

  // ---------------- Página de Ajustes
  function renderSettings(el) {
    if (!el) return;
    const paint = () => {
      if (!el.isConnected) return;
      const rows = (a) => {
        const sc = list.find((x) => x.action === a.id);
        const rec = recording?.action === a.id;
        return `
          <div class="sc-row${rec ? " is-recording" : ""}${sc ? " is-set" : ""}" data-action="${a.id}">
            <span class="sc-label">${escapeHtml(a.label)}</span>
            <span class="sc-keys">${rec ? `<em>${escapeHtml(recording.msg || "Pulsa la tecla o combinación… (Esc para cancelar)")}</em>` : sc ? show(sc.keys) : `<em>Sin asignar</em>`}</span>
            ${
              sc && !rec
                ? `<button type="button" class="sc-global${sc.global ? " is-on" : ""}" data-sc="global" ${globalOk(sc.keys) ? "" : "disabled"} title="${
                    globalOk(sc.keys) ? (sc.global ? "Global: funciona también con el launcher en segundo plano" : "Hacerlo global (también con el launcher en segundo plano)") : "Para que sea global necesita Ctrl, Alt o Win, una tecla F o una multimedia"
                  }">${icon("globe")}</button>`
                : ""
            }
            <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-sc="${rec ? "cancel" : "set"}">${rec ? "Cancelar" : sc ? "Cambiar" : "Asignar"}</button>
            ${sc && !rec ? `<button type="button" class="sc-del" data-sc="del" title="Quitar el atajo">${icon("x")}</button>` : ""}
          </div>`;
      };
      el.innerHTML = `
        <p class="sc-intro">${icon("keyboard")}<span>Asigna una tecla o combinación a lo que quieras. Las marcadas como globales (${icon("globe")}) funcionan también con el launcher en segundo plano, por ejemplo mientras juegas.</span></p>
        ${ACTIONS.map((g) => `<section class="sc-group"><h4>${escapeHtml(g.group)}</h4>${g.items.map(rows).join("")}</section>`).join("")}
        ${list.length ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm sc-clear" data-sc="clear">${icon("trash")}Quitar todos</button>` : ""}`;
    };
    paint();
    el.onclick = (e) => {
      const b = e.target.closest("[data-sc]");
      if (!b) return;
      const action = b.closest("[data-action]")?.dataset.action;
      const what = b.dataset.sc;
      if (what === "set") {
        recording = { action, paint, msg: "" };
        paint();
      } else if (what === "cancel") stopRecording();
      else if (what === "del") {
        list = list.filter((x) => x.action !== action);
        save().then(paint);
      } else if (what === "global") {
        const sc = list.find((x) => x.action === action);
        if (sc && globalOk(sc.keys)) sc.global = !sc.global;
        save().then(paint);
      } else if (what === "clear") {
        list = [];
        save().then(paint);
      }
      paint();
    };
  }

  // Al entrar o salir de la cuenta, o al llegar el perfil de otro PC.
  window.electronAPI.onCloudStatus?.(() => setTimeout(load, 300));
  window.electronAPI.onCloudProfile?.(() => load());
  load();

  window.Shortcuts = { renderSettings, run, _list: () => list, _comboOf: comboOf };
})();
