const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const Fuse = require("fuse.js");
const path = require("path");
const { execFile, spawn } = require("child_process");
const saves = require("./saves");
const ai = require("./ai");
const { createCloud } = require("./cloud");
const { createSpotify } = require("./spotify");
const themes = require("./themes");
let cloud = null; // se crea al arrancar (setupCloud)
const fs = require("fs");
const fetch = require("node-fetch"); // npm install node-fetch@2
const si = require("systeminformation"); // npm install systeminformation

// Una sola ventana: si ya está abierta, abrirla otra vez la trae al frente
// (dos instancias escribiendo los mismos archivos acababan pisándose).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

let win;
let games = [];
let completedGames = [];
let sagas = []; // [{ id, name, gameIds: [id, ...] }] - orden de gameIds = orden dentro de la saga

// === Config (credenciales) ===
// Nunca hardcodeadas en el codigo: config.json esta en .gitignore (el repo
// es publico), copia config.example.json y rellena los valores reales.
const configPath = path.join(__dirname, "config.json");
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
  console.error(
    "No se pudo leer config.json (copia config.example.json y rellena las claves):",
    err.message
  );
}

const IGDB_CLIENT_ID = config.igdbClientId || "";
const IGDB_CLIENT_SECRET = config.igdbClientSecret || "";
const IGDB_URL = "https://api.igdb.com/v4";

// -------------------- Token IGDB (via Twitch OAuth) --------------------
// IGDB se autentica con un App Access Token de Twitch que caduca solo (unos
// 60 dias) - en vez de guardarlo fijo (se queda obsoleto y todo deja de
// cargar en silencio), se pide uno nuevo con el Client Secret cuando hace
// falta y se cachea en memoria hasta que esta a punto de caducar.
let igdbTokenCache = { token: null, expiresAt: 0 };
// Al arrancar se piden varias cosas a la vez: todas esperan al mismo token
// en vez de pedir uno cada una.
let igdbTokenPending = null;

function getIgdbToken(forceRefresh = false) {
  // Margen de 5 minutos antes de que caduque de verdad, por si acaso.
  if (!forceRefresh && igdbTokenCache.token && Date.now() < igdbTokenCache.expiresAt - 5 * 60 * 1000) {
    return Promise.resolve(igdbTokenCache.token);
  }
  if (!igdbTokenPending) {
    igdbTokenPending = requestIgdbToken().finally(() => (igdbTokenPending = null));
  }
  return igdbTokenPending;
}

async function requestIgdbToken() {
  const now = Date.now();
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    throw new Error("Faltan igdbClientId/igdbClientSecret en config.json");
  }

  const params = new URLSearchParams({
    client_id: IGDB_CLIENT_ID,
    client_secret: IGDB_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: "POST",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`No se pudo renovar el token de IGDB: ${res.status} ${text}`);
  }

  const data = await res.json();
  igdbTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 0) * 1000,
  };
  console.log("[IGDB] Token renovado, caduca en", Math.floor((data.expires_in || 0) / 86400), "dias");
  return igdbTokenCache.token;
}

// === Ruta para guardar datos persistentes ===
const dataFilePath = path.join(app.getPath("userData"), "library.json");

// -------------------- Persistencia --------------------
function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, "utf8");
      const parsed = JSON.parse(raw);
      games = (parsed.games || []).map((g) => ({
        ...g,
        sortKey: g.sortKey || g.name || "",
      }));
      completedGames = (parsed.completedGames || []).map((g, idx) => ({
        ...g,
        sortKey: g.sortKey || g.name || "",
        // Datos antiguos sin fecha real: se usa el indice (siempre menor que
        // cualquier Date.now() real) para conservar el orden de finalizacion
        // que ya tenian por como se iban guardando (push al completar).
        completedAt: g.completedAt || idx,
      }));
      sagas = (parsed.sagas || []).map((s) => ({
        id: s.id,
        name: s.name || "",
        gameIds: Array.isArray(s.gameIds) ? s.gameIds.map(Number) : [],
      }));
      console.log("Library loaded from", dataFilePath);
    }
  } catch (err) {
    console.error("Error loading library.json", err);
  }
}

// Se escribe en un temporal y se renombra: si la app se cierra a mitad de
// escribir, library.json no se queda cortado (y la biblioteca vacía).
function writeFileAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function writeLibraryFile() {
  try {
    writeFileAtomic(dataFilePath, JSON.stringify({ games, completedGames, sagas }, null, 2));
  } catch (err) {
    console.error("Error saving library.json", err);
  }
}

function saveData() {
  writeLibraryFile();
  cloud?.markDirty("library");
}

// === Ajustes de usuario (settings.json en userData) ===
const settingsFilePath = path.join(app.getPath("userData"), "settings.json");
const GAMES_PER_PAGE_MIN = 12;
const GAMES_PER_PAGE_MAX = 200;
// Por debajo de 3 las cards se quedan sin sentido como "grid", por encima de
// 10 se vuelven ilegibles (miniaturas minúsculas) en una ventana normal.
const GRID_COLUMNS_MIN = 3;
const GRID_COLUMNS_MAX = 10;
let appSettings = { gamesPerPage: 60, gridColumns: 5, theme: "itachi", themeEffect: "default" };

function clampGamesPerPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return appSettings.gamesPerPage;
  return Math.min(GAMES_PER_PAGE_MAX, Math.max(GAMES_PER_PAGE_MIN, Math.round(n)));
}

function clampGridColumns(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return appSettings.gridColumns;
  return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, Math.round(n)));
}

// Color y estilo del tema (también pasa los temas antiguos a los nuevos).
function clampTheme(theme, effect) {
  const r = themes.resolve({ theme, themeEffect: effect });
  return { theme: r.palette, themeEffect: r.effect };
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
      appSettings = {
        ...appSettings,
        ...parsed,
        gamesPerPage: clampGamesPerPage(parsed.gamesPerPage),
        gridColumns: clampGridColumns(parsed.gridColumns),
        ...clampTheme(parsed.theme, parsed.themeEffect),
      };
    }
  } catch (err) {
    console.error("Error loading settings.json", err);
  }
}

function saveSettings() {
  try {
    writeFileAtomic(settingsFilePath, JSON.stringify(appSettings, null, 2));
  } catch (err) {
    console.error("Error saving settings.json", err);
  }
}

loadSettings();

// La clave de la IA y el token de la cuenta (cifrados) no se le pasan
// nunca a la ventana.
const publicSettings = () => ({
  ...appSettings,
  aiKey: undefined,
  cloudToken: undefined,
  spotifyAuth: undefined,
  cloudDirty: undefined,
  cloudLinkedUser: undefined,
});

ipcMain.handle("settings:get", () => publicSettings());

ipcMain.handle("settings:set", (_e, patch = {}) => {
  if (patch.gamesPerPage !== undefined) {
    appSettings.gamesPerPage = clampGamesPerPage(patch.gamesPerPage);
  }
  if (patch.gridColumns !== undefined) {
    appSettings.gridColumns = clampGridColumns(patch.gridColumns);
  }
  if (patch.theme !== undefined || patch.themeEffect !== undefined) {
    Object.assign(appSettings, clampTheme(patch.theme ?? appSettings.theme, patch.themeEffect ?? appSettings.themeEffect));
  }
  saveSettings();
  return publicSettings();
});

// -------------------- Helpers procesos --------------------
// tasklist viene con Windows y responde rápido (ps-node tira de wmic, que
// en Windows 11 ya no viene instalado y dejaba esto siempre en "false").
function isProcessRunning(processName) {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/fo", "csv", "/nh", "/fi", `IMAGENAME eq ${processName}`],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(false);
        resolve(String(stdout || "").toLowerCase().includes(`"${processName.toLowerCase()}"`));
      }
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------- Launchers --------------------
function findFirstExisting(paths) {
  return paths.find((p) => exists(p)) || null;
}

// Rutas de instalacion por defecto de cada launcher — se prueban varias
// ubicaciones habituales en vez de una sola fija, y si no se encuentra
// ninguna se avisa en vez de fallar en silencio.
function launchPlatform(platform) {
  let exePath = null;
  switch (platform) {
    case "steam":
      exePath = findFirstExisting([
        "C:\\Program Files (x86)\\Steam\\Steam.exe",
        "C:\\Program Files\\Steam\\Steam.exe",
      ]);
      break;
    case "epic":
      exePath = findFirstExisting([
        "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe",
        "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe",
      ]);
      break;
    case "gog":
      exePath = findFirstExisting([
        "C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe",
        "C:\\Program Files\\GOG Galaxy\\GalaxyClient.exe",
      ]);
      break;
    default:
      return false;
  }

  if (!exePath) {
    console.error(`No se encontro el instalador de ${platform} en las rutas habituales.`);
    return false;
  }

  execFile(exePath, (err) => {
    if (err) console.error(`Error lanzando ${platform}:`, err);
  });
  return true;
}

// Devuelve { ok, error } para poder contarlo en el modal de "Abriendo...".
async function launchGameByPlatform(game) {
  try {
    switch (game.platform) {
      case "steam":
        if (game.steamAppId) {
          await shell.openExternal(`steam://run/${game.steamAppId}`);
          return { ok: true };
        }
        break;
      case "epic":
        if (game.epicAppName) {
          await shell.openExternal(
            `com.epicgames.launcher://apps/${game.epicAppName}?action=launch&silent=true`
          );
          return { ok: true };
        }
        break;
      case "gog":
        if (game.gogGameId) {
          await shell.openExternal(`goggalaxy://openGameView/${game.gogGameId}`);
          return { ok: true };
        }
        break;
    }
  } catch (err) {
    return { ok: false, error: "No se pudo abrir el launcher del juego." };
  }

  if (!game.executable) return { ok: false, error: "El juego no tiene ejecutable vinculado." };
  if (!exists(game.executable)) return { ok: false, error: "No se encuentra el ejecutable. ¿Se ha movido o desinstalado el juego?" };

  // Se lanza desde su propia carpeta (muchos juegos buscan sus archivos de
  // forma relativa) y desligado de la app, para que siga abierto aunque se
  // cierre el launcher.
  return new Promise((resolve) => {
    try {
      const child = spawn(game.executable, [], {
        cwd: path.dirname(game.executable),
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", (err) => resolve({ ok: false, error: `No se pudo iniciar el juego (${err.code || err.message}).` }));
      child.once("spawn", () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: `No se pudo iniciar el juego (${err.message}).` });
    }
  });
}

// -------------------- FS helpers --------------------
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function safeReadText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

// -------------------- Exe detect --------------------
function findExeCandidates(rootDir, maxDepth = 3) {
  const results = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    const entries = listFiles(dir);

    for (const full of entries) {
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (st.isFile() && full.toLowerCase().endsWith(".exe")) {
        const base = path.basename(full).toLowerCase();
        const bad =
          base.includes("unins") ||
          base.includes("setup") ||
          base.includes("redist") ||
          base.includes("vcredist") ||
          base.includes("dxsetup") ||
          base.includes("crashhandler") ||
          base.includes("prereq");
        if (!bad) results.push({ path: full, size: st.size });
      }
    }
  }

  walk(rootDir, 0);
  results.sort((a, b) => b.size - a.size);
  return results;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function pickBestExe(rootDir) {
  // Profundidad 5: instalaciones modernas (Unreal Engine, etc.) suelen
  // meter el .exe real varios niveles por debajo de la carpeta del juego
  // (Juego/Juego/Binaries/Win64/Juego-Win64-Shipping.exe).
  const cands = findExeCandidates(rootDir, 5);
  return cands.length ? cands[0].path : null;
}

// -------------------- Steam parse --------------------
function parseAcfRootFields(acfText) {
  const out = {};
  if (!acfText) return out;

  const grab = (key) => {
    const re = new RegExp(`"${key}"\\s*"([^"]*)"`, "i");
    const m = acfText.match(re);
    return m ? m[1] : null;
  };

  out.appid = grab("appid");
  out.name = grab("name");
  out.installdir = grab("installdir");
  return out;
}

function parseSteamLibraryFoldersVdf(vdfText) {
  const libs = new Set();
  if (!vdfText) return [];

  const pathMatches = [...vdfText.matchAll(/"path"\s*"([^"]+)"/gi)];
  for (const m of pathMatches) libs.add(m[1].replace(/\\\\/g, "\\"));

  const oldMatches = [...vdfText.matchAll(/^\s*"\d+"\s*"([^"]+)"\s*$/gim)];
  for (const m of oldMatches) libs.add(m[1].replace(/\\\\/g, "\\"));

  return [...libs];
}

// -------------------- IDs/Upsert --------------------
function stableNegativeId(input) {
  const s = String(input || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (hash << 5) - hash + s.charCodeAt(i);
  return -Math.abs(hash || 1);
}

// Para comparar nombres entre fuentes distintas (el "Darkest Dungeon" que
// se agrego a mano desde Descubrir/IGDB vs el "Darkest Dungeon(R)" que
// detecta el escaneo de Steam): fuera simbolos de marca, mayusculas y
// puntuacion, que es justo donde suelen diferir sin ser un juego distinto.
function normalizeGameName(name) {
  return String(name || "")
    .replace(/[®™©]/g, "")
    .replace(/[:_\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findGameByExternalId(gameObj) {
  const pools = [games, completedGames];
  if (gameObj.steamAppId != null) {
    for (const p of pools) {
      const hit = p.find((x) => x.steamAppId === gameObj.steamAppId);
      if (hit) return hit;
    }
  }
  if (gameObj.epicAppName) {
    for (const p of pools) {
      const hit = p.find((x) => x.epicAppName === gameObj.epicAppName);
      if (hit) return hit;
    }
  }
  if (gameObj.gogGameId != null) {
    for (const p of pools) {
      const hit = p.find((x) => x.gogGameId === gameObj.gogGameId);
      if (hit) return hit;
    }
  }
  return null;
}

function findGameByName(gameObj) {
  const norm = normalizeGameName(gameObj.name);
  if (!norm) return null;
  return (
    games.find((x) => normalizeGameName(x.name) === norm) ||
    completedGames.find((x) => normalizeGameName(x.name) === norm) ||
    null
  );
}

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

// Mismo juego detectado por dos vías distintas (p.ej. GOG por el registro
// de Galaxy y antes por escaneo de carpeta, con nombres algo distintos):
// si apuntan a la misma carpeta de instalación es el mismo juego.
function findGameByInstallDir(gameObj) {
  if (!gameObj.installDir) return null;
  return (
    games.find((x) => samePath(x.installDir, gameObj.installDir)) ||
    completedGames.find((x) => samePath(x.installDir, gameObj.installDir)) ||
    null
  );
}

function canLaunch(g) {
  return !!(
    g.executable ||
    (g.platform === "steam" && g.steamAppId) ||
    (g.platform === "epic" && g.epicAppName) ||
    (g.platform === "gog" && g.gogGameId)
  );
}

// Devuelve si el juego era nuevo o ya estaba en la biblioteca, para que el
// resumen de la importación no cuente como "importado" lo que ya tenías.
function upsertGameImported(gameObj) {
  const gameId = Number(gameObj.id);

  // 1) Mismo id exacto: es un reescaneo de la misma fuente (p.ej. volver a
  // importar Steam), se refresca todo tal cual llega, como siempre.
  let g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (g) {
    Object.assign(g, {
      name: gameObj.name ?? g.name ?? "",
      cover: gameObj.cover ?? g.cover ?? null,
      coverUrl: gameObj.coverUrl ?? g.coverUrl ?? null,
      executable: gameObj.executable ?? g.executable ?? null,
      platform: gameObj.platform ?? g.platform ?? "none",
      steamAppId: gameObj.steamAppId ?? g.steamAppId ?? null,
      epicAppName: gameObj.epicAppName ?? g.epicAppName ?? null,
      gogGameId: gameObj.gogGameId ?? g.gogGameId ?? null,
      installDir: gameObj.installDir ?? g.installDir ?? null,
      sortKey: (
        gameObj.sortKey ??
        g.sortKey ??
        gameObj.name ??
        g.name ??
        ""
      ).toString(),
    });
    return { status: "existing", game: g };
  }

  // 2) Mismo juego pero con otro id "principal": ya se habia emparejado
  // antes por su id de Steam/Epic/GOG, o coincide por nombre con algo ya en
  // la biblioteca metido desde OTRA fuente (tipico: agregado a mano desde
  // Descubrir con su ficha de IGDB, y ahora tambien detectado por el
  // escaneo automatico). En vez de duplicarlo, se rellenan los datos
  // tecnicos que le falten (ejecutable, carpeta, ids de plataforma) sin
  // pisar el nombre/caratula que ya tuviera - para no cambiar una ficha
  // buena de IGDB por el nombre en crudo del launcher de turno.
  g = findGameByExternalId(gameObj) || findGameByInstallDir(gameObj) || findGameByName(gameObj);
  if (g) {
    g.executable = g.executable ?? gameObj.executable ?? null;
    if (!g.platform || g.platform === "none") g.platform = gameObj.platform ?? "none";
    g.steamAppId = g.steamAppId ?? gameObj.steamAppId ?? null;
    g.epicAppName = g.epicAppName ?? gameObj.epicAppName ?? null;
    g.gogGameId = g.gogGameId ?? gameObj.gogGameId ?? null;
    g.installDir = g.installDir ?? gameObj.installDir ?? null;
    if (!g.cover && !g.coverUrl) {
      g.cover = gameObj.cover ?? null;
      g.coverUrl = gameObj.coverUrl ?? null;
    }
    if (!g.name) g.name = gameObj.name ?? "";
    return { status: "existing", game: g };
  }

  // 3) De verdad nuevo.
  g = { id: gameId };
  games.push(g);
  Object.assign(g, {
    name: gameObj.name ?? "",
    cover: gameObj.cover ?? null,
    coverUrl: gameObj.coverUrl ?? null,
    executable: gameObj.executable ?? null,
    platform: gameObj.platform ?? "none",
    steamAppId: gameObj.steamAppId ?? null,
    epicAppName: gameObj.epicAppName ?? null,
    gogGameId: gameObj.gogGameId ?? null,
    installDir: gameObj.installDir ?? null,
    sortKey: (gameObj.sortKey ?? gameObj.name ?? "").toString(),
  });
  return { status: "new", game: g };
}

// -------------------- Window --------------------
// Electron pinta la ventana en blanco por defecto hasta que carga el primer
// frame si no se le da un backgroundColor - con la app en modo oscuro eso se
// nota como un parpadeo blanco feo al abrir/redimensionar. Un color por tema
// (el fondo de la paleta del tema) lo evita sea cual sea el tema activo.

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    backgroundColor: themes.windowBg(appSettings),
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // La ventana nunca navega fuera de la app ni abre otras ventanas: los
  // enlaces https se abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:")) return;
    e.preventDefault();
    if (url.startsWith("https://")) shell.openExternal(url);
  });

  win.maximize();
  win.loadFile("index.html");
}

// -------------------- Actualizaciones automáticas --------------------
// Busca nuevas versiones en las releases de GitHub en segundo plano (al
// arrancar y cada 4 horas) sin molestar. Si hay una, avisa a la ventana y
// es el usuario quien decide: solo entonces se descarga y se instala en
// silencio, reabriendo la app ya actualizada. Solo en la app instalada (en
// desarrollo no hay app-update.yml).
let autoUpdater = null;
let updateState = { status: "idle" };

function sendUpdate(patch) {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send("update:state", updateState);
}

function setupAutoUpdates() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.error("electron-updater no disponible", err);
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.logger = null;

  autoUpdater.on("update-available", (info) =>
    sendUpdate({ status: "available", version: info.version, percent: 0 })
  );
  autoUpdater.on("download-progress", (p) =>
    sendUpdate({ status: "downloading", percent: Math.round(p.percent || 0) })
  );
  autoUpdater.on("update-downloaded", () => {
    sendUpdate({ status: "installing", percent: 100 });
    // isSilent: instala sin el asistente; isForceRunAfter: reabre la app.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
  });
  autoUpdater.on("error", (err) => {
    console.error("Actualizador:", err?.message || err);
    // Si falla buscando, silencio; si falla descargando, se avisa.
    if (updateState.status === "downloading") sendUpdate({ status: "error" });
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

ipcMain.handle("update:getState", () => updateState);
// Botón "Buscar actualizaciones" de Ajustes: misma búsqueda, pero a demanda
// y devolviendo el resultado para enseñarlo.
ipcMain.handle("update:check", async () => {
  if (!autoUpdater) return { status: "dev" };
  if (["downloading", "installing"].includes(updateState.status)) return updateState;
  try {
    const res = await autoUpdater.checkForUpdates();
    if (res?.isUpdateAvailable) return { status: "available", version: res.updateInfo.version };
    return { status: "latest", version: app.getVersion() };
  } catch (err) {
    return { status: "error" };
  }
});
ipcMain.handle("update:install", async () => {
  if (!autoUpdater || !["available", "error"].includes(updateState.status)) return false;
  sendUpdate({ status: "downloading", percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (err) {
    sendUpdate({ status: "error" });
    return false;
  }
});

app.whenReady().then(() => {
  setupCloud();
  setupSpotify();
  loadData();
  createWindow();
  setupAutoUpdates();
  // Con sesión iniciada, se trae lo de la cuenta en cuanto la ventana está lista.
  win.webContents.once("did-finish-load", () => cloud.start());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// -------------------- IGDB helper --------------------
// Acepta 'endpoint' opcional ("games" por defecto) para usar "external_games" cuando sea necesario
async function igdbGamesQuery(body, endpoint = "games", isRetry = false) {
  let token;
  try {
    token = await getIgdbToken();
  } catch (err) {
    console.error("IGDB token error", err.message);
    return null;
  }

  // Sin conexión (o IGDB caído) se devuelve una lista vacía en vez de un
  // error, igual que cuando IGDB contesta mal.
  let res;
  try {
    res = await fetch(`${IGDB_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": IGDB_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "text/plain",
      },
      body,
      timeout: 20000,
    });
  } catch (err) {
    console.error("IGDB sin conexión", err.message);
    return null;
  }

  if (!res.ok) {
    // Token invalidado desde fuera (revocado, etc.) antes de la caducidad
    // que esperabamos: se fuerza una renovacion y se reintenta una vez.
    if (res.status === 401 && !isRetry) {
      await getIgdbToken(true).catch(() => null);
      return igdbGamesQuery(body, endpoint, true);
    }
    const text = await res.text().catch(() => "");
    console.error("IGDB error", res.status, text);
    return null;
  }

  return res.json().catch(() => null);
}

// -------------------- IGDB IPC --------------------
// game_type de IGDB (el campo "category" esta deprecado, ya no se rellena):
// 0=Main Game, 8=Remake, 9=Remaster, 10=Expanded Game son juegos "de
// verdad"; el resto (1=DLC, 2=Expansion, 3=Bundle, 5=Mod, 6=Episode,
// 7=Season, 11=Port, 13=Pack/Addon, 14=Update...) es el ruido que no se
// quiere ver al buscar (packs, DLCs sueltos, ports moviles, etc).
// Verificado contra la API real con "borderlands": filtra bien VR/Mobile
// ports, Triple Pack, Season Pass, Designer's/Director's Cut, packs de DLC.
// Las ediciones especiales (Deluxe/Ultimate) IGDB las sigue marcando como
// Main Game, asi que esas seguiran saliendo aparte del juego base.
// 4 = Standalone Expansion: juego completo que se instala y juega solo
// (Dishonored: Death of the Outsider, Far Cry 3: Blood Dragon...), no un DLC.
const IGDB_REAL_GAME_TYPES = "(0,4,8,9,10)";

// Ordena en JS en vez de confiar en el "sort" de Apicalypse: IGDB lo ignora
// en cuanto la query lleva "search" (ordena siempre por relevancia de texto),
// que es justo por lo que el filtro de orden no hacia nada al buscar.
// Haciendolo aqui, orden y busqueda funcionan siempre juntos.
function sortDiscoverResults(list, sort) {
  const byName = (a, b) =>
    (a.name || "").localeCompare(b.name || "", "es", { sensitivity: "base" });
  const arr = list.slice();
  switch (sort) {
    case "az":
      return arr.sort(byName);
    case "za":
      return arr.sort((a, b) => byName(b, a));
    case "year_desc":
      return arr.sort(
        (a, b) => (b.first_release_date || 0) - (a.first_release_date || 0)
      );
    case "year_asc":
    case "upcoming":
      return arr.sort(
        (a, b) => (a.first_release_date || 0) - (b.first_release_date || 0)
      );
    default:
      // "popular": total_rating_count (critica + usuarios) en vez del rating
      // medio a secas, si no un indie de nicho con 11 notas de 10 le gana a
      // un juego masivo con miles de notas de 8.
      return arr.sort(
        (a, b) =>
          (b.total_rating_count || b.rating_count || 0) -
          (a.total_rating_count || a.rating_count || 0)
      );
  }
}

// Tope real de IGDB por request (no es cosa nuestra, es la API). Para
// navegar mas alla se pagina con "offset" en peticiones sucesivas.
const IGDB_MAX_LIMIT = 500;

function discoverSortClause(sort) {
  switch (sort) {
    case "az":
      return "sort name asc";
    case "za":
      return "sort name desc";
    case "year_desc":
      return "sort first_release_date desc";
    case "year_asc":
    case "upcoming":
      return "sort first_release_date asc";
    default:
      return "sort total_rating_count desc";
  }
}

// Filtro de prefijo para el indice A-Z: IGDB no soporta comparacion de texto
// (">="/"<" da error de sintaxis con strings), pero si un wildcard tipo
// glob con "=" - verificado contra la API real: `name = "P"*` devuelve solo
// los que empiezan por P, en una sola peticion, instantaneo pase lo que pase
// de grande que sea el catalogo. "0-9" se arma como OR de los 10 digitos
// (tambien verificado). "#" (simbolos sueltos) no tiene filtro fiable
// posible en Apicalypse, asi que ese caso se resuelve en el renderer con lo
// que ya haya cargado, sin pedir nada al servidor.
const SYMBOL_PREFIXES = [".", "'", '"', "(", "[", "!", "¡", "¿", "?", "#", "$", "&", "*", "+", "-", "/", "@", "~", ":", "<", ">", "=", "^", "|", "{", ",", ";", "…", "«", "“", "‘"];

function letterPrefixClause(bucket) {
  if (bucket === "0-9") {
    const digits = "0123456789".split("").map((d) => `name = "${d}"*`);
    return `(${digits.join(" | ")})`;
  }
  if (bucket === "#") {
    // Nombres que empiezan por símbolo (".hack//", "#IDARB", "[Redacted]"...).
    // El prefijo de IGDB funciona como un LIKE: "_" y "%" son comodines y
    // devolverían todo el catálogo, así que no se incluyen.
    const lits = SYMBOL_PREFIXES.map((s) => `name = "${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"*`);
    return `(${lits.join(" | ")})`;
  }
  return `name = "${String(bucket).replace(/"/g, '\\"')}"*`;
}

ipcMain.handle("igdb:discover", async (_e, opts = {}) => {
  const { query = "", genreId = null, sort = "popular", offset = 0, letterPrefix = null } = opts;
  const pageSize = clampGamesPerPage(opts.pageSize);

  const whereParts = [
    `game_type = ${IGDB_REAL_GAME_TYPES}`,
    "cover != null", // sin caratula = ficha basura/sin documentar, fuera
    "themes != (42)", // 42 = Erotic (verificado contra /v4/themes), fuera contenido adulto
  ];
  if (genreId) whereParts.push(`genres = (${Number(genreId)})`);

  const trimmedQuery = (query || "").trim();

  if (sort === "upcoming") {
    whereParts.push(`first_release_date > ${Math.floor(Date.now() / 1000)}`);
  } else if (sort === "popular" && !trimmedQuery) {
    // Este umbral solo se aplica al navegar (sin buscar): en "Mas popular"
    // sin texto queremos juegos de verdad conocidos. Al buscar por nombre no
    // se aplica, para no perder resultados legitimos poco valorados.
    // Con nombres de símbolos casi ninguno llega a 20 valoraciones.
    whereParts.push(letterPrefix === "#" ? "total_rating_count > 2" : "total_rating_count > 20");
  } else if ((sort === "az" || sort === "za") && !trimmedQuery) {
    // Sin este filtro, el principio (y el final) del catalogo ordenado por
    // nombre esta lleno de fichas basura con nombres de simbolos sueltos
    // ("^_^", "_____", "***"...) que no son juegos de verdad - con al menos
    // 1 valoracion ya desaparecen, verificado contra la API real.
    whereParts.push("total_rating_count > 0");
  }

  if (letterPrefix && !trimmedQuery) {
    const clause = letterPrefixClause(letterPrefix);
    if (clause) whereParts.push(clause);
  }

  const fields =
    "fields id,name,cover.image_id,rating,rating_count,total_rating,total_rating_count,platforms,first_release_date,genres.name;";
  const whereClause = `where ${whereParts.join(" & ")};`;

  if (trimmedQuery) {
    // IGDB ignora "sort" en cuanto la query lleva "search" (ordena siempre
    // por relevancia de texto) y no pagina bien mas alla de eso - en vez de
    // pelearnos con su paginacion, se trae de una vez el maximo que deja la
    // API (500) ya sin el tope de 60 que teniamos nosotros, se ordena aqui
    // mismo en JS, y el renderer pagina en local sobre ese conjunto.
    const body = `search "${trimmedQuery.replace(/"/g, '\\"')}"; ${fields} ${whereClause} limit ${IGDB_MAX_LIMIT};`;
    const results = await igdbGamesQuery(body);
    if (!Array.isArray(results)) return { items: [], hasMore: false, failed: true };
    return { items: sortDiscoverResults(results, sort), hasMore: false, fullPool: true };
  }

  // Resto de casos (popular/ano/proximamente/alfabetico, con o sin letra
  // concreta): "sort" + "offset" de Apicalypse funcionan bien juntos al no
  // llevar "search", asi que se pagina de verdad contra la API. Con
  // letterPrefix, esto pagina dentro de esa letra (por si hay mas de 60).
  const sortClause = discoverSortClause(sort);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const body = `${fields} ${whereClause} ${sortClause}; limit ${pageSize}; offset ${safeOffset};`;
  const results = await igdbGamesQuery(body);
  if (!Array.isArray(results)) return { items: [], hasMore: false, failed: true };

  return { items: results, hasMore: results.length === pageSize };
});

ipcMain.handle("igdb:genres", async () => {
  return igdbGamesQuery("fields id,name; sort name asc; limit 50;", "genres");
});

// -------------------- Biblioteca IPC --------------------
ipcMain.handle("games:get", () => ({ games, completedGames }));

ipcMain.handle("games:add", (_e, incoming) => {
  const { jarvisReason, ...game } = incoming || {}; // el motivo de Jarvis no se guarda
  const gameId = Number(game.id);
  if (!findAnyGame(gameId)) {
    const baseName = game.name || "";
    games.push({
      ...game,
      id: gameId,
      executable: null,
      sortKey: baseName,
    });
    saveData();
  }
  return { games, completedGames };
});

// Se deduce la plataforma de la propia ruta del .exe en vez de preguntarla:
// no cambia como se lanza el juego (eso solo pasa por steamAppId/epicAppName/
// gogGameId, que solo pone la importacion automatica, nunca un vinculo
// manual), asi que preguntarla aqui era un paso de mas sin ningun efecto
// real - vincular a mano es siempre "coge este .exe y lanzalo", punto.
function detectPlatformFromPath(p) {
  const lower = (p || "").toLowerCase();
  if (lower.includes("\\steamapps\\")) return "steam";
  if (lower.includes("epic games\\")) return "epic";
  if (lower.includes("gog galaxy\\") || lower.includes("\\gog games\\")) return "gog";
  return "none";
}

ipcMain.handle("games:setExe", (_e, { id, path: exePath }) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return;

  g.executable = exePath;
  g.platform = detectPlatformFromPath(exePath);
  saveData();
});

// Avisa a la ventana de cada paso para el modal de "Abriendo...":
// client (arrancando Steam/Epic/GOG) -> launching -> running (si se llega a
// ver el proceso del juego). El resultado final va en el return.
ipcMain.handle("games:launch", async (e, id) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return { ok: false, error: "No se encuentra el juego en tu biblioteca." };
  const step = (s, extra = {}) => {
    if (!e.sender.isDestroyed()) e.sender.send("launch:progress", { id: gameId, step: s, ...extra });
  };

  // Esperar a que arranque el cliente (Steam/Epic/GOG) solo tiene sentido si
  // de verdad vamos a lanzar por ahi (steamAppId/epicAppName/gogGameId, que
  // solo rellena la importacion automatica). Un juego vinculado a mano no
  // tiene esos IDs y siempre acaba lanzando el .exe directo, asi que hacerle
  // esperar 20s a un cliente que ni va a usar era pura perdida de tiempo.
  const tienePlatformIntegration =
    (g.platform === "steam" && g.steamAppId) ||
    (g.platform === "epic" && g.epicAppName) ||
    (g.platform === "gog" && g.gogGameId);

  if (tienePlatformIntegration) {
    let processName = null;
    switch (g.platform) {
      case "steam":
        processName = "Steam.exe";
        break;
      case "epic":
        processName = "EpicGamesLauncher.exe";
        break;
      case "gog":
        processName = "GalaxyClient.exe";
        break;
    }

    if (processName) {
      const running = await isProcessRunning(processName);
      if (!running) {
        step("client");
        const launched = launchPlatform(g.platform);
        if (launched) {
          // Sondea cada segundo hasta ver el proceso arriba, en vez de
          // esperar siempre 10s fijos (demasiado si arranca rápido, poco
          // si tarda más de la cuenta).
          const maxWaitMs = 20000;
          const stepMs = 1000;
          let waited = 0;
          while (waited < maxWaitMs) {
            await sleep(stepMs);
            waited += stepMs;
            if (await isProcessRunning(processName)) break;
          }
        }
      }
    }
  }

  step("launching");
  const result = await launchGameByPlatform(g);
  if (!result.ok) return result;

  // Si se sabe el .exe del juego, se espera a verlo en marcha (hasta 45s:
  // Steam puede tardar en sincronizar o actualizar antes de abrirlo).
  const exeName = g.executable ? path.basename(g.executable) : null;
  if (!exeName) return { ok: true, running: null };
  for (let waited = 0; waited < 45000; waited += 1500) {
    if (await isProcessRunning(exeName)) {
      step("running");
      return { ok: true, running: true };
    }
    await sleep(1500);
  }
  return { ok: true, running: false };
});

ipcMain.handle("games:completed", (_e, id) => {
  const gameId = Number(id);
  const idx = games.findIndex((x) => x.id === gameId);
  if (idx >= 0) {
    const g = games.splice(idx, 1)[0];
    g.completedAt = Date.now();
    completedGames.push(g);
    saveData();
  }
  return { games, completedGames };
});

ipcMain.handle("games:return", (_e, id) => {
  const gameId = Number(id);
  const idx = completedGames.findIndex((x) => x.id === gameId);
  if (idx >= 0) {
    const g = completedGames.splice(idx, 1)[0];
    games.push(g);
    saveData();
  }
  return { games, completedGames };
});

ipcMain.handle("games:remove", (_e, id) => {
  const gameId = Number(id);
  games = games.filter((g) => g.id !== gameId);
  completedGames = completedGames.filter((g) => g.id !== gameId);
  sagas.forEach((s) => {
    s.gameIds = s.gameIds.filter((gid) => gid !== gameId);
  });
  saveData();
  return { games, completedGames };
});

// Borra la biblioteca entera: juegos, pasados (con sus platinos) y sagas.
// Los ajustes (tema, columnas...) se mantienen.
ipcMain.handle("data:clearAll", () => {
  games = [];
  completedGames = [];
  sagas = [];
  appSettings.dismissedSagaSuggestions = [];
  saveData();
  saveSettings();
  return { games, completedGames };
});

// -------------------- PokéPark --------------------
// La lógica del parque vive en pokepark.js (ventana); aquí solo se lee la
// Pokédex empaquetada y se guarda el estado en userData/pokepark.json.
const pokeparkFilePath = path.join(app.getPath("userData"), "pokepark.json");
let pokedexCache = null;

ipcMain.handle("pokepark:dex", () => {
  if (!pokedexCache) {
    pokedexCache = JSON.parse(fs.readFileSync(path.join(__dirname, "assets", "pokepark", "pokedex.json"), "utf8"));
  }
  return pokedexCache;
});

// Sprites: se descargan desde aquí (sin CORS) y se guardan en disco. A la
// ventana le llegan como data URL, así puede medirlos en un canvas (para
// apoyar los pies en el suelo) y funcionan sin internet una vez vistos.
const spriteCacheDir = path.join(app.getPath("userData"), "sprite-cache");
const spriteMem = new Map();

ipcMain.handle("pokepark:sprite", async (_e, url) => {
  if (typeof url !== "string" || !/^https:\/\/(play\.pokemonshowdown\.com|raw\.githubusercontent\.com)\//.test(url)) return null;
  if (spriteMem.has(url)) return spriteMem.get(url);
  const ext = url.toLowerCase().endsWith(".gif") ? "gif" : "png";
  const file = path.join(spriteCacheDir, url.replace(/^https:\/\//, "").replace(/[^a-z0-9.]+/gi, "_"));
  let buf = null;
  try {
    if (fs.existsSync(file)) buf = fs.readFileSync(file);
    else {
      const res = await fetch(url, { timeout: 20000 });
      if (!res.ok) {
        spriteMem.set(url, null);
        return null;
      }
      buf = await res.buffer();
      fs.mkdirSync(spriteCacheDir, { recursive: true });
      fs.writeFileSync(file, buf);
    }
  } catch {
    return null; // sin conexión: no se cachea el fallo, se reintentará
  }
  const dataUrl = `data:image/${ext};base64,${buf.toString("base64")}`;
  spriteMem.set(url, dataUrl);
  return dataUrl;
});

ipcMain.handle("pokepark:get", () => {
  try {
    return fs.existsSync(pokeparkFilePath) ? JSON.parse(fs.readFileSync(pokeparkFilePath, "utf8")) : null;
  } catch (err) {
    console.error("Error leyendo pokepark.json", err);
    return null;
  }
});

function writeJsonAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

ipcMain.handle("pokepark:save", (_e, state) => {
  try {
    writeJsonAtomic(pokeparkFilePath, state);
    cloud?.markDirty("pokepark");
    return true;
  } catch (err) {
    console.error("Error guardando pokepark.json", err);
    return false;
  }
});

// -------------------- Logros: contadores de uso --------------------
// Los logros se calculan en la ventana (achievements.js); aquí solo se
// guardan sus contadores, que también viajan a la cuenta.
const statsFilePath = path.join(app.getPath("userData"), "stats.json");
ipcMain.handle("stats:get", () => readJson(statsFilePath) || {});
ipcMain.handle("stats:save", (_e, stats) => {
  try {
    writeJsonAtomic(statsFilePath, stats && typeof stats === "object" ? stats : {});
    cloud?.markDirty("stats");
    return true;
  } catch (err) {
    console.error("Error guardando stats.json", err);
    return false;
  }
});

// -------------------- Cuenta y nube --------------------
function setupCloud() {
  cloud = createCloud({
    safeStorage,
    settings: appSettings,
    saveSettings,
    notify: (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data),
    getLibrary: () => ({ games, completedGames, sagas }),
    setLibrary: (lib) => {
      games = (lib.games || []).map((g) => ({ ...g, id: Number(g.id), sortKey: g.sortKey || g.name || "" }));
      completedGames = (lib.completedGames || []).map((g, i) => ({
        ...g,
        id: Number(g.id),
        sortKey: g.sortKey || g.name || "",
        completedAt: g.completedAt || i,
      }));
      sagas = (lib.sagas || []).map((x) => ({ id: x.id, name: x.name || "", gameIds: (x.gameIds || []).map(Number) }));
      writeLibraryFile();
    },
    getPokepark: () => readJson(pokeparkFilePath),
    setPokepark: (state) => state && writeJsonAtomic(pokeparkFilePath, state),
    getStats: () => readJson(statsFilePath) || {},
    setStats: (stats) => writeJsonAtomic(statsFilePath, stats || {}),
  });
  for (const [name, fn] of Object.entries(cloud.ipc)) ipcMain.handle(`cloud:${name}`, (_e, ...args) => fn(...args));
}

// -------------------- Spotify (solo admins, no testers) --------------------
function setupSpotify() {
  const spotify = createSpotify({
    safeStorage,
    settings: appSettings,
    saveSettings,
    shell,
    isAllowed: () => {
      const u = cloud?.loggedIn() ? appSettings.cloudUser : null;
      return !!u?.admin && !u.tester;
    },
  });
  for (const [name, fn] of Object.entries(spotify.ipc)) ipcMain.handle(`spotify:${name}`, (_e, ...args) => fn(...args));
}

// Antes de cerrar se suben los cambios pendientes (máximo 4 s).
let quitFlushed = false;
app.on("before-quit", (e) => {
  if (quitFlushed || !cloud?.loggedIn()) return;
  e.preventDefault();
  quitFlushed = true;
  Promise.race([cloud.flush(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
});

// -------------------- Copias de partidas --------------------
let lastSaveScan = new Map();

function defaultBackupDir() {
  return appSettings.backupDir || path.join(app.getPath("documents"), "Sharingan Launcher", "Copias de partidas");
}

ipcMain.handle("saves:scan", async () => {
  try {
    const owned = [...games, ...completedGames];
    const steamRoot = owned.some((g) => g.steamAppId) ? await detectSteamRoot() : null;
    const results = await saves.scanSaves({ app, games: owned, steamRoot });
    lastSaveScan = new Map(results.map((r) => [Number(r.id), r]));
    return {
      ok: true,
      dir: defaultBackupDir(),
      games: results.map(({ id, name, paths, size, known }) => ({ id, name, count: paths.length, size, known })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("saves:chooseDir", async (_e, current) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "¿Dónde guardo las copias de partidas?",
    defaultPath: current || defaultBackupDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled ? null : filePaths?.[0] || null;
});

ipcMain.handle("saves:backup", async (e, { ids = [], dir } = {}) => {
  const dest = dir || defaultBackupDir();
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (err) {
    return { ok: false, error: `No se puede escribir en ${dest} (${err.code || err.message}).` };
  }
  appSettings.backupDir = dest;
  saveSettings();

  const when = saves.stamp();
  const results = [];
  for (const [i, rawId] of ids.entries()) {
    const item = lastSaveScan.get(Number(rawId));
    if (!e.sender.isDestroyed()) e.sender.send("saves:progress", { done: i, total: ids.length, name: item?.name });
    if (!item) continue;
    if (!item.paths.length) {
      results.push({ id: item.id, name: item.name, ok: false, error: "No se han encontrado sus partidas en este equipo." });
      continue;
    }
    try {
      const { partial } = saves.backupGame(item, dest, when);
      results.push({ id: item.id, name: item.name, ok: true, size: item.size, partial });
    } catch (err) {
      results.push({ id: item.id, name: item.name, ok: false, error: `Error al copiar: ${err.message}` });
    }
    // Deja respirar al proceso entre juego y juego (copias grandes).
    await sleep(0);
  }
  return { ok: true, dir: dest, results };
});

ipcMain.handle("saves:openDir", (_e, dir) => shell.openPath(dir || defaultBackupDir()));

// -------------------- Sagas sugeridas --------------------
// Se proponen sagas a partir de los nombres (juegos que comparten las
// primeras palabras, quitando numeración y subtítulos: "Dark Souls II",
// "Dark Souls III" -> "Dark Souls") y de las colecciones de IGDB de los
// juegos que vienen de IGDB. Nunca se repite una que ya existe ni una que
// el usuario haya rechazado.
const SAGA_STOPWORDS = new Set(["the", "a", "an", "el", "la", "los", "las", "of", "de", "and", "y"]);
const SAGA_GENERIC_SINGLE = new Set([
  "super", "star", "world", "final", "total", "grand", "little", "great", "dead", "dark", "black", "new",
  "real", "ultimate", "legend", "legends", "tales", "space", "battle", "game", "games", "simulator",
]);
const SEQUEL_TOKEN = /^(\d+|i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|remastered|remake|definitive|edition|goty|hd|deluxe|complete|enhanced|redux|anniversary|collection|trilogy|origins?)$/;

function sagaNorm(s) {
  return saves.normTitle(s);
}

// Título base con las palabras originales: lo que va antes de ":" o " - ",
// sin numeración/edición al final.
function baseTitleWords(name) {
  const head = String(name || "").split(/\s*[:–—]\s*|\s+-\s+/)[0];
  const words = head
    .replace(/[™®©]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && SEQUEL_TOKEN.test(sagaNorm(words[words.length - 1]))) words.pop();
  return words;
}

function localSagaGroups(owned) {
  const groups = new Map(); // clave normalizada -> { words, ids:Set }
  for (const g of owned) {
    const words = baseTitleWords(g.name);
    for (let len = 1; len <= Math.min(4, words.length); len++) {
      const w = words.slice(0, len);
      const key = sagaNorm(w.join(" "));
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { words: w, ids: new Set() });
      groups.get(key).ids.add(Number(g.id));
    }
  }
  const valid = [...groups.entries()].filter(([key, grp]) => {
    if (grp.ids.size < 2) return false;
    const toks = key.split(" ");
    if (toks.every((t) => SAGA_STOPWORDS.has(t))) return false;
    if (toks.length === 1 && (toks[0].length < 5 || SAGA_GENERIC_SINGLE.has(toks[0]))) return false;
    return true;
  });
  // Si una clave más larga agrupa exactamente los mismos juegos, se queda la larga.
  return valid
    .filter(([key, grp]) =>
      !valid.some(([k2, g2]) => k2 !== key && k2.startsWith(key + " ") && g2.ids.size === grp.ids.size)
    )
    .map(([, grp]) => ({ name: grp.words.join(" "), ids: [...grp.ids] }));
}

async function igdbSagaGroups(owned) {
  // Solo juegos que vienen de IGDB: los importados usan el id de Steam/Epic/
  // GOG o uno generado, que en IGDB sería otro juego distinto.
  const igdbIds = owned
    .filter((g) => !g.installDir && !g.steamAppId && !g.epicAppName && !g.gogGameId)
    .map((g) => Number(g.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!igdbIds.length) return [];
  const groups = new Map();
  for (let i = 0; i < igdbIds.length; i += 400) {
    const chunk = igdbIds.slice(i, i + 400);
    const rows = await igdbGamesQuery(`fields id,collections.name; where id = (${chunk.join(",")}); limit 500;`).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      for (const c of row.collections || []) {
        if (!c?.name) continue;
        if (!groups.has(c.id)) groups.set(c.id, { name: c.name, ids: new Set() });
        groups.get(c.id).ids.add(Number(row.id));
      }
    }
  }
  return [...groups.values()].filter((g) => g.ids.size >= 2).map((g) => ({ name: g.name, ids: [...g.ids] }));
}

ipcMain.handle("sagas:suggestions", async () => {
  const owned = [...games, ...completedGames];
  const dismissed = new Set(appSettings.dismissedSagaSuggestions || []);
  const existing = new Set(sagas.map((s) => sagaNorm(s.name)));
  const sagaOf = new Map();
  sagas.forEach((s) => s.gameIds.forEach((id) => sagaOf.set(Number(id), s.id)));

  const merged = new Map();
  for (const grp of [...(await igdbSagaGroups(owned)), ...localSagaGroups(owned)]) {
    const key = sagaNorm(grp.name);
    if (!key || existing.has(key) || dismissed.has(key)) continue;
    if (merged.has(key)) grp.ids.forEach((id) => merged.get(key).ids.add(id));
    else merged.set(key, { name: grp.name, ids: new Set(grp.ids) });
  }

  return [...merged.values()]
    .map((s) => ({ name: s.name, gameIds: [...s.ids] }))
    .filter((s) => {
      // Fuera las que ya están montadas: todos sus juegos en una misma saga.
      const owners = new Set(s.gameIds.map((id) => sagaOf.get(id)));
      return !(owners.size === 1 && !owners.has(undefined));
    })
    .sort((a, b) => b.gameIds.length - a.gameIds.length || a.name.localeCompare(b.name, "es"))
    .slice(0, 10);
});

ipcMain.handle("sagas:dismissSuggestion", (_e, name) => {
  const key = sagaNorm(name);
  if (key) {
    appSettings.dismissedSagaSuggestions = [...new Set([...(appSettings.dismissedSagaSuggestions || []), key])];
    saveSettings();
  }
  return true;
});

// -------------------- Sagas IPC --------------------
function makeSagaId() {
  return `saga_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

ipcMain.handle("sagas:get", () => sagas);

ipcMain.handle("sagas:create", (_e, name) => {
  const trimmed = (name || "").trim();
  if (trimmed) {
    sagas.push({ id: makeSagaId(), name: trimmed, gameIds: [] });
    saveData();
  }
  return sagas;
});

ipcMain.handle("sagas:delete", (_e, id) => {
  sagas = sagas.filter((x) => x.id !== id);
  saveData();
  return sagas;
});

ipcMain.handle("sagas:rename", (_e, { sagaId, name }) => {
  const trimmed = (name || "").trim();
  const target = sagas.find((x) => x.id === sagaId);
  if (target && trimmed) {
    target.name = trimmed;
    saveData();
  }
  return sagas;
});

// Orden de las sagas en la lista (y por tanto en la biblioteca).
ipcMain.handle("sagas:reorder", (_e, ids) => {
  const pos = new Map((ids || []).map((id, i) => [id, i]));
  sagas.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  saveData();
  return sagas;
});

// Orden de los juegos dentro de una saga (arrastrar y soltar).
ipcMain.handle("sagas:setOrder", (_e, { sagaId, gameIds }) => {
  const target = sagas.find((x) => x.id === sagaId);
  if (!target) return sagas;
  const wanted = (gameIds || []).map(Number).filter((id) => target.gameIds.includes(id));
  const rest = target.gameIds.filter((id) => !wanted.includes(id));
  target.gameIds = [...wanted, ...rest];
  saveData();
  return sagas;
});

function findAnyGame(id) {
  return games.find((x) => x.id === id) || completedGames.find((x) => x.id === id) || null;
}

// Orden "natural" de una saga: por fecha de lanzamiento y, si no se conoce,
// por nombre teniendo en cuenta los números (Juego 2 antes que Juego 10).
function compareChronological(a, b) {
  const da = a?.first_release_date || 0;
  const db = b?.first_release_date || 0;
  if (da && db && da !== db) return da - db;
  if (da && !db) return -1;
  if (!da && db) return 1;
  return String(a?.sortKey || a?.name || "").localeCompare(String(b?.sortKey || b?.name || ""), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

// Los juegos importados no traen fecha de lanzamiento: se busca en IGDB por
// nombre (una vez, queda guardada en el juego).
async function ensureReleaseDate(g) {
  if (!g || g.first_release_date || g.releaseDateChecked) return;
  const q = String(g.name || "").replace(/[®™©]/g, "").replace(/"/g, '\\"').trim();
  if (!q) return;
  try {
    const data = await igdbGamesQuery(`search "${q}"; fields name,first_release_date; limit 10;`);
    const target = normalizeGameName(g.name);
    const hit =
      (Array.isArray(data) ? data : []).find(
        (x) => x.first_release_date && normalizeGameName(x.name) === target
      ) || (Array.isArray(data) ? data : []).find((x) => x.first_release_date);
    if (hit) g.first_release_date = hit.first_release_date;
  } catch {}
  g.releaseDateChecked = true;
}

async function sortSagaChronologically(saga) {
  for (const id of saga.gameIds) await ensureReleaseDate(findAnyGame(id));
  saga.gameIds.sort((a, b) => compareChronological(findAnyGame(a), findAnyGame(b)));
}

ipcMain.handle("sagas:addGame", async (_e, { sagaId, gameId }) => {
  const gid = Number(gameId);
  const target = sagas.find((x) => x.id === sagaId);
  if (!target) return sagas;
  // Un juego solo pertenece a una saga a la vez (modelo tipo "carpeta").
  sagas.forEach((s) => {
    s.gameIds = s.gameIds.filter((id) => id !== gid);
  });
  // Se coloca en su sitio cronológico respetando el orden que ya tenga la
  // saga (por si el usuario lo retocó a mano).
  const g = findAnyGame(gid);
  await ensureReleaseDate(g);
  let at = target.gameIds.findIndex((id) => compareChronological(g, findAnyGame(id)) < 0);
  if (at < 0) at = target.gameIds.length;
  target.gameIds.splice(at, 0, gid);
  saveData();
  return sagas;
});

ipcMain.handle("sagas:sortByRelease", async (_e, sagaId) => {
  const target = sagas.find((x) => x.id === sagaId);
  if (target) {
    await sortSagaChronologically(target);
    saveData();
  }
  return sagas;
});

ipcMain.handle("sagas:removeGame", (_e, { sagaId, gameId }) => {
  const gid = Number(gameId);
  const target = sagas.find((x) => x.id === sagaId);
  if (target) {
    target.gameIds = target.gameIds.filter((id) => id !== gid);
    saveData();
  }
  return sagas;
});

ipcMain.handle("sagas:moveGame", (_e, { sagaId, gameId, direction }) => {
  const gid = Number(gameId);
  const target = sagas.find((x) => x.id === sagaId);
  if (!target) return sagas;
  const idx = target.gameIds.indexOf(gid);
  if (idx < 0) return sagas;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= target.gameIds.length) return sagas;
  [target.gameIds[idx], target.gameIds[swapWith]] = [
    target.gameIds[swapWith],
    target.gameIds[idx],
  ];
  saveData();
  return sagas;
});

ipcMain.handle("games:unlink", (_e, id) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (g) {
    g.executable = null;
    saveData();
  }
});

ipcMain.handle("games:updateSortKey", (_e, { id, sortKey }) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return { ok: false };

  g.sortKey = sortKey || "";
  saveData();
  return { ok: true };
});

// -------------------- Dialogs IPC --------------------
ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Ejecutables", extensions: ["exe"] }],
  });
  return { canceled, filePath: filePaths?.[0] };
});

ipcMain.handle("dialog:openDirectory", async (_e, opts = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: opts.title || "Selecciona una carpeta",
    defaultPath: opts.defaultPath || undefined,
    properties: ["openDirectory"],
  });
  return { canceled, dirPath: filePaths?.[0] };
});

// -------------------- Importar instalados (Steam/Epic/GOG/sin launcher) --------------------
// Se detecta todo solo al pulsar "Importar": el registro de Windows es donde
// Steam, Epic y GOG Galaxy dejan apuntado dónde están instalados, así que se
// mira ahí primero y las rutas típicas solo se usan de respaldo. Solo se le
// pide una carpeta al usuario para lo que no se haya encontrado.
function regQuery(key, valueName) {
  return new Promise((resolve) => {
    const args = valueName ? ["query", key, "/v", valueName] : ["query", key, "/s"];
    execFile("reg", args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? "" : String(stdout || ""))
    );
  });
}

function regValue(text, name) {
  const m = String(text || "").match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, "im"));
  return m ? m[1].trim() : null;
}

// Acepta la carpeta de Steam, una biblioteca secundaria (D:\SteamLibrary) o
// directamente su carpeta steamapps.
function resolveSteamRoot(dir) {
  if (!dir) return null;
  if (path.basename(dir).toLowerCase() === "steamapps") dir = path.dirname(dir);
  return exists(path.join(dir, "steamapps")) ? dir : null;
}

async function detectSteamRoot() {
  const candidates = [];
  const user = regValue(await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath"), "SteamPath");
  if (user) candidates.push(path.normalize(user));
  const machine = regValue(
    await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
    "InstallPath"
  );
  if (machine) candidates.push(path.normalize(machine));
  candidates.push("C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam");
  for (const c of candidates) {
    const root = resolveSteamRoot(c);
    if (root) return root;
  }
  return null;
}

// Acepta la carpeta Manifests o la carpeta de datos de Epic que la contiene.
function resolveEpicManifests(dir) {
  if (!dir) return null;
  const hasItems = (d) => listFiles(d).some((f) => f.toLowerCase().endsWith(".item"));
  if (exists(dir) && hasItems(dir)) return dir;
  const nested = path.join(dir, "Manifests");
  return exists(nested) ? nested : null;
}

async function detectEpicManifests() {
  const appData = regValue(
    await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher", "AppDataPath"),
    "AppDataPath"
  );
  const candidates = [];
  if (appData) candidates.push(path.join(appData, "Manifests"));
  candidates.push("C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests");
  return candidates.find((p) => exists(p)) || null;
}

// GOG Galaxy registra cada juego instalado (nombre, carpeta y .exe), una
// subclave por juego.
async function readGogRegistryGames() {
  const out = await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games");
  if (!out) return [];
  return out
    .split(/\r?\n(?=HKEY_)/)
    .map((block) => ({
      id: regValue(block, "gameID"),
      name: regValue(block, "gameName"),
      dir: regValue(block, "path"),
      exe: regValue(block, "exe"),
    }))
    .filter((g) => g.name && g.dir && exists(g.dir));
}

function newImportReport() {
  return { status: "not_found", location: null, added: [], existing: 0, noLaunch: [], error: null };
}

function trackImported(report, gameObj) {
  const { status, game } = upsertGameImported(gameObj);
  if (status === "new") report.added.push(game.name);
  else report.existing++;
  if (!canLaunch(game)) report.noLaunch.push({ id: game.id, name: game.name });
}

const STEAM_SKIP_APPIDS = new Set([
  228980, // Steamworks Common Redistributables
  431960, // Wallpaper Engine
  1812620, // DSX
]);

function looksLikeSteamTool(name) {
  const n = (name || "").toLowerCase();
  return ["wallpaper engine", "driver booster", "controller", "soundtrack", "editor", "sdk", "redistributable"].some(
    (w) => n.includes(w)
  );
}

function importSteam(root, report) {
  report.status = "ok";
  report.location = root;
  const vdfText =
    safeReadText(path.join(root, "steamapps", "libraryfolders.vdf")) ||
    safeReadText(path.join(root, "config", "libraryfolders.vdf"));
  const libraries = [...new Set([...parseSteamLibraryFoldersVdf(vdfText), root])].filter(
    (p) => p && exists(p)
  );

  for (const lib of libraries) {
    const steamapps = path.join(lib, "steamapps");
    const manifests = listFiles(steamapps).filter(
      (f) => path.basename(f).toLowerCase().startsWith("appmanifest_") && f.toLowerCase().endsWith(".acf")
    );

    for (const mf of manifests) {
      const fields = parseAcfRootFields(safeReadText(mf));
      if (!fields.appid) continue;
      const appid = Number(fields.appid);
      if (STEAM_SKIP_APPIDS.has(appid) || looksLikeSteamTool(fields.name)) continue;

      const name = fields.name || `Steam App ${appid}`;
      const installDir = fields.installdir ? path.join(steamapps, "common", fields.installdir) : null;
      const exe = installDir && exists(installDir) ? pickBestExe(installDir) : null;

      trackImported(report, {
        id: appid,
        name,
        platform: "steam",
        steamAppId: appid,
        executable: exe,
        installDir,
        sortKey: name,
      });
    }
  }
}

function importEpic(manifestsDir, report) {
  report.status = "ok";
  report.location = manifestsDir;

  let installedList = null;
  const dat = safeReadText("C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat");
  if (dat) {
    try {
      installedList = JSON.parse(dat)?.InstallationList || null;
    } catch {}
  }

  for (const file of listFiles(manifestsDir).filter((f) => f.toLowerCase().endsWith(".item"))) {
    let obj;
    try {
      obj = JSON.parse(safeReadText(file));
    } catch {
      continue;
    }
    if (!obj || obj.bIsIncompleteInstall) continue;
    const appName = obj.AppName || null;
    // Unreal Engine y sus plugins también dejan manifiesto, no son juegos.
    if (appName && /^UE_/i.test(appName)) continue;

    const name = obj.DisplayName || appName || "Juego de Epic";
    let installLocation = obj.InstallLocation || null;
    if (!installLocation && installedList && appName) {
      installLocation = installedList.find((x) => x?.AppName === appName)?.InstallLocation || null;
    }

    let exe = null;
    if (installLocation && exists(installLocation)) {
      if (obj.LaunchExecutable) {
        const candidate = path.join(installLocation, obj.LaunchExecutable);
        if (exists(candidate)) exe = candidate;
      }
      if (!exe) exe = pickBestExe(installLocation);
    }

    trackImported(report, {
      id: stableNegativeId(`epic:${appName || name}`),
      name,
      platform: "epic",
      epicAppName: appName,
      executable: exe,
      installDir: installLocation,
      sortKey: name,
    });
  }
}

// Carpeta con varios juegos (una subcarpeta por juego); si ninguna
// subcarpeta tiene .exe, se prueba la propia carpeta como un único juego.
function importGamesFolder(root, platform, report, skipDirs = []) {
  report.status = "ok";
  report.location = report.location || root;
  let found = 0;

  for (const dir of listFiles(root).filter(isDirectory)) {
    if (skipDirs.some((d) => samePath(d, dir))) continue;
    const exe = pickBestExe(dir);
    if (!exe) continue; // extras, banda sonora, etc.
    found++;
    const name = path.basename(dir);
    trackImported(report, {
      id: stableNegativeId(`${platform}:${dir}`),
      name,
      platform,
      executable: exe,
      installDir: dir,
      sortKey: name,
    });
  }

  if (found === 0 && !skipDirs.some((d) => samePath(d, root))) {
    const exe = pickBestExe(root);
    if (exe) {
      const name = path.basename(root);
      trackImported(report, {
        id: stableNegativeId(`${platform}:${root}`),
        name,
        platform,
        executable: exe,
        installDir: root,
        sortKey: name,
      });
    }
  }
}

async function importGog(customRoot, report) {
  if (customRoot) {
    importGamesFolder(customRoot, "gog", report);
    return;
  }

  const fromRegistry = await readGogRegistryGames();
  for (const rg of fromRegistry) {
    const exe = rg.exe && exists(rg.exe) ? rg.exe : pickBestExe(rg.dir);
    trackImported(report, {
      id: stableNegativeId(`gog:${rg.dir}`),
      name: rg.name,
      platform: "gog",
      executable: exe,
      installDir: rg.dir,
      // Con .exe se lanza directo (sin DRM); el id de Galaxy solo hace falta
      // si no hay ejecutable, para al menos abrir el juego en Galaxy.
      gogGameId: exe ? null : Number(rg.id) || null,
      sortKey: rg.name,
    });
  }
  if (fromRegistry.length) {
    report.status = "ok";
    report.location = "GOG Galaxy";
  }

  const skip = fromRegistry.map((g) => g.dir);
  for (const root of ["C:\\GOG Games", "C:\\Program Files (x86)\\GOG Galaxy\\Games"].filter(exists)) {
    importGamesFolder(root, "gog", report, skip);
  }
}

// config: { platforms?: ["steam","epic","gog","none"], steamRoot?, epicManifestsDir?, gogRoot?, noneRoot? }
// Sin "platforms" se buscan Steam, Epic y GOG automáticamente; las carpetas
// solo llegan cuando el usuario indica a mano dónde está algo que no se
// encontró solo.
ipcMain.handle("games:importInstalled", async (_e, config = {}) => {
  const want = new Set(config.platforms || ["steam", "epic", "gog"]);
  const report = {};

  if (want.has("steam")) {
    const r = (report.steam = newImportReport());
    try {
      const root = config.steamRoot ? resolveSteamRoot(config.steamRoot) : await detectSteamRoot();
      if (root) importSteam(root, r);
      else if (config.steamRoot) {
        r.status = "error";
        r.error = "En esa carpeta no hay una instalación de Steam.";
      }
    } catch (err) {
      r.status = "error";
      r.error = String(err?.message || err);
    }
  }

  if (want.has("epic")) {
    const r = (report.epic = newImportReport());
    try {
      const dir = config.epicManifestsDir
        ? resolveEpicManifests(config.epicManifestsDir)
        : await detectEpicManifests();
      if (dir) importEpic(dir, r);
      else if (config.epicManifestsDir) {
        r.status = "error";
        r.error = "En esa carpeta no hay manifiestos de Epic Games.";
      }
    } catch (err) {
      r.status = "error";
      r.error = String(err?.message || err);
    }
  }

  if (want.has("gog")) {
    const r = (report.gog = newImportReport());
    try {
      if (config.gogRoot && !exists(config.gogRoot)) {
        r.status = "error";
        r.error = "Esa carpeta no existe o no es accesible.";
      } else {
        await importGog(config.gogRoot || null, r);
      }
    } catch (err) {
      r.status = "error";
      r.error = String(err?.message || err);
    }
  }

  if (want.has("none") && config.noneRoot) {
    const r = (report.none = newImportReport());
    try {
      if (exists(config.noneRoot)) importGamesFolder(config.noneRoot, "none", r);
      else {
        r.status = "error";
        r.error = "Esa carpeta no existe o no es accesible.";
      }
    } catch (err) {
      r.status = "error";
      r.error = String(err?.message || err);
    }
  }

  saveData();
  return { ok: true, report };
});


// -------------------- Enrich covers from IGDB --------------------
ipcMain.handle("games:enrichCovers", async (_e, opts = {}) => {
  const limit = Number(opts.limit || 60);

  const targets = games
    .filter((g) => !g.cover?.image_id && !g.coverUrl && g.name)
    .slice(0, limit);

  console.log("[enrichCovers] targets=", targets.length);

  let updated = 0;

  // Normalización para comparar y buscar
  const normSearch = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[:\-_,.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  for (const g of targets) {
    const originalName = String(g.name || "").trim();
    if (!originalName) continue;

    const baseName = normSearch(originalName);
    const searchName = baseName;
    const safeQ = searchName.replace(/"/g, '\\"');

    const data = await igdbGamesQuery(`search "${safeQ}"; fields id,name,cover.image_id; limit 20;`);
    if (!Array.isArray(data) || !data.length) {
      console.log("[enrichCovers] sin resultados para", originalName);
      await sleep(250);
      continue;
    }

    const targetNorm = normSearch(originalName);

    // 1) nombre exactamente igual
    let hit = data.find(
      (x) => normSearch(x.name) === targetNorm && x?.cover?.image_id
    );

    // 2) empieza igual o contiene
    if (!hit) {
      hit = data.find(
        (x) =>
          x?.cover?.image_id &&
          (normSearch(x.name).startsWith(targetNorm) ||
            targetNorm.startsWith(normSearch(x.name)))
      );
    }

    // 3) primer resultado con cover
    if (!hit) {
      hit = data.find((x) => x?.cover?.image_id);
    }

    if (hit?.cover?.image_id) {
      g.cover = { image_id: hit.cover.image_id };
      g.coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${hit.cover.image_id}.jpg`;
      updated++;
      console.log("[enrichCovers] match para", originalName, "=>", hit.name);
    }

    await sleep(250);
  }

  if (updated > 0) saveData();

  console.log("[enrichCovers] updated=", updated);
  return { ok: true, scanned: targets.length, updated };
});

// -------------------- Platinado --------------------
ipcMain.handle("games:togglePlatinum", (_e, id) => {
  const gameId = Number(id);
  const g = completedGames.find((x) => x.id === gameId);

  if (g) {
    g.isPlatinum = !g.isPlatinum;
    saveData();
  }
  return { games, completedGames };
});

// -------------------- IA (Claude) --------------------
// La clave es del propio usuario y se guarda cifrada con el almacén seguro
// del sistema (DPAPI en Windows) dentro de settings.json.
function getAiKey() {
  if (!appSettings.aiKey) return null;
  try {
    return safeStorage.decryptString(Buffer.from(appSettings.aiKey, "base64"));
  } catch {
    return null;
  }
}

ipcMain.handle("ai:status", () => ({ configured: !!getAiKey(), model: ai.MODEL }));

ipcMain.handle("ai:setKey", async (_e, key) => {
  const k = String(key || "").trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, error: "Eso no parece una clave de la API de Claude (empieza por sk-ant-)." };
  const check = await ai.checkKey(k);
  if (!check.ok) return check;
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Windows no permite guardar la clave cifrada en este equipo." };
  appSettings.aiKey = safeStorage.encryptString(k).toString("base64");
  saveSettings();
  return { ok: true };
});

ipcMain.handle("ai:clearKey", () => {
  delete appSettings.aiKey;
  saveSettings();
  return { ok: true };
});

function requireAiKey() {
  const key = getAiKey();
  if (!key) throw new ai.AiError("Primero añade tu clave de la API de Claude en Ajustes.");
  return key;
}

const aiResult = async (fn) => {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    if (!(err instanceof ai.AiError)) console.error("IA", err);
    return { ok: false, error: err instanceof ai.AiError ? err.message : "No se ha podido hablar con la IA." };
  }
};

// Propuesta de orden cronológico (de la historia) para una saga. No se
// aplica sola: la ventana la enseña y el usuario decide.
ipcMain.handle("ai:orderSaga", (_e, sagaId) =>
  aiResult(async () => {
    const key = requireAiKey();
    const saga = sagas.find((x) => x.id === sagaId);
    if (!saga || saga.gameIds.length < 2) throw new ai.AiError("La saga necesita al menos dos juegos.");
    const list = saga.gameIds.map((id) => findAnyGame(id)).filter(Boolean);
    return ai.orderSaga(key, saga.name, list);
  })
);

// Recomendaciones de Jarvis: la IA propone títulos y aquí se buscan en IGDB
// (10 por petición con /multiquery) para tener ficha y carátula. Lo que ya
// tienes (biblioteca o pasados) se descarta aunque la IA lo proponga.
const JARVIS_COUNT = 30;
const JARVIS_FIELDS =
  "fields id,name,cover.image_id,rating,rating_count,total_rating,total_rating_count,platforms,first_release_date,genres.name;";

const igdbYear = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);
const igdbLiteral = (s) => String(s).replace(/[®™©]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim();

// Mismo nombre y año > mismo nombre > mismo año > el más relevante.
function bestIgdbHit(rec, hits) {
  const target = normalizeGameName(rec.title);
  return (
    hits.find((g) => normalizeGameName(g.name) === target && (!rec.year || igdbYear(g) === rec.year)) ||
    hits.find((g) => normalizeGameName(g.name) === target) ||
    hits.find((g) => rec.year && igdbYear(g) === rec.year) ||
    hits[0] ||
    null
  );
}

async function resolveOnIgdb(recs) {
  const found = new Array(recs.length).fill(null);
  const where = `game_type = ${IGDB_REAL_GAME_TYPES} & cover != null`;
  // 1) Nombre exacto (sin distinguir mayúsculas), 10 juegos por petición.
  //    /multiquery no admite "search", por eso va con "where name ~".
  for (let start = 0; start < recs.length; start += 10) {
    const body = recs
      .slice(start, start + 10)
      .map((r, i) => `query games "r${start + i}" { ${JARVIS_FIELDS} where name ~ "${igdbLiteral(r.title)}" & ${where}; limit 6; };`)
      .join("\n");
    const data = await igdbGamesQuery(body, "multiquery");
    for (const block of Array.isArray(data) ? data : []) {
      const idx = Number(String(block.name).slice(1));
      if (recs[idx] && block.result?.length) found[idx] = bestIgdbHit(recs[idx], block.result);
    }
  }
  // 2) Los que no casan exacto (subtítulos, símbolos...): búsqueda normal,
  //    de una en una para no pasar del límite de 4 peticiones/s de IGDB.
  for (let i = 0; i < recs.length; i++) {
    if (found[i]) continue;
    const data = await igdbGamesQuery(`search "${igdbLiteral(recs[i].title)}"; ${JARVIS_FIELDS} where ${where}; limit 6;`);
    if (Array.isArray(data) && data.length) found[i] = bestIgdbHit(recs[i], data);
    await new Promise((r) => setTimeout(r, 260));
  }
  return found;
}

ipcMain.handle("ai:recommend", (_e, opts = {}) =>
  aiResult(async () => {
    const key = requireAiKey();
    const owned = [...games, ...completedGames];
    if (!owned.length) throw new ai.AiError("Jarvis necesita algún juego en tu biblioteca o en pasados para conocer tus gustos.");
    const exclude = Array.isArray(opts.exclude) ? opts.exclude.slice(0, 200).map(String) : [];
    const recs = await ai.recommend(key, {
      platinum: completedGames.filter((g) => g.isPlatinum),
      completed: completedGames.filter((g) => !g.isPlatinum),
      library: games,
      exclude,
      count: JARVIS_COUNT,
    });
    const hits = await resolveOnIgdb(recs);
    const ownedIds = new Set(owned.map((g) => Number(g.id)));
    const ownedNames = new Set(owned.map((g) => normalizeGameName(g.name)));
    const seen = new Set();
    const items = [];
    recs.forEach((r, i) => {
      const g = hits[i];
      if (!g || ownedIds.has(g.id) || ownedNames.has(normalizeGameName(g.name)) || seen.has(g.id)) return;
      seen.add(g.id);
      items.push({ ...g, jarvisReason: r.reason });
    });
    return { items };
  })
);

// Enlaces externos desde la ventana: solo https.
ipcMain.handle("app:openExternal", (_e, url) => {
  if (String(url).startsWith("https://")) shell.openExternal(String(url));
});

// -------------------- System Specs IPC --------------------
ipcMain.handle("system:getSpecs", async () => {
  try {
    const cpu = await si.cpu();
    const mem = await si.mem();
    const graphics = await si.graphics();
    const osInfo = await si.osInfo();
    const fsSize = await si.fsSize().catch(() => []);

    const gpu =
      graphics.controllers.find((c) => c.vram > 1024) ||
      graphics.controllers[0];
    const vramGb = gpu?.vram ? Math.round((gpu.vram / 1024) * 10) / 10 : 0;

    // Espacio libre: no sabemos en que unidad va a instalar el usuario el
    // juego, asi que se toma la unidad con mas espacio libre (heuristica
    // "cabria en algun sitio", no una unidad concreta).
    const drives = (fsSize || []).filter((d) => d.size > 0);
    const freeStorage = drives.length
      ? Math.floor(Math.max(...drives.map((d) => d.available / 1024 / 1024 / 1024)))
      : null;

    return {
      cpu: `${cpu.manufacturer} ${cpu.brand}`,
      ram: Math.floor(mem.total / 1024 / 1024 / 1024), // GB
      gpu: gpu
        ? `${gpu.model} (${Math.floor(gpu.vram / 1024)} GB)`
        : "Integrada",
      vram: vramGb,
      os: osInfo.distro,
      freeStorage,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
});

// -------------------- Historial de versiones --------------------
ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("changelog:get", async () => {
  try {
    const res = await fetch(
      "https://api.github.com/repos/alessitto/Sharingan_Launcher/releases",
      { headers: { "User-Agent": "SharinganLauncher" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      body: r.body || "",
      publishedAt: r.published_at,
    }));
  } catch (e) {
    console.error("[Changelog] No se pudo cargar desde GitHub:", e.message);
    return [];
  }
});

// -------------------- IGDB Details (Info Modal) --------------------
// Los juegos importados de Steam/Epic/GOG llevan el id de su tienda (o uno
// generado), no el de IGDB: esos se buscan por nombre. Devuelve la ficha
// (o null) y el id de IGDB, que hace falta para los requisitos.
const DETAILS_FIELDS =
  "fields name,summary,genres.name,involved_companies.developer,involved_companies.company.name,first_release_date,cover.image_id,platforms.abbreviation,total_rating,total_rating_count;";

ipcMain.handle("igdb:getDetails", async (_e, arg) => {
  const { id, name } = typeof arg === "object" && arg ? arg : { id: arg };
  const owned = findAnyGame(Number(id));
  const imported = owned && (owned.installDir || owned.steamAppId || owned.epicAppName || owned.gogGameId || Number(id) < 0);
  if (!imported && Number(id) > 0) {
    const rows = await igdbGamesQuery(`${DETAILS_FIELDS} where id = ${Number(id)};`);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  const q = igdbLiteral(name || owned?.name || "");
  if (!q) return null;
  const rows = await igdbGamesQuery(`search "${q}"; ${DETAILS_FIELDS} where game_type = ${IGDB_REAL_GAME_TYPES}; limit 10;`);
  if (!Array.isArray(rows) || !rows.length) return null;
  const target = normalizeGameName(name || owned?.name);
  return rows.find((g) => normalizeGameName(g.name) === target) || rows[0];
});

// -------------------- Steam StoreService AppList (replacement) --------------------
const STEAM_WEB_API_KEY = config.steamWebApiKey || "";

// Cache in-memory + cache en disco
const steamAppListCachePath = path.join(
  app.getPath("userData"),
  "steam_applist_games.json"
);
let steamAppListCache = null;

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function safeWriteJson(p, obj) {
  try {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("[SteamAppList] Error writing cache file", e);
  }
}

// Descarga TODA la lista usando paginación (last_appid + max_results) desde IStoreService/GetAppList. [web:38]
async function fetchSteamAppListAllGames() {
  if (!STEAM_WEB_API_KEY)
    throw new Error("Falta STEAM_WEB_API_KEY (variable de entorno).");

  const all = [];
  let lastAppId = 0;

  while (true) {
    const qs = new URLSearchParams({
      key: STEAM_WEB_API_KEY,
      include_games: "true",
      include_dlc: "false",
      include_software: "false",
      include_videos: "false",
      include_hardware: "false",
      max_results: "50000",
      last_appid: String(lastAppId),
    });

    const url = `https://api.steampowered.com/IStoreService/GetAppList/v1/?${qs.toString()}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(
        `Steam StoreService error: ${r.status} ${r.statusText} ${text}`.trim()
      );
    }

    const j = await r.json();
    const apps = j?.response?.apps || [];

    if (!Array.isArray(apps) || apps.length === 0) break;

    all.push(...apps);

    // siguiente página
    lastAppId = apps[apps.length - 1].appid;

    if (apps.length < 50000) break;

    await sleep(250);
  }

  return all;
}

async function getSteamAppListCached() {
  // 1) RAM
  if (steamAppListCache && steamAppListCache.length) return steamAppListCache;

  // 2) Disco
  const fromDisk = safeReadJson(steamAppListCachePath);
  if (fromDisk?.apps && Array.isArray(fromDisk.apps) && fromDisk.apps.length) {
    steamAppListCache = fromDisk.apps;
    console.log(
      `[SteamAppList] Cargada cache desde disco: ${steamAppListCache.length}`
    );
    return steamAppListCache;
  }

  // 3) Descargar
  console.log("[SteamAppList] Descargando lista (IStoreService/GetAppList)...");
  steamAppListCache = await fetchSteamAppListAllGames();
  console.log(`[SteamAppList] Descargada: ${steamAppListCache.length}`);

  safeWriteJson(steamAppListCachePath, {
    updatedAt: new Date().toISOString(),
    apps: steamAppListCache,
  });

  return steamAppListCache;
}

// Helper para limpiar HTML que viene en pc_requirements de store.steampowered.com/api/appdetails
function stripHtml(html) {
  if (!html) return "No especificado";

  const text = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

ipcMain.handle(
  "steam:getRequirements",
  async (_e, { igdbId, steamAppId, gameName }) => {
    let targetSteamId = steamAppId;

    console.log(`[Reqs] Buscando para: "${gameName}" (IGDB: ${igdbId})`);

    // 1. INTENTO A: IGDB external_games (external_game_source 1 = Steam; el
    // antiguo "category" ya no se rellena)
    if (!targetSteamId && Number(igdbId) > 0) {
      try {
        const res = await igdbGamesQuery(
          `fields uid; where game = ${Number(igdbId)} & external_game_source = 1; limit 1;`,
          "external_games"
        );

        if (res && res.length > 0) {
          targetSteamId = res[0].uid;
          console.log(`[Reqs] ID encontrado vía IGDB: ${targetSteamId}`);
        }
      } catch (e) {
        console.error("[Reqs] Error IGDB external_games", e);
      }
    }

    // 2. INTENTO B: Búsqueda FUZZY en lista completa (StoreService)
    if (!targetSteamId && gameName) {
      console.log(
        `[Reqs] ID no encontrado en IGDB. Buscando "${gameName}" en Steam AppList (StoreService)...`
      );

      try {
        const appList = await getSteamAppListCached();

        const options = {
          keys: ["name"],
          threshold: 0.2,
          distance: 100,
        };

        const fuse = new Fuse(appList, options);
        const results = fuse.search(gameName);

        if (results.length > 0) {
          const best = results[0].item;
          targetSteamId = best.appid;
          console.log(
            `[Reqs] ¡Encontrado con Fuse! "${gameName}" ~ "${best.name}" (ID: ${targetSteamId})`
          );
        } else {
          console.log(
            `[Reqs] No se encontró coincidencia cercana para "${gameName}"`
          );
        }
      } catch (e) {
        console.error("[Reqs] Error en búsqueda Steam (StoreService)", e);
      }
    }

    // 3. Descargar requisitos de la tienda
    if (!targetSteamId) return null;
    try {
      const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${targetSteamId}&l=spanish`;

      // AÑADIMOS HEADERS AQUÍ TAMBIÉN
      const response = await fetch(steamUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
      const json = await response.json();

      const appData = json[targetSteamId];

      if (appData && appData.success && appData.data) {
        const pcReqs = appData.data.pc_requirements;

        // A veces viene vacio []
        if (!pcReqs || Array.isArray(pcReqs)) return null;

        return {
          min: stripHtml(pcReqs.minimum),
          rec: stripHtml(pcReqs.recommended),
        };
      }
    } catch (e) {
      console.error("[Reqs] Error fetching store details", e);
    }

    return null;
  }
);
