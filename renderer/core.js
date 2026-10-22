// Base: variables globales, iconos, portadas, modales, navegación y arranque.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Variables globales
// ===============================
let gamesTemp = [];
let libraryIds = new Set();
// Para reconocer en Descubrir lo que ya tienes aunque venga de Steam, Epic o
// GOG (su id no es el de IGDB): por id de IGDB y por nombre.
let ownedIgdbIds = new Set();
let ownedNames = new Set();
const ownedNameKey = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, "");
function isOwnedGame(g) {
  return !!g && (libraryIds.has(g.id) || ownedIgdbIds.has(Number(g.id)) || ownedNames.has(ownedNameKey(g.name)));
}
// Descubrir espera a la biblioteca para poder quitar lo que ya tienes.
let libraryReady = Promise.resolve();
let currentSearchGames = [];
let showOnlyLinked = false;
let libraryGamesCache = [];
let completedGamesCache = [];
let sagasCache = [];
let dartacanPlayed = false;

// Gamepad state
let activePadIndex = null;
let gpLast = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  x: false,
  y: false,
  lb: false,
  rb: false,
};
let focusedIndex = 0;
let focusedContainerId = "gamesList"; // cambia según sección

// Nombres de juegos "sin plataforma" vienen literalmente del nombre de
// carpeta que elige el usuario — nunca se insertan en innerHTML sin
// pasar por aquí antes.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===============================
// Iconos (trazos estilo Lucide, heredan color con currentColor)
// ===============================
const ICON_PATHS = {
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  handheld: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 10v4M4 12h4"/><path d="M16.5 10.5h.01M18.5 13.5h.01"/><path d="M10 9h4v6h-4z"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16.5h10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  searchX: '<path d="m13.5 8.5-5 5"/><path d="m8.5 8.5 5 5"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a2 2 0 0 0 0 4h1"/><path d="M17 6h3a2 2 0 0 1 0 4h-1"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2Z"/>',
  pokeball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h6"/><path d="M15 12h6"/><circle cx="12" cy="12" r="3"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  hash: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
};

function icon(name, cls = "") {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

function coverOf(game) {
  return (
    game?.coverUrl ||
    (game?.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
      : noCoverSvg(game?.name))
  );
}

// Portada para juegos sin portada: una carátula sobria con el nombre del
// juego y el tomoe del Sharingan de fondo, con los colores del tema
// activo (se vuelve a generar al cambiar de tema, ver refreshNoCovers).
// Es un SVG en data URL para que sirva en cualquier <img>.
function noCoverSvg(title = "") {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const bg1 = v("--ink-800", "#1c1c1f");
  const bg2 = v("--ink-950", v("--ink-900", "#101012"));
  const accent = v("--red-500", "#a61414");
  const ink = v("--washi-50", "#f4f1ea");
  const muted = v("--ink-400", "#8a8a90");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
  // Nombre en hasta 3 líneas (~17 caracteres por línea a este tamaño)
  const words = String(title || "Sin portada").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > 17 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = `${lines[2].replace(/\s*\S*$/, "")}…`;
  }
  const size = lines.length === 1 && lines[0].length <= 10 ? 30 : 23;
  const lh = size * 1.18;
  const y0 = 318 - (lines.length - 1) * lh;
  const text = lines.map((l, i) => `<tspan x="24" y="${(y0 + i * lh).toFixed(1)}">${esc(l)}</tspan>`).join("");
  // Tomoe: cabeza redonda sobre el anillo y cola corta curvada
  const tomoe = (deg) =>
    `<g transform="rotate(${deg} 132 140)"><circle cx="132" cy="96" r="10.5"/><path d="M121.6 94.5C122 83 133 77 147 80c-8 3-13 8-13 16z"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 264 352"><desc>sl-nocover|${esc(title)}</desc>
<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
<radialGradient id="g" cx=".5" cy=".38" r=".6"><stop offset="0" stop-color="${accent}" stop-opacity=".22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
<rect width="264" height="352" fill="url(#b)"/><rect width="264" height="352" fill="url(#g)"/>
<g fill="none" stroke="${accent}" stroke-opacity=".28"><circle cx="132" cy="140" r="78" stroke-width="1.5"/><circle cx="132" cy="140" r="44" stroke-width="1"/></g>
<g fill="${accent}" opacity=".38"><circle cx="132" cy="140" r="9"/>${tomoe(0)}${tomoe(120)}${tomoe(240)}</g>
<rect x="24" y="${(y0 - size - 14).toFixed(1)}" width="26" height="3" rx="1.5" fill="${accent}"/>
<text font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" fill="${ink}" letter-spacing="-.2">${text}</text>
<text x="24" y="38" font-family="'Segoe UI', system-ui, sans-serif" font-size="10.5" font-weight="600" letter-spacing="2.2" fill="${muted}">SIN PORTADA</text>
<rect x=".5" y=".5" width="263" height="351" fill="none" stroke="#fff" stroke-opacity=".06"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Tras cambiar de tema: las portadas genéricas que haya en pantalla se
// rehacen con los colores nuevos (el nombre va dentro del propio SVG).
function refreshNoCovers() {
  document.querySelectorAll('img[src^="data:image/svg+xml"]').forEach((img) => {
    const svg = decodeURIComponent(img.getAttribute("src").split(",").slice(1).join(","));
    const m = /<desc>sl-nocover\|([\s\S]*?)<\/desc>/.exec(svg);
    if (!m) return;
    const title = m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e]);
    img.src = noCoverSvg(title);
  });
}

function releaseYear(game) {
  return game?.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : null;
}

// Se puede jugar si tiene .exe o si su launcher sabe abrirlo (Steam,
// Epic o GOG Galaxy con su id) - mismo criterio que main.js.
function canPlay(g) {
  if (g.notInstalled) return false;
  return !!(
    g.executable ||
    (g.platform === "steam" && g.steamAppId) ||
    (g.platform === "epic" && g.epicAppName) ||
    (g.platform === "gog" && g.gogGameId)
  );
}

// ===============================
// Modales (SweetAlert2 con el aspecto de la app)
// ===============================
// Todo sale de las variables del tema activo, así los modales cambian
// de color con el tema igual que el resto (antes llevaban el negro y
// rojo de Uchiha fijos).
// Una ventana abierta no encoge: si algo desaparece se queda el hueco
// (min-height con lo más alto que ha llegado a medir), así no salta ni
// se recoloca. Lo que aparece después de abrir ya tiene su sitio
// reservado en cada ventana. SweetAlert reutiliza el mismo popup entre
// ventanas, así que cada una empieza de cero.
let modalSizeObs = null;
function lockModalSize(popup) {
  modalSizeObs?.disconnect();
  popup.style.minHeight = "";
  let max = 0;
  modalSizeObs = new ResizeObserver(() => {
    if (!popup.isConnected || popup.classList.contains("swal2-hide")) return;
    const h = popup.offsetHeight;
    if (h <= max) return;
    max = h;
    popup.style.minHeight = `min(${h}px, calc(100vh - 32px))`;
  });
  modalSizeObs.observe(popup);
}

function openModal(opts = {}) {
  const { eyebrow, title, customClass = {}, didOpen, didClose, ...rest } = opts;
  return Swal.fire({
    didOpen: (popup) => {
      lockModalSize(popup);
      return didOpen?.(popup);
    },
    didClose: () => {
      modalSizeObs?.disconnect();
      modalSizeObs = null;
      return didClose?.();
    },
    background: "var(--ink-900)",
    color: "var(--washi-100)",
    buttonsStyling: false,
    reverseButtons: true,
    closeButtonHtml: icon("x"),
    showClass: { popup: "sl-modal-in" },
    hideClass: { popup: "sl-modal-out" },
    title: title
      ? `${eyebrow ? `<span class="sl-modal-eyebrow">${escapeHtml(eyebrow)}</span>` : ""}${escapeHtml(title)}`
      : undefined,
    ...rest,
    customClass: {
      popup: `sl-modal ${customClass.popup || ""}`,
      title: "sl-modal-title",
      htmlContainer: "sl-modal-body",
      actions: "sl-modal-actions",
      confirmButton: `sl-btn sl-btn-primary ${customClass.confirmButton || ""}`,
      cancelButton: "sl-btn sl-btn-ghost",
      denyButton: "sl-btn sl-btn-ghost",
      closeButton: "sl-modal-close",
      input: "sl-input",
      inputLabel: "sl-input-label",
      validationMessage: "sl-validation",
    },
  });
}

// Confirmación corta con icono propio (sin los iconos animados de
// SweetAlert, que no pegan con el resto de la app).
async function confirmDialog({ title, text, confirmText = "Aceptar", danger = false, iconName }) {
  const { isConfirmed } = await openModal({
    width: 420,
    html: `
      <div class="sl-confirm">
        <span class="sl-confirm-icon ${danger ? "is-danger" : ""}">${icon(iconName || (danger ? "trash" : "info"))}</span>
        <h3 class="sl-confirm-title">${escapeHtml(title)}</h3>
        ${text ? `<p class="sl-confirm-text">${escapeHtml(text)}</p>` : ""}
      </div>`,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancelar",
    focusCancel: danger,
    customClass: { popup: "sl-modal-sm", confirmButton: danger ? "sl-btn-danger" : "" },
  });
  return isConfirmed;
}

function loadingModal(title, text = "") {
  return openModal({
    width: 400,
    html: `
      <div class="sl-loading">
        <span class="sl-spinner"></span>
        <h3 class="sl-confirm-title">${escapeHtml(title)}</h3>
        <p class="sl-confirm-text" id="slLoadingText">${escapeHtml(text)}</p>
      </div>`,
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    customClass: { popup: "sl-modal-sm" },
  });
}

// La ficha de un juego es su página (gamepage.js): se abre al hacer
// clic en la tarjeta. openInfoModal se queda por los atajos de teclado.
function openInfoModal(id) {
  window.GamePage?.open(id);
}

// ===============================
// Navegación lateral
// ===============================
// Las pestañas de arriba son solo iconos: también se abren con teclado.
document.addEventListener("keydown", (e) => {
  const item = e.target.closest?.(".topnav-item");
  if (item && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    item.click();
  }
});

// La entrada de la barra lateral se busca por su sección (data-section);
// el segundo parámetro se queda por compatibilidad.
function showSection(id, el) {
  // "Pasados" ya no es una sección: la biblioteca con ese filtro
  if (id === "completed" || id === "platinum") return showLibraryState(id);
  el = document.querySelector(`.topnav-item[data-section="${id}"]`) || el;
  if (id !== "game") window.GamePage?.onLeave();
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  document
    .querySelectorAll(".topnav-item")
    .forEach((li) => li.classList.remove("active"));
  if (el) el.classList.add("active");

  // al cambiar sección, vuelve arriba del todo (si no, se arrastra el
  // scroll de la sección anterior) y reinicia foco al primer elemento
  document.querySelector(".main-content")?.scrollTo(0, 0);
  document.getElementById("scrollTopBtn")?.classList.remove("show");

  if (id === "popular") focusedContainerId = "gamesList";
  if (id === "library") focusedContainerId = "libraryList";
  if (id === "play") focusedContainerId = "playList";
  document.body.classList.toggle("in-pokepark", id === "pokepark");
  if (id === "pokepark") window.PokePark?.onShow();
  document.body.classList.toggle("in-community", id === "community");
  window.Community?.setVisible(id === "community");
  if (id === "home") window.Home?.onShow();
  if (id === "stats") window.Stats?.onShow();
  focusedIndex = 0;
  updateGamepadFocus(true);
}

function playIntroOut(screen) {
  // Intro en WebGL (intro.js): su final ya enseña la app por la pupila
  if (screen && window.Intro && screen.classList.contains("has-gl")) {
    return window.Intro.finish(() => {
      document.body.classList.add("app-enter");
      setTimeout(() => document.body.classList.remove("app-enter"), 900);
    }).then(() => screen.remove());
  }
  // Sin WebGL: el logo girando de siempre, con su fundido
  return new Promise((resolve) => {
    if (!screen) return resolve();
    screen.classList.add("hidden");
    setTimeout(() => {
      screen.remove();
      resolve();
    }, 500);
  });
}

function getActiveSectionId() {
  const el = document.querySelector(".section.active");
  return el?.id || "popular";
}

// ===============================
// Carga inicial (UNIFICADA)
// ===============================
window.addEventListener("DOMContentLoaded", async () => {
  // filtro biblioteca
  const savedFilter = localStorage.getItem("libraryLinkedFilter");
  showOnlyLinked = savedFilter === "true";

  // intro
  const introScreen = document.getElementById("intro-screen");
  const introAudio = document.getElementById("intro-audio");

  try {
    introAudio.volume = 0.5;
    await introAudio.play();
  } catch (err) {
    console.warn("Audio bloqueado o no encontrado:", err);
  }

  // carga datos
  await loadAppSettings();
  loadGenreOptions();
  loadAppVersion();
  setupUpdateToast();
  libraryReady = loadLibrary();
  const loadPromises = Promise.all([libraryReady, loadDiscoverGames()]);

  // Intro: el ojo se abre y salen los tomoe (CSS); cuando todo ha cargado
  // (y como pronto a los 1,5 s), giro rápido, el ojo se abre de golpe y
  // aparece la app.
  setTimeout(async () => {
    await loadPromises;
    await playIntroOut(introScreen);

    // foco inicial mando
    focusedContainerId = "gamesList";
    focusedIndex = 0;
    updateGamepadFocus(true);
  }, 1500);

  // gamepad loop
  setupGamepad();
});

// Cerrar dropdowns al hacer click fuera
window.addEventListener("click", (e) => {
  if (!e.target.closest(".more-btn")) {
    document
      .querySelectorAll(".dropdown-content")
      .forEach((d) => d.classList.remove("show"));
  }
});

// Botón flotante "volver arriba" - .main-content es el contenedor que
// de verdad scrollea (overflow:auto), no la ventana.
const mainContentEl = document.querySelector(".main-content");
if (mainContentEl) {
  mainContentEl.addEventListener("scroll", () => {
    const btn = document.getElementById("scrollTopBtn");
    if (btn) btn.classList.toggle("show", mainContentEl.scrollTop > 400);
  });
}

function scrollActiveSectionToTop() {
  mainContentEl?.scrollTo({ top: 0, behavior: "smooth" });
}
