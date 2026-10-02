// =====================================================================
// Logros
// =====================================================================
// Animan a probar todo lo que hace la app. El progreso se cuenta siempre
// (contadores en userData/stats.json, que también viajan a la cuenta), pero
// los logros solo se desbloquean con sesión iniciada: al entrar, los que ya
// se cumplen se desbloquean de golpe.
//
// Cada logro tiene una función que devuelve [actual, objetivo] a partir de
// los contadores y del estado de la app (biblioteca y PokéPark).
//
// Usa de index.html: libraryGamesCache, completedGamesCache, sagasCache,
// icon, escapeHtml.
(() => {
  "use strict";

  const THEMES_TOTAL = 9;
  const FRIENDSHIP_MAX = 255;

  const libraryCounts = () => {
    const lib = typeof libraryGamesCache !== "undefined" ? libraryGamesCache : [];
    const done = typeof completedGamesCache !== "undefined" ? completedGamesCache : [];
    const sg = typeof sagasCache !== "undefined" ? sagasCache : [];
    return { owned: lib.length + done.length, done: done.length, plat: done.filter((g) => g.isPlatinum).length, sagas: sg.length };
  };
  const park = () => window.PokePark?.snapshot?.() || { party: [], legends: {} };

  const CATEGORIES = [
    { id: "library", name: "Biblioteca" },
    { id: "discover", name: "Descubrir e IA" },
    { id: "style", name: "Personalización" },
    { id: "pokepark", name: "PokéPark" },
    { id: "community", name: "Comunidad" },
  ];

  const s = (k) => (st) => st[k] || 0;
  const DEFS = [
    // Biblioteca
    { id: "lib_first", cat: "library", icon: "plus", name: "Primer paso", desc: "Añade tu primer juego a la biblioteca.", goal: () => [libraryCounts().owned, 1] },
    { id: "lib_10", cat: "library", icon: "grid", name: "Coleccionista", desc: "Ten 10 juegos entre biblioteca y pasados.", goal: () => [libraryCounts().owned, 10] },
    { id: "lib_50", cat: "library", icon: "grid", name: "Estantería llena", desc: "Ten 50 juegos entre biblioteca y pasados.", goal: () => [libraryCounts().owned, 50] },
    { id: "done_first", cat: "library", icon: "check", name: "¡Pasado!", desc: "Marca tu primer juego como pasado.", goal: () => [libraryCounts().done, 1] },
    { id: "done_10", cat: "library", icon: "check", name: "Veterano", desc: "Pásate 10 juegos.", goal: () => [libraryCounts().done, 10] },
    { id: "done_25", cat: "library", icon: "trophy", name: "Leyenda viva", desc: "Pásate 25 juegos.", goal: () => [libraryCounts().done, 25] },
    { id: "plat_first", cat: "library", icon: "crown", name: "Platino", desc: "Consigue tu primer platino.", goal: () => [libraryCounts().plat, 1] },
    { id: "plat_5", cat: "library", icon: "crown", name: "Cazador de trofeos", desc: "Consigue 5 platinos.", goal: () => [libraryCounts().plat, 5] },
    { id: "saga_first", cat: "library", icon: "layers", name: "Arquitecto de sagas", desc: "Crea tu primera saga.", goal: () => [libraryCounts().sagas, 1] },
    { id: "saga_3", cat: "library", icon: "layers", name: "Cronista", desc: "Ten 3 sagas.", goal: () => [libraryCounts().sagas, 3] },
    { id: "launch_first", cat: "library", icon: "play", name: "¡A jugar!", desc: "Abre un juego desde la app.", goal: (st) => [s("launches")(st), 1] },
    { id: "launch_25", cat: "library", icon: "play", name: "Jugador habitual", desc: "Abre juegos desde la app 25 veces.", goal: (st) => [s("launches")(st), 25] },
    { id: "import", cat: "library", icon: "download", name: "Importador", desc: "Importa tus juegos instalados.", goal: (st) => [s("imports")(st), 1] },
    { id: "backup", cat: "library", icon: "save", name: "Precavido", desc: "Haz una copia de tus partidas.", goal: (st) => [s("backups")(st), 1] },
    // Descubrir e IA
    { id: "jarvis", cat: "discover", icon: "sparkles", name: "Hola, Jarvis", desc: "Pide una recomendación a Jarvis.", goal: (st) => [s("jarvis")(st), 1] },
    { id: "jarvis_add", cat: "discover", icon: "sparkles", name: "Buen consejo", desc: "Añade a tu biblioteca un juego que te recomendó Jarvis.", goal: (st) => [s("jarvisAdds")(st), 1] },
    { id: "ai_saga", cat: "discover", icon: "calendar", name: "Historiador", desc: "Aplica el orden cronológico de la IA a una saga.", goal: (st) => [s("aiSagas")(st), 1] },
    // Personalización
    { id: "theme_change", cat: "style", icon: "palette", name: "Nuevo look", desc: "Cambia el tema de la app.", goal: (st) => [Math.min(2, (st.themes || []).length), 2] },
    { id: "theme_glass", cat: "style", icon: "sparkles", name: "Cristal líquido", desc: "Usa el tema Liquid Glass.", goal: (st) => [(st.themes || []).includes("glass") ? 1 : 0, 1] },
    { id: "theme_all", cat: "style", icon: "palette", name: "Coleccionista de estilos", desc: `Prueba los ${THEMES_TOTAL} temas.`, goal: (st) => [(st.themes || []).length, THEMES_TOTAL] },
    // PokéPark
    { id: "pp_first", cat: "pokepark", icon: "pokeball", name: "¡Te elijo a ti!", desc: "Elige tu primer Pokémon.", goal: () => [park().party.length, 1] },
    { id: "pp_full", cat: "pokepark", icon: "pokeball", name: "Equipo completo", desc: "Ten 6 Pokémon en el parque.", goal: () => [park().party.length, 6] },
    { id: "pp_evolve", cat: "pokepark", icon: "sparkles", name: "¿Qué? ¡Está evolucionando!", desc: "Haz que un Pokémon evolucione.", goal: (st) => [s("evolutions")(st), 1] },
    { id: "pp_evolve_10", cat: "pokepark", icon: "sparkles", name: "Profesor Pokémon", desc: "Consigue 10 evoluciones.", goal: (st) => [s("evolutions")(st), 10] },
    { id: "pp_stone", cat: "pokepark", icon: "gem", name: "Brilla, piedra", desc: "Haz evolucionar a un Pokémon con un objeto.", goal: (st) => [s("itemEvos")(st), 1] },
    { id: "pp_feed", cat: "pokepark", icon: "heart", name: "Chef de bayas", desc: "Da de comer 50 veces.", goal: (st) => [s("feeds")(st), 50] },
    { id: "pp_clean", cat: "pokepark", icon: "sparkles", name: "Reluciente", desc: "Limpia a tus Pokémon 25 veces.", goal: (st) => [s("cleans")(st), 25] },
    { id: "pp_lv50", cat: "pokepark", icon: "trophy", name: "Entrenador experto", desc: "Sube un Pokémon de tu equipo al nivel 50.", goal: () => [Math.max(0, ...park().party.map((m) => m.lv || 0)), 50] },
    { id: "pp_lv100", cat: "pokepark", icon: "trophy", name: "Maestro Pokémon", desc: "Sube un Pokémon de tu equipo al nivel 100.", goal: () => [Math.max(0, ...park().party.map((m) => m.lv || 0)), 100] },
    { id: "pp_friend", cat: "pokepark", icon: "heart", name: "Mejores amigos", desc: "Llena la amistad de un Pokémon de tu equipo.", goal: () => [Math.max(0, ...park().party.map((m) => m.fr || 0)), FRIENDSHIP_MAX] },
    { id: "pp_legend", cat: "pokepark", icon: "crown", name: "Visita legendaria", desc: "Recibe la visita de un legendario.", goal: (st) => [Math.max(s("legends")(st), Object.keys(park().legends).length), 1] },
    { id: "pp_legend_friend", cat: "pokepark", icon: "crown", name: "Vínculo legendario", desc: "Llena la amistad de un legendario.", goal: () => [Math.max(0, ...Object.values(park().legends).map((l) => l.fr || 0)), FRIENDSHIP_MAX] },
    { id: "pp_fullscreen", cat: "pokepark", icon: "maximize", name: "Salvapantallas", desc: "Pon el PokéPark a pantalla completa.", goal: (st) => [s("fullscreen")(st), 1] },
    // Comunidad
    { id: "account", cat: "community", icon: "user", name: "Uno más", desc: "Crea tu cuenta o inicia sesión.", goal: () => [loggedIn() ? 1 : 0, 1] },
    { id: "rate_first", cat: "community", icon: "star", name: "Crítico", desc: "Puntúa un juego que te hayas pasado.", goal: (st) => [s("ratings")(st), 1] },
    { id: "rate_10", cat: "community", icon: "star", name: "Crítico exigente", desc: "Puntúa 10 juegos.", goal: (st) => [s("ratings")(st), 10] },
    { id: "report_first", cat: "community", icon: "flag", name: "Colaborador", desc: "Envía un bug, una sugerencia o una duda.", goal: (st) => [s("reports")(st), 1] },
    { id: "answer", cat: "community", icon: "message", name: "Echando una mano", desc: "Responde la duda de otra persona.", goal: (st) => [s("answers")(st), 1] },
    { id: "suggestion_ok", cat: "community", icon: "check", name: "Visionario", desc: "Consigue que acepten una sugerencia tuya.", goal: (st) => [s("acceptedSuggestions")(st), 1] },
    { id: "bug_solved", cat: "community", icon: "bug", name: "Cazabugs", desc: "Reporta un bug que acabe solucionado.", goal: (st) => [s("solvedBugs")(st), 1] },
    { id: "chat_first", cat: "community", icon: "message", name: "Rompiendo el hielo", desc: "Escribe en el chat de la comunidad.", goal: (st) => [s("chat")(st), 1] },
    { id: "chat_100", cat: "community", icon: "message", name: "Alma de la fiesta", desc: "Escribe 100 mensajes en el chat.", goal: (st) => [s("chat")(st), 100] },
    { id: "completionist", cat: "community", icon: "trophy", name: "Completista", desc: "Desbloquea todos los demás logros.", goal: () => [unlockedCount(true), DEFS.length - 1] },
  ];

  let stats = {};
  let unlocked = {}; // id -> fecha
  let user = null;
  let saveTimer = null;
  let checkTimer = null;
  const listeners = new Set();

  const loggedIn = () => !!user;
  const unlockedCount = (excludeSelf) => Object.keys(unlocked).filter((id) => !(excludeSelf && id === "completionist")).length;

  function progress(def) {
    let [cur, max] = def.goal(stats);
    cur = Math.max(0, Math.min(Number(cur) || 0, max));
    return { cur, max, done: cur >= max };
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.electronAPI.saveStats(stats), 800);
  }

  function emit() {
    listeners.forEach((fn) => fn());
  }

  // Revisa todos los logros y desbloquea los que ya se cumplen.
  async function check() {
    if (!user) return emit();
    const fresh = [];
    // Dos pasadas: "Completista" depende de los demás.
    for (let pass = 0; pass < 2; pass++) {
      for (const def of DEFS) {
        if (unlocked[def.id] || !progress(def).done) continue;
        unlocked[def.id] = new Date().toISOString();
        fresh.push(def);
      }
    }
    if (fresh.length) {
      window.electronAPI.cloud("unlock", fresh.map((d) => d.id));
      fresh.slice(0, 3).forEach((d, i) => setTimeout(() => toast(d), i * 1200));
      if (fresh.length > 3) setTimeout(() => toast({ name: `Y ${fresh.length - 3} logros más`, desc: "Míralos en Comunidad > Logros.", icon: "trophy" }), 3600);
    }
    emit();
  }

  const scheduleCheck = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, 400);
  };

  function toast(def) {
    const el = document.createElement("div");
    el.className = "ach-toast";
    el.innerHTML = `
      <span class="ach-toast-icon">${icon(def.icon || "trophy")}</span>
      <span class="ach-toast-text"><small>Logro desbloqueado</small><b>${escapeHtml(def.name)}</b><em>${escapeHtml(def.desc || "")}</em></span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => {
      el.classList.remove("is-in");
      setTimeout(() => el.remove(), 400);
    }, 4200);
  }

  // Con sesión: se traen los ya desbloqueados de la cuenta.
  async function setUser(u) {
    user = u || null;
    if (!user) {
      unlocked = {};
      return emit();
    }
    const res = await window.electronAPI.cloud("achievements");
    unlocked = res?.ok ? { ...res.achievements } : {};
    // Logros que dependen de lo que pasa en el servidor (sugerencias
    // aceptadas, bugs solucionados, dudas respondidas).
    const mine = await window.electronAPI.cloud("myReports");
    if (mine?.ok) {
      stats.acceptedSuggestions = mine.reports.filter((r) => r.type === "suggestion" && r.status === "accepted").length;
      stats.solvedBugs = mine.reports.filter((r) => r.type === "bug" && r.status === "solved").length;
      stats.reports = Math.max(stats.reports || 0, mine.reports.length);
      stats.answers = Math.max(stats.answers || 0, mine.answeredQuestions || 0);
    }
    const rated = await window.electronAPI.cloud("ratingsMine");
    if (rated?.ok) stats.ratings = Math.max(stats.ratings || 0, Object.keys(rated.ratings || {}).length);
    save();
    check();
  }

  async function init() {
    stats = (await window.electronAPI.getStats().catch(() => ({}))) || {};
    const st = await window.electronAPI.cloud("status").catch(() => null);
    await setUser(st?.user);
    window.electronAPI.onCloudStatus((s) => {
      if ((s.user?.id || null) !== (user?.id || null)) setUser(s.user);
    });
    window.electronAPI.onCloudData(async () => {
      stats = (await window.electronAPI.getStats().catch(() => stats)) || stats;
      scheduleCheck();
    });
    // El PokéPark avanza solo (niveles, amistad): se revisa cada minuto.
    setInterval(scheduleCheck, 60 * 1000);
  }

  // Los contadores se tocan solo cuando ya están cargados de disco: si no,
  // lo que se cuenta al arrancar (el tema) podía guardarse encima de todo
  // el progreso.
  const ready = init().catch((err) => console.error("logros", err));
  const whenReady = (fn) => (...args) => ready.then(() => fn(...args));

  window.Achievements = {
    CATEGORIES,
    DEFS,
    list: () => DEFS.map((d) => ({ ...d, ...progress(d), unlockedAt: unlocked[d.id] || null })),
    loggedIn,
    track: whenReady((key, n = 1) => {
      stats[key] = (stats[key] || 0) + n;
      save();
      scheduleCheck();
    }),
    // Fija un contador a un valor (si es mayor que el que había).
    trackMax: whenReady((key, value) => {
      if ((stats[key] || 0) >= value) return;
      stats[key] = value;
      save();
      scheduleCheck();
    }),
    trackTheme: whenReady((id) => {
      const set = new Set(stats.themes || []);
      if (set.has(id)) return;
      set.add(id);
      stats.themes = [...set];
      save();
      scheduleCheck();
    }),
    refresh: () => ready.then(scheduleCheck),
    recheckUser: () => window.electronAPI.cloud("status").then((s) => setUser(s?.user)),
    onChange: (fn) => listeners.add(fn),
  };
})();
