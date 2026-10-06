// =====================================================================
// Spotify
// =====================================================================
// Controla la música de Spotify desde el launcher: qué suena, play/pausa,
// saltos, posición, volumen, aleatorio, repetición y en qué dispositivo suena.
//
// "Trae tu propio Client ID": en modo desarrollo Spotify solo deja entrar al
// dueño de la app (y a 5 usuarios añadidos a mano), así que cada usuario crea
// su propia app en el Dashboard y pega su Client ID (asistente en
// spotify-setup.js). El build no lleva ningún Client ID. Se lee de:
//   1. settings.spotifyClientId (userData/settings.json, el que pega cada uno)
//   2. la cuenta: al dueño (admin con sesión iniciada) se lo da la API
//      (hooks.ownerClientId, ruta spotify/client), en cualquier PC y sin pasos
//
// Inicio de sesión: Authorization Code con PKCE (sin client secret). Se abre
// el navegador y Spotify vuelve a un servidor local de un solo uso en
// http://127.0.0.1:43821/callback (tiene que coincidir con la Redirect URI de
// la app en el Dashboard). Los tokens se guardan cifrados con safeStorage
// (DPAPI en Windows). El Client ID va sin cifrar: es público por diseño (sale
// en la URL de cada inicio de sesión) y sin el refresh token no sirve de nada.
const http = require("http");
const crypto = require("crypto");

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const CLIENT_ID_RE = /^[0-9a-f]{32}$/;
const SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-private"];
const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

class SpotifyError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Cada error dice qué ha pasado y qué hacer.
const MESSAGES = {
  no_client: "Primero pega el Client ID de tu app.",
  bad_client_id: "El Client ID son 32 letras y números. Cópialo otra vez.",
  invalid_client: "Spotify no encuentra ninguna app con ese Client ID. Cópialo otra vez desde tu app (y que no sea el Client secret).",
  not_connected: "Conecta tu cuenta de Spotify.",
  premium_required: "Spotify solo deja controlar la música con una cuenta Premium.",
  no_device: "No hay ningún dispositivo con Spotify abierto. Ábrelo en el PC o en el móvil.",
  rate_limited: "Spotify pide ir más despacio. Espera unos segundos.",
  network: "No se puede conectar con Spotify. Revisa tu conexión.",
  login_cancelled: "Has cancelado la conexión con Spotify.",
  login_denied: "Has pulsado Cancelar en Spotify. Prueba otra vez cuando quieras.",
  login_timeout: "El navegador no ha respondido. Si Spotify enseñaba un error, revisa la Redirect URI de tu app y prueba otra vez.",
  login_failed: "Spotify no ha aceptado la conexión. Revisa que la Redirect URI de tu app sea exactamente la del paso 2.",
  login_busy: "Ya hay una conexión con Spotify en marcha en el navegador.",
  port_busy: `Otro programa está usando el puerto ${PORT}. Ciérralo y prueba otra vez.`,
  not_allowed_user: "Has entrado con una cuenta de Spotify distinta a la que creó la app. Entra con esa cuenta y prueba otra vez.",
  restricted: "Spotify no deja hacer eso ahora mismo en este dispositivo.",
};
const describe = (err) => MESSAGES[err?.code] || "Spotify ha devuelto un error. Prueba otra vez.";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Saca el Client ID de lo que se pegue (aunque venga con espacios o dentro
// de una URL del Dashboard). null si no hay nada con forma de Client ID.
const cleanClientId = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  return CLIENT_ID_RE.test(s) ? s : s.match(/[0-9a-f]{32}/)?.[0] || null;
};

function createSpotify(hooks) {
  const { safeStorage, settings, saveSettings, shell } = hooks;
  let pendingLogin = null; // { server, reject }
  let refreshing = null;
  let ownerId = null; // el de la cuenta del dueño (se actualiza antes de cada acción)

  // ------------------------------------------------------------ Client ID
  async function refreshOwner() {
    try {
      ownerId = cleanClientId(await hooks.ownerClientId?.());
    } catch {
      ownerId = null;
    }
  }

  function clientInfo() {
    const own = cleanClientId(settings.spotifyClientId);
    if (own) return { id: own, source: "settings" };
    return ownerId ? { id: ownerId, source: "account" } : { id: null, source: null };
  }
  const clientId = () => clientInfo().id;

  // ------------------------------------------------------------ Tokens
  function readAuth() {
    if (!settings.spotifyAuth) return null;
    try {
      const auth = JSON.parse(safeStorage.decryptString(Buffer.from(settings.spotifyAuth, "base64")));
      // Los tokens son de una app concreta: si se cambia de Client ID, no valen.
      // (Los de antes de 3.1.1 no guardaban el Client ID: son del que haya.)
      if (auth.clientId && auth.clientId !== clientId()) return null;
      return auth;
    } catch {
      return null;
    }
  }

  function writeAuth(auth) {
    if (auth) settings.spotifyAuth = safeStorage.encryptString(JSON.stringify(auth)).toString("base64");
    else delete settings.spotifyAuth;
    saveSettings();
  }

  async function tokenRequest(params, id = clientId()) {
    if (!id) throw new SpotifyError("no_client");
    let res;
    try {
      res = await fetch(`${ACCOUNTS}/api/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: id, ...params }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new SpotifyError("network", 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) {
      if (json?.error === "invalid_client") throw new SpotifyError("invalid_client", res.status);
      if (params.grant_type === "authorization_code") throw new SpotifyError("login_failed", res.status);
      // invalid_grant = el refresh token ya no vale (revocado o caducado).
      if (json?.error === "invalid_grant") {
        writeAuth(null);
        throw new SpotifyError("not_connected", 401);
      }
      throw new SpotifyError(json?.error || `http_${res.status}`, res.status);
    }
    return json;
  }

  function saveTokens(json, prev) {
    const auth = {
      clientId: clientId(),
      access: json.access_token,
      // Spotify puede rotar el refresh token: si no manda uno, sigue el de antes.
      refresh: json.refresh_token || prev?.refresh,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    };
    writeAuth(auth);
    return auth;
  }

  async function accessToken(force = false) {
    const auth = readAuth();
    if (!auth?.refresh) throw new SpotifyError("not_connected", 401);
    if (!force && auth.access && auth.expiresAt - Date.now() > 60000) return auth.access;
    // Varias peticiones a la vez comparten la misma renovación.
    refreshing ||= tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refresh })
      .then((json) => saveTokens(json, auth).access)
      .finally(() => (refreshing = null));
    return refreshing;
  }

  // ------------------------------------------------------------ Login (PKCE)
  function login() {
    if (pendingLogin) return Promise.reject(new SpotifyError("login_busy"));
    const id = clientId();
    if (!id) return Promise.reject(new SpotifyError("no_client"));
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    return new Promise((resolve, reject) => {
      let timer = null;
      const finish = (err, value) => {
        clearTimeout(timer);
        // Se suelta el puerto (el navegador puede dejar la conexión abierta).
        server.close();
        setTimeout(() => server.closeAllConnections?.(), 1500);
        pendingLogin = null;
        if (err) reject(err);
        else resolve(value);
      };

      const page = (title, text) => `<!doctype html><html lang="es"><meta charset="utf-8"><title>${title}</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0d0d;color:#eee;font-family:system-ui,sans-serif;text-align:center">
<div><h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#aaa">${text}</p></div></body></html>`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const send = (ok) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ok ? page("Spotify conectado", "Ya puedes cerrar esta pestaña y volver a Sharingan Launcher.") : page("No se ha conectado", "Vuelve a Sharingan Launcher y prueba otra vez."));
        };
        if (url.searchParams.get("state") !== state) {
          send(false);
          return finish(new SpotifyError("login_cancelled"));
        }
        const code = url.searchParams.get("code");
        if (!code) {
          send(false);
          // access_denied = ha pulsado "Cancelar" en la página de Spotify.
          return finish(new SpotifyError(url.searchParams.get("error") === "access_denied" ? "login_denied" : "login_cancelled"));
        }
        try {
          const json = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
          saveTokens(json);
          send(true);
          finish(null, true);
        } catch (err) {
          send(false);
          finish(err);
        }
      });

      server.on("error", (err) => finish(new SpotifyError(err.code === "EADDRINUSE" ? "port_busy" : "network")));
      server.listen(PORT, "127.0.0.1", () => {
        pendingLogin = { server, reject: (err) => finish(err) };
        timer = setTimeout(() => finish(new SpotifyError("login_timeout")), LOGIN_TIMEOUT_MS);
        const auth = new URL(`${ACCOUNTS}/authorize`);
        auth.search = new URLSearchParams({
          client_id: id,
          response_type: "code",
          redirect_uri: REDIRECT_URI,
          code_challenge_method: "S256",
          code_challenge: challenge,
          scope: SCOPES.join(" "),
          state,
        }).toString();
        shell.openExternal(auth.toString());
      });
    });
  }

  // ------------------------------------------------------------ Web API
  async function call(method, path, { query, body } = {}, retried = false) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const tok = await accessToken();
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new SpotifyError("network", 0);
    }
    if (res.status === 401 && !retried) {
      await accessToken(true);
      return call(method, path, { query, body }, true);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json;

    const reason = json?.error?.reason || "";
    const message = String(json?.error?.message || "");
    if (res.status === 429) throw new SpotifyError("rate_limited", 429);
    // Desde 2026 el dueño de una app en modo desarrollo también necesita Premium.
    if (reason === "PREMIUM_REQUIRED" || /premium/i.test(message)) throw new SpotifyError("premium_required", 403);
    if (reason === "NO_ACTIVE_DEVICE" || res.status === 404) throw new SpotifyError("no_device", res.status);
    if (/not registered|not be registered/i.test(message)) throw new SpotifyError("not_allowed_user", 403);
    if (res.status === 403) throw new SpotifyError("restricted", 403);
    throw new SpotifyError(`http_${res.status}`, res.status);
  }

  // Solo lo que pinta la ventana.
  function mapState(p) {
    if (!p) return null;
    const it = p.item;
    const images = it?.album?.images || it?.images || it?.show?.images || [];
    const pick = (min) => [...images].sort((a, b) => (a.width || 0) - (b.width || 0)).find((i) => (i.width || 0) >= min) || images[0];
    return {
      isPlaying: !!p.is_playing,
      progressMs: p.progress_ms || 0,
      shuffle: !!p.shuffle_state,
      repeat: p.repeat_state || "off",
      type: p.currently_playing_type,
      device: p.device ? mapDevice(p.device) : null,
      canSeek: !p.actions?.disallows?.seeking,
      item: it
        ? {
            id: it.id || it.uri || it.name,
            name: it.name,
            artist: it.artists?.[0]?.name || it.show?.name || "",
            artists: (it.artists || []).map((a) => a.name).join(", ") || it.show?.name || "",
            album: it.album?.name || it.show?.name || "",
            durationMs: it.duration_ms || 0,
            cover: pick(300)?.url || null,
            thumb: pick(64)?.url || null,
            url: it.external_urls?.spotify || null,
          }
        : null,
    };
  }

  const mapDevice = (d) => ({
    id: d.id,
    name: d.name,
    type: String(d.type || "").toLowerCase(),
    active: !!d.is_active,
    volume: d.volume_percent ?? null,
    supportsVolume: d.supports_volume !== false && d.volume_percent !== null,
    restricted: !!d.is_restricted,
  });

  // ------------------------------------------------------------ Letras
  // Spotify no da letras por su API: salen de LRCLIB (lrclib.net, abierta y
  // sin clave), con tiempos por línea cuando los tiene.
  const lyricsCache = new Map();

  function parseLrc(lrc) {
    const lines = [];
    for (const raw of String(lrc || "").split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!stamps.length) continue;
      const text = raw.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of stamps) lines.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text });
    }
    return lines.sort((a, b) => a.t - b.t);
  }

  async function lrclib(path, query) {
    const url = new URL(`https://lrclib.net/api/${path}`);
    for (const [k, v] of Object.entries(query)) if (v) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": hooks.userAgent || "Sharingan Launcher" }, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new SpotifyError("network", 0);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new SpotifyError(`http_${res.status}`, res.status);
    return res.json();
  }

  async function findLyrics({ name, artist, album, durationMs }) {
    const duration = Math.round((durationMs || 0) / 1000);
    let hit = await lrclib("get", { track_name: name, artist_name: artist, album_name: album, duration });
    if (!hit?.syncedLyrics) {
      // Sin coincidencia exacta: se busca y se queda la de duración más parecida.
      const list = (await lrclib("search", { track_name: name, artist_name: artist })) || [];
      const close = list
        .filter((x) => x.syncedLyrics || x.plainLyrics || x.instrumental)
        .filter((x) => !duration || Math.abs((x.duration || 0) - duration) <= 4)
        .sort((a, b) => Number(!a.syncedLyrics) - Number(!b.syncedLyrics) || Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
      if (close[0] && (!hit || close[0].syncedLyrics)) hit = close[0];
    }
    if (!hit) return { kind: "none" };
    if (hit.instrumental) return { kind: "instrumental" };
    if (hit.syncedLyrics) return { kind: "synced", lines: parseLrc(hit.syncedLyrics) };
    if (hit.plainLyrics) return { kind: "plain", lines: hit.plainLyrics.split(/\r?\n/).map((text) => ({ text: text.trim() })) };
    return { kind: "none" };
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

  // ¿Existe una app con este Client ID? Se canjea un código inventado: si la
  // app no existe Spotify dice invalid_client; si existe, invalid_grant.
  async function clientExists(id) {
    try {
      await tokenRequest({ grant_type: "authorization_code", code: "sharingan-check", redirect_uri: REDIRECT_URI, code_verifier: "x".repeat(64) }, id);
      return true;
    } catch (err) {
      if (err.code === "invalid_client") return false;
      if (err.code === "login_failed") return true;
      throw err;
    }
  }

  const config = () => {
    const c = clientInfo();
    return { clientId: c.id, source: c.source, connected: !!(c.id && readAuth()?.refresh), redirectUri: REDIRECT_URI };
  };

  const actions = {
    status: async () => config(),
    config: async () => config(),
    checkClientId: async (raw) => {
      const id = cleanClientId(raw);
      if (!id) throw new SpotifyError("bad_client_id");
      if (!(await clientExists(id))) throw new SpotifyError("invalid_client");
      return { clientId: id };
    },
    // Guarda el Client ID. Si es otro distinto, la sesión de la app anterior
    // ya no sirve y hay que volver a conectar.
    setClientId: async (raw) => {
      const id = cleanClientId(raw);
      if (!id) throw new SpotifyError("bad_client_id");
      if (id !== clientId()) delete settings.spotifyAuth;
      settings.spotifyClientId = id;
      saveSettings();
      return config();
    },
    // Olvida la app y la sesión (para empezar de cero o cambiar de app).
    forget: async () => {
      pendingLogin?.reject(new SpotifyError("login_cancelled"));
      delete settings.spotifyClientId;
      delete settings.spotifyAuth;
      saveSettings();
      return config();
    },
    // Tras conectar: quién es y si tiene Premium (sin Premium no se puede
    // controlar nada, solo ver qué suena).
    test: async () => {
      const me = await call("GET", "/me");
      return { name: me?.display_name || me?.id || "", premium: me?.product ? me.product === "premium" : null };
    },
    connect: async () => {
      await login();
      return { connected: true };
    },
    cancelConnect: async () => {
      pendingLogin?.reject(new SpotifyError("login_cancelled"));
      return {};
    },
    disconnect: async () => {
      writeAuth(null);
      return { connected: false };
    },
    state: async () => ({ state: mapState(await call("GET", "/me/player", { query: { additional_types: "episode" } })) }),
    devices: async () => ({ devices: ((await call("GET", "/me/player/devices"))?.devices || []).map(mapDevice) }),
    play: async (deviceId) => {
      try {
        await call("PUT", "/me/player/play", { query: { device_id: deviceId } });
      } catch (err) {
        // Nada activo: se despierta el primer dispositivo disponible.
        if (err.code !== "no_device" || deviceId) throw err;
        const list = (await call("GET", "/me/player/devices"))?.devices || [];
        const target = list.find((d) => d.type === "Computer") || list[0];
        if (!target) throw err;
        await call("PUT", "/me/player", { body: { device_ids: [target.id], play: true } });
      }
      return {};
    },
    // Buscador de canciones del reproductor.
    search: async (text) => {
      const qtext = String(text || "").trim().slice(0, 100);
      if (!qtext) return { tracks: [] };
      const j = await call("GET", "/search", { query: { q: qtext, type: "track", limit: 8 } });
      const tracks = (j?.tracks?.items || []).filter(Boolean).map((t) => {
        const imgs = t.album?.images || [];
        return {
          uri: t.uri,
          name: t.name,
          artists: (t.artists || []).map((a) => a.name).join(", "),
          thumb: (imgs[imgs.length - 1] || imgs[0])?.url || null,
          durationMs: t.duration_ms || 0,
        };
      });
      return { tracks };
    },
    playTrack: async (uri) => {
      if (!/^spotify:track:[A-Za-z0-9]+$/.test(String(uri || ""))) throw new SpotifyError("bad_request", 400);
      try {
        await call("PUT", "/me/player/play", { body: { uris: [uri] } });
      } catch (err) {
        // Nada activo: se despierta el primer dispositivo disponible.
        if (err.code !== "no_device") throw err;
        const list = (await call("GET", "/me/player/devices"))?.devices || [];
        const target = list.find((d) => d.type === "Computer") || list[0];
        if (!target) throw err;
        await call("PUT", "/me/player/play", { query: { device_id: target.id }, body: { uris: [uri] } });
      }
      return {};
    },
    pause: async () => (await call("PUT", "/me/player/pause"), {}),
    next: async () => (await call("POST", "/me/player/next"), {}),
    previous: async () => (await call("POST", "/me/player/previous"), {}),
    seek: async (ms) => (await call("PUT", "/me/player/seek", { query: { position_ms: clamp(ms, 0, 24 * 3600 * 1000) } }), {}),
    volume: async (pct) => (await call("PUT", "/me/player/volume", { query: { volume_percent: clamp(pct, 0, 100) } }), {}),
    shuffle: async (on) => (await call("PUT", "/me/player/shuffle", { query: { state: !!on } }), {}),
    repeat: async (mode) => {
      const state = ["off", "context", "track"].includes(mode) ? mode : "off";
      await call("PUT", "/me/player/repeat", { query: { state } });
      return {};
    },
    lyrics: async (track = {}) => {
      const key = String(track.id || `${track.artist}|${track.name}`);
      if (!track.name) return { lyrics: { kind: "none" } };
      if (!lyricsCache.has(key)) {
        const job = findLyrics(track).catch((err) => {
          lyricsCache.delete(key); // si falla la red, se reintenta otra vez
          throw err;
        });
        lyricsCache.set(key, job);
        if (lyricsCache.size > 50) lyricsCache.delete(lyricsCache.keys().next().value);
      }
      return { lyrics: await lyricsCache.get(key) };
    },
    transfer: async (deviceId, play) => (await call("PUT", "/me/player", { body: { device_ids: [String(deviceId)], play: !!play } }), {}),
  };

  // IPC: { ok, ...datos } o { ok: false, error, code }.
  const ipc = Object.fromEntries(
    Object.entries(actions).map(([name, fn]) => [
      name,
      async (...args) => {
        try {
          await refreshOwner();
          return { ok: true, ...(await fn(...args)) };
        } catch (err) {
          if (!(err instanceof SpotifyError)) console.error("spotify", err);
          return { ok: false, error: describe(err), code: err?.code };
        }
      },
    ])
  );

  return { ipc };
}

module.exports = { createSpotify };
