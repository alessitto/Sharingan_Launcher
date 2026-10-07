// =====================================================================
// Base local de puntuaciones de hardware → data/hw-scores.json
// =====================================================================
//   node tools/hw-db/build.js            (usa lo descargado en raw/)
//   node tools/hw-db/build.js --download (descarga antes las fuentes)
//
// Fuentes (todas con uso permitido; nada de scraping):
//   - CPU: Blender Open Data (CC0), opendata.blender.org/snapshots.
//   - GPU dedicadas e integradas: listas de Wikipedia por su API oficial
//     (CC BY-SA 4.0): NVIDIA, AMD, Intel, APUs de AMD, Meteor/Lunar Lake.
//   - anchors.json: equivalencias aproximadas para calibrar el factor de
//     cada arquitectura (no se copian a la base).
//   - overrides.json: correcciones y alias a mano.
//
// La app nunca descarga nada de esto: solo lee el JSON generado.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");
const { tables } = require("./wikitables");
const { gpuKey, cpuKey } = require("../../hardware/normalize");

const RAW = process.env.HWDB_RAW || path.join(__dirname, "raw");
const OUT = path.join(__dirname, "..", "..", "data", "hw-scores.json");
const REPORT = path.join(__dirname, "report.txt");
const UA = "SharinganLauncher-hwdb/1.0 (https://github.com/alessitto/Sharingan_Launcher)";
const WIKI_PAGES = [
  "List_of_Nvidia_graphics_processing_units",
  "List_of_AMD_graphics_processing_units",
  "List_of_Intel_graphics_processing_units",
  "List_of_AMD_accelerated_processing_units",
  "List_of_AMD_Ryzen_processors",
  "Meteor_Lake",
  "Lunar_Lake",
];

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const nums = (cell) => (String(cell).replace(/,(?=\d{3})/g, "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
const report = [];
const log = (...a) => {
  console.log(...a);
  report.push(a.join(" "));
};

// ------------------------------------------------------------ Descarga
async function download() {
  fs.mkdirSync(RAW, { recursive: true });
  for (const p of WIKI_PAGES) {
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${p}&prop=text&format=json&formatversion=2&redirects=1`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    fs.writeFileSync(path.join(RAW, `wiki-${p}.json`), await res.text());
    console.log("wikipedia", p);
  }
  const zip = path.join(RAW, "opendata-latest.zip");
  const res = await fetch("https://opendata.blender.org/snapshots/opendata-latest.zip", { headers: { "User-Agent": UA } });
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync("tar", ["-xf", zip, "-C", RAW]); // tar de Windows 10+ abre .zip
  console.log("blender open data");
}

// ------------------------------------------------------------ CPU (Blender)
// Cada resultado es "CPU X, versión V, escena S → rendimiento". Con un
// modelo log-lineal (log r = cpu + prueba) todas las versiones y escenas
// quedan en la misma escala, aunque cada CPU solo haya corrido algunas.
async function blenderCpus() {
  const file = fs.readdirSync(RAW).find((f) => /^opendata-.*\.jsonl$/.test(f));
  if (!file) throw new Error("Falta el volcado de Blender Open Data en raw/ (usa --download)");
  const pairs = new Map(); // cpu -> Map(prueba -> [valores])
  const topo = new Map(); // cpu -> { cores: [], threads: [] }
  const names = new Map(); // cpu -> nombre de ejemplo
  const add = (key, test, v, si) => {
    if (!Number.isFinite(v)) return;
    if (!pairs.has(key)) pairs.set(key, new Map());
    const m = pairs.get(key);
    if (!m.has(test)) m.set(test, []);
    m.get(test).push(v);
    if (si?.num_cpu_cores > 0 && si?.num_cpu_threads > 0) {
      if (!topo.has(key)) topo.set(key, { cores: [], threads: [] });
      topo.get(key).cores.push(si.num_cpu_cores);
      topo.get(key).threads.push(si.num_cpu_threads);
    }
  };
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(RAW, file)), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    lines++;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const list = Array.isArray(o.data) ? o.data : [o.data];
    for (const d of list) {
      if (!d || d.device_info?.device_type !== "CPU") continue;
      const si = d.system_info || {};
      if (si.num_cpu_sockets > 1) continue;
      const dev = d.device_info.compute_devices?.[0];
      const name = (typeof dev === "string" ? dev : dev?.name) || si.cpu_brand;
      const key = cpuKey(name);
      if (!key) continue;
      if (!names.has(key)) names.set(key, name);
      const ver = String(d.blender_version?.version || "?").replace(/\s*\(.*\)/, "").split(".").slice(0, 2).join(".");
      if (o.schema_version === "v1") {
        for (const sc of d.scenes || []) {
          if (sc.stats?.result && sc.stats.result !== "OK") continue;
          add(key, `v1|${ver}|${sc.name}`, -Math.log(sc.stats?.render_time_no_sync || sc.stats?.total_render_time), si);
        }
      } else if (d.stats?.samples_per_minute) {
        add(key, `v4|${ver}|${d.scene?.label}`, Math.log(d.stats.samples_per_minute), si);
      } else if (d.stats) {
        add(key, `v3|${ver}|${d.scene?.label}`, -Math.log(d.stats.render_time_no_sync || d.stats.total_render_time), si);
      }
    }
  }
  // Mediana por (cpu, prueba) y ajuste alterno: s[cpu] y b[prueba]
  const obs = []; // [cpu, prueba, valor]
  const count = new Map();
  for (const [cpu, m] of pairs) {
    let n = 0;
    for (const [test, vals] of m) {
      obs.push([cpu, test, median(vals)]);
      n += vals.length;
    }
    count.set(cpu, n);
  }
  const keep = new Set([...count].filter(([, n]) => n >= 3).map(([k]) => k));
  const data = obs.filter(([c]) => keep.has(c));
  const s = new Map([...keep].map((k) => [k, 0]));
  const b = new Map();
  for (let it = 0; it < 40; it++) {
    const tb = new Map();
    for (const [c, t, v] of data) (tb.get(t) || tb.set(t, []).get(t)).push(v - s.get(c));
    for (const [t, a] of tb) b.set(t, median(a));
    const tc = new Map();
    for (const [c, t, v] of data) (tc.get(c) || tc.set(c, []).get(c)).push(v - b.get(t));
    for (const [c, a] of tc) s.set(c, median(a));
  }
  log(`CPU: ${lines} registros de Blender, ${keep.size} CPUs con 3+ resultados`);
  return { s, topo, count, names };
}

// Núcleos P/E. En las híbridas de Intel con Hyper-Threading:
// hilos = 2P + E. Las Core Ultra 200 y Lunar Lake no tienen HT.
function coreLayout(key, cores, threads) {
  const intel = key.startsWith("intel");
  if (intel && threads > cores && threads < cores * 2) {
    const p = threads - cores;
    return { p, e: cores - p, ht: true };
  }
  if (intel && threads === cores && /ultra \d 2\d\d/.test(key) && cores >= 8) {
    const p = / v$/.test(key) ? 4 : / hx?$/.test(key) ? (cores >= 16 ? 6 : 4) : cores >= 20 ? 8 : 6;
    return { p, e: cores - p, ht: false };
  }
  return { p: cores, e: 0, ht: threads > cores };
}

// Puntuación de juego: los juegos tiran sobre todo de los núcleos rápidos y
// escalan mal pasados unos 8. Rendimiento por núcleo × √(núcleos útiles).
function cpuGaming(mt, lay) {
  const eff = lay.p * (lay.ht ? 1.3 : 1) + lay.e * 0.55;
  const perCore = mt / eff;
  return perCore * Math.sqrt(Math.min(eff, 8));
}

// ------------------------------------------------------------ GPU (Wikipedia)
const NV_ARCH = [
  [/\bGB\d/, "blackwell"], [/\bAD\d/, "ada"], [/\bGA\d/, "ampere"], [/\bTU\d/, "turing"], [/\bGV\d/, "volta"],
  [/\bGP\d/, "pascal"], [/\bGM\d/, "maxwell"], [/\bGK\d/, "kepler"], [/\bGF\d/, "fermi"],
  [/\bGT2\d\d|\bG2\d\d|\bG9\d|\bG8\d|\bMCP7/, "tesla"], [/\bG7\d|\bNV4\d|\bC5\d|\bC6\d/, "curie"],
];
const AMD_ARCH = [
  [/rdna ?4|navi ?4\d/i, "rdna4"], [/rdna ?3|navi ?3\d/i, "rdna3"], [/rdna ?2|navi ?2\d/i, "rdna2"], [/rdna|navi ?1\d/i, "rdna1"],
  [/gcn ?5|vega ?(?:10|12|20)|\bvega\b/i, "gcn5"], [/gcn ?4|polaris|ellesmere|baffin|lexa/i, "gcn4"],
  [/gcn ?3|tonga|fiji|antigua/i, "gcn3"], [/gcn ?2|hawaii|bonaire|grenada|tobago/i, "gcn2"],
  [/gcn ?1|gcn\b|tahiti|pitcairn|cape verde|oland|hainan|curaçao|trinidad/i, "gcn1"],
  [/terascale ?3|cayman|antilles/i, "ts3"], [/terascale ?2|cypress|juniper|redwood|cedar|barts|turks|caicos|hemlock/i, "ts2"],
  [/terascale|rv7\d0|rv6\d0|r600|r680|rv670/i, "ts1"], [/r5\d\d|rv5\d\d/i, "r500"],
];
const AMD_SERIES = [
  [/rx 9\d{3}/, "rdna4"], [/rx 7\d{3}/, "rdna3"], [/rx 6\d{3}/, "rdna2"], [/rx 5\d{3}/, "rdna1"],
  [/rx [45]\d0\b/, "gcn4"], [/vega/, "gcn5"], [/hd 7\d{3}|r[579] 2\d0/, "gcn1"], [/hd 6\d{3}/, "ts2"], [/hd 5\d{3}/, "ts2"], [/hd [34]\d{3}/, "ts1"],
];

function intelGen(title, rowText) {
  const t = `${title} ${rowText}`;
  if (/BMG|Battlemage|Xe2-HPG/i.test(t)) return "xe2-hpg";
  if (/ACM|Alchemist|DG2|Xe-HPG/i.test(t)) return "xe-hpg";
  const m = /Gen\s*(\d+(?:\.\d+)?)/i.exec(t);
  if (!m) return null;
  const g = Number(m[1]);
  return g >= 12 ? "xe-lp" : g >= 11 ? "gen11" : g >= 9 ? "gen9" : g >= 8 ? "gen8" : g >= 7.5 ? "gen7.5" : g >= 7 ? "gen7" : g >= 6 ? "gen6" : null;
}

const col = (t, re) => t.header.findIndex((h) => re.test(h));
const isMobileTitle = (t) => /mobile|mobility|laptop|notebook/i.test(t);

// Nombre de CPU dentro de una celda con varios ("Core i5-6200U Core i5-6300U")
const CPU_IN_CELL = /(?:Core\s*(?:i[3579]|Ultra\s*\d|m[357])\s*-?\s*\d{3,5}[A-Z]{0,2}\d?|Pentium\s*(?:Gold\s*|Silver\s*)?[A-Z]?\d{3,5}[A-Z]{0,2}|Celeron\s*[A-Z]?\d{3,5}[A-Z]{0,2}|Xeon\s*E3-\d{4}[A-Z]?\s*v\d)/gi;

function wikiGpus(rawFor) {
  const gpu = new Map(); // key -> { fp: [], arch, m, src }
  const cpuIgpu = new Map(); // cpuKey -> gpuKey
  const put = (key, fp, arch, mobile, src, bw) => {
    if (process.env.HWDB_DEBUG && String(key).includes(process.env.HWDB_DEBUG)) console.log("put", key, fp, arch, bw, src);
    if (!key || !(fp > 0) || fp > 300000 || !arch) return;
    if (!gpu.has(key)) gpu.set(key, { fp: [], bw: [], arch, m: mobile ? 1 : 0, src });
    gpu.get(key).fp.push(fp);
    if (bw > 0 && bw < 5000) gpu.get(key).bw.push(bw);
  };

  // --- Dedicadas: NVIDIA, AMD, Intel Arc
  for (const vendor of ["Nvidia", "AMD", "Intel"]) {
    for (const t of tables(rawFor(`List_of_${vendor}_graphics_processing_units`))) {
      let fpCol = t.header.findIndex((h) => /single/i.test(h) && /flops|processing/i.test(h));
      if (fpCol < 0 && !t.header.some((h) => /double|half/i.test(h))) fpCol = t.header.findIndex((h) => /^processing power \((?:g|t)flops\)\s*\d*$/i.test(h));
      const nameCols = t.header.map((h, i) => (/^(model|branding and model|name|model \(code name\))/i.test(h) ? i : -1)).filter((i) => i >= 0);
      const codeCol = col(t, /code ?name|chip|architecture/i);
      const bwCol = col(t, /band-?\s*width/i);
      if (fpCol < 0 || !nameCols.length) continue;
      const tera = /tflops/i.test(t.header[fpCol]);
      for (const r of t.body) {
        // Las variantes OEM a veces son otro chip con el mismo nombre (GTX 750 Ti OEM = Kepler)
        if (/\boem\b/i.test(nameCols.map((i) => r[i]).join(" "))) continue;
        const raw = [...new Set(nameCols.map((i) => r[i]))].join(" ").replace(/\([^)]*\)/g, " ");
        // En TFLOPS algunas celdas usan coma decimal ("5,437"): >300 TFLOPS no existe
        const fp = Math.max(0, ...nums(r[fpCol]).map((v) => (tera && v > 300 ? v / 1000 : v))) * (tera ? 1000 : 1);
        const bw = bwCol >= 0 ? Math.max(0, ...nums(r[bwCol])) : 0;
        const rowText = r.join(" ");
        let arch = null;
        if (vendor === "Nvidia") arch = NV_ARCH.find(([re]) => re.test(r[codeCol] || rowText))?.[1];
        else if (vendor === "AMD") arch = AMD_ARCH.find(([re]) => re.test(`${r[codeCol] || ""} ${rowText}`))?.[1];
        else arch = intelGen(t.title, rowText);
        const mobile = isMobileTitle(t.title) || /\(laptop|mobile|notebook\)/i.test(nameCols.map((i) => r[i]).join(" "));
        let key = gpuKey(`${vendor === "Nvidia" ? "nvidia" : vendor === "AMD" ? "amd" : "intel"} ${raw}${mobile ? " mobile" : ""}`);
        if (vendor === "AMD" && !arch && key) arch = AMD_SERIES.find(([re]) => re.test(key))?.[1];
        if (key && /^amd (?:\d{3}m|vega \d)$/.test(key)) continue; // integradas: van por las APU
        put(key, fp, arch, mobile, "wikipedia", bw);
      }
    }
  }

  // --- Integradas de Intel (Gen6 a Gen12): EUs/ALUs × reloj
  for (const t of tables(rawFor("List_of_Intel_graphics_processing_units"))) {
    const gen = intelGen(t.title, t.body.map((r) => r.join(" ")).join(" ").slice(0, 400));
    if (!gen || !/^gen|xe-lp/.test(gen)) continue;
    const nameC = col(t, /^(graphics|name)$/i);
    const cfgC = col(t, /core config|execution units/i);
    let maxC = col(t, /clock.*\bmax\b/i);
    if (maxC < 0) maxC = col(t, /core clock|clock rate|render clock/i);
    const procC = col(t, /^processor( \/ model)?$|processor \/ model/i);
    const bwC = col(t, /band-?\s*width/i);
    if (nameC < 0 || cfgC < 0 || maxC < 0) continue;
    for (const r of t.body) {
      const cfg = r[cfgC];
      const clk = Math.max(0, ...nums(r[maxC])) / 1000;
      let alus = /(\d+):\d+:\d+/.exec(cfg)?.[1];
      if (alus) alus = Number(alus);
      else {
        const eu = nums(cfg)[0];
        if (!eu) continue;
        alus = eu * (gen === "gen6" ? 4 : 8);
      }
      const fp = alus * 2 * clk;
      const bw = bwC >= 0 ? Math.max(0, ...nums(r[bwC])) : 0;
      const nameKey = gpuKey(`intel ${r[nameC]}`);
      const cpus = (r[procC] || "").match(CPU_IN_CELL) || [];
      if (nameKey) put(nameKey, fp, gen, 0, "wikipedia-igpu", bw);
      for (const c of cpus) {
        const ck = cpuKey(`intel ${c}`);
        if (!ck) continue;
        const ik = nameKey || `igpu ${ck}`;
        if (!nameKey) put(ik, fp, gen, 0, "wikipedia-igpu", bw);
        cpuIgpu.set(ck, ik);
      }
    }
  }

  // --- Meteor Lake y Lunar Lake: Xe-cores × 256 FLOP/ciclo × reloj
  for (const [page, arch] of [["Meteor_Lake", "xe-lpg"], ["Lunar_Lake", "xe2-lpg"]]) {
    for (const t of tables(rawFor(page))) {
      const xeC = col(t, /xe-?cores|xe2-?cores|graphics.*cores/i);
      const fC = col(t, /graphics.*(freq|clock)|max\. fre/i);
      const brandC = col(t, /branding/i);
      const modelC = t.header.findIndex((h, i) => i !== brandC && /^(model|sku)|model \//i.test(h));
      if (xeC < 0 || fC < 0 || modelC < 0) continue;
      for (const r of t.body) {
        const xe = nums(r[xeC])[0];
        const ghz = Math.max(0, ...nums(r[fC]));
        const ck = cpuKey(`intel ${r[brandC] || "core ultra"} ${r[modelC]}`);
        if (!xe || !ghz || !ck) continue;
        const ik = `igpu ${ck}`;
        put(ik, xe * 256 * (ghz > 50 ? ghz / 1000 : ghz), arch, 0, "wikipedia-igpu");
        cpuIgpu.set(ck, ik);
        if (arch === "xe2-lpg") put(`intel arc ${xe >= 8 ? "140v" : "130v"}`, xe * 256 * ghz, arch, 0, "wikipedia-igpu");
      }
    }
  }

  // --- APUs de AMD: configuración de la GPU × reloj
  const APU_ARCH = [
    [/strix|krackan|gorgon|fire range/i, "rdna35-igp"], [/phoenix|hawk point/i, "rdna3-igp"], [/rembrandt|mendocino|dragon range|raphael|granite/i, "rdna2-igp"],
    [/raven|picasso|renoir|lucienne|cezanne|barcelo|dali|pollock|vega/i, "gcn5-igp"], [/kaveri|godavari|carrizo|bristol|stoney|beema|mullins|kabini|temash/i, "gcn-igp"],
    [/trinity|richland/i, "ts3-igp"], [/llano|ontario|zacate/i, "ts2-igp"],
  ];
  for (const t of [...tables(rawFor("List_of_AMD_accelerated_processing_units")), ...tables(rawFor("List_of_AMD_Ryzen_processors"))]) {
    const brandCols = t.header.map((h, i) => (/branding and model|^model$|^branding$/i.test(h) ? i : -1)).filter((i) => i >= 0);
    const cfgC = t.header.findIndex((h) => /gpu \/ (core )?config|gpu \/ config/i.test(h));
    const clkC = t.header.findIndex((h) => /gpu \/ clock/i.test(h));
    const gmodelC = t.header.findIndex((h) => /gpu \/ model/i.test(h));
    if (!brandCols.length || clkC < 0 || (cfgC < 0 && gmodelC < 0)) continue;
    const arch = APU_ARCH.find(([re]) => re.test(t.title))?.[1];
    if (!arch) continue;
    const ghzUnit = /ghz/i.test(t.header[clkC]);
    for (const r of t.body) {
      const cfgText = `${cfgC >= 0 ? r[cfgC] : ""} ${gmodelC >= 0 ? r[gmodelC] : ""}`;
      const alus = Number(/(\d+):\d+:\d+/.exec(cfgText)?.[1]) || Number(/(\d+)\s*CUs?\b/i.exec(cfgText)?.[1]) * 64;
      const clk = Math.max(0, ...nums(r[clkC]));
      if (!alus || !clk) continue;
      const fp = alus * 2 * (ghzUnit ? clk : clk / 1000);
      const ck = cpuKey(`amd ${[...new Set(brandCols.map((i) => r[i]))].join(" ")}`);
      if (!ck) continue;
      const ik = `igpu ${ck}`;
      put(ik, fp, arch, 0, "wikipedia-igpu");
      cpuIgpu.set(ck, ik);
      const named = gmodelC >= 0 ? gpuKey(`amd radeon ${r[gmodelC].replace(/\d+\s*CUs?\b/i, "")}`) : null;
      if (named) put(named, fp, arch, 0, "wikipedia-igpu");
    }
  }
  return { gpu, cpuIgpu };
}

// ------------------------------------------------------------ Calibración
// Puntuación GPU = A[arquitectura] × FP32^k1 × ancho de banda^k2.
// - k1 < 1: las gráficas grandes rinden menos en juegos por cada FLOP.
// - k2: la memoria lenta frena (gamas bajas con DDR3, integradas). Con él
//   también se calcula cuánto pierde una integrada en un solo canal.
// A, k1 y k2 salen de anchors.json por mínimos cuadrados en escala log.
// Integradas sin ancho de banda en la tabla: el de la memoria típica de
// los equipos de su generación (doble canal).
const IGP_BW = { "gcn-igp": 25.6, "ts2-igp": 21.3, "ts3-igp": 25.6, "gcn5-igp": 51.2, "rdna2-igp": 102.4, "rdna3-igp": 120, "rdna35-igp": 128, "xe-lpg": 90, "xe2-lpg": 136.5 };
const ARCH_FALLBACK = {
  curie: ["tesla", 0.8], volta: ["turing", 1], gen6: ["gen7", 0.9], r500: ["ts1", 1],
  "gen7.5": ["gen7", 1], gen8: ["gen9", 1], gen11: ["gen9", 1], "xe-lp": ["gen9", 0.75], "xe2-lpg": ["xe-lpg", 1.1],
  "gcn-igp": ["gcn5-igp", 1], "ts3-igp": ["gcn5-igp", 0.8], "ts2-igp": ["gcn5-igp", 0.7], "rdna35-igp": ["rdna3-igp", 1],
  "rdna2-igp": ["rdna3-igp", 1], "rdna3-igp": ["rdna2-igp", 1], "xe2-hpg": ["xe-hpg", 1.2],
};

function fillBandwidth(gpu) {
  // Sin dato: la proporción ancho de banda/FLOP típica de su arquitectura
  const ratio = {};
  for (const g of gpu.values()) if (g.bw.length) (ratio[g.arch] ||= []).push(median(g.bw) / median(g.fp));
  for (const g of gpu.values()) {
    g.FP = median(g.fp);
    g.BW = g.bw.length ? median(g.bw) : IGP_BW[g.arch] || (ratio[g.arch] ? median(ratio[g.arch]) * g.FP : NaN);
  }
}

function calibrate(gpu, anchors) {
  const pts = [];
  const miss = [];
  for (const [key, rel] of Object.entries(anchors)) {
    const g = gpu.get(key);
    if (!g || !(g.BW > 0)) miss.push(key);
    else pts.push({ key, rel, arch: g.arch, F: Math.log(g.FP), B: Math.log(g.BW) });
  }
  let best = null;
  for (let k1 = 0.3; k1 <= 1.0001; k1 += 0.02) {
    for (let k2 = 0; k2 <= 0.7001; k2 += 0.02) {
      const by = {};
      for (const p of pts) (by[p.arch] ||= []).push(Math.log(p.rel) - k1 * p.F - k2 * p.B);
      const A = {};
      for (const [a, v] of Object.entries(by)) A[a] = v.reduce((x, y) => x + y, 0) / v.length;
      const err = pts.reduce((e, p) => e + (Math.log(p.rel) - A[p.arch] - k1 * p.F - k2 * p.B) ** 2, 0);
      if (!best || err < best.err) best = { k1, k2, A, err };
    }
  }
  const k1 = Math.round(best.k1 * 100) / 100;
  const k2 = Math.round(best.k2 * 100) / 100;
  const factor = {};
  for (const [a, v] of Object.entries(best.A)) factor[a] = Math.exp(v);
  for (const [a, [base, mul]] of Object.entries(ARCH_FALLBACK)) if (!factor[a] && factor[base]) factor[a] = factor[base] * mul;
  log(`GPU: FP32^${k1} × ancho de banda^${k2}; ${pts.length} equivalencias, sin dato: ${miss.join(", ") || "ninguna"}`);
  const errs = pts.map((p) => ({ ...p, pred: factor[p.arch] * Math.exp(k1 * p.F + k2 * p.B) })).map((p) => ({ ...p, e: p.pred / p.rel - 1 }));
  const byArch = {};
  for (const p of errs) (byArch[p.arch] ||= []).push(p);
  for (const [a, list] of Object.entries(byArch)) {
    const rms = Math.sqrt(list.reduce((s, p) => s + p.e * p.e, 0) / list.length);
    log(`  ${a.padEnd(11)} factor ${factor[a].toFixed(3)}  n=${list.length}  error medio ${(rms * 100).toFixed(0)}%`);
  }
  for (const p of errs.filter((p) => Math.abs(p.e) > 0.25)) log(`  ojo: ${p.key} sale ${p.pred.toFixed(0)} y la referencia es ${p.rel} (${(p.e * 100).toFixed(0)}%)`);
  const all = Math.sqrt(errs.reduce((s, p) => s + p.e * p.e, 0) / errs.length);
  log(`  error medio global ${(all * 100).toFixed(0)}%`);
  return { k1, k2, factor };
}

// DirectX máximo por arquitectura (para el requisito "DirectX: Version 12")
const DX = {
  curie: 9, tesla: 10, fermi: 12, kepler: 12, maxwell: 12, pascal: 12, volta: 12, turing: 12, ampere: 12, ada: 12, blackwell: 12,
  r500: 9, ts1: 10, ts2: 11, ts3: 11, gcn1: 12, gcn2: 12, gcn3: 12, gcn4: 12, gcn5: 12, rdna1: 12, rdna2: 12, rdna3: 12, rdna4: 12,
  gen6: 10, gen7: 11, "gen7.5": 12, gen8: 12, gen9: 12, gen11: 12, "xe-lp": 12, "xe-lpg": 12, "xe2-lpg": 12, "xe-hpg": 12, "xe2-hpg": 12,
  "ts2-igp": 11, "ts3-igp": 11, "gcn-igp": 12, "gcn5-igp": 12, "rdna2-igp": 12, "rdna3-igp": 12, "rdna35-igp": 12,
};

// ------------------------------------------------------------ Principal
(async () => {
  if (process.argv.includes("--download")) await download();
  const rawFor = (p) => {
    const f = path.join(RAW, `wiki-${p}.json`);
    if (!fs.existsSync(f)) throw new Error(`Falta ${f} (usa --download)`);
    return JSON.parse(fs.readFileSync(f, "utf8")).parse.text;
  };
  const anchors = JSON.parse(fs.readFileSync(path.join(__dirname, "anchors.json"), "utf8")).gpu;
  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, "overrides.json"), "utf8"));

  // GPU
  const { gpu, cpuIgpu } = wikiGpus(rawFor);
  fillBandwidth(gpu);
  const cal = calibrate(gpu, anchors);
  const gpuOut = {};
  let noArch = 0;
  for (const [key, g] of gpu) {
    const f = cal.factor[g.arch];
    if (!f) {
      noArch++;
      continue;
    }
    if (!(g.BW > 0)) {
      noArch++;
      continue;
    }
    const sc = f * g.FP ** cal.k1 * g.BW ** cal.k2;
    gpuOut[key] = { s: Math.round(sc * 10) / 10, a: g.arch, dx: DX[g.arch] || null, ...(g.m ? { m: 1 } : {}), fp: Math.round(g.FP), bw: Math.round(g.BW) };
  }
  for (const [key, o] of Object.entries(overrides.gpu || {})) gpuOut[key] = { ...gpuOut[key], ...o, src: "override" };
  log(`GPU: ${Object.keys(gpuOut).length} modelos (${noArch} sin arquitectura o sin datos, descartados), ${cpuIgpu.size} CPUs con su integrada`);

  // CPU
  const { s, topo, count, names } = await blenderCpus();
  const cpuOut = {};
  const ref = s.get("intel i5 4460");
  for (const [key, ls] of s) {
    const t = topo.get(key);
    if (!t) continue;
    const cores = Math.round(median(t.cores));
    const threads = Math.round(median(t.threads));
    const lay = coreLayout(key, cores, threads);
    const mt = Math.exp(ls - ref) * 100;
    cpuOut[key] = { s: Math.round(cpuGaming(mt, lay) * 10) / 10, mt: Math.round(mt * 10) / 10, c: cores, t: threads, ...(lay.e ? { p: lay.p } : {}), n: count.get(key) };
  }
  // La puntuación de juego también en escala i5-4460 = 100
  const g4460 = cpuOut["intel i5 4460"].s;
  for (const v of Object.values(cpuOut)) v.s = Math.round((v.s / g4460) * 1000) / 10;
  for (const [key, o] of Object.entries(overrides.cpu || {})) cpuOut[key] = { ...cpuOut[key], ...o, src: "override" };
  log(`CPU: ${Object.keys(cpuOut).length} modelos (i5-4460 = 100)`);
  for (const k of ["intel i3 6100", "amd ryzen 5 1400", "intel ultra 5 125 u", "amd fx 6300", "intel i5 2500 k", "amd ryzen 5 3600", "intel i7 12700 k"])
    log(`  ${k}: ${JSON.stringify(cpuOut[k] || "SIN DATO")}`);

  const out = {
    v: 1,
    generated: new Date().toISOString().slice(0, 10),
    sources: [
      { name: "Blender Open Data", license: "CC0 1.0", url: "https://opendata.blender.org/" },
      { name: "Wikipedia (listas de GPU y APU)", license: "CC BY-SA 4.0", url: "https://en.wikipedia.org/" },
    ],
    scale: { cpu: "Intel Core i5-4460 = 100 (juego)", gpu: "GeForce GTX 1060 6GB ≈ 100 (juego)" },
    calibration: { k1: cal.k1, k2: cal.k2, factor: Object.fromEntries(Object.entries(cal.factor).map(([a, f]) => [a, Math.round(f * 1e4) / 1e4])) },
    cpu: cpuOut,
    gpu: gpuOut,
    cpuIgpu: { ...Object.fromEntries(cpuIgpu), ...(overrides.cpuIgpu || {}) },
    alias: overrides.alias || {},
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  fs.writeFileSync(REPORT, report.join("\n") + "\n");
  console.log(`\n→ ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB), informe en ${path.relative(process.cwd(), REPORT)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
