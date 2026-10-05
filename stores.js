// =====================================================================
// Cuentas de Steam, Epic Games y GOG
// =====================================================================
// Al vincular una tienda, "Importar" trae también los juegos que tienes en
// esa cuenta aunque no estén instalados (con el botón Descargar). Cada
// tienda se vincula en su propia ventana de inicio de sesión:
//  - Steam: OpenID (solo da el SteamID) + GetOwnedGames con la clave de la
//    Web API de config.json. Necesita "Detalles de juegos" en público.
//  - Epic: el mismo flujo que Legendary/Heroic (código de autorización del
//    cliente del launcher) y la API de biblioteca.
//  - GOG: el OAuth del cliente de Galaxy, como lgogdownloader/Heroic.
// Los tokens se guardan cifrados con safeStorage (settings.storeAuth). Los
// client id/secret de Epic y GOG vienen de config.json (fuera del repo).
const fs = require("fs");
const path = require("path");

const UA_CHROME = () =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const STEAM_RETURN = "https://alejandrodev.es/sharingan_launcher/steam-link";

const EPIC_OAUTH = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
const EPIC_LIBRARY = "https://library-service.live.use1a.on.epicgames.com/library/api/public/items";
const EPIC_CATALOG = "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace";

const GOG_REDIRECT = "https://embed.gog.com/on_login_success?origin=client";

const MESSAGES = {
  cancelled: "Se ha cerrado la ventana sin vincular la cuenta.",
  no_encryption: "Windows no permite guardar la sesión cifrada en este equipo.",
  no_steam_key: "Falta la clave de la Web API de Steam.",
  no_config: "Faltan las claves de esta tienda en config.json.",
  steam_invalid: "Steam no ha confirmado el inicio de sesión. Prueba otra vez.",
  steam_private: "Tu lista de juegos de Steam es privada. Pon \"Detalles de juegos\" en público.",
  relink: "La sesión ha caducado. Vuelve a vincular la cuenta.",
  not_linked: "Esa cuenta no está vinculada.",
  network: "No se puede conectar con la tienda. Revisa tu conexión.",
  no_installer: "GOG no tiene instalador de Windows para este juego.",
  busy: "Ese juego ya se está descargando.",
};

class StoreError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || detail || code);
    this.code = code;
  }
}

function createStores({ safeStorage, settings, saveSettings, BrowserWindow, session, fetch, getWin, steamKey, epic = {}, gog = {}, cacheDir, tempDir }) {
  const EPIC_CLIENT = epic.clientId || "";
  const EPIC_SECRET = epic.clientSecret || "";
  const EPIC_REDIRECT = `https://www.epicgames.com/id/api/redirect?clientId=${EPIC_CLIENT}&responseType=code`;
  const GOG_CLIENT = gog.clientId || "";
  const GOG_SECRET = gog.clientSecret || "";

  // ------------------------------------------------------------ Sesiones
  function readAuth() {
    if (!settings.storeAuth) return {};
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(settings.storeAuth, "base64"))) || {};
    } catch {
      return {};
    }
  }

  function writeAuth(auth) {
    if (!safeStorage.isEncryptionAvailable()) throw new StoreError("no_encryption");
    settings.storeAuth = safeStorage.encryptString(JSON.stringify(auth)).toString("base64");
    saveSettings();
  }

  function setAuth(platform, value) {
    const auth = readAuth();
    if (value) auth[platform] = value;
    else delete auth[platform];
    writeAuth(auth);
  }

  function status() {
    const auth = readAuth();
    const one = (a) => (a ? { linked: true, name: a.name || null } : { linked: false });
    return { steam: one(auth.steam), epic: one(auth.epic), gog: one(auth.gog) };
  }

  const isLinked = (platform) => !!readAuth()[platform];

  async function getJson(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, { ...opts, headers: { "User-Agent": UA_CHROME(), ...(opts.headers || {}) } });
    } catch {
      throw new StoreError("network");
    }
    if (res.status === 401 || res.status === 403) throw new StoreError("relink");
    if (!res.ok) throw new StoreError("http", `La tienda ha respondido con un error (${res.status}).`);
    return res.json();
  }

  // ------------------------------------------------------------ Ventana de login
  // Cada tienda en su propia partición persistente: si ya iniciaste sesión
  // una vez, volver a vincular suele ser un clic.
  function authWindow({ url, partition, title, catchUrl, onLoad }) {
    return new Promise((resolve, reject) => {
      const ses = session.fromPartition(partition);
      const parent = getWin();
      const w = new BrowserWindow({
        width: 540,
        height: 780,
        title,
        parent: parent && !parent.isDestroyed() ? parent : undefined,
        autoHideMenuBar: true,
        backgroundColor: "#121212",
        webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      w.webContents.setUserAgent(UA_CHROME());
      let done = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        if (catchUrl) ses.webRequest.onBeforeRequest(null);
        if (!w.isDestroyed()) w.close();
        if (err) reject(err);
        else resolve(value);
      };
      if (catchUrl) {
        ses.webRequest.onBeforeRequest({ urls: [`${catchUrl}*`] }, (details, cb) => {
          cb({ cancel: true });
          finish(null, details.url);
        });
      }
      if (onLoad) {
        w.webContents.on("did-finish-load", async () => {
          try {
            const value = await onLoad(w.webContents);
            if (value !== undefined) finish(null, value);
          } catch (err) {
            finish(err);
          }
        });
      }
      w.on("closed", () => finish(new StoreError("cancelled")));
      w.loadURL(url).catch(() => {});
    });
  }

  // ------------------------------------------------------------ Steam
  async function linkSteam() {
    if (!steamKey) throw new StoreError("no_steam_key");
    const q = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": STEAM_RETURN,
      "openid.realm": "https://alejandrodev.es/",
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    const back = await authWindow({
      url: `https://steamcommunity.com/openid/login?${q}`,
      partition: "persist:store-steam",
      title: "Vincular Steam",
      catchUrl: STEAM_RETURN,
    });

    // Se le pregunta a Steam si la respuesta es suya de verdad.
    const params = new URL(back).searchParams;
    params.set("openid.mode", "check_authentication");
    let text = "";
    try {
      const res = await fetch("https://steamcommunity.com/openid/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      text = await res.text();
    } catch {
      throw new StoreError("network");
    }
    const steamId = (params.get("openid.claimed_id") || "").match(/\/openid\/id\/(\d{17})$/)?.[1];
    if (!/is_valid\s*:\s*true/.test(text) || !steamId) throw new StoreError("steam_invalid");

    let name = null;
    try {
      const j = await getJson(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamId}`
      );
      name = j?.response?.players?.[0]?.personaname || null;
    } catch {}
    setAuth("steam", { steamId, name });
    return { name };
  }

  async function ownedSteam() {
    const a = readAuth().steam;
    if (!a) throw new StoreError("not_linked");
    if (!steamKey) throw new StoreError("no_steam_key");
    const q = new URLSearchParams({
      key: steamKey,
      steamid: a.steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
      format: "json",
    });
    const j = await getJson(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${q}`);
    // Con el perfil privado Steam responde un "response" vacío.
    if (!j?.response || j.response.game_count === undefined) throw new StoreError("steam_private");
    return (j.response.games || []).map((g) => ({ appid: Number(g.appid), name: g.name || `Steam App ${g.appid}` }));
  }

  // ------------------------------------------------------------ Epic
  const epicBasic = () => "Basic " + Buffer.from(`${EPIC_CLIENT}:${EPIC_SECRET}`).toString("base64");

  async function epicToken(body) {
    let res;
    try {
      res = await fetch(EPIC_OAUTH, {
        method: "POST",
        headers: { Authorization: epicBasic(), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA_CHROME() },
        body: new URLSearchParams({ ...body, token_type: "eg1" }).toString(),
      });
    } catch {
      throw new StoreError("network");
    }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.access_token) throw new StoreError("relink");
    return {
      access: j.access_token,
      refresh: j.refresh_token,
      expiresAt: Date.parse(j.expires_at) || Date.now() + 3600e3,
      accountId: j.account_id,
      name: j.displayName || null,
    };
  }

  async function linkEpic() {
    const code = await authWindow({
      url: `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(EPIC_REDIRECT)}`,
      partition: "persist:store-epic",
      title: "Vincular Epic Games",
      // Tras iniciar sesión Epic acaba en EPIC_REDIRECT, que muestra un JSON
      // con el código de autorización.
      onLoad: async (wc) => {
        if (!wc.getURL().startsWith("https://www.epicgames.com/id/api/redirect")) return undefined;
        const text = await wc.executeJavaScript("document.body.innerText");
        let j = null;
        try {
          j = JSON.parse(text);
        } catch {}
        if (j?.authorizationCode) return j.authorizationCode;
        wc.loadURL(`https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(EPIC_REDIRECT)}`);
        return undefined;
      },
    });
    const t = await epicToken({ grant_type: "authorization_code", code });
    setAuth("epic", t);
    return { name: t.name };
  }

  async function epicAccess() {
    const a = readAuth().epic;
    if (!a) throw new StoreError("not_linked");
    if (a.expiresAt > Date.now() + 60e3) return a.access;
    const t = await epicToken({ grant_type: "refresh_token", refresh_token: a.refresh });
    setAuth("epic", { ...t, name: t.name || a.name });
    return t.access;
  }

  // Los títulos y carátulas salen del catálogo, uno por juego: se guardan en
  // disco para no volver a pedirlos en cada importación.
  const epicCachePath = path.join(cacheDir, "epic_catalog_cache.json");
  let epicCache = null;
  function epicCacheGet() {
    if (!epicCache) {
      try {
        epicCache = JSON.parse(fs.readFileSync(epicCachePath, "utf8")) || {};
      } catch {
        epicCache = {};
      }
    }
    return epicCache;
  }

  async function epicItem(token, ns, id) {
    const cache = epicCacheGet();
    if (cache[id]) return cache[id];
    const q = new URLSearchParams({ id, includeDLCDetails: "true", includeMainGameDetails: "true", country: "ES", locale: "es-ES" });
    const j = await getJson(`${EPIC_CATALOG}/${ns}/bulk/items?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const it = j?.[id];
    if (!it) return null;
    const img = (type) => it.keyImages?.find((k) => k.type === type)?.url || null;
    const cats = (it.categories || []).map((c) => c.path);
    cache[id] = {
      title: it.title || null,
      cover: img("DieselGameBoxTall") || img("OfferImageTall") || null,
      isGame: !it.mainGameItem && cats.includes("games") && !cats.some((c) => /addons|digitalextras/.test(c)),
    };
    return cache[id];
  }

  async function ownedEpic() {
    const token = await epicAccess();
    const records = [];
    let cursor = null;
    for (let i = 0; i < 50; i++) {
      const q = new URLSearchParams({ includeMetadata: "true" });
      if (cursor) q.set("cursor", cursor);
      const j = await getJson(`${EPIC_LIBRARY}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      records.push(...(j?.records || []));
      cursor = j?.responseMetadata?.nextCursor;
      if (!cursor) break;
    }

    const seen = new Set();
    const items = records.filter((r) => {
      // "ue" son assets de Unreal Engine; sin appName no se puede instalar.
      if (!r.appName || !r.catalogItemId || r.namespace === "ue" || /^UE_/i.test(r.appName)) return false;
      if (seen.has(r.catalogItemId)) return false;
      seen.add(r.catalogItemId);
      return true;
    });

    const out = [];
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const r = items[next++];
        let meta = null;
        try {
          meta = await epicItem(token, r.namespace, r.catalogItemId);
        } catch (err) {
          if (err.code === "relink") throw err;
        }
        if (!meta?.isGame || !meta.title) continue;
        out.push({ appName: r.appName, name: meta.title, cover: meta.cover });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    try {
      fs.writeFileSync(epicCachePath, JSON.stringify(epicCacheGet()), "utf8");
    } catch {}
    return out;
  }

  // ------------------------------------------------------------ GOG
  async function gogToken(params) {
    const q = new URLSearchParams({ client_id: GOG_CLIENT, client_secret: GOG_SECRET, ...params });
    let res;
    try {
      res = await fetch(`https://auth.gog.com/token?${q}`, { headers: { "User-Agent": UA_CHROME() } });
    } catch {
      throw new StoreError("network");
    }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.access_token) throw new StoreError("relink");
    return { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000, userId: j.user_id };
  }

  async function linkGog() {
    const q = new URLSearchParams({ client_id: GOG_CLIENT, redirect_uri: GOG_REDIRECT, response_type: "code", layout: "client2" });
    const back = await authWindow({
      url: `https://auth.gog.com/auth?${q}`,
      partition: "persist:store-gog",
      title: "Vincular GOG",
      catchUrl: "https://embed.gog.com/on_login_success",
    });
    const code = new URL(back).searchParams.get("code");
    if (!code) throw new StoreError("cancelled");
    const t = await gogToken({ grant_type: "authorization_code", code, redirect_uri: GOG_REDIRECT });
    let name = null;
    try {
      name = (await getJson("https://embed.gog.com/userData.json", { headers: { Authorization: `Bearer ${t.access}` } }))?.username || null;
    } catch {}
    setAuth("gog", { ...t, name });
    return { name };
  }

  async function gogAccess() {
    const a = readAuth().gog;
    if (!a) throw new StoreError("not_linked");
    if (a.expiresAt > Date.now() + 60e3) return a.access;
    const t = await gogToken({ grant_type: "refresh_token", refresh_token: a.refresh });
    setAuth("gog", { ...t, name: a.name });
    return t.access;
  }

  async function ownedGog() {
    const token = await gogAccess();
    const out = [];
    for (let page = 1; page <= 100; page++) {
      const j = await getJson(`https://embed.gog.com/account/getFilteredProducts?mediaType=1&sortBy=title&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      for (const p of j?.products || []) {
        if (p.worksOn && p.worksOn.Windows === false) continue;
        out.push({ id: Number(p.id), name: p.title });
      }
      if (page >= (j?.totalPages || 1)) break;
    }
    return out;
  }

  // Descarga el instalador sin conexión (el .exe y sus .bin, si los tiene)
  // y lo abre. onProgress(0..1).
  const gogDownloads = new Set();
  async function installGog(productId, onProgress) {
    if (gogDownloads.has(productId)) throw new StoreError("busy");
    gogDownloads.add(productId);
    try {
      const token = await gogAccess();
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      const info = await getJson(`https://api.gog.com/products/${productId}?expand=downloads&locale=es-ES`, auth);
      const win = (info?.downloads?.installers || []).filter((i) => i.os === "windows" && i.files?.length);
      const inst = win.find((i) => i.language === "es") || win.find((i) => i.language === "en") || win[0];
      if (!inst) throw new StoreError("no_installer");

      const dir = path.join(tempDir, "gog", String(productId));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });

      const total = inst.files.reduce((n, f) => n + (Number(f.size) || 0), 0) || 1;
      let received = 0;
      let lastSent = 0;
      const saved = [];
      for (const f of inst.files) {
        const link = await getJson(f.downlink, auth);
        if (!link?.downlink) throw new StoreError("no_installer");
        let res;
        try {
          res = await fetch(link.downlink, { headers: { "User-Agent": UA_CHROME() } });
        } catch {
          throw new StoreError("network");
        }
        if (!res.ok) throw new StoreError("http", `GOG ha respondido con un error (${res.status}).`);
        const file = path.join(dir, decodeURIComponent(path.basename(new URL(res.url || link.downlink).pathname)));
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(file);
          res.body.on("data", (chunk) => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastSent > 250) {
              lastSent = now;
              onProgress?.(Math.min(0.99, received / total));
            }
          });
          res.body.on("error", reject);
          out.on("error", reject);
          out.on("finish", resolve);
          res.body.pipe(out);
        });
        saved.push(file);
      }
      onProgress?.(1);
      return saved.find((f) => f.toLowerCase().endsWith(".exe")) || null;
    } finally {
      gogDownloads.delete(productId);
    }
  }

  // ------------------------------------------------------------ API
  const LINKERS = { steam: linkSteam, epic: linkEpic, gog: linkGog };
  const OWNED = { steam: ownedSteam, epic: ownedEpic, gog: ownedGog };

  async function link(platform) {
    if (!LINKERS[platform]) return { ok: false, error: "Tienda no válida." };
    try {
      if (platform !== "steam" && !safeStorage.isEncryptionAvailable()) throw new StoreError("no_encryption");
      if ((platform === "epic" && !(EPIC_CLIENT && EPIC_SECRET)) || (platform === "gog" && !(GOG_CLIENT && GOG_SECRET)))
        throw new StoreError("no_config");
      const r = await LINKERS[platform]();
      return { ok: true, name: r.name, status: status() };
    } catch (err) {
      return { ok: false, cancelled: err.code === "cancelled", error: err.message, status: status() };
    }
  }

  async function unlink(platform) {
    setAuth(platform, null);
    try {
      await session.fromPartition(`persist:store-${platform}`).clearStorageData();
    } catch {}
    return status();
  }

  return {
    StoreError,
    status,
    isLinked,
    owned: (platform) => OWNED[platform](),
    installGog,
    ipc: { status, link, unlink },
  };
}

module.exports = { createStores };
