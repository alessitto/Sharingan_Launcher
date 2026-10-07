// Cobertura de la base sobre requisitos reales de Steam (raw/steam-corpus.json):
// qué porcentaje de líneas de CPU/GPU tienen un modelo reconocido y qué
// nombres faltan (para añadir alias u overrides).
//   node tools/hw-db/coverage.js
const path = require("path").join(__dirname, "..", "..", "hardware") + "/";
const { parseRequirements } = require(path + "reqs");
const sc = require(path + "scores");
const corpus = require("./raw/steam-corpus.json");
const strip = (html) => !html ? "" : String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<li>/gi, "• ").replace(/<\/li>/gi, "\n").replace(/<[^>]+>/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
const st = { cpuAlt: 0, cpuOk: 0, gpuAlt: 0, gpuOk: 0, levels: 0, cpuLine: 0, cpuLineOk: 0, gpuLine: 0, gpuLineOk: 0, ram: 0, os: 0, sto: 0 };
const missCpu = {}, missGpu = {};
for (const [id, g] of Object.entries(corpus)) for (const lang of ["spanish", "english"]) {
  const pr = g[lang];
  if (!pr || Array.isArray(pr)) continue;
  for (const lvl of ["minimum", "recommended"]) {
    const r = parseRequirements(strip(pr[lvl]));
    if (!r) continue;
    st.levels++;
    if (r.ram) st.ram++; if (r.os?.win) st.os++; if (r.storage) st.sto++;
    if (r.cpu) { st.cpuLine++; let any = false;
      for (const a of r.cpu.alts) { st.cpuAlt++; const hit = a.key ? sc.cpu(a.key) : sc.genericCpu(a.generic); if (hit) { st.cpuOk++; any = true; } else missCpu[a.key || a.text] = (missCpu[a.key || a.text] || 0) + 1; }
      if (any) st.cpuLineOk++; else if (!r.cpu.alts.length) missCpu["(línea sin alternativas) " + r.cpu.text.slice(0, 60)] = 1; }
    if (r.gpu) { st.gpuLine++; let any = false;
      for (const a of r.gpu.alts) { st.gpuAlt++; const hit = sc.gpu(a.key); if (hit) { st.gpuOk++; any = true; } else missGpu[a.key] = (missGpu[a.key] || 0) + 1; }
      if (any) st.gpuLineOk++; else if (!r.gpu.alts.length) missGpu["(sin modelo) " + r.gpu.text.slice(0, 60)] = 1; }
  }
}
console.log(JSON.stringify(st));
console.log("CPU líneas con algún modelo reconocido:", (st.cpuLineOk / st.cpuLine * 100).toFixed(0) + "%", " GPU:", (st.gpuLineOk / st.gpuLine * 100).toFixed(0) + "%");
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${n}× ${k}`).join("\n  ");
console.log("CPU sin dato:\n  " + top(missCpu));
console.log("GPU sin dato:\n  " + top(missGpu));
