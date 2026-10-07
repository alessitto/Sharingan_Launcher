// =====================================================================
// Puntuaciones de la base local (data/hw-scores.json)
// =====================================================================
// Cada búsqueda devuelve { key, s, approx?, note? } o null. "approx" marca
// que no era el modelo exacto (otra gama con el mismo número, la versión
// de sobremesa de una de portátil, el modelo sin su sufijo X/K...): la
// comparación lo dice al usuario. Si no hay nada fiable, null: desconocido.
const fs = require("fs");
const path = require("path");

let db = null;
function load(file) {
  db = JSON.parse(fs.readFileSync(file || path.join(__dirname, "..", "data", "hw-scores.json"), "utf8"));
  return db;
}
const get = () => db || load();

function gpu(key, { laptopFactor = 0.8 } = {}) {
  if (!key) return null;
  const d = get();
  key = d.alias[key] || key;
  const hit = (k, extra) => (d.gpu[k] ? { key: k, ...d.gpu[k], ...extra } : null);
  let r = hit(key);
  if (r) return r;
  // NVIDIA con la gama ausente o cambiada: "NVIDIA 750 Ti", "GT 460" (por
  // GTX 460), "480 GTX" (al revés), "GeForce 8600" (sin GT)
  const nv = /^nv (?:(gtx|rtx|gts|gt) )?(\d{3,4})(?: (gtx|gts|gt))?((?: [a-z+]+)*)$/.exec(key);
  if (nv) {
    const [, tier, num, after, rest] = nv;
    const tail = rest || "";
    const tries = [];
    if (after) tries.push(`nv ${after} ${num}${tail}`);
    for (const t of ["gtx", "rtx", "gt", "gts"]) if (t !== tier) tries.push(`nv ${t} ${num}${tail}`);
    if (!tier && !after) for (const suf of ["gt", "gts", "gtx", "gs"]) tries.push(`nv ${num} ${suf}${tail}`);
    for (const k of tries) if ((r = hit(k, { approx: true, note: "gama deducida" }))) return r;
  }
  // AMD por serie o sin sufijo: "HD 7800 series" → HD 7850, "HD 2600" → HD 2600 PRO
  const hd = /^amd (hd|rx|r[579]) (\d{3,4})( m)?$/.exec(key);
  if (hd) {
    const [, fam, num, mm = ""] = hd;
    const tries = [];
    if (/00$/.test(num)) tries.push(`amd ${fam} ${num.replace(/00$/, "50")}${mm}`, `amd ${fam} ${num.replace(/00$/, "70")}${mm}`);
    for (const suf of ["pro", "xt", "le"]) tries.push(`amd ${fam} ${num} ${suf}${mm}`);
    for (const k of tries) if ((r = hit(k, { approx: true, note: "la más baja de su serie" }))) return r;
  }
  // De portátil sin dato: la de sobremesa con un factor
  if (/ m$/.test(key)) {
    const desk = d.gpu[key.replace(/ m$/, "")];
    if (desk) return { key: key.replace(/ m$/, ""), ...desk, s: Math.round(desk.s * laptopFactor * 10) / 10, approx: true, note: "versión de sobremesa con factor de portátil" };
  }
  return null;
}

function cpu(key) {
  if (!key) return null;
  const d = get();
  key = d.alias[key] || key;
  if (d.cpu[key]) return { key, ...d.cpu[key] };
  // Mismo modelo sin sufijo de "algo más rápida" (3600X → 3600, 6600K → 6600)
  const m = /^(.*\d) (x|xt|k|ks|x3d)$/.exec(key);
  if (m && d.cpu[m[1]]) return { key: m[1], ...d.cpu[m[1]], approx: true, note: "modelo sin el sufijo" };
  // Y al revés: el requisito pone "6600" y solo hay "6600 k"
  for (const suf of ["k", "x"]) if (d.cpu[`${key} ${suf}`]) return { key: `${key} ${suf}`, ...d.cpu[`${key} ${suf}`], approx: true, note: "modelo con sufijo" };
  return null;
}

// "Dual Core 2.4 GHz": se escala desde una CPU real de su época con los
// mismos criterios que la base (rendimiento por núcleo × √núcleos).
function genericCpu(g) {
  const d = get();
  const ref = g.modern ? { key: "intel i5 2500", ghz: 3.3, cores: 4 } : { key: "intel c2 q 6600", ghz: 2.4, cores: 4 };
  const r = d.cpu[ref.key];
  if (!r || !g?.ghz) return null;
  const s = r.s * (g.ghz / ref.ghz) * Math.sqrt(Math.min(g.cores, 8) / Math.min(ref.cores, 8));
  return { key: null, s: Math.round(s * 10) / 10, approx: true, note: `estimado (${g.cores} núcleos a ${g.ghz} GHz)` };
}

const igpuOf = (cpuKey) => get().cpuIgpu[cpuKey] || null;
const calibration = () => get().calibration;

module.exports = { load, gpu, cpu, genericCpu, igpuOf, calibration };
