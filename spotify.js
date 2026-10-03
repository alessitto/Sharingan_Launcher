// =====================================================================
// Spotify (solo administradores)
// =====================================================================
// Controla la música de la cuenta de Spotify del admin desde el launcher:
// qué suena, play/pausa, saltos, posición, volumen, aleatorio, repetición y
// en qué dispositivo suena. La app de Spotify está en modo desarrollo (5
// usuarios como mucho), así que solo la ven los admins que no son testers.
//
// Inicio de sesión: Authorization Code con PKCE (sin client secret). Se abre
// el navegador y Spotify vuelve a un servidor local de un solo uso en
// http://127.0.0.1:43821/callback (tiene que coincidir con la Redirect URI de
// la app en el Dashboard). Los tokens se guardan cifrados con safeStorage.
const http = require("http");
const crypto = require("crypto");

const CLIENT_ID = "cf2893e14c384b82a7a6bd574ed893cc";
const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"];
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

const MESSAGES = {
  forbidden: "Spotify solo está disponible para administradores.",
  not_connected: "Conecta tu cuenta de Spotify.",
  premium_required: "Para controlar la música hace falta Spotify Premium.",
  no_device: "No hay ningún dispositivo con Spotify abierto. Ábrelo en el PC o en el móvil.",
  rate_limited: "Spotify pide ir más despacio. Espera unos segundos.",
  network: "No se puede conectar con Spotify. Revisa tu conexión.",
  login_cancelled: "Has cancelado la conexión con Spotify.",
  login_timeout: "Se ha acabado el tiempo para conectar con Spotify. Prueba otra vez.",
  login_failed: "No se ha podido conectar con Spotify. Prueba otra vez.",
  login_busy:"Ya hay una conexión con Spotify en marcha en el navegador.",
  port_busy: `El puerto ${PORT} está ocupado por otro programa. Ciérralo y prueba otra vez.`,
  not_allowed_user: "Esta cuenta de Spotify no está dada de alta en la app (User Management del Dashboard).",
  restricted: "Spotify no deja hacer eso ahora mismo en este dispositivo.",
};
const describe = (err) => MESSAGES[err?.code] || "Spotify ha devuelto un error. Prueba otra vez.";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function createSpotify(hooks) {
  const { safeStorage, settings, saveSettings, shell, isAllowed } = hooks;
  let pendingLogin = null; // { server, reject }
  let refreshing = null;

  // ------------------------------------------------------------ Tokens
  function readAuth() {
    if (!settings.spotifyAuth) return null;
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(settings.spotifyAuth, "base64")));
    } catch {
      return null;
    }
  }

  function writeAuth(auth) {
    if (auth) settings.spotifyAuth = safeStorage.encryptString(JSON.stringify(auth)).toString("base64");
    else delete settings.spotifyAuth;
    saveSettings();
  }

  async function tokenRequest(params) {
    let res;
    try {
      res = await fetch(`${ACCOUNTS}/api/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new SpotifyError("network", 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) {
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
          return finish(new SpotifyError("login_cancelled"));
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
          client_id: CLIENT_ID,
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
    if (reason === "PREMIUM_REQUIRED") throw new SpotifyError("premium_required", 403);
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
            name: it.name,
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

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

  const actions = {
    status: async () => ({ connected: !!readAuth()?.refresh }),
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
    transfer: async (deviceId, play) => (await call("PUT", "/me/player", { body: { device_ids: [String(deviceId)], play: !!play } }), {}),
  };

  // IPC: { ok, ...datos } o { ok: false, error, code }. Nada funciona si el
  // usuario con sesión no es admin (los testers tampoco).
  const ipc = Object.fromEntries(
    Object.entries(actions).map(([name, fn]) => [
      name,
      async (...args) => {
        if (!isAllowed()) return { ok: false, error: describe({ code: "forbidden" }), code: "forbidden" };
        try {
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
