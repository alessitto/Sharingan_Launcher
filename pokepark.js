// =====================================================================
// PokéPark
// =====================================================================
// Un parque con tu equipo (hasta 6 Pokémon) y hasta 10 Pokémon salvajes.
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

  // Liberar: 3 al mes, y los demás pierden un corazón de amistad.
  const RELEASES_PER_MONTH = 3;
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
    return 0;
  }
  const sellPrice = (slug) => BERRY_SELL[slug] || Math.floor(buyPrice(slug) / 2);
  const fmtMoney = (n) => `${Math.floor(n).toLocaleString("es-ES")} ₽`;

  // Visitas: legendarios, singulares y ultraentes llegan al azar, se quedan
  // 8 h y su amistad se conserva entre visitas. Cuanta más amistad, más
  // posibilidades de que sea ese el que vuelva.
  const VISIT_MS = 8 * 60 * 60 * 1000;
  // Al expulsarlo se va molesto: su amistad queda un pelín por debajo de la
  // de un legendario nuevo (peso 0,99 frente a 1), así vuelve algo menos.
  const EXPEL_FRIENDSHIP = -0.2;
  const VISIT_CHANCE = 1 / 720; // por minuto con la app abierta (~12 h de media)
  const VISIT_LEVEL = 100;
  const VISIT_START_FRIENDSHIP = 0;
  const visitWeight = (fr) => 1 + fr / 20; // amistad máxima ≈ x13

  const SHOWDOWN = "https://play.pokemonshowdown.com/sprites";
  const SPRITE_ANI = (id, shiny) => `${SHOWDOWN}/gen5ani${shiny ? "-shiny" : ""}/${id}.gif`;
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

  // Equipo + visitante (si hay): los que ganan exp, comen y hacen amigos.
  const parkMons = () => (state.visitor ? [...state.party, state.visitor] : state.party);
  // Todo lo que anda por el parque (también los salvajes).
  const allMons = () => [...parkMons(), ...state.wild];
  const monByUid = (uid) => allMons().find((m) => m.uid === uid) || null;
  const newUid = (p) => `${p}${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function rollShiny(s) {
    if (isLegendary(s)) return false;
    return Math.random() < (state.shinyCharm ? SHINY_CHARM_ODDS : SHINY_ODDS);
  }
  const randomGender = (s) => (s.g === -1 ? null : Math.random() * 8 < s.g ? "f" : "m");
  const randomIvs = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 32));

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.electronAPI.pokeparkSave(state), 600);
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
    const tries = [...(s.a ? [[SPRITE_ANI(s.sd, shiny), true]] : []), [SPRITE_PNG(s.sd, shiny), false]];
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
    const s = species(mon.sp);
    const fb = s.sprite ? (mon.shiny ? s.sprite.replace("/pokemon/", "/pokemon/shiny/") : s.sprite) : "";
    return `<img src="${SPRITE_PNG(s.sd, mon.shiny)}" alt="" ${extra} onerror="this.onerror=null;${fb ? `this.src='${fb}'` : "this.style.visibility='hidden'"}">`;
  }
  const SHINY_MARK = `<span class="pp-shiny-mark" title="Variocolor">✦</span>`;

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
    const s = species(mon.sp);
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
      // primero las más concretas (movimiento, objeto, hora...)
      .sort((a, b) => Object.keys(b).length - Object.keys(a).length);
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
    if (state.party.length >= PARTY_MAX) {
      // Con varias Poké Balls en el aire el equipo se puede llenar antes.
      showNotification(`Tu equipo está lleno (${PARTY_MAX}): ${name} ha salido de la Poké Ball.`, "error");
      floatText(mon, "¡Se ha escapado!", true);
    } else if (Math.random() < CATCH_RATE) {
      state.wild = state.wild.filter((m) => m !== mon);
      const caught = { ...mon, at: now(), caught: now() };
      delete caught.wild;
      delete caught.leaves;
      state.party.push(caught);
      if (!state.starter) state.starter = true;
      a?.el.classList.remove("is-wild");
      selectedUid = caught.uid;
      window.Achievements?.track("catches");
      showNotification(`¡Ya está! ¡${name}${mon.shiny ? " variocolor" : ""} atrapado!`);
      floatText(caught, "¡Atrapado!", true);
      sparkle(caught);
      if (hand?.kind === "ball" && state.party.length >= PARTY_MAX) cancelHand();
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
    if (state.party.length >= PARTY_MAX) return showNotification(`Tu equipo está lleno (${PARTY_MAX}).`, "error");
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
    if (!hand || !e.target.closest(".pp-park") || e.target.closest(".pp-hud, .pp-bag-btn, .pp-tool-btn")) return;
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
    if (state.party.length >= PARTY_MAX) {
      cancelHand();
      return showNotification(`Tu equipo está lleno (${PARTY_MAX}).`, "error");
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
      if (hand.kind === "comb" && !e.target.closest(".pp-tool-btn, .pp-bag-btn, .pp-hud")) {
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
  const monthKey = () => new Date().toISOString().slice(0, 7);
  function releasesLeft() {
    if (unlimited()) return Infinity;
    const r = state.releases || {};
    return r.m === monthKey() ? Math.max(0, RELEASES_PER_MONTH - (r.n || 0)) : RELEASES_PER_MONTH;
  }

  async function release(mon) {
    if (mon.trade) return showNotification(`${displayName(mon)} está en una oferta de intercambio.`, "error");
    if (state.party.length <= 1 && !unlimited()) return showNotification("No puedes quedarte sin Pokémon.", "error");
    const left = releasesLeft();
    if (!left) return showNotification(`Ya has liberado ${RELEASES_PER_MONTH} Pokémon este mes.`, "error");
    const ok = await confirmDialog({
      title: `¿Liberar a ${displayName(mon)}?`,
      text: `Se irá del parque para siempre${mon.held ? ` (su ${itemName(mon.held)} vuelve a la bolsa)` : ""}. Los demás Pokémon de tu equipo lo echarán de menos y perderán un corazón de amistad. ${left === Infinity ? "" : `Este mes te ${left === 1 ? "queda 1 liberación" : `quedan ${left} liberaciones`}.`}`,
      confirmText: "Liberar",
      danger: true,
      iconName: "trash",
    });
    if (!ok || !state.party.includes(mon)) return;
    if (mon.held) addToBag(mon.held);
    state.party = state.party.filter((m) => m !== mon);
    for (const m of state.party) addFriendship(m, -RELEASE_PENALTY);
    const r = state.releases?.m === monthKey() ? state.releases : { m: monthKey(), n: 0 };
    if (!unlimited()) r.n++;
    state.releases = r;
    if (selectedUid === mon.uid) selectedUid = null;
    showNotification(`Adiós, ${displayName(mon)}. ¡Cuídate!`);
    save();
    render();
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
          <span class="pp-chip pp-clock"></span>
          <span class="pp-hud-right">
            <button type="button" class="pp-chip pp-hud-btn pp-gate-btn" data-pp="gate"></button>
            <button type="button" class="pp-chip pp-hud-btn" data-pp="shop" title="Tienda">${SHOP_SVG}<span>Tienda</span></button>
            <button type="button" class="pp-chip pp-hud-btn" data-pp="trades" title="Intercambios con otros jugadores">${TRADE_SVG}<span>Intercambios</span><em class="pp-trade-badge"></em></button>
            <button type="button" class="pp-chip pp-fs-btn" data-pp="fullscreen" title="Pantalla completa (Esc para salir)">${FS_SVG}<span>Pantalla completa</span></button>
          </span>
        </div>
        <div class="pp-empty"></div>
        <button type="button" class="pp-tool-btn is-berry" data-pp="berries" title="Dar una baya" aria-label="Dar una baya">${itemImg("oran-berry")}</button>
        <button type="button" class="pp-tool-btn is-comb" data-pp="comb" title="Cepillar" aria-label="Cepillar"><img src="${combSrc()}" alt="" draggable="false"></button>
        <button type="button" class="pp-tool-btn pp-ball-btn" data-pp="ball" title="Sacar una Poké Ball" aria-label="Sacar una Poké Ball">${POKEBALL_IMG}</button>
        <button type="button" class="pp-bag-btn" title="Bolsa" aria-label="Abrir la bolsa">
          ${BAG_SVG}
        </button>
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

  function renderSide() {
    const team = root.querySelector(".pp-team");
    const sel = selected();
    const slots = [];
    for (let i = 0; i < PARTY_MAX; i++) {
      const m = state.party[i];
      slots.push(
        m
          ? `<button type="button" class="pp-slot ${sel && m.uid === sel.uid ? "is-active" : ""} ${m.trade ? "is-trading" : ""}" data-pp="select" data-uid="${m.uid}" title="${esc(displayName(m))}${m.trade ? " (en intercambio)" : ""}">
               ${thumbHtml(m)}
               ${m.shiny ? SHINY_MARK : ""}
               <span class="pp-slot-lv">Nv.${m.lv}</span>
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
      <div class="pp-team-head"><span class="section-eyebrow">PokéPark</span><span class="pp-team-count">${state.party.length}/${PARTY_MAX}</span></div>
      <div class="pp-slots">${slots.join("")}</div>
      ${state.party.length || v ? visit : ""}`;

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
                <span class="pp-ov-avatar"><img src="${SPRITE_PNG(species(m.sp).sd)}" alt="" onerror="this.style.visibility='hidden'"></span>
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
    const stats = statsOf(sel);
    const cur = expForLevel(sel.lv);
    const next = expForLevel(sel.lv + 1);
    const pct = sel.lv >= 100 ? 100 : Math.max(0, Math.min(100, ((sel.exp - cur) / (next - cur)) * 100));
    const fi = feedInfo(sel);
    const cleanWait = cleanWaitOf(sel);
    const hints = evolutionHints(sel);
    const gSym = sel.g === "m" ? "♂" : sel.g === "f" ? "♀" : "";
    const gender = !gSym
      ? ""
      : canChooseGender(sel) && !sel.visitor
        ? `<button type="button" class="pp-g is-${sel.g} is-toggle" data-pp="gender" title="Cambiar a ${sel.g === "m" ? "hembra" : "macho"}">${gSym}</button>`
        : `<span class="pp-g is-${sel.g}" title="Esta especie solo puede ser ${sel.g === "m" ? "macho" : "hembra"}">${gSym}</span>`;

    det.innerHTML = `
      <div class="pp-card">
        <p class="pp-cooldowns">
          ${fi.left ? `Comidas con experiencia: ${fmtCount(fi.left)}/${FEED_MAX}` : `Lleno · vuelve a tener hambre en ${fmtDuration(fi.resetIn)}`}
          ${cleanWait > 0 ? ` · Cepillado (${fmtDuration(cleanWait)})` : ""}
        </p>
        <div class="pp-portrait ${sel.visitor ? "is-visitor" : ""} ${sel.shiny ? "is-shiny" : ""}">${spriteHtml(sel.sp, "pp-portrait-img", sel.shiny)}</div>
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
        <p class="pp-species">${sel.visitor ? `<span class="pp-legend-badge">${legendKind(s)}</span> ` : ""}${sel.shiny ? `<span class="pp-shiny-badge">✦ Variocolor</span> ` : ""}${sel.nick ? `${esc(s.n)} · ` : ""}Nº ${String(s.id).padStart(4, "0")}${sel.ot ? ` · EO ${esc(sel.ot)}` : ""}</p>
        <div class="pp-types">${s.t.map((t) => `<span class="pp-type" style="--tc:${TYPE_COLORS[t] || "#888"}">${esc(dex.types[t] || t)}</span>`).join("")}</div>
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
              (v, i) => `<div class="pp-stat"><span>${STAT_LABELS[i]}</span><b>${v}</b><i><em style="width:${Math.min(100, (s.s[i] / 160) * 100)}%"></em></i></div>`
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
        </div>`
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
                   <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-pp="release" ${sel.trade || (state.party.length <= 1 && !unlimited()) || !releasesLeft() ? "disabled" : ""}
                     title="${unlimited() ? "Sin límite (tester)" : `${releasesLeft()} de ${RELEASES_PER_MONTH} liberaciones este mes`}">${icon("trash")}Liberar (${unlimited() ? "∞" : `${releasesLeft()}/${RELEASES_PER_MONTH}`})</button>
                 </div>
               </div>`
        }
      </div>`;
  }

  function renderParkStatic() {
    const incoming = trades.list.filter((t) => !t.outgoing && t.status === "pending").length;
    const badge = root.querySelector(".pp-trade-badge");
    badge.textContent = incoming || "";
    badge.style.display = incoming ? "" : "none";
    const gate = root.querySelector(".pp-gate-btn");
    gate.innerHTML = `${state.closed ? LOCK_SVG : UNLOCK_SVG}<span>${state.closed ? "Abrir parque" : "Cerrar parque"}</span>`;
    gate.title = state.closed ? "Volverán los Pokémon salvajes" : "Sin salvajes ni visitas: solo tus Pokémon";
    gate.classList.toggle("is-closed", !!state.closed);
    root.querySelector(".pp-park").classList.toggle("is-closed", !!state.closed);
    const empty = root.querySelector(".pp-empty");
    empty.innerHTML = state.party.length
      ? ""
      : `<div class="pp-empty-card"><p>Aquí vivirán tus Pokémon</p><button type="button" class="sl-btn sl-btn-primary" data-pp="pick">${icon("plus")}Elegir tu Pokémon inicial</button></div>`;
  }

  function updateClock() {
    if (!root) return;
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
      const look = `${mon.sp}${mon.shiny ? "s" : ""}`;
      if (a.sp !== look) {
        a.sp = look;
        a.el.innerHTML = `<span class="pp-mon-ring"></span><span class="pp-mon-shadow"></span>${spriteHtml(mon.sp, "pp-mon-img", mon.shiny)}<span class="pp-mon-ball">${POKEBALL_IMG}</span><span class="pp-mon-name"></span>`;
        hydrate(a.el);
      }
      a.el.classList.toggle("is-wild", !!mon.wild);
      a.el.classList.toggle("is-shiny", !!mon.shiny);
      a.el.classList.toggle("is-catching", catching.has(mon.uid));
      a.el.querySelector(".pp-mon-name").textContent = `${mon.shiny ? "✦ " : ""}${displayName(mon)}${mon.wild ? ` · Nv.${mon.lv}` : ""}`;
      a.el.classList.toggle("is-selected", mon.uid === selected()?.uid);
    }
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame(t) {
    rafId = null;
    const visible = document.getElementById("pokepark")?.classList.contains("active");
    if (!visible && hand) cancelHand();
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
        const still = catching.has(uid) || (hand?.kind === "comb" && hand.target === uid);
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
        a.el.style.transform = `translate(${a.x}px, ${a.y}px) scale(${depth})`;
        a.el.style.setProperty("--face", a.facing);
        a.el.style.zIndex = String(10 + Math.round(a.y));
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
      if (e.target.closest(".pp-park") && !e.target.closest(".pp-bag-btn, .pp-tool-btn") && selectedUid) {
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
    else if (act === "shop") openShop();
    else if (act === "gate") toggleClosed();
    else if (act === "unequip" && mon?.held) {
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
        ? [...new Set([...Object.keys(BERRIES), ...shopStock()])].map((s) => [s, Infinity])
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
                }
                return `<button type="button" class="pp-target ${ok ? "" : "is-off"}" data-bag="target" data-uid="${m.uid}" ${ok ? "" : "disabled"}>
                  <img src="${SPRITE_PNG(species(m.sp).sd)}" alt="">
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
        ? `<div class="pp-bag-list">${list
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
              return `<div class="pp-bag-row">${itemImg(slug)}<span class="pp-bag-name"><b>${esc(itemName(slug))}</b><small>${esc(sub)}</small></span><em>×${fmtCount(n)}</em>${btn}</div>`;
            })
            .join("")}</div>`
        : `<p class="pp-bag-empty">${empty[tab]}</p>`;
    }

    function heldNote(slug) {
      const trade = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "trade"));
      const level = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "level"));
      if (level) return "Equipado, evoluciona al subir de nivel.";
      if (trade) return "Equipado, evoluciona al intercambiarlo.";
      return "Objeto para equipar.";
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Bolsa",
      width: 560,
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
    if (slug === "poke-ball") return "Para capturar Pokémon salvajes.";
    if (isBerry(slug)) return BERRIES[slug].desc;
    if (useItems.has(slug)) return "Objeto evolutivo: se gasta al usarlo.";
    const trade = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "trade"));
    return trade ? "Equipado, hace evolucionar al intercambiar." : "Equipado, hace evolucionar al subir de nivel.";
  }

  function buy(slug, n = 1) {
    const cost = buyPrice(slug) * n;
    if (!cost || (state.money < cost && !unlimited())) return showNotification("No tienes Pokédólares suficientes.", "error");
    if (!unlimited()) state.money -= cost;
    addToBag(slug, n);
    window.Achievements?.track("purchases");
    showNotification(`Has comprado ${n > 1 ? `${n} × ` : ""}${itemName(slug)} por ${fmtMoney(cost)}.`);
    save();
    render();
  }

  function sell(slug, n = 1) {
    n = Math.min(n, state.bag[slug] || 0);
    const gain = sellPrice(slug) * n;
    if (!n || !gain) return;
    takeFromBag(slug, n);
    state.money += gain;
    showNotification(`Has vendido ${n > 1 ? `${n} × ` : ""}${itemName(slug)} por ${fmtMoney(gain)}.`);
    save();
    render();
  }

  async function openShop() {
    let tab = "buy";
    function body(popup) {
      popup.querySelectorAll(".pp-bag-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
      popup.querySelector(".pp-shop-money").textContent = unlimited() ? "∞" : fmtMoney(state.money);
      const box = popup.querySelector(".pp-bag-body");
      if (tab === "buy") {
        box.innerHTML = `<div class="pp-bag-list">${shopStock()
          .map((slug) => {
            const p = buyPrice(slug);
            const owned = have(slug);
            return `<div class="pp-bag-row">${itemImg(slug)}<span class="pp-bag-name"><b>${esc(itemName(slug))}</b><small>${esc(itemNote(slug))}${owned ? ` Tienes ${fmtCount(owned)}.` : ""}</small></span>
              <em class="pp-price">${fmtMoney(p)}</em>
              <span class="pp-shop-btns">
                <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-shop="buy" data-slug="${slug}" data-n="1" ${state.money < p && !unlimited() ? "disabled" : ""}>Comprar</button>
                ${slug === "poke-ball" ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-shop="buy" data-slug="${slug}" data-n="10" ${state.money < p * 10 && !unlimited() ? "disabled" : ""}>×10</button>` : ""}
              </span></div>`;
          })
          .join("")}</div>`;
        return;
      }
      const items = Object.entries(state.bag).filter(([s, n]) => n > 0 && sellPrice(s) > 0 && s !== "poke-ball");
      items.sort(([a], [b]) => Number(!isBerry(a)) - Number(!isBerry(b)) || itemName(a).localeCompare(itemName(b), "es"));
      box.innerHTML = items.length
        ? `<div class="pp-bag-list">${items
            .map(
              ([slug, n]) => `<div class="pp-bag-row">${itemImg(slug)}<span class="pp-bag-name"><b>${esc(itemName(slug))}</b><small>Tienes ${n} · ${fmtMoney(sellPrice(slug))} cada una</small></span>
                <em class="pp-price">+${fmtMoney(sellPrice(slug))}</em>
                <span class="pp-shop-btns">
                  <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-shop="sell" data-slug="${slug}" data-n="1">Vender</button>
                  ${n > 1 ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-shop="sell" data-slug="${slug}" data-n="${n}" title="Vender las ${n} por ${fmtMoney(sellPrice(slug) * n)}">Todas</button>` : ""}
                </span></div>`
            )
            .join("")}</div>`
        : `<p class="pp-bag-empty">No tienes nada que vender.</p>`;
    }
    await openModal({
      eyebrow: "PokéPark",
      title: "Tienda",
      width: 600,
      html: `
        <div class="pp-bag pp-shop">
          <div class="pp-shop-head">
            <div class="pp-bag-tabs">
              <button type="button" class="pp-bag-tab" data-tab="buy">Comprar</button>
              <button type="button" class="pp-bag-tab" data-tab="sell">Vender</button>
            </div>
            <span class="pp-chip pp-shop-money" title="Tus Pokédólares"></span>
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
            return body(popup);
          }
          const b = e.target.closest("[data-shop]");
          if (!b) return;
          if (b.dataset.shop === "buy") buy(b.dataset.slug, Number(b.dataset.n) || 1);
          else sell(b.dataset.slug, Number(b.dataset.n) || 1);
          body(popup);
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
    return `<span class="pp-tr-mon">${thumbHtml(m)}<span><b>${m.shiny ? "✦ " : ""}${esc(m.nick || s?.n || "???")}</b><small>${m.nick ? `${esc(s?.n || "")} · ` : ""}Nv. ${m.lv}${m.held ? ` · ${esc(itemName(m.held))}` : ""}${extra}</small></span></span>`;
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
                  ${thumbHtml(m)}<span><b>${m.shiny ? "✦ " : ""}${esc(displayName(m))}</b><small>Nv. ${m.lv}${m.held ? ` · lleva ${esc(itemName(m.held))}` : ""}</small></span></button>`
              )
              .join("") || `<p class="sl-hint">No tienes Pokémon libres para dar.</p>`
          }</div>`;
        return;
      }
      const incoming = trades.list.filter((t) => !t.outgoing && t.status === "pending");
      const outgoing = trades.list.filter((t) => t.outgoing && t.status === "pending");
      const history = trades.list.filter((t) => t.status !== "pending").slice(0, 8);
      box.innerHTML = `
        <section class="pp-tr-sec">
          <h4>Nueva oferta</h4>
          ${
            free.length
              ? `<div class="pp-tr-new">
                  <select class="pp-tr-mon-sel">${free
                    .map((m) => `<option value="${m.uid}" ${m.uid === preselect ? "selected" : ""}>${m.shiny ? "✦ " : ""}${esc(displayName(m))} · Nv. ${m.lv}</option>`)
                    .join("")}</select>
                  <input type="text" class="pp-tr-to" placeholder="Usuario del otro jugador" maxlength="20" spellcheck="false">
                  <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-tr="offer" ${trades.busy ? "disabled" : ""}>${TRADE_SVG}Ofrecer</button>
                </div>
                <p class="pp-tr-hint">Su objeto equipado viaja con él.</p>`
              : `<p class="sl-hint">Todos tus Pokémon están ya en alguna oferta.</p>`
          }
        </section>
        <section class="pp-tr-sec">
          <h4>Te ofrecen ${incoming.length ? `<em>${incoming.length}</em>` : ""}</h4>
          ${
            incoming
              .map(
                (t) => `<div class="pp-tr-row">${monLine(t.monFrom, ` · de <b>${esc(t.from)}</b>`)}
                  <span class="pp-tr-btns">
                    <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-tr="accept" data-id="${t.id}" ${trades.busy ? "disabled" : ""}>Aceptar</button>
                    <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-tr="close" data-id="${t.id}" ${trades.busy ? "disabled" : ""}>Rechazar</button>
                  </span></div>`
              )
              .join("") || `<p class="sl-hint">Nadie te ha ofrecido nada todavía.</p>`
          }
        </section>
        <section class="pp-tr-sec">
          <h4>Tus ofertas</h4>
          ${
            outgoing
              .map(
                (t) => `<div class="pp-tr-row">${monLine(t.monFrom, ` · para <b>${esc(t.to)}</b>`)}
                  <span class="pp-tr-btns"><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-tr="close" data-id="${t.id}" ${trades.busy ? "disabled" : ""}>Cancelar</button></span></div>`
              )
              .join("") || `<p class="sl-hint">No tienes ofertas pendientes.</p>`
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
                    got ? `${esc(speciesName(gave.sp))} ⇄ ${esc(speciesName(got.sp))}` : esc(speciesName(gave.sp))
                  } · ${who}</p>`;
                })
                .join("")}</section>`
            : ""
        }`;
    }

    await openModal({
      eyebrow: "PokéPark",
      title: "Intercambios",
      width: 620,
      html: `<div class="pp-trades"><p class="sl-hint">Cargando…</p></div>`,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "pp-bag-popup pp-trades-popup" },
      didOpen: (popup) => {
        trades.rerender = () => {
          const to = popup.querySelector(".pp-tr-to")?.value || "";
          const sel = popup.querySelector(".pp-tr-mon-sel")?.value;
          if (sel) preselect = sel;
          body(popup);
          const input = popup.querySelector(".pp-tr-to");
          if (input) input.value = to;
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
          } else if (k === "offer") {
            offerTrade(popup.querySelector(".pp-tr-mon-sel")?.value, popup.querySelector(".pp-tr-to")?.value.trim());
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

  // ------------------------------------------------------------ SVG
  const FS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const TRADE_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>';
  const LOCK_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const UNLOCK_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/></svg>';
  const SHOP_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 4.5 4h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z"/><path d="M5 13v7h14v-7"/><path d="M10 20v-4h4v4"/></svg>';
  const POKEBALL_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h6"/><path d="M15 12h6"/><circle cx="12" cy="12" r="3"/></svg>';
  const POKEBALL_IMG = `<img src="assets/pokepark/items/poke-ball.png" alt="" draggable="false">`;
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
    save();
    render();
    syncTrades();
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
    onShow() {
      if (!ready) return;
      render();
      syncTrades();
      if (state.visitor && !state.visitor.seen) setTimeout(announceVisitor, 400);
    },
    _spriteError: spriteError,
    snapshot() {
      return ready ? { party: state.party, legends: state.legends || {}, shinyCharm: !!state.shinyCharm } : null;
    },
    // La cuenta ha traído otro parque: se recarga desde disco.
    async reload() {
      if (!ready) return;
      const saved = await window.electronAPI.pokeparkGet().catch(() => null);
      if (!saved || !Array.isArray(saved.party)) return;
      state = normalizeState(saved);
      if (state.starter && state.party.length) refreshWild();
      selectedUid = null;
      for (const a of actors.values()) a.el.remove();
      actors.clear();
      render();
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
    _syncTrades: () => syncTrades(),
    _trades: () => trades,
  };

  init();
})();
