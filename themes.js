// =====================================================================
// Temas: color + estilo
// =====================================================================
// Un tema son dos cosas independientes:
//   - Color: solo dos colores (fondo y acento). El resto de la paleta sale
//     de mezclarlos con blanco (fondo oscuro) o negro (fondo claro).
//   - Estilo: un efecto que va por encima del color (Predeterminado,
//     Minimalista, Paper, Terminal, Retro, Y2K, Frutiger Aero, Cyberpunk,
//     Liquid Glass).
// Lo usan la ventana (window.SLThemes) y main.js (require) para el color
// de fondo de la ventana antes de cargar.
(function (global) {
  "use strict";

  const CATEGORIES = [
    {
      name: "Naruto",
      groups: [
        {
          items: [
            { id: "itachi", name: "Itachi", bg: "#0D0D0D", accent: "#A61414" },
            { id: "sasuke", name: "Sasuke", bg: "#123869", accent: "#864944" },
            { id: "naruto", name: "Naruto", bg: "#E48044", accent: "#153768" },
            { id: "sakura", name: "Sakura", bg: "#9E3033", accent: "#F3C7BD" },
          ],
        },
      ],
    },
    {
      name: "Pokémon",
      groups: [
        {
          items: [
            { id: "blaziken", name: "Blaziken", bg: "#F26666", accent: "#D9D6B0" },
            { id: "luxray", name: "Luxray", bg: "#464543", accent: "#8FCBD9" },
            { id: "gengar", name: "Gengar", bg: "#9275AA", accent: "#C45758" },
            { id: "lucario", name: "Lucario", bg: "#73AABF", accent: "#F2DAAC" },
          ],
        },
        {
          name: "Eeveelutions",
          items: [
            { id: "eevee", name: "Eevee", bg: "#C18D5B", accent: "#ECD9B8" },
            { id: "umbreon", name: "Umbreon", bg: "#39333A", accent: "#F2D541" },
            { id: "sylveon", name: "Sylveon", bg: "#F7F8FA", accent: "#F2C2CB" },
          ],
        },
        {
          name: "Legendarios",
          items: [
            { id: "zekrom", name: "Zekrom", bg: "#4B615F", accent: "#5AC3EB" },
            { id: "reshiram", name: "Reshiram", bg: "#EEEEEE", accent: "#F39706" },
            { id: "rayquaza", name: "Rayquaza", bg: "#7ABF98", accent: "#F2DE77" },
            { id: "groudon", name: "Groudon", bg: "#BF1F1F", accent: "#0D0D0D" },
            { id: "kyogre", name: "Kyogre", bg: "#0071B8", accent: "#D93654" },
          ],
        },
      ],
    },
  ];

  const EFFECTS = [
    { id: "default", name: "Predeterminado", desc: "Limpio, sin filtros." },
    { id: "minimal", name: "Minimalista", desc: "Mucho aire, letra limpia y lo justo." },
    { id: "paper", name: "Paper", desc: "Papel con grano, tinta y tarjetas de verdad." },
    { id: "terminal", name: "Terminal", desc: "Letra monoespaciada, prompt y cursor." },
    { id: "retro", name: "Retro", desc: "Letra pixelada y aire de consola antigua." },
    { id: "y2k", name: "Y2K", desc: "Cromados y botones de gominola, como en el 2000." },
    { id: "aero", name: "Frutiger Aero", desc: "Agua, burbujas y brillos de los 2000." },
    { id: "cyber", name: "Cyberpunk", desc: "Neones, líneas técnicas y HUD." },
    { id: "glass", name: "Liquid Glass", desc: "Cristal líquido, como en iOS 26." },
  ];

  const PALETTES = CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.items));
  const DEFAULT_PALETTE = "itachi";
  const DEFAULT_EFFECT = "default";

  // Temas de antes de la 2.7 (un solo id que mezclaba color y estilo).
  const LEGACY = {
    uchiha: ["itachi", "default"],
    mewtwo: ["gengar", "default"],
    mew: ["sylveon", "default"],
    glass: ["sasuke", "glass"],
  };

  const paletteById = (id) => PALETTES.find((p) => p.id === id) || null;
  const isEffect = (id) => EFFECTS.some((e) => e.id === id);

  // Ajustes guardados -> { palette, effect } válidos.
  function resolve(settings = {}) {
    let palette = settings.theme;
    let effect = settings.themeEffect;
    if (LEGACY[palette]) {
      if (!isEffect(effect)) effect = LEGACY[palette][1];
      palette = LEGACY[palette][0];
    }
    if (!paletteById(palette)) palette = DEFAULT_PALETTE;
    if (!isEffect(effect)) effect = DEFAULT_EFFECT;
    return { palette, effect };
  }

  // ------------------------------------------------------------ Color
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  const triplet = (c) => `${c[0]}, ${c[1]}, ${c[2]}`;
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  function luminance(c) {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Blanco o negro, el que más contraste dé sobre ese color.
  function isDark(c) {
    const L = luminance(c);
    return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05;
  }

  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // Legibilidad: lleva un color hacia el blanco o el negro (to) lo justo
  // para que se lea con el contraste pedido sobre ref. El tono no cambia;
  // si ya se lee bien, se queda tal cual.
  function readable(color, to, ref, target) {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const c = mix(color, to, Math.min(1, t));
      if (contrast(c, ref) >= target) return c;
    }
    return to;
  }

  // Igual, pero probando hacia el blanco y hacia el negro: se prefiere el
  // color del texto del tema (prefer) salvo que el otro lado cambie el
  // color bastante menos (así el acento conserva su tono).
  function readableEither(color, ref, target, prefer) {
    const reach = (to) => {
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const c = mix(color, to, Math.min(1, t));
        if (contrast(c, ref) >= target) return { t, c };
      }
      return null;
    };
    const a = reach(prefer);
    const b = reach(prefer === WHITE ? BLACK : WHITE);
    if (a && (!b || a.t <= b.t + 0.3)) return a.c;
    if (b) return b.c;
    return prefer;
  }

  // Variables CSS del tema. Los nombres (--ink-*, --washi-*, --red-*) son
  // los de siempre: --ink-* son superficies (del fondo hacia el blanco o el
  // negro), --washi-* el texto y --red-* el acento.
  // tinted (solo Liquid Glass): el modo "Tintado" de Apple. Las superficies
  // dejan de ser casi transparentes (se ven del color del tema con un poco
  // de transparencia) y el texto pide más contraste, para leerse bien sobre
  // cualquier fondo, sobre todo en los temas claros.
  function vars(paletteId, effect, tinted = false) {
    const p = paletteById(paletteId) || paletteById(DEFAULT_PALETTE);
    const bg = hexRgb(p.bg);
    const accent = hexRgb(p.accent);
    const dark = isDark(bg);
    const fg = dark ? WHITE : BLACK;
    const glass = effect === "glass";
    const tint = glass && tinted;
    const out = {};

    const inkSteps = dark
      ? { 900: 0.035, 800: 0.065, 700: 0.1, 600: 0.16, 500: 0.26, 400: 0.4, 300: 0.58, 200: 0.78, 100: 0.9 }
      : { 900: 0.06, 800: 0.1, 700: 0.15, 600: 0.22, 500: 0.32, 400: 0.46, 300: 0.6, 200: 0.78, 100: 0.9 };
    // En Liquid Glass las superficies son translúcidas para que se vea el fondo.
    const glassAlpha = dark
      ? { 900: 0.07, 800: 0.11, 700: 0.16, 600: 0.22, 500: 0.3, 400: 0.46, 300: 0.64, 200: 0.82, 100: 0.92 }
      : { 900: 0.06, 800: 0.1, 700: 0.15, 600: 0.22, 500: 0.3, 400: 0.46, 300: 0.62, 200: 0.8, 100: 0.9 };
    // --ink-500..900 son superficies y bordes; --ink-100..400 y --washi-*
    // son texto. El texto se mide contra una tarjeta (lo menos contrastado
    // en el que se escribe) y se acerca al blanco o al negro hasta llegar al
    // mínimo: así los fondos de tono medio (Naruto, Gengar, Kyogre...) se
    // leen igual de cómodos que los oscuros.
    const card = mix(bg, fg, inkSteps[800]);
    const TEXT_TARGET = tint ? { 100: 11, 200: 8.5, 300: 6, 400: 4.5 } : { 100: 10, 200: 7.5, 300: 4.8, 400: 3.4 };
    for (const k of Object.keys(inkSteps)) {
      if (TEXT_TARGET[k]) {
        const base = mix(bg, fg, inkSteps[k]);
        out[`--ink-${k}`] = css(readable(base, fg, card, TEXT_TARGET[k]));
      } else if (tint) out[`--ink-${k}`] = rgba(mix(bg, fg, inkSteps[k]), 0.9);
      else out[`--ink-${k}`] = glass ? rgba(fg, glassAlpha[k]) : css(mix(bg, fg, inkSteps[k]));
    }
    out["--ink-950"] = css(bg);
    out["--ink-900-rgb"] = triplet(mix(bg, fg, inkSteps[900]));

    const washi = tint
      ? { 50: [0.02, 14], 100: [0.05, 12], 200: [0.08, 10], 300: [0.18, 8], 400: [0.3, 6.2] }
      : { 50: [0.02, 13], 100: [0.05, 11], 200: [0.1, 8.5], 300: [0.22, 6.5], 400: [0.38, 5] };
    for (const [k, [t, target]] of Object.entries(washi)) out[`--washi-${k}`] = css(readable(mix(fg, bg, t), fg, card, target));

    out["--red-100"] = css(mix(accent, WHITE, 0.7));
    out["--red-400"] = css(accent);
    out["--red-500"] = css(accent);
    out["--red-600"] = css(mix(accent, BLACK, 0.15));
    out["--red-500-rgb"] = triplet(accent);
    out["--on-accent"] = isDark(accent) ? "#fff" : "#000";
    // El acento cuando es TEXTO (etiquetas, enlaces, valores): mismo tono,
    // aclarado u oscurecido lo justo para leerse sobre el fondo. Los rellenos
    // (botones, barras) siguen usando el acento tal cual.
    const accentText = readableEither(accent, card, 3.8, fg);
    out["--accent-text"] = css(accentText);
    out["--accent-text-rgb"] = triplet(accentText);
    // Colores de estado (peligro, oro, verde): igual, legibles sobre el fondo.
    const danger = readableEither([224, 86, 107], card, 3.8, fg);
    out["--danger"] = css(danger);
    out["--danger-rgb"] = triplet(danger);
    out["--gold-400"] = css(readableEither([201, 164, 76], card, 3.2, fg));
    out["--gold-500"] = css(readableEither([171, 134, 50], card, 3.2, fg));
    out["--green-500"] = css(readableEither([95, 127, 71], card, 3.2, fg));
    out["--bg-rgb"] = triplet(bg);
    out["--fg-rgb"] = triplet(fg);

    if (glass) {
      // Fondo de pantalla: manchas del acento y luces sobre el fondo.
      const lit = mix(bg, fg, dark ? 0.18 : 0.12);
      const deep = mix(bg, dark ? BLACK : WHITE, dark ? 0.35 : 0.4);
      out["--lg-wall"] = [
        `radial-gradient(ellipse 55% 45% at 12% 8%, ${rgba(accent, 0.85)}, transparent 70%)`,
        `radial-gradient(ellipse 45% 40% at 88% 14%, ${rgba(lit, 0.9)}, transparent 70%)`,
        `radial-gradient(ellipse 50% 50% at 70% 58%, ${rgba(accent, 0.55)}, transparent 70%)`,
        `radial-gradient(ellipse 45% 45% at 16% 80%, ${rgba(lit, 0.75)}, transparent 70%)`,
        `radial-gradient(ellipse 40% 35% at 92% 94%, ${rgba(accent, 0.7)}, transparent 70%)`,
        `linear-gradient(160deg, ${css(bg)} 0%, ${css(deep)} 100%)`,
      ].join(", ");
      out["--pp-scene-base"] = css(bg);
      out["--pp-scene-card"] = css(mix(bg, fg, 0.08));
    }
    return { vars: out, dark };
  }

  // Color de fondo de la ventana (main.js), para que no parpadee al abrir.
  function windowBg(settings) {
    return paletteById(resolve(settings).palette).bg;
  }

  // ------------------------------------------------------------ Aplicar
  let applied = [];
  function apply(settings) {
    const { palette, effect } = resolve(settings);
    const doc = global.document?.documentElement;
    if (!doc) return { palette, effect };
    const tinted = settings.glassTint === "tinted";
    const { vars: v, dark } = vars(palette, effect, tinted);
    // Se limpian las variables del tema anterior (las de Liquid Glass).
    for (const k of applied) if (!(k in v)) doc.style.removeProperty(k);
    applied = Object.keys(v);
    for (const [k, val] of Object.entries(v)) doc.style.setProperty(k, val);
    doc.style.colorScheme = dark ? "dark" : "light";
    doc.setAttribute("data-theme", palette);
    doc.setAttribute("data-tone", dark ? "dark" : "light");
    if (effect === DEFAULT_EFFECT) doc.removeAttribute("data-effect");
    else doc.setAttribute("data-effect", effect);
    doc.setAttribute("data-glass", tinted ? "tinted" : "clear");
    return { palette, effect, tinted };
  }

  const api = { contrast, CATEGORIES, EFFECTS, PALETTES, paletteById, resolve, vars, apply, windowBg, isDark: (hex) => isDark(hexRgb(hex)) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.SLThemes = api;
})(typeof window !== "undefined" ? window : globalThis);
