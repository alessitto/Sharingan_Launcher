// =====================================================================
// Liquid Glass (estilo "glass", va encima de cualquier color)
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
//   4. Un filtro SVG (feDisplacementMap + brillo) se aplica como
//      backdrop-filter, que Chromium (Electron) sí admite.
// Rendimiento: el filtro se recalcula cada vez que cambia lo de detrás,
// así que solo va en superficies pequeñas o fijas (barra, índice, botón de
// subir, controles de Spotify) y con una sola pasada (sin aberración
// cromática, que la triplicaba).
//
// Además (3.7.2): pestaña líquida con forma de gota, borde de desplazamiento
// progresivo bajo la barra, luz que sigue al ratón en la barra y las
// ventanas, y sin refracción si Windows tiene quitada la transparencia
// (data-reduce-transparency, lo pone index.html con lo que dice main).
// Lo que se mueve o va encima de cosas animadas (modales, avisos, menús,
// el PokéPark) usa el desenfoque normal del CSS, que es mucho más barato.
// El tamaño del filtro tiene que coincidir con el del elemento, así que se
// regenera con un ResizeObserver (los mapas se cachean por tamaño).
(() => {
  "use strict";

  const THEME = "glass";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_FILTERS = 48;

  // Superficies con refracción. blur: desenfoque del fondo (px); bezel:
  // ancho del borde curvo (px); depth: fuerza de la lente; sat: saturación.
  // En Spotify el fondo es la carátula desenfocada y quieta: es donde mejor
  // luce la lente (buscador, controles, dispositivo y botones de arriba).
  const TARGETS = [
    { sel: ".topnav", blur: 1, bezel: 24, depth: 1.9, sat: 1.7 },
    { sel: ".index-bar", blur: 3, bezel: 20, depth: 1.6, sat: 1.6 },
    { sel: ".scroll-top-btn", blur: 2, bezel: 18, depth: 1.6, sat: 1.5 },
    { sel: ".sp-full .sp-search", blur: 2, bezel: 18, depth: 1.7, sat: 1.6 },
    { sel: ".sp-full .sp-controls .sp-ctl", blur: 2, bezel: 16, depth: 1.8, sat: 1.6 },
    { sel: ".sp-full .sp-play", blur: 2, bezel: 22, depth: 1.8, sat: 1.5 },
    { sel: ".sp-full .sp-device-btn", blur: 2, bezel: 16, depth: 1.6, sat: 1.6 },
    { sel: ".sp-full .sp-icon-btn", blur: 2, bezel: 14, depth: 1.6, sat: 1.6 },
    { sel: ".sp-full .sp-open", blur: 2, bezel: 14, depth: 1.6, sat: 1.6 },
    { sel: ".sp-full .sp-lyrics-btn", blur: 2, bezel: 16, depth: 1.8, sat: 1.6 },
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
      el("feDisplacementMap", { in: "blur", in2: "map", scale, xChannelSelector: "R", yChannelSelector: "G", result: "disp" }),
      el("feColorMatrix", { in: "disp", type: "saturate", values: cfg.sat, result: "sat" }),
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
  let active = false; // estilo glass puesto
  let refract = false; // y con refracción (no si Windows quita la transparencia)

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
    if (!info || !refract) return;
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
    // Posiciones (leen el layout) solo si falta la cápsula o el borde; los
    // cambios de pestaña y de tamaño ya los vigilan navMo y resize.
    if (!indicator?.isConnected) placeIndicator(false);
    if (!edge?.isConnected) placeEdge();
    if (!refract) return;
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
  }

  // Los cambios del DOM llegan a ráfagas (el PokéPark repinta a menudo):
  // se busca como mucho cada 300 ms.
  let scanTimer = 0;
  const mo = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scan();
    }, 300);
  });

  const navMo = new MutationObserver((records) => {
    // Ignora los cambios del propio indicador.
    if (records.some((r) => r.target.classList?.contains("topnav-item"))) placeIndicator(true);
  });

  // ------------------------------------------------------------ Pestaña líquida
  // Como la tab bar de iOS 26: al cambiar de pestaña la cápsula no se
  // desliza sin más, se comporta como una gota. El borde de delante sale
  // primero (muelle rápido) y el de detrás lo sigue con retraso (muelle más
  // blando): se estira hacia la pestaña nueva, adelgaza mientras está
  // estirada y al llegar rebota un poco. Mientras viaja se "levanta" (más
  // luz y sombra), como el cristal de Apple al tocarlo.
  let indicator = null;
  let lastActive = null;
  let anim = null;

  // Muelle amortiguado (masa 1): 0 -> 1 con un pequeño rebote.
  function spring(t, k, c) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k);
    const z = c / (2 * w0);
    if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }

  function itemBox(item) {
    return { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight };
  }

  let lastBox = "";
  function setBox(b) {
    const key = `${b.x}|${b.y}|${b.w}|${b.h}`;
    if (key === lastBox) return; // sin cambios: no se toca el estilo
    lastBox = key;
    indicator.style.width = `${b.w}px`;
    indicator.style.height = `${b.h}px`;
    indicator.style.transform = `translate(${b.x}px, ${b.y}px)`;
  }

  // Dónde se ve ahora la cápsula (también a mitad de una animación).
  function currentBox(nav) {
    const r = indicator.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    const h = indicator.offsetHeight;
    return { x: r.left - n.left - nav.clientLeft, y: r.top - n.top - nav.clientTop + (r.height - h) / 2, w: r.width, h };
  }

  function droplet(from, to) {
    anim?.cancel();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    lastBox = "";
    setBox(to);
    if (reduce) return;
    const dir = to.x + to.w / 2 >= from.x + from.w / 2 ? 1 : -1;
    const L0 = from.x;
    const R0 = from.x + from.w;
    const L1 = to.x;
    const R1 = to.x + to.w;
    // Delante: rápido y con rebote. Detrás: más blando y un poco después.
    const lead = (t) => spring(t, 300, 24);
    const trail = (t) => spring(t - 0.055, 170, 21);
    const pL = dir > 0 ? trail : lead;
    const pR = dir > 0 ? lead : trail;
    const DUR = 0.72;
    const frames = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * DUR;
      const L = L0 + (L1 - L0) * pL(t);
      const R = R0 + (R1 - R0) * pR(t);
      const w = Math.max(8, R - L);
      const stretch = w / Math.max(1, to.w) - 1;
      // Estirada adelgaza (gota); al llegar recupera su alto.
      const sy = 1 - Math.max(-0.04, Math.min(0.14, stretch * 0.2));
      const h = from.h + (to.h - from.h) * Math.min(1, t / 0.3);
      const y = from.y + (to.y - from.y) * Math.min(1, t / 0.3);
      frames.push({ width: `${w}px`, height: `${h}px`, transform: `translate(${L}px, ${y}px) scaleY(${sy.toFixed(4)})` });
    }
    indicator.classList.add("is-lifted");
    anim = indicator.animate(frames, { duration: DUR * 1000, easing: "linear" });
    const done = () => {
      indicator?.classList.remove("is-lifted");
      anim = null;
      placeIndicator(false);
    };
    anim.onfinish = done;
    anim.oncancel = () => indicator?.classList.remove("is-lifted");
  }

  function placeIndicator(animate) {
    if (!active) return;
    const nav = document.querySelector(".topnav");
    if (!nav) return;
    if (!indicator || !indicator.isConnected) {
      indicator = document.createElement("span");
      indicator.className = "lg-tab-indicator";
      lastBox = "";
      nav.prepend(indicator);
      nav.classList.add("lg-has-indicator");
      lastActive = null;
    }
    const item = nav.querySelector(".topnav-item.active");
    if (!item) {
      indicator.style.opacity = "0";
      lastActive = null;
      return;
    }
    const to = itemBox(item);
    const changed = lastActive && lastActive !== item;
    indicator.style.opacity = "1";
    if (changed && animate) {
      const from = currentBox(nav);
      lastActive = item;
      return droplet(from, to);
    }
    lastActive = item;
    if (anim) return; // al acabar se recoloca
    setBox(to);
  }

  // Las pestañas despliegan su nombre al pasar el ratón y mueven a las de al
  // lado: la cápsula las sigue durante la animación (unos 400 ms).
  let followUntil = 0;
  function followTabs() {
    const running = performance.now() < followUntil;
    followUntil = performance.now() + 450;
    if (running) return;
    const step = () => {
      placeIndicator(false);
      if (performance.now() < followUntil) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ Borde de desplazamiento
  // Como en iOS 26: lo que pasa por debajo de la barra flotante no se corta
  // en seco, se va desenfocando poco a poco (tres capas de desenfoque con
  // máscaras escalonadas) y se tiñe con el fondo. Solo aparece al bajar.
  let edge = null;
  let scroller = null;

  function placeEdge() {
    const appEl = document.querySelector(".app");
    const main = document.querySelector(".main-content");
    const nav = document.querySelector(".topnav");
    if (!appEl || !main || !nav) return;
    if (!edge || !edge.isConnected) {
      edge = document.createElement("div");
      edge.className = "lg-scroll-edge";
      edge.setAttribute("aria-hidden", "true");
      edge.innerHTML = '<i class="lg-se lg-se-2"></i><i class="lg-se lg-se-3"></i><i class="lg-se-tint"></i>';
      appEl.appendChild(edge);
      edgeOpacity = -1;
    }
    if (scroller !== main) {
      scroller?.removeEventListener("scroll", onScroll);
      scroller = main;
      main.addEventListener("scroll", onScroll, { passive: true });
    }
    edge.style.left = `${main.offsetLeft}px`;
    edge.style.top = `${main.offsetTop}px`;
    edge.style.width = `${main.clientWidth}px`;
    edge.style.height = `${nav.offsetTop + nav.offsetHeight + 46}px`;
    onScroll();
  }

  // Arriba del todo el borde se oculta del todo (visibility): así sus
  // desenfoques no se calculan mientras no se ven.
  let edgeOpacity = -1;
  function onScroll() {
    if (!edge || !scroller) return;
    const o = Math.round(Math.min(1, scroller.scrollTop / 40) * 20) / 20;
    if (o === edgeOpacity) return;
    edgeOpacity = o;
    edge.style.opacity = String(o);
    edge.style.visibility = o > 0 ? "" : "hidden";
  }

  // ------------------------------------------------------------ Luz al pasar el ratón
  // El cristal de Apple se ilumina donde está el dedo; aquí, donde está el
  // ratón. Los botones y tarjetas (como antes), la barra de arriba y las
  // ventanas: un brillo suave dentro y el filo más claro cerca del puntero
  // (lo pinta el CSS con --lg-x / --lg-y).
  const GLOW_SEL = ".sl-btn, button, .topnav-item, .game-card, .pp-ov-row, .pp-slot, .pp-visit, .theme-swatch, .fg-card, .tp-effect";
  const SURFACE_SEL = ".topnav, .swal2-popup.sl-modal, .sp-full .sp-search, .pp-dock, .index-bar";
  let lastPointer = null;
  let pointerRaf = 0;
  let lastX = -99;
  let lastY = -99;
  function onPointer(e) {
    if (!active) return;
    // Movimientos de menos de 3 px no cambian la luz a la vista.
    if (Math.abs(e.clientX - lastX) < 3 && Math.abs(e.clientY - lastY) < 3) return;
    lastX = e.clientX;
    lastY = e.clientY;
    lastPointer = e;
    if (!pointerRaf) pointerRaf = requestAnimationFrame(paintGlow);
  }
  // Cambiar una variable en un elemento recalcula los estilos de todo lo
  // que tiene dentro (en una ventana, mucho): solo si el valor cambia.
  const setLight = (node, e) => {
    if (!node) return;
    const r = node.getBoundingClientRect();
    const x = `${Math.round(e.clientX - r.left)}px`;
    const y = `${Math.round(e.clientY - r.top)}px`;
    if (node.__lgX === x && node.__lgY === y) return;
    node.__lgX = x;
    node.__lgY = y;
    node.style.setProperty("--lg-x", x);
    node.style.setProperty("--lg-y", y);
  };
  function paintGlow() {
    pointerRaf = 0;
    const e = lastPointer;
    const t = e?.target;
    if (!t?.closest) return;
    setLight(t.closest(GLOW_SEL), e);
    setLight(t.closest(SURFACE_SEL), e);
  }

  // ------------------------------------------------------------ Activar / desactivar
  const reducedTransparency = () => document.documentElement.getAttribute("data-reduce-transparency") === "1";

  function setRefract(on) {
    if (on === refract) return;
    refract = on;
    if (!on) for (const node of [...tracked.keys()]) forget(node);
    else scan();
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    const nav = document.querySelector(".topnav");
    if (on) {
      // Solo altas/bajas de nodos (los cambios de clase del parque irían a
      // cada frame); la pestaña activa se vigila aparte.
      mo.observe(document.body, { childList: true, subtree: true });
      if (nav) navMo.observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
      nav?.addEventListener("pointerover", followTabs);
      nav?.addEventListener("pointerout", followTabs);
      document.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("resize", onResize);
      scan();
      // Las fuentes cambian el ancho de las pestañas al cargar.
      document.fonts?.ready.then(() => active && placeIndicator(false));
    } else {
      mo.disconnect();
      clearTimeout(scanTimer);
      scanTimer = 0;
      navMo.disconnect();
      nav?.removeEventListener("pointerover", followTabs);
      nav?.removeEventListener("pointerout", followTabs);
      document.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      setRefract(false);
      anim?.cancel();
      anim = null;
      indicator?.parentElement?.classList.remove("lg-has-indicator");
      indicator?.remove();
      indicator = null;
      scroller?.removeEventListener("scroll", onScroll);
      scroller = null;
      edge?.remove();
      edge = null;
    }
  }

  function onResize() {
    placeIndicator(false);
    placeEdge();
  }

  const sync = () => {
    const on = document.documentElement.getAttribute("data-effect") === THEME;
    setActive(on);
    setRefract(on && !reducedTransparency());
  };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-effect", "data-reduce-transparency"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
})();
