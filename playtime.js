// =====================================================================
// Tiempo jugado
// =====================================================================
// Cada 20 s se mira qué programas hay abiertos (tasklist, que viene con
// Windows) y se busca si alguno es un juego de tu biblioteca o de tus
// pasados: su ejecutable tiene que estar dentro de la carpeta del juego
// (installDir, o la del .exe vinculado). Da igual cómo se haya abierto:
// desde el launcher, desde Steam/Epic/GOG o con un acceso directo.
//
// Cada juego guarda:
//   playSecs      segundos jugados en total
//   lastPlayed    última vez que estaba abierto (ms)
//   playSessions  veces que se ha abierto
//   playDays      días (AAAA-MM-DD, hora local) en los que se jugó, para la
//                 racha; se guardan los últimos 120
//
// Los juegos de Descubrir sin carpeta ni .exe no se pueden medir.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const POLL_MS = 20 * 1000;
const MAX_STEP_MS = POLL_MS * 3; // si el PC se suspende no se cuenta el hueco
const DAYS_KEPT = 120;
const SAVE_EVERY_MS = 60 * 1000;
const SYNC_EVERY_MS = 10 * 60 * 1000;
const EXE_CACHE_MS = 6 * 60 * 60 * 1000;
// Ejecutables que no son el juego (instaladores, informes de errores...).
const NOT_GAME = /unins|setup|redist|vcredist|dxsetup|directx|crash|reporter|prereq|easyanticheat_setup|be_?service|uploader|helper|cefprocess|webhelper|dotnet|vc_redist|ue4prereq|launcherpatcher/i;

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function listProcesses() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const out = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (m) out.push({ name: m[1].toLowerCase(), pid: Number(m[2]) });
      }
      resolve(out);
    });
  });
}

// Rutas de los procesos (una sola llamada a PowerShell para todos). Los que
// se ejecutan como administrador vuelven sin ruta.
function processPaths(pids) {
  if (!pids.length) return Promise.resolve(new Map());
  const script = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      const map = new Map();
      for (const line of String(stdout || "").split(/\r?\n/)) {
        const i = line.indexOf("|");
        if (i > 0) map.set(Number(line.slice(0, i)), line.slice(i + 1).trim().toLowerCase());
      }
      resolve(map);
    });
  });
}

// Los .exe que hay en la carpeta del juego (hasta 4 niveles).
function exeNamesIn(dir) {
  const names = new Set();
  const walk = (d, depth) => {
    if (depth > 4 || names.size > 200) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!/^(_commonredist|redist|redistributables|directx|support|__installer|installers?)$/i.test(e.name)) walk(path.join(d, e.name), depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".exe") && !NOT_GAME.test(e.name)) {
        names.add(e.name.toLowerCase());
      }
    }
  };
  walk(dir, 0);
  return names;
}

function createPlaytime({ getGames, onChange }) {
  const exeCache = new Map(); // carpeta -> { at, names }
  const verdict = new Map(); // pid -> id del juego | null (ya comprobado)
  const active = new Map(); // id del juego -> { last }
  let lastSave = 0;
  let lastSync = 0;
  let timer = null;
  let polling = false;

  const gameDir = (g) => {
    if (g.notInstalled) return null;
    if (g.installDir) return path.resolve(g.installDir);
    if (g.executable) return path.dirname(path.resolve(g.executable));
    return null;
  };

  function namesFor(dir) {
    const c = exeCache.get(dir);
    if (c && Date.now() - c.at < EXE_CACHE_MS) return c.names;
    const names = exeNamesIn(dir);
    exeCache.set(dir, { at: Date.now(), names });
    return names;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const games = getGames().filter((g) => gameDir(g));
      const byName = new Map(); // nombre de .exe -> [juegos]
      for (const g of games) {
        const names = new Set(namesFor(gameDir(g)));
        if (g.executable) names.add(path.basename(g.executable).toLowerCase());
        for (const n of names) {
          if (!byName.has(n)) byName.set(n, []);
          byName.get(n).push(g);
        }
      }
      const procs = (await listProcesses()).filter((p) => byName.has(p.name));
      const live = new Set(procs.map((p) => p.pid));
      for (const pid of verdict.keys()) if (!live.has(pid)) verdict.delete(pid);

      // Los procesos nuevos se confirman por su ruta: tiene que estar dentro
      // de la carpeta del juego.
      const unknown = procs.filter((p) => !verdict.has(p.pid));
      if (unknown.length) {
        const paths = await processPaths(unknown.map((p) => p.pid));
        for (const p of unknown) {
          const cands = byName.get(p.name);
          const full = paths.get(p.pid);
          let hit = null;
          if (full) hit = cands.find((g) => full.startsWith(gameDir(g).toLowerCase() + path.sep)) || null;
          else if (cands.length === 1) hit = cands[0]; // sin ruta (administrador): vale si el nombre es de un solo juego
          verdict.set(p.pid, hit ? String(hit.id) : null);
        }
      }

      const running = new Set([...verdict.values()].filter(Boolean));
      const now = Date.now();
      const byId = new Map(games.map((g) => [String(g.id), g]));
      let changed = false;
      let started = false;
      let ended = false;

      for (const id of running) {
        const g = byId.get(id);
        if (!g) continue;
        const a = active.get(id);
        if (!a) {
          active.set(id, { last: now });
          g.playSessions = (g.playSessions || 0) + 1;
          started = true;
        } else {
          const step = Math.min(now - a.last, MAX_STEP_MS);
          g.playSecs = Math.round((g.playSecs || 0) + step / 1000);
          a.last = now;
        }
        g.lastPlayed = now;
        const days = Array.isArray(g.playDays) ? g.playDays : [];
        const today = dayKey(now);
        if (days[days.length - 1] !== today) g.playDays = [...days.filter((d) => d !== today), today].slice(-DAYS_KEPT);
        changed = true;
      }
      for (const id of [...active.keys()]) {
        if (running.has(id)) continue;
        const g = byId.get(id);
        const a = active.get(id);
        if (g && a) g.playSecs = Math.round((g.playSecs || 0) + Math.min(now - a.last, MAX_STEP_MS) / 1000);
        active.delete(id);
        ended = changed = true;
      }

      if (changed) {
        const save = started || ended || now - lastSave > SAVE_EVERY_MS;
        const sync = started || ended || now - lastSync > SYNC_EVERY_MS;
        if (save) lastSave = now;
        if (sync) lastSync = now;
        onChange({ save, sync, running: [...running], refresh: started || ended });
      }
    } catch (err) {
      console.error("tiempo jugado", err);
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(poll, POLL_MS);
      setTimeout(poll, 5000);
    },
    // Al lanzar un juego desde el launcher se mira antes.
    kick() {
      setTimeout(poll, 8000);
      setTimeout(poll, 20000);
    },
    running: () => [...active.keys()],
    forget: (dir) => exeCache.delete(path.resolve(dir)),
  };
}

module.exports = { createPlaytime, dayKey };
