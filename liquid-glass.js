// =====================================================================
// Liquid Glass (tema "glass")
// =====================================================================
// Recreación del material Liquid Glass de iOS 26/27 sobre la ventana.
// Lo que hace Apple (y lo que se imita aquí) es una lente: el centro del
// cristal es casi transparente y todo pasa en el borde, donde el fondo se
// refracta (se "dobla" hacia dentro), se separa un poco en colores y se
// ilumina con un brillo especular arriba y otro más tenue abajo.
//
// Técnica (la de kube.io/blog/liquid-glass-css-svg):
//   1. Perfil del borde: "squircle convexo" y = (1 - (1 - x)^4)^(1/4).
//   2. Con la ley de Snell (aire 1 -> cristal 1,5) se calcula cuánto se
//      desvía la luz en cada punto del borde.
//   3. Eso se guarda en un mapa de desplazamiento (R = eje X, G = eje Y,
//      128 = sin desplazar) del tamaño exacto del elemento, y otro mapa con
//      el brillo especular.
//   4. Un filtro SVG (feDisplacementMap + aberración cromática + brillo)
//      se aplica como backdrop-filter, que Chromium (Electron) sí admite.
// El tamaño del filtro tiene que coincidir con el del elemento, así que se
// regenera con un ResizeObserver (los mapas se cachean por tamaño).
(() => {
  "use strict";

  const THEME = "glass";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_FILTERS = 48;

  // Superficies con refracción. blur: desenfoque del fondo (px); bezel:
  // ancho del borde curvo (px); depth: fuerza de la lente; sat: saturación.
  const TARGETS = [
    { sel: ".topnav", blur: 1, bezel: 24, depth: 1.9, sat: 1.7 },
    { sel: ".index-bar", blur: 3, bezel: 20, depth: 1.6, sat: 1.6 },
    { sel: ".swal2-popup.sl-modal", blur: 22, bezel: 30, depth: 1, sat: 1.8 },
    { sel: ".notification", blur: 12, bezel: 16, depth: 0.9, sat: 1.7 },
    { sel: ".update-toast", blur: 16, bezel: 20, depth: 0.9, sat: 1.7 },
    { sel: ".dropdown-content", blur: 18, bezel: 16, depth: 0.9, sat: 1.7 },
    { sel: ".scroll-top-btn", blur: 2, bezel: 18, depth: 1.6, sat: 1.5 },
    { sel: ".pp-chip", blur: 2, bezel: 14, depth: 1.4, sat: 1.5 },
    { sel: ".pp-bag-btn", blur: 2, bezel: 24, depth: 1.6, sat: 1.5 },
    { sel: ".pp-feed-menu", blur: 18, bezel: 18, depth: 0.9, sat: 1.7 },
  ];

  // ------------------------------------------------------------ Óptica
  const IOR = 1.5;
  const SAMPLES = 128;
  const surface = (t) => Math.pow(1 - Math.pow(1 - t, 4), 0.25);

  // Desplazamiento (0..1) a lo largo del borde: 0 = filo, 1 = donde el
  // cristal ya es plano. Rayo vertical que entra por la superficie curva.
  const PROFILE = (() => {
    const out = new Float32Array(SAMPLES);
    const d = 0.001;
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1);
      const slope = (surface(Math.min(1, t + d)) - surface(Math.max(0, t - d))) / (2 * d);
      const incident = Math.atan(slope);
      const refracted = Math.asin(Math.sin(incident) / IOR);
      out[i] = Math.tan(incident - refracted) * surface(t);
    }
    let max = 0;
    for (const v of out) max = Math.max(max, v);
    return out.map((v) => v / (max || 1));
  })();

  // Luz arriba a la izquierda, como en iOS.
  const LIGHT = (() => {
    const l = Math.hypot(-0.55, -0.85);
    return [-0.55 / l, -0.85 / l];
  })();

  function buildMaps(w, h, r, bezel) {
    const disp = document.createElement("canvas");
    const spec = document.createElement("canvas");
    disp.width = spec.width = w;
    disp.height = spec.height = h;
    const dctx = disp.getContext("2d");
    const sctx = spec.getContext("2d");
    const D = dctx.createImageData(w, h);
    const S = sctx.createImageData(w, h);
    const dd = D.data;
    const sd = S.data;
    const hw = w / 2;
    const hh = h / 2;
    r = Math.max(0, Math.min(r, hw, hh));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const px = x + 0.5 - hw;
        const py = y + 0.5 - hh;
        const qx = Math.abs(px) - (hw - r);
        const qy = Math.abs(py) - (hh - r);
        let dist;
        let nx;
        let ny;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1;
          dist = r - len;
          nx = (qx / len) * Math.sign(px);
          ny = (qy / len) * Math.sign(py);
        } else if (qx > qy) {
          dist = r - qx;
          nx = Math.sign(px);
          ny = 0;
        } else {
          dist = r - qy;
          nx = 0;
          ny = Math.sign(py);
        }

        dd[i + 2] = 128;
        dd[i + 3] = 255;
        const t = dist / bezel;
        if (dist < 0 || t >= 1) {
          dd[i] = 128;
          dd[i + 1] = 128;
          continue;
        }
        // Se muestrea hacia dentro: el borde "estira" lo que hay detrás.
        const m = PROFILE[Math.round(t * (SAMPLES - 1))];
        dd[i] = 128 - nx * m * 127;
        dd[i + 1] = 128 - ny * m * 127;

        // Brillo especular: fino junto al filo, fuerte hacia la luz y uno
        // más tenue en el lado contrario (el doble borde de iOS).
        const facing = nx * LIGHT[0] + ny * LIGHT[1];
        const rim = Math.pow(1 - t, 7);
        const a = rim * (facing > 0 ? 0.25 + 0.75 * facing : 0.18 + 0.32 * -facing);
        sd[i] = sd[i + 1] = sd[i + 2] = 255;
        sd[i + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    dctx.putImageData(D, 0, 0);
    sctx.putImageData(S, 0, 0);
    return { disp: disp.toDataURL(), spec: spec.toDataURL() };
  }

  // ------------------------------------------------------------ Filtros SVG
  let defs = null;
  let seq = 0;
  const filters = new Map(); // clave -> id

  function ensureDefs() {
    if (defs?.isConnected) return defs;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    defs = document.createElementNS(SVG_NS, "defs");
    svg.appendChild(defs);
    document.body.appendChild(svg);
    return defs;
  }

  const el = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  function filterFor(w, h, r, cfg) {
    const key = `${w}x${h}r${Math.round(r)}|${cfg.blur}|${cfg.bezel}|${cfg.depth}|${cfg.sat}`;
    if (filters.has(key)) {
      const id = filters.get(key);
      filters.delete(key); // al final: recién usado
      filters.set(key, id);
      return id;
    }
    const bezel = Math.max(4, Math.min(cfg.bezel, w / 2, h / 2));
    const maps = buildMaps(w, h, r, bezel);
    const id = `lg-${++seq}`;
    const scale = bezel * cfg.depth;
    const f = el("filter", {
      id,
      x: 0,
      y: 0,
      width: w,
      height: h,
      filterUnits: "userSpaceOnUse",
      primitiveUnits: "userSpaceOnUse",
      "color-interpolation-filters": "sRGB",
    });
    const box = { x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none" };
    f.append(
      el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: cfg.blur, edgeMode: "duplicate", result: "blur" }),
      el("feImage", { href: maps.disp, ...box, result: "map" }),
      // Aberración cromática: cada canal se dobla un poco distinto.
      el("feDisplacementMap", { in: "blur", in2: "map", scale: scale * 1.08, xChannelSelector: "R", yChannelSelector: "G", result: "dr" }),
      el("feColorMatrix", { in: "dr", type: "matrix", values: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", result: "r" }),
      el("feDisplacementMap", { in: "blur", in2: "map", scale, xChannelSelector: "R", yChannelSelector: "G", result: "dg" }),
      el("feColorMatrix", { in: "dg", type: "matrix", values: "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0", result: "g" }),
      el("feDisplacementMap", { in: "blur", in2: "map", scale: scale * 0.92, xChannelSelector: "R", yChannelSelector: "G", result: "db" }),
      el("feColorMatrix", { in: "db", type: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0", result: "b" }),
      el("feComposite", { in: "r", in2: "g", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "rg" }),
      el("feComposite", { in: "rg", in2: "b", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "rgb" }),
      el("feColorMatrix", { in: "rgb", type: "saturate", values: cfg.sat, result: "sat" }),
      el("feImage", { href: maps.spec, ...box, result: "spec" }),
      el("feComposite", { in: "spec", in2: "sat", operator: "over" })
    );
    ensureDefs().appendChild(f);
    filters.set(key, id);
    evict();
    return id;
  }

  // Se borran los filtros más antiguos que ya no usa nadie.
  function evict() {
    if (filters.size <= MAX_FILTERS) return;
    const inUse = new Set([...tracked.values()].map((t) => t.id));
    for (const [key, id] of filters) {
      if (filters.size <= MAX_FILTERS) break;
      if (inUse.has(id)) continue;
      filters.delete(key);
      defs?.querySelector(`#${id}`)?.remove();
    }
  }

  // ------------------------------------------------------------ Seguimiento
  const tracked = new Map(); // elemento -> { cfg, id }
  const pending = new Set();
  let raf = 0;
  let active = false;

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) pending.add(e.target);
    schedule();
  });

  function schedule() {
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function flush() {
    raf = 0;
    for (const node of pending) apply(node);
    pending.clear();
  }

  function apply(node) {
    const info = tracked.get(node);
    if (!info || !active) return;
    if (!node.isConnected) return forget(node);
    const w = Math.round(node.offsetWidth);
    const h = Math.round(node.offsetHeight);
    if (w < 8 || h < 8) return;
    const cs = getComputedStyle(node);
    const r = parseFloat(cs.borderTopLeftRadius) || 0;
    const id = filterFor(w, h, r, info.cfg);
    if (info.id === id) return;
    info.id = id;
    node.style.setProperty("backdrop-filter", `url(#${id})`);
    node.classList.add("lg-refract");
  }

  function forget(node) {
    ro.unobserve(node);
    tracked.delete(node);
    node.style.removeProperty("backdrop-filter");
    node.classList.remove("lg-refract");
  }

  function scan() {
    if (!active) return;
    for (const node of [...tracked.keys()]) if (!node.isConnected) forget(node);
    for (const cfg of TARGETS) {
      document.querySelectorAll(cfg.sel).forEach((node) => {
        if (tracked.has(node)) return;
        tracked.set(node, { cfg, id: null });
        ro.observe(node);
        pending.add(node);
      });
    }
    schedule();
    placeIndicator();
  }

  let scanQueued = false;
  const mo = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  });

  const navMo = new MutationObserver((records) => {
    // Ignora los cambios del propio indicador (is-moving).
    if (records.some((r) => r.target.classList?.contains("topnav-item"))) placeIndicator();
  });

  // ------------------------------------------------------------ Barra de pestañas
  // Como la tab bar de iOS 26: una cápsula de cristal que se desliza (con
  // rebote) hasta la pestaña activa y se estira un poco mientras se mueve.
  let indicator = null;
  let lastActive = null;

  function placeIndicator() {
    const nav = document.querySelector(".topnav");
    if (!nav) return;
    if (!indicator || !indicator.isConnected) {
      indicator = document.createElement("span");
      indicator.className = "lg-tab-indicator";
      nav.prepend(indicator);
      nav.classList.add("lg-has-indicator");
      lastActive = null;
    }
    const item = nav.querySelector(".topnav-item.active");
    if (!item) {
      indicator.style.opacity = "0";
      return;
    }
    if (lastActive && lastActive !== item) {
      indicator.classList.remove("is-moving");
      void indicator.offsetWidth;
      indicator.classList.add("is-moving");
    }
    lastActive = item;
    indicator.style.opacity = "1";
    indicator.style.width = `${item.offsetWidth}px`;
    indicator.style.height = `${item.offsetHeight}px`;
    indicator.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
  }

  // ------------------------------------------------------------ Luz al tocar
  // El cristal interactivo de iOS se ilumina donde está el dedo; aquí, donde
  // está el ratón (lo pinta el CSS con --lg-x / --lg-y).
  const GLOW_SEL = ".sl-btn, button, .topnav-item, .game-card, .pp-ov-row, .pp-slot, .pp-visit, .theme-swatch";
  function onPointer(e) {
    if (!active) return;
    const t = e.target.closest?.(GLOW_SEL);
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty("--lg-x", `${e.clientX - r.left}px`);
    t.style.setProperty("--lg-y", `${e.clientY - r.top}px`);
  }

  // ------------------------------------------------------------ Activar / desactivar
  function setActive(on) {
    if (on === active) return;
    active = on;
    if (on) {
      // Solo altas/bajas de nodos (los cambios de clase del parque irían a
      // cada frame); la pestaña activa se vigila aparte.
      mo.observe(document.body, { childList: true, subtree: true });
      const nav = document.querySelector(".topnav");
      if (nav) navMo.observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
      document.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("resize", placeIndicator);
      scan();
      // Las fuentes cambian el ancho de las pestañas al cargar.
      document.fonts?.ready.then(() => active && placeIndicator());
    } else {
      mo.disconnect();
      navMo.disconnect();
      document.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", placeIndicator);
      for (const node of [...tracked.keys()]) forget(node);
      indicator?.parentElement?.classList.remove("lg-has-indicator");
      indicator?.remove();
      indicator = null;
    }
  }

  const sync = () => setActive(document.documentElement.getAttribute("data-theme") === THEME);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
})();
