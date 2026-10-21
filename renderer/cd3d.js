// =====================================================================
// CD en 3D para la vista "CD" de Spotify (three.js, vendor/three)
// =====================================================================
// Un disco de verdad con material físico (MeshPhysicalMaterial): la carátula
// se imprime con sus colores reales; las zonas claras y poco saturadas pasan
// a metal holográfico (iridiscencia de capa fina), los colores vivos quedan
// como tinta, y todo va bajo un barniz brillante con purpurina fina debajo. El aro sin imprimir es
// espejo iridiscente, el centro y el canto son plástico transparente y por
// detrás se ve la impresión a través del plástico. La luz sale de un estudio
// (mapa de entorno dibujado aquí) y el disco se mece adelante y atrás para
// que el brillo cambie; mientras suena, además gira.
//
// window.CD3D.create(contenedor, { active, onLost }) → Promise<controlador | null>
//   controlador.setCover(url) → Promise<boolean>  (false solo si la imagen no
//     deja leerse por CORS; sin carátula o si no carga, CD plateado y se
//     reintenta con el siguiente setCover)
//   controlador.setPlaying(bool), lost(), destroy()
//   onLost: se ha perdido WebGL (Windows lo puede soltar con la ventana en
//     segundo plano); quien llama monta otro.
// null si no hay WebGL o no carga three: quien llama pone el CD de siempre.
(() => {
  "use strict";

  let threeJob = null;
  const loadThree = () => (threeJob ||= import("../vendor/three/three.module.min.js"));

  const S = 1024; // lado de las texturas del disco
  const HOLE = 0.125; // agujero de 15 mm en 120 mm
  const HUB = 0.19; // hasta aquí, plástico transparente
  const BAND = 0.33; // aro de espejo sin imprimir
  const RIM = 0.985; // canto sin imprimir
  const T = 0.024; // grosor (1,2 mm en 120 mm, un pelín exagerado)
  const TURN = 6; // segundos por vuelta mientras suena

  const smooth = (a, b, v) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const canvas2d = (w, h = w) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };

  const loadImage = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETRY_MS = [0, 1500, 4000]; // si la carátula no carga (red), se reintenta

  // Sin carátula (o sin poder cargarla): disco plateado.
  const blankPrint = () => {
    const c = canvas2d(8);
    const g = c.getContext("2d");
    g.fillStyle = "#d4d8de";
    g.fillRect(0, 0, 8, 8);
    return c;
  };

  // Estudio: degradado con cajas de luz (dos neutras, una cálida y una fría)
  // para que el barniz y el holograma tengan qué reflejar.
  function studioCanvas() {
    const c = canvas2d(1024, 512);
    const g = c.getContext("2d");
    const sky = g.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, "#cfd4dc");
    sky.addColorStop(0.45, "#6f747d");
    sky.addColorStop(1, "#24262b");
    g.fillStyle = sky;
    g.fillRect(0, 0, 1024, 512);
    const box = (x, y, w, h, color, blur) => {
      g.save();
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
      g.restore();
    };
    // geles de colores grandes y suaves (dan vida al holograma)
    box(40, 40, 260, 160, "#ffc3e6", 90);
    box(560, 330, 300, 120, "#bfeeff", 90);
    box(330, 30, 180, 120, "#fff2b3", 80);
    box(150, 120, 120, 150, "#ffffff", 40);
    box(470, 80, 220, 70, "#ffffff", 30);
    box(800, 150, 70, 170, "#fff1dc", 36);
    box(330, 300, 160, 40, "#d6ecff", 30);
    box(640, 260, 90, 90, "#ffe0f0", 30);
    box(0, 200, 40, 120, "#ffffff", 20);
    box(990, 200, 34, 120, "#ffffff", 20);
    return c;
  }

  // Patrón del grosor de la capa iridiscente: bandas en espiral suave, como
  // la difracción de un CD, para que el arcoíris varíe por el disco.
  function thicknessCanvas() {
    const n = 256;
    const c = canvas2d(n);
    const g = c.getContext("2d");
    const im = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x + 0.5) / n * 2 - 1;
        const dy = (y + 0.5) / n * 2 - 1;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const v = 0.5 + 0.28 * Math.sin(a * 3 + r * 14) + 0.17 * Math.sin(r * 46) + 0.05 * Math.sin(a * 9);
        const p = (y * n + x) * 4;
        im.data[p] = im.data[p + 1] = im.data[p + 2] = Math.max(0, Math.min(255, v * 255));
        im.data[p + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  // Purpurina: mapa de normales con escamas finas inclinadas al azar bajo el
  // barniz; al moverse el disco, cada escama coge la luz en un momento
  // distinto y destella. Se dibuja una vez (semilla fija) y se reutiliza.
  let flakes = null;
  function flakesCanvas() {
    if (flakes) return flakes;
    let seed = 1234567;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = 1024;
    const c = canvas2d(n);
    const g = c.getContext("2d");
    g.fillStyle = "rgb(128,128,255)";
    g.fillRect(0, 0, n, n);
    for (let k = 0; k < 26000; k++) {
      const x = rand() * n;
      const y = rand() * n;
      const size = 1.5 + rand() * 3.2;
      const nx = (rand() - 0.5) * 1.5;
      const ny = (rand() - 0.5) * 1.5;
      const l = Math.hypot(nx, ny, 1);
      g.fillStyle = `rgb(${((nx / l) * 0.5 + 0.5) * 255 | 0},${((ny / l) * 0.5 + 0.5) * 255 | 0},${((1 / l) * 0.5 + 0.5) * 255 | 0})`;
      g.save();
      g.translate(x, y);
      g.rotate(rand() * Math.PI);
      g.fillRect(-size / 2, -size / 2, size, size * (0.6 + rand() * 0.6));
      g.restore();
    }
    return (flakes = c);
  }

  // Dónde hay escama (1) y dónde no (0), al tamaño de las texturas
  let flakeMask = null;
  function flakesMask() {
    if (flakeMask) return flakeMask;
    const d = flakesCanvas().getContext("2d").getImageData(0, 0, S, S).data;
    flakeMask = new Uint8Array(S * S);
    for (let i = 0, q = 0; i < S * S; i++, q += 4) flakeMask[i] = d[q] !== 128 || d[q + 1] !== 128 ? 1 : 0;
    return flakeMask;
  }

  // Piel de naranja del barniz: relieve muy suave y ancho (mapa de normales)
  function peelCanvas() {
    const n = 512;
    const cell = 9;
    let seed = 7654321;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const gw = Math.ceil(n / cell) + 1;
    const grid = Array.from({ length: gw * gw }, rand);
    const h = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const fx = x / cell;
        const fy = y / cell;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(0, 1, fx - x0);
        const ty = smooth(0, 1, fy - y0);
        const v = (i, j) => grid[(j % gw) * gw + (i % gw)];
        const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
        const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
        h[y * n + x] = a + (b - a) * ty;
      }
    }
    const c = canvas2d(n);
    const g = c.getContext("2d");
    const im = g.createImageData(n, n);
    const H = (x, y) => h[((y + n) % n) * n + ((x + n) % n)];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const nx = -(H(x + 1, y) - H(x - 1, y)) * 0.9;
        const ny = (H(x, y + 1) - H(x, y - 1)) * 0.9;
        const l = Math.hypot(nx, ny, 1);
        const q = (y * n + x) * 4;
        im.data[q] = (nx / l * 0.5 + 0.5) * 255;
        im.data[q + 1] = (ny / l * 0.5 + 0.5) * 255;
        im.data[q + 2] = (1 / l * 0.5 + 0.5) * 255;
        im.data[q + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  // Color y "ORM" (R = iridiscencia, G = rugosidad, B = metal) de la cara
  // impresa. Lo claro y poco saturado de la carátula va en foil; el umbral
  // se adapta a cada imagen (como mucho el ~28 % más claro) y la transición
  // es continua, así no salen recortes ni motas.
  function discMaps(img) {
    const color = canvas2d(S);
    const cg = color.getContext("2d", { willReadFrequently: true });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const k = Math.max(S / iw, S / ih);
    const dw = iw * k;
    const dh = ih * k;
    cg.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
    // Grano de impresión: cada punto un pelín más claro u oscuro (también
    // lanza si la imagen no deja leerse por CORS)
    const px = cg.getImageData(0, 0, S, S);
    let gs = 99991;
    for (let q = 0; q < px.data.length; q += 4) {
      gs = (gs * 16807) % 2147483647;
      const m = 1 + ((gs / 2147483647) - 0.5) * 0.1;
      px.data[q] *= m;
      px.data[q + 1] *= m;
      px.data[q + 2] *= m;
    }
    cg.putImageData(px, 0, 0);

    // Foil calculado a media resolución sobre una copia algo desenfocada
    const H = S / 2;
    const small = canvas2d(H);
    const sg = small.getContext("2d", { willReadFrequently: true });
    sg.filter = "blur(1px)";
    sg.drawImage(color, 0, 0, H, H);
    const sd = sg.getImageData(0, 0, H, H).data;
    const L = new Float32Array(H * H);
    const Sat = new Float32Array(H * H);
    for (let i = 0, p = 0; i < H * H; i++, p += 4) {
      const r = sd[p] / 255;
      const gr = sd[p + 1] / 255;
      const b = sd[p + 2] / 255;
      const mx = Math.max(r, gr, b);
      L[i] = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      Sat[i] = mx ? (mx - Math.min(r, gr, b)) / mx : 0;
    }
    const sorted = Float32Array.from(L).sort();
    const lo = Math.min(0.86, Math.max(0.5, sorted[Math.floor(H * H * 0.72)]));
    const hi = Math.min(0.99, lo + 0.22);

    // A tamaño completo para que las escamas de la tinta salgan nítidas:
    // cada escama es un destello metálico del color de la tinta.
    const fm = flakesMask();
    const orm = canvas2d(S);
    const og = orm.getContext("2d");
    const od = og.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p = (y * S + x) * 4;
        const i = (y >> 1) * H + (x >> 1);
        const r = Math.hypot((x + 0.5) / S * 2 - 1, (y + 0.5) / S * 2 - 1);
        let irid;
        let rough;
        let metal;
        if (r < BAND || r > RIM) {
          // espejo sin imprimir
          irid = r > RIM ? 0.6 : 1;
          rough = 0.12;
          metal = 1;
        } else {
          const f = smooth(lo, hi, L[i]) * (1 - 0.55 * Sat[i]);
          const fl = fm[y * S + x] * (1 - f);
          irid = 0.12 + 0.88 * f + 0.2 * fl;
          rough = 0.42 - 0.34 * f - 0.24 * fl;
          metal = f + 0.6 * fl;
        }
        od.data[p] = irid * 255;
        od.data[p + 1] = rough * 255;
        od.data[p + 2] = metal * 255;
        od.data[p + 3] = 255;
      }
    }
    og.putImageData(od, 0, 0);

    // En el color: el aro de espejo y el canto, plateados
    const c = S / 2;
    cg.save();
    cg.beginPath();
    cg.arc(c, c, BAND * c, 0, Math.PI * 2);
    cg.clip();
    const band = cg.createRadialGradient(c, c, HUB * c, c, c, BAND * c);
    band.addColorStop(0, "#eef1f4");
    band.addColorStop(0.45, "#c3c8cf");
    band.addColorStop(0.72, "#e9ecef");
    band.addColorStop(1, "#cdd2d8");
    cg.fillStyle = band;
    cg.fillRect(0, 0, S, S);
    // anillo de apilado
    cg.lineWidth = 3;
    cg.strokeStyle = "rgba(255,255,255,.7)";
    cg.beginPath();
    cg.arc(c, c, 0.278 * c, 0, Math.PI * 2);
    cg.stroke();
    cg.strokeStyle = "rgba(0,0,0,.18)";
    cg.beginPath();
    cg.arc(c, c, 0.286 * c, 0, Math.PI * 2);
    cg.stroke();
    cg.restore();
    // filo de la impresión y canto
    cg.lineWidth = 2;
    cg.strokeStyle = "rgba(0,0,0,.35)";
    cg.beginPath();
    cg.arc(c, c, BAND * c + 1, 0, Math.PI * 2);
    cg.stroke();
    cg.lineWidth = (1 - RIM) * c + 2;
    cg.strokeStyle = "#d9dde2";
    cg.beginPath();
    cg.arc(c, c, ((1 + RIM) / 2) * c, 0, Math.PI * 2);
    cg.stroke();
    return { color, orm };
  }

  // ---------------------------------------------------------------- Roto
  // Fractura aleatoria (Voronoi): puntos de rotura al azar por el disco y un
  // punto de impacto, también al azar, con más puntos alrededor (trozos más
  // pequeños ahí). Cada trozo es la zona más cercana a su punto, recortada al
  // disco; lo que caería dentro del centro se lleva a su borde. Un punto
  // fantasma en el centro evita que un trozo lo contenga. El centro de
  // plástico se parte por ángulos al azar.
  function shardOutlines() {
    const TAU = Math.PI * 2;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const seeds = [[0, 0]]; // fantasma: su celda (el centro) no se usa
    const ring = 5 + Math.floor(Math.random() * 3);
    const ringOff = Math.random() * TAU;
    for (let k = 0; k < ring; k++) {
      const a = ringOff + ((k + rnd(-0.3, 0.3)) * TAU) / ring;
      const r = rnd(0.25, 0.33);
      seeds.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const free = 14 + Math.floor(Math.random() * 8);
    for (let k = 0; k < free; k++) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(rnd(0.36 * 0.36, 0.97 * 0.97));
      seeds.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const ia = Math.random() * TAU;
    const ir = rnd(0.35, 0.8);
    const impact = [Math.cos(ia) * ir, Math.sin(ia) * ir];
    const near = 6 + Math.floor(Math.random() * 6);
    for (let k = 0; k < near; k++) {
      const a = Math.random() * TAU;
      const d = Math.abs(rnd(-1, 1) * rnd(0, 1)) * 0.28;
      const x = impact[0] + Math.cos(a) * d;
      const y = impact[1] + Math.sin(a) * d;
      const r = Math.hypot(x, y);
      if (r > 0.3 && r < 0.98) seeds.push([x, y]);
    }

    // Recorte de un polígono convexo por el semiplano más cercano a s que a o
    const clip = (poly, s, o) => {
      const mx = (s[0] + o[0]) / 2;
      const my = (s[1] + o[1]) / 2;
      const nx = s[0] - o[0];
      const ny = s[1] - o[1];
      const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k];
        const q = poly[(k + 1) % poly.length];
        const sp = side(p);
        const sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) {
          const t = sp / (sp - sq);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      return out;
    };
    const disc = Array.from({ length: 180 }, (_, k) => [Math.cos((k * TAU) / 180), Math.sin((k * TAU) / 180)]);

    const pieces = [];
    for (let i = 1; i < seeds.length; i++) {
      let poly = disc;
      for (let j = 0; j < seeds.length && poly.length; j++) if (j !== i) poly = clip(poly, seeds[i], seeds[j]);
      if (poly.length < 3) continue;
      // Bordes troceados y lo que cae dentro del centro, llevado a su borde
      const pts = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k];
        const q = poly[(k + 1) % poly.length];
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.02));
        for (let m = 0; m < n; m++) {
          let x = p[0] + ((q[0] - p[0]) * m) / n;
          let y = p[1] + ((q[1] - p[1]) * m) / n;
          const r = Math.hypot(x, y);
          if (r < HUB) {
            x = (x / (r || 1)) * HUB;
            y = (y / (r || 1)) * HUB;
          }
          const last = pts[pts.length - 1];
          if (!last || Math.hypot(last[0] - x, last[1] - y) > 1e-4) pts.push([x, y]);
        }
      }
      if (pts.length >= 3) pieces.push({ hub: false, pts });
    }

    // Centro de plástico: 3 o 4 trozos por ángulos al azar
    const cutsN = 3 + Math.floor(Math.random() * 2);
    const hubOff = Math.random() * TAU;
    const hubCuts = Array.from({ length: cutsN }, (_, k) => hubOff + ((k + rnd(-0.3, 0.3)) * TAU) / cutsN);
    hubCuts.push(hubCuts[0] + TAU);
    const arcPts = (r, from, to) => {
      const n = Math.max(3, Math.ceil(Math.abs(to - from) * 14));
      return Array.from({ length: n + 1 }, (_, k) => {
        const a = from + ((to - from) * k) / n;
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
    };
    for (let h = 0; h < cutsN; h++) {
      pieces.push({ hub: true, pts: [...arcPts(HOLE, hubCuts[h], hubCuts[h + 1]), ...arcPts(HUB, hubCuts[h + 1], hubCuts[h])] });
    }
    return pieces;
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  async function create(container, { active = () => true, onLost = null } = {}) {
    let THREE;
    try {
      THREE = await loadThree();
    } catch (err) {
      console.warn("cd3d: no carga three", err);
      return null;
    }
    if (!container.isConnected) return null;

    const canvas = document.createElement("canvas");
    canvas.className = "sp-cd3d-canvas";
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "default" });
    } catch (err) {
      console.warn("cd3d: sin WebGL", err);
      return null;
    }
    container.appendChild(canvas);
    let lost = false;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      if (destroyed || lost) return;
      lost = true;
      onLost?.();
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, 4.05);

    const disposables = [];
    const keep = (x) => (disposables.push(x), x);

    // Entorno del estudio
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studioTex = new THREE.CanvasTexture(studioCanvas());
    studioTex.mapping = THREE.EquirectangularReflectionMapping;
    studioTex.colorSpace = THREE.SRGBColorSpace;
    const env = keep(pmrem.fromEquirectangular(studioTex).texture);
    studioTex.dispose();
    pmrem.dispose();
    scene.environment = env;

    const thick = keep(new THREE.CanvasTexture(thicknessCanvas()));
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const glitter = keep(new THREE.CanvasTexture(flakesCanvas()));
    glitter.anisotropy = aniso;
    const peel = keep(new THREE.CanvasTexture(peelCanvas()));

    // Materiales
    const front = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 1,
        clearcoat: 0.75,
        clearcoatRoughness: 0.06,
        iridescence: 1,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [100, 1000],
        iridescenceThicknessMap: thick,
        envMapIntensity: 1.25,
        // algo de luz propia: la carátula se ve fiel aunque cambie la luz
        emissive: 0xffffff,
        emissiveIntensity: 0.18,
        // purpurina bajo el barniz, y el barniz con algo de piel de naranja
        normalMap: glitter,
        normalScale: new THREE.Vector2(0.75, 0.75),
        clearcoatNormalMap: peel,
        clearcoatNormalScale: new THREE.Vector2(0.2, 0.2),
      })
    );
    // Difracción del foil: arcoíris según la dirección del reflejo (cambia al
    // inclinarse y las formas pasan por él al girar). Solo donde hay foil
    // (el mapa de iridiscencia) y el aro de espejo.
    front.customProgramCacheKey = () => "cd3d-front";
    front.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
        #ifdef USE_IRIDESCENCE
        {
          #ifdef USE_MAP
            vec2 hp = vMapUv * 2.0 - 1.0;
          #else
            vec2 hp = vec2(0.0);
          #endif
          vec3 hv = normalize( vViewPosition );
          vec3 hr = reflect( -hv, normalize( normal ) );
          float phase = hr.x * 1.7 + hr.y * 1.2 + length( hp ) * 1.4;
          vec3 rainbow = 0.5 + 0.5 * cos( 6.28318 * ( phase + vec3( 0.0, 0.33, 0.67 ) ) );
          float foil = smoothstep( 0.3, 1.0, material.iridescence );
          float lumo = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
          outgoingLight = mix( outgoingLight, rainbow * ( 0.45 + 0.75 * lumo ) + outgoingLight * 0.35, foil * 0.6 );
        }
        #endif
        #include <opaque_fragment>`
      );
    };
    const back = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xcfd3d8,
        metalness: 0.15,
        roughness: 0.3,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        iridescence: 0.45,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [200, 600],
        iridescenceThicknessMap: thick,
        side: THREE.BackSide,
        envMapIntensity: 1.1,
      })
    );
    // Cara de atrás de los trozos: sus triángulos ya miran hacia atrás
    const backShard = keep(back.clone());
    backShard.side = THREE.FrontSide;
    const plastic = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        iridescence: 0.4,
        iridescenceThicknessRange: [200, 500],
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
        envMapIntensity: 1.4,
      })
    );
    const edge = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xe6ebf0,
        metalness: 0.2,
        roughness: 0.12,
        clearcoat: 1,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );

    // Disco: cara impresa, cara de atrás, centro transparente y cantos
    const disc = new THREE.Group();
    const faceGeo = keep(new THREE.RingGeometry(HUB, 1, 160, 1));
    const frontMesh = new THREE.Mesh(faceGeo, front);
    frontMesh.position.z = T / 2;
    const backMesh = new THREE.Mesh(faceGeo, back);
    backMesh.position.z = -T / 2;
    const hubGeo = keep(new THREE.RingGeometry(HOLE, HUB, 96, 1));
    const hubFront = new THREE.Mesh(hubGeo, plastic);
    hubFront.position.z = T / 2;
    const hubBack = new THREE.Mesh(hubGeo, plastic);
    hubBack.position.z = -T / 2;
    const outerGeo = keep(new THREE.CylinderGeometry(1, 1, T, 160, 1, true));
    outerGeo.rotateX(Math.PI / 2);
    const innerGeo = keep(new THREE.CylinderGeometry(HOLE, HOLE, T, 64, 1, true));
    innerGeo.rotateX(Math.PI / 2);
    const whole = new THREE.Group();
    whole.add(frontMesh, backMesh, hubFront, hubBack, new THREE.Mesh(outerGeo, edge), new THREE.Mesh(innerGeo, edge));
    disc.add(whole);
    hubFront.renderOrder = hubBack.renderOrder = 2;

    // Un trozo: prisma con cara impresa (grupo 0), cara de atrás (1) y
    // cantos (2), centrado en su centro para girar sobre sí mismo. La UV es
    // la de su sitio en el disco, así la carátula sigue en su lugar.
    function shardGeometry(pts) {
      let cx = 0;
      let cy = 0;
      for (const [x, y] of pts) {
        cx += x;
        cy += y;
      }
      cx /= pts.length;
      cy /= pts.length;
      let contour = pts.map(([x, y]) => new THREE.Vector2(x, y));
      if (THREE.ShapeUtils.isClockWise(contour)) contour = contour.reverse();
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const pos = [];
      const uv = [];
      const nor = [];
      const put = (v, z, nx, ny, nz) => {
        pos.push(v.x - cx, v.y - cy, z);
        uv.push(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
        nor.push(nx, ny, nz);
      };
      for (const [a, b, c] of tris) for (const k of [a, b, c]) put(contour[k], T / 2, 0, 0, 1);
      const nFront = pos.length / 3;
      for (const [a, b, c] of tris) for (const k of [c, b, a]) put(contour[k], -T / 2, 0, 0, -1);
      const nBack = pos.length / 3 - nFront;
      for (let k = 0; k < contour.length; k++) {
        const p = contour[k];
        const q = contour[(k + 1) % contour.length];
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const nx = (q.y - p.y) / len;
        const ny = -(q.x - p.x) / len;
        put(p, T / 2, nx, ny, 0);
        put(p, -T / 2, nx, ny, 0);
        put(q, -T / 2, nx, ny, 0);
        put(p, T / 2, nx, ny, 0);
        put(q, -T / 2, nx, ny, 0);
        put(q, T / 2, nx, ny, 0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.addGroup(0, nFront, 0);
      g.addGroup(nFront, nBack, 1);
      g.addGroup(nFront + nBack, pos.length / 3 - nFront - nBack, 2);
      return { g, cx, cy };
    }

    // Estado de roto: los trozos salen despedidos hacia fuera, se quedan
    // separados flotando y, al recomponer, vuelven a su sitio.
    let shards = null; // [{ mesh, home, dx, dy, dz, rx, ry, rz, phase }]
    let broken = false;
    let anim = null; // { from, to, t, dur, value }
    let charging = 0; // desde cuándo se mantiene pulsado (0 = no)

    function buildShards() {
      const group = new THREE.Group();
      shards = shardOutlines().map(({ pts, hub }) => {
        const { g, cx, cy } = shardGeometry(pts);
        const mesh = new THREE.Mesh(g, hub ? [plastic, plastic, edge] : [front, backShard, edge]);
        if (hub) mesh.renderOrder = 2;
        mesh.position.set(cx, cy, 0);
        group.add(mesh);
        const r = Math.hypot(cx, cy) || 1;
        const dist = (hub ? 0.02 : 0.035) + Math.random() * (hub ? 0.04 : 0.09) + 0.05 * r;
        return {
          mesh,
          home: new THREE.Vector3(cx, cy, 0),
          dx: (cx / r) * dist,
          dy: (cy / r) * dist,
          dz: (Math.random() - 0.5) * 0.4,
          rx: (Math.random() - 0.5) * 0.9,
          ry: (Math.random() - 0.5) * 0.9,
          rz: (Math.random() - 0.5) * 0.5,
          phase: Math.random() * Math.PI * 2,
        };
      });
      shards.group = group;
      disc.add(group);
    }

    function dropShards() {
      if (!shards) return;
      disc.remove(shards.group);
      for (const sh of shards) sh.mesh.geometry.dispose();
      shards = null;
    }

    function placeShards(p, time) {
      disc.scale.setScalar(1 - 0.17 * p);
      for (const sh of shards) {
        const bob = p * 0.012 * Math.sin(time * 1.3 + sh.phase);
        sh.mesh.position.set(sh.home.x + sh.dx * p, sh.home.y + sh.dy * p, sh.dz * p + bob);
        sh.mesh.rotation.set(sh.rx * p + bob * 2, sh.ry * p - bob * 2, sh.rz * p);
      }
    }

    function setBroken(on, instant = false) {
      on = !!on;
      if (on === broken && !anim) return;
      broken = on;
      const current = anim ? anim.value : on ? 0 : 1;
      if (on && !shards) buildShards();
      whole.visible = false;
      if (instant) {
        anim = null;
        if (on) placeShards(1, clock);
        else {
          dropShards();
          disc.scale.setScalar(1);
          whole.visible = true;
        }
        return;
      }
      anim = { from: current, to: on ? 1 : 0, t: 0, dur: on ? 0.85 : 0.75, value: current };
    }

    const tilt = new THREE.Group();
    tilt.add(disc);
    scene.add(tilt);

    // Texturas de la carátula
    let maps = null;
    let coverUrl; // la pedida
    let shown; // la que está puesta (null = plateado)
    let job = null;
    function setCover(url) {
      url = url || null;
      if (url === coverUrl && job) return job; // ya está en camino
      if (url === coverUrl && url === shown) return Promise.resolve(true);
      coverUrl = url;
      const p = (job = applyCover(url).finally(() => job === p && (job = null)));
      return p;
    }
    async function applyCover(url) {
      let img = null;
      for (let i = 0; url && !img && i < RETRY_MS.length; i++) {
        if (RETRY_MS[i]) await wait(RETRY_MS[i]);
        if (coverUrl !== url || destroyed) return true;
        img = await loadImage(url);
        if (coverUrl !== url || destroyed) return true;
      }
      // Sin carátula o no ha cargado: plateado (shown = null, así el próximo
      // setCover con esa url lo vuelve a intentar).
      const got = !!img;
      if (!img) img = blankPrint();
      let m;
      try {
        m = discMaps(img);
      } catch {
        return false;
      }
      const colorTex = new THREE.CanvasTexture(m.color);
      colorTex.colorSpace = THREE.SRGBColorSpace;
      colorTex.anisotropy = aniso;
      const ormTex = new THREE.CanvasTexture(m.orm);
      ormTex.anisotropy = aniso;
      if (maps) {
        maps.colorTex.dispose();
        maps.ormTex.dispose();
      }
      maps = { colorTex, ormTex };
      Object.assign(front, { map: colorTex, emissiveMap: colorTex, metalnessMap: ormTex, roughnessMap: ormTex, iridescenceMap: ormTex });
      back.map = backShard.map = colorTex;
      front.needsUpdate = back.needsUpdate = backShard.needsUpdate = true;
      shown = got ? url : null;
      return true;
    }

    // Tamaño
    let width = 0;
    let height = 0;
    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      if (w === width && h === height) return;
      width = w;
      height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Movimiento: se mece siempre (así el brillo cambia) y gira si suena.
    // Solo dibuja mientras se ve; si no, mira cada medio segundo.
    let playing = false;
    let destroyed = false;
    let raf = 0;
    let idle = 0;
    let last = performance.now();
    let clock = 0;
    let spin = 0;
    const frame = (now) => {
      if (destroyed || lost) return;
      if (!container.isConnected) return destroy();
      if (!active() || document.hidden) {
        last = now;
        idle = setTimeout(() => (raf = requestAnimationFrame(frame)), 500);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      // Roto o rompiéndose no gira
      if (playing && !broken && !anim) spin -= (dt * Math.PI * 2) / TURN;
      disc.rotation.z = spin;
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / anim.dur);
        const e = anim.to > anim.from ? easeOut(anim.t) : easeInOut(anim.t);
        anim.value = anim.from + (anim.to - anim.from) * e;
        placeShards(anim.value, clock);
        if (anim.t >= 1) {
          if (anim.to === 0) {
            dropShards();
            disc.scale.setScalar(1);
            whole.visible = true;
          }
          anim = null;
        }
      } else if (broken && shards) placeShards(1, clock);
      // Mientras se mantiene pulsado, tiembla cada vez más
      const k = charging ? Math.min(1, (now - charging) / 550) : 0;
      disc.position.set((Math.random() - 0.5) * 0.03 * k, (Math.random() - 0.5) * 0.03 * k, 0);
      tilt.rotation.x = -0.16 + 0.24 * Math.sin(clock * 0.55);
      tilt.rotation.y = 0.32 * Math.sin(clock * 0.37 + 0.8);
      resize();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(idle);
      ro.disconnect();
      dropShards();
      if (maps) {
        maps.colorTex.dispose();
        maps.ormTex.dispose();
      }
      for (const x of disposables) x.dispose();
      renderer.dispose();
      try {
        if (!lost) renderer.forceContextLoss();
      } catch {}
      canvas.remove();
    }

    return {
      el: canvas,
      setCover,
      setPlaying: (on) => (playing = !!on),
      setBroken,
      isBroken: () => broken,
      lost: () => lost,
      setCharging: (on) => (charging = on ? performance.now() : 0),
      destroy,
    };
  }

  window.CD3D = { create };
})();
