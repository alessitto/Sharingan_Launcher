// =====================================================================
// Temas: color + estilo
// =====================================================================
// Un tema son dos cosas independientes:
//   - Color: solo dos colores (fondo y acento). El resto de la paleta sale
//     de mezclarlos con blanco (fondo oscuro) o negro (fondo claro).
//   - Estilo: un efecto que va por encima del color (Predeterminado,
//     Retro, Liquid Glass).
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
    { id: "retro", name: "Retro", desc: "Letra pixelada y aire de consola antigua." },
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

  // Variables CSS del tema. Los nombres (--ink-*, --washi-*, --red-*) son
  // los de siempre: --ink-* son superficies (del fondo hacia el blanco o el
  // negro), --washi-* el texto y --red-* el acento.
  function vars(paletteId, effect) {
    const p = paletteById(paletteId) || paletteById(DEFAULT_PALETTE);
    const bg = hexRgb(p.bg);
    const accent = hexRgb(p.accent);
    const dark = isDark(bg);
    const fg = dark ? WHITE : BLACK;
    const glass = effect === "glass";
    const out = {};

    const inkSteps = dark
      ? { 900: 0.035, 800: 0.065, 700: 0.1, 600: 0.16, 500: 0.26, 400: 0.4, 300: 0.58, 200: 0.78, 100: 0.9 }
      : { 900: 0.06, 800: 0.1, 700: 0.15, 600: 0.22, 500: 0.32, 400: 0.46, 300: 0.6, 200: 0.78, 100: 0.9 };
    // En Liquid Glass las superficies son translúcidas para que se vea el fondo.
    const glassAlpha = dark
      ? { 900: 0.07, 800: 0.11, 700: 0.16, 600: 0.22, 500: 0.3, 400: 0.46, 300: 0.64, 200: 0.82, 100: 0.92 }
      : { 900: 0.06, 800: 0.1, 700: 0.15, 600: 0.22, 500: 0.3, 400: 0.46, 300: 0.62, 200: 0.8, 100: 0.9 };
    for (const k of Object.keys(inkSteps)) {
      out[`--ink-${k}`] = glass ? rgba(fg, glassAlpha[k]) : css(mix(bg, fg, inkSteps[k]));
    }
    out["--ink-950"] = css(bg);
    out["--ink-900-rgb"] = triplet(mix(bg, fg, inkSteps[900]));

    const washi = { 50: 0.02, 100: 0.05, 200: 0.1, 300: 0.22, 400: 0.38 };
    for (const [k, t] of Object.entries(washi)) out[`--washi-${k}`] = css(mix(fg, bg, t));

    out["--red-100"] = css(mix(accent, WHITE, 0.7));
    out["--red-400"] = css(accent);
    out["--red-500"] = css(accent);
    out["--red-600"] = css(mix(accent, BLACK, 0.15));
    out["--red-500-rgb"] = triplet(accent);
    out["--on-accent"] = isDark(accent) ? "#fff" : "#000";
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
    const { vars: v, dark } = vars(palette, effect);
    // Se limpian las variables del tema anterior (las de Liquid Glass).
    for (const k of applied) if (!(k in v)) doc.style.removeProperty(k);
    applied = Object.keys(v);
    for (const [k, val] of Object.entries(v)) doc.style.setProperty(k, val);
    doc.style.colorScheme = dark ? "dark" : "light";
    doc.setAttribute("data-theme", palette);
    doc.setAttribute("data-tone", dark ? "dark" : "light");
    if (effect === DEFAULT_EFFECT) doc.removeAttribute("data-effect");
    else doc.setAttribute("data-effect", effect);
    return { palette, effect };
  }

  const api = { CATEGORIES, EFFECTS, PALETTES, paletteById, resolve, vars, apply, windowBg, isDark: (hex) => isDark(hexRgb(hex)) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.SLThemes = api;
})(typeof window !== "undefined" ? window : globalThis);
