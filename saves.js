// Copias de seguridad de partidas guardadas.
//
// Dónde guarda cada juego sus partidas sale del manifiesto de Ludusavi
// (https://github.com/mtkennerly/ludusavi-manifest), una base de datos
// abierta con las rutas de guardado de miles de juegos de PC. Pesa unos
// 17 MB en YAML, así que se descarga solo cuando hace falta (la primera
// copia y luego como mucho una vez por semana) y se guarda reducido a un
// índice JSON con lo único que usamos: rutas de partidas en Windows.
const fs = require("fs");
const os = require("os");
const path = require("path");
const fetch = require("node-fetch");

const MANIFEST_URL = "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let indexCache = null;

function normTitle(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Rutas de partidas en Windows de una entrada del manifiesto: etiqueta
// "save" (o sin etiquetas) y sin condición de sistema, o con Windows.
function windowsSavePatterns(entry) {
  const out = [];
  for (const [pattern, info] of Object.entries(entry.files || {})) {
    const tags = info?.tags;
    if (Array.isArray(tags) && tags.length && !tags.includes("save")) continue;
    const when = info?.when;
    if (Array.isArray(when) && when.length && !when.some((w) => !w.os || w.os === "windows")) continue;
    // Las de la Microsoft Store (Packages/...) no aplican a juegos de Steam/Epic/GOG
    if (Array.isArray(when) && when.length && when.every((w) => w.store === "microsoft")) continue;
    out.push(pattern);
  }
  return out;
}

function buildIndex(manifest) {
  const entries = [];
  const byName = {};
  const bySteam = {};
  const byGog = {};
  for (const [name, entry] of Object.entries(manifest || {})) {
    if (!entry || !entry.files) continue;
    const patterns = windowsSavePatterns(entry);
    if (!patterns.length) continue;
    const idx = entries.length;
    entries.push({ n: name, p: patterns, d: Object.keys(entry.installDir || {}) });
    byName[normTitle(name)] ??= idx;
    const steamIds = [entry.steam?.id, ...(entry.id?.steamExtra || [])].filter(Boolean);
    steamIds.forEach((id) => (bySteam[id] ??= idx));
    const gogIds = [entry.gog?.id, ...(entry.id?.gogExtra || [])].filter(Boolean);
    gogIds.forEach((id) => (byGog[id] ??= idx));
  }
  return { builtAt: Date.now(), entries, byName, bySteam, byGog };
}

async function loadIndex(userDataDir) {
  const indexPath = path.join(userDataDir, "saves-manifest.json");
  if (!indexCache && fs.existsSync(indexPath)) {
    try {
      indexCache = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch {
      indexCache = null;
    }
  }
  const fresh = indexCache && Date.now() - (indexCache.builtAt || 0) < MAX_AGE_MS;
  if (fresh) return indexCache;

  try {
    const res = await fetch(MANIFEST_URL, { timeout: 60000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const yaml = require("js-yaml");
    const manifest = yaml.load(await res.text());
    indexCache = buildIndex(manifest);
    fs.writeFileSync(indexPath, JSON.stringify(indexCache), "utf8");
  } catch (err) {
    // Sin conexión: si había un índice viejo se usa igual.
    if (!indexCache) throw new Error("No se pudo descargar la base de datos de partidas (hace falta conexión la primera vez).");
    console.error("No se pudo actualizar el manifiesto de partidas:", err.message);
  }
  return indexCache;
}

function findEntry(index, game) {
  const byId = (map, id) => (id != null && map[id] != null ? index.entries[map[id]] : null);
  const hit = byId(index.bySteam, game.steamAppId) || byId(index.byGog, game.gogGameId);
  if (hit) return hit;
  const n = normTitle(game.name);
  if (index.byName[n] != null) return index.entries[index.byName[n]];
  // Sin el subtítulo de edición ("... Remastered", "GOTY", etc.)
  const stripped = n
    .replace(/\b(game of the year|goty|definitive|complete|enhanced|remastered|deluxe|ultimate|anniversary|special)( edition)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped !== n && index.byName[stripped] != null) return index.entries[index.byName[stripped]];
  // Números romanos <-> arábigos ("Baldur's Gate III" = "Baldur's Gate 3")
  const ROMAN = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  const ARABIC = Object.fromEntries(Object.entries(ROMAN).map(([r, a]) => [a, r]));
  const swapped = stripped
    .split(" ")
    .map((w) => ROMAN[w] || ARABIC[w] || w)
    .join(" ");
  if (swapped !== stripped && index.byName[swapped] != null) return index.entries[index.byName[swapped]];
  // Edición con nombre más largo en el manifiesto ("Ghost of Tsushima DIRECTOR'S
  // CUT"): se acepta si solo hay una entrada que empiece por el nombre.
  if (stripped.split(" ").length >= 2) {
    const keys = Object.keys(index.byName).filter((k) => k.startsWith(stripped + " "));
    if (keys.length === 1) return index.entries[index.byName[keys[0]]];
  }
  return null;
}

// -------------------- Rutas --------------------
function knownFolders(app) {
  const home = os.homedir();
  const env = process.env;
  return {
    home,
    osUserName: os.userInfo().username,
    winAppData: env.APPDATA || path.join(home, "AppData", "Roaming"),
    winLocalAppData: env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
    winLocalAppDataLow: path.join(home, "AppData", "LocalLow"),
    winDocuments: app.getPath("documents"),
    winPublic: env.PUBLIC || "C:\\Users\\Public",
    winProgramData: env.PROGRAMDATA || "C:\\ProgramData",
    winDir: env.WINDIR || "C:\\Windows",
  };
}

// Carpeta de instalación del juego (<base>) y su nombre (<game>).
function gameBase(game, entry) {
  if (game.installDir) return game.installDir;
  if (!game.executable) return null;
  const parts = path.dirname(game.executable).split(/[\\/]+/);
  const names = (entry?.d || []).map((d) => d.toLowerCase());
  for (let i = parts.length - 1; i > 0; i--) {
    if (names.includes(parts[i].toLowerCase())) return parts.slice(0, i + 1).join(path.sep);
  }
  return path.dirname(game.executable);
}

function resolvePattern(pattern, vars) {
  let unresolved = false;
  const out = pattern.replace(/<([a-zA-Z]+)>/g, (_, key) => {
    const v = vars[key];
    if (v == null || v === "") {
      unresolved = true;
      return "";
    }
    return v;
  });
  return unresolved ? null : out;
}

const hasGlob = (s) => /[*?[]/.test(s);

function globToRegex(seg) {
  const re = seg
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i");
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Expande una ruta con comodines (*, ?, **) contra el disco.
function expandGlob(p) {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return [];
  let current = [parts[0].endsWith(":") ? parts[0] + "\\" : parts[0]];
  for (const seg of parts.slice(1)) {
    const next = [];
    for (const base of current) {
      if (seg === "**") {
        const stack = [base];
        while (stack.length) {
          const d = stack.pop();
          next.push(d);
          for (const e of safeReaddir(d)) if (e.isDirectory()) stack.push(path.join(d, e.name));
        }
      } else if (hasGlob(seg)) {
        const re = globToRegex(seg);
        for (const e of safeReaddir(base)) if (re.test(e.name)) next.push(path.join(base, e.name));
      } else {
        const candidate = path.join(base, seg);
        if (fs.existsSync(candidate)) next.push(candidate);
      }
    }
    current = [...new Set(next)];
    if (!current.length) break;
  }
  return current.filter((c) => fs.existsSync(c));
}

function sizeOf(p, budget = { files: 20000 }) {
  let total = 0;
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
  } catch {
    return 0;
  }
  const stack = [p];
  while (stack.length && budget.files > 0) {
    const d = stack.pop();
    for (const e of safeReaddir(d)) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        budget.files--;
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}

// Quita rutas que ya están dentro de otra de la lista.
function dedupeNested(paths) {
  const sorted = [...new Set(paths.map((p) => path.normalize(p)))].sort((a, b) => a.length - b.length);
  const out = [];
  for (const p of sorted) {
    const lower = p.toLowerCase();
    if (!out.some((o) => lower === o.toLowerCase() || lower.startsWith(o.toLowerCase() + path.sep))) out.push(p);
  }
  return out;
}

function savePathsFor(game, entry, ctx) {
  const vars = { ...ctx.folders };
  const base = gameBase(game, entry);
  if (base) {
    vars.base = base;
    vars.game = path.basename(base);
  }
  if (game.steamAppId) {
    vars.root = ctx.steamRoot;
    vars.storeGameId = String(game.steamAppId);
  } else if (game.gogGameId) {
    vars.storeGameId = String(game.gogGameId);
  }
  vars.storeUserId = "*";

  const found = [];
  for (const pattern of entry?.p || []) {
    const resolved = resolvePattern(pattern, vars);
    if (resolved) found.push(...expandGlob(resolved));
  }
  // Respaldo para Steam: la nube de Steam guarda en userdata/<usuario>/<appid>.
  if (!found.length && game.steamAppId && ctx.steamRoot) {
    found.push(...expandGlob(path.join(ctx.steamRoot, "userdata", "*", String(game.steamAppId), "remote")));
  }
  return dedupeNested(found);
}

// -------------------- API --------------------
async function scanSaves({ app, games, steamRoot }) {
  const index = await loadIndex(app.getPath("userData"));
  const ctx = { folders: knownFolders(app), steamRoot };
  return games.map((g) => {
    const entry = findEntry(index, g);
    const paths = savePathsFor(g, entry, ctx);
    return {
      id: g.id,
      name: g.name,
      paths,
      size: paths.reduce((acc, p) => acc + sizeOf(p), 0),
      known: !!entry,
    };
  });
}

function safeName(s) {
  return String(s || "Juego").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || "Juego";
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

// Copia cada carpeta/archivo de partidas a <destino>/<juego>/<fecha>/ y deja
// un rutas.txt con dónde estaba cada cosa, para poder restaurarlo a mano.
function backupGame(item, destRoot, when) {
  const target = path.join(destRoot, safeName(item.name), when);
  fs.mkdirSync(target, { recursive: true });
  const used = new Set();
  const lines = [];
  const errors = [];
  let copied = 0;
  for (const src of item.paths) {
    let name = path.basename(src) || "partidas";
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${path.basename(src)} (${n++})`;
    used.add(name.toLowerCase());
    try {
      fs.cpSync(src, path.join(target, name), { recursive: true, force: true, errorOnExist: false });
      lines.push(`${name}  <-  ${src}`);
      copied++;
    } catch (err) {
      errors.push(`${src}: ${err.code || err.message}`);
    }
  }
  fs.writeFileSync(
    path.join(target, "rutas.txt"),
    `Copia de partidas de ${item.name} (${when})\r\nPara restaurar, copia cada carpeta de vuelta a su ruta original:\r\n\r\n${lines.join("\r\n")}\r\n`,
    "utf8"
  );
  if (!copied) throw new Error(errors[0] || "No se pudo copiar nada");
  return { folder: target, partial: errors.length > 0 };
}

module.exports = { scanSaves, backupGame, stamp, normTitle };
