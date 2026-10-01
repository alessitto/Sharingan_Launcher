const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const Fuse = require("fuse.js");
const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");
const fetch = require("node-fetch"); // npm install node-fetch@2
const ps = require("ps-node"); // npm install ps-node
const si = require("systeminformation"); // npm install systeminformation

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

async function getIgdbToken(forceRefresh = false) {
  const now = Date.now();
  // Margen de 5 minutos antes de que caduque de verdad, por si acaso.
  if (!forceRefresh && igdbTokenCache.token && now < igdbTokenCache.expiresAt - 5 * 60 * 1000) {
    return igdbTokenCache.token;
  }

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

function saveData() {
  try {
    const payload = JSON.stringify({ games, completedGames, sagas }, null, 2);
    fs.writeFileSync(dataFilePath, payload, "utf8");
  } catch (err) {
    console.error("Error saving library.json", err);
  }
}

// === Ajustes de usuario (settings.json en userData) ===
const settingsFilePath = path.join(app.getPath("userData"), "settings.json");
const GAMES_PER_PAGE_MIN = 12;
const GAMES_PER_PAGE_MAX = 200;
let appSettings = { gamesPerPage: 60 };

function clampGamesPerPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return appSettings.gamesPerPage;
  return Math.min(GAMES_PER_PAGE_MAX, Math.max(GAMES_PER_PAGE_MIN, Math.round(n)));
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
      appSettings = {
        ...appSettings,
        ...parsed,
        gamesPerPage: clampGamesPerPage(parsed.gamesPerPage),
      };
    }
  } catch (err) {
    console.error("Error loading settings.json", err);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving settings.json", err);
  }
}

loadSettings();

ipcMain.handle("settings:get", () => appSettings);

ipcMain.handle("settings:set", (_e, patch = {}) => {
  if (patch.gamesPerPage !== undefined) {
    appSettings.gamesPerPage = clampGamesPerPage(patch.gamesPerPage);
  }
  saveSettings();
  return appSettings;
});

// -------------------- Helpers procesos --------------------
function isProcessRunning(processName) {
  return new Promise((resolve) => {
    ps.lookup({ command: processName }, (err, resultList) => {
      if (err) {
        console.error("ps.lookup error", err);
        resolve(false);
        return;
      }
      const found = resultList.some(
        (p) =>
          p &&
          p.command &&
          p.command.toLowerCase().includes(processName.toLowerCase())
      );
      resolve(found);
    });
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

function launchGameByPlatform(game) {
  switch (game.platform) {
    case "steam":
      if (game.steamAppId) {
        shell.openExternal(`steam://run/${game.steamAppId}`);
        return;
      }
      break;
    case "epic":
      if (game.epicAppName) {
        shell.openExternal(
          `com.epicgames.launcher://apps/${game.epicAppName}?action=launch&silent=true`
        );
        return;
      }
      break;
    case "gog":
      if (game.gogGameId) {
        shell.openExternal(`goggalaxy://openGameView/${game.gogGameId}`);
        return;
      }
      break;
  }

  if (game.executable) {
    execFile(game.executable, (err) => {
      if (err) console.error(err);
    });
  }
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

function findSteamDefaultRoot() {
  const p1 = "C:\\Program Files (x86)\\Steam";
  const p2 = "C:\\Program Files\\Steam";
  if (exists(p1)) return p1;
  if (exists(p2)) return p2;
  return null;
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
    return;
  }

  // 2) Mismo juego pero con otro id "principal": ya se habia emparejado
  // antes por su id de Steam/Epic/GOG, o coincide por nombre con algo ya en
  // la biblioteca metido desde OTRA fuente (tipico: agregado a mano desde
  // Descubrir con su ficha de IGDB, y ahora tambien detectado por el
  // escaneo automatico). En vez de duplicarlo, se rellenan los datos
  // tecnicos que le falten (ejecutable, carpeta, ids de plataforma) sin
  // pisar el nombre/caratula que ya tuviera - para no cambiar una ficha
  // buena de IGDB por el nombre en crudo del launcher de turno.
  g = findGameByExternalId(gameObj) || findGameByName(gameObj);
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
    return;
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
}

// -------------------- Window --------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.maximize();
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  loadData();
  createWindow();

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
    return [];
  }

  const res = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "text/plain",
    },
    body,
  });

  if (!res.ok) {
    // Token invalidado desde fuera (revocado, etc.) antes de la caducidad
    // que esperabamos: se fuerza una renovacion y se reintenta una vez.
    if (res.status === 401 && !isRetry) {
      await getIgdbToken(true);
      return igdbGamesQuery(body, endpoint, true);
    }
    const text = await res.text();
    console.error("IGDB error", res.status, text);
    return [];
  }

  return res.json();
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
const IGDB_REAL_GAME_TYPES = "(0,8,9,10)";

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
function letterPrefixClause(bucket) {
  if (bucket === "0-9") {
    const digits = "0123456789".split("").map((d) => `name = "${d}"*`);
    return `(${digits.join(" | ")})`;
  }
  if (bucket === "#") return null;
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
    whereParts.push("total_rating_count > 20");
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
    if (!Array.isArray(results)) return { items: [], hasMore: false };
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
  if (!Array.isArray(results)) return { items: [], hasMore: false };

  return { items: results, hasMore: results.length === pageSize };
});

ipcMain.handle("igdb:genres", async () => {
  return igdbGamesQuery("fields id,name; sort name asc; limit 50;", "genres");
});

// -------------------- Biblioteca IPC --------------------
ipcMain.handle("games:get", () => ({ games, completedGames }));

ipcMain.handle("games:add", (_e, game) => {
  const gameId = Number(game.id);
  if (!games.find((g) => g.id === gameId)) {
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

ipcMain.handle("games:launch", async (_e, id) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return;

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

  launchGameByPlatform(g);
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

ipcMain.handle("sagas:rename", (_e, { id, name }) => {
  const s = sagas.find((x) => x.id === id);
  const trimmed = (name || "").trim();
  if (s && trimmed) {
    s.name = trimmed;
    saveData();
  }
  return sagas;
});

ipcMain.handle("sagas:delete", (_e, id) => {
  sagas = sagas.filter((x) => x.id !== id);
  saveData();
  return sagas;
});

ipcMain.handle("sagas:addGame", (_e, { sagaId, gameId }) => {
  const gid = Number(gameId);
  const target = sagas.find((x) => x.id === sagaId);
  if (!target) return sagas;
  // Un juego solo pertenece a una saga a la vez (modelo tipo "carpeta").
  sagas.forEach((s) => {
    s.gameIds = s.gameIds.filter((id) => id !== gid);
  });
  target.gameIds.push(gid);
  saveData();
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

// -------------------- Import installed (Steam/Epic/GOG/NONE) --------------------
ipcMain.handle("games:importInstalled", async (_e, config) => {
  console.log("games:importInstalled called", config);

  const report = {
    steam: { found: 0, imported: 0, errors: [] },
    epic: { found: 0, imported: 0, errors: [] },
    gog: { found: 0, imported: 0, errors: [] },
    none: { found: 0, imported: 0, errors: [] },
  };

  // ===== STEAM =====
  try {
    const steamRoot = config?.steamRoot || findSteamDefaultRoot();
    if (steamRoot && exists(steamRoot)) {
      const libraryVdf1 = path.join(
        steamRoot,
        "steamapps",
        "libraryfolders.vdf"
      );
      const libraryVdf2 = path.join(steamRoot, "config", "libraryfolders.vdf");
      const vdfText = safeReadText(libraryVdf1) || safeReadText(libraryVdf2);

      const libraries = parseSteamLibraryFoldersVdf(vdfText);
      libraries.push(steamRoot);

      const uniqLibs = [...new Set(libraries)].filter((p) => !!p && exists(p));

      for (const lib of uniqLibs) {
        const steamapps = path.join(lib, "steamapps");
        if (!exists(steamapps)) continue;

        const manifests = listFiles(steamapps).filter(
          (f) =>
            path.basename(f).toLowerCase().startsWith("appmanifest_") &&
            f.toLowerCase().endsWith(".acf")
        );

        for (const mf of manifests) {
          const acf = safeReadText(mf);
          const fields = parseAcfRootFields(acf);
          if (!fields.appid) continue;

          const appid = Number(fields.appid);

          const blacklistAppIds = new Set([
            431960, // Wallpaper Engine
            1812620, // DSX
          ]);

          if (blacklistAppIds.has(appid)) {
            continue;
          }

          const lowerName = (fields.name || "").toLowerCase();
          const looksLikeTool =
            lowerName.includes("wallpaper engine") ||
            lowerName.includes("driver booster") ||
            lowerName.includes("controller") ||
            lowerName.includes("soundtrack") ||
            lowerName.includes("editor") ||
            lowerName.includes("sdk");

          if (looksLikeTool) {
            continue;
          }
          report.steam.found++;

          // Ignorar Steamworks Common Redistributables
          if (appid === 228980) {
            continue;
          }
          const name = fields.name || `Steam App ${appid}`;
          const installdir = fields.installdir;

          const installDirAbs = installdir
            ? path.join(steamapps, "common", installdir)
            : null;
          let exe = null;
          if (installDirAbs && exists(installDirAbs))
            exe = pickBestExe(installDirAbs);

          upsertGameImported({
            id: appid,
            name,
            platform: "steam",
            steamAppId: appid,
            executable: exe,
            installDir: installDirAbs,
            sortKey: name,
          });

          report.steam.imported++;
        }
      }

      saveData();
    } else {
      report.steam.errors.push("No se encontró SteamRoot.");
    }
  } catch (err) {
    report.steam.errors.push(String(err?.message || err));
  }

  // ===== EPIC =====
  try {
    const epicManifestsDir =
      config?.epicManifestsDir ||
      "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

    const launcherInstalledDat =
      config?.epicLauncherInstalledDat ||
      "C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat";

    let launcherInstalled = null;
    if (exists(launcherInstalledDat)) {
      try {
        launcherInstalled = JSON.parse(safeReadText(launcherInstalledDat));
      } catch {}
    }

    if (exists(epicManifestsDir)) {
      const items = listFiles(epicManifestsDir).filter((f) =>
        f.toLowerCase().endsWith(".item")
      );

      for (const file of items) {
        let obj;
        try {
          obj = JSON.parse(safeReadText(file));
        } catch {
          continue;
        }
        if (!obj) continue;

        report.epic.found++;

        const name = obj.DisplayName || obj.AppName || "Epic Game";
        const appName = obj.AppName || null;

        let installLocation = obj.InstallLocation || null;

        if (
          !installLocation &&
          launcherInstalled?.InstallationList &&
          appName
        ) {
          const hit = launcherInstalled.InstallationList.find(
            (x) => x?.AppName === appName
          );
          if (hit?.InstallLocation) installLocation = hit.InstallLocation;
        }

        let exe = null;
        if (installLocation && exists(installLocation)) {
          if (obj.LaunchExecutable) {
            const candidate = path.join(installLocation, obj.LaunchExecutable);
            if (exists(candidate)) exe = candidate;
          }
          if (!exe) exe = pickBestExe(installLocation);
        }

        const epicId = stableNegativeId(`epic:${appName || name}`);

        upsertGameImported({
          id: epicId,
          name,
          platform: "epic",
          epicAppName: appName,
          executable: exe,
          installDir: installLocation,
          sortKey: name,
        });

        report.epic.imported++;
      }

      saveData();
    } else if (config?.epicManifestsDir) {
      report.epic.errors.push("No se encontró carpeta de manifests de Epic.");
    }
  } catch (err) {
    report.epic.errors.push(String(err?.message || err));
  }

  // ===== GOG (subcarpetas, con fallback a "carpeta = 1 juego") =====
  try {
    const gogRoot = config?.gogRoot || findFirstExisting(["C:\\GOG Games"]);
    if (gogRoot && exists(gogRoot)) {
      const subdirs = listFiles(gogRoot).filter(isDirectory);
      let foundInSubdirs = 0;

      for (const dir of subdirs) {
        const name = path.basename(dir);
        const exe = pickBestExe(dir);
        if (!exe) continue; // carpeta sin .exe (extras, soundtrack, etc.)

        foundInSubdirs++;
        report.gog.found++;

        const gogId = stableNegativeId(`gog:${dir}`);
        upsertGameImported({
          id: gogId,
          name,
          platform: "gog",
          executable: exe,
          installDir: dir,
          sortKey: name,
        });

        report.gog.imported++;
      }

      // Si no salió ningún juego de las subcarpetas, puede que se haya
      // seleccionado directamente la carpeta de UN solo juego en vez de la
      // carpeta que los contiene a todos - se prueba también como juego
      // suelto antes de dejarlo en "0 encontrados" sin más explicación.
      if (foundInSubdirs === 0) {
        const exe = pickBestExe(gogRoot);
        if (exe) {
          const name = path.basename(gogRoot);
          const gogId = stableNegativeId(`gog:${gogRoot}`);
          upsertGameImported({
            id: gogId,
            name,
            platform: "gog",
            executable: exe,
            installDir: gogRoot,
            sortKey: name,
          });
          report.gog.found++;
          report.gog.imported++;
        }
      }

      saveData();
    } else if (config?.gogRoot) {
      report.gog.errors.push("La carpeta de GOG no existe o no es accesible.");
    }
  } catch (err) {
    report.gog.errors.push(String(err?.message || err));
  }

  // ===== NONE (pirata/sin plataforma: subcarpetas, con el mismo fallback) =====
  try {
    const noneRoot = config?.noneRoot;
    if (noneRoot && exists(noneRoot)) {
      const subdirs = listFiles(noneRoot).filter(isDirectory);
      let foundInSubdirs = 0;

      for (const dir of subdirs) {
        const name = path.basename(dir);

        // Busca ejecutable dentro (ya ignora unins, setup, redist, etc.)
        const exe = pickBestExe(dir);

        // Si no hay .exe válido, no es juego => lo saltamos
        if (!exe) continue;

        foundInSubdirs++;
        report.none.found++;

        const noneId = stableNegativeId(`none:${dir}`);
        upsertGameImported({
          id: noneId,
          name,
          platform: "none",
          executable: exe,
          installDir: dir,
          sortKey: name,
        });

        report.none.imported++;
      }

      if (foundInSubdirs === 0) {
        const exe = pickBestExe(noneRoot);
        if (exe) {
          const name = path.basename(noneRoot);
          const noneId = stableNegativeId(`none:${noneRoot}`);
          upsertGameImported({
            id: noneId,
            name,
            platform: "none",
            executable: exe,
            installDir: noneRoot,
            sortKey: name,
          });
          report.none.found++;
          report.none.imported++;
        }
      }

      saveData();
    } else if (config?.noneRoot) {
      report.none.errors.push(
        "La carpeta de “sin plataforma” no existe o no es accesible."
      );
    }
  } catch (err) {
    report.none.errors.push(String(err?.message || err));
  }

  return {
    ok: true,
    report,
    gamesCount: games.length,
    completedCount: completedGames.length,
  };
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
ipcMain.handle("igdb:getDetails", async (_e, id) => {
  return igdbGamesQuery(`
    fields name, summary, storyline, genres.name, involved_companies.company.name, first_release_date, cover.image_id, screenshots.image_id;
    where id = ${id};
  `);
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

    // 1. INTENTO A: IGDB external_games
    if (!targetSteamId && igdbId) {
      try {
        const res = await igdbGamesQuery(
          `
        fields uid; 
        where game = ${igdbId} & category = 1; 
        limit 1;
      `,
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
