// =====================================================================
// Tu equipo, listo para comparar
// =====================================================================
// analyze(raw) es puro (se prueba con equipos de ejemplo); detect() lee el
// sistema con systeminformation una sola vez por sesión.
//
// Casos que resuelve:
//  - Integradas genéricas ("Intel(R) Graphics", "AMD Radeon(TM) Graphics"):
//    la integrada real sale de la CPU (tabla CPU → iGPU de la base).
//  - VRAM de integradas: lo que dice Windows (1 GB) es solo la reserva; se
//    usa la RAM compartida (la mitad de la RAM).
//  - RAM en un solo canal: la integrada pierde ancho de banda y rendimiento.
//  - Portátiles: gráfica de portátil cuando existe en la base; si solo está
//    la de sobremesa, con un factor. Las CPUs ya vienen medidas en portátiles
//    reales (Blender Open Data), así que no llevan factor.
const scores = require("./scores");
const { cpuKey, gpuKey, isGenericIgpu } = require("./normalize");
const DEFAULT_CONFIG = require("./config.json");

const VIRTUAL_GPU = /microsoft basic|remote|virtual|parsec|vmware|virtualbox|citrix|dummy|indirect|idd|spacedesk|displaylink|meta virtual|oray|sunlogin|todesk|rdp/i;
const LAPTOP_CHASSIS = /notebook|laptop|portable|sub ?notebook|hand ?held|convertible|detachable|tablet/i;
const GB = 1024 ** 3;

function osVersion(distro, release, build) {
  const s = `${distro || ""} ${release || ""}`;
  const m = /windows\s*(11|10|8\.1|8|7|vista|xp)/i.exec(s);
  if (m) return { xp: 5.1, vista: 6, "8.1": 8.1 }[m[1].toLowerCase()] ?? Number(m[1]);
  // Windows 11 se reporta a veces como 10 con build >= 22000
  const b = Number(String(build || release || "").split(".").pop());
  if (b >= 22000) return 11;
  return null;
}

function analyze(raw, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cal = scores.calibration() || { k2: 0.2 };

  // ---- CPU
  const cpuName = [raw.cpu?.manufacturer, raw.cpu?.brand].filter(Boolean).join(" ").replace(/^(Intel|AMD)\s+(\1)/i, "$1");
  const ck = cpuKey(cpuName);
  const cs = scores.cpu(ck);
  const cpu = { label: cpuName || "Desconocido", key: ck, score: cs?.s ?? null, approx: !!cs?.approx, note: cs?.note };

  // ---- RAM instalada (no la usable: 16 GB salen como 15,8) y canales
  const banks = (raw.memLayout || []).filter((b) => b.size > 0);
  const installed = banks.length ? banks.reduce((s, b) => s + b.size, 0) : raw.mem?.total || 0;
  const ram = installed ? Math.round(installed / GB) : null;
  let channels = null;
  if (banks.length >= 2) channels = "dual";
  else if (banks.length === 1) channels = /lpddr/i.test(banks[0].type || "") ? null : "single"; // LPDDR soldada: Windows no lo cuenta bien

  // ---- Portátil
  const laptop = LAPTOP_CHASSIS.test(raw.chassis?.type || "") || (!!raw.battery?.hasBattery && !raw.battery?.isUps);

  // ---- Gráficas: la mejor que no sea virtual
  const controllers = (raw.graphics?.controllers || []).filter((c) => c.model && !VIRTUAL_GPU.test(c.model));
  const candidates = [];
  for (const c of controllers) {
    const model = c.model.trim();
    let key = gpuKey(model);
    let integrated = false;
    let label = model;
    let deduced = false;
    if (!key && isGenericIgpu(model)) {
      key = scores.igpuOf(ck);
      integrated = true;
      deduced = !!key;
    } else if (key && (/^igpu |^amd (?:\d{3}m|vega \d)$|^intel (?:u?hd|iris|arc 1[34]0v)/.test(key))) integrated = true;
    // Integrada con nombre propio pero la CPU sabe la suya (más precisa)
    if (integrated && scores.igpuOf(ck) && !/^intel arc/.test(key || "")) {
      key = scores.igpuOf(ck);
    }
    let hit = scores.gpu(key, { laptopFactor: cfg.laptopGpuFactor });
    const notes = [];
    if (hit && !integrated && laptop && !hit.m && !/ m$/.test(hit.key)) {
      const mob = scores.gpu(`${hit.key} m`, { laptopFactor: cfg.laptopGpuFactor });
      if (mob && mob.m) hit = mob;
      else {
        hit = { ...hit, s: Math.round(hit.s * cfg.laptopGpuFactor * 10) / 10, approx: true };
        notes.push("portátil: rendimiento de sobremesa con factor");
      }
    }
    if (hit && integrated && channels === "single") {
      const f = cfg.singleChannelBandwidth ** (cal.k2 ?? 0.2);
      hit = { ...hit, s: Math.round(hit.s * f * 10) / 10 };
      notes.push("RAM en un solo canal");
    }
    if (deduced) {
      label = integrated && /^igpu /.test(key) ? `${model} (la de tu ${cpuName.replace(/^(intel|amd)\s+/i, "")})` : model;
      notes.unshift("deducida por tu procesador");
    }
    const vramGb = c.vram > 0 ? Math.round((c.vram / 1024) * 10) / 10 : null;
    candidates.push({ label, key: hit?.key ?? key ?? null, score: hit?.s ?? null, dx: hit?.dx ?? null, approx: !!hit?.approx, integrated, vramGb, notes, note: hit?.note });
  }
  candidates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Number(a.integrated) - Number(b.integrated));
  const gpu = candidates[0] || { label: "Desconocida", key: null, score: null, integrated: false, notes: [] };

  // ---- VRAM: dedicada, o la compartida de la integrada
  let vram = null;
  let vramShared = false;
  if (gpu.integrated) {
    vram = ram ? Math.round(ram * cfg.sharedVramFraction * 10) / 10 : null;
    vramShared = true;
  } else vram = gpu.vramGb;

  // ---- Sistema y disco
  const win = osVersion(raw.osInfo?.distro, raw.osInfo?.release, raw.osInfo?.build);
  const bits64 = /64/.test(raw.osInfo?.arch || "") ? true : raw.osInfo?.arch ? false : null;
  const drives = (raw.fsSize || []).filter((d) => d.size > 0);
  const freeStorage = drives.length ? Math.floor(Math.max(...drives.map((d) => d.available / GB))) : null;
  const disks = raw.diskLayout || [];
  const hasSsd = disks.length ? disks.some((d) => /ssd|nvme/i.test(`${d.type} ${d.interfaceType} ${d.name}`)) : null;

  return { cpu, gpu, gpus: candidates, ram, channels, vram, vramShared, laptop, os: { win, bits64 }, freeStorage, hasSsd };
}

let cached = null;
function detect(si, config) {
  if (!cached) {
    cached = (async () => {
      const safe = (p) => p.catch(() => null);
      const [cpu, mem, memLayout, graphics, osInfo, chassis, battery, fsSize, diskLayout] = await Promise.all([
        safe(si.cpu()), safe(si.mem()), safe(si.memLayout()), safe(si.graphics()), safe(si.osInfo()),
        safe(si.chassis()), safe(si.battery()), safe(si.fsSize()), safe(si.diskLayout()),
      ]);
      return analyze({ cpu, mem, memLayout, graphics, osInfo, chassis, battery, fsSize, diskLayout }, config);
    })().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

module.exports = { analyze, detect, osVersion };
