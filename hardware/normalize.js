// =====================================================================
// Nombres de CPU y GPU → clave canónica
// =====================================================================
// La misma función la usan el generador de la base (tools/hw-db/build.js)
// y la app, así un nombre siempre da la misma clave en los dos lados:
//
//   "NVIDIA GeForce GTX 750Ti 2GB"   → "nv gtx 750 ti"
//   "GeForce GTX 750 Ti"              → "nv gtx 750 ti"
//   "AMD Radeon HD 6970 (Cayman XT)"  → "amd hd 6970"
//   "Intel(R) Core(TM) i5-4460 CPU @ 3.20GHz" → "intel i5 4460"
//   "AMD Ryzen 5 1400 Quad-Core Processor"   → "amd ryzen 5 1400"
//
// Si el nombre no encaja en ninguna familia conocida devuelve null: mejor
// "desconocido" que una clave inventada.

const strip = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\((?:r|tm|c)\)|®|™|©/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ------------------------------------------------------------------ GPU
// Lo que no cambia el modelo: memoria, tipo de memoria, coletillas.
const GPU_NOISE = new RegExp(
  [
    "\\b\\d+(?:\\.\\d+)?\\s*(?:gb|gib|mb|mib|g)\\b(?:\\s*(?:vram|video ram|ram|memory|of vram))?",
    "\\b(?:gddr\\d\\w*|ddr\\d\\w*|hbm\\d*e?)\\b",
    "\\b(?:or better|or higher|or above|or equivalent|equivalent|or newer|and above|recommended|minimum)\\b",
    "\\b(?:graphics card|video card|graphic card|card|gpu|vga)\\b",
    "\\b(?:pcie?|pci express|agp)\\b",
    "\\b(?:founders edition|oc edition|edition)\\b",
    "\\b(?:directx|dx)\\s*\\d+(?:\\.\\d)?\\b",
    "\\b(?:compatible|series)\\b",
  ].join("|"),
  "g"
);

function mobileFlag(s) {
  return /\b(?:laptop|mobile|notebook|max-?q|max-?p)\b/.test(s);
}

// Sufijos de NVIDIA (en orden: los largos antes que los cortos)
const NV_SUFFIX = "ti super|super|ti|ultra|gtx|gts|gso|gt|gs|se|le|xt|black|plus|\\+";

function nvidiaKey(s, mobile) {
  s = s.replace(/\bnvidia\b|\bgeforce\b/g, " ").replace(/\s+/g, " ").trim();
  // TITAN
  let m = /\btitan\s*(rtx|xp|x|v|z|black|ai)?\b/.exec(s);
  if (m) return `nv titan${m[1] ? " " + m[1] : ""}`;
  // Prefijo de gama + número: gtx 750 ti, rtx 3060, gt 1030, mx 150
  m = new RegExp(`\\b(rtx|gtx|gts|gt|gs|mx)\\s*(\\d{2,4})\\s*(m\\b)?\\s*(${NV_SUFFIX})?(?=\\s|$|[^a-z0-9])`).exec(s);
  if (m) {
    const [, tier, num, mm, suf] = m;
    const sx = suf ? " " + suf.replace("+", "plus") : "";
    return `nv ${tier} ${num}${sx}${mm || mobile ? " m" : ""}`;
  }
  // Viejas, número + sufijo: 8800 gt, 9800 gtx+, 7900 gs; y las de portátil
  // sin gama: 940m, 920mx
  m = new RegExp(`(?:^|\\s)(\\d{3,4})\\s*(m|mx)?\\s*(${NV_SUFFIX})?(?=\\s|$|[^a-z0-9])`).exec(s);
  if (m) {
    const [, num, mm, suf] = m;
    const sx = suf ? " " + suf.replace("+", "plus") : "";
    return `nv ${num}${mm === "mx" ? " mx" : ""}${sx}${mm === "m" || mobile ? " m" : ""}`;
  }
  return null;
}

const AMD_SUFFIX = "xtx|xt|gre|x2|xl|pro|le|gt|x|d|s";

function amdKey(s, mobile) {
  s = s.replace(/\b(?:amd|ati|radeon|amd radeon)\b/g, " ").replace(/\s+/g, " ").trim();
  // Integradas por nombre: 780m, 680m, 890m, 610m (la M es del modelo)
  let m = /(?:^|\s)([4-9][0-9]0m)\b/.exec(s);
  if (m) return `amd ${m[1]}`;
  m = /\bvega\s*(\d{1,2})\b/.exec(s);
  if (m && Number(m[1]) <= 11) return `amd vega ${m[1]}`; // Vega 3..11: integradas
  // RX Vega 56/64, Radeon VII, Fury
  m = /\b(?:rx\s*)?vega\s*(56|64)\b/.exec(s);
  if (m) return `amd rx vega ${m[1]}`;
  if (/\bvii\b|\bradeon 7\b/.test(s) && !/\bhd\b|\brx\b/.test(s)) return "amd vii";
  m = /\b(?:r9\s*)?fury\s*(x)?\b/.exec(s);
  if (m) return `amd r9 fury${m[1] ? " x" : ""}`;
  if (/\bnano\b/.test(s)) return "amd r9 nano";
  // RX 580, RX 6700 XT, RX 7900 XTX, RX 5500M
  m = new RegExp(`\\brx\\s*(\\d{3,4})\\s*(m)?\\s*(${AMD_SUFFIX})?\\b`).exec(s);
  if (m) return `amd rx ${m[1]}${m[3] ? " " + m[3] : ""}${m[2] || mobile ? " m" : ""}`;
  // R9 280X, R7 260X, R5 230
  m = new RegExp(`\\br([579])\\s*(\\d{3})\\s*(${AMD_SUFFIX})?\\b`).exec(s);
  if (m) return `amd r${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}${mobile ? " m" : ""}`;
  // HD 6970, HD 7850, HD 4870 X2, HD 7970M
  m = new RegExp(`\\bhd\\s*(\\d{4})\\s*(m)?\\s*(${AMD_SUFFIX})?\\b`).exec(s);
  if (m) return `amd hd ${m[1]}${m[3] ? " " + m[3] : ""}${m[2] || mobile ? " m" : ""}`;
  // X1950 PRO, X800 XT
  m = /\bx(\d{3,4})\s*(xtx|xt|pro|gt|se|le|xl)?\b/.exec(s);
  if (m) return `amd x${m[1]}${m[2] ? " " + m[2] : ""}`;
  return null;
}

function intelKey(s) {
  s = s.replace(/\bintel\b/g, " ").replace(/\s+/g, " ").trim();
  let m = /\barc\s*(?:[357]\s+)?(?:graphics\s*)?([ab]\d{3})\s*(m)?\b/.exec(s);
  if (m) return `intel arc ${m[1]}${m[2] ? "m" : ""}`;
  m = /\barc\s*(1[34]0[vt])\b/.exec(s);
  if (m) return `intel arc ${m[1]}`;
  m = /\biris\s*(pro|plus)?\s*(?:graphics\s*)?(\d{3,4})\b/.exec(s);
  if (m) return `intel iris${m[1] ? " " + m[1] : ""} ${m[2]}`;
  m = /\b(u?hd)\s*(?:graphics\s*)?(p?\d{3,4})\b/.exec(s);
  if (m) return `intel ${m[1]} ${m[2]}`;
  return null; // "Intel(R) Graphics", "UHD Graphics", "Iris Xe": dependen de la CPU
}

// ¿Es una integrada genérica cuyo modelo real depende de la CPU?
function isGenericIgpu(name) {
  const s = strip(name).replace(/\s+/g, " ").trim();
  return (
    /^(?:intel\s*)?(?:(?:u?hd|iris(?:\s*(?:xe|plus|pro))?|arc)\s*)?graphics(?:\s*family)?$/.test(s) ||
    /^(?:intel\s*)?iris\s*xe$/.test(s) ||
    /^(?:amd\s*)?radeon\s*(?:vega\s*)?(?:graphics|mobile gfx)$/.test(s)
  );
}

function gpuKey(name) {
  let s = strip(name);
  if (!s) return null;
  const mobile = mobileFlag(s);
  s = s.replace(/\b(?:laptop|mobile|notebook|max-?q|max-?p)\b/g, " ");
  s = s.replace(GPU_NOISE, " ").replace(/[()]/g, " ").replace(/(\d)\s*-\s*(\d)/g, "$1 $2").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  // Pegadas: "750ti" → "750 ti", "580x" se queda (r9 280x lo trata el regex)
  s = s.replace(/(\d)(ti|super|xtx|xt|gre)\b/g, "$1 $2");
  if (/\b(?:nvidia|geforce|rtx|gtx|gts|titan|quadro|mx\s*\d+)\b/.test(s)) return nvidiaKey(s, mobile);
  if (/\b(?:amd|ati|radeon|rx\s*\d+|r[579]\s*\d+|hd\s*\d{4}|vega|fury)\b/.test(s) && !/\bintel\b/.test(s)) return amdKey(s, mobile);
  if (/\b(?:intel|u?hd graphics|iris|arc\s*[ab]?\d+)\b/.test(s)) return intelKey(s);
  // Sin marca: "GT 1030", "HD 7850" sueltos. Sin gama tampoco: un número
  // suelto ("Matrox Parhelia 512") no es un modelo de NVIDIA.
  if (!/\b(?:gtx|rtx|gts|gt|gs|mx|hd|rx|r[579])\s*\d/.test(s)) return null;
  return nvidiaKey(s, mobile) || amdKey(s, mobile);
}

// ------------------------------------------------------------------ CPU
function intelCpuKey(s) {
  // Core Ultra 5 125U, Core Ultra 9 285K
  let m = /\bultra\s*([3579])\s*(\d{3})([a-z]{0,2})\b/.exec(s);
  if (m) return `intel ultra ${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`;
  // Core 5 120U (2024, sin "Ultra")
  m = /\bcore\s*([3579])\s*(\d{3})\s*([a-z]{1,2})\b/.exec(s);
  if (m) return `intel core ${m[1]} ${m[2]} ${m[3]}`;
  // Core i3/i5/i7/i9-XXXX(+sufijo). F y KF rinden igual que sin F.
  m = /\bi([3579])\s*-?\s*(\d{3,5})([a-z]{0,2}\d?)\b/.exec(s);
  if (m) {
    let suf = m[3].replace(/^kf$/, "k").replace(/^f$/, "").replace(/^ks?f$/, "k");
    return `intel i${m[1]} ${m[2]}${suf ? " " + suf : ""}`;
  }
  // Core 2 Duo / Quad / Extreme: E8400, Q6600, T7200
  m = /\bcore\s*2\s*(?:duo|quad|extreme)?\s*([a-z]{1,2})\s*-?\s*(\d{3,4})\b/.exec(s);
  if (m) return `intel c2 ${m[1]} ${m[2]}`;
  // Xeon E3-1231 v3, Xeon W-2145, Xeon X5650
  m = /\bxeon\s*([a-z]\d?)\s*-?\s*(\d{4,5})\s*([a-z]?)\s*(v\d)?\b/.exec(s);
  if (m) return `intel xeon ${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}${m[4] ? " " + m[4] : ""}`;
  // Pentium / Celeron: G4560, Gold 5405U, N4020, J4125, E5200
  m = /\b(pentium|celeron)\s*(?:gold|silver|dual[- ]?core)?\s*([a-z]{1,2})\s*-?\s*(\d{3,5})\s*([a-z]{0,2})\b/.exec(s);
  if (m) return `intel ${m[1]} ${m[2]} ${m[3]}${m[4] ? " " + m[4] : ""}`;
  m = /\b(pentium|celeron)\s*(?:gold|silver)?\s*(\d{4,5})\s*([a-z]{0,2})\b/.exec(s);
  if (m) return `intel ${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`;
  return null;
}

function amdCpuKey(s) {
  // Ryzen AI 9 HX 370, Ryzen Z1 Extreme
  let m = /\bryzen\s*ai\s*([3579])\s*(?:pro\s*)?(hx|h)?\s*(\d{3})\b/.exec(s);
  if (m) return `amd ryzen ai ${m[1]}${m[2] ? " " + m[2] : ""} ${m[3]}`;
  m = /\bryzen\s*z(\d)\s*(extreme)?\b/.exec(s);
  if (m) return `amd ryzen z${m[1]}${m[2] ? " extreme" : ""}`;
  // Threadripper 1950X, 3990X, PRO 5995WX
  m = /\bthreadripper\s*(?:pro\s*)?(\d{4})\s*([a-z]{1,3})?\b/.exec(s);
  if (m) return `amd threadripper ${m[1]}${m[2] ? " " + m[2] : ""}`;
  // Ryzen 5 1400, Ryzen 7 5800X3D, Ryzen 5 PRO 4650U
  m = /\bryzen\s*([3579])\s*(?:pro\s*)?(\d{4})([a-z][a-z0-9]{0,3})?\b/.exec(s);
  if (m) return `amd ryzen ${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`;
  // FX-6300, FX-8350
  m = /\bfx\s*-?\s*(\d{4})([a-z]?)\b/.exec(s);
  if (m) return `amd fx ${m[1]}${m[2] ? " " + m[2] : ""}`;
  // Phenom II X4 965, Athlon II X2 250, Athlon 64 X2 4000+
  m = /\b(phenom|athlon)\s*(ii|64)?\s*(x\d)\s*(\d{3,4})\s*([a-z]{0,2})\b/.exec(s);
  if (m) return `amd ${m[1]}${m[2] ? " " + m[2] : ""} ${m[3]} ${m[4]}${m[5] ? " " + m[5] : ""}`;
  // Athlon 200GE, Athlon Silver 3050U, Athlon 3000G
  m = /\bathlon\s*(?:silver|gold|pro)?\s*(\d{3,4})\s*([a-z]{1,2})\b/.exec(s);
  if (m) return `amd athlon ${m[1]} ${m[2]}`;
  // A-series: A10-5800K, A8-7600, A6-9220
  m = /\ba(4|6|8|9|10|12)\s*-\s*(\d{4})\s*([a-z]?)\b/.exec(s);
  if (m) return `amd a${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`;
  return null;
}

function cpuKey(name) {
  let s = strip(name)
    .replace(/@?\s*\d+(?:[.,]\d+)?\s*\+?\s*ghz\b/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\b\d+\s*-?\s*core(?:s)?\b|\b(?:dual|quad|six|eight|twelve|sixteen)[- ]core\b/g, " ")
    .replace(/\b(?:processor|cpu|apu|with radeon graphics|w\/ radeon graphics|mobile)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (/\bintel\b|\bcore\b|\bi[3579]\s*-?\s*\d|\bxeon\b|\bpentium\b|\bceleron\b/.test(s) && !/\bryzen\b|\bamd\b/.test(s)) return intelCpuKey(s);
  if (/\bamd\b|\bryzen\b|\bfx\b|\bphenom\b|\bathlon\b|\bthreadripper\b|\ba(?:4|6|8|9|10|12)\s*-\s*\d/.test(s)) return amdCpuKey(s);
  return intelCpuKey(s) || amdCpuKey(s);
}

// Requisitos genéricos: "Dual Core 2.4 GHz", "Quad-core Intel or AMD 2.5GHz",
// "Intel Core i5 3.0 GHz". Devuelve { cores, ghz, modern } o null.
function genericCpu(text) {
  const s = strip(text);
  const ghz = /(\d(?:[.,]\d{1,2})?)\s*\+?\s*ghz/.exec(s);
  if (!ghz) {
    // Sin GHz: "Core 2 Quad o superior", "Core i5 or AMD equivalent",
    // "Quad-core Intel or AMD", "Ryzen 5 CPU". Valores típicos de la familia.
    const fam = [
      [/core\s*2\s*quad/, 4, 2.4, false], [/core\s*2\s*duo/, 2, 2.4, false],
      [/\bi7\b|ryzen\s*7/, 4, 3.4, true], [/\bi5\b|ryzen\s*5/, 4, 3.0, true], [/\bi3\b|ryzen\s*3/, 2, 3.1, true],
      [/\b(?:six|hexa)[- ]?core/, 6, 3.0, false], [/\bquad[- ]?core/, 4, 2.5, false], [/\bdual[- ]?core/, 2, 2.0, false],
    ].find(([re]) => re.test(s));
    return fam ? { cores: fam[1], ghz: fam[2], modern: fam[3], assumed: true } : null;
  }
  let cores = null;
  const words = { single: 1, dual: 2, two: 2, triple: 3, quad: 4, four: 4, hexa: 6, six: 6, octa: 8, eight: 8 };
  const w = /\b(single|dual|two|triple|quad|four|hexa|six|octa|eight)[- ]?core\b/.exec(s);
  if (w) cores = words[w[1]];
  const n = /\b(\d{1,2})\s*-?\s*(?:cores?|núcleos|nucleos)\b/.exec(s);
  if (!cores && n) cores = Number(n[1]);
  if (!cores && /\bi[3579]\b|\bryzen\b/.test(s)) cores = /\bi3\b/.test(s) ? 2 : 4;
  if (!cores) cores = 2; // "2.0 GHz" a secas: lo mínimo razonable de la época
  return { cores, ghz: Number(ghz[1].replace(",", ".")), modern: /\bi[3579]\b|\bryzen\b/.test(s) };
}

module.exports = { gpuKey, cpuKey, genericCpu, isGenericIgpu, strip };
