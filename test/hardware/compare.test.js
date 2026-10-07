const test = require("node:test");
const assert = require("node:assert/strict");
const scores = require("../../hardware/scores");
const { analyze } = require("../../hardware/detect");
const { check } = require("../../hardware/compare");
const { parseRequirements } = require("../../hardware/reqs");

const GB = 1024 ** 3;

// Equipos de ejemplo con la forma que devuelve systeminformation
const ultra125U = {
  cpu: { manufacturer: "Intel", brand: "Core™ Ultra 5 125U" },
  mem: { total: 15.6 * GB },
  memLayout: [{ size: 8 * GB, type: "DDR5" }, { size: 8 * GB, type: "DDR5" }],
  graphics: { controllers: [{ model: "Intel(R) Graphics", vram: 128 }] },
  osInfo: { distro: "Microsoft Windows 11 Home", arch: "x64" },
  chassis: { type: "Notebook" },
  battery: { hasBattery: true },
  fsSize: [{ size: 512 * GB, available: 200 * GB }],
  diskLayout: [{ type: "NVMe", interfaceType: "PCIe" }],
};
const desktop1060 = {
  cpu: { manufacturer: "Intel", brand: "Core™ i5-4460" },
  mem: { total: 16 * GB },
  memLayout: [{ size: 8 * GB, type: "DDR3" }, { size: 8 * GB, type: "DDR3" }],
  graphics: { controllers: [{ model: "Intel(R) HD Graphics 4600", vram: 128 }, { model: "NVIDIA GeForce GTX 1060 6GB", vram: 6144 }] },
  osInfo: { distro: "Microsoft Windows 10 Pro", arch: "x64" },
  chassis: { type: "Desktop" },
  battery: { hasBattery: false },
  fsSize: [{ size: 1000 * GB, available: 400 * GB }],
  diskLayout: [{ type: "HD", interfaceType: "SATA" }],
};
const req = (text) => parseRequirements(text);

test("detección: integrada genérica deducida por la CPU, VRAM compartida, portátil", () => {
  const s = analyze(ultra125U);
  assert.equal(s.cpu.key, "intel ultra 5 125 u");
  assert.ok(s.cpu.score > 100);
  assert.equal(s.gpu.integrated, true);
  assert.equal(s.gpu.key, "igpu intel ultra 5 125 u");
  assert.ok(s.gpu.notes.includes("deducida por tu procesador"));
  assert.equal(s.ram, 16); // instalada, no la usable (15,6)
  assert.equal(s.vram, 8); // la mitad de la RAM, no los 128 MB que dice Windows
  assert.equal(s.vramShared, true);
  assert.equal(s.laptop, true);
  assert.equal(s.channels, "dual");
  assert.equal(s.os.win, 11);
});

test("detección: un solo canal de RAM baja la integrada", () => {
  const dual = analyze(ultra125U).gpu.score;
  const single = analyze({ ...ultra125U, memLayout: [{ size: 16 * GB, type: "DDR5" }] }).gpu;
  assert.ok(single.score < dual, `${single.score} < ${dual}`);
  assert.ok(single.notes.includes("RAM en un solo canal"));
});

test("detección: con dedicada se elige la dedicada, no la integrada", () => {
  const s = analyze(desktop1060);
  assert.equal(s.gpu.key, "nv gtx 1060");
  assert.equal(s.gpu.integrated, false);
  assert.equal(s.vram, 6);
  assert.equal(s.laptop, false);
});

test("detección: gráficas virtuales fuera y nombre de AMD genérico", () => {
  const s = analyze({
    ...ultra125U,
    cpu: { manufacturer: "AMD", brand: "Ryzen 5 5600U with Radeon Graphics" },
    graphics: { controllers: [{ model: "Microsoft Basic Display Adapter", vram: 0 }, { model: "AMD Radeon(TM) Graphics", vram: 512 }] },
  });
  assert.equal(s.gpu.key, "igpu amd ryzen 5 5600 u");
  assert.ok(s.gpu.score > 0);
});

test("base: relaciones de rendimiento conocidas", () => {
  const g = (k) => scores.gpu(k).s;
  const c = (k) => scores.cpu(k).s;
  assert.ok(Math.abs(g("nv gtx 1060") / g("amd rx 580") - 1) < 0.15, "GTX 1060 ≈ RX 580");
  assert.ok(g("nv rtx 3060") > g("nv gtx 1060"));
  assert.ok(g("nv rtx 4090") > g("nv rtx 3080"));
  assert.ok(g("amd hd 6970") > g("nv gtx 750 ti"));
  assert.ok(g("intel uhd 620") < g("nv gt 1030"));
  assert.ok(c("amd ryzen 5 1400") > c("intel i3 6100"));
  assert.ok(c("intel i7 12700 k") > c("amd ryzen 5 3600"));
  assert.ok(c("amd ryzen 5 3600") > c("intel i5 4460"));
});

test("base: búsquedas aproximadas", () => {
  assert.equal(scores.gpu("nv 750 ti").key, "nv gtx 750 ti"); // "NVIDIA 750 Ti" sin gama
  assert.equal(scores.gpu("nv 480 gtx").key, "nv gtx 480"); // al revés
  assert.equal(scores.gpu("amd hd 7800").key, "amd hd 7850"); // serie → la más baja
  assert.equal(scores.gpu("nv nada 9999"), null);
  assert.equal(scores.cpu("intel i9 99999"), null);
});

// ------------------------------------------------------------ Semáforo
// Caso del enunciado: Core Ultra 5 125U con su integrada (4 núcleos Xe)
// frente a mínimo Ryzen 5 1400 / i3-6100 y GTX 750 Ti / HD 6970.
test("Core Ultra 5 125U + Intel Graphics vs GTX 750 Ti / HD 6970", () => {
  const s = analyze(ultra125U);
  const min = req("• Procesador: AMD Ryzen 5 1400 / Intel Core i3-6100\n• Memoria: 8 GB de RAM\n• Gráficos: NVIDIA GeForce GTX 750Ti / AMD Radeon HD 6970\n• Almacenamiento: 30 GB de espacio disponible");
  const r = check(s, min, null);
  const cpu = r.components.cpu;
  const gpu = r.components.gpu;
  // CPU de sobra: 1,7× la más baja de las dos (i3-6100)
  assert.equal(cpu.status, "green");
  assert.ok(cpu.ratio > 1.5, String(cpu.ratio));
  assert.match(cpu.min.text, /i3-6100/);
  // GPU: el umbral es la GTX 750 Ti (más baja que la HD 6970). La integrada
  // de 4 núcleos Xe rinde como una Iris Xe 96 EU, ~0,83× la 750 Ti: con el
  // ±10 % por defecto queda en rojo, no en amarillo.
  assert.match(gpu.min.text, /750/);
  assert.ok(gpu.ratio > 0.75 && gpu.ratio < 0.9, String(gpu.ratio));
  assert.equal(gpu.status, "red");
  assert.equal(r.global, "red");
  assert.deepEqual(r.culprits, ["gpu"]);
  // Con un umbral amarillo más permisivo (0,8) el mismo equipo saldría amarillo
  assert.equal(check(s, min, null, { thresholds: { yellow: 0.8 } }).components.gpu.status, "yellow");
});

test("cumple los recomendados → verde aunque el mínimo esté cerca", () => {
  const s = analyze(desktop1060);
  const min = req("• Gráficos: GTX 1050 Ti");
  const rec = req("• Gráficos: GTX 1060");
  assert.equal(check(s, min, rec).components.gpu.status, "green");
});

test("RAM justa (8 de 8) = amarillo; por debajo = rojo", () => {
  const s = { ...analyze(desktop1060), ram: 8 };
  assert.equal(check(s, req("• Memoria: 8 GB de RAM"), null).components.ram.status, "yellow");
  assert.equal(check(s, req("• Memoria: 12 GB de RAM"), null).components.ram.status, "red");
  assert.equal(check(s, req("• Memoria: 4 GB de RAM"), null).components.ram.status, "green");
});

test("desconocido: gris, nunca un color inventado, y no hunde el global", () => {
  const s = analyze(desktop1060);
  const r = check(s, req("• Procesador: Intel Core i5-4460\n• Gráficos: Matrox Parhelia 512"), null);
  assert.equal(r.components.gpu.status, "unknown");
  assert.equal(r.components.cpu.status, "yellow"); // la misma CPU: ratio 1
  assert.equal(r.global, "yellow");
  assert.deepEqual(r.unknown, ["gpu"]);
});

test("Windows, 64 bits y DirectX", () => {
  const s = analyze(desktop1060); // Windows 10, GTX 1060 (DirectX 12)
  assert.equal(check(s, req("• SO: 64-bit Windows 11"), null).components.os.status, "red");
  assert.equal(check(s, req("• SO: Windows 7/8/10"), null).components.os.status, "green");
  assert.equal(check(s, req("• DirectX: Versión 12"), null).components.dx.status, "green");
});

test("disco: espacio justo = amarillo; SSD pedido sin SSD = amarillo", () => {
  const s = { ...analyze(desktop1060), freeStorage: 62 };
  assert.equal(check(s, req("• Almacenamiento: 60 GB de espacio disponible"), null).components.storage.status, "yellow");
  const s2 = { ...analyze(desktop1060), freeStorage: 400, hasSsd: false };
  assert.equal(check(s2, req("• Almacenamiento: 60 SSD GB de espacio disponible"), null).components.storage.status, "yellow");
});

test("umbrales configurables", () => {
  const s = analyze(desktop1060);
  const min = req("• Gráficos: GTX 1060");
  assert.equal(check(s, min, null).components.gpu.status, "yellow"); // la misma: ratio 1
  assert.equal(check(s, min, null, { thresholds: { green: 1.0 } }).components.gpu.status, "green");
});
