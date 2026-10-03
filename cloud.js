// =====================================================================
// Cuenta y nube (API de alejandrodev.es/sharingan_api)
// =====================================================================
// La cuenta es opcional. Con sesión iniciada, la biblioteca, el PokéPark y
// el progreso de los logros se guardan también en la cuenta: se suben unos
// segundos después de cada cambio y se bajan al arrancar. El token de sesión
// se guarda cifrado con el almacén seguro de Windows.
//
// Reglas de sincronización:
//  - Los datos del PC son de otra cuenta (settings.cloudDataOwner, que no
//    se borra al cerrar sesión): se sustituyen por los de la cuenta nueva
//    (y si es nueva, se empieza de cero). Nunca se mezclan dos usuarios.
//  - Primera vez que este PC entra en una cuenta (o vuelve a entrar la
//    misma tras cerrar sesión): si una de las dos partes está vacía se usa
//    la otra; si las dos tienen datos se combinan (nada se pierde) y el
//    resultado se sube.
//  - Después: si hay cambios locales sin subir (p. ej. sin conexión) se
//    combinan con los de la nube; si no, se baja la versión de la nube si
//    es más nueva que la última sincronización.
const API_URL = process.env.SL_CLOUD_URL || "https://alejandrodev.es/sharingan_api/index.php";
const PUSH_DELAY_MS = 4000;

class CloudError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  invalid_credentials: "Usuario o contraseña incorrectos.",
  username_taken: "Ese nombre de usuario ya existe.",
  invalid_username: "El usuario debe tener de 3 a 20 caracteres: letras, números, punto, guion o guion bajo.",
  invalid_password: "La contraseña debe tener al menos 8 caracteres.",
  too_many_attempts: "Demasiados intentos fallidos. Espera unos minutos.",
  too_many_accounts: "Se han creado demasiadas cuentas desde tu conexión. Prueba dentro de una hora.",
  unauthorized: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
  forbidden: "No tienes permiso para hacer eso.",
  rate_limited: "Vas demasiado rápido. Espera un momento.",
  not_completed: "Solo puedes puntuar juegos que te hayas pasado.",
  invalid_title: "El título debe tener entre 4 y 120 caracteres.",
  invalid_body: "El texto es demasiado corto o demasiado largo.",
  not_found: "No se ha encontrado.",
  network: "No se puede conectar con el servidor. Revisa tu conexión.",
  invalid_channel: "Ese canal no existe.",
  invalid_type: "Elige si es un bug, una sugerencia o una duda.",
  invalid_rating: "La nota tiene que ser de 1 a 5 estrellas.",
  invalid_status: "Ese estado no vale para este reporte.",
  too_large_library: "Tu biblioteca es demasiado grande para guardarla en la cuenta.",
  too_large_pokepark: "Los datos del PokéPark son demasiado grandes para guardarlos en la cuenta.",
  missing_config: "El servidor todavía no está configurado.",
  config_error: "El servidor está mal configurado. Avisa al administrador.",
  invalid_config: "El servidor está mal configurado. Avisa al administrador.",
  db_connection_failed: "El servidor no puede conectar con la base de datos.",
  server_error: "El servidor ha tenido un error. Prueba otra vez en un rato.",
  user_not_found: "No existe ningún usuario con ese nombre.",
  trade_self: "No puedes intercambiar contigo mismo.",
  too_many_trades: "Ya tienes 6 ofertas de intercambio pendientes. Cancela alguna antes.",
  already_offered: "Ya has ofrecido ese Pokémon en otro intercambio.",
  trade_unavailable: "Ese intercambio ya no está disponible.",
  invalid_mon: "Ese Pokémon no se puede intercambiar.",
};
const describe = (err) => {
  if (MESSAGES[err?.code]) return MESSAGES[err.code];
  if (/^http_5/.test(err?.code || "")) return "El servidor no responde bien ahora mismo. Prueba en un rato.";
  return "Ha fallado la conexión con el servidor.";
};

function createCloud(hooks) {
  const { safeStorage, settings, saveSettings, notify } = hooks;
  let pushTimer = null;
  let pushing = false;
  let entering = false; // entrando en una cuenta: no se marca ni se sube nada hasta acabar
  const dirty = new Set(settings.cloudDirty || []);

  // ------------------------------------------------------------ Sesión
  function token() {
    if (!settings.cloudToken) return null;
    try {
      return safeStorage.decryptString(Buffer.from(settings.cloudToken, "base64"));
    } catch {
      return null;
    }
  }

  function setSession(tok, user) {
    if (tok) settings.cloudToken = safeStorage.encryptString(tok).toString("base64");
    else delete settings.cloudToken;
    if (user) settings.cloudUser = user;
    else delete settings.cloudUser;
    saveSettings();
    notify("cloud:status", status());
  }

  const user = () => (token() ? settings.cloudUser || null : null);

  // Lo que hay en el PC es de otra cuenta (p. ej. falló la red al cambiar):
  // no se sube hasta que se sustituya por lo de la cuenta actual.
  const foreignData = () => {
    const owner = settings.cloudDataOwner ?? settings.cloudLinkedUser ?? null;
    return owner != null && owner !== settings.cloudUser?.id;
  };

  function status() {
    return {
      user: user(),
      lastSync: settings.cloudLastSync || null,
      pending: dirty.size > 0,
      syncing: pushing,
    };
  }

  // ------------------------------------------------------------ HTTP
  async function api(route, { body, query, auth = true } = {}) {
    const url = new URL(API_URL);
    url.searchParams.set("r", route);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const tok = auth ? token() : null;
    if (tok) {
      headers.Authorization = `Bearer ${tok}`;
      headers["X-Auth-Token"] = tok;
    }
    let res;
    try {
      res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new CloudError("network", 0);
    }
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) {
      const code = json?.error || `http_${res.status}`;
      // Token caducado o anulado: se cierra la sesión local.
      if (res.status === 401 && tok && route !== "auth/login") setSession(null, null);
      throw new CloudError(code, res.status);
    }
    return json;
  }

  // Envoltorio para IPC: { ok, ...datos } o { ok: false, error }.
  const safe = (fn) => async (...args) => {
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      if (!(err instanceof CloudError)) console.error("nube", err);
      return { ok: false, error: describe(err), code: err?.code };
    }
  };

  // ------------------------------------------------------------ Combinar
  function mergeLibrary(local, remote) {
    const byId = (list) => new Map((list || []).map((g) => [Number(g.id), g]));
    const completed = byId(remote?.completedGames);
    for (const [id, g] of byId(local?.completedGames)) completed.set(id, { ...completed.get(id), ...g });
    const games = byId(remote?.games);
    for (const [id, g] of byId(local?.games)) games.set(id, { ...games.get(id), ...g });
    for (const id of completed.keys()) games.delete(id); // pasado gana a pendiente

    const sagas = new Map();
    for (const s of [...(remote?.sagas || []), ...(local?.sagas || [])]) {
      const key = String(s.name || "").trim().toLowerCase();
      const prev = sagas.get(key);
      if (!prev) sagas.set(key, { ...s, gameIds: [...(s.gameIds || [])] });
      else for (const id of s.gameIds || []) if (!prev.gameIds.includes(id)) prev.gameIds.push(id);
    }
    return { games: [...games.values()], completedGames: [...completed.values()], sagas: [...sagas.values()] };
  }

  // PokéPark: no se puede mezclar con sentido; se queda el que más progreso tiene.
  function pickPokepark(local, remote) {
    const score = (p) => (p?.party || []).reduce((acc, m) => acc + (m.lv || 0), 0) + Object.keys(p?.legends || {}).length;
    if (!remote) return local;
    if (!local) return remote;
    return score(local) >= score(remote) ? local : remote;
  }

  function mergeStats(local, remote) {
    const out = { ...(remote || {}) };
    for (const [k, v] of Object.entries(local || {})) {
      if (typeof v === "number") out[k] = Math.max(v, out[k] || 0);
      else if (Array.isArray(v)) out[k] = [...new Set([...(out[k] || []), ...v])];
      else out[k] = v;
    }
    return out;
  }

  const isEmptyLibrary = (l) => !l || (!(l.games || []).length && !(l.completedGames || []).length && !(l.sagas || []).length);

  // ------------------------------------------------------------ Sincronizar
  async function reconcile() {
    if (!token()) return;
    const remote = await api("sync");
    const local = { library: hooks.getLibrary(), pokepark: hooks.getPokepark(), stats: hooks.getStats() };
    const me = settings.cloudUser?.id;
    const firstTime = settings.cloudLinkedUser !== me;
    const remoteNewer = remote.updatedAt && (!settings.cloudLastSync || remote.updatedAt > settings.cloudLastSync);
    const owner = settings.cloudDataOwner ?? settings.cloudLinkedUser ?? null;
    const foreign = owner != null && owner !== me;

    let library = local.library;
    let pokepark = local.pokepark;
    let stats = local.stats;
    const changedLocal = { library: false, pokepark: false };

    if (foreign) {
      // Lo del PC es de otro usuario: se cambia entero por lo de esta cuenta.
      library = remote.library || { games: [], completedGames: [], sagas: [] };
      pokepark = remote.pokepark || null;
      stats = remote.stats || {};
      changedLocal.library = changedLocal.pokepark = true;
      hooks.onSwitch?.();
    } else if (firstTime || dirty.size) {
      if (isEmptyLibrary(remote.library)) library = local.library;
      else if (isEmptyLibrary(local.library)) (library = remote.library), (changedLocal.library = true);
      else (library = mergeLibrary(local.library, remote.library)), (changedLocal.library = true);
      pokepark = pickPokepark(local.pokepark, remote.pokepark);
      changedLocal.pokepark = pokepark !== local.pokepark;
      stats = mergeStats(local.stats, remote.stats);
    } else if (remoteNewer) {
      if (remote.library) (library = remote.library), (changedLocal.library = true);
      if (remote.pokepark) (pokepark = remote.pokepark), (changedLocal.pokepark = true);
      stats = mergeStats(local.stats, remote.stats);
    }

    if (changedLocal.library) hooks.setLibrary(library);
    if (changedLocal.pokepark) hooks.setPokepark(pokepark);
    hooks.setStats(stats);
    if (changedLocal.library || changedLocal.pokepark) notify("cloud:dataChanged", { ...changedLocal, switched: foreign });

    // Se sube el resultado si había algo local que la nube no tiene (lo de
    // otro usuario nunca se sube).
    if (foreign) {
      settings.cloudLastSync = remote.updatedAt || null;
    } else if (firstTime || dirty.size || !remote.updatedAt) {
      const res = await api("sync", { body: { library, pokepark, stats } });
      settings.cloudLastSync = res.updatedAt;
    } else if (remote.updatedAt) {
      settings.cloudLastSync = remote.updatedAt;
    }
    dirty.clear();
    settings.cloudDirty = [];
    settings.cloudLinkedUser = me;
    settings.cloudDataOwner = me;
    saveSettings();
    notify("cloud:status", status());
  }

  function markDirty(what) {
    if (!token() || entering || foreignData()) return;
    dirty.add(what);
    settings.cloudDirty = [...dirty];
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push().catch(() => {}), PUSH_DELAY_MS);
  }

  async function push() {
    clearTimeout(pushTimer);
    if (!token() || !dirty.size || pushing || entering || foreignData()) return;
    pushing = true;
    const what = [...dirty];
    const body = {};
    if (what.includes("library")) body.library = hooks.getLibrary();
    if (what.includes("pokepark")) body.pokepark = hooks.getPokepark();
    if (what.includes("stats")) body.stats = hooks.getStats();
    try {
      const res = await api("sync", { body });
      what.forEach((w) => dirty.delete(w));
      settings.cloudDirty = [...dirty];
      settings.cloudLastSync = res.updatedAt;
      saveSettings();
    } catch (err) {
      // Sin conexión: se queda pendiente y se reintenta más tarde.
      if (err.code === "network") pushTimer = setTimeout(() => push().catch(() => {}), 60000);
      throw err;
    } finally {
      pushing = false;
      notify("cloud:status", status());
    }
  }

  // ------------------------------------------------------------ Acciones
  async function enter(route, username, password) {
    const res = await api(route, { body: { username, password }, auth: false });
    clearTimeout(pushTimer);
    entering = true;
    try {
      setSession(res.token, res.user);
      await reconcile();
    } finally {
      entering = false;
    }
    return { user: res.user };
  }

  const actions = {
    status: async () => status(),
    register: (username, password) => enter("auth/register", username, password),
    login: (username, password) => enter("auth/login", username, password),
    logout: async () => {
      await push().catch(() => {});
      await api("auth/logout", { body: {} }).catch(() => {});
      delete settings.cloudLinkedUser;
      delete settings.cloudLastSync;
      setSession(null, null);
      dirty.clear();
      settings.cloudDirty = [];
      saveSettings();
      return {};
    },
    refreshMe: async () => {
      const res = await api("auth/me");
      settings.cloudUser = res.user;
      saveSettings();
      return { user: res.user };
    },
    syncNow: async () => {
      await push();
      await reconcile();
      return status();
    },
    ratingsAvg: async (ids) => api("ratings/avg", { query: { ids: (ids || []).slice(0, 300).join(",") }, auth: false }),
    ratingsMine: async () => api("ratings/mine"),
    // Antes de puntuar se sube la biblioteca: el servidor comprueba que el
    // juego está en tus pasados.
    rate: async (gameId, score) => {
      if (dirty.has("library")) await push();
      return api("ratings/set", { body: { gameId, score } });
    },
    reports: async (filters) => api("reports/list", { query: filters || {}, auth: false }),
    report: async (id) => api("reports/get", { query: { id }, auth: false }),
    myReports: async () => api("reports/mine"),
    createReport: async (data) => api("reports/create", { body: data }),
    replyReport: async (id, body) => api("reports/reply", { body: { id, body } }),
    setReportStatus: async (id, st) => api("reports/status", { body: { id, status: st } }),
    chat: async (channel, after) => api("chat/list", { query: { channel, after: after || 0 }, auth: false }),
    sendChat: async (channel, body) => api("chat/send", { body: { channel, body } }),
    deleteChat: async (id) => api("chat/delete", { body: { id } }),
    achievements: async () => api("achievements/list"),
    unlock: async (ids) => api("achievements/unlock", { body: { ids } }),
    lock: async (ids) => api("achievements/lock", { body: { ids } }),
    profile: async (username) => api("users/profile", { query: { username }, auth: false }),
    trades: async () => api("trades/list"),
    tradeOffer: async (to, mon) => api("trades/offer", { body: { to, mon } }),
    tradeAccept: async (id, mon) => api("trades/accept", { body: { id, mon } }),
    tradeCancel: async (id) => api("trades/cancel", { body: { id } }),
    tradeReject: async (id) => api("trades/reject", { body: { id } }),
    tradeClaim: async (id) => api("trades/claim", { body: { id } }),
  };

  const ipc = Object.fromEntries(Object.entries(actions).map(([k, fn]) => [k, safe(fn)]));

  return {
    ipc,
    markDirty,
    loggedIn: () => !!token(),
    // Al arrancar: bajar/combinar lo de la cuenta (sin bloquear la app).
    start: () => {
      if (!token()) return;
      // El usuario guardado puede tener permisos viejos (admin/tester): se
      // pide de nuevo al arrancar.
      api("auth/me")
        .then((res) => {
          if (!res?.user) return;
          settings.cloudUser = res.user;
          saveSettings();
          notify("cloud:status", status());
        })
        .catch(() => {});
      reconcile().catch((err) => console.error("sync inicial", err.code || err));
    },
    flush: () => push().catch(() => {}),
  };
}

module.exports = { createCloud, API_URL };
