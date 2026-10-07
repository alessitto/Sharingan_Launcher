// =====================================================================
// PokéPark
// =====================================================================
// Un parque con tu equipo (hasta 6 Pokémon) y hasta 10 Pokémon salvajes.
// Con el equipo lleno, lo que se captura va a las Cajas (10 de 6×5, más la
// colección Eevee), desde donde se elige quién está en el equipo (y por
// tanto en el parque).
// Al principio solo se elige el inicial; el resto se captura con Poké Balls
// entre los salvajes que van apareciendo (siempre en su primera etapa).
// Mientras la app está abierta tu equipo gana experiencia, se le da de comer
// (bayas), se le limpia (amistad) y evoluciona como en los juegos (nivel,
// piedras, amistad, día/noche, objeto equipado e intercambio con otros
// jugadores). De vez en cuando aparecen objetos en el parque o los encuentra
// algún Pokémon. Los variocolor salen con la probabilidad de los juegos.
//
// Datos: assets/pokepark/pokedex.json (generado desde PokeAPI). Sprites:
// animados estilo 5ª gen de Pokémon Showdown cuando existen; si no, el
// sprite fijo del mismo estilo con un pequeño "respirar" por CSS.
// Estado: userData/pokepark.json (vía main.js).
//
// Usa helpers globales de index.html: openModal, confirmDialog, icon,
// escapeHtml, showNotification y Swal.
(() => {
  "use strict";

  // ------------------------------------------------------------ Constantes
  const PARTY_MAX = 6;
  // Cajas: los capturados con el equipo lleno van aquí. No están en el parque
  // (no ganan exp ni amistad, no comen ni evolucionan) hasta que vuelven al
  // equipo. 10 cajas de 6×5 (5 equipos por caja) con huecos fijos.
  const BOX_COUNT = 10;
  const BOX_COLS = 6;
  const BOX_SIZE = BOX_COLS * 5;
  // Colección Eevee: Eevee en el centro y sus 8 evoluciones alrededor.
  const EEVEE_LINE = [133, 134, 135, 136, 196, 197, 470, 471, 700];
  // Fondos de las cajas: los de Pokémon Esmeralda (assets/pokepark/walls/NN.png,
  // clases .pp-wall-N de pokepark.css), en el orden del juego.
  const WALLS = ["Bosque", "Ciudad", "Desierto", "Sabana", "Peñasco", "Volcán", "Nieve", "Cueva", "Playa", "Fondo marino", "Río", "Cielo", "Lunares", "Centro Pokémon", "Máquina", "Sencillo"];
  // Los 10 fondos dibujados de antes de la 3.4.1, a su equivalente de Esmeralda.
  const OLD_WALLS = [0, 1, 2, 3, 7, 5, 6, 8, 9, 11];
  const START_LEVEL = 5;
  const START_FRIENDSHIP = 70;
  const FRIENDSHIP_MAX = 255;
  const FRIENDSHIP_EVO = 160; // amistad alta (como en los juegos actuales)
  const TICK_MS = 60 * 1000; // el parque "late" cada minuto
  const EXP_EVERY_TICKS = 3; // exp pasiva cada 3 minutos con la app abierta
  const FEED_WINDOW_MS = 4 * 60 * 60 * 1000; // cada 4 h se puede volver a alimentar
  const FEED_MAX = 5; // las 5 primeras tomas de cada ventana dan exp
  const CLEAN_COOLDOWN_MS = 2 * 60 * 60 * 1000;
  const CLEAN_FRIENDSHIP = 3;
  const PASSIVE_FRIENDSHIP_TICKS = 30; // +1 de amistad cada 30 min con la app abierta
  // Los objetos del suelo hay que recogerlos a mano: duran 30 min y no hay
  // más de 15 a la vez. Así el parque no se "farmea" dejándolo abierto.
  const GROUND_MAX = 15;
  const GROUND_CHANCE = 0.06; // por minuto (~1 objeto cada 17 min)
  const GROUND_TTL_MS = 30 * 60 * 1000;
  const FIND_CHANCE = 0.002; // por minuto y Pokémon del equipo: solo Poké Balls (~1 cada 8 h)
  const MOVE_SUBST_LEVEL = 33; // "conoce el movimiento X" -> nivel aproximado
  const SPECIAL_SUBST_LEVEL = 36; // condiciones de combate/lugar -> nivel aproximado

  // Salvajes: siempre en su primera etapa, se quedan un rato y se van.
  const WILD_MAX = 10;
  const WILD_STAY_MIN = [40, 150]; // minutos
  const WILD_LEVEL = [3, 12];
  const CATCH_RATE = 0.4; // igual para todos
  const FLEE_CHANCE = 0.15; // tras fallar una captura
  const START_BALLS = 5;

  // Variocolor: la probabilidad de los juegos actuales (1/4096) y con el
  // Amuleto Iris (3/4096). Legendarios, singulares y ultraentes, nunca.
  const SHINY_ODDS = 1 / 4096;
  const SHINY_CHARM_ODDS = 3 / 4096;
  const CHARM_CHANCE = 0.01; // de cada objeto que aparece en el suelo

  // Liberar no tiene límite; si se va uno del equipo, los demás pierden un
  // corazón de amistad.
  const RELEASE_PENALTY = FRIENDSHIP_MAX / 5;

  // Iniciales de las 9 generaciones.
  const STARTERS = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912];

  // Pokédólares. Se empieza con 3.000 ₽ como en los juegos y se vende por la
  // mitad de lo que cuesta. Precios de compra oficiales (Espada/Escudo y
  // Escarlata/Púrpura) donde existen; los objetos que en los juegos no se
  // pueden comprar llevan un precio acorde a su rareza.
  const START_MONEY = 3000;
  const BALL_PRICE = 200;
  const STONE_SLUGS = new Set(["fire-stone", "water-stone", "thunder-stone", "leaf-stone", "ice-stone", "moon-stone", "sun-stone", "shiny-stone", "dusk-stone", "dawn-stone"]);
  const SWEET_SLUGS = new Set(["strawberry-sweet", "berry-sweet", "love-sweet", "star-sweet", "clover-sweet", "flower-sweet", "ribbon-sweet"]);
  const RARE_SLUGS = new Set(["chipped-pot", "masterpiece-teacup", "metal-alloy"]);
  // Las bayas solo se venden (en los juegos tampoco se compran).
  const BERRY_SELL = { "oran-berry": 40, "sitrus-berry": 100, "cheri-berry": 40, "chesto-berry": 40, "pecha-berry": 40, "rawst-berry": 40, "aspear-berry": 40, "razz-berry": 60, "pinap-berry": 60, "lum-berry": 250 };
  function buyPrice(slug) {
    if (slug === "poke-ball") return BALL_PRICE;
    if (STONE_SLUGS.has(slug)) return 3000;
    if (SWEET_SLUGS.has(slug)) return 500;
    if (RARE_SLUGS.has(slug)) return 6000;
    if (slug === "oval-stone" || slug === "razor-fang" || slug === "razor-claw") return 2000;
    if (heldItems.has(slug)) return 2000; // objetos para evolucionar por intercambio
    if (useItems.has(slug)) return 3000; // manzanas, tetera, armaduras...
    if (megaStones.has(slug)) return MEGA_PRICE;
    return 0;
  }
  const sellPrice = (slug) => BERRY_SELL[slug] || Math.floor(buyPrice(slug) / 2);
  const fmtMoney = (n) => `${Math.floor(n).toLocaleString("es-ES")} ₽`;

  // Visitas: legendarios, singulares y ultraentes llegan al azar, se quedan
  // 8 h y su amistad se conserva entre visitas. Cuanta más amistad, más
  // posibilidades de que sea ese el que vuelva.
  const VISIT_MS = 8 * 60 * 60 * 1000;

  // Megaevolución: con su megapiedra equipada, un Pokémon de tu equipo puede
  // megaevolucionar desde su ficha. Dura 2 h y después hay que esperar otras
  // 2 h para volver a hacerlo. Las megapiedras solo se compran en la tienda.
  const MEGA_MS = 2 * 60 * 60 * 1000;
  const MEGA_COOLDOWN_MS = 2 * 60 * 60 * 1000;
  const MEGA_PRICE = 10000;
  // Al expulsarlo se va molesto: su amistad queda un pelín por debajo de la
  // de un legendario nuevo (peso 0,99 frente a 1), así vuelve algo menos.
  const EXPEL_FRIENDSHIP = -0.2;
  const VISIT_CHANCE = 1 / 720; // por minuto con la app abierta (~12 h de media)
  const VISIT_LEVEL = 100;
  const VISIT_START_FRIENDSHIP = 0;
  const visitWeight = (fr) => 1 + fr / 20; // amistad máxima ≈ x13

  const SHOWDOWN = "https://play.pokemonshowdown.com/sprites";
  const SPRITE_ANI = (id, shiny) => `${SHOWDOWN}/gen5ani${shiny ? "-shiny" : ""}/${id}.gif`;
  // Los que no tienen animado pixel (sobre todo 6ª-9ª gen y megas nuevas)
  // usan el animado 3D de Showdown (a: 2 en pokedex.json), que es algo más
  // grande: se encoge con .is-3d para que cuadre con los demás.
  const SPRITE_3D = (id, shiny) => `${SHOWDOWN}/ani${shiny ? "-shiny" : ""}/${id}.gif`;
  const SPRITE_PNG = (id, shiny) => `${SHOWDOWN}/gen5${shiny ? "-shiny" : ""}/${id}.png`;
  // Sprites originales de los objetos, incluidos en la app (assets/pokepark/items).
  const ITEM_IMG = (slug) => `assets/pokepark/items/${slug}.png`;
  const EXTRA_ITEMS = { "poke-ball": "Poké Ball", "shiny-charm": "Amuleto Iris" };

  // Bayas: exp base (escala con el nivel) y amistad. "w" = probabilidad de salir.
  const BERRIES = {
    "oran-berry": { n: "Baya Aranja", exp: 50, fr: 1, w: 10, desc: "Muy nutritiva: buena experiencia." },
    "sitrus-berry": { n: "Baya Zidra", exp: 100, fr: 1, w: 4, desc: "Jugosa y rara: mucha experiencia." },
    "cheri-berry": { n: "Baya Zreza", exp: 35, fr: 1, w: 8, desc: "Picante. Un poco de todo." },
    "chesto-berry": { n: "Baya Atania", exp: 35, fr: 1, w: 8, desc: "Dura y seca. Un poco de todo." },
    "pecha-berry": { n: "Baya Meloc", exp: 25, fr: 2, w: 8, desc: "Muy dulce: les gusta." },
    "rawst-berry": { n: "Baya Safre", exp: 35, fr: 1, w: 7, desc: "Amarga. Un poco de todo." },
    "aspear-berry": { n: "Baya Perasi", exp: 35, fr: 1, w: 7, desc: "Ácida. Un poco de todo." },
    "razz-berry": { n: "Baya Frambu", exp: 15, fr: 4, w: 5, desc: "Su favorita: algo más de amistad." },
    "pinap-berry": { n: "Baya Pinia", exp: 70, fr: 1, w: 5, desc: "Les da energía: más experiencia." },
    "lum-berry": { n: "Baya Ziuela", exp: 180, fr: 3, w: 1.5, desc: "Rarísima. Experiencia y amistad." },
  };

  // Objetos que no se pueden conseguir porque solo los usan formas regionales
  // o legendarios (que no se pueden elegir).
  const ITEM_BLOCKLIST = new Set(["galarica-cuff", "galarica-wreath", "scroll-of-darkness", "scroll-of-waters"]);
  const COMMON_STONES = new Set(["fire-stone", "water-stone", "thunder-stone", "leaf-stone", "moon-stone"]);

  // Disparadores de PokeAPI que en el parque se aproximan a "subir de nivel".
  const LEVEL_LIKE_TRIGGERS = new Set(["level-up", "spin"]);
  const SUBST_TRIGGERS = new Set([
    "use-move",
    "recoil-damage",
    "three-defeated-bisharp",
    "in-battle-level-up",
    "agile-style-move",
    "strong-style-move",
    "gimmighoul-coins",
  ]);

  const STAT_LABELS = ["PS", "Ataque", "Defensa", "At. Esp.", "Def. Esp.", "Velocidad"];
  const TYPE_COLORS = {
    normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
    fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
    rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
  };

  // ------------------------------------------------------------ Estado
  let dex = null; // { types, items, species: [...] }
  const byId = new Map();
  const bySlug = new Map();
  let useItems = new Set(); // se consumen para evolucionar (piedras...)
  let heldItems = new Set(); // se equipan (evolución con objeto / intercambio)
  let megas = []; // formas mega (dex.megas), con un id propio en byId
  let megaStones = new Set();
  let state = null;
  let selectedUid = null;
  let root = null;
  let ready = false;
  let tickCount = 0;
  let saveTimer = null;
  const evoQueue = [];
  let evoRunning = false;

  const esc = (s) => escapeHtml(s);
  const now = () => Date.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const pickWeighted = (entries) => {
    const total = entries.reduce((acc, [, w]) => acc + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of entries) if ((r -= w) <= 0) return k;
    return entries[entries.length - 1][0];
  };

  function newState() {
    return {
      v: 2,
      party: [],
      boxes: Array.from({ length: BOX_COUNT }, () => Array(BOX_SIZE).fill(null)),
      boxNames: Array(BOX_COUNT).fill(""),
      boxWalls: Array.from({ length: BOX_COUNT }, (_, i) => i),
      wallsV: 2,
      eevee: {},
      lastBox: 0,
      bag: { "oran-berry": 3, "pecha-berry": 2, "razz-berry": 1, "poke-ball": START_BALLS },
      ground: [],
      wild: [],
      visitor: null,
      legends: {},
      money: START_MONEY,
      starter: false,
      shinyCharm: false,
      releases: { m: "", n: 0 },
      closed: false, // parque cerrado: sin salvajes ni visitas (salvo amistad máxima)
    };
  }

  // Completa un estado guardado (o venido de la cuenta) con lo que falte.
  // Los parques de antes de la 2.5 ya tenían su equipo elegido: se les da el
  // inicial por hecho, unas Poké Balls y el dinero inicial.
  function normalizeState(saved) {
    const st = saved && Array.isArray(saved.party) ? { ...newState(), ...saved } : newState();
    st.bag ||= {};
    st.ground = (st.ground || []).filter((g) => g && g.slug).map((g) => ({ ...g, at: g.at || now() }));
    st.wild ||= [];
    normalizeBoxes(st);
    st.legends ||= {};
    st.visitor ||= null;
    st.releases ||= { m: "", n: 0 };
    if (!(saved?.v >= 2) && saved && Array.isArray(saved.party)) {
      st.starter = st.party.length > 0;
      st.bag["poke-ball"] = (st.bag["poke-ball"] || 0) + START_BALLS;
      st.money = START_MONEY;
      st.v = 2;
    }
    if (typeof st.money !== "number" || !isFinite(st.money)) st.money = 0;
    return st;
  }

  // Cajas con la forma buena (10 × 30 huecos, colección Eevee) y la caja
  // antigua (una lista de hasta 60, antes de la 3.3.1) repartida en ellas.
  function normalizeBoxes(st) {
    const old = Array.isArray(st.boxes) ? st.boxes : [];
    st.boxes = Array.from({ length: BOX_COUNT }, (_, b) =>
      Array.from({ length: BOX_SIZE }, (_, i) => (Array.isArray(old[b]) && old[b][i] && old[b][i].sp ? old[b][i] : null))
    );
    const legacy = Array.isArray(st.box) ? st.box.filter((m) => m && m.sp) : [];
    const eevee = {};
    for (const [k, m] of Object.entries(st.eevee && typeof st.eevee === "object" ? st.eevee : {})) {
      if (m && m.sp && EEVEE_LINE.includes(Number(k)) && m.sp === Number(k)) eevee[k] = m;
      else if (m && m.sp) legacy.push(m);
    }
    st.eevee = eevee;
    st.boxNames = Array.from({ length: BOX_COUNT }, (_, b) => String((st.boxNames || [])[b] || "").slice(0, 20));
    const oldWalls = !(st.wallsV >= 2) && Array.isArray(st.boxWalls);
    st.boxWalls = Array.from({ length: BOX_COUNT }, (_, b) => {
      const w = Number((st.boxWalls || [])[b]);
      if (!Number.isInteger(w) || w < 0) return b % WALLS.length;
      return oldWalls ? (w === b ? b : OLD_WALLS[w % OLD_WALLS.length]) : w % WALLS.length;
    });
    st.wallsV = 2;
    st.lastBox = Number.isInteger(st.lastBox) && st.lastBox >= 0 && st.lastBox < BOX_COUNT ? st.lastBox : 0;
    const seen = new Set((st.party || []).map((m) => m.uid));
    for (const b of st.boxes) for (const m of b) if (m) seen.add(m.uid);
    for (const m of Object.values(st.eevee)) seen.add(m.uid);
    const left = [];
    for (const m of legacy) {
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      let placed = false;
      for (const b of st.boxes) {
        const i = b.indexOf(null);
        if (i >= 0) {
          b[i] = m;
          placed = true;
          break;
        }
      }
      if (!placed) left.push(m);
    }
    // Lo que no cabe (no debería pasar) se queda aquí para no perderlo.
    st.box = left;
  }

  // Equipo + visitante (si hay): los que ganan exp, comen y hacen amigos.
  const parkMons = () => (state.visitor ? [...state.party, state.visitor] : state.party);
  // Todo lo que anda por el parque (también los salvajes).
  const allMons = () => [...parkMons(), ...state.wild];
  const monByUid = (uid) => allMons().find((m) => m.uid === uid) || null;
  const partyFull = () => state.party.length >= PARTY_MAX;
  // Sin hueco ni en el equipo ni en las cajas: no se puede capturar.
  const noRoom = () => partyFull() && !boxFree();
  const FULL_MSG = () => "Tu equipo y todas tus cajas están llenos.";
  const newUid = (p) => `${p}${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function rollShiny(s) {
    if (isLegendary(s)) return false;
    return Math.random() < (state.shinyCharm ? SHINY_CHARM_ODDS : SHINY_ODDS);
  }
  const randomGender = (s) => (s.g === -1 ? null : Math.random() * 8 < s.g ? "f" : "m");
  const randomIvs = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 32));

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      dexSweep();
      window.electronAPI.pokeparkSave(state);
    }, 600);
  }

  // ------------------------------------------------------------ Pokédex
  const species = (id) => byId.get(Number(id));
  const speciesName = (id) => species(id)?.n || "???";
  const displayName = (mon) => mon.nick || speciesName(mon.sp);
  const itemName = (slug) => BERRIES[slug]?.n || EXTRA_ITEMS[slug] || dex.items[slug]?.n || slug;
  const isBerry = (slug) => !!BERRIES[slug];

  function isPickable(s) {
    return !s.from && !s.leg && !s.myth && !s.ub;
  }

  const isLegendary = (s) => !!(s && (s.leg || s.myth || s.ub));

  // ------------------------------------------------------------ Megaevolución
  // Forma mega que le corresponde por la piedra que lleva (Meowstic tiene una
  // para cada género).
  function megaFor(mon) {
    if (!mon?.held || mon.wild || mon.visitor || !megaStones.has(mon.held)) return null;
    return megas.find((m) => m.stone === mon.held && m.sp === mon.sp && (!m.gender || m.gender === mon.g)) || null;
  }
  // Fuerte Afecto (Greninja Ash): no lleva piedra, se despierta con la
  // amistad al máximo. Comparte duración y recarga con la megaevolución.
  const bondForm = (mon) => (mon && !mon.wild && !mon.visitor ? megas.find((m) => m.bond && m.sp === mon.sp) || null : null);
  const bondFor = (mon) => (mon?.fr >= FRIENDSHIP_MAX ? bondForm(mon) : null);
  // Forma con la que se transformó (megaKey: "bond" o la megapiedra; los de
  // antes de la 3.1.6 no la guardaban y era la piedra que llevan).
  function formOf(mon) {
    if (!mon?.megaAt) return null;
    if (mon.megaKey === "bond") return bondForm(mon);
    const m = megaFor(mon);
    return m && (!mon.megaKey || mon.megaKey === mon.held) ? m : null;
  }
  const megaActive = (mon) => !!(mon?.megaAt && now() < mon.megaAt + MEGA_MS && formOf(mon));
  const megaLeft = (mon) => Math.max(0, mon.megaAt + MEGA_MS - now());
  // Recarga pendiente (0 = puede megaevolucionar).
  const megaCooldown = (mon) => (mon.megaAt ? Math.max(0, mon.megaAt + MEGA_MS + MEGA_COOLDOWN_MS - now()) : 0);
  // Especie que se ve: la forma mega mientras dura.
  const lookSp = (mon) => (megaActive(mon) ? formOf(mon).id : mon.sp);

  // Especies a las que sirve una megapiedra (y las de su línea evolutiva previa,
  // para marcar en la tienda las que le valdrán a tu equipo cuando evolucione).
  function stoneTargets(slug) {
    const out = new Set();
    for (const m of megas.filter((x) => x.stone === slug)) {
      for (let sp = species(m.sp); sp; sp = sp.from ? species(sp.from) : null) out.add(sp.id);
    }
    return out;
  }
  const stoneOwner = (slug) => speciesName(megas.find((m) => m.stone === slug)?.sp);

  // Al quitarle la piedra (o cambiársela) mientras está megaevolucionado
  // vuelve a la normalidad y empieza la recarga.
  function endMega(mon) {
    if (!megaActive(mon) || mon.megaKey === "bond") return;
    mon.megaAt = now() - MEGA_MS;
    mon.megaOn = false;
  }

  function megaEvolve(mon, bond = false) {
    const m = bond ? bondFor(mon) : megaFor(mon);
    if (!m || megaActive(mon) || megaCooldown(mon)) return;
    mon.megaAt = now();
    mon.megaKey = bond ? "bond" : mon.held;
    mon.megaOn = true;
    save();
    transforming.add(mon.uid);
    render();
    root.querySelector(".pp-portrait")?.classList.add("is-megaevolving");
    playTransform(mon, bond);
    if (bond) {
      floatText(mon, "¡Fuerte Afecto!");
      showNotification(`¡El vínculo con ${displayName(mon)} lo ha convertido en ${m.n}!`);
      return;
    }
    floatText(mon, "¡Megaevolución!");
    window.Achievements?.track("megas");
    showNotification(`¡${displayName(mon)} ha megaevolucionado en ${m.n}!`);
  }

  // Animación en el propio parque (sin modal): se para, se vuelve una silueta
  // de luz rodeada de anillos de energía, destello, aparece la forma nueva con
  // una onda expansiva y el símbolo sobre la cabeza.
  const TRANSFORM_MS = 1900;
  function playTransform(mon, bond) {
    const el = actorOf(mon);
    if (!el) return transforming.delete(mon.uid);
    const img = el.querySelector(".pp-mon-img");
    const h = Math.max(40, (img?.offsetHeight || 64) * 1.25);
    const fx = document.createElement("span");
    fx.className = `pp-megafx${bond ? " is-bond" : ""}`;
    fx.style.setProperty("--fxh", `${h}px`);
    fx.innerHTML = `<i class="pp-megafx-orb"></i><i class="pp-megafx-ring"></i><i class="pp-megafx-ring is-b"></i><i class="pp-megafx-flash"></i><i class="pp-megafx-wave"></i><i class="pp-megafx-sym">${bond ? BOND_SVG : MEGA_SVG}</i>`;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("i");
      p.className = "pp-megafx-p";
      p.style.setProperty("--a", `${i * 30 + rand(-8, 8)}deg`);
      p.style.setProperty("--r", `${rand(50, 80)}px`);
      p.style.animationDelay = `${rand(0, 1200)}ms`;
      fx.appendChild(p);
    }
    el.appendChild(fx);
    el.classList.add("is-transforming");
    setTimeout(() => {
      transforming.delete(mon.uid);
      el.classList.remove("is-transforming");
      fx.classList.add("is-burst");
      syncActors(); // cambia al sprite nuevo justo con el destello (rehace el actor)
      if (!fx.isConnected) el.appendChild(fx);
      sparkle(mon, 14);
    }, TRANSFORM_MS);
    setTimeout(() => fx.remove(), TRANSFORM_MS + 1600);
  }

  // Se llama cada minuto: los que han agotado sus 2 h vuelven a su forma.
  function checkMegas() {
    let changed = false;
    for (const mon of state.party) {
      if (mon.megaOn && !megaActive(mon)) {
        mon.megaOn = false;
        changed = true;
        floatText(mon, "Vuelve a la normalidad", true);
        showNotification(`${displayName(mon)} ha vuelto a su forma normal.`);
      } else if (mon.megaOn) changed = true; // cuenta atrás en la ficha
    }
    return changed;
  }
  const legendKind = (s) => (s.ub ? "Ultraente" : s.myth ? "Singular" : "Legendario");

  // El sprite se pide a main.js (lo descarga y lo cachea en disco) y llega
  // como data URL, así se puede medir en un canvas cuánto hueco vacío trae
  // por debajo de los pies (--pad) y apoyarlo de verdad en el suelo.
  const spriteCache = new Map(); // id especie -> Promise<{ src, ani, w, h, pad }>

  function measureSprite(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        try {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, w, h).data;
          let row = h - 1;
          outer: for (; row >= 0; row--) {
            for (let x = 0; x < w; x++) if (d[(row * w + x) * 4 + 3] > 40) break outer;
          }
          resolve({ w, h, pad: Math.max(0, h - 1 - row) });
        } catch {
          resolve({ w, h, pad: 0 });
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function loadSprite(sp, shiny = false) {
    const s = species(sp);
    if (!s) return Promise.resolve(null);
    const key = `${s.id}${shiny ? "s" : ""}`;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const ani = s.a === 2 ? [[SPRITE_3D(s.sd, shiny), "3d"]] : s.a ? [[SPRITE_ANI(s.sd, shiny), true]] : [];
    const tries = s.sd ? [...ani, [SPRITE_PNG(s.sd, shiny), false]] : [];
    if (s.sprite) tries.push([shiny ? s.sprite.replace("/pokemon/", "/pokemon/shiny/") : s.sprite, false]);
    const p = (async () => {
      for (const [url, ani] of tries) {
        const src = await window.electronAPI.pokeparkSprite(url).catch(() => null);
        if (!src) continue;
        const m = await measureSprite(src);
        if (m) return { src, ani, ...m };
      }
      return null;
    })();
    spriteCache.set(key, p);
    p.then((r) => !r && spriteCache.delete(key)); // sin conexión: se reintentará
    return p;
  }

  function spriteHtml(sp, cls = "", shiny = false) {
    return `<img class="pp-sprite ${cls}" data-sp="${sp}" ${shiny ? 'data-shiny="1"' : ""} alt="" draggable="false">`;
  }

  // Miniatura fija (equipo, listas): el sprite de 5ª gen, con su versión
  // variocolor si lo es.
  function thumbHtml(mon, extra = "") {
    const s = species(lookSp(mon));
    const fb = s.sprite ? (mon.shiny ? s.sprite.replace("/pokemon/", "/pokemon/shiny/") : s.sprite) : "";
    return `<img src="${s.sd ? SPRITE_PNG(s.sd, mon.shiny) : fb}" alt="" ${extra} onerror="this.onerror=null;${fb && s.sd ? `this.src='${fb}'` : "this.style.visibility='hidden'"}">`;
  }
  // Sprite fijo de una especie (o forma mega, que puede no tenerlo en Showdown).
  const pngOf = (sp) => (species(sp).sd ? SPRITE_PNG(species(sp).sd) : species(sp).sprite || "");
  // Variocolor: el destello de icon() (index.html), relleno para que se vea
  // a tamaño pequeño.
  const SHINY_IC = icon("sparkles", "pp-shiny-ic");
  const SHINY_MARK = `<span class="pp-shiny-mark" title="Variocolor">${SHINY_IC}</span>`;

  // Rellena las imágenes de sprite que haya dentro de "box".
  function hydrate(box) {
    box?.querySelectorAll("img.pp-sprite[data-sp]").forEach((img) => {
      const sp = img.dataset.sp;
      const shiny = img.dataset.shiny === "1";
      const key = `${sp}${shiny ? "s" : ""}`;
      if (img.dataset.loaded === key) return;
      img.dataset.loaded = key;
      loadSprite(sp, shiny).then((r) => {
        if (!r || img.dataset.sp !== sp) return;
        img.style.setProperty("--pad", r.pad);
        img.style.setProperty("--h", r.h);
        img.classList.toggle("is-static", !r.ani);
        img.classList.toggle("is-3d", r.ani === "3d");
        img.src = r.src;
      });
    });
  }

  // Especies con los dos géneros posibles: el usuario puede elegirlo.
  function canChooseGender(mon) {
    const g = species(mon.sp)?.g;
    return g > 0 && g < 8;
  }

  // Si falla el animado se prueba el fijo de 5ª gen y después el de PokeAPI.
  function spriteError(img) {
    const sd = img.dataset.sd;
    if (img.src.includes("/gen5ani/")) {
      img.classList.add("is-static");
      img.src = SPRITE_PNG(sd);
    } else if (img.src.includes("/gen5/") && img.dataset.fb) {
      img.src = img.dataset.fb;
    } else {
      img.onerror = null;
      img.style.visibility = "hidden";
    }
  }

  function itemImg(slug, cls = "") {
    return `<img class="pp-item-img ${cls}" src="${ITEM_IMG(slug)}" alt="" draggable="false" onerror="this.onerror=null;this.style.visibility='hidden'">`;
  }

  // ------------------------------------------------------------ Stats / nivel
  const expForLevel = (l) => (l <= 1 ? 0 : l * l * l); // crecimiento "medio"

  function statsOf(mon) {
    const s = species(lookSp(mon));
    return s.s.map((b, i) => {
      const core = Math.floor(((2 * b + (mon.iv?.[i] || 0)) * mon.lv) / 100);
      return i === 0 ? core + mon.lv + 10 : core + 5;
    });
  }

  function heartsHtml(fr) {
    const val = (Math.max(0, Math.min(FRIENDSHIP_MAX, fr)) / FRIENDSHIP_MAX) * 5;
    let html = "";
    for (let i = 0; i < 5; i++) {
      const fill = Math.max(0, Math.min(1, val - i));
      html += `<span class="pp-heart" style="--fill:${Math.round(fill * 100)}%">${HEART_SVG}</span>`;
    }
    return html;
  }
  const HEART_SVG =
    '<svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

  // ------------------------------------------------------------ Hora del día
  function timeOfDay(d = new Date()) {
    const h = d.getHours();
    return h >= 8 && h < 20 ? "day" : "night";
  }
  function matchesTime(t) {
    const h = new Date().getHours();
    if (t === "day") return h >= 8 && h < 20;
    if (t === "night" || t === "full-moon") return h >= 20 || h < 8;
    if (t === "dusk") return h >= 17 && h < 20;
    return true;
  }

  // ------------------------------------------------------------ Evolución
  function kindOf(d) {
    if (d.trigger === "trade" || d.tradeSpecies) return "trade";
    if (d.trigger === "use-item") return "item";
    if (LEVEL_LIKE_TRIGGERS.has(d.trigger) || SUBST_TRIGGERS.has(d.trigger)) return "level";
    return "none"; // shed, take-damage... (formas regionales o casos raros)
  }

  // Nivel mínimo efectivo (con las aproximaciones del parque).
  function levelNeeded(s, d) {
    let need = d.level || 0;
    if (d.move || d.moveType) need = Math.max(need, MOVE_SUBST_LEVEL);
    if (SUBST_TRIGGERS.has(d.trigger)) need = Math.max(need, SPECIAL_SUBST_LEVEL);
    if (d.location) need = Math.max(need, SPECIAL_SUBST_LEVEL);
    return need;
  }

  // Las evoluciones "por lugar" solo cuentan si no hay otra forma de llegar
  // a esa misma evolución (normalmente hay una piedra en juegos recientes).
  function usableDetails(s) {
    const all = s.evo || [];
    return all.filter((d) => {
      if (kindOf(d) === "none") return false;
      if (d.location) return !all.some((o) => o.to === d.to && !o.location && kindOf(o) !== "trade");
      return true;
    });
  }

  function friendshipNeeded(d) {
    if (d.happiness || d.affection) return FRIENDSHIP_EVO;
    if (d.beauty) return 170;
    return 0;
  }

  function conditionsMet(mon, d, mode, item) {
    const kind = kindOf(d);
    if (kind === "none") return false;
    // Intercambio: "item" es la especie por la que se ha cambiado.
    if (mode === "trade") {
      if (kind !== "trade") return false;
      if (d.held && mon.held !== d.held) return false;
      if (d.tradeSpecies && species(item)?.slug !== d.tradeSpecies) return false;
      return true;
    }
    if (kind === "trade") return false;
    if (mode === "item") {
      if (kind !== "item" || d.item !== item) return false;
    } else if (kind !== "level") return false;
    const s = species(mon.sp);
    const need = levelNeeded(s, d);
    if (need && mon.lv < need) return false;
    if (mon.fr < friendshipNeeded(d)) return false;
    if (d.held && mon.held !== d.held) return false;
    if (d.time && !matchesTime(d.time)) return false;
    if (d.gender === 1 && mon.g !== "f") return false;
    if (d.gender === 2 && mon.g !== "m") return false;
    if (d.party && !state.party.some((m) => m !== mon && species(m.sp)?.slug === d.party)) return false;
    if (d.partyType && !state.party.some((m) => m !== mon && species(m.sp)?.t.includes(d.partyType))) return false;
    if (d.atkdef != null) {
      const [, atk, def] = statsOf(mon);
      const rel = atk > def ? 1 : atk < def ? -1 : 0;
      if (rel !== d.atkdef) return false;
    }
    return true;
  }

  // Evolución posible ahora mismo (o null). Si hay varias (Wurmple), se
  // decide de forma fija por el Pokémon para que no cambie cada vez.
  function findEvolution(mon, mode, item) {
    const s = species(mon.sp);
    const pool = mode === "trade" ? (s.evo || []).filter((d) => kindOf(d) === "trade") : usableDetails(s);
    const ok = pool
      .filter((d) => conditionsMet(mon, d, mode, item))
      // Primero las de movimiento (como en los juegos: Sylveon gana a Espeon y
      // Umbreon si se cumple lo suyo) y después las más concretas (objeto, hora...).
      .sort((a, b) => Number(!!(b.move || b.moveType)) - Number(!!(a.move || a.moveType)) || Object.keys(b).length - Object.keys(a).length);
    if (!ok.length) return null;
    const targets = [...new Set(ok.map((d) => d.to))];
    if (targets.length === 1 || ok[0].move || ok[0].moveType || ok[0].held || ok[0].time) return ok[0];
    const h = [...mon.uid].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const to = targets[h % targets.length];
    return ok.find((d) => d.to === to);
  }

  function describeDetail(d) {
    const kind = kindOf(d);
    const parts = [];
    if (kind === "trade") {
      if (d.tradeSpecies) return `Intercambiarlo por un ${speciesName(bySlug.get(d.tradeSpecies)?.id)}`;
      return d.held ? `Intercambiarlo equipado con ${itemName(d.held)}` : "Intercambiarlo con otro jugador";
    }
    if (kind === "item") parts.push(`Usar ${itemName(d.item)}`);
    const need = levelNeeded(null, d);
    if (need) parts.push(`nivel ${need}${d.level ? "" : " (aprox.)"}`);
    else if (kind === "level" && !friendshipNeeded(d) && !d.held) parts.push("subir de nivel");
    if (friendshipNeeded(d)) parts.push(d.beauty ? "mucho cariño" : "amistad alta");
    if (d.held) parts.push(`equipado con ${itemName(d.held)}`);
    if (d.time === "day") parts.push("de día");
    if (d.time === "night" || d.time === "full-moon") parts.push("de noche");
    if (d.time === "dusk") parts.push("al atardecer");
    if (d.gender === 1) parts.push("si es hembra");
    if (d.gender === 2) parts.push("si es macho");
    if (d.party) parts.push(`con ${speciesName(bySlug.get(d.party)?.id)} en el equipo`);
    if (d.partyType) parts.push(`con un tipo ${dex.types[d.partyType] || d.partyType} en el equipo`);
    if (d.atkdef === 1) parts.push("si su Ataque supera a su Defensa");
    if (d.atkdef === -1) parts.push("si su Defensa supera a su Ataque");
    if (d.atkdef === 0) parts.push("si Ataque y Defensa son iguales");
    const txt = parts.join(", ");
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  // Una línea por evolución posible (la primera forma que se pueda usar).
  function evolutionHints(mon) {
    const s = species(mon.sp);
    const all = (s.evo || []).filter((d) => kindOf(d) !== "none");
    const usable = usableDetails(s);
    const byTarget = new Map();
    for (const d of [...usable, ...all.filter((d) => kindOf(d) === "trade")]) {
      if (!byTarget.has(d.to)) byTarget.set(d.to, d);
    }
    return [...byTarget.entries()].map(([to, d]) => ({
      to,
      text: describeDetail(d),
      blocked: false,
    }));
  }

  function queueEvolution(mon, detail) {
    if (evoQueue.some((q) => q.uid === mon.uid)) return;
    evoQueue.push({ uid: mon.uid, to: detail.to, held: detail.held || null });
    runEvoQueue();
  }

  async function runEvoQueue() {
    if (evoRunning) return;
    // No se interrumpe al usuario si tiene otro modal abierto: se reintenta.
    if (Swal.isVisible() || tradeAnimBusy()) {
      setTimeout(runEvoQueue, 1500);
      return;
    }
    const job = evoQueue.shift();
    if (!job) return;
    const mon = state.party.find((m) => m.uid === job.uid);
    if (!mon) return runEvoQueue();
    evoRunning = true;
    const fromSp = mon.sp;
    const oldName = displayName(mon);
    await openModal({
      width: 420,
      html: `
        <div class="pp-evo">
          <div class="pp-evo-stage">
            <div class="pp-evo-glow"></div>
            <div class="pp-evo-from">${spriteHtml(fromSp, "", mon.shiny)}</div>
            <div class="pp-evo-to">${spriteHtml(job.to, "", mon.shiny)}</div>
          </div>
          <h3 class="pp-evo-title">¿Qué? ¡${esc(oldName)} está evolucionando!</h3>
          <p class="pp-evo-text">&nbsp;</p>
        </div>`,
      showConfirmButton: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
      customClass: { popup: "sl-modal-sm pp-evo-popup" },
      didOpen: (popup) => {
        hydrate(popup);
        const box = popup.querySelector(".pp-evo");
        setTimeout(() => box.classList.add("is-morphing"), 300);
        setTimeout(() => {
          box.classList.add("is-done");
          popup.querySelector(".pp-evo-title").textContent = "¡Enhorabuena!";
          popup.querySelector(".pp-evo-text").textContent = `${oldName} ha evolucionado a ${speciesName(job.to)}.`;
          const btn = document.createElement("button");
          btn.className = "sl-btn sl-btn-primary";
          btn.textContent = "¡Genial!";
          btn.onclick = () => Swal.close();
          box.appendChild(btn);
        }, 3600);
      },
    });
    mon.sp = job.to;
    if (job.held && mon.held === job.held) mon.held = null; // el objeto equipado se gasta
    window.Achievements?.track("evolutions");
    bump("evolve");
    save();
    render();
    evoRunning = false;
    if (evoQueue.length) setTimeout(runEvoQueue, 500);
  }

  // ------------------------------------------------------------ Acciones
  function gainExp(mon, amount) {
    if (mon.lv >= 100) return 0;
    mon.exp += Math.round(amount);
    let up = 0;
    while (mon.lv < 100 && mon.exp >= expForLevel(mon.lv + 1)) {
      mon.lv++;
      up++;
    }
    if (up) {
      // Como en los juegos: las evoluciones por nivel/amistad/hora se miran al subir de nivel.
      const d = findEvolution(mon, "level");
      if (d) queueEvolution(mon, d);
      else showNotification(`${displayName(mon)} ha subido al nivel ${mon.lv}.`);
    }
    return up;
  }

  function addFriendship(mon, n) {
    mon.fr = Math.max(0, Math.min(FRIENDSHIP_MAX, mon.fr + n));
    // La amistad con un visitante se guarda por especie para la próxima visita.
    if (mon.visitor) (state.legends[mon.sp] ||= { fr: 0, visits: 0 }).fr = mon.fr;
  }

  function feedInfo(mon) {
    if (unlimited()) return { left: Infinity, resetIn: 0 };
    if (!mon.feedStart || now() - mon.feedStart > FEED_WINDOW_MS) return { left: FEED_MAX, resetIn: 0 };
    return { left: Math.max(0, FEED_MAX - (mon.feedCount || 0)), resetIn: mon.feedStart + FEED_WINDOW_MS - now() };
  }

  function feed(mon, berry) {
    const b = BERRIES[berry];
    if (!b || !(have(berry) > 0)) return;
    if (!mon.feedStart || now() - mon.feedStart > FEED_WINDOW_MS) {
      mon.feedStart = now();
      mon.feedCount = 0;
    }
    if (mon.feedCount >= FEED_MAX && !unlimited()) {
      showNotification(`${displayName(mon)} está lleno. Podrá volver a comer en ${fmtDuration(feedInfo(mon).resetIn)}.`, "error");
      return;
    }
    takeFromBag(berry);
    mon.feedCount++;
    const exp = b.exp * (1 + mon.lv / 8);
    addFriendship(mon, b.fr);
    // Los visitantes ya están al nivel 100: comer solo les da amistad.
    floatText(mon, mon.lv >= 100 ? `+${b.fr} amistad` : `+${Math.round(exp)} EXP`);
    hop(mon.uid);
    window.Achievements?.track("feeds");
    bump("feed");
    showNotification(`${displayName(mon)} se ha comido una ${b.n}.`);
    gainExp(mon, exp);
    save();
    render();
  }

  function cleanWaitOf(mon) {
    return unlimited() ? 0 : (mon.cleanedAt || 0) + CLEAN_COOLDOWN_MS - now();
  }

  function clean(mon) {
    const wait = cleanWaitOf(mon);
    if (wait > 0) {
      showNotification(`${displayName(mon)} ya está cepillado. Vuelve en ${fmtDuration(wait)}.`, "error");
      return;
    }
    mon.cleanedAt = now();
    addFriendship(mon, CLEAN_FRIENDSHIP);
    window.Achievements?.track("cleans");
    bump("clean");
    floatText(mon, "¡Reluciente!", true);
    sparkle(mon);
    hop(mon.uid);
    save();
    render();
  }

  function takeFromBag(slug, n = 1) {
    if (unlimited()) return;
    state.bag[slug] = Math.max(0, (state.bag[slug] || 0) - n);
    if (!state.bag[slug]) delete state.bag[slug];
  }
  function addToBag(slug, n = 1) {
    state.bag[slug] = (state.bag[slug] || 0) + n;
  }

  function fmtDuration(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  }

  // Objeto al azar: bayas casi siempre; Poké Balls y objetos evolutivos a veces.
  function randomItem(evoChance, ballChance = 0) {
    if (Math.random() < ballChance) return "poke-ball";
    if (Math.random() >= evoChance) return pickWeighted(Object.entries(BERRIES).map(([k, v]) => [k, v.w]));
    const pool = [...useItems, ...heldItems]
      .filter((s) => !ITEM_BLOCKLIST.has(s))
      .map((s) => [s, COMMON_STONES.has(s) ? 5 : useItems.has(s) ? 2 : 1.2]);
    return pickWeighted(pool);
  }

  // Los objetos que nadie recoge en 30 min desaparecen.
  function expireGround() {
    const before = state.ground.length;
    state.ground = state.ground.filter((g) => now() - (g.at || 0) < GROUND_TTL_MS);
    return state.ground.length !== before;
  }

  // Lo que aparece tirado en el parque. El Amuleto Iris sale una sola vez.
  function randomGroundItem() {
    const charmOut = state.shinyCharm || state.ground.some((g) => g.slug === "shiny-charm");
    if (!charmOut && Math.random() < CHARM_CHANCE) return "shiny-charm";
    return randomItem(0.15, 0.25);
  }

  // ------------------------------------------------------------ Salvajes
  const wildPool = () => dex.species.filter(isPickable);
  const wildMax = () => (state.closed ? 0 : WILD_MAX - (state.visitor ? 1 : 0));

  function spawnWild() {
    const pool = wildPool();
    const s = pool[Math.floor(Math.random() * pool.length)];
    const lv = Math.round(rand(WILD_LEVEL[0], WILD_LEVEL[1]));
    const mon = {
      uid: newUid("w"),
      sp: s.id,
      nick: "",
      lv,
      exp: expForLevel(lv),
      fr: START_FRIENDSHIP,
      g: randomGender(s),
      iv: randomIvs(),
      held: null,
      shiny: rollShiny(s),
      wild: true,
      leaves: now() + rand(WILD_STAY_MIN[0], WILD_STAY_MIN[1]) * 60000,
    };
    state.wild.push(mon);
    if (mon.shiny) showNotification(`¡Ha aparecido un ${s.n} variocolor en el PokéPark!`);
    return mon;
  }

  // Se van los que han cumplido su tiempo (aunque la app estuviera cerrada)
  // y llegan otros hasta llenar el parque.
  function refreshWild() {
    let changed = false;
    const t = now();
    const before = state.wild.length;
    state.wild = state.wild.filter((m) => m.leaves > t || catching.has(m.uid));
    if (state.wild.length !== before) {
      changed = true;
      if (selectedUid && !monByUid(selectedUid)) selectedUid = null;
    }
    while (state.wild.length > wildMax()) {
      state.wild.sort((a, b) => a.leaves - b.leaves);
      if (catching.has(state.wild[0].uid)) break;
      state.wild.shift();
      changed = true;
    }
    while (state.wild.length < wildMax()) {
      spawnWild();
      changed = true;
    }
    return changed;
  }

  // ------------------------------------------------------------ Capturar
  const catching = new Set();

  // La Poké Ball ya ha dado al salvaje: se agita y se decide.
  async function resolveCatch(mon) {
    if (!mon?.wild || catching.has(mon.uid)) return;
    catching.add(mon.uid);
    save();
    const a = actors.get(mon.uid);
    a?.el.classList.add("is-catching");
    if (a) a.tx = a.ty = 0;
    render();
    await new Promise((r) => setTimeout(r, 2300));
    catching.delete(mon.uid);
    a?.el.classList.remove("is-catching");
    if (!state.wild.includes(mon)) return render();
    const name = speciesName(mon.sp);
    if (noRoom()) {
      // Con varias Poké Balls en el aire el equipo y la caja se pueden llenar antes.
      showNotification(`${FULL_MSG()} ${name} ha salido de la Poké Ball.`, "error");
      floatText(mon, "¡Se ha escapado!", true);
    } else if (Math.random() < CATCH_RATE) {
      state.wild = state.wild.filter((m) => m !== mon);
      const caught = { ...mon, at: now(), caught: now() };
      delete caught.wild;
      delete caught.leaves;
      const slot = partyFull() ? storeMon(caught) : null;
      const toBox = !!slot;
      if (!toBox) state.party.push(caught);
      if (!state.starter) state.starter = true;
      a?.el.classList.remove("is-wild");
      if (!toBox) selectedUid = caught.uid;
      else if (selectedUid === mon.uid) selectedUid = null;
      window.Achievements?.track("catches");
      bump("catch");
      showNotification(`¡Ya está! ¡${name}${mon.shiny ? " variocolor" : ""} atrapado!${toBox ? ` Se ha enviado a ${boxName(slot.b)}.` : ""}`);
      floatText(caught, toBox ? "¡A la Caja!" : "¡Atrapado!", true);
      sparkle(caught);
      if (hand?.kind === "ball" && noRoom()) cancelHand();
    } else if (Math.random() < FLEE_CHANCE) {
      state.wild = state.wild.filter((m) => m !== mon);
      if (selectedUid === mon.uid) selectedUid = null;
      showNotification(`¡Oh, no! ¡${name} ha escapado!`, "error");
    } else {
      showNotification(`¡Oh, no! ¡${name} ha salido de la Poké Ball!`, "error");
      floatText(mon, "¡Se ha escapado!", true);
    }
    refreshWild();
    save();
    render();
  }

  // ------------------------------------------------------------ Mano
  // La Poké Ball, las bayas y el cepillo se usan con el ratón dentro del
  // parque: el objeto va en la mano (sigue al cursor) y se lanza, se da o se
  // pasa sobre el Pokémon. Esc o clic derecho para soltarlo.
  // Cada uno sale de su botón del parque (junto a la bolsa).
  //  - Poké Ball: se ve grande abajo (en tu mano) y se lanza al punto donde
  //    hagas clic; vuela haciéndose pequeña y solo atrapa si cae encima de un
  //    salvaje (que se siguen moviendo). Si fallas, la Poké Ball se pierde.
  //    Se puede lanzar seguido (varias a la vez) mientras queden.
  //  - Baya: se elige en el menú y se le da con un clic a un Pokémon de tu
  //    equipo (o al visitante); se queda en la mano mientras queden.
  //  - Cepillo: mantén pulsado y frota sobre cualquier Pokémon de tu equipo
  //    hasta llenar la barra.
  const COMB_WORK = 1400; // píxeles de frotar para dejarlo reluciente
  let hand = null; // { kind, slug, target, el, hint, x, y, busy, work, down, last }

  const parkEl = () => root?.querySelector(".pp-park");
  const parkVisible = () => document.getElementById("pokepark")?.classList.contains("active");

  // Pokémon cuyo sprite está bajo el punto (coordenadas de pantalla); el
  // que está más al frente gana.
  function monAtPoint(cx, cy, accept) {
    let best = null;
    for (const [uid, a] of actors) {
      const mon = monByUid(uid);
      if (!mon || !accept(mon)) continue;
      const img = a.el.querySelector(".pp-mon-img");
      if (!img) continue;
      const r = img.getBoundingClientRect();
      const pad = 6;
      if (cx < r.left - pad || cx > r.right + pad || cy < r.top - pad || cy > r.bottom + pad) continue;
      const z = Number(a.el.style.zIndex) || 0;
      if (!best || z > best.z) best = { mon, z };
    }
    return best?.mon || null;
  }

  const HAND_HINTS = {
    ball: "Apunta y haz clic para lanzar · Esc para guardarla",
    berry: "Haz clic en tus Pokémon para darles la baya · Esc para guardarla",
    comb: "Frota sobre un Pokémon para cepillarlo · Esc para dejarlo",
  };

  function startHand(kind, slug = null) {
    cancelHand();
    const park = parkEl();
    if (!park) return;
    const el = document.createElement("div");
    el.className = `pp-hand is-${kind}`;
    el.innerHTML = kind === "comb" ? `<img src="${combSrc()}" alt="" draggable="false">` : itemImg(slug);
    el.style.setProperty("--s", 2.2);
    const hint = document.createElement("div");
    hint.className = "pp-hand-hint";
    hint.innerHTML = `<span>${HAND_HINTS[kind]}</span>${kind === "comb" ? `<i><em></em></i>` : `<b class="pp-hand-count"></b>`}`;
    park.append(el, hint);
    park.classList.add("is-aiming", `aim-${kind}`);
    hand = { kind, slug, target: null, el, hint, x: park.clientWidth / 2, y: park.clientHeight - 70, work: 0, down: false, last: null, warned: null };
    moveHand(hand.x, hand.y);
    updateHandCount();
  }

  // Cuántas te quedan del objeto que llevas en la mano.
  function updateHandCount() {
    const el = hand?.hint.querySelector(".pp-hand-count");
    if (el) el.textContent = `Te quedan ${fmtCount(have(hand.slug))}`;
  }

  // Botones del parque: sacan el objeto (o lo guardan si ya lo tienes).
  function toggleBall() {
    if (hand?.kind === "ball") return cancelHand();
    if (!(have("poke-ball") > 0)) return showNotification("No te quedan Poké Balls.", "error");
    if (noRoom()) return showNotification(FULL_MSG(), "error");
    startHand("ball", "poke-ball");
  }

  function toggleComb() {
    if (hand?.kind === "comb") return cancelHand();
    startHand("comb");
  }

  function cancelHand() {
    if (!hand) return;
    hand.el.remove();
    hand.hint.remove();
    parkEl()?.classList.remove("is-aiming", "aim-ball", "aim-berry", "aim-comb");
    hand = null;
  }

  // La Poké Ball se queda abajo (en tu mano) siguiendo el cursor de lado;
  // la baya y el cepillo van pegados al cursor.
  function moveHand(x, y) {
    if (!hand) return;
    const park = parkEl();
    if (hand.kind === "ball") {
      hand.x = Math.max(40, Math.min(park.clientWidth - 40, x));
      hand.y = park.clientHeight - 64;
    } else {
      hand.x = x;
      hand.y = y;
    }
    hand.el.style.transform = `translate(${hand.x}px, ${hand.y}px)`;
  }

  function parkPoint(e) {
    const r = parkEl().getBoundingClientRect();
    // El parque puede estar escalado (zoom de la ventana): se pasa a sus píxeles.
    const k = parkEl().clientWidth / r.width || 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  // Cepillo: frota sobre cualquier Pokémon de tu equipo (o el visitante).
  // Si cambias de Pokémon, la barra empieza de cero.
  function combRub(e, p) {
    const mon = monAtPoint(e.clientX, e.clientY, (m) => !m.wild);
    if (!mon || !hand.last) return;
    const wait = cleanWaitOf(mon);
    if (wait > 0) {
      if (hand.warned !== mon.uid) {
        hand.warned = mon.uid;
        showNotification(`${displayName(mon)} ya está cepillado. Vuelve en ${fmtDuration(wait)}.`, "error");
      }
      return;
    }
    if (hand.target !== mon.uid) {
      hand.target = mon.uid;
      hand.work = 0;
    }
    const d = Math.hypot(p.x - hand.last.x, p.y - hand.last.y);
    hand.work += d;
    if (Math.floor(hand.work / 220) !== Math.floor((hand.work - d) / 220)) sparkle(mon, 2);
    hand.hint.querySelector("em").style.width = `${Math.min(100, (hand.work / COMB_WORK) * 100)}%`;
    if (hand.work >= COMB_WORK) {
      hand.target = null;
      hand.work = 0;
      hand.down = false;
      hand.hint.querySelector("em").style.width = "0%";
      clean(mon);
    }
  }

  function onHandMove(e) {
    if (!hand || hand.busy || !e.target.closest(".pp-park")) return;
    const p = parkPoint(e);
    if (hand.kind === "comb" && hand.down) {
      combRub(e, p);
      if (hand) hand.last = p;
    }
    moveHand(p.x, p.y);
  }

  function onHandClick(e) {
    if (!hand || !e.target.closest(".pp-park") || e.target.closest(".pp-hud, .pp-dock")) return;
    e.preventDefault();
    e.stopPropagation();
    if (hand.busy) return;
    if (hand.kind === "ball") return throwAt(parkPoint(e), e.clientX, e.clientY);
    if (hand.kind === "berry") {
      const mon = monAtPoint(e.clientX, e.clientY, (m) => !m.wild);
      if (!mon) {
        const wild = monAtPoint(e.clientX, e.clientY, (m) => m.wild);
        if (wild) showNotification(`${speciesName(wild.sp)} es salvaje: no come de tu mano.`, "error");
        return;
      }
      // La baya se queda en la mano para dar otra mientras queden.
      const slug = hand.slug;
      feed(mon, slug);
      if (!hand) return;
      if (!(have(slug) > 0)) {
        cancelHand();
        showNotification(`No te quedan más ${itemName(slug)}.`, "error");
      } else updateHandCount();
    }
  }

  // Vuelo de la Poké Ball: curva desde la mano al punto, encogiéndose.
  function throwAt(to, cx, cy) {
    if (!(have("poke-ball") > 0)) {
      cancelHand();
      return showNotification("No te quedan Poké Balls.", "error");
    }
    if (noRoom()) {
      cancelHand();
      return showNotification(FULL_MSG(), "error");
    }
    takeFromBag("poke-ball");
    save();
    updateHandCount();
    // La mano no se bloquea: se puede lanzar otra mientras esta vuela.
    const park = parkEl();
    const from = { x: hand.x, y: hand.y };
    const ball = document.createElement("img");
    ball.className = "pp-ball-fly";
    ball.src = ITEM_IMG("poke-ball");
    park.appendChild(ball);
    const peak = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 90 - Math.abs(from.x - to.x) * 0.1 };
    const frames = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * peak.x + t * t * to.x;
      const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * peak.y + t * t * to.y;
      frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${t * 540}deg) scale(${2.2 - t * 1.2})` });
    }
    const anim = ball.animate(frames, { duration: 620, easing: "linear", fill: "forwards" });
    anim.onfinish = () => {
      const hit = monAtPoint(cx, cy, (m) => m.wild && !catching.has(m.uid));
      if (hit) {
        ball.remove();
        resolveCatch(hit);
        if (hand?.kind === "ball" && !(have("poke-ball") > 0)) cancelHand();
        return;
      }
      // Fallo: rebota en el suelo y desaparece.
      const end = `translate(${to.x}px, ${to.y}px) translate(-50%, -50%)`;
      ball.animate(
        [
          { transform: `${end} scale(1)`, opacity: 1 },
          { transform: `translate(${to.x + 14}px, ${to.y - 18}px) translate(-50%, -50%) rotate(90deg) scale(1)`, opacity: 1 },
          { transform: `translate(${to.x + 24}px, ${to.y}px) translate(-50%, -50%) rotate(160deg) scale(1)`, opacity: 0 },
        ],
        { duration: 500, easing: "ease-out", fill: "forwards" }
      ).onfinish = () => ball.remove();
      floatTextAt(to.x, to.y, "¡Fallaste!");
      updateClock();
      render();
      if (hand?.kind === "ball" && !(have("poke-ball") > 0)) {
        cancelHand();
        showNotification("No te quedan Poké Balls.", "error");
      }
    };
  }

  function floatTextAt(x, y, text) {
    const f = document.createElement("span");
    f.className = "pp-float is-soft pp-float-at";
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    parkEl()?.appendChild(f);
    setTimeout(() => f.remove(), 1600);
  }

  // Cepillo en pixel art (en los juegos solo sale en Pokémon Refresh, sin
  // sprite de objeto), al estilo de los sprites de objetos.
  let combUrl = null;
  function combSrc() {
    if (combUrl) return combUrl;
    const c = document.createElement("canvas");
    c.width = 30;
    c.height = 30;
    const g = c.getContext("2d");
    const p = (x, y, col, w = 1, h = 1) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    const OUT = "#5a1530";
    const MID = "#e2457a";
    const HI = "#ff9cc0";
    const SH = "#a82a57";
    // lomo (con el mango redondeado a la izquierda)
    p(3, 6, OUT, 24, 1);
    p(2, 7, OUT, 1, 4);
    p(27, 7, OUT, 1, 4);
    p(3, 7, HI, 24, 1);
    p(3, 8, MID, 24, 2);
    p(3, 10, SH, 24, 1);
    p(3, 11, OUT, 24, 1);
    p(5, 8, "#ffffff", 3, 1);
    // púas separadas, más largas en el centro
    for (let x = 4; x <= 25; x += 3) {
      const len = x < 8 || x > 21 ? 9 : 13;
      p(x, 12, MID, 1, len - 1);
      p(x + 1, 12, SH, 1, len - 1);
      p(x, 11 + len, OUT, 2, 1);
    }
    combUrl = c.toDataURL();
    return combUrl;
  }

  function bindHand() {
    root.addEventListener("click", onHandClick, true);
    root.addEventListener("mousemove", onHandMove);
    root.addEventListener("mousedown", (e) => {
      if (!hand || e.button !== 0 || !e.target.closest(".pp-park")) return;
      if (hand.kind === "comb" && !e.target.closest(".pp-dock, .pp-hud")) {
        hand.down = true;
        hand.last = parkPoint(e);
        e.preventDefault();
      }
    });
    window.addEventListener("mouseup", () => hand && (hand.down = false));
    root.addEventListener("contextmenu", (e) => {
      if (!hand) return;
      e.preventDefault();
      cancelHand();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && hand) {
        e.preventDefault();
        cancelHand();
      }
    });
  }

  // ------------------------------------------------------------ Liberar
  // Sin límite. Si se va uno del equipo, los demás lo echan de menos.
  async function release(mon) {
    const loc = locate(mon);
    if (!loc) return;
    if (mon.trade) return showNotification(`${displayName(mon)} está en una oferta de intercambio.`, "error");
    if (loc.kind === "party" && state.party.length <= 1) return showNotification("No puedes quedarte sin Pokémon.", "error");
    const fromParty = loc.kind === "party";
    const ok = await confirmDialog({
      title: `¿Liberar a ${displayName(mon)}?`,
      text: `Se irá del parque para siempre${mon.held ? ` (su ${itemName(mon.held)} vuelve a la bolsa)` : ""}.${
        fromParty ? " Los demás Pokémon de tu equipo lo echarán de menos y perderán un corazón de amistad." : ""
      }`,
      confirmText: "Liberar",
      danger: true,
      iconName: "trash",
    });
    const at = ok && locate(mon);
    if (!at) return;
    if (mon.held) addToBag(mon.held);
    setAt(at, null);
    if (at.kind === "party") for (const m of state.party) addFriendship(m, -RELEASE_PENALTY);
    if (selectedUid === mon.uid) selectedUid = null;
    showNotification(`Adiós, ${displayName(mon)}. ¡Cuídate!`);
    save();
    render();
  }

  // ------------------------------------------------------------ Cajas
  // 10 cajas de 6×5 con huecos fijos (state.boxes[b][i], null si está libre)
  // y la colección Eevee (state.eevee[especie]): un hueco para Eevee y uno
  // por cada evolución, y solo admite a esa especie.
  const boxName = (b) => state.boxNames[b] || `Caja ${b + 1}`;

  function boxedMons() {
    const out = [];
    for (const b of state.boxes) for (const m of b) if (m) out.push(m);
    for (const sp of EEVEE_LINE) if (state.eevee[sp]) out.push(state.eevee[sp]);
    return out;
  }
  const boxFree = () => state.boxes.reduce((n, b) => n + b.filter((m) => !m).length, 0);

  function locate(mon) {
    let i = state.party.indexOf(mon);
    if (i >= 0) return { kind: "party", i };
    for (let b = 0; b < state.boxes.length; b++) {
      i = state.boxes[b].indexOf(mon);
      if (i >= 0) return { kind: "box", b, i };
    }
    for (const sp of EEVEE_LINE) if (state.eevee[sp] === mon) return { kind: "eevee", sp };
    return null;
  }

  function getAt(loc) {
    if (loc.kind === "party") return state.party[loc.i] || null;
    if (loc.kind === "box") return state.boxes[loc.b][loc.i] || null;
    return state.eevee[loc.sp] || null;
  }

  // En el equipo no hay huecos: quitar uno lo saca de la lista y poner uno
  // más allá del último lo añade al final.
  function setAt(loc, mon) {
    if (loc.kind === "party") {
      if (!mon) state.party.splice(loc.i, 1);
      else if (loc.i < state.party.length) state.party[loc.i] = mon;
      else state.party.push(mon);
    } else if (loc.kind === "box") state.boxes[loc.b][loc.i] = mon || null;
    else if (mon) state.eevee[loc.sp] = mon;
    else delete state.eevee[loc.sp];
  }

  const sameLoc = (a, b) => a.kind === b.kind && a.i === b.i && a.b === b.b && a.sp === b.sp;

  // Primer hueco libre, empezando por la caja "from".
  function freeSlot(from = 0) {
    for (let k = 0; k < BOX_COUNT; k++) {
      const b = (from + k) % BOX_COUNT;
      const i = state.boxes[b].indexOf(null);
      if (i >= 0) return { kind: "box", b, i };
    }
    return null;
  }

  function storeMon(mon, from = state.lastBox || 0) {
    const slot = freeSlot(from);
    if (slot) setAt(slot, mon);
    return slot;
  }

  // Mueve "mon" a "to"; si ahí hay otro, se cambian de sitio. Devuelve true
  // si se ha podido.
  function moveTo(mon, to) {
    const fail = (msg) => (showNotification(msg, "error"), false);
    const from = locate(mon);
    if (!from || !to || sameLoc(from, to)) return false;
    const other = getAt(to);
    if (other === mon) return false;
    if (to.kind === "eevee" && mon.sp !== to.sp) return fail(`Ese hueco es para ${speciesName(to.sp)}.`);
    if (other && from.kind === "eevee" && other.sp !== from.sp) return fail(`${displayName(other)} no puede ir al hueco de ${speciesName(from.sp)}.`);

    if (from.kind === "party" && to.kind === "party") {
      // Reordenar el equipo.
      const j = Math.min(to.i, state.party.length - 1);
      [state.party[from.i], state.party[j]] = [state.party[j], state.party[from.i]];
      return true;
    }
    const leaving = from.kind === "party"; // "mon" sale del equipo
    const otherLeaving = to.kind === "party" && !!other; // "other" sale del equipo
    if (leaving && mon.trade) return fail(`${displayName(mon)} está en una oferta de intercambio.`);
    if (otherLeaving && other.trade) return fail(`${displayName(other)} está en una oferta de intercambio.`);
    if (leaving && !other && state.party.length <= 1) return fail("Tu equipo necesita al menos un Pokémon.");
    if (to.kind === "party" && !other && partyFull()) return fail(`Tu equipo está lleno (${PARTY_MAX}).`);

    if (leaving) leaveParty(mon);
    if (otherLeaving) leaveParty(other);
    setAt(to, mon);
    setAt(from, other);
    return true;
  }

  // Al guardarlo en la caja deja de estar megaevolucionado (empieza la recarga).
  function leaveParty(mon) {
    if (megaActive(mon)) {
      mon.megaAt = now() - MEGA_MS;
      mon.megaOn = false;
    }
    if (selectedUid === mon.uid) selectedUid = null;
  }

  // Del equipo al primer hueco libre de las cajas.
  function toBox(mon) {
    if (!state.party.includes(mon)) return false;
    const slot = freeSlot(state.lastBox || 0);
    if (!slot) return showNotification("Todas tus cajas están llenas.", "error"), false;
    return moveTo(mon, slot);
  }

  // De la caja al equipo (si hay hueco).
  function toParty(mon) {
    return moveTo(mon, { kind: "party", i: state.party.length });
  }

  function sortBox(b, how) {
    const list = state.boxes[b].filter(Boolean);
    const by = {
      dex: (x, y) => x.sp - y.sp || y.lv - x.lv,
      lv: (x, y) => y.lv - x.lv || x.sp - y.sp,
      name: (x, y) => displayName(x).localeCompare(displayName(y), "es"),
      shiny: (x, y) => Number(!!y.shiny) - Number(!!x.shiny) || x.sp - y.sp,
      recent: (x, y) => (y.caught || y.at || 0) - (x.caught || x.at || 0),
    }[how];
    if (by) list.sort(by);
    state.boxes[b] = Array.from({ length: BOX_SIZE }, (_, i) => list[i] || null);
  }

  // ------------------------------------------------------------ Caja (PC)
  const BOX_SORTS = { dex: "Nº Pokédex", lv: "Nivel", name: "Nombre", shiny: "Variocolor primero", recent: "Más recientes" };
  let boxView = null; // caja que se estaba mirando (número o "eevee")

  async function openBox() {
    let cur = boxView ?? state.lastBox ?? 0;
    let picked = null; // uid elegido
    let dragUid = null;
    let q = "";
    let renaming = false;
    let releaseMon = null;
    let hoverTimer = null;
    let popupEl = null;
    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const find = (uid) => (uid && [...state.party, ...boxedMons()].find((m) => m.uid === uid)) || null;
    const matches = (m) => !!m && (norm(displayName(m)).includes(q) || norm(speciesName(m.sp)).includes(q) || String(m.sp) === q);
    const tcOf = (m) => TYPE_COLORS[species(lookSp(m)).t[0]] || "#888";

    const attrs = (loc) =>
      loc.kind === "party" ? `data-k="party" data-i="${loc.i}"` : loc.kind === "box" ? `data-k="box" data-b="${loc.b}" data-i="${loc.i}"` : `data-k="eevee" data-sp="${loc.sp}"`;
    const locOf = (el) => {
      const d = el?.dataset || {};
      if (d.k === "party") return { kind: "party", i: Number(d.i) };
      if (d.k === "box") return { kind: "box", b: Number(d.b), i: Number(d.i) };
      if (d.k === "eevee") return { kind: "eevee", sp: Number(d.sp) };
      return null;
    };
    const cell = (m, loc) =>
      m
        ? `<button type="button" class="pp-pc-cell${m.uid === picked ? " is-picked" : ""}${m.trade ? " is-trading" : ""}${q ? (matches(m) ? " is-match" : " is-dim") : ""}" ${attrs(loc)} data-uid="${m.uid}" draggable="true" style="--tc:${tcOf(m)}" title="${esc(displayName(m))} · Nv. ${m.lv}${m.trade ? " · en una oferta" : ""}">
            ${thumbHtml(m, 'draggable="false"')}
            ${m.shiny ? SHINY_MARK : ""}
            ${m.held ? `<img class="pp-pc-held" src="${ITEM_IMG(m.held)}" alt="" draggable="false" onerror="this.remove()">` : ""}
            <span class="pp-slot-lv">Nv.${m.lv}</span>
          </button>`
        : `<span class="pp-pc-cell is-empty" ${attrs(loc)}></span>`;

    function teamHtml() {
      return Array.from({ length: PARTY_MAX }, (_, i) => {
        const m = state.party[i];
        return m ? cell(m, { kind: "party", i }) : `<span class="pp-pc-cell is-empty is-team" data-k="party" data-i="${i}">${POKEBALL_SVG}</span>`;
      }).join("");
    }

    function tabsHtml() {
      const tabs = state.boxes.map((b, i) => {
        const n = b.filter(Boolean).length;
        const hits = q ? b.filter(matches).length : 0;
        return `<button type="button" class="pp-pc-tab pp-wall-${state.boxWalls[i]}${cur === i ? " is-active" : ""}${n >= BOX_SIZE ? " is-full" : ""}" data-tab="${i}" title="${esc(boxName(i))} · ${n}/${BOX_SIZE}">
          <span>${i + 1}</span><i><em style="width:${(n / BOX_SIZE) * 100}%"></em></i>${hits ? `<b>${hits}</b>` : ""}
        </button>`;
      });
      const ev = EEVEE_LINE.filter((sp) => state.eevee[sp]);
      const evHits = q ? ev.filter((sp) => matches(state.eevee[sp])).length : 0;
      tabs.push(`<button type="button" class="pp-pc-tab is-eevee${cur === "eevee" ? " is-active" : ""}${ev.length === EEVEE_LINE.length ? " is-full" : ""}" data-tab="eevee" title="Colección Eevee · ${ev.length}/${EEVEE_LINE.length}">
        <img src="${pngOf(133)}" alt="" draggable="false"><i><em style="width:${(ev.length / EEVEE_LINE.length) * 100}%"></em></i>${evHits ? `<b>${evHits}</b>` : ""}
      </button>`);
      return tabs.join("");
    }

    function headHtml() {
      if (cur === "eevee") {
        const n = EEVEE_LINE.filter((sp) => state.eevee[sp]).length;
        return `
          <button type="button" class="pp-pc-arrow" data-nav="-1" title="Caja anterior">${CHEVRON_L}</button>
          <div class="pp-pc-title"><b>Colección Eevee</b><small>${n}/${EEVEE_LINE.length}</small></div>
          <button type="button" class="pp-pc-arrow" data-nav="1" title="Caja siguiente">${CHEVRON_R}</button>`;
      }
      const n = state.boxes[cur].filter(Boolean).length;
      return `
        <button type="button" class="pp-pc-arrow" data-nav="-1" title="Caja anterior">${CHEVRON_L}</button>
        <div class="pp-pc-title">${
          renaming
            ? `<input type="text" class="pp-pc-rename" value="${esc(boxName(cur))}" maxlength="20" spellcheck="false" aria-label="Nombre de la caja">`
            : `<button type="button" class="pp-pc-name" data-act="rename" title="Cambiar el nombre">${esc(boxName(cur))}${icon("pencil", "pp-pc-pen")}</button>`
        }<small>${n}/${BOX_SIZE}</small></div>
        <button type="button" class="pp-pc-arrow" data-nav="1" title="Caja siguiente">${CHEVRON_R}</button>
        <span class="pp-pc-tools">
          <button type="button" class="pp-pc-tool" data-act="wall" title="Cambiar el fondo (${esc(WALLS[state.boxWalls[cur]])})">${PALETTE_SVG}</button>
          <select class="pp-pc-sort" aria-label="Ordenar la caja" ${n ? "" : "disabled"}>
            <option value="">Ordenar…</option>
            ${Object.entries(BOX_SORTS)
              .map(([k, v]) => `<option value="${k}">${v}</option>`)
              .join("")}
          </select>
        </span>`;
    }

    // Colección Eevee: Eevee en el centro y sus 8 evoluciones en octógono.
    function eeveeHtml() {
      const ring = EEVEE_LINE.slice(1);
      const have = EEVEE_LINE.filter((sp) => state.eevee[sp]).length;
      const pts = ring.map((_, k) => {
        const a = ((-90 + k * 45) * Math.PI) / 180;
        return [50 + 39 * Math.cos(a), 50 + 39 * Math.sin(a)];
      });
      const slot = (sp, pos, center) => {
        const m = state.eevee[sp];
        const tc = TYPE_COLORS[species(sp).t[0]] || "#888";
        const loc = { kind: "eevee", sp };
        return `<div class="pp-ev-slot${center ? " is-center" : ""}${m ? " is-filled" : ""}" style="left:${pos[0]}%;top:${pos[1]}%;--tc:${tc}">
          ${m ? cell(m, loc) : `<span class="pp-pc-cell is-empty pp-ev-empty" ${attrs(loc)} title="Falta ${esc(speciesName(sp))}"><img class="pp-ev-ghost" src="${pngOf(sp)}" alt="" draggable="false"></span>`}
          <span class="pp-ev-name">${esc(speciesName(sp))}</span>
        </div>`;
      };
      return `
        <div class="pp-ev${have === EEVEE_LINE.length ? " is-complete" : ""}">
          <div class="pp-ev-stage">
            <svg class="pp-ev-lines" viewBox="0 0 100 100" aria-hidden="true">
              <polygon points="${pts.map((p) => p.map((v) => v.toFixed(2)).join(",")).join(" ")}"/>
              ${pts.map(([x, y]) => `<line x1="50" y1="50" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>`).join("")}
            </svg>
            ${slot(133, [50, 50], true)}
            ${ring.map((sp, k) => slot(sp, pts[k], false)).join("")}
          </div>
          <p class="pp-ev-note">${have === EEVEE_LINE.length ? "¡Colección completa!" : "Arrastra aquí a Eevee y sus evoluciones: cada uno tiene su hueco."}</p>
        </div>`;
    }

    function infoHtml() {
      const sel = find(picked);
      if (!sel) return `<p class="pp-pc-hint">${icon("info")}<span>Toca un Pokémon y luego un hueco para moverlo, o arrástralo. También puedes soltarlo sobre una pestaña.</span></p>`;
      const loc = locate(sel);
      const s = species(sel.sp);
      const look = species(lookSp(sel));
      const where = loc.kind === "party" ? "En tu equipo" : loc.kind === "eevee" ? "En la colección Eevee" : `En ${esc(boxName(loc.b))}`;
      const inParty = loc.kind === "party";
      return `
        <div class="pp-pc-card" style="--tc:${tcOf(sel)}">
          <div class="pp-pc-card-img">${thumbHtml(sel, 'draggable="false"')}${sel.shiny ? SHINY_MARK : ""}</div>
          <div class="pp-pc-card-text">
            <b>${esc(displayName(sel))}</b>
            <small>${sel.nick ? `${esc(s.n)} · ` : ""}Nº ${String(s.id).padStart(4, "0")} · Nv. ${sel.lv}</small>
            <div class="pp-types">${look.t.map((t) => `<span class="pp-type" style="--tc:${TYPE_COLORS[t] || "#888"}">${esc(dex.types[t] || t)}</span>`).join("")}</div>
            <span class="pp-pc-card-hearts" title="Amistad">${heartsHtml(sel.fr)}</span>
            ${sel.held ? `<small class="pp-pc-card-held">${itemImg(sel.held)}${esc(itemName(sel.held))}</small>` : ""}
            <small class="pp-pc-where">${where}</small>
          </div>
        </div>
        <div class="pp-pc-btns">
          ${
            inParty
              ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-pc="tobox" ${sel.trade || state.party.length <= 1 || !boxFree() ? "disabled" : ""}>${BOX_SVG}A la caja</button>`
              : `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-pc="toparty" ${partyFull() ? "disabled" : ""}>${icon("plus")}Al equipo</button>`
          }
          <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-pc="release" ${sel.trade || (inParty && state.party.length <= 1) ? "disabled" : ""}>${icon("trash")}Liberar</button>
        </div>`;
    }

    function paint() {
      const p = popupEl;
      if (!p) return;
      p.querySelector(".pp-pc-team").innerHTML = teamHtml();
      p.querySelector(".pp-pc-tcount").textContent = `${state.party.length}/${PARTY_MAX}`;
      p.querySelector(".pp-pc-total").textContent = `${boxedMons().length} guardados`;
      p.querySelector(".pp-pc-info").innerHTML = infoHtml();
      p.querySelector(".pp-pc-tabs").innerHTML = tabsHtml();
      p.querySelector(".pp-pc-boxhead").innerHTML = headHtml();
      const stage = p.querySelector(".pp-pc-stage");
      stage.className = `pp-pc-stage ${cur === "eevee" ? "is-eevee" : `pp-wall-${state.boxWalls[cur]}`}`;
      stage.innerHTML =
        cur === "eevee"
          ? eeveeHtml()
          : `<div class="pp-pc-grid">${state.boxes[cur].map((m, i) => cell(m, { kind: "box", b: cur, i })).join("")}</div>`;
      const ren = p.querySelector(".pp-pc-rename");
      if (ren) {
        ren.focus();
        ren.select();
      }
    }

    function go(to) {
      cur = to;
      boxView = cur;
      if (cur !== "eevee") state.lastBox = cur;
      renaming = false;
      paint();
    }

    function commit() {
      save();
      render();
      paint();
    }

    function finishRename(keep) {
      const input = popupEl?.querySelector(".pp-pc-rename");
      if (!renaming || !input) return;
      renaming = false;
      if (keep) {
        const v = input.value.trim().slice(0, 20);
        state.boxNames[cur] = v && v !== `Caja ${cur + 1}` ? v : "";
        save();
      }
      paint();
    }

    // Soltar sobre una pestaña: al primer hueco libre de esa caja.
    function dropOnTab(mon, tab) {
      if (tab === "eevee") {
        if (!EEVEE_LINE.includes(mon.sp)) return showNotification("La colección Eevee es solo para Eevee y sus evoluciones.", "error"), false;
        return moveTo(mon, { kind: "eevee", sp: mon.sp });
      }
      const b = Number(tab);
      const i = state.boxes[b].indexOf(null);
      if (i < 0) return showNotification(`${boxName(b)} está llena.`, "error"), false;
      return moveTo(mon, { kind: "box", b, i });
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Cajas",
      width: 1100,
      html: `
        <div class="pp-pc">
          <aside class="pp-pc-left">
            <div class="pp-pc-sec"><b>Equipo</b><em class="pp-pc-tcount"></em></div>
            <div class="pp-pc-team"></div>
            <div class="pp-pc-info"></div>
          </aside>
          <section class="pp-pc-main">
            <div class="pp-pc-toolbar">
              <label class="pp-pc-searchbox">${icon("search")}<input type="text" class="pp-pc-search" placeholder="Buscar en todas las cajas" spellcheck="false" autocomplete="off"></label>
              <span class="pp-pc-total"></span>
            </div>
            <div class="pp-pc-tabs"></div>
            <div class="pp-pc-boxhead"></div>
            <div class="pp-pc-stage"></div>
          </section>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-pc-popup" },
      didOpen: (popup) => {
        popupEl = popup;
        paint();
        popup.querySelector(".pp-pc-search").addEventListener("input", (e) => {
          q = norm(e.target.value.trim());
          paint();
        });
        popup.addEventListener("change", (e) => {
          if (!e.target.matches(".pp-pc-sort") || !e.target.value || cur === "eevee") return;
          sortBox(cur, e.target.value);
          commit();
        });
        popup.addEventListener("keydown", (e) => {
          if (!e.target.matches(".pp-pc-rename")) return;
          if (e.key === "Enter") finishRename(true);
          else if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            finishRename(false);
          }
        });
        popup.addEventListener("focusout", (e) => e.target.matches(".pp-pc-rename") && finishRename(true));
        popup.addEventListener("click", (e) => {
          const tab = e.target.closest("[data-tab]");
          if (tab) return go(tab.dataset.tab === "eevee" ? "eevee" : Number(tab.dataset.tab));
          const nav = e.target.closest("[data-nav]");
          if (nav) {
            const order = [...state.boxes.keys(), "eevee"];
            const k = order.indexOf(cur);
            return go(order[(k + Number(nav.dataset.nav) + order.length) % order.length]);
          }
          const act = e.target.closest("[data-act]")?.dataset.act;
          if (act === "rename") {
            renaming = true;
            return paint();
          }
          if (act === "wall") {
            state.boxWalls[cur] = (state.boxWalls[cur] + 1) % WALLS.length;
            save();
            return paint();
          }
          const b = e.target.closest("[data-pc]");
          if (b) {
            const mon = find(picked);
            if (!mon) return;
            const k = b.dataset.pc;
            if (k === "release") {
              releaseMon = mon;
              return Swal.close();
            }
            if ((k === "tobox" && toBox(mon)) || (k === "toparty" && toParty(mon))) commit();
            return paint();
          }
          const c = e.target.closest(".pp-pc-cell");
          if (!c) return;
          const uid = c.dataset.uid || null;
          const a = find(picked);
          // Con uno elegido, tocar otro sitio lo mueve (o los cambia).
          if (a && uid !== picked && moveTo(a, locOf(c))) {
            picked = a.uid;
            return commit();
          }
          picked = uid && uid !== picked ? uid : null;
          paint();
        });
        popup.addEventListener("dragstart", (e) => {
          const c = e.target.closest?.(".pp-pc-cell[data-uid]");
          if (!c) return;
          dragUid = c.dataset.uid;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", dragUid);
          c.classList.add("is-dragging");
          popup.classList.add("is-dragging");
        });
        const endDrag = () => {
          dragUid = null;
          clearTimeout(hoverTimer);
          popup.classList.remove("is-dragging");
          popup.querySelectorAll(".is-dragging, .is-over").forEach((el) => el.classList.remove("is-dragging", "is-over"));
        };
        popup.addEventListener("dragend", endDrag);
        popup.addEventListener("dragover", (e) => {
          const t = dragUid && e.target.closest(".pp-pc-cell, .pp-pc-tab");
          if (!t) return;
          e.preventDefault();
          if (!t.classList.contains("is-over")) {
            popup.querySelectorAll(".is-over").forEach((el) => el.classList.remove("is-over"));
            t.classList.add("is-over");
            clearTimeout(hoverTimer);
            // Quedarse encima de una pestaña la abre (para soltarlo en un hueco concreto).
            if (t.dataset.tab) {
              const to = t.dataset.tab === "eevee" ? "eevee" : Number(t.dataset.tab);
              if (to !== cur) hoverTimer = setTimeout(() => dragUid && go(to), 650);
            }
          }
        });
        popup.addEventListener("drop", (e) => {
          const t = dragUid && e.target.closest(".pp-pc-cell, .pp-pc-tab");
          const mon = find(dragUid);
          if (!t || !mon) return endDrag();
          e.preventDefault();
          const ok = t.dataset.tab ? dropOnTab(mon, t.dataset.tab) : moveTo(mon, locOf(t));
          endDrag();
          if (ok) {
            picked = mon.uid;
            commit();
          } else paint();
        });
      },
      willClose: () => {
        clearTimeout(hoverTimer);
        popupEl = null;
      },
    });
    if (releaseMon) {
      await release(releaseMon);
      openBox();
    }
  }

  // ------------------------------------------------------------ Visitas
  function legendPool() {
    return dex.species.filter(isLegendary);
  }

  // Con el parque cerrado solo entran los legendarios con la amistad al máximo.
  const closedPool = () => legendPool().filter((x) => (state.legends[x.id]?.fr || 0) >= FRIENDSHIP_MAX);

  function toggleClosed() {
    state.closed = !state.closed;
    if (state.closed) {
      const v = state.visitor;
      if (v && v.fr < FRIENDSHIP_MAX) {
        v.leaves = 0;
        checkVisitorLeave();
      }
      if (selectedUid && monByUid(selectedUid)?.wild) selectedUid = null;
    }
    refreshWild();
    showNotification(state.closed ? "Parque cerrado: solo están tus Pokémon." : "Parque abierto.");
    save();
    render();
  }

  function summonVisitor(sp) {
    const pool = state.closed ? closedPool() : legendPool();
    if (!pool.length && !species(sp)) return;
    const s =
      species(sp) && isLegendary(species(sp))
        ? species(sp)
        : species(pickWeighted(pool.map((x) => [x.id, visitWeight(state.legends[x.id]?.fr || 0)])));
    const memo = (state.legends[s.id] ||= { fr: VISIT_START_FRIENDSHIP, visits: 0 });
    memo.visits++;
    window.Achievements?.track("legends");
    state.visitor = {
      uid: `v${now().toString(36)}`,
      sp: s.id,
      nick: "",
      lv: VISIT_LEVEL,
      exp: expForLevel(VISIT_LEVEL),
      fr: Math.max(0, memo.fr),
      g: s.g === -1 ? null : Math.random() * 8 < s.g ? "f" : "m",
      // Como en los juegos: al menos tres estadísticas perfectas.
      iv: Array.from({ length: 6 }, (_, i) => (i < 3 ? 31 : Math.floor(Math.random() * 32))).sort(() => Math.random() - 0.5),
      held: null,
      visitor: true,
      arrived: now(),
      leaves: now() + VISIT_MS,
      seen: false,
    };
    refreshWild(); // el visitante ocupa uno de los 10 huecos de salvajes
    save();
    render();
    announceVisitor();
  }

  // Si ya pasaron sus 8 h (aunque la app estuviera cerrada), se marcha.
  function checkVisitorLeave() {
    const v = state.visitor;
    // Los que llegaron cuando las visitas duraban 24 h se quedan 8 como mucho.
    if (v && v.arrived && v.leaves > v.arrived + VISIT_MS) v.leaves = v.arrived + VISIT_MS;
    if (!v || now() < v.leaves) return false;
    (state.legends[v.sp] ||= { fr: 0, visits: 1 }).fr = v.fr;
    state.visitor = null;
    if (selectedUid === v.uid) selectedUid = null;
    const hearts = Math.round((v.fr / FRIENDSHIP_MAX) * 5 * 10) / 10;
    showNotification(`${speciesName(v.sp)} se ha marchado del parque. Recordará vuestra amistad (${String(hearts).replace(".", ",")} de 5 corazones).`);
    save();
    render();
    return true;
  }

  // Expulsar al legendario: se marcha ya, molesto, y pierde la amistad.
  async function expelVisitor() {
    const v = state.visitor;
    if (!v) return;
    const name = speciesName(v.sp);
    const ok = await confirmDialog({
      title: `¿Expulsar a ${name}?`,
      text: `Se irá molesto y perderá toda su amistad contigo.`,
      confirmText: "Expulsar",
      danger: true,
      iconName: "x",
    });
    if (!ok || state.visitor !== v) return;
    const memo = (state.legends[v.sp] ||= { fr: 0, visits: 1 });
    memo.fr = EXPEL_FRIENDSHIP;
    memo.expelled = (memo.expelled || 0) + 1;
    state.visitor = null;
    if (selectedUid === v.uid) selectedUid = null;
    refreshWild();
    showNotification(`${name} se ha marchado del parque muy molesto.`, "error");
    save();
    render();
  }

  // Presentación a pantalla: si el PokéPark no está a la vista se avisa con
  // una notificación y la presentación sale al entrar.
  async function announceVisitor() {
    const v = state.visitor;
    if (!v || v.seen) return;
    const visible = document.getElementById("pokepark")?.classList.contains("active");
    if (!visible || Swal.isVisible() || evoRunning) {
      if (!v.notified) {
        v.notified = true;
        showNotification(`¡Un Pokémon ${legendKind(species(v.sp)).toLowerCase()} ha llegado al PokéPark!`);
        save();
      }
      if (visible) setTimeout(announceVisitor, 1500);
      return;
    }
    v.seen = true;
    save();
    const s = species(v.sp);
    const memo = state.legends[v.sp] || { visits: 1 };
    selectedUid = v.uid;
    render();
    await openModal({
      width: 440,
      html: `
        <div class="pp-arrival">
          <div class="pp-arrival-stage">
            <div class="pp-arrival-glow"></div>
            ${spriteHtml(v.sp, "pp-arrival-img")}
          </div>
          <span class="pp-legend-badge">${legendKind(s)}</span>
          <h3 class="pp-evo-title">¡${esc(s.n)} ha venido de visita!</h3>
          <p class="pp-evo-text">${
            memo.visits > 1 ? `Es su visita número ${memo.visits}.` : "Es la primera vez que viene a tu parque."
          } Se quedará 8 horas con tus Pokémon. Dale bayas y cepíllalo para ganarte su amistad: cuanta más tenga, más veces volverá.</p>
          <button type="button" class="sl-btn sl-btn-primary" data-close>¡Bienvenido!</button>
        </div>`,
      showConfirmButton: false,
      customClass: { popup: "sl-modal-sm pp-evo-popup pp-arrival-popup" },
      didOpen: (popup) => {
        hydrate(popup);
        popup.querySelector("[data-close]").onclick = () => Swal.close();
      },
    });
    hop(v.uid);
  }

  // ------------------------------------------------------------ Latido
  function tick() {
    if (!ready) return;
    checkVisitorLeave();
    if (!state.party.length) return;
    tickCount++;
    let dirty = refreshWild();
    if (checkMegas()) dirty = true;

    if (tickCount % EXP_EVERY_TICKS === 0) {
      for (const mon of parkMons()) gainExp(mon, 10 + mon.lv * 4);
      dirty = true;
    }
    if (tickCount % PASSIVE_FRIENDSHIP_TICKS === 0) {
      for (const mon of parkMons()) addFriendship(mon, 1);
      dirty = true;
    }
    if (tickCount % 2 === 0) syncTrades();

    // Visita al azar (solo una a la vez y con algún Pokémon en el parque)
    if (!state.visitor && Math.random() < VISIT_CHANCE && (!state.closed || closedPool().length)) {
      summonVisitor();
      return;
    }
    if (state.visitor) dirty = true; // cuenta atrás de la visita en el panel

    // Objetos que aparecen en el parque
    if (expireGround()) dirty = true;
    if (state.ground.length < GROUND_MAX && Math.random() < GROUND_CHANCE) {
      state.ground.push({ id: `g${now()}${Math.floor(Math.random() * 1000)}`, slug: randomGroundItem(), x: rand(0.06, 0.94), y: rand(0.15, 0.9), at: now() });
      dirty = true;
    }

    // Algún Pokémon encuentra una Poké Ball (lo demás hay que recogerlo)
    for (const mon of state.party) {
      if (Math.random() < FIND_CHANCE) {
        addToBag("poke-ball");
        showNotification(`¡${displayName(mon)} ha encontrado una Poké Ball!`);
        floatText(mon, "¡Ha encontrado algo!", true);
        dirty = true;
      }
    }

    if (dirty) {
      save();
      // No se repinta mientras se escribe un mote (se perdería lo escrito).
      if (!document.activeElement?.matches(".pp-nick-input")) render();
    }
    updateClock();
  }

  // ------------------------------------------------------------ Render
  function selected() {
    return selectedUid ? monByUid(selectedUid) : null;
  }

  function render() {
    if (!root || !ready) return;
    renderSide();
    renderParkStatic();
    syncActors();
    renderGround();
    layoutGround();
    hydrate(root);
  }

  function shell() {
    root.innerHTML = `
      <aside class="pp-side">
        <div class="pp-team"></div>
        <div class="pp-detail"></div>
      </aside>
      <div class="pp-park" data-tod="day">
        <canvas class="pp-canvas" aria-hidden="true"></canvas>
        <div class="pp-ground"><div class="pp-items"></div><div class="pp-mons"></div></div>
        <div class="pp-hud">
          <span class="pp-hud-left"><span class="pp-chip pp-clock"></span><span class="pp-chip pp-money" title="Tus Pokédólares">${COIN_SVG}<b></b></span></span>
          <span class="pp-hud-right">
            <button type="button" class="pp-chip pp-hud-btn pp-gate-btn" data-pp="gate"></button>
          </span>
        </div>
        <div class="pp-empty"></div>
        <nav class="pp-chip pp-dock" aria-label="Acciones del parque">
          <button type="button" class="pp-dock-btn" data-pp="shop" data-tip="Tienda" aria-label="Tienda">${SHOP_SVG}</button>
          <button type="button" class="pp-dock-btn" data-pp="games" data-tip="Minijuegos" aria-label="Minijuegos">${GAMES_SVG}</button>
          <button type="button" class="pp-dock-btn" data-pp="tasks" data-tip="Encargos" aria-label="Encargos">${TASKS_SVG}<em class="pp-trade-badge pp-task-badge" style="display:none"></em></button>
          <button type="button" class="pp-dock-btn" data-pp="pokedex" data-tip="Pokédex" aria-label="Pokédex">${POKEDEX_SVG}</button>
          <button type="button" class="pp-dock-btn" data-pp="trades" data-tip="Intercambios" aria-label="Intercambios">${TRADE_SVG}<em class="pp-trade-badge" style="display:none"></em></button>
          <span class="pp-dock-sep" aria-hidden="true"></span>
          <button type="button" class="pp-dock-btn is-tool is-berry" data-pp="berries" data-tip="Dar una baya" aria-label="Dar una baya">${itemImg("oran-berry")}</button>
          <button type="button" class="pp-dock-btn is-tool is-comb" data-pp="comb" data-tip="Cepillar" aria-label="Cepillar"><img src="${combSrc()}" alt="" draggable="false"></button>
          <button type="button" class="pp-dock-btn is-tool pp-ball-btn" data-pp="ball" data-tip="Sacar una Poké Ball" aria-label="Sacar una Poké Ball">${POKEBALL_IMG}</button>
          <button type="button" class="pp-bag-btn" data-tip="Bolsa" aria-label="Abrir la bolsa">${BAG_SVG}</button>
          <span class="pp-dock-sep" aria-hidden="true"></span>
          <button type="button" class="pp-dock-btn pp-fs-btn" data-pp="fullscreen" data-tip="Pantalla completa" aria-label="Pantalla completa (Esc para salir)">${FS_SVG}</button>
        </nav>
      </div>`;

    root.addEventListener("click", onRootClick);
    root.addEventListener("keydown", (e) => {
      if (e.target.matches(".pp-nick-input") && (e.key === "Enter" || e.key === "Escape")) {
        if (e.key === "Escape") e.target.value = selected()?.nick || "";
        e.preventDefault();
        e.target.blur();
      }
    });
    root.addEventListener("focusout", (e) => {
      if (!e.target.matches(".pp-nick-input")) return;
      const mon = selected();
      if (!mon) return;
      const v = e.target.value.trim().slice(0, 12);
      const nick = v && v !== speciesName(mon.sp) ? v : "";
      if (nick !== (mon.nick || "")) {
        mon.nick = nick;
        save();
        render();
      }
    });
    bindHand();
    updateClock();
  }

  // Bloque de megaevolución de la ficha (solo si lleva su megapiedra).
  // También el Fuerte Afecto de Greninja (amistad al máximo).
  function megaBox(mon, mega, on) {
    const bond = bondFor(mon);
    const wrong = !mega && megaStones.has(mon.held) ? `<p class="pp-mega-note">${esc(itemName(mon.held))} es de ${esc(stoneOwner(mon.held))}: a ${esc(displayName(mon))} no le sirve.</p>` : "";
    const bondHint = !bond && bondForm(mon) && !on ? `<p class="pp-mega-note">Con la amistad al máximo despertará el Fuerte Afecto.</p>` : "";
    if (on) {
      const isBond = mon.megaKey === "bond";
      const pct = Math.max(0, Math.min(100, (megaLeft(mon) / MEGA_MS) * 100));
      return `<div class="pp-mega is-on ${isBond ? "is-bond" : ""}">
        <div class="pp-mega-head">${isBond ? BOND_SVG : MEGA_SVG}<span><b>${isBond ? "Fuerte Afecto" : "Megaevolucionado"}</b><small>Vuelve a la normalidad en ${fmtDuration(megaLeft(mon))}</small></span></div>
        <div class="pp-mega-bar"><span style="width:${pct}%"></span></div>
      </div>${wrong}`;
    }
    const wait = megaCooldown(mon);
    const btn = (form, isBond) => `
      <button type="button" class="pp-mega-btn ${isBond ? "is-bond" : ""}" data-pp="${isBond ? "bond" : "mega"}" ${wait ? "disabled" : ""} title="${wait ? "Necesita descansar antes de volver a transformarse" : `Se convierte en ${esc(form.n)} durante 2 horas`}">
        ${isBond ? BOND_SVG : MEGA_SVG}<span><b>${isBond ? "Fuerte Afecto" : "Megaevolucionar"}</b><small>${wait ? `Disponible en ${fmtDuration(wait)}` : `${esc(form.n)} · 2 h`}</small></span>
      </button>`;
    const btns = [bond && btn(bond, true), mega && btn(mega, false)].filter(Boolean).join("");
    return `${btns ? `<div class="pp-mega">${btns}</div>` : ""}${wrong}${bondHint}`;
  }

  function expPct(m) {
    if (m.lv >= 100) return 100;
    const cur = expForLevel(m.lv);
    return Math.max(0, Math.min(100, ((m.exp - cur) / (expForLevel(m.lv + 1) - cur)) * 100));
  }

  function renderSide() {
    const team = root.querySelector(".pp-team");
    const sel = selected();
    const slots = [];
    for (let i = 0; i < PARTY_MAX; i++) {
      const m = state.party[i];
      slots.push(
        m
          ? `<button type="button" class="pp-slot ${sel && m.uid === sel.uid ? "is-active" : ""} ${m.trade ? "is-trading" : ""}" style="--tc:${TYPE_COLORS[species(lookSp(m)).t[0]] || "#888"}" data-pp="select" data-uid="${m.uid}" title="${esc(displayName(m))}${m.trade ? " (en intercambio)" : ""}">
               ${thumbHtml(m)}
               ${m.shiny ? SHINY_MARK : ""}
               <span class="pp-slot-lv">Nv.${m.lv}</span>
               <i class="pp-slot-exp"><em style="width:${expPct(m)}%"></em></i>
             </button>`
          : state.starter && !unlimited()
            ? `<span class="pp-slot is-empty is-locked" title="Hueco libre">${POKEBALL_SVG}</span>`
            : `<button type="button" class="pp-slot is-empty" data-pp="pick" title="Elegir tu Pokémon inicial">${icon("plus")}</button>`
      );
    }
    const v = state.visitor;
    const visit = v
      ? `<button type="button" class="pp-visit ${sel && v.uid === sel.uid ? "is-active" : ""}" data-pp="select" data-uid="${v.uid}" title="${esc(displayName(v))}">
           ${thumbHtml(v)}
           <span><small>De visita · ${legendKind(species(v.sp))}</small><b>${esc(displayName(v))}</b></span>
           <em>${fmtDuration(v.leaves - now())}</em>
         </button>`
      : state.closed
        ? `<p class="pp-visit is-empty" title="Solo entran legendarios con la amistad al máximo">Parque cerrado</p>`
        : `<p class="pp-visit is-empty" title="Vienen de visita al azar durante 8 horas">Ningún legendario de visita</p>`;
    team.innerHTML = `
      <div class="pp-team-head"><span class="section-eyebrow">PokéPark</span><span class="pp-team-count">${state.party.length}/${PARTY_MAX}</span>${
        state.party.length || boxedMons().length ? `<button type="button" class="pp-box-btn" data-pp="box" title="Cajas: guarda Pokémon y elige tu equipo">${BOX_SVG}Cajas<em>${boxedMons().length}</em></button>` : ""
      }</div>
      <div class="pp-slots">${slots.join("")}</div>
      ${state.party.length || v ? visit : ""}
      <div class="pp-work" hidden></div>`;
    renderWork();

    const det = root.querySelector(".pp-detail");
    if (!sel && state.party.length) {
      det.innerHTML = `
        <div class="pp-overview">
          ${state.party
            .map((m) => {
              const cur = expForLevel(m.lv);
              // Para el visitante la barra es el tiempo que le queda en el parque.
              const pct = m.visitor
                ? Math.max(0, Math.min(100, ((m.leaves - now()) / VISIT_MS) * 100))
                : m.lv >= 100
                  ? 100
                  : Math.max(0, Math.min(100, ((m.exp - cur) / (expForLevel(m.lv + 1) - cur)) * 100));
              return `<button type="button" class="pp-ov-row ${m.visitor ? "is-visitor" : ""}" data-pp="select" data-uid="${m.uid}">
                <span class="pp-ov-avatar"><img src="${pngOf(lookSp(m))}" alt="" onerror="this.style.visibility='hidden'"></span>
                <span class="pp-ov-text">
                  <span class="pp-ov-top"><b>${esc(displayName(m))}</b><small>${m.visitor ? `De visita · ${fmtDuration(m.leaves - now())}` : `Nv. ${m.lv}`}</small></span>
                  <i title="${m.visitor ? "Tiempo de visita" : "Experiencia"}"><em style="width:${pct}%"></em></i>
                  <span class="pp-ov-hearts" title="Amistad">${heartsHtml(m.fr)}</span>
                </span>
              </button>`;
            })
            .join("")}
        </div>`;
      return;
    }
    if (!sel) {
      det.innerHTML = `
        <div class="pp-welcome">
          <h3>Tu parque está vacío</h3>
          <p>Elige a tu compañero.</p>
          <button type="button" class="sl-btn sl-btn-primary" data-pp="pick">${icon("plus")}Elegir Pokémon</button>
        </div>`;
      return;
    }
    const s = species(sel.sp);
    const mega = megaFor(sel);
    const megaOn = megaActive(sel);
    const look = species(lookSp(sel)); // la forma mega mientras dura
    const stats = statsOf(sel);
    const cur = expForLevel(sel.lv);
    const next = expForLevel(sel.lv + 1);
    const pct = sel.lv >= 100 ? 100 : Math.max(0, Math.min(100, ((sel.exp - cur) / (next - cur)) * 100));
    const fi = feedInfo(sel);
    const cleanWait = cleanWaitOf(sel);
    const hints = evolutionHints(sel);
    const gSym = sel.g === "m" ? MALE_SVG : sel.g === "f" ? FEMALE_SVG : "";
    const gName = sel.g === "m" ? "Macho" : "Hembra";
    const gender = !gSym
      ? ""
      : canChooseGender(sel) && !sel.visitor
        ? `<button type="button" class="pp-g is-${sel.g} is-toggle" data-pp="gender" title="Cambiar a ${sel.g === "m" ? "hembra" : "macho"}" aria-label="${gName}">${gSym}</button>`
        : `<span class="pp-g is-${sel.g}" title="Esta especie solo puede ser ${sel.g === "m" ? "macho" : "hembra"}" aria-label="${gName}">${gSym}</span>`;

    det.innerHTML = `
      <div class="pp-card">
        <p class="pp-cooldowns">
          ${fi.left ? `Comidas con experiencia: ${fmtCount(fi.left)}/${FEED_MAX}` : `Lleno · vuelve a tener hambre en ${fmtDuration(fi.resetIn)}`}
          ${cleanWait > 0 ? ` · Cepillado (${fmtDuration(cleanWait)})` : ""}
        </p>
        <div class="pp-portrait ${sel.visitor ? "is-visitor" : ""} ${sel.shiny ? "is-shiny" : ""} ${megaOn ? "is-mega" : ""}">${spriteHtml(look.id, "pp-portrait-img", sel.shiny)}</div>
        <div class="pp-name-row">
          ${
            sel.visitor
              ? `<h3 class="pp-visitor-name">${esc(s.n)}</h3>`
              : `<label class="pp-nick" title="Pulsa para ponerle un mote">
            <input class="pp-nick-input" value="${esc(displayName(sel))}" maxlength="12" spellcheck="false" aria-label="Mote">
            ${icon("pencil", "pp-nick-icon")}
          </label>`
          }
          ${gender}
        </div>
        <p class="pp-species">${sel.visitor ? `<span class="pp-legend-badge">${legendKind(s)}</span> ` : ""}${megaOn ? `<span class="pp-mega-badge ${sel.megaKey === "bond" ? "is-bond" : ""}">${sel.megaKey === "bond" ? BOND_SVG : MEGA_SVG}${esc(look.n)}</span> ` : ""}${sel.shiny ? `<span class="pp-shiny-badge">${SHINY_IC}Variocolor</span> ` : ""}${sel.nick ? `${esc(s.n)} · ` : ""}Nº ${String(s.id).padStart(4, "0")}${sel.ot ? ` · EO ${esc(sel.ot)}` : ""}</p>
        <div class="pp-types">${look.t.map((t) => `<span class="pp-type" style="--tc:${TYPE_COLORS[t] || "#888"}">${esc(dex.types[t] || t)}</span>`).join("")}</div>
        ${
          sel.visitor
            ? `<div class="pp-visit-info">
                 <div class="pp-level"><span class="pp-lv">De visita</span><span class="pp-exp-text">Se marcha en ${fmtDuration(sel.leaves - now())}</span></div>
                 <div class="pp-exp pp-visit-bar"><span style="width:${Math.max(0, Math.min(100, ((sel.leaves - now()) / VISIT_MS) * 100))}%"></span></div>
                 <p class="pp-visit-note">Visita nº ${state.legends[sel.sp]?.visits || 1}.</p>
               </div>`
            : ""
        }

        <div class="pp-level">
          <span class="pp-lv">Nv. <b>${sel.lv}</b></span>
          <span class="pp-exp-text">${sel.lv >= 100 ? "Nivel máximo" : `${Math.max(0, sel.exp - cur)} / ${next - cur} EXP`}</span>
        </div>
        <div class="pp-exp"><span style="width:${pct}%"></span></div>

        <div class="pp-friend"><span class="pp-friend-label">Amistad</span><span class="pp-hearts">${heartsHtml(sel.fr)}</span></div>

        <div class="pp-stats">
          ${stats
            .map(
              (v, i) => `<div class="pp-stat"><span>${STAT_LABELS[i]}</span><b>${v}</b><i><em style="width:${Math.min(100, (look.s[i] / 160) * 100)}%"></em></i></div>`
            )
            .join("")}
        </div>

        ${
          sel.visitor
            ? ""
            : `<div class="pp-held">
          <span class="pp-held-label">Objeto</span>
          ${
            sel.held
              ? `<span class="pp-held-item">${itemImg(sel.held)}${esc(itemName(sel.held))}</span>
                 <button type="button" class="pp-link" data-pp="unequip">Quitar</button>`
              : `<span class="pp-held-none">Ninguno</span>`
          }
        </div>
        ${megaBox(sel, mega, megaOn)}`
        }

        ${
          sel.visitor
            ? ""
            : hints.length
            ? `<div class="pp-evo-hints"><span class="pp-held-label">Evolución</span>${hints
                .map(
                  (h) => `<p class="${h.blocked ? "is-blocked" : ""}"><img src="${SPRITE_PNG(species(h.to).sd)}" alt="" onerror="this.style.display='none'"><span><b>${esc(speciesName(h.to))}</b>${esc(h.text)}</span></p>`
                )
                .join("")}</div>`
            : `<div class="pp-evo-hints"><span class="pp-held-label">Evolución</span><p class="is-final"><span>No evoluciona más.</span></p></div>`
        }

        ${
          sel.visitor
            ? `<div class="pp-more">
                 <div class="pp-more-btns">
                   <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-pp="expel">${icon("x")}Expulsar</button>
                 </div>
               </div>`
            : `<div class="pp-more">
                 ${sel.trade ? `<p class="pp-trade-note">${TRADE_SVG}En una oferta de intercambio.</p>` : ""}
                 <div class="pp-more-btns">
                   <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-pp="trade" ${sel.trade ? "disabled" : ""}>${TRADE_SVG}Intercambiar</button>
                   <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-pp="tobox" ${sel.trade || state.party.length <= 1 || !boxFree() ? "disabled" : ""} title="Sale del parque y se guarda en la caja">${BOX_SVG}A la caja</button>
                   <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-pp="release" ${sel.trade || state.party.length <= 1 ? "disabled" : ""}>${icon("trash")}Liberar</button>
                 </div>
               </div>`
        }
      </div>`;
  }

  function renderParkStatic() {
    const incoming = trades.list.filter((t) => !t.outgoing && t.status === "pending").length;
    const badge = root.querySelector('[data-pp="trades"] .pp-trade-badge');
    badge.textContent = incoming || "";
    badge.style.display = incoming ? "" : "none";
    const gate = root.querySelector(".pp-gate-btn");
    gate.innerHTML = `${state.closed ? LOCK_SVG : UNLOCK_SVG}<span>${state.closed ? "Abrir parque" : "Cerrar parque"}</span>`;
    gate.title = state.closed ? "Volverán los Pokémon salvajes" : "Sin salvajes ni visitas: solo tus Pokémon";
    gate.classList.toggle("is-closed", !!state.closed);
    renderMoney(); // el último saldo conocido, también sin conexión
    root.querySelector(".pp-park").classList.toggle("is-closed", !!state.closed);
    const empty = root.querySelector(".pp-empty");
    empty.innerHTML = state.party.length
      ? ""
      : `<div class="pp-empty-card"><p>Aquí vivirán tus Pokémon</p><button type="button" class="sl-btn sl-btn-primary" data-pp="pick">${icon("plus")}Elegir tu Pokémon inicial</button></div>`;
  }

  function updateClock() {
    if (!root) return;
    renderWork();
    const tod = timeOfDay();
    const park = root.querySelector(".pp-park");
    if (park && park.dataset.tod !== tod) {
      park.dataset.tod = tod;
      paintScenery(true);
    }
    const c = root.querySelector(".pp-clock");
    if (c) {
      const d = new Date();
      c.innerHTML = `${tod === "day" ? SUN_SVG : MOON_SVG}${tod === "day" ? "Día" : "Noche"} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }


  function renderGround() {
    const box = root.querySelector(".pp-items");
    const ids = new Set(state.ground.map((g) => g.id));
    box.querySelectorAll(".pp-ground-item").forEach((el) => !ids.has(el.dataset.id) && el.remove());
    for (const g of state.ground) {
      if (box.querySelector(`[data-id="${g.id}"]`)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pp-ground-item";
      el.dataset.id = g.id;
      el.dataset.pp = "pickup";
      el.title = `Recoger ${itemName(g.slug)}`;
      el.style.left = `${g.x * 100}%`;
      el.style.top = `${g.y * 100}%`;
      el.innerHTML = itemImg(g.slug);
      box.appendChild(el);
    }
  }

  // ------------------------------------------------------------ Paseo libre
  const actors = new Map(); // uid -> { el, x, y, tx, ty, idleUntil, facing }
  const transforming = new Set(); // uids en plena animación de megaevolución
  let rafId = null;
  let lastFrame = 0;

  // El suelo por el que pueden andar empieza un poco por debajo del
  // horizonte del dibujo, así nunca pisan el cielo ni las colinas.
  function layoutGround() {
    paintScenery();
    const ground = root?.querySelector(".pp-ground");
    if (!ground || !scenery.horizonPx) return;
    ground.style.top = `${Math.round(scenery.horizonPx + 22)}px`;
  }
  window.addEventListener("resize", () => layoutGround());
  document.addEventListener("fullscreenchange", () => {
    const park = root?.querySelector(".pp-park");
    const fs = document.fullscreenElement === park;
    park?.classList.toggle("is-fullscreen", fs);
    setTimeout(layoutGround, 50);
  });

  // ------------------------------------------------------------ Paisaje pixel art
  // Se dibuja a baja resolución (cada "píxel" del dibujo son PX píxeles de
  // pantalla) y se amplía sin suavizar, con el mismo aspecto que los sprites.
  // Los colores salen del tema activo; de noche cambia la paleta y salen la
  // luna y las estrellas.
  const PX = 3;
  const scenery = { key: "", horizonPx: 0 };

  function cssColor(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = v || "#000";
    const out = c.fillStyle; // normaliza a #rrggbb, o rgba(...) si es translúcido
    if (out.startsWith("#")) return [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    // Translúcido (tema Liquid Glass): se mezcla sobre el color de fondo.
    const [r, g, b, a = 1] = out.match(/[\d.]+/g).map(Number);
    const under = name === "--ink-950" ? [0, 0, 0] : cssColor("--ink-950");
    return mix(under, [r, g, b], a);
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const shade = (c, t) => (t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [0, 0, 0], -t));
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  function seeded(seed) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function paintScenery(force = false) {
    const park = root?.querySelector(".pp-park");
    const canvas = root?.querySelector(".pp-canvas");
    if (!park || !canvas || !park.clientWidth) return;
    const W = park.clientWidth;
    const H = park.clientHeight;
    const theme = `${document.documentElement.getAttribute("data-theme")}|${document.documentElement.getAttribute("data-effect")}`;
    const night = timeOfDay() === "night";
    const key = `${W}x${H}|${theme}|${night}`;
    if (!force && key === scenery.key) return;
    scenery.key = key;

    const aw = Math.ceil(W / PX);
    const ah = Math.ceil(H / PX);
    canvas.width = aw;
    canvas.height = ah;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    const rnd = seeded(1234);
    const px = (x, y, c, w = 1, h = 1) => {
      g.fillStyle = rgb(c);
      g.fillRect(Math.round(x), Math.round(y), w, h);
    };
    const disc = (cx, cy, r, c) => {
      g.fillStyle = rgb(c);
      for (let y = -r; y <= r; y++) {
        const half = Math.floor(Math.sqrt(r * r - y * y));
        g.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1);
      }
    };

    // Paleta
    // Un estilo puede dar colores propios al paisaje (Liquid Glass, cuyos
    // fondos son translúcidos); si no, salen del fondo y las tarjetas.
    const sceneVar = (name, fallback) =>
      cssColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim() ? name : fallback);
    const accent = cssColor("--red-500");
    const base = sceneVar("--pp-scene-base", "--ink-950");
    const card = sceneVar("--pp-scene-card", "--ink-900");
    const light = document.documentElement.getAttribute("data-tone") === "light";
    const nightTint = [16, 20, 52];
    const n = (c) => (night ? mix(c, nightTint, light ? 0.55 : 0.45) : c);
    const skyTop = n(mix(light ? shade(base, -0.05) : shade(base, 0.08), accent, light ? 0.18 : 0.28));
    const skyBot = n(mix(light ? base : shade(card, 0.12), accent, light ? 0.06 : 0.12));
    const hillFar = n(mix(mix(card, accent, 0.3), skyTop, 0.35));
    const hillMid = n(mix(card, accent, light ? 0.32 : 0.38));
    const treeDark = n(shade(mix(card, accent, 0.45), light ? -0.25 : -0.15));
    const treeLight = n(shade(mix(card, accent, 0.45), 0.12));
    const grass = n(mix(light ? shade(card, -0.05) : shade(card, 0.08), accent, light ? 0.24 : 0.3));
    const grassDark = shade(grass, -0.14);
    const grassLight = shade(grass, 0.12);
    const path = n(mix(grass, [214, 182, 128], 0.45));
    const water = n(mix([74, 150, 210], accent, 0.18));
    const trunk = n([110, 76, 52]);

    // Cielo en bandas con tramado entre una y otra
    const horizon = Math.round(ah * 0.42);
    const bands = 7;
    for (let b = 0; b < bands; b++) {
      const y0 = Math.floor((horizon * b) / bands);
      const y1 = Math.floor((horizon * (b + 1)) / bands);
      const c = mix(skyTop, skyBot, b / (bands - 1));
      px(0, y0, c, aw, y1 - y0);
      if (b < bands - 1) {
        const next = mix(skyTop, skyBot, (b + 1) / (bands - 1));
        for (let x = (y1 % 2); x < aw; x += 2) px(x, y1 - 1, next);
      }
    }

    // Sol o luna, estrellas, nubes
    const sx = Math.round(aw * 0.84);
    const sy = Math.round(horizon * 0.32);
    if (night) {
      for (let i = 0; i < aw * 0.25; i++) {
        const c = rnd() < 0.2 ? [255, 255, 255] : mix([255, 255, 255], skyTop, 0.45);
        px(rnd() * aw, rnd() * horizon * 0.9, c);
      }
      disc(sx, sy, 8, [236, 238, 250]);
      disc(sx + 3, sy - 2, 7, mix([236, 238, 250], skyTop, 0.25));
      disc(sx - 3, sy + 2, 1, [200, 204, 222]);
      disc(sx - 1, sy - 3, 1, [210, 214, 230]);
    } else {
      disc(sx, sy, 13, mix([255, 236, 170], skyTop, 0.55));
      disc(sx, sy, 9, [255, 240, 186]);
      disc(sx - 2, sy - 2, 4, [255, 250, 220]);
    }
    const cloud = night ? mix(skyTop, [255, 255, 255], 0.12) : mix(skyBot, [255, 255, 255], light ? 0.7 : 0.55);
    const cloudShade = shade(cloud, -0.08);
    for (let i = 0; i < Math.max(3, Math.round(aw / 90)); i++) {
      const cx = rnd() * aw;
      const cy = 6 + rnd() * horizon * 0.45;
      const w = 18 + rnd() * 22;
      g.fillStyle = rgb(cloudShade);
      g.fillRect(Math.round(cx - w / 2), Math.round(cy + 2), Math.round(w), 3);
      disc(cx - w / 4, cy, 4, cloud);
      disc(cx + w / 5, cy - 1, 5, cloud);
      disc(cx, cy - 3, 5, cloud);
      g.fillStyle = rgb(cloud);
      g.fillRect(Math.round(cx - w / 2), Math.round(cy), Math.round(w), 3);
    }

    // Colinas lejanas y hilera de árboles
    const ridge = (yBase, amp, freq, phase, c, top) => {
      for (let x = 0; x < aw; x++) {
        const y = Math.round(yBase - amp * (Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.3 + phase * 1.7) * 0.4));
        px(x, y, c, 1, ah - y);
        if (top) px(x, y, top);
      }
    };
    ridge(horizon - 10, 7, 0.03, 1.2, hillFar, shade(hillFar, 0.08));
    ridge(horizon - 2, 5, 0.045, 3.1, hillMid, shade(hillMid, 0.1));
    for (let x = -4; x < aw + 6; x += 7 + Math.floor(rnd() * 5)) {
      const r = 4 + Math.floor(rnd() * 3);
      const y = horizon - 3 - Math.round(rnd() * 2);
      disc(x, y, r, treeDark);
      disc(x - 1, y - 1, r - 2, mix(treeDark, treeLight, 0.4));
    }

    // Suelo con textura
    px(0, horizon, grass, aw, ah - horizon);
    for (let x = 0; x < aw; x += 2) px(x + ((x / 2) % 2), horizon, grassDark);
    for (let i = 0; i < aw * ah * 0.012; i++) {
      const x = rnd() * aw;
      const y = horizon + 2 + rnd() * (ah - horizon);
      px(x, y, rnd() < 0.5 ? grassDark : grassLight);
    }

    // Camino que sube desde abajo hacia el horizonte
    for (let y = horizon + 1; y < ah; y++) {
      const t = (y - horizon) / (ah - horizon);
      const cx = aw * (0.58 + Math.sin(t * 3.2) * 0.07);
      const half = 2 + t * aw * 0.055;
      px(cx - half, y, path, Math.round(half * 2), 1);
      if (y % 3 === 0) px(cx - half, y, shade(path, -0.1));
      if (y % 4 === 1) px(cx + half * 0.3, y, shade(path, 0.08));
    }

    // Estanque
    const pcx = Math.round(aw * 0.2);
    const pcy = Math.round(horizon + (ah - horizon) * 0.62);
    const prx = Math.max(16, Math.round(aw * 0.11));
    const pry = Math.max(5, Math.round(prx * 0.3));
    for (let y = -pry - 1; y <= pry + 1; y++) {
      const half = Math.floor(prx * Math.sqrt(Math.max(0, 1 - (y / (pry + 1)) ** 2)));
      px(pcx - half - 1, pcy + y, shade(grass, -0.22), half * 2 + 3, 1);
    }
    for (let y = -pry; y <= pry; y++) {
      const half = Math.floor(prx * Math.sqrt(1 - (y / (pry + 0.5)) ** 2));
      px(pcx - half, pcy + y, y < -pry / 2 ? shade(water, -0.12) : water, half * 2 + 1, 1);
    }
    for (let i = 0; i < 4; i++) px(pcx - prx * 0.5 + i * prx * 0.3, pcy - 1 + (i % 2) * 2, shade(water, 0.3), 3, 1);

    // Árboles grandes en los laterales
    const bigTree = (x, yBase, r) => {
      px(x - 2, yBase - r - 2, trunk, 5, r + 2);
      px(x - 2, yBase - r - 2, shade(trunk, -0.2), 1, r + 2);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(x - r, yBase - 1, r * 2, 2);
      disc(x, yBase - r * 2, r, treeDark);
      disc(x - r * 0.55, yBase - r * 1.6, r * 0.7, treeDark);
      disc(x + r * 0.6, yBase - r * 1.65, r * 0.65, treeDark);
      disc(x - r * 0.25, yBase - r * 2.25, r * 0.6, treeLight);
      disc(x - r * 0.4, yBase - r * 2.4, r * 0.25, shade(treeLight, 0.15));
    };
    bigTree(Math.round(aw * 0.05), horizon + 10, 12);
    bigTree(Math.round(aw * 0.95), horizon + 14, 14);
    bigTree(Math.round(aw * 0.78), horizon + 4, 8);

    // Matas, flores y hierba alta
    for (let i = 0; i < 5; i++) {
      const x = rnd() * aw;
      const y = horizon + 3 + rnd() * 10;
      disc(x, y, 3, treeDark);
      disc(x + 3, y, 3, treeDark);
      disc(x + 1, y - 1, 2, treeLight);
    }
    const petal = night ? shade(accent, -0.2) : accent;
    for (let i = 0; i < aw * 0.12; i++) {
      const x = rnd() * aw;
      const y = horizon + 6 + rnd() * (ah - horizon - 8);
      if (Math.abs(x - pcx) < prx + 4 && Math.abs(y - pcy) < pry + 4) continue;
      if (rnd() < 0.5) {
        px(x, y, rnd() < 0.5 ? petal : [250, 245, 235]);
        px(x, y + 1, grassDark);
      } else {
        px(x, y, grassDark);
        px(x + 1, y - 1, grassDark);
        px(x + 2, y, grassDark);
      }
    }

    const scale = H / ah;
    scenery.horizonPx = horizon * scale;
  }

  new MutationObserver(() => {
    if (ready) {
      paintScenery(true);
      layoutGround();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-effect"] });

  function groundRect() {
    const g = root?.querySelector(".pp-ground");
    return g ? { w: g.clientWidth, h: g.clientHeight } : { w: 0, h: 0 };
  }

  function syncActors() {
    const layer = root.querySelector(".pp-mons");
    const { w, h } = groundRect();
    const alive = new Set(allMons().map((m) => m.uid));
    for (const [uid, a] of actors) {
      if (!alive.has(uid)) {
        a.el.remove();
        actors.delete(uid);
      }
    }
    for (const mon of allMons()) {
      let a = actors.get(mon.uid);
      if (!a) {
        const el = document.createElement("div");
        el.className = `pp-mon${mon.visitor ? " is-visitor" : ""}`;
        el.innerHTML = "";
        el.dataset.uid = mon.uid;
        el.dataset.pp = "select";
        // Si el parque aún no tiene tamaño (oculto), se coloca en el primer fotograma.
        a = { el, x: rand(0.06, 0.94) * w, y: rand(0.12, 0.92) * h, place: !w, tx: 0, ty: 0, idleUntil: now() + rand(300, 2500), facing: 1, sp: null };
        layer.appendChild(el);
        actors.set(mon.uid, a);
      }
      // Durante la animación se sigue viendo la forma normal hasta el destello.
      const sp = transforming.has(mon.uid) ? mon.sp : lookSp(mon);
      const look = `${sp}${mon.shiny ? "s" : ""}`;
      if (a.sp !== look) {
        a.sp = look;
        a.el.innerHTML = `<span class="pp-mon-ring"></span><span class="pp-mon-shadow"></span>${spriteHtml(sp, "pp-mon-img", mon.shiny)}<span class="pp-mon-ball">${POKEBALL_IMG}</span><span class="pp-mon-name"></span>`;
        hydrate(a.el);
      }
      a.el.classList.toggle("is-wild", !!mon.wild);
      a.el.classList.toggle("is-shiny", !!mon.shiny);
      a.el.classList.toggle("is-mega", sp !== mon.sp);
      a.el.classList.toggle("is-catching", catching.has(mon.uid));
      a.el.querySelector(".pp-mon-name").textContent = `${displayName(mon)}${mon.wild ? ` · Nv.${mon.lv}` : ""}`;
      a.el.classList.toggle("is-selected", mon.uid === selected()?.uid);
    }
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame(t) {
    rafId = null;
    const visible = document.getElementById("pokepark")?.classList.contains("active");
    if (!visible && hand) cancelHand();
    // Fuera del PokéPark no se anima nada: el bucle se para y onShow() lo
    // vuelve a poner en marcha (antes seguía 60 veces por segundo).
    if (!visible) {
      lastFrame = 0;
      return;
    }
    const dt = Math.min(0.05, (t - (lastFrame || t)) / 1000);
    lastFrame = t;
    if (visible) {
      const { w, h } = groundRect();
      for (const [uid, a] of actors) {
        const mon = monByUid(uid);
        if (!mon || !w) continue;
        if (a.place) {
          a.place = false;
          a.x = rand(0.06, 0.94) * w;
          a.y = rand(0.12, 0.92) * h;
        }
        // Quieto mientras se le captura o se le cepilla.
        const still = catching.has(uid) || transforming.has(uid) || (hand?.kind === "comb" && hand.target === uid);
        if (still || now() < a.idleUntil) {
          a.el.classList.remove("is-walking");
        } else {
          if (!a.tx && !a.ty) {
            a.tx = rand(0.06, 0.94) * w;
            a.ty = rand(0.12, 0.92) * h;
          }
          const dx = a.tx - a.x;
          const dy = a.ty - a.y;
          const dist = Math.hypot(dx, dy);
          const speed = 34 + (species(mon.sp).s[5] || 50) * 0.18;
          if (dist < 3) {
            a.tx = a.ty = 0;
            a.idleUntil = now() + rand(1500, 6000);
          } else {
            const step = Math.min(dist, speed * dt);
            a.x += (dx / dist) * step;
            a.y += (dy / dist) * step;
            if (Math.abs(dx) > 2) a.facing = dx > 0 ? -1 : 1; // los sprites miran a la izquierda
            a.el.classList.add("is-walking");
          }
        }
        a.x = Math.max(0, Math.min(w, a.x));
        a.y = Math.max(0, Math.min(h, a.y));
        const depth = 0.78 + (a.y / h) * 0.32; // más grande cuanto más cerca
        // Solo se toca el estilo si ha cambiado (los quietos no recalculan nada).
        const tf = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) scale(${depth.toFixed(3)})`;
        if (a.tf !== tf) {
          a.tf = tf;
          a.el.style.transform = tf;
        }
        if (a.face !== a.facing) {
          a.face = a.facing;
          a.el.style.setProperty("--face", a.facing);
        }
        const z = 10 + Math.round(a.y);
        if (a.z !== z) {
          a.z = z;
          a.el.style.zIndex = String(z);
        }
      }
    }
    rafId = requestAnimationFrame(frame);
  }

  function actorOf(mon) {
    return actors.get(mon.uid)?.el || null;
  }

  function floatText(mon, text, soft = false) {
    const el = actorOf(mon);
    if (!el) return;
    const f = document.createElement("span");
    f.className = `pp-float ${soft ? "is-soft" : ""}`;
    f.textContent = text;
    el.appendChild(f);
    setTimeout(() => f.remove(), 1600);
  }

  function sparkle(mon, n = 6) {
    const el = actorOf(mon);
    if (!el) return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "pp-spark";
      s.style.setProperty("--dx", `${rand(-50, 50)}px`);
      s.style.setProperty("--dy", `${rand(-90, -30)}px`);
      s.style.animationDelay = `${i * 60}ms`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 1200);
    }
  }

  function hop(uid) {
    const el = actors.get(uid)?.el;
    if (!el) return;
    el.classList.remove("is-hop");
    void el.offsetWidth;
    el.classList.add("is-hop");
  }

  // ------------------------------------------------------------ Clicks
  function onRootClick(e) {
    const t = e.target.closest("[data-pp]");
    if (!t) {
      // Clic en el parque (no en un Pokémon/objeto/bolsa): sin selección.
      if (e.target.closest(".pp-park") && !e.target.closest(".pp-dock") && selectedUid) {
        selectedUid = null;
        render();
      }
      return;
    }
    const act = t.dataset.pp;
    const mon = selected();
    if (act === "select" && monByUid(t.dataset.uid)?.wild) {
      // Los salvajes no abren ficha: su nombre sale al pasar el ratón.
      return;
    } else if (act === "select") {
      // Pulsar el que ya está seleccionado lo deselecciona.
      selectedUid = selectedUid === t.dataset.uid ? null : t.dataset.uid;
      if (selectedUid) hop(selectedUid);
      render();
    } else if (act === "fullscreen") {
      const park = root.querySelector(".pp-park");
      if (document.fullscreenElement) document.exitFullscreen();
      else {
        park?.requestFullscreen?.().catch(() => {});
        window.Achievements?.track("fullscreen");
      }
    } else if (act === "gender" && mon && canChooseGender(mon)) {
      mon.g = mon.g === "m" ? "f" : "m";
      save();
      render();
    } else if (act === "pick") openPicker();
    else if (act === "ball") toggleBall();
    else if (act === "comb") toggleComb();
    else if (act === "berries") {
      if (hand?.kind === "berry" || document.querySelector(".pp-feed-menu")) {
        cancelHand();
        closeFeedMenu();
      } else openFeedMenu(t);
    }
    else if (act === "release" && mon && !mon.wild && !mon.visitor) release(mon);
    else if (act === "expel" && mon?.visitor) expelVisitor();
    else if (act === "trade" && mon && !mon.wild && !mon.visitor) openTrades(mon.uid);
    else if (act === "trades") openTrades();
    else if (act === "box") openBox();
    else if (act === "tobox" && mon && state.party.includes(mon)) {
      const name = displayName(mon);
      if (toBox(mon)) {
        const at = locate(mon);
        showNotification(`${name} se ha guardado en ${at?.kind === "box" ? boxName(at.b) : "la caja"}.`);
        save();
        render();
      }
    }
    else if (act === "shop") openShop();
    else if (act === "work") claimWork();
    else if (act === "tasks") openTasks();
    else if (act === "pokedex") openPokedex();
    else if (act === "games") openGames();
    else if (act === "gate") toggleClosed();
    else if (act === "mega" && mon && !mon.wild && !mon.visitor) megaEvolve(mon);
    else if (act === "bond" && mon && !mon.wild && !mon.visitor) megaEvolve(mon, true);
    else if (act === "unequip" && mon?.held) {
      endMega(mon);
      addToBag(mon.held);
      showNotification(`Has guardado ${itemName(mon.held)} en la bolsa.`);
      mon.held = null;
      save();
      render();
    } else if (act === "pickup") {
      const g = state.ground.find((x) => x.id === t.dataset.id);
      if (!g) return;
      state.ground = state.ground.filter((x) => x !== g);
      t.remove();
      if (g.slug === "shiny-charm") {
        state.shinyCharm = true;
        window.Achievements?.track("shinyCharm");
        showNotification("¡Has encontrado el Amuleto Iris!");
      } else {
        addToBag(g.slug);
        showNotification(`Has recogido ${itemName(g.slug)}.`);
      }
      bump("pickup");
      save();
      render();
    }
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".pp-bag-btn")) openBag();
    if (!e.target.closest(".pp-feed-menu") && !e.target.closest('[data-pp="berries"]')) closeFeedMenu();
  });

  // ------------------------------------------------------------ Dar de comer
  function closeFeedMenu() {
    document.querySelector(".pp-feed-menu")?.remove();
  }

  function openFeedMenu(anchor) {
    closeFeedMenu();
    const berries = Object.keys(BERRIES).filter((b) => have(b) > 0);
    const menu = document.createElement("div");
    menu.className = "pp-feed-menu";
    menu.innerHTML = berries.length
      ? `<p class="pp-feed-title">Coge una baya y dásela a un Pokémon</p>
         ${berries
           .map(
             (b) => `<button type="button" class="pp-feed-opt" data-berry="${b}">
               ${itemImg(b)}<span><b>${esc(BERRIES[b].n)}</b><small>${esc(BERRIES[b].desc)}</small></span><em>×${fmtCount(have(b))}</em>
             </button>`
           )
           .join("")}`
      : `<p class="pp-feed-title">No tienes bayas</p>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.max(12, Math.min(window.innerWidth - menu.offsetWidth - 12, r.left))}px`;
    menu.style.top = `${r.top - mh - 8 > 12 ? r.top - mh - 8 : r.bottom + 8}px`;
    menu.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-berry]");
      if (!opt) return;
      closeFeedMenu();
      startHand("berry", opt.dataset.berry);
    });
  }

  // ------------------------------------------------------------ Elegir Pokémon
  async function openPicker() {
    // Los testers pueden elegir otro inicial siempre que haya hueco.
    if (unlimited() && state.party.length >= PARTY_MAX) return showNotification(`Tu equipo está lleno (${PARTY_MAX}).`, "error");
    if (state.starter && !unlimited()) {
      showNotification("Ya elegiste tu inicial.", "error");
      return;
    }
    const list = STARTERS.map(species).filter(Boolean);
    const types = Object.keys(dex.types);
    let q = "";
    let type = "";
    let gen = "";
    let chosen = null;

    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    function renderGrid(popup) {
      const grid = popup.querySelector(".pp-pick-grid");
      const nq = norm(q);
      const items = list.filter(
        (s) =>
          (!nq || norm(s.n).includes(nq) || String(s.id) === nq) &&
          (!type || s.t.includes(type)) &&
          (!gen || s.gen === Number(gen))
      );
      grid.innerHTML = items.length
        ? items
            .map(
              (s) => `
          <button type="button" class="pp-pick" data-id="${s.id}" title="${esc(s.n)}">
            <img src="${SPRITE_PNG(s.sd)}" loading="lazy" alt="" onerror="this.onerror=null;this.src='${s.sprite || ""}'">
            <span class="pp-pick-name">${esc(s.n)}</span>
            <span class="pp-pick-types">${s.t.map((t) => `<i style="--tc:${TYPE_COLORS[t]}"></i>`).join("")}</span>
          </button>`
            )
            .join("")
        : `<p class="sl-hint">Ningún Pokémon coincide con la búsqueda.</p>`;
      popup.querySelector(".pp-pick-count").textContent = `${items.length} Pokémon`;
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Elige tu Pokémon inicial",
      width: 860,
      html: `
        <div class="pp-picker">
          <div class="pp-pick-bar">
            <input type="text" class="pp-pick-search" placeholder="Buscar por nombre o número" spellcheck="false">
            <select class="pp-pick-type"><option value="">Todos los tipos</option>${types
              .map((t) => `<option value="${t}">${esc(dex.types[t])}</option>`)
              .join("")}</select>
            <select class="pp-pick-gen"><option value="">Todas las generaciones</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9]
              .map((g) => `<option value="${g}">${g}ª generación</option>`)
              .join("")}</select>
          </div>
          <p class="pp-pick-note"><span class="pp-pick-count"></span> · El resto se captura en el parque.</p>
          <div class="pp-pick-grid"></div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-picker-popup" },
      didOpen: (popup) => {
        renderGrid(popup);
        const search = popup.querySelector(".pp-pick-search");
        search.focus();
        search.addEventListener("input", () => {
          q = search.value.trim();
          renderGrid(popup);
        });
        popup.querySelector(".pp-pick-type").addEventListener("change", (e) => {
          type = e.target.value;
          renderGrid(popup);
        });
        popup.querySelector(".pp-pick-gen").addEventListener("change", (e) => {
          gen = e.target.value;
          renderGrid(popup);
        });
        popup.querySelector(".pp-pick-grid").addEventListener("click", (e) => {
          const b = e.target.closest(".pp-pick");
          if (!b) return;
          chosen = Number(b.dataset.id);
          Swal.close();
        });
      },
    });
    if (!chosen) return;

    const s = species(chosen);
    const left = PARTY_MAX - state.party.length - 1;
    const ok = await confirmDialog({
      title: `¿Elegir a ${s.n}?`,
      text: `Será tu inicial y no se puede cambiar.`,
      confirmText: `Elegir a ${s.n}`,
      iconName: "sparkles",
    });
    if (!ok) return openPicker();

    const mon = {
      uid: `p${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      sp: s.id,
      nick: "",
      lv: START_LEVEL,
      exp: expForLevel(START_LEVEL),
      fr: START_FRIENDSHIP,
      g: randomGender(s),
      iv: randomIvs(),
      held: null,
      shiny: rollShiny(s),
      at: now(),
    };
    if ((state.starter && !unlimited()) || state.party.length >= PARTY_MAX) return;
    state.party.push(mon);
    state.starter = true;
    refreshWild();
    selectedUid = mon.uid;
    save();
    render();
    hop(mon.uid);
    showNotification(`¡${s.n}${mon.shiny ? " variocolor" : ""} se ha unido a tu parque!`);
  }

  // ------------------------------------------------------------ Bolsa
  async function openBag() {
    let tab = "berries";
    let action = null; // { slug, mode: 'use' | 'equip' }

    const groups = () => {
      const entries = unlimited()
        ? [...new Set([...Object.keys(BERRIES), ...shopStock(), ...megaStones])].map((s) => [s, Infinity])
        : Object.entries(state.bag).filter(([, n]) => n > 0);
      return {
        berries: entries.filter(([s]) => isBerry(s)),
        use: entries.filter(([s]) => !isBerry(s) && useItems.has(s)),
        held: entries.filter(([s]) => !isBerry(s) && !useItems.has(s) && !EXTRA_ITEMS[s]),
        other: [...entries.filter(([s]) => s === "poke-ball"), ...(state.shinyCharm ? [["shiny-charm", 1]] : [])],
      };
    };

    function body(popup) {
      const g = groups();
      const box = popup.querySelector(".pp-bag-body");
      popup.querySelectorAll(".pp-bag-tab").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.tab === tab);
        b.querySelector("em").textContent = fmtCount(g[b.dataset.tab].reduce((a, [, n]) => a + n, 0));
      });

      if (action) {
        const verb = action.mode === "use" ? "Usar" : "Equipar";
        box.innerHTML = `
          <button type="button" class="pp-link pp-bag-back" data-bag="back">${icon("arrowUp", "pp-back-ic")}Volver</button>
          <p class="pp-bag-q">${verb} <b>${esc(itemName(action.slug))}</b> en…</p>
          <div class="pp-bag-targets">
            ${state.party
              .map((m) => {
                let note = "";
                let ok = true;
                if (action.mode === "use") {
                  ok = !!findEvolution(m, "item", action.slug);
                  note = ok ? "¡Puede evolucionar!" : "No tendría ningún efecto";
                } else {
                  note = m.held ? `Lleva ${itemName(m.held)} (se cambiará)` : "Sin objeto";
                  if (megaStones.has(action.slug)) note = megaFor({ ...m, held: action.slug }) ? "¡Podrá megaevolucionar!" : `No le sirve${m.held ? ` · lleva ${itemName(m.held)}` : ""}`;
                }
                return `<button type="button" class="pp-target ${ok ? "" : "is-off"}" data-bag="target" data-uid="${m.uid}" ${ok ? "" : "disabled"}>
                  <img src="${pngOf(m.sp)}" alt="">
                  <span><b>${esc(displayName(m))}</b><small>Nv. ${m.lv} · ${esc(note)}</small></span>
                </button>`;
              })
              .join("") || `<p class="sl-hint">Todavía no tienes Pokémon.</p>`}
          </div>`;
        return;
      }

      const list = g[tab];
      const empty = {
        berries: "No tienes bayas.",
        use: "No tienes objetos evolutivos.",
        held: "No tienes objetos para equipar.",
        other: "No tienes Poké Balls.",
      };
      box.innerHTML = list.length
        ? `<div class="pp-bag-grid">${list
            .map(([slug, n]) => {
              const btn =
                tab === "other"
                  ? `<span class="pp-bag-hint">${slug === "poke-ball" ? "Toca un salvaje" : "Objeto clave"}</span>`
                  : tab === "berries"
                  ? `<span class="pp-bag-hint">Con el botón de bayas del parque</span>`
                  : tab === "use"
                    ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bag="use" data-slug="${slug}">Usar</button>`
                    : `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bag="equip" data-slug="${slug}">Equipar</button>`;
              const sub =
                slug === "poke-ball"
                  ? "Para capturar Pokémon salvajes."
                  : slug === "shiny-charm"
                    ? "Triplica los variocolores."
                    : tab === "berries"
                  ? BERRIES[slug].desc
                  : tab === "use"
                    ? "Se gasta al usarlo para evolucionar."
                    : heldNote(slug);
              return `<div class="pp-bag-card"><span class="pp-shop-img">${itemImg(slug)}<em>×${fmtCount(n)}</em></span><span class="pp-bag-name"><b>${esc(itemName(slug))}</b><small>${esc(sub)}</small></span>${btn}</div>`;
            })
            .join("")}</div>`
        : `<p class="pp-bag-empty">${BAG_SVG}${empty[tab]}</p>`;
    }

    function heldNote(slug) {
      if (megaStones.has(slug)) return `Megapiedra de ${stoneOwner(slug)}.`;
      const trade = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "trade"));
      const level = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "level"));
      if (level) return "Equipado, evoluciona al subir de nivel.";
      if (trade) return "Equipado, evoluciona al intercambiarlo.";
      return "Objeto para equipar.";
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Bolsa",
      width: 760,
      html: `
        <div class="pp-bag">
          <div class="pp-bag-tabs">
            <button type="button" class="pp-bag-tab" data-tab="berries">Bayas <em></em></button>
            <button type="button" class="pp-bag-tab" data-tab="use">Evolutivos <em></em></button>
            <button type="button" class="pp-bag-tab" data-tab="held">Para equipar <em></em></button>
            <button type="button" class="pp-bag-tab" data-tab="other">Otros <em></em></button>
          </div>
          <div class="pp-bag-body"></div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-bag-popup" },
      didOpen: (popup) => {
        body(popup);
        popup.addEventListener("click", (e) => {
          const tabBtn = e.target.closest(".pp-bag-tab");
          if (tabBtn) {
            tab = tabBtn.dataset.tab;
            action = null;
            return body(popup);
          }
          const b = e.target.closest("[data-bag]");
          if (!b) return;
          const k = b.dataset.bag;
          if (k === "back") action = null;
          else if (k === "use" || k === "equip") action = { slug: b.dataset.slug, mode: k };
          else if (k === "target") {
            const mon = state.party.find((m) => m.uid === b.dataset.uid);
            if (!mon || !action) return;
            if (action.mode === "use") {
              const d = findEvolution(mon, "item", action.slug);
              if (!d) return;
              takeFromBag(action.slug);
              window.Achievements?.track("itemEvos");
              save();
              Swal.close();
              selectedUid = mon.uid;
              queueEvolution(mon, d);
              return;
            }
            endMega(mon);
            if (mon.held) addToBag(mon.held);
            takeFromBag(action.slug);
            mon.held = action.slug;
            showNotification(`${displayName(mon)} lleva ahora ${itemName(action.slug)}.`);
            action = null;
            save();
            render();
            // Algunos evolucionan al subir de nivel con el objeto: se avisa en la ficha.
          }
          body(popup);
        });
      },
    });
  }

  // ------------------------------------------------------------ Tienda
  // Se compran Poké Balls y objetos evolutivos; se venden bayas y objetos
  // evolutivos (por la mitad de su precio, como en los juegos).
  function shopStock() {
    const evo = [...useItems, ...heldItems].filter((s) => !ITEM_BLOCKLIST.has(s) && buyPrice(s) > 0);
    const rank = (s) => (STONE_SLUGS.has(s) ? 0 : heldItems.has(s) ? 1 : 2);
    evo.sort((a, b) => rank(a) - rank(b) || buyPrice(a) - buyPrice(b) || itemName(a).localeCompare(itemName(b), "es"));
    return ["poke-ball", ...evo];
  }

  function itemNote(slug) {
    if (megaStones.has(slug)) return `Megapiedra de ${stoneOwner(slug)}: equípasela para megaevolucionar.`;
    if (slug === "poke-ball") return "Para capturar Pokémon salvajes.";
    if (isBerry(slug)) return BERRIES[slug].desc;
    if (useItems.has(slug)) return "Objeto evolutivo: se gasta al usarlo.";
    const trade = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "trade"));
    return trade ? "Equipado, hace evolucionar al intercambiar." : "Equipado, hace evolucionar al subir de nivel.";
  }

  // Comprar y vender pasan por el servidor (econ/buy, econ/sell): él cobra
  // o paga con sus precios. Para vender mira tu bolsa en el parque
  // sincronizado, así que el objeto se quita después de que acepte.
  async function buy(slug, n = 1) {
    const cost = buyPrice(slug) * n;
    if (!cost || (state.money < cost && !unlimited())) return showNotification("No tienes Pokédólares suficientes.", "error");
    const res = await econ("econ/buy", { slug, n });
    if (!res.ok) return showNotification(res.error, "error");
    addToBag(slug, n);
    setMoney(res);
    window.Achievements?.track("purchases");
    showNotification(`Has comprado ${n > 1 ? `${n} × ` : ""}${itemName(slug)} por ${fmtMoney(res.cost ?? cost)}.`);
    render();
  }

  async function sell(slug, n = 1) {
    n = Math.min(n, state.bag[slug] || 0);
    if (!n || !sellPrice(slug)) return;
    await window.electronAPI.pokeparkSaveNow(state); // que el servidor vea la bolsa de ahora
    const res = await econ("econ/sell", { slug, n });
    if (!res.ok) return showNotification(res.error, "error");
    takeFromBag(slug, n);
    setMoney(res);
    if (econState) econState.sellLeft = res.sellLeft;
    showNotification(`Has vendido ${n > 1 ? `${n} × ` : ""}${itemName(slug)} por ${fmtMoney(res.gain)}.`);
    render();
  }

  async function openShop() {
    let tab = "buy";
    let shopBusy = false;
    const qty = new Map(); // cantidad elegida por objeto

    // Tarjeta de la tienda: imagen, nombre, nota, precio y cantidad.
    function card(slug, { price, note, mode, max = 99, team = false }) {
      const owned = have(slug);
      const n = Math.max(1, Math.min(qty.get(slug) || 1, max));
      const total = price * n;
      const can = mode === "sell" || unlimited() || state.money >= total;
      return `
        <div class="pp-shop-card${team ? " is-team" : ""}${can ? "" : " is-poor"}" data-slug="${slug}">
          <div class="pp-shop-top">
            <span class="pp-shop-img">${itemImg(slug)}</span>
            ${owned ? `<span class="pp-shop-own" title="En la bolsa">×${fmtCount(owned)}</span>` : ""}
            ${team ? `<span class="pp-team-tag">Tu equipo</span>` : ""}
          </div>
          <b class="pp-shop-name">${esc(itemName(slug))}</b>
          <small class="pp-shop-note">${esc(note)}</small>
          <div class="pp-shop-foot">
            <em class="pp-price">${mode === "sell" ? "+" : ""}${fmtMoney(price)}</em>
            ${
              max > 1
                ? `<span class="pp-qty">
                    <button type="button" data-qty="-1" ${n <= 1 ? "disabled" : ""} aria-label="Menos">−</button>
                    <span>${n}</span>
                    <button type="button" data-qty="1" ${n >= max ? "disabled" : ""} aria-label="Más">+</button>
                  </span>`
                : ""
            }
          </div>
          <button type="button" class="sl-btn ${mode === "sell" ? "sl-btn-ghost" : "sl-btn-primary"} sl-btn-sm pp-shop-go" data-shop="${mode}" data-slug="${slug}" data-n="${n}" ${can ? "" : "disabled"}>
            ${mode === "sell" ? "Vender" : "Comprar"}${n > 1 ? ` · ${fmtMoney(total)}` : ""}
          </button>
        </div>`;
    }

    function body(popup) {
      popup.querySelectorAll(".pp-bag-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
      popup.querySelector(".pp-shop-money b").textContent = unlimited() ? "∞" : fmtMoney(state.money);
      const box = popup.querySelector(".pp-bag-body");
      if (tab === "mega") {
        // Primero las que le sirven a tu equipo (o le servirán al evolucionar).
        const team = new Set(state.party.map((m) => m.sp));
        const forTeam = (slug) => [...stoneTargets(slug)].some((sp) => team.has(sp));
        const list = [...megaStones].sort((a, b) => Number(forTeam(b)) - Number(forTeam(a)) || stoneOwner(a).localeCompare(stoneOwner(b), "es") || a.localeCompare(b));
        box.innerHTML = `<p class="pp-mega-intro">${MEGA_SVG}<span>Equípale a un Pokémon su megapiedra y megaevoluciónalo desde su ficha. Dura 2 horas; después necesita descansar otras 2.</span></p>
          <div class="pp-shop-grid">${list.map((slug) => card(slug, { price: buyPrice(slug), note: `Para ${stoneOwner(slug)}.`, mode: "buy", max: 1, team: forTeam(slug) })).join("")}</div>`;
        return;
      }
      if (tab === "buy") {
        box.innerHTML = `<div class="pp-shop-grid">${shopStock()
          .map((slug) => card(slug, { price: buyPrice(slug), note: itemNote(slug), mode: "buy", max: slug === "poke-ball" ? 50 : 10 }))
          .join("")}</div>`;
        return;
      }
      const items = Object.entries(state.bag).filter(([s, n]) => n > 0 && sellPrice(s) > 0 && s !== "poke-ball");
      items.sort(([a], [b]) => Number(!isBerry(a)) - Number(!isBerry(b)) || itemName(a).localeCompare(itemName(b), "es"));
      box.innerHTML = items.length
        ? `<div class="pp-shop-grid">${items.map(([slug, n]) => card(slug, { price: sellPrice(slug), note: isBerry(slug) ? BERRIES[slug].desc : itemNote(slug), mode: "sell", max: n })).join("")}</div>`
        : `<p class="pp-bag-empty">${BAG_SVG}No tienes nada que vender.</p>`;
    }
    await openModal({
      eyebrow: "PokéPark",
      title: "Tienda",
      width: 860,
      html: `
        <div class="pp-bag pp-shop">
          <div class="pp-shop-head">
            <div class="pp-bag-tabs">
              <button type="button" class="pp-bag-tab" data-tab="buy">${SHOP_SVG}Comprar</button>
              <button type="button" class="pp-bag-tab" data-tab="mega">${MEGA_SVG}Megapiedras</button>
              <button type="button" class="pp-bag-tab" data-tab="sell">${COIN_SVG}Vender</button>
            </div>
            <span class="pp-shop-money" title="Tus Pokédólares">${COIN_SVG}<b></b></span>
          </div>
          <div class="pp-bag-body"></div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-bag-popup pp-shop-popup" },
      didOpen: (popup) => {
        body(popup);
        popup.addEventListener("click", (e) => {
          const tabBtn = e.target.closest(".pp-bag-tab");
          if (tabBtn) {
            tab = tabBtn.dataset.tab;
            return body(popup);
          }
          const q = e.target.closest("[data-qty]");
          if (q) {
            const slug = q.closest("[data-slug]").dataset.slug;
            qty.set(slug, Math.max(1, (qty.get(slug) || 1) + Number(q.dataset.qty)));
            return body(popup);
          }
          const b = e.target.closest("[data-shop]");
          if (!b || shopBusy) return;
          shopBusy = true;
          b.disabled = true;
          const done = b.dataset.shop === "buy" ? buy(b.dataset.slug, Number(b.dataset.n) || 1) : sell(b.dataset.slug, Number(b.dataset.n) || 1);
          done.finally(() => {
            shopBusy = false;
            qty.delete(b.dataset.slug);
            if (!popup.isConnected) return;
            // Animación corta en la tarjeta.
            body(popup);
            popup.querySelector(`.pp-shop-card[data-slug="${b.dataset.slug}"]`)?.classList.add("is-done");
          });
        });
      },
    });
  }

  // ------------------------------------------------------------ Intercambios
  // Con la cuenta iniciada. Ofreces un Pokémon a otro jugador; si acepta, te
  // da uno suyo a cambio. Mientras la oferta está pendiente el tuyo se queda
  // en el parque pero "reservado" (no se puede liberar ni ofrecer otra vez).
  // Al recibirlo se comprueban las evoluciones por intercambio.
  const trades = { list: [], user: null, tester: false, busy: false, rerender: null, loaded: false };

  // Testers: todo ilimitado (Poké Balls, bayas, objetos, dinero, comidas,
  // cepillado, liberaciones). Lo nuevo que tenga límite debe mirar
  // unlimited() / have() / takeFromBag(), que ya lo respetan.
  const unlimited = () => trades.tester;
  const have = (slug) => (unlimited() ? Infinity : state.bag[slug] || 0);
  const fmtCount = (n) => (Number.isFinite(n) ? String(n) : "∞");

  const cloudApi = (action, ...args) =>
    window.electronAPI.cloud(action, ...args).catch(() => ({ ok: false, error: "No se puede conectar con el servidor." }));

  function tradePayload(mon) {
    return { uid: mon.uid, sp: mon.sp, nick: mon.nick || "", lv: mon.lv, exp: mon.exp, fr: mon.fr, g: mon.g, iv: mon.iv, held: mon.held, shiny: !!mon.shiny, ot: mon.ot || trades.user || "" };
  }

  // Cambia el Pokémon "idx" del equipo por el que llega del intercambio.
  function receiveMon(idx, got, otherName, gaveSp) {
    const old = state.party[idx];
    const mon = {
      uid: newUid("p"),
      sp: got.sp,
      nick: got.nick || "",
      lv: got.lv,
      exp: Math.max(got.exp || 0, expForLevel(got.lv)),
      fr: START_FRIENDSHIP, // como en los juegos, la amistad vuelve a empezar
      g: got.g || null,
      iv: got.iv,
      held: got.held || null,
      shiny: !!got.shiny,
      ot: got.ot || otherName,
      traded: true,
      at: now(),
    };
    state.party[idx] = mon;
    if (selectedUid === old.uid) selectedUid = mon.uid;
    window.Achievements?.track("trades");
    if (!parkVisible()) showNotification(`¡Intercambio completado! ${displayName(old)} se ha ido con ${otherName} y ha llegado ${displayName(mon)}${mon.shiny ? " (variocolor)" : ""}.`);
    queueTradeAnim({ ...old }, mon, otherName);
    const d = findEvolution(mon, "trade", gaveSp);
    if (d) queueEvolution(mon, d);
    return mon;
  }

  // Animación del intercambio: tu Pokémon entra en su Poké Ball y se va, y
  // llega la del otro jugador. La ven los dos: quien acepta al momento y
  // quien ofreció en cuanto su app lo detecta (se consulta cada pocos
  // segundos mientras tenga ofertas pendientes).
  const tradeAnims = [];
  let tradeAnimRunning = false;
  const tradeAnimBusy = () => tradeAnimRunning || tradeAnims.length > 0;

  function queueTradeAnim(gave, got, other) {
    tradeAnims.push({ gave, got, other });
    runTradeAnims();
  }

  async function runTradeAnims() {
    if (tradeAnimRunning || !tradeAnims.length) return;
    if (Swal.isVisible() || !parkVisible()) {
      setTimeout(runTradeAnims, 1500);
      return;
    }
    tradeAnimRunning = true;
    const j = tradeAnims.shift();
    const gaveName = displayName(j.gave);
    const gotName = displayName(j.got);
    await openModal({
      width: 480,
      html: `
        <div class="pp-trade-anim">
          <div class="pp-ta-stage">
            <div class="pp-ta-glow"></div>
            <div class="pp-ta-mon is-mine">${spriteHtml(j.gave.sp, "", j.gave.shiny)}</div>
            <div class="pp-ta-mon is-theirs">${spriteHtml(j.got.sp, "", j.got.shiny)}</div>
            <img class="pp-ta-ball is-out" src="${ITEM_IMG("poke-ball")}" alt="">
            <img class="pp-ta-ball is-in" src="${ITEM_IMG("poke-ball")}" alt="">
          </div>
          <h3 class="pp-evo-title">¡Adiós, ${esc(gaveName)}!</h3>
          <p class="pp-evo-text">Enviando a ${esc(gaveName)} con ${esc(j.other)}…</p>
        </div>`,
      showConfirmButton: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
      customClass: { popup: "sl-modal-sm pp-evo-popup" },
      didOpen: (popup) => {
        hydrate(popup);
        const box = popup.querySelector(".pp-trade-anim");
        setTimeout(() => box.classList.add("is-running"), 300);
        setTimeout(() => {
          popup.querySelector(".pp-evo-title").textContent = `${j.other} te envía a ${speciesName(j.got.sp)}`;
          popup.querySelector(".pp-evo-text").textContent = "¡Ya llega!";
        }, 2600);
        setTimeout(() => {
          box.classList.add("is-done");
          popup.querySelector(".pp-evo-title").textContent = "¡Intercambio completado!";
          popup.querySelector(".pp-evo-text").textContent = `¡Cuida bien de ${gotName}${j.got.shiny ? " (variocolor)" : ""}!`;
          const btn = document.createElement("button");
          btn.className = "sl-btn sl-btn-primary";
          btn.textContent = "¡Genial!";
          btn.onclick = () => Swal.close();
          box.appendChild(btn);
        }, 4500);
      },
    });
    tradeAnimRunning = false;
    if (tradeAnims.length) setTimeout(runTradeAnims, 400);
    else if (evoQueue.length) setTimeout(runEvoQueue, 400);
  }

  function applyTrades(list) {
    let changed = false;
    const pendingOut = new Set();
    for (const t of list) {
      if (t.status === "pending" && t.outgoing) {
        pendingOut.add(t.id);
        const mon = state.party.find((m) => m.uid === t.monFrom?.uid);
        if (mon && mon.trade !== t.id) {
          mon.trade = t.id;
          changed = true;
        }
      }
      if (t.status === "accepted" && !t.claimed) {
        const gave = t.outgoing ? t.monFrom : t.monTo;
        const got = t.outgoing ? t.monTo : t.monFrom;
        const idx = state.party.findIndex((m) => m.uid === gave?.uid);
        if (idx >= 0 && got) {
          receiveMon(idx, got, t.outgoing ? t.to : t.from, gave.sp);
          changed = true;
        }
        cloudApi("tradeClaim", t.id);
        t.claimed = true;
      }
    }
    // Ofertas canceladas o rechazadas: el Pokémon vuelve a estar libre.
    if (!trades.busy) {
      for (const m of state.party) {
        if (m.trade && !pendingOut.has(m.trade)) {
          delete m.trade;
          changed = true;
        }
      }
    }
    // Aviso de ofertas nuevas (una sola vez por oferta).
    const seen = new Set(state.tradeSeen || []);
    for (const t of list) {
      if (!t.outgoing && t.status === "pending" && !seen.has(t.id)) {
        seen.add(t.id);
        showNotification(`${t.from} te ofrece un intercambio: ${speciesName(t.monFrom.sp)}${t.monFrom.shiny ? " variocolor" : ""} (Nv. ${t.monFrom.lv}). Míralo en PokéPark > Intercambios.`);
        changed = true;
      }
    }
    state.tradeSeen = [...seen].slice(-100);
    if (changed) {
      save();
      render();
    }
  }

  let tradeSyncing = false;
  let tradeResync = false;
  async function syncTrades() {
    if (!ready || trades.busy) return;
    // Si ya hay una en marcha se repite al acabar (p. ej. justo tras iniciar sesión).
    if (tradeSyncing) {
      tradeResync = true;
      return;
    }
    tradeSyncing = true;
    tradeResync = false;
    try {
      const st = await cloudApi("status");
      trades.user = st.ok ? st.user?.username || null : null;
      const wasTester = trades.tester;
      trades.tester = !!(st.ok && st.user?.tester);
      if (wasTester !== trades.tester && root) render();
      if (!trades.user) {
        trades.list = [];
        return;
      }
      const res = await cloudApi("trades");
      if (!res.ok) return;
      trades.list = res.trades || [];
      trades.loaded = true;
      for (const t of trades.list) for (const m of [t.monFrom, t.monTo]) if (m?.sp) dexSee(m.sp, !!m.shiny);
      applyTrades(trades.list);
    } finally {
      tradeSyncing = false;
      if (root) renderParkStatic();
      trades.rerender?.();
      if (tradeResync) syncTrades();
    }
  }

  async function tradeAction(fn) {
    if (trades.busy) return;
    trades.busy = true;
    trades.rerender?.();
    try {
      await fn();
    } finally {
      trades.busy = false;
    }
    await syncTrades();
  }

  function offerTrade(uid, to) {
    return tradeAction(async () => {
      const mon = state.party.find((m) => m.uid === uid);
      if (!mon || mon.trade) return;
      if (!to) return showNotification("Escribe el nombre del jugador.", "error");
      const res = await cloudApi("tradeOffer", to, tradePayload(mon));
      if (!res.ok) return showNotification(res.error, "error");
      mon.trade = res.id;
      showNotification(`Has ofrecido a ${displayName(mon)} a ${to}.`);
      save();
      render();
    });
  }

  function acceptTrade(t, uid) {
    return tradeAction(async () => {
      const idx = state.party.findIndex((m) => m.uid === uid);
      const mine = state.party[idx];
      if (!mine || mine.trade) return;
      mine.trade = t.id; // reservado mientras responde el servidor
      save();
      const res = await cloudApi("tradeAccept", t.id, tradePayload(mine));
      if (!res.ok) {
        delete mine.trade;
        save();
        render();
        return showNotification(res.error, "error");
      }
      const got = receiveMon(idx, res.monFrom, t.from, mine.sp);
      await cloudApi("tradeClaim", t.id);
      save();
      render();
      // Se cierra la ventana para ver la animación del intercambio.
      if (got) Swal.close();
    });
  }

  function closeTrade(t) {
    return tradeAction(async () => {
      const res = await cloudApi(t.outgoing ? "tradeCancel" : "tradeReject", t.id);
      if (!res.ok) return showNotification(res.error, "error");
      showNotification(t.outgoing ? "Oferta cancelada." : "Oferta rechazada.");
    });
  }

  function monLine(m, extra = "") {
    const s = species(m.sp);
    return `<span class="pp-tr-mon" style="--tc:${TYPE_COLORS[s?.t?.[0]] || "#888"}">${thumbHtml(m)}<span><b>${m.shiny ? SHINY_IC : ""}${esc(m.nick || s?.n || "???")}</b><small>${m.nick ? `${esc(s?.n || "")} · ` : ""}Nv. ${m.lv}${m.held ? ` · ${esc(itemName(m.held))}` : ""}${extra}</small></span></span>`;
  }

  async function openTrades(preselect) {
    let accepting = null; // oferta a la que se está eligiendo qué dar
    const STATUS = { accepted: "Completado", rejected: "Rechazado", cancelled: "Cancelado" };

    function body(popup) {
      const box = popup.querySelector(".pp-trades");
      if (!box) return;
      if (!trades.user) {
        box.innerHTML = `<div class="pp-tr-login"><p>Inicia sesión para intercambiar.</p>
          <button type="button" class="sl-btn sl-btn-primary" data-tr="login">Iniciar sesión</button></div>`;
        return;
      }
      const free = state.party.filter((m) => !m.trade);
      if (accepting) {
        box.innerHTML = `
          <button type="button" class="pp-link pp-bag-back" data-tr="back">${icon("arrowUp", "pp-back-ic")}Volver</button>
          <p class="pp-bag-q">${esc(accepting.from)} te da ${monLine(accepting.monFrom)} ¿Qué Pokémon le das a cambio?</p>
          <div class="pp-bag-targets">${
            free
              .map(
                (m) => `<button type="button" class="pp-target" data-tr="give" data-uid="${m.uid}" ${trades.busy ? "disabled" : ""}>
                  ${thumbHtml(m)}<span><b>${m.shiny ? SHINY_IC : ""}${esc(displayName(m))}</b><small>Nv. ${m.lv}${m.held ? ` · lleva ${esc(itemName(m.held))}` : ""}</small></span></button>`
              )
              .join("") || `<p class="sl-hint">No tienes Pokémon libres para dar.</p>`
          }</div>`;
        return;
      }
      const incoming = trades.list.filter((t) => !t.outgoing && t.status === "pending");
      const outgoing = trades.list.filter((t) => t.outgoing && t.status === "pending");
      const history = trades.list.filter((t) => t.status !== "pending").slice(0, 8);
      // Elegido: el de antes si sigue libre; si no, el primero libre.
      if (!free.some((m) => m.uid === preselect)) preselect = free[0]?.uid || null;
      // Jugadores con los que ya has intercambiado (para no escribirlos).
      const me = String(trades.user || "").toLowerCase();
      const recent = [...new Set(trades.list.map((t) => (t.outgoing ? t.to : t.from)).filter((n) => n && n.toLowerCase() !== me))].slice(0, 5);
      const empty = (text) => `<p class="pp-tr-empty">${TRADE_SVG}${text}</p>`;
      box.innerHTML = `
        <section class="pp-tr-sec">
          <h4>Nueva oferta</h4>
          ${
            free.length
              ? `<div class="pp-tr-pick" role="radiogroup" aria-label="Pokémon que ofreces">${state.party
                  .map((m) => {
                    const busy = !!m.trade;
                    const sel = m.uid === preselect;
                    return `<button type="button" class="pp-tr-card${sel ? " is-sel" : ""}${busy ? " is-busy" : ""}" style="--tc:${TYPE_COLORS[species(m.sp).t[0]] || "#888"}" data-tr="pick" data-uid="${m.uid}" role="radio" aria-checked="${sel}" ${busy ? "disabled" : ""}
                      title="${esc(displayName(m))} · Nv. ${m.lv}${m.held ? ` · lleva ${esc(itemName(m.held))} (viaja con él)` : ""}${busy ? " · ya está en una oferta" : ""}">
                      <span class="pp-tr-card-img">${thumbHtml(m)}${m.held ? `<img class="pp-tr-held" src="${ITEM_IMG(m.held)}" alt="" onerror="this.remove()">` : ""}</span>
                      <b>${m.shiny ? SHINY_IC : ""}${esc(displayName(m))}</b>
                      <small>${busy ? "En oferta" : `Nv. ${m.lv}`}</small>
                    </button>`;
                  })
                  .join("")}</div>
                <div class="pp-tr-send">
                  <label class="pp-tr-to-box">${icon("user", "pp-tr-to-ic")}<input type="text" class="pp-tr-to" placeholder="Nombre del jugador" maxlength="20" spellcheck="false" autocomplete="off"></label>
                  <button type="button" class="sl-btn sl-btn-primary pp-tr-offer" data-tr="offer" disabled>${TRADE_SVG}<span>Ofrecer</span></button>
                </div>
                <p class="pp-tr-msg" aria-live="polite"></p>
                ${
                  recent.length
                    ? `<div class="pp-tr-recent"><span>Recientes</span>${recent
                        .map((n) => `<button type="button" class="pp-tr-chip" data-tr="to" data-name="${esc(n)}">${esc(n)}</button>`)
                        .join("")}</div>`
                    : ""
                }`
              : empty("Todos tus Pokémon están ya en alguna oferta.")
          }
        </section>
        <section class="pp-tr-sec">
          <h4>Te ofrecen ${incoming.length ? `<em>${incoming.length}</em>` : ""}</h4>
          ${
            incoming
              .map(
                (t) => `<div class="pp-tr-row is-in">${monLine(t.monFrom, ` · de <b>${esc(t.from)}</b>`)}
                  <span class="pp-tr-btns">
                    <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-tr="accept" data-id="${t.id}" ${trades.busy ? "disabled" : ""}>Aceptar</button>
                    <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-tr="close" data-id="${t.id}" ${trades.busy ? "disabled" : ""}>Rechazar</button>
                  </span></div>`
              )
              .join("") || empty("Nadie te ha ofrecido nada todavía.")
          }
        </section>
        <section class="pp-tr-sec">
          <h4>Tus ofertas ${outgoing.length ? `<em class="is-soft">${outgoing.length}</em>` : ""}</h4>
          ${
            outgoing
              .map(
                (t) => `<div class="pp-tr-row">${monLine(t.monFrom, ` · para <b>${esc(t.to)}</b>`)}
                  <span class="pp-tr-wait">Esperando</span>
                  <span class="pp-tr-btns"><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-tr="close" data-id="${t.id}" ${trades.busy ? "disabled" : ""}>Cancelar</button></span></div>`
              )
              .join("") || empty("No tienes ofertas pendientes.")
          }
        </section>
        ${
          history.length
            ? `<section class="pp-tr-sec"><h4>Últimos</h4>${history
                .map((t) => {
                  const mon = t.outgoing ? t.monFrom : t.monFrom;
                  const who = t.outgoing ? `con ${esc(t.to)}` : `con ${esc(t.from)}`;
                  const got = t.status === "accepted" ? (t.outgoing ? t.monTo : t.monFrom) : null;
                  const gave = t.status === "accepted" ? (t.outgoing ? t.monFrom : t.monTo) : mon;
                  return `<p class="pp-tr-hist"><span class="pp-tr-st is-${t.status}">${STATUS[t.status] || t.status}</span>${
                    got ? `${esc(speciesName(gave.sp))}<span class="pp-tr-swap">${TRADE_SVG}</span>${esc(speciesName(got.sp))}` : esc(speciesName(gave.sp))
                  } · ${who}</p>`;
                })
                .join("")}</section>`
            : ""
        }`;
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Intercambios",
      width: 760,
      html: `<div class="pp-trades"><p class="sl-hint">Cargando…</p></div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-bag-popup pp-trades-popup" },
      didOpen: (popup) => {
        let to = "";
        // El botón dice qué se ofrece y a quién, y solo se activa si se puede.
        const updateSend = () => {
          const btn = popup.querySelector(".pp-tr-offer");
          if (!btn) return;
          const name = to.trim();
          const mon = state.party.find((m) => m.uid === preselect);
          const self = name && name.toLowerCase() === String(trades.user || "").toLowerCase();
          const valid = /^[A-Za-z0-9_.-]{3,20}$/.test(name);
          btn.disabled = trades.busy || !mon || !valid || self;
          btn.querySelector("span").textContent = mon && valid && !self ? `Ofrecer ${displayName(mon)} a ${name}` : mon ? `Ofrecer ${displayName(mon)}` : "Ofrecer";
          const msg = popup.querySelector(".pp-tr-msg");
          msg.textContent = self ? "No puedes intercambiar contigo." : name && !valid ? "Los nombres tienen de 3 a 20 letras, números, punto, guion o guion bajo." : "";
          popup.querySelectorAll(".pp-tr-chip").forEach((c) => c.classList.toggle("is-on", c.dataset.name.toLowerCase() === name.toLowerCase()));
        };
        const offer = () => {
          if (popup.querySelector(".pp-tr-offer")?.disabled) return;
          const uid = preselect;
          offerTrade(uid, to.trim()).then(() => {
            // Enviada: se limpia el nombre para la siguiente.
            if (state.party.find((m) => m.uid === uid)?.trade) {
              to = "";
              trades.rerender?.();
            }
          });
        };
        trades.rerender = () => {
          body(popup);
          const input = popup.querySelector(".pp-tr-to");
          if (input) {
            input.value = to;
            input.addEventListener("input", () => {
              to = input.value;
              updateSend();
            });
            input.addEventListener("keydown", (e) => e.key === "Enter" && offer());
          }
          updateSend();
          hydrate(popup);
        };
        trades.rerender();
        syncTrades();
        popup.addEventListener("click", (e) => {
          const b = e.target.closest("[data-tr]");
          if (!b) return;
          const k = b.dataset.tr;
          const t = trades.list.find((x) => x.id === Number(b.dataset.id));
          if (k === "login") {
            Swal.close();
            window.Community?.openAuth?.("login");
          } else if (k === "pick") {
            preselect = b.dataset.uid;
            popup.querySelectorAll(".pp-tr-card").forEach((c) => {
              c.classList.toggle("is-sel", c === b);
              c.setAttribute("aria-checked", String(c === b));
            });
            updateSend();
          } else if (k === "to") {
            to = b.dataset.name;
            const input = popup.querySelector(".pp-tr-to");
            input.value = to;
            input.focus();
            updateSend();
          } else if (k === "offer") {
            offer();
          } else if (k === "accept" && t) {
            accepting = t;
            trades.rerender();
          } else if (k === "back") {
            accepting = null;
            trades.rerender();
          } else if (k === "give" && accepting) {
            const t2 = accepting;
            accepting = null;
            acceptTrade(t2, b.dataset.uid);
          } else if (k === "close" && t) closeTrade(t);
        });
      },
      willClose: () => {
        trades.rerender = null;
      },
    });
  }

  // ------------------------------------------------------------ Economía
  // Desde la 3.5.7 el dinero es de la cuenta y vive en el servidor
  // (pokepark_econ.php de la API). state.money solo guarda el último saldo
  // conocido para enseñarlo. Trabajo, Pokédex, encargos, tienda y minijuegos
  // le preguntan al servidor, que hace las cuentas con su reloj y sus reglas.
  const econ = (route, body, query) =>
    window.electronAPI.cloud("econ", route, body, query).catch(() => ({ ok: false, error: "Algo ha fallado. Prueba otra vez." }));
  let econState = null; // última respuesta de econ/state
  let econAt = 0; // Date.now() cuando llegó (para seguir la hora del servidor)
  let econLoading = null;

  const serverSecs = () => (econState ? econState.now + (Date.now() - econAt) / 1000 : Date.now() / 1000);
  const MADRID_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
  const econDay = () => MADRID_DAY.format(new Date(serverSecs() * 1000));
  // La semana se nombra por su lunes, como en el servidor.
  function econWeek(day) {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  }

  async function refreshEcon() {
    if (econLoading) return econLoading;
    econLoading = (async () => {
      const res = await econ("econ/state");
      if (!res.ok) return null;
      econState = res;
      econAt = Date.now();
      setMoney(res);
      for (const n of res.notices || []) showNotification(`${n.text}: +${fmtMoney(n.amount)}.`);
      renderEcon();
      return res;
    })().finally(() => (econLoading = null));
    return econLoading;
  }

  // Saldo en la barra de arriba y en las ventanas abiertas (tienda).
  function renderMoney() {
    const txt = unlimited() ? "∞" : fmtMoney(state.money);
    document.querySelectorAll(".pp-money b, .pp-shop-money b").forEach((b) => (b.textContent = txt));
  }

  function renderEcon() {
    if (!root || !ready) return;
    renderMoney();
    renderWork();
    const badge = root.querySelector(".pp-task-badge");
    if (badge) {
      const n = econState ? taskList().filter((t) => t.done && !t.claimed).length : 0;
      badge.textContent = n || "";
      badge.style.display = n ? "" : "none";
    }
  }

  // ---------------- Trabajo del equipo
  // Cada Pokémon del equipo gana 3 ₽/h por nivel (la mitad con amistad 0,
  // entero con amistad máxima). El servidor guarda la hora del último cobro
  // y cuenta como mucho 12 h: a partir de ahí no se gana más hasta cobrar.
  const WORK_PER_LEVEL = 3; // el mismo que pokepark_econ.php
  const workRate = (m) => Math.floor(WORK_PER_LEVEL * Math.max(1, Math.min(100, m.lv || 1)) * (0.5 + (0.5 * Math.max(0, Math.min(FRIENDSHIP_MAX, m.fr || 0))) / FRIENDSHIP_MAX));

  function workInfo() {
    if (!econState?.work) return null;
    const perHour = state.party.slice(0, PARTY_MAX).reduce((a, m) => a + workRate(m), 0);
    const cap = econState.work.cap;
    const secs = Math.max(0, Math.min(cap, serverSecs() - econState.work.at));
    return { perHour, secs, cap, amount: Math.floor((perHour * secs) / 3600), full: secs >= cap };
  }

  function renderWork() {
    const box = root?.querySelector(".pp-work");
    if (!box) return;
    const w = workInfo();
    if (!w || !state.party.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.classList.toggle("is-full", w.full);
    box.title = w.full ? "Tu equipo ha llegado al máximo de 12 h: cobra para que siga trabajando." : `Se llena en ${fmtDuration((w.cap - w.secs) * 1000)}. Como mucho cuenta 12 h.`;
    box.innerHTML = `
      <span class="pp-work-ic">${WORK_SVG}</span>
      <span class="pp-work-txt"><small>Trabajo del equipo · ${fmtMoney(w.perHour)}/h</small><b>${fmtMoney(w.amount)}</b></span>
      <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-pp="work" ${w.amount >= 1 ? "" : "disabled"}>Cobrar</button>
      <i class="pp-work-bar"><em style="width:${Math.round((w.secs / w.cap) * 100)}%"></em></i>`;
  }

  let workBusy = false;
  async function claimWork() {
    if (workBusy) return;
    workBusy = true;
    try {
      await window.electronAPI.pokeparkSaveNow(state); // el servidor mira el equipo de ahora
      const res = await econ("econ/work", {});
      if (!res.ok) return showNotification(res.error, "error");
      if (econState) econState.work = res.work;
      setMoney(res);
      showNotification(res.amount ? `Tu equipo ha ganado ${fmtMoney(res.amount)} trabajando.` : "Tu equipo todavía no ha ganado nada.");
      renderEcon();
    } finally {
      workBusy = false;
    }
  }

  // ---------------- Pokédex
  // Vistos y capturados (y variocolor) por especie, como en los juegos. Va
  // en el parque (state.dex) y viaja con la cuenta. El servidor paga cada
  // especie capturada nueva (y los hitos y variocolor) una sola vez.
  let dexSets = null;
  const DEX_MAX = 1025;
  const validSp = (sp) => Number.isInteger(Number(sp)) && sp >= 1 && sp <= DEX_MAX;
  const ownedMons = () => [...state.party, ...boxedMons(), ...(state.box || [])];
  // Preevoluciones (para la primera vez: lo que evolucionó, ya lo viste).
  let prevoMap = null;
  function prevosOf(sp) {
    if (!prevoMap) {
      prevoMap = new Map();
      for (const s of dex.species) for (const d of s.evo || []) if (!prevoMap.has(d.to)) prevoMap.set(d.to, s.id);
    }
    const out = [];
    let cur = prevoMap.get(Number(sp));
    while (cur && !out.includes(cur) && out.length < 4) {
      out.push(cur);
      cur = prevoMap.get(cur);
    }
    return out;
  }

  function dexInit() {
    const d = state.dex && typeof state.dex === "object" ? state.dex : null;
    const set = (k) => new Set((Array.isArray(d?.[k]) ? d[k] : []).map(Number).filter(validSp));
    dexSets = { seen: set("seen"), caught: set("caught"), seenShiny: set("seenShiny"), caughtShiny: set("caughtShiny") };
    if (!d) for (const m of ownedMons()) for (const p of prevosOf(m.sp)) dexSets.seen.add(p);
    dexSweep(true);
    dexWrite();
  }

  function dexWrite() {
    const arr = (s) => [...s].sort((a, b) => a - b);
    state.dex = { seen: arr(dexSets.seen), caught: arr(dexSets.caught), seenShiny: arr(dexSets.seenShiny), caughtShiny: arr(dexSets.caughtShiny) };
  }

  const dexAdd = (set, sp) => {
    sp = Number(sp);
    if (!validSp(sp) || set.has(sp)) return false;
    set.add(sp);
    return true;
  };

  // Repasa lo que hay en el parque: lo tuyo cuenta como capturado y lo que
  // anda por ahí (salvajes, visitante), como visto.
  function dexSweep(quiet) {
    if (!dexSets) return false;
    let changed = false;
    let caughtNew = false;
    for (const m of ownedMons()) {
      if (dexAdd(dexSets.caught, m.sp)) changed = caughtNew = true;
      if (dexAdd(dexSets.seen, m.sp)) changed = true;
      if (m.shiny) {
        if (dexAdd(dexSets.caughtShiny, m.sp)) changed = caughtNew = true;
        if (dexAdd(dexSets.seenShiny, m.sp)) changed = true;
      }
    }
    for (const m of [...state.wild, ...(state.visitor ? [state.visitor] : [])]) {
      if (dexAdd(dexSets.seen, m.sp)) changed = true;
      if (m.shiny && dexAdd(dexSets.seenShiny, m.sp)) changed = true;
    }
    if (changed) dexWrite();
    if (caughtNew && !quiet) scheduleDexClaim();
    return changed;
  }

  // Visto fuera del parque (respuesta del Pokédle, oferta de intercambio...).
  function dexSee(sp, shiny = false) {
    if (!dexSets) return;
    let changed = dexAdd(dexSets.seen, sp);
    if (shiny && dexAdd(dexSets.seenShiny, sp)) changed = true;
    if (changed) {
      dexWrite();
      save();
    }
  }

  let dexClaimTimer = null;
  function scheduleDexClaim() {
    clearTimeout(dexClaimTimer);
    dexClaimTimer = setTimeout(() => claimDex(), 2500);
  }

  async function claimDex() {
    clearTimeout(dexClaimTimer);
    await window.electronAPI.pokeparkSaveNow(state);
    const res = await econ("econ/dex", {});
    if (!res.ok || !res.dex) return;
    setMoney(res);
    const d = res.dex;
    if (econState?.dex) econState.dex.registered = d.registered;
    if (d.species) {
      const names = d.ids.slice(0, 3).map((id) => speciesName(id)).join(", ") + (d.ids.length > 3 ? ` y ${d.ids.length - 3} más` : "");
      showNotification(`¡Nuevo en la Pokédex! ${names}: +${fmtMoney(d.species * (econState?.dex?.species || 300))}.`);
    }
    if (d.shiny) showNotification(`¡Variocolor nuevo en la Pokédex! +${fmtMoney(d.shiny * (econState?.dex?.shiny || 2000))}.`);
    if (d.milestones) showNotification(`¡${d.registered} especies en la Pokédex! Premio: +${fmtMoney(d.milestones * (econState?.dex?.milestone || 5000))}.`);
    if (d.pending) showNotification(`Hoy ya has cobrado el máximo de la Pokédex. Las ${d.pending} que faltan se pagan mañana.`);
  }

  // Generaciones por número de la Pokédex nacional.
  const DEX_GENS = [
    [1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025],
  ];
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
  let dexGen = 0;
  let dexSel = 1;

  function dexSprite(s, shiny) {
    const fb = s.sprite ? (shiny ? s.sprite.replace("/pokemon/", "/pokemon/shiny/") : s.sprite) : "";
    const src = s.sd ? SPRITE_PNG(s.sd, shiny) : fb;
    return `<img class="dex-spr" src="${src}" alt="" loading="lazy" draggable="false" onerror="this.onerror=null;${fb && s.sd ? `this.src='${fb}'` : "this.style.visibility='hidden'"}">`;
  }

  const dexNo = (id) => String(id).padStart(4, "0").replace(/^0(?=\d{3})/, "");

  function openPokedex() {
    dexSweep(true);
    const statusOf = (id) => ({
      seen: dexSets.seen.has(id),
      caught: dexSets.caught.has(id),
      seenShiny: dexSets.seenShiny.has(id),
      caughtShiny: dexSets.caughtShiny.has(id),
    });

    function cell(s) {
      const st = statusOf(s.id);
      const cls = st.caught ? "is-caught" : st.seen ? "is-seen" : "is-unseen";
      return `<button type="button" class="dex-cell ${cls}${s.id === dexSel ? " is-active" : ""}" data-dex="${s.id}" title="Nº ${dexNo(s.id)}${st.seen ? ` · ${esc(s.n)}` : ""}">
        ${dexSprite(s, st.caughtShiny)}
        <span class="dex-no">${dexNo(s.id)}</span>
        ${st.caught ? `<span class="dex-ball">${POKEBALL_IMG}</span>` : ""}
        ${st.seenShiny ? `<span class="dex-shine" title="Variocolor ${st.caughtShiny ? "capturado" : "visto"}">${DEX_SPARKLE_SVG}</span>` : ""}
      </button>`;
    }

    function screen(popup) {
      const s = species(dexSel);
      const el = popup.querySelector(".dex-screen");
      if (!s || !el) return;
      const st = statusOf(s.id);
      const types = st.seen ? s.t.map((t) => `<span class="dex-type" style="--tc:${TYPE_COLORS[t] || "#888"}">${esc(dex.types[t] || t)}</span>`).join("") : "";
      const line = st.caught ? `${POKEBALL_IMG}<span>Capturado</span>` : st.seen ? "<span>Visto</span>" : "<span>Sin ver</span>";
      el.innerHTML = `
        <div class="dex-scr-mon ${st.seen ? "" : "is-unseen"}">${dexSprite(s, st.caughtShiny)}${st.seenShiny ? `<span class="dex-shine">${DEX_SPARKLE_SVG}</span>` : ""}</div>
        <div class="dex-scr-info">
          <span class="dex-scr-no">Nº ${dexNo(s.id)}</span>
          <b class="dex-scr-name">${st.seen ? esc(s.n) : "?????"}</b>
          <span class="dex-scr-types">${types}</span>
          <span class="dex-scr-state ${st.caught ? "is-caught" : ""}">${line}</span>
          ${st.seenShiny ? `<span class="dex-scr-state is-shiny">${DEX_SPARKLE_SVG}<span>Variocolor ${st.caughtShiny ? "capturado" : "visto"}</span></span>` : ""}
        </div>`;
    }

    function grid(popup) {
      const [a, b] = DEX_GENS[dexGen];
      if (dexSel < a || dexSel > b) dexSel = a;
      const list = [];
      for (let id = a; id <= b; id++) if (species(id)) list.push(species(id));
      popup.querySelector(".dex-grid").innerHTML = list.map(cell).join("");
      popup.querySelector(".dex-grid").scrollTop = 0;
      popup.querySelectorAll(".dex-gen").forEach((g) => g.classList.toggle("is-active", Number(g.dataset.gen) === dexGen));
      const inGen = list.filter((s) => dexSets.caught.has(s.id)).length;
      popup.querySelector(".dex-gen-count").textContent = `${inGen}/${list.length}`;
      screen(popup);
    }

    const r = econState?.dex;
    openModal({
      width: 1000,
      html: `
        <div class="dex">
          <div class="dex-top">
            <span class="dex-lens" aria-hidden="true"></span>
            <span class="dex-leds" aria-hidden="true"><i class="is-red"></i><i class="is-yellow"></i><i class="is-green"></i></span>
            <span class="dex-name">Pokédex</span>
            <span class="dex-totals">
              <span><small>Vistos</small><b>${dexSets.seen.size}</b></span>
              <span><small>Capturados</small><b>${dexSets.caught.size}</b></span>
            </span>
          </div>
          <div class="dex-main">
            <div class="dex-left">
              <div class="dex-bezel">
                <span class="dex-bezel-dots" aria-hidden="true"><i></i><i></i></span>
                <div class="dex-screen"></div>
                <span class="dex-bezel-foot" aria-hidden="true"><i class="dex-red-btn"></i><span class="dex-speaker"><i></i><i></i><i></i><i></i></span></span>
              </div>
              <p class="dex-reward">${COIN_SVG}<span>Especie nueva ${fmtMoney(r?.species || 300)} · cada ${r?.every || 50}, ${fmtMoney(r?.milestone || 5000)} · variocolor nuevo ${fmtMoney(r?.shiny || 2000)}</span></p>
            </div>
            <div class="dex-right">
              <div class="dex-gens">
                ${ROMAN.map((g, i) => `<button type="button" class="dex-gen" data-gen="${i}" title="${i + 1}ª generación">${g}</button>`).join("")}
                <span class="dex-gen-count"></span>
              </div>
              <div class="dex-grid"></div>
            </div>
          </div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-dex-popup" },
      didOpen: (popup) => {
        grid(popup);
        popup.addEventListener("click", (e) => {
          const g = e.target.closest(".dex-gen");
          if (g) {
            dexGen = Number(g.dataset.gen);
            return grid(popup);
          }
          const c = e.target.closest(".dex-cell");
          if (!c) return;
          dexSel = Number(c.dataset.dex);
          popup.querySelectorAll(".dex-cell.is-active").forEach((x) => x.classList.remove("is-active"));
          c.classList.add("is-active");
          screen(popup);
        });
      },
    });
  }

  // ---------------- Encargos
  // 3 diarios y 1 semanal, los mismos para todos (los elige el servidor).
  // Capturas, bayas, cepillados, objetos recogidos y evoluciones los cuenta
  // el parque (state.tasks, que se sube con la cuenta); Pokédle, Voltorb y
  // Blackjack los cuenta el servidor.
  function bump(kind) {
    const day = econDay();
    const week = econWeek(day);
    const t = state.tasks && typeof state.tasks === "object" ? state.tasks : {};
    if (t.day !== day) Object.assign(t, { day, d: {} });
    if (t.week !== week) Object.assign(t, { week, w: {} });
    t.d[kind] = (t.d[kind] || 0) + 1;
    t.w[kind] = (t.w[kind] || 0) + 1;
    state.tasks = t;
    renderEcon();
  }

  function taskList() {
    if (!econState?.tasks) return [];
    const t = state.tasks || {};
    return econState.tasks.map((x) => {
      let progress = x.progress;
      if (!x.srv) {
        progress = x.weekly ? (t.week === econState.week ? t.w?.[x.kind] || 0 : 0) : t.day === econState.day ? t.d?.[x.kind] || 0 : 0;
      }
      progress = Math.min(progress, x.target);
      return { ...x, progress, done: progress >= x.target };
    });
  }

  const TASK_SVG = {
    catch: () => POKEBALL_IMG,
    feed: () => itemImg("oran-berry"),
    clean: () => `<img src="${combSrc()}" alt="" draggable="false">`,
    pickup: () => BAG_SVG,
    evolve: () => icon("sparkles"),
    pokedle: () => '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    voltorb: () => `<img src="assets/pokepark/voltorb/icon.png" alt="" draggable="false">`,
    bj: () => GAMES_SVG,
  };

  async function openTasks() {
    let popupEl = null;
    let busy = false;
    // Si ha cambiado el día desde la última vez, se piden los nuevos.
    if (!econState || econState.day !== econDay()) await refreshEcon();
    else refreshEcon().then(() => popupEl && paint());

    function row(t) {
      const ic = TASK_SVG[t.kind];
      const pct = Math.round((t.progress / t.target) * 100);
      return `
        <div class="pp-task${t.done ? " is-done" : ""}${t.claimed ? " is-claimed" : ""}${t.weekly ? " is-weekly" : ""}">
          <span class="pp-task-ic">${typeof ic === "function" ? ic() : ic || ""}</span>
          <span class="pp-task-txt">
            <b>${esc(t.text)}</b>
            <span class="pp-task-prog"><i><em style="width:${pct}%"></em></i><small>${t.progress}/${t.target}</small></span>
          </span>
          <span class="pp-task-reward">${COIN_SVG}${fmtMoney(t.reward)}</span>
          ${
            t.claimed
              ? `<span class="pp-task-ok">${icon("check")}Cobrado</span>`
              : `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-task="${t.key}" ${t.done && !busy ? "" : "disabled"}>Cobrar</button>`
          }
        </div>`;
    }

    function paint() {
      const p = popupEl;
      if (!p) return;
      const body = p.querySelector(".pp-tasks-body");
      if (!econState) {
        body.innerHTML = `<p class="pp-bag-empty">Necesitas conexión para ver los encargos.</p>`;
        return;
      }
      const list = taskList();
      const since = (Date.now() - econAt) / 1000;
      const dayLeft = Math.max(0, econState.dayEndsIn - since) * 1000;
      const weekLeft = Math.max(0, econState.weekEndsIn - since) * 1000;
      const days = Math.floor(weekLeft / 86400000);
      body.innerHTML = `
        <h4 class="pp-tasks-h">Hoy<small>Se renuevan en ${fmtDuration(dayLeft)}</small></h4>
        ${list.filter((t) => !t.weekly).map(row).join("")}
        <h4 class="pp-tasks-h">Esta semana<small>Quedan ${days >= 1 ? `${days} ${days === 1 ? "día" : "días"}` : fmtDuration(weekLeft)}</small></h4>
        ${list.filter((t) => t.weekly).map(row).join("")}`;
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Encargos",
      width: 640,
      html: `<div class="pp-tasks"><div class="pp-tasks-body"><p class="mg-loading">Cargando…</p></div></div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-tasks-popup" },
      didOpen: (popup) => {
        popupEl = popup;
        paint();
        popup.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-task]");
          if (!b || busy) return;
          busy = true;
          paint();
          await window.electronAPI.pokeparkSaveNow(state);
          const res = await econ("econ/task", { key: b.dataset.task });
          busy = false;
          if (!res.ok) showNotification(res.error, "error");
          else {
            econState.tasks = res.tasks;
            setMoney(res);
            showNotification(`Encargo cumplido: +${fmtMoney(res.amount)}.`);
          }
          renderEcon();
          paint();
        });
      },
      willClose: () => {
        popupEl = null;
      },
    });
  }

  // ------------------------------------------------------------ Minijuegos
  // Pokédle, Voltorb Flip y Blackjack. Se juegan en el servidor (econ/* de la
  // API, a través de minigames.js en main): él guarda la partida, cobra la
  // apuesta y paga el premio en el dinero de la cuenta. Aquí solo se pinta lo
  // que llega y se apunta el saldo nuevo.
  const mg = (action, ...args) =>
    window.electronAPI.minigames(action, ...args).catch(() => ({ ok: false, error: "Algo ha fallado. Prueba otra vez." }));
  const gameBets = { voltorb: 500, bj: 500 };
  const betTouched = { voltorb: false, bj: false }; // la primera ficha sustituye a la apuesta por defecto
  const VOLTORB_MULTS = [1.1, 1.25, 1.5, 1.85, 2.5, 2.6, 3.5, 3.5]; // los de pokepark_econ.php

  // El saldo lo decide el servidor: cada respuesta trae "money" y aquí solo
  // se apunta para enseñarlo (también sin conexión, el último conocido).
  function setMoney(res) {
    if (!res || typeof res.money !== "number") return;
    state.money = res.money;
    save();
    renderMoney();
  }

  const SUIT_SVG = {
    s: '<path d="M12 2C9 6 4 9 4 13.5A4 4 0 0 0 11 16l-1.5 5h5L13 16a4 4 0 0 0 7-2.5C20 9 15 6 12 2Z"/>',
    h: '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z"/>',
    d: '<path d="M12 2 20 12 12 22 4 12Z"/>',
    c: '<path d="M12 2.5a4 4 0 0 1 3.6 5.7A4 4 0 1 1 13 15l1.5 6h-5L11 15a4 4 0 1 1-2.6-6.8A4 4 0 0 1 12 2.5Z"/>',
  };
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const cardHtml = (c, i = 0, fresh = true) =>
    c
      ? `<span class="mg-card${fresh ? " is-new" : ""} is-${c.s === "h" || c.s === "d" ? "red" : "black"}" style="--i:${i}">
          <span class="mg-card-corner"><b>${RANKS[c.r]}</b><svg viewBox="0 0 24 24" aria-hidden="true">${SUIT_SVG[c.s]}</svg></span>
          <svg class="mg-card-pip" viewBox="0 0 24 24" aria-hidden="true">${SUIT_SVG[c.s]}</svg>
          <span class="mg-card-corner is-br"><b>${RANKS[c.r]}</b><svg viewBox="0 0 24 24" aria-hidden="true">${SUIT_SVG[c.s]}</svg></span>
        </span>`
      : `<span class="mg-card${fresh ? " is-new" : ""} is-back" style="--i:${i}"><span class="mg-card-back">${POKEBALL_SVG}</span></span>`;
  const VOLTORB_SVG =
    '<svg class="mg-voltorb" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f4f1ea"/><path d="M2 12a10 10 0 0 1 20 0Z" fill="#d6322b"/><path d="M2 12h20" stroke="#2a1d1a" stroke-width="1.2"/><path d="M6.5 8.8l3.6 1.4M17.5 8.8l-3.6 1.4" stroke="#2a1d1a" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="10" fill="none" stroke="#2a1d1a" stroke-width="1.2"/></svg>';

  // Fichas de casino para apostar (sumar) y el importe editable.
  const CHIPS = [
    { n: 100, c: "is-white" },
    { n: 500, c: "is-red" },
    { n: 1000, c: "is-blue" },
    { n: 5000, c: "is-black" },
  ];
  function betPanel(game, label) {
    const v = gameBets[game];
    const max = unlimited() ? Infinity : state.money;
    return `
      <div class="mg-bet" data-game="${game}">
        <span class="mg-bet-label">Apuesta</span>
        <label class="mg-bet-input">${COIN_SVG}<input type="number" class="mg-bet-val" min="100" step="100" value="${v}" aria-label="Apuesta"></label>
        <div class="mg-chips">
          ${CHIPS.map((ch) => `<button type="button" class="mg-chip-c ${ch.c}" data-bet-add="${ch.n}" title="Sumar ${fmtMoney(ch.n)}" ${ch.n > max ? "disabled" : ""}><span>${ch.n >= 1000 ? `${ch.n / 1000}K` : ch.n}</span></button>`).join("")}
          ${Number.isFinite(max) && max >= 100 ? `<button type="button" class="mg-chip-c is-gold" data-bet="${Math.floor(max)}" title="Apostar todo"><span>Todo</span></button>` : ""}
          <button type="button" class="mg-chip-clear" data-bet="100" title="Volver a 100 ₽">${icon("x")}</button>
        </div>
        <button type="button" class="sl-btn sl-btn-primary mg-go" data-mg="${game}-start">${label}</button>
      </div>`;
  }

  // Marcas de Voltorb Flip (clic derecho), como las notas del juego
  // original. Solo son una ayuda visual: viven en la interfaz, van por
  // tablero (su firma son las pistas) y sobreviven a cerrar los minijuegos.
  const vfMarks = { key: "", set: new Set() };
  const vfMarksFor = (v) => {
    const key = v?.clues ? JSON.stringify(v.clues) : "";
    if (key !== vfMarks.key) vfMarks.key = key, vfMarks.set.clear();
    return vfMarks.set;
  };

  async function openGames(start = "pokedle") {
    let tab = start;
    let popupEl = null;
    let busy = false;
    let pk = null; // Pokédle de hoy
    let pkIdx = 0;
    const pkImgs = new Map();
    let pkMsg = "";
    let vt = null; // Voltorb Flip
    let vtSeen = new Set(); // casillas ya pintadas destapadas (solo se anima la nueva)
    let bjSeen = { player: [], dealer: [] }; // cartas ya pintadas (solo se reparte la nueva)
    let bjv = null; // Blackjack
    const names = [...new Set(dex.species.filter((s) => s.id <= 1025).map((s) => s.n))].sort((a, b) => a.localeCompare(b, "es"));

    const banner = (cls, text) => `<p class="mg-banner is-${cls}">${text}</p>`;

    // ---------------- Pokédle
    function pokedleHtml() {
      if (!pk) return `<p class="mg-loading">Cargando…</p>`;
      if (pk.error) return `<p class="mg-empty">${esc(pk.error)}</p>`;
      const slot = pk.slots[pkIdx];
      const allDone = pk.slots.every((s) => s.state !== "open");
      const won = pk.slots.filter((s) => s.state === "win").length;
      const img = pkImgs.get(pkIdx);
      const left = Math.max(0, pk.nextIn - (Date.now() - pk.at));
      return `
        <div class="mg-pk">
          <div class="mg-pk-dots">${pk.slots
            .map(
              (s, i) => `<button type="button" class="mg-pk-dot is-${s.state}${i === pkIdx ? " is-current" : ""}" data-pk="${i}" title="Silueta ${i + 1}">
                ${s.state === "win" ? icon("check") : s.state === "fail" ? icon("x") : i + 1}</button>`
            )
            .join("")}
            <span class="mg-pk-score">${won}/${pk.slots.length} · ${fmtMoney(won * pk.reward)}</span>
          </div>
          <!-- Como el "¿Quién es ese Pokémon?" del anime: silueta sobre el
               estallido azul y la interrogación en el lado rojo. -->
          <div class="mg-pk-stage is-${slot.state}">
            <span class="mg-pk-burst" aria-hidden="true"></span>
            <span class="mg-pk-red" aria-hidden="true"></span>
            <span class="mg-pk-mon">${img ? `<img class="mg-pk-img" src="${img}" alt="" draggable="false">` : `<span class="mg-loading">Cargando…</span>`}</span>
            <span class="mg-pk-title">${
              slot.answer
                ? `<span class="mg-pk-says">${slot.state === "win" ? "¡Es" : "Era"}</span><span class="mg-pk-logo is-name">${esc(slot.answer.name)}${slot.state === "win" ? "!" : ""}</span>`
                : `<span class="mg-pk-q">?</span><span class="mg-pk-logo">Pokémon</span>`
            }</span>
            ${slot.state === "win" ? `<span class="mg-pk-reward">+${fmtMoney(pk.reward)}</span>` : ""}
          </div>
          ${
            slot.answer
              ? ""
              : `<div class="mg-pk-tries" title="Intentos">${Array.from({ length: pk.tries }, (_, i) => `<i class="${i < slot.tries ? "is-used" : ""}"></i>`).join("")}<span>${slot.left} ${slot.left === 1 ? "intento" : "intentos"}</span></div>`
          }
          ${slot.hints.length ? `<div class="mg-pk-hints">${slot.hints.map((h) => `<span>${esc(h.v)}</span>`).join("")}</div>` : ""}
          ${slot.guesses.length && slot.state === "open" ? `<p class="mg-pk-guesses">${slot.guesses.map((g) => `<s>${esc(g)}</s>`).join("")}</p>` : ""}
          ${
            slot.state === "open"
              ? `<form class="mg-pk-form" autocomplete="off">
                   <input type="text" class="mg-pk-input" list="mgNames" placeholder="¿Quién es ese Pokémon?" spellcheck="false" maxlength="30">
                   <button type="submit" class="sl-btn sl-btn-primary" ${busy ? "disabled" : ""}>Adivinar</button>
                 </form>`
              : allDone
                ? `<p class="mg-pk-next">Vuelve mañana: nuevas siluetas en ${fmtDuration(left)}.</p>`
                : `<button type="button" class="sl-btn sl-btn-primary mg-pk-go" data-pk-next>Siguiente silueta</button>`
          }
          ${pkMsg ? `<p class="mg-msg">${esc(pkMsg)}</p>` : ""}
          <datalist id="mgNames">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        </div>`;
    }

    async function loadPokedle() {
      const res = await mg("pokedleToday");
      if (!res.ok) {
        pk = { error: res.error };
        return paint();
      }
      pk = { ...res, at: Date.now() };
      setMoney(res);
      for (const sl of pk.slots) if (sl.answer) dexSee(sl.answer.id);
      const firstOpen = pk.slots.findIndex((s) => s.state === "open");
      pkIdx = firstOpen >= 0 ? firstOpen : 0;
      paint();
      loadSilhouette(pkIdx);
    }

    async function loadSilhouette(i) {
      if (pkImgs.has(i)) return;
      const res = await mg("pokedleSilhouette", i);
      if (res.ok && res.img) {
        pkImgs.set(i, res.img);
        if (tab === "pokedle" && pkIdx === i) paint();
      }
    }

    async function guess(text) {
      if (busy || !text.trim()) return;
      busy = true;
      pkMsg = "";
      const res = await mg("pokedleGuess", pkIdx, text);
      busy = false;
      if (!res.ok) {
        pkMsg = res.error;
        return paint(true);
      }
      pk.slots[pkIdx] = res.slot;
      if (res.slot.answer) dexSee(res.slot.answer.id);
      setMoney(res);
      if (res.reward) {
        window.Achievements?.track("pokedle");
        refreshEcon();
      }
      paint(res.slot.state === "open");
    }

    // ---------------- Voltorb Flip
    // Tablero como en HeartGold/SoulSilver: gráficos originales (assets/
    // pokepark/voltorb) escalados sin suavizar y las líneas de color que unen
    // cada fila y columna con su pista.
    const VF = "assets/pokepark/voltorb/";
    const vfImg = (name, cls = "") => `<img class="mg-vf-img ${cls}" src="${VF}${name}.png" alt="" draggable="false">`;
    const vfClue = (cl, cls) => `<span class="mg-vf-clue ${cls}"><b>${String(cl.sum).padStart(2, "0")}</b><em><img src="${VF}icon.png" alt="" draggable="false">${cl.vol}</em></span>`;

    function voltorbRules() {
      const mult = (m) => `×${String(m).replace(".", ",")}`;
      return `
        <div class="mg-vf-rules">
          <div class="mg-vf-how">
            <h4>Cómo se juega</h4>
            <div class="mg-vf-step">
              <span class="mg-vf-demo">${vfImg("hidden")}</span>
              <p><b>Voltea casillas.</b> Cada una esconde un ×1, un ×2, un ×3 o un Voltorb.</p>
            </div>
            <div class="mg-vf-step">
              <span class="mg-vf-demo is-row">${vfImg("1")}${vfImg("2")}${vfImg("3")}${vfImg("voltorb")}</span>
              <p><b>Busca todos los ×2 y ×3.</b> Cuando no quede ninguno, limpias el tablero.</p>
            </div>
            <div class="mg-vf-step">
              <span class="mg-vf-demo">${vfClue({ sum: 5, vol: 1 }, "is-c0")}</span>
              <p><b>Usa las pistas.</b> Arriba, la suma de esa fila o columna. Abajo, cuántos Voltorb esconde.</p>
            </div>
            <div class="mg-vf-step">
              <span class="mg-vf-demo"><span class="mg-vf-tile is-marked">${vfImg("hidden")}<img class="mg-vf-mark" src="${VF}icon.png" alt="" draggable="false"></span></span>
              <p><b>Marca con clic derecho</b> donde creas que hay un Voltorb. Una casilla marcada no se voltea hasta que le quites la marca.</p>
            </div>
            <p class="mg-vf-tip">${icon("lightbulb")}<span>Una línea con 0 Voltorb es segura. Si la suma y los Voltorb dan 5, esa línea solo tiene ×1 y Voltorb: no hace falta tocarla.</span></p>
          </div>
          <div class="mg-vf-levels">
            <h4>Premios</h4>
            <ol>${VOLTORB_MULTS.map((m, i) => `<li class="${i + 1 === vt.level ? "is-now" : ""}"><span>Nivel ${i + 1}</span><b>${mult(m)}</b></li>`).join("")}</ol>
            <p>Limpias el tablero: ganas la apuesta ${mult(vt.mult)} y subes de nivel. Sale un Voltorb: pierdes la apuesta y bajas uno. Retirarte te paga una parte de lo que llevas.</p>
          </div>
        </div>`;
    }

    function voltorbHtml() {
      if (!vt) return `<p class="mg-loading">Cargando…</p>`;
      const head = `
        <div class="mg-vf-head">
          <span class="mg-stat"><small>Nivel</small><b>${vt.level}</b></span>
          <span class="mg-stat"><small>Premio</small><b>×${String(vt.mult).replace(".", ",")}</b></span>
          ${vt.bet ? `<span class="mg-stat"><small>Apuesta</small><b>${fmtMoney(vt.bet)}</b></span>` : ""}
          ${vt.bet ? `<span class="mg-stat"><small>Monedas</small><b>${vt.coins} / ${vt.maxCoins}</b></span>` : ""}
        </div>`;
      let board = "";
      const marks = vfMarksFor(vt);
      if (vt.revealed) {
        const cells = [];
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const i = r * 5 + c;
            const v = vt.revealed[i];
            let inner;
            if (v === null) {
              const marked = marks.has(i);
              inner = `<button type="button" class="mg-vf-tile${marked ? " is-marked" : ""}" data-vf="${i}" ${vt.active && !busy ? "" : "disabled"} aria-label="${marked ? "Marcada como Voltorb" : "Voltear"}">${vfImg("hidden")}${marked ? `<img class="mg-vf-mark" src="${VF}icon.png" alt="" draggable="false">` : ""}</button>`;
            }
            else {
              const fresh = !vtSeen.has(i);
              vtSeen.add(i);
              inner = `<span class="mg-vf-tile is-open${fresh ? " is-new" : ""}${v === 0 ? " is-voltorb" : ""}">${vfImg(v === 0 ? "voltorb" : String(v))}</span>`;
            }
            cells.push(`<span class="mg-vf-cell" style="--rc:var(--vf-c${r});--cc:var(--vf-c${c})">${inner}</span>`);
          }
          cells.push(vfClue(vt.clues.rows[r], `is-c${r}`));
        }
        for (let c = 0; c < 5; c++) cells.push(vfClue(vt.clues.cols[c], `is-c${c}`));
        board = `<div class="mg-vf-board${vt.active ? "" : " is-over"}">${cells.join("")}</div>`;
      }
      const result = vt.result
        ? vt.result === "won"
          ? banner("win", `¡Tablero limpio! +${fmtMoney(vt.payout)}`)
          : vt.result === "retired"
            ? banner("push", vt.payout ? `Te retiras con ${fmtMoney(vt.payout)}.` : "Te retiras sin premio.")
            : banner("lose", `¡Voltorb! Pierdes ${fmtMoney(vt.bet)}.`)
        : "";
      const actions = vt.active
        ? `<div class="mg-actions">
            <span class="mg-hint">Limpia el tablero: ${fmtMoney(vt.prize)} · Clic derecho: marcar Voltorb</span>
            <button type="button" class="sl-btn sl-btn-ghost" data-mg="voltorb-retire" ${busy ? "disabled" : ""}>Retirarse${vt.retireNow ? ` · ${fmtMoney(vt.retireNow)}` : ""}</button>
          </div>`
        : betPanel("voltorb", vt.result ? "Otra partida" : "Jugar");
      return `<div class="mg-vf">${board ? head : ""}${result}${board || voltorbRules()}${actions}</div>`;
    }

    async function voltorbStart() {
      const bet = Math.floor(Number(gameBets.voltorb));
      if (!(bet >= 100)) return showNotification("La apuesta mínima es de 100 ₽.", "error");
      if (!unlimited() && state.money < bet) return showNotification("No tienes Pokédólares suficientes.", "error");
      busy = true;
      const res = await mg("voltorbStart", bet);
      busy = false;
      if (!res.ok) return showNotification(res.error, "error");
      setMoney(res);
      vt = res;
      vtSeen = new Set();
      paint();
    }

    async function voltorbAct(action, arg) {
      if (busy) return;
      busy = true;
      const res = await mg(action, arg);
      busy = false;
      if (!res.ok) return showNotification(res.error, "error"), paint();
      vt = res;
      setMoney(res);
      if (res.result === "won") {
        window.Achievements?.track("voltorbWins");
        refreshEcon();
      }
      paint();
    }

    // ---------------- Blackjack
    function bjHtml() {
      if (!bjv) return `<p class="mg-loading">Cargando…</p>`;
      const has = !!bjv.player;
      const result = bjv.result
        ? {
            blackjack: banner("win", `¡Blackjack! +${fmtMoney(bjv.payout)}`),
            win: banner("win", `¡Ganas! +${fmtMoney(bjv.payout)}`),
            push: banner("push", "Empate: recuperas la apuesta."),
            lose: banner("lose", `Pierdes ${fmtMoney(bjv.bet * (bjv.doubled ? 2 : 1))}.`),
          }[bjv.result]
        : "";
      // Solo se anima la carta que no estaba (o la del crupier al destaparse).
      const hand = (who, cards) => {
        const prev = bjSeen[who];
        let k = 0;
        const html = cards
          .map((c, i) => {
            const key = c ? `${c.r}${c.s}` : "back";
            const fresh = prev[i] !== key;
            return cardHtml(c, fresh ? k++ : 0, fresh);
          })
          .join("");
        bjSeen[who] = cards.map((c) => (c ? `${c.r}${c.s}` : "back"));
        return html;
      };
      const bet = has ? bjv.bet * (bjv.doubled ? 2 : 1) : 0;
      const table = `
        <div class="mg-bj-table${has ? "" : " is-empty"}">
          <div class="mg-bj-hand is-dealer">
            <span class="mg-bj-label">Crupier${has ? `<b>${bjv.dealerTotal}${bjv.active ? "+" : ""}</b>` : ""}</span>
            <div class="mg-bj-cards">${has ? hand("dealer", bjv.dealer) : `${cardHtml(null, 0, false)}${cardHtml(null, 1, false)}`}</div>
          </div>
          <div class="mg-bj-felt">
            <span class="mg-bj-rule">El blackjack paga 2 a 1</span>
            ${has ? `<span class="mg-bj-pot">${COIN_SVG}${fmtMoney(bet)}${bjv.doubled ? "<small>doblado</small>" : ""}</span>` : ""}
            <span class="mg-bj-rule is-small">El crupier pide con 17 blando · Empate a 17: gana la banca</span>
          </div>
          <div class="mg-bj-hand is-player">
            <div class="mg-bj-cards">${has ? hand("player", bjv.player) : ""}</div>
            <span class="mg-bj-label">${has ? `Tú<b>${bjv.playerTotal}</b>` : "Acércate a 21 sin pasarte"}</span>
          </div>
        </div>`;
      const actions = bjv.active
        ? `<div class="mg-actions is-bj">
            <button type="button" class="sl-btn sl-btn-ghost" data-mg="bj-double" ${bjv.canDouble && !busy && (unlimited() || state.money >= bjv.bet) ? "" : "disabled"} title="Doblas la apuesta y recibes una sola carta más">Doblar</button>
            <button type="button" class="sl-btn sl-btn-ghost" data-mg="bj-hit" ${busy ? "disabled" : ""}>Pedir</button>
            <button type="button" class="sl-btn sl-btn-primary" data-mg="bj-stand" ${busy ? "disabled" : ""}>Plantarse</button>
          </div>`
        : betPanel("bj", has ? "Otra mano" : "Repartir");
      return `<div class="mg-bj">${result}${table}${actions}</div>`;
    }

    async function bjDeal() {
      const bet = Math.floor(Number(gameBets.bj));
      if (!(bet >= 100)) return showNotification("La apuesta mínima es de 100 ₽.", "error");
      if (!unlimited() && state.money < bet) return showNotification("No tienes Pokédólares suficientes.", "error");
      busy = true;
      const res = await mg("bjDeal", bet);
      busy = false;
      if (!res.ok) return showNotification(res.error, "error");
      bjv = res;
      bjSeen = { player: [], dealer: [] };
      setMoney(res);
      paint();
    }

    async function bjAct(action) {
      if (busy || !bjv?.active) return;
      if (action === "bjDouble" && !unlimited() && state.money < bjv.bet) return showNotification("No tienes Pokédólares suficientes para doblar.", "error");
      busy = true;
      paint();
      const res = await mg(action);
      busy = false;
      if (!res.ok) {
        showNotification(res.error, "error");
        return paint();
      }
      bjv = res;
      setMoney(res);
      if (res.result === "win" || res.result === "blackjack") {
        window.Achievements?.track("bjWins");
        refreshEcon();
      }
      paint();
    }

    // ---------------- Ventana
    function paint(keepFocus) {
      const p = popupEl;
      if (!p) return;
      p.querySelectorAll(".mg-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
      p.querySelector(".mg-money b").textContent = unlimited() ? "∞" : fmtMoney(state.money);
      const body = p.querySelector(".mg-body");
      const typed = p.querySelector(".mg-pk-input")?.value || "";
      body.innerHTML = tab === "pokedle" ? pokedleHtml() : tab === "voltorb" ? voltorbHtml() : bjHtml();
      const input = p.querySelector(".mg-pk-input");
      if (input && keepFocus) {
        input.value = typed;
        input.focus();
        input.select();
      }
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Minijuegos",
      width: 780,
      html: `
        <div class="mg">
          <div class="mg-head">
            <div class="pp-bag-tabs">
              <button type="button" class="pp-bag-tab mg-tab" data-tab="pokedle">Pokédle</button>
              <button type="button" class="pp-bag-tab mg-tab" data-tab="voltorb">Voltorb Flip</button>
              <button type="button" class="pp-bag-tab mg-tab" data-tab="bj">Blackjack</button>
            </div>
            <span class="pp-shop-money mg-money" title="Tus Pokédólares">${COIN_SVG}<b></b></span>
          </div>
          <div class="mg-body"></div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-bag-popup mg-popup" },
      didOpen: async (popup) => {
        popupEl = popup;
        paint();
        popup.addEventListener("click", (e) => {
          const t = e.target.closest(".mg-tab");
          if (t) {
            tab = t.dataset.tab;
            return paint();
          }
          const chip = e.target.closest("[data-bet], [data-bet-add]");
          if (chip) {
            const game = chip.closest("[data-game]").dataset.game;
            const max = unlimited() ? Infinity : Math.floor(state.money);
            gameBets[game] = chip.dataset.betAdd
              ? Math.min(max, (betTouched[game] ? gameBets[game] : 0) + Number(chip.dataset.betAdd))
              : Number(chip.dataset.bet);
            gameBets[game] = Math.max(100, gameBets[game]);
            betTouched[game] = true;
            return paint();
          }
          const dot = e.target.closest("[data-pk]");
          if (dot && pk?.slots) {
            pkIdx = Number(dot.dataset.pk);
            pkMsg = "";
            paint();
            return loadSilhouette(pkIdx);
          }
          if (e.target.closest("[data-pk-next]") && pk?.slots) {
            const next = pk.slots.findIndex((s, i) => i > pkIdx && s.state === "open");
            pkIdx = next >= 0 ? next : pk.slots.findIndex((s) => s.state === "open");
            pkMsg = "";
            paint();
            return loadSilhouette(pkIdx);
          }
          const tile = e.target.closest("[data-vf]");
          if (tile) {
            if (vfMarks.set.has(Number(tile.dataset.vf))) return; // marcada: no se voltea
            return voltorbAct("voltorbFlip", Number(tile.dataset.vf));
          }
          const a = e.target.closest("[data-mg]")?.dataset.mg;
          if (a === "voltorb-start") voltorbStart();
          else if (a === "voltorb-retire") voltorbAct("voltorbRetire");
          else if (a === "bj-start") bjDeal();
          else if (a === "bj-hit") bjAct("bjHit");
          else if (a === "bj-stand") bjAct("bjStand");
          else if (a === "bj-double") bjAct("bjDouble");
        });
        popup.addEventListener("contextmenu", (e) => {
          const tile = e.target.closest("[data-vf]");
          if (!tile) return;
          e.preventDefault();
          if (tile.disabled) return;
          const i = Number(tile.dataset.vf);
          const marks = vfMarksFor(vt);
          if (marks.has(i)) marks.delete(i);
          else marks.add(i);
          paint();
        });
        popup.addEventListener("input", (e) => {
          if (!e.target.matches(".mg-bet-val")) return;
          const game = e.target.closest("[data-game]").dataset.game;
          gameBets[game] = Math.max(0, Math.floor(Number(e.target.value) || 0));
        });
        popup.addEventListener("submit", (e) => {
          if (!e.target.matches(".mg-pk-form")) return;
          e.preventDefault();
          guess(popup.querySelector(".mg-pk-input").value);
        });
        // Una partida a medias (p. ej. tras recargar) se retoma.
        const [v, b] = await Promise.all([mg("voltorbState"), mg("bjState")]);
        vt = v.ok ? v : { level: 1, mult: 1.1 };
        bjv = b.ok ? b : {};
        paint();
        loadPokedle();
      },
      willClose: () => {
        popupEl = null;
      },
    });

    // Cerrar con una partida a medias la resuelve: en Voltorb te retiras y en
    // Blackjack te plantas (así no se puede escapar de una mala mano).
    if (vt?.active) {
      const r = await mg("voltorbRetire");
      setMoney(r);
      if (r.ok && r.payout) showNotification(`Te has retirado de Voltorb Flip con ${fmtMoney(r.payout)}.`);
    }
    if (bjv?.active) {
      const r = await mg("bjStand");
      if (r.ok) {
        setMoney(r);
        showNotification(
          r.result === "win" ? `Blackjack: te has plantado y ganas ${fmtMoney(r.payout)}.` : r.result === "push" ? "Blackjack: empate, recuperas la apuesta." : "Blackjack: te has plantado y pierdes la mano."
        );
      }
    }
  }

  // ------------------------------------------------------------ SVG
  const FS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const TRADE_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>';
  const LOCK_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const UNLOCK_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/></svg>';
  // Símbolo de la megaevolución (simplificado).
  const MEGA_SVG =
    '<svg class="pp-mega-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.2 6.4c4.6 1.4 7.2 4.4 7.6 9.6M15.8 6.4c-1.6 1.2-2.5 2.4-3 3.6M8.2 17.6c1.4-1 2.4-2.1 3-3.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';
  // Fuerte Afecto: el remolino de agua de Greninja Ash.
  const BOND_SVG =
    '<svg class="pp-mega-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c3.6 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.4-6.6 6-10.8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 14.2c.5 1.7 1.9 2.8 3.6 2.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // Género (Marte / Venus), en vez de los símbolos de texto.
  const MALE_SVG =
    '<svg class="i pp-g-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="m21 3-6.75 6.75"/><circle cx="10" cy="14" r="6"/></svg>';
  const FEMALE_SVG =
    '<svg class="i pp-g-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15v7"/><path d="M9 19h6"/><circle cx="12" cy="9" r="6"/></svg>';
  const CHEVRON_L =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  const CHEVRON_R =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  const PALETTE_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.7 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7h2c3.1 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2Z"/></svg>';
  const GAMES_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/></svg>';
  const COIN_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5"/><path d="M12 6v2M12 16v2"/></svg>';
  const BOX_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M2 3h20v4H2Z"/><path d="M10 11h4"/></svg>';
  const SHOP_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 4.5 4h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z"/><path d="M5 13v7h14v-7"/><path d="M10 20v-4h4v4"/></svg>';
  const POKEBALL_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h6"/><path d="M15 12h6"/><circle cx="12" cy="12" r="3"/></svg>';
  const POKEBALL_IMG = `<img src="assets/pokepark/items/poke-ball.png" alt="" draggable="false">`;
  // Maletín (trabajo del equipo), portapapeles (encargos) y Pokédex.
  const WORK_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></svg>';
  const TASKS_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 12 2 2 4-4"/><path d="M9 17h6"/></svg>';
  const POKEDEX_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="8.5" cy="6.5" r="1.8"/><path d="M13 6.5h3"/><rect x="7" y="10.5" width="10" height="7" rx="1"/></svg>';
  // Brillos de variocolor de la Pokédex (dos estrellas de cuatro puntas).
  const DEX_SPARKLE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2l1.6 5.4L16 9l-5.4 1.6L9 16l-1.6-5.4L2 9l5.4-1.6Z" fill="#ffd94a" stroke="#b07a00" stroke-width="1"/><path d="M18 13l.9 3.1L22 17l-3.1.9L18 21l-.9-3.1L14 17l3.1-.9Z" fill="#fff3a8" stroke="#b07a00" stroke-width="1"/></svg>';
  const BAG_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M5 13h14"/><path d="M11 13v2h2v-2"/></svg>';
  const SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  // ------------------------------------------------------------ Init
  async function init() {
    root = document.getElementById("ppRoot");
    if (!root) return;
    try {
      dex = await window.electronAPI.pokeparkDex();
    } catch (err) {
      console.error("No se pudo cargar la Pokédex", err);
      root.innerHTML = `<p class="sl-hint">No se pudo cargar el PokéPark.</p>`;
      return;
    }
    for (const s of dex.species) {
      byId.set(s.id, s);
      bySlug.set(s.slug, s);
      for (const d of s.evo || []) {
        if (d.item) useItems.add(d.item);
        if (d.held) heldItems.add(d.held);
      }
    }
    // Formas mega: especies "virtuales" con id propio para sprites, tipos y stats.
    megas = (dex.megas || []).map((m, i) => ({ ...m, id: 20000 + i }));
    for (const m of megas) {
      const base = species(m.sp);
      byId.set(m.id, { id: m.id, n: m.n, slug: `${base.slug}-mega${m.id}`, t: m.t, s: m.s, g: base.g, sd: m.sd, a: m.a, sprite: m.sprite, mega: true, base: m.sp });
    }
    megaStones = new Set(megas.filter((m) => m.stone).map((m) => m.stone));
    // Objetos solo de legendarios/formas regionales fuera del reparto.
    useItems = new Set([...useItems].filter((s) => !ITEM_BLOCKLIST.has(s)));
    heldItems = new Set([...heldItems].filter((s) => !ITEM_BLOCKLIST.has(s) && !useItems.has(s)));

    const saved = await window.electronAPI.pokeparkGet().catch(() => null);
    state = normalizeState(saved);
    ready = true;
    shell();
    checkVisitorLeave();
    expireGround();
    if (state.starter && state.party.length) refreshWild();
    dexInit();
    save();
    render();
    syncTrades();
    // El saldo, el trabajo y los encargos los da el servidor; de paso se
    // cobra lo que haya pendiente de la Pokédex.
    refreshEcon().then((r) => r && claimDex());
    setInterval(tick, TICK_MS);
    // Con ofertas propias pendientes se mira cada 5 s, para ver el
    // intercambio casi a la vez que quien lo acepta.
    setInterval(() => state.party.some((m) => m.trade) && syncTrades(), 5000);
    setInterval(updateClock, 30 * 1000);
  }

  let cursorTimer = null;
  document.addEventListener("mousemove", () => {
    const park = root?.querySelector(".pp-park");
    if (!park) return;
    park.classList.remove("hide-cursor");
    clearTimeout(cursorTimer);
    if (document.fullscreenElement === park) cursorTimer = setTimeout(() => park.classList.add("hide-cursor"), 3000);
  });

  window.PokePark = {
    // Atajos de teclado: abrir cada cosa del dock sin el ratón.
    open(what) {
      if (!ready) return;
      const run = {
        shop: openShop,
        games: () => openGames(),
        tasks: openTasks,
        pokedex: openPokedex,
        bag: openBag,
        box: openBox,
        trades: () => openTrades(),
        work: claimWork,
        fullscreen: () => {
          const park = root.querySelector(".pp-park");
          if (document.fullscreenElement) document.exitFullscreen();
          else park?.requestFullscreen?.().catch(() => {});
        },
      }[what];
      // Si hay otra ventana abierta se cierra antes.
      if (run) {
        if (Swal.isVisible() && what !== "work" && what !== "fullscreen") Swal.close();
        setTimeout(run, Swal.isVisible() ? 250 : 0);
      }
    },
    onShow() {
      if (!ready) return;
      if (!rafId) rafId = requestAnimationFrame(frame); // la animación vuelve
      render();
      syncTrades();
      if (!econState || Date.now() - econAt > 60 * 1000) refreshEcon();
      if (state.visitor && !state.visitor.seen) setTimeout(announceVisitor, 400);
    },
    _spriteError: spriteError,
    snapshot() {
      return ready ? { party: state.party, box: [...boxedMons(), ...(state.box || [])], legends: state.legends || {}, shinyCharm: !!state.shinyCharm } : null;
    },
    // La cuenta ha traído otro parque: se recarga desde disco.
    async reload() {
      if (!ready) return;
      const saved = await window.electronAPI.pokeparkGet().catch(() => undefined);
      if (saved === undefined) return;
      // Sin parque guardado (otra cuenta que aún no tiene): parque nuevo.
      state = normalizeState(saved && Array.isArray(saved.party) ? saved : null);
      dexInit();
      econState = null;
      if (state.starter && state.party.length) refreshWild();
      selectedUid = null;
      for (const a of actors.values()) a.el.remove();
      actors.clear();
      render();
      syncTrades(); // los intercambios también son de la cuenta
      refreshEcon().then((r) => r && claimDex()); // y el dinero
    },
    // Depuración: traer un visitante (id de especie opcional) o que se vaya ya.
    _summon(sp) {
      if (state.visitor) {
        state.visitor.leaves = 0;
        checkVisitorLeave();
      }
      summonVisitor(sp);
    },
    _leave() {
      if (state.visitor) state.visitor.leaves = 0;
      checkVisitorLeave();
    },
    // Depuración / pruebas.
    _state: () => state,
    _openTrades: () => openTrades(),
    _openGames: (tab) => openGames(tab),
    _tick: () => tick(),
    _syncTrades: () => syncTrades(),
    _trades: () => trades,
    _econ: () => econState,
    _refreshEcon: () => refreshEcon(),
    _bump: (kind) => bump(kind),
  };

  init();
})();
