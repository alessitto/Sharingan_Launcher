// =====================================================================
// Semáforo: tu equipo frente a los requisitos de un juego
// =====================================================================
// Cada componente (CPU, GPU, RAM, VRAM, disco, Windows, DirectX) se compara
// por separado y el resultado global es el peor: el cuello de botella manda.
// CPU y GPU se comparan por puntuación (ratio), nunca por nombre.
//
//   verde     cumple los recomendados, o ratio frente al mínimo >= green
//   amarillo  ratio entre yellow y green (al límite del mínimo)
//   rojo      ratio < yellow
//   gris      sin datos para comparar (desconocido): no cuenta como fallo
//
// Si el requisito da alternativas ("GTX 750 Ti / HD 6970"), cuenta la de
// menor puntuación: con superar una basta.
const scores = require("./scores");
const DEFAULT_CONFIG = require("./config.json");

const RANK = { green: 0, yellow: 1, red: 2 };

function band(ratio, cfg) {
  if (!(ratio > 0)) return "unknown";
  if (ratio >= cfg.thresholds.green) return "green";
  if (ratio >= cfg.thresholds.yellow) return "yellow";
  return "red";
}

// La alternativa más baja que se reconozca (con su puntuación)
function lowestAlt(part, kind, cfg) {
  if (!part?.alts?.length) return null;
  let best = null;
  for (const a of part.alts) {
    const hit = kind === "cpu" ? (a.key ? scores.cpu(a.key) : scores.genericCpu(a.generic)) : scores.gpu(a.key, { laptopFactor: cfg.laptopGpuFactor });
    if (!hit) continue;
    if (!best || hit.s < best.s) best = { ...hit, text: a.text };
  }
  return best;
}

// Compara un número tuyo con mínimo y recomendado
function judge(user, min, rec, cfg) {
  if (min == null && rec == null) return { status: "na" };
  if (user == null) return { status: "unknown" };
  // Se decide con el mismo ratio que se enseña (2 decimales): un "1,10×"
  // en pantalla no puede salir amarillo por un 1,098 de fondo.
  const ratio = min != null ? Math.round((user / min) * 100) / 100 : null;
  const meetsRec = rec != null && user >= rec;
  const status = meetsRec ? "green" : min != null ? band(ratio, cfg) : user >= rec * cfg.thresholds.yellow ? "yellow" : "red";
  return { status, ratio, meetsRec };
}

function cmpScore(kind, specs, min, rec, cfg) {
  const u = specs[kind];
  const mAlt = lowestAlt(min?.[kind], kind, cfg);
  const rAlt = lowestAlt(rec?.[kind], kind, cfg);
  const asked = !!(min?.[kind]?.alts?.length || rec?.[kind]?.alts?.length || min?.[kind]?.unknown?.length || rec?.[kind]?.unknown?.length);
  if (!asked) return { status: "na", user: u };
  if (!mAlt && !rAlt) return { status: "unknown", user: u, why: `No se reconoce ${kind === "cpu" ? "el procesador" : "la gráfica"} que pide el juego.` };
  if (!u?.score) return { status: "unknown", user: u, why: `No se ha podido identificar ${kind === "cpu" ? "tu procesador" : "tu gráfica"}.` };
  const r = judge(u.score, mAlt?.s ?? null, rAlt?.s ?? null, cfg);
  const ref = mAlt || rAlt;
  const approx = !!(u.approx || mAlt?.approx || rAlt?.approx);
  return {
    ...r,
    approx,
    user: u,
    min: mAlt && { text: mAlt.text, score: mAlt.s, note: mAlt.note },
    rec: rAlt && { text: rAlt.text, score: rAlt.s, note: rAlt.note },
    why: `${u.label} ≈ ${String((u.score / ref.s).toFixed(2)).replace(".", ",")}× ${ref.text}${mAlt ? " (mínimo)" : " (recomendado)"}${approx ? " · aproximado" : ""}`,
  };
}

function cmpGb(label, userGb, minGb, recGb, cfg, extra = {}) {
  if (minGb == null && recGb == null) return { status: "na" };
  if (userGb == null) return { status: "unknown", why: `No se sabe ${label}.` };
  const r = judge(userGb, minGb, recGb, cfg);
  const fmt = (v) => `${String(Math.round(v * 10) / 10).replace(".", ",")} GB`;
  return { ...r, ...extra, why: `${fmt(userGb)}${extra.shared ? " compartidos" : ""} frente a ${minGb != null ? `${fmt(minGb)} (mínimo)` : `${fmt(recGb)} (recomendado)`}` };
}

function check(specs, min, rec, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, thresholds: { ...DEFAULT_CONFIG.thresholds, ...(config.thresholds || {}) } };
  const c = {};
  c.cpu = cmpScore("cpu", specs, min, rec, cfg);
  c.gpu = cmpScore("gpu", specs, min, rec, cfg);
  c.ram = cmpGb("tu RAM", specs.ram, min?.ram ?? null, rec?.ram ?? null, cfg);
  // VRAM: la de la gráfica dedicada, o la compartida de la integrada
  c.vram = cmpGb("tu VRAM", specs.vram, min?.vram ?? null, rec?.vram ?? null, cfg, { shared: !!specs.vramShared });

  // Disco: hace falta tener el espacio; justo por encima = amarillo
  const need = min?.storage ?? rec?.storage ?? null;
  if (need == null) c.storage = { status: "na" };
  else if (specs.freeStorage == null) c.storage = { status: "unknown", why: "No se sabe el espacio libre." };
  else {
    const left = specs.freeStorage - need;
    c.storage = { status: left < 0 ? "red" : left < cfg.storageMarginGb ? "yellow" : "green", why: `${specs.freeStorage} GB libres en tu disco más grande, pide ${need} GB` };
    if ((min?.ssd || rec?.ssd) && specs.hasSsd === false) c.storage = { ...c.storage, status: c.storage.status === "red" ? "red" : "yellow", why: `${c.storage.why}; pide SSD y no se ha encontrado ninguno` };
  }

  // Windows: versión mínima y 64 bits
  const os = min?.os || rec?.os;
  if (!os || (!os.win && !os.bits64)) c.os = { status: "na" };
  else if (!specs.os?.win) c.os = { status: "unknown", why: "No se sabe tu versión de Windows." };
  else {
    const bad = (os.win && specs.os.win < os.win) || (os.bits64 && specs.os.bits64 === false);
    c.os = { status: bad ? "red" : "green", why: `Windows ${specs.os.win}${specs.os.bits64 ? " de 64 bits" : ""}${os.win ? `, pide Windows ${os.win}` : ""}${os.bits64 ? " de 64 bits" : ""}` };
  }

  // DirectX: lo que soporta tu gráfica (por su arquitectura)
  const dx = min?.dx ?? rec?.dx ?? null;
  if (dx == null) c.dx = { status: "na" };
  else if (!specs.gpu?.dx) c.dx = { status: "unknown", why: "No se sabe qué DirectX soporta tu gráfica." };
  else c.dx = { status: specs.gpu.dx >= dx ? "green" : "red", why: `Tu gráfica soporta DirectX ${specs.gpu.dx}, pide DirectX ${dx}` };

  // Global: el peor de los que se han podido comparar
  const judged = Object.entries(c).filter(([, v]) => v.status in RANK);
  const unknown = Object.entries(c).filter(([, v]) => v.status === "unknown").map(([k]) => k);
  const worst = judged.reduce((w, [, v]) => (RANK[v.status] > RANK[w] ? v.status : w), "green");
  const global = !judged.length ? "unknown" : worst;
  const culprits = judged.filter(([, v]) => v.status === worst && worst !== "green").map(([k]) => k);
  return { global, culprits, unknown, components: c };
}

module.exports = { check, band, DEFAULT_CONFIG };
