const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRequirements, splitAlternatives, lineCategory } = require("../../hardware/reqs");
const steam = require("./steam-reqs.json"); // textos reales de Steam (pc_requirements ya en líneas)

test("alternativas: barra, or, o, coma antes de marca", () => {
  assert.deepEqual(splitAlternatives("GTX 750Ti / HD 6970"), ["GTX 750Ti", "HD 6970"]);
  assert.deepEqual(splitAlternatives("Core i7-6700 or Ryzen 5 1600"), ["Core i7-6700", "Ryzen 5 1600"]);
  assert.deepEqual(splitAlternatives("Intel Core i3-3240, AMD FX-4300"), ["Intel Core i3-3240", "AMD FX-4300"]);
  assert.deepEqual(splitAlternatives("Intel i5-4460 o AMD FX-6300"), ["Intel i5-4460", "AMD FX-6300"]);
});

test("etiquetas en español y en inglés", () => {
  assert.equal(lineCategory("• Procesador: Intel i5"), "cpu");
  assert.equal(lineCategory("• Processor: Intel i5"), "cpu");
  assert.equal(lineCategory("• Gráficos: GTX 970"), "gpu");
  assert.equal(lineCategory("• Graphics: GTX 970"), "gpu");
  assert.equal(lineCategory("• SO *: Windows 10"), "os");
  assert.equal(lineCategory("• Almacenamiento: 60 GB"), "storage");
  assert.equal(lineCategory("• Storage: 60 GB"), "storage");
  assert.equal(lineCategory("Requiere un procesador y un sistema operativo de 64 bits"), null);
});

test("Cyberpunk 2077 (mínimos, ES y EN)", () => {
  for (const lang of ["spanish", "english"]) {
    const r = parseRequirements(steam[1091500][lang].min);
    assert.deepEqual(r.cpu.alts.map((a) => a.key), ["intel i7 6700", "amd ryzen 5 1600"], lang);
    assert.deepEqual(r.gpu.alts.map((a) => a.key), ["nv gtx 1060", "amd rx 580", "intel arc a380"], lang);
    assert.equal(r.ram, 12);
    assert.equal(r.storage, 70);
    assert.equal(r.dx, 12);
    assert.equal(r.os.win, 10);
    assert.equal(r.os.bits64, true);
    assert.equal(r.vram, null); // la Arc A380 no dice su memoria: no se deduce VRAM
  }
});

test("Hollow Knight: alternativas con coma y VRAM entre paréntesis", () => {
  const r = parseRequirements(steam[367520].spanish.min);
  assert.deepEqual(r.cpu.alts.map((a) => a.key), ["intel i3 3240", "amd fx 4300"]);
  assert.deepEqual(r.gpu.alts.map((a) => a.key), ["nv gtx 560 ti", "amd hd 7750"]);
  assert.equal(r.vram, 1);
  assert.equal(r.dx, 10);
  assert.equal(r.ram, 4);
});

test("The Witcher 3: SSD en el tamaño y VRAM en las notas", () => {
  const r = parseRequirements(steam[292030].spanish.min);
  assert.equal(r.storage, 60);
  assert.equal(r.ssd, true);
  assert.equal(r.vram, 6);
  assert.equal(r.os.win, 11);
});

test("Portal 2: CPU genérica y GPUs antiguas", () => {
  const r = parseRequirements(steam[620].spanish.min);
  assert.ok(r.cpu.alts.some((a) => a.generic), "estima la CPU por GHz");
  assert.equal(r.os.win, 5.1); // "Windows 7 / Vista / XP" → la más baja
  assert.equal(r.ram, 2);
});

test("sin requisitos", () => {
  assert.equal(parseRequirements("No especificado"), null);
  assert.equal(parseRequirements(""), null);
});
