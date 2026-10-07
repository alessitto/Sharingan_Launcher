// =====================================================================
// Texto de requisitos de Steam → requisitos estructurados
// =====================================================================
// Steam da pc_requirements como HTML libre ("<strong>Procesador:</strong>
// Intel Core i5-4460 / AMD FX-6300"). main.js lo pasa a líneas de texto
// ("Procesador: ...") y aquí se interpreta cada línea según su etiqueta,
// en español o en inglés (no todos los juegos traducen las etiquetas).
const { cpuKey, gpuKey, genericCpu, strip } = require("./normalize");

const LABELS = [
  ["os", /^(?:so|os|sistema operativo|operating system|o\/s)\b/],
  ["cpu", /^(?:procesador|processor|cpu)\b/],
  ["ram", /^(?:memoria|memory|ram|system memory)\b/],
  ["vram", /^(?:vram|video memory|memoria de v[ií]deo|memoria gr[aá]fica)\b/],
  ["gpu", /^(?:gr[aá]ficos|graphics|tarjeta gr[aá]fica|video card|graphics card|gpu|v[ií]deo|video)\b/],
  ["dx", /^directx\b/],
  ["storage", /^(?:almacenamiento|storage|espacio en disco|disco duro|hard drive|hard disk|hdd|disk space|espacio)\b/],
  ["notes", /^(?:notas adicionales|additional notes|notas|notes)\b/],
];

// Categoría de una línea "Etiqueta: valor" (o null)
function lineCategory(line) {
  const l = strip(line).replace(/^[•*\-\s]+/, "");
  const label = l.split(":")[0];
  if (label === l) return null;
  return LABELS.find(([, re]) => re.test(label))?.[0] || null;
}

const valueOf = (line) => line.slice(line.indexOf(":") + 1).trim();

// Separa alternativas: "GTX 750 Ti / HD 6970", "i5-4460 or FX-6300",
// "Intel i3-6100 | AMD Ryzen 5 1400", "... o AMD equivalente".
function splitAlternatives(text) {
  return String(text)
    .split(/\s+(?:or|o|ou|oder)\s+|\s*[\/|;]\s*|,\s*(?=(?:amd|intel|nvidia|ati|radeon|geforce)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "8 GB", "512 MB", "1.5 GB" → GB
function gb(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:ssd\s*|hdd\s*)?(tb|gb|gib|mb|mib)\b/i.exec(String(text));
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  return u.startsWith("t") ? v * 1024 : u.startsWith("m") ? v / 1024 : v;
}

function parseOs(text) {
  const s = strip(text);
  // Todas las versiones nombradas tras "Windows" ("Windows 7 / Vista / XP",
  // "Windows 10 or 11"): cuenta la más baja
  const at = s.search(/windows/);
  const tail = at >= 0 ? s.slice(at).replace(/\(build[^)]*\)|version\s*\d+h\d|sp\d/g, " ") : "";
  const valid = [...tail.matchAll(/\b(xp|vista|7|8\.1|8|10|11)\b/g)].map((m) => ({ xp: 5.1, vista: 6, "8.1": 8.1 })[m[1]] ?? Number(m[1]));
  return { win: valid.length ? Math.min(...valid) : null, bits64: /64[\s-]*bit/.test(s) };
}

function parseCpu(text) {
  const alts = [];
  for (const a of splitAlternatives(text)) {
    if (/\b(?:equivalent|equivalente|similar|better|superior)\b/i.test(a) && !cpuKey(a)) continue;
    const key = cpuKey(a);
    if (key) alts.push({ text: a, key });
    else {
      const g = genericCpu(a);
      if (g) alts.push({ text: a, generic: g });
    }
  }
  // Ningún modelo pero sí "2.4 GHz" en la línea entera
  if (!alts.length) {
    const g = genericCpu(text);
    if (g) alts.push({ text, generic: g });
  }
  return { text, alts };
}

function parseGpu(text) {
  const alts = [];
  const vram = [];
  const unknown = []; // nombra una gráfica que no se reconoce (→ gris)
  let sized = 0;
  for (const a of splitAlternatives(text)) {
    const key = gpuKey(a);
    const mem = gb(a);
    if (mem && mem >= 0.064 && mem <= 48) vram.push(mem);
    if (key) {
      alts.push({ text: a, key });
      if (mem) sized++;
    } else if (/\b(?:nvidia|geforce|amd|ati|radeon|intel|matrox|s3|sis|voodoo|quadro|firepro|arc|gtx|rtx|rx|hd)\b/i.test(a) && !/\b(?:equivalent|equivalente|similar|integrated|integrada)\b/i.test(a)) {
      unknown.push(a);
    }
  }
  // La memoria que acompaña a los modelos ("GTX 1060 6GB") solo cuenta como
  // VRAM pedida si todas las alternativas la dicen: "GTX 1660 / RX 5500 XT
  // 8GB" no pide 8 GB (la 1660 tiene 6). Sin modelos ("1 GB de VRAM"), sí.
  const explicit = /vram|video memory|dedicated|memoria de v[ií]deo|graphics memory/i.test(text) || !alts.length;
  const vramOk = vram.length && (explicit || sized === alts.length);
  const dx = /directx\s*(\d{1,2})/i.exec(text);
  return { text, alts, unknown, vram: vramOk ? Math.min(...vram) : null, dx: dx ? Number(dx[1]) : null };
}

// Texto de un nivel (mínimos o recomendados) → objeto
function parseRequirements(text) {
  if (!text || /no especificado|no disponible/i.test(text)) return null;
  const out = { os: null, cpu: null, gpu: null, ram: null, vram: null, storage: null, ssd: false, dx: null };
  // La VRAM explícita (línea propia o notas) manda sobre la de la línea de gráficos
  let vramExplicit = false;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/^[•*\-\s]+/, "").trim();
    if (!line) continue;
    const cat = lineCategory(line);
    const val = cat ? valueOf(line) : line;
    if (/\bssd\b/i.test(line) && /required|requiere|necesario|recommended|recomendad/i.test(line)) out.ssd = true;
    if (!cat) {
      if (/64[\s-]*bit|64 bits/i.test(line)) out.os = { ...(out.os || { win: null }), bits64: true };
      continue;
    }
    if (cat === "os") out.os = { ...parseOs(val), bits64: parseOs(val).bits64 || !!out.os?.bits64 };
    else if (cat === "cpu") out.cpu = parseCpu(val);
    else if (cat === "ram") out.ram = gb(val);
    else if (cat === "vram") {
      out.vram = gb(val);
      vramExplicit = true;
    } else if (cat === "gpu") {
      out.gpu = parseGpu(val);
      if (out.gpu.vram && !vramExplicit) out.vram = out.gpu.vram;
      if (out.gpu.dx && !out.dx) out.dx = out.gpu.dx;
    } else if (cat === "notes") {
      const at = val.search(/vram|video memory|memoria de v[ií]deo/i);
      if (at >= 0 && gb(val.slice(at))) {
        out.vram = gb(val.slice(at));
        vramExplicit = true;
      }
    } else if (cat === "dx") out.dx = Number(/(\d{1,2})/.exec(val)?.[1]) || out.dx;
    else if (cat === "storage") {
      out.storage = gb(val);
      if (/\bssd\b/i.test(val)) out.ssd = true;
    }
  }
  return out;
}

module.exports = { parseRequirements, lineCategory, splitAlternatives, gb };
