const test = require("node:test");
const assert = require("node:assert/strict");
const { gpuKey, cpuKey, genericCpu, isGenericIgpu } = require("../../hardware/normalize");

test("variantes de una misma GPU dan la misma clave", () => {
  for (const n of ["GTX 750Ti", "GeForce GTX 750 Ti", "NVIDIA GeForce GTX 750 Ti 2GB", "nvidia gtx 750-ti"]) assert.equal(gpuKey(n), "nv gtx 750 ti", n);
  assert.equal(gpuKey("NVIDIA 750 Ti 2GB"), "nv 750 ti"); // sin gama: lo resuelve scores.gpu
  assert.equal(gpuKey("AMD Radeon HD 6970"), "amd hd 6970");
  assert.equal(gpuKey("Radeon HD 6970 (Cayman XT)"), "amd hd 6970");
  assert.equal(gpuKey("AMD Radeon R9 280X 3GB"), "amd r9 280 x");
  assert.equal(gpuKey("RX 7900 XTX"), "amd rx 7900 xtx");
  assert.equal(gpuKey("NVIDIA GeForce RTX 4070 Ti SUPER"), "nv rtx 4070 ti super");
  assert.equal(gpuKey("Intel(R) Arc(TM) A750 Graphics"), "intel arc a750");
  assert.equal(gpuKey("Intel(R) UHD Graphics 620"), "intel uhd 620");
  assert.equal(gpuKey("AMD Radeon(TM) Vega 8 Graphics"), "amd vega 8");
});

test("las de portátil llevan su marca", () => {
  assert.equal(gpuKey("NVIDIA GeForce RTX 3060 Laptop GPU"), "nv rtx 3060 m");
  assert.equal(gpuKey("GeForce GTX 970M"), "nv gtx 970 m");
  assert.equal(gpuKey("GTX 1050 Ti Max-Q"), "nv gtx 1050 ti m");
  assert.equal(gpuKey("Radeon RX 5500M"), "amd rx 5500 m");
});

test("integradas genéricas: no se inventa el modelo", () => {
  for (const n of ["Intel(R) Graphics", "Intel(R) Iris(R) Xe Graphics", "AMD Radeon(TM) Graphics", "Intel(R) UHD Graphics"]) {
    assert.equal(gpuKey(n), null, n);
    assert.ok(isGenericIgpu(n), n);
  }
  assert.equal(gpuKey("DirectX 11 compatible graphics card"), null);
});

test("CPUs: variantes de Intel y AMD", () => {
  assert.equal(cpuKey("Intel(R) Core(TM) i5-4460 CPU @ 3.20GHz"), "intel i5 4460");
  assert.equal(cpuKey("Intel Core i3-6100"), "intel i3 6100");
  assert.equal(cpuKey("Intel(R) Core(TM) Ultra 5 125U"), "intel ultra 5 125 u");
  assert.equal(cpuKey("13th Gen Intel(R) Core(TM) i7-13700H"), "intel i7 13700 h");
  assert.equal(cpuKey("Intel Core i5-12400F"), "intel i5 12400"); // la F rinde igual
  assert.equal(cpuKey("Intel Core i7-12700KF"), "intel i7 12700 k");
  assert.equal(cpuKey("AMD Ryzen 5 1400 Quad-Core Processor"), "amd ryzen 5 1400");
  assert.equal(cpuKey("AMD Ryzen 7 5800X3D 8-Core Processor"), "amd ryzen 7 5800 x3d");
  assert.equal(cpuKey("AMD Ryzen 5 PRO 4650U with Radeon Graphics"), "amd ryzen 5 4650 u");
  assert.equal(cpuKey("AMD FX-6300"), "amd fx 6300");
  assert.equal(cpuKey("Intel Core 2 Quad Q6600"), "intel c2 q 6600");
});

test("los GHz del texto no se cuelan en el modelo", () => {
  assert.equal(cpuKey("AMD Ryzen 3 1200 3.1 GHz"), "amd ryzen 3 1200");
  assert.equal(cpuKey("Intel Core i5-3470 a 3,2 GHz"), "intel i5 3470");
  assert.equal(cpuKey("AMD FX-8350 a 4.0 GHz"), "amd fx 8350");
});

test("requisitos genéricos de CPU", () => {
  assert.deepEqual(genericCpu("Dual Core 2.4 GHz"), { cores: 2, ghz: 2.4, modern: false });
  assert.equal(genericCpu("Intel Core 2 Quad o superior").cores, 4);
  assert.equal(genericCpu("Core i5 or AMD equivalent").modern, true);
  assert.equal(genericCpu("cualquier cosa"), null);
});
