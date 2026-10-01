// =====================================================================
// PokéPark
// =====================================================================
// Un parque donde viven hasta 6 Pokémon elegidos por el usuario. Mientras
// la app está abierta ganan experiencia, se les da de comer (bayas), se les
// limpia (amistad), evolucionan como en los juegos (nivel, piedras, amistad,
// día/noche, objeto equipado...) salvo por intercambio, y de vez en cuando
// aparecen objetos en el parque o los encuentra algún Pokémon.
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
  const CLEAN_COOLDOWN_MS = 30 * 60 * 1000;
  const GROUND_MAX = 4; // objetos tirados en el parque a la vez
  const MOVE_SUBST_LEVEL = 33; // "conoce el movimiento X" -> nivel aproximado
  const SPECIAL_SUBST_LEVEL = 36; // condiciones de combate/lugar -> nivel aproximado

  const SPRITE_ANI = (id) => `https://play.pokemonshowdown.com/sprites/gen5ani/${id}.gif`;
  const SPRITE_PNG = (id) => `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
  const ITEM_IMG = (slug) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${slug}.png`;

  // Bayas: exp base (escala con el nivel) y amistad. "w" = probabilidad de salir.
  const BERRIES = {
    "oran-berry": { n: "Baya Aranja", exp: 50, fr: 3, w: 10, desc: "Muy nutritiva: buena experiencia." },
    "sitrus-berry": { n: "Baya Zidra", exp: 100, fr: 4, w: 4, desc: "Jugosa y rara: mucha experiencia." },
    "cheri-berry": { n: "Baya Zreza", exp: 35, fr: 4, w: 8, desc: "Picante. Un poco de todo." },
    "chesto-berry": { n: "Baya Atania", exp: 35, fr: 4, w: 8, desc: "Dura y seca. Un poco de todo." },
    "pecha-berry": { n: "Baya Meloc", exp: 25, fr: 7, w: 8, desc: "Muy dulce: les encanta." },
    "rawst-berry": { n: "Baya Safre", exp: 35, fr: 4, w: 7, desc: "Amarga. Un poco de todo." },
    "aspear-berry": { n: "Baya Perasi", exp: 35, fr: 4, w: 7, desc: "Ácida. Un poco de todo." },
    "razz-berry": { n: "Baya Frambu", exp: 15, fr: 10, w: 5, desc: "Su favorita: mucha amistad." },
    "pinap-berry": { n: "Baya Pinia", exp: 70, fr: 2, w: 5, desc: "Les da energía: más experiencia." },
    "lum-berry": { n: "Baya Ziuela", exp: 180, fr: 8, w: 1.5, desc: "Rarísima. Experiencia y amistad." },
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
    return { v: 1, party: [], bag: { "oran-berry": 3, "pecha-berry": 2, "razz-berry": 1 }, ground: [] };
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.electronAPI.pokeparkSave(state), 600);
  }

  // ------------------------------------------------------------ Pokédex
  const species = (id) => byId.get(Number(id));
  const speciesName = (id) => species(id)?.n || "???";
  const displayName = (mon) => mon.nick || speciesName(mon.sp);
  const itemName = (slug) => BERRIES[slug]?.n || dex.items[slug]?.n || slug;
  const isBerry = (slug) => !!BERRIES[slug];

  function isPickable(s) {
    return !s.from && !s.leg && !s.myth && !s.ub;
  }

  function spriteHtml(sp, cls = "") {
    const s = species(sp);
    const first = s.a ? SPRITE_ANI(s.sd) : SPRITE_PNG(s.sd);
    return `<img class="pp-sprite ${cls} ${s.a ? "" : "is-static"}" src="${first}" data-sd="${s.sd}" data-fb="${s.sprite || ""}" alt="" draggable="false" onerror="PokePark._spriteError(this)">`;
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
    return `<img class="pp-item-img ${cls}" src="${ITEM_IMG(slug)}" alt="" draggable="false" onerror="this.onerror=null;this.src='assets/icon.png'">`;
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
    return h >= 6 && h < 18 ? "day" : "night";
  }
  function matchesTime(t) {
    const h = new Date().getHours();
    if (t === "day") return h >= 6 && h < 18;
    if (t === "night" || t === "full-moon") return h >= 18 || h < 6;
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
    if (kind === "trade" || kind === "none") return false;
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
    const ok = usableDetails(s)
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
    if (kind === "trade") return d.held ? `Intercambio con ${itemName(d.held)} (llegará con el modo online)` : "Intercambio (llegará con el modo online)";
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
      blocked: kindOf(d) === "trade",
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
    if (Swal.isVisible()) {
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
            <div class="pp-evo-from">${spriteHtml(fromSp)}</div>
            <div class="pp-evo-to">${spriteHtml(job.to)}</div>
          </div>
          <h3 class="pp-evo-title">¿Qué? ¡${esc(oldName)} está evolucionando!</h3>
          <p class="pp-evo-text">&nbsp;</p>
        </div>`,
      showConfirmButton: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
      customClass: { popup: "sl-modal-sm pp-evo-popup" },
      didOpen: (popup) => {
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
  }

  function feedInfo(mon) {
    if (!mon.feedStart || now() - mon.feedStart > FEED_WINDOW_MS) return { left: FEED_MAX, resetIn: 0 };
    return { left: Math.max(0, FEED_MAX - (mon.feedCount || 0)), resetIn: mon.feedStart + FEED_WINDOW_MS - now() };
  }

  function feed(mon, berry) {
    const b = BERRIES[berry];
    if (!b || !(state.bag[berry] > 0)) return;
    if (!mon.feedStart || now() - mon.feedStart > FEED_WINDOW_MS) {
      mon.feedStart = now();
      mon.feedCount = 0;
    }
    if (mon.feedCount >= FEED_MAX) {
      showNotification(`${displayName(mon)} está lleno. Podrá volver a comer en ${fmtDuration(feedInfo(mon).resetIn)}.`, "error");
      return;
    }
    takeFromBag(berry);
    mon.feedCount++;
    const exp = b.exp * (1 + mon.lv / 8);
    addFriendship(mon, b.fr);
    floatText(mon, `+${Math.round(exp)} EXP`);
    showNotification(`${displayName(mon)} se ha comido una ${b.n}.`);
    gainExp(mon, exp);
    save();
    render();
  }

  function clean(mon) {
    const wait = (mon.cleanedAt || 0) + CLEAN_COOLDOWN_MS - now();
    if (wait > 0) {
      showNotification(`${displayName(mon)} ya está limpio. Vuelve en ${fmtDuration(wait)}.`, "error");
      return;
    }
    mon.cleanedAt = now();
    addFriendship(mon, 10);
    floatText(mon, "¡Reluciente!", true);
    sparkle(mon);
    save();
    render();
  }

  function takeFromBag(slug, n = 1) {
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

  // Objeto al azar: bayas casi siempre; objetos evolutivos a veces.
  function randomItem(evoChance) {
    if (Math.random() >= evoChance) return pickWeighted(Object.entries(BERRIES).map(([k, v]) => [k, v.w]));
    const pool = [...useItems, ...heldItems]
      .filter((s) => !ITEM_BLOCKLIST.has(s))
      .map((s) => [s, COMMON_STONES.has(s) ? 5 : useItems.has(s) ? 2 : 1.2]);
    return pickWeighted(pool);
  }

  // ------------------------------------------------------------ Latido
  function tick() {
    if (!ready || !state.party.length) return;
    tickCount++;
    let dirty = false;

    if (tickCount % EXP_EVERY_TICKS === 0) {
      for (const mon of state.party) {
        gainExp(mon, 10 + mon.lv * 4);
        addFriendship(mon, 1);
      }
      dirty = true;
    }

    // Objetos que aparecen en el parque
    if (state.ground.length < GROUND_MAX && Math.random() < 0.18) {
      state.ground.push({ id: `g${now()}${Math.floor(Math.random() * 1000)}`, slug: randomItem(0.18), x: rand(0.06, 0.94), y: rand(0.15, 0.9) });
      dirty = true;
    }

    // Algún Pokémon encuentra algo
    for (const mon of state.party) {
      if (Math.random() < 0.025) {
        const slug = randomItem(0.3);
        addToBag(slug);
        showNotification(`¡${displayName(mon)} ha encontrado ${isBerry(slug) ? "una" : ""} ${itemName(slug)}!`.replace("  ", " "));
        floatText(mon, "¡Ha encontrado algo!", true);
        dirty = true;
      }
    }

    if (dirty) {
      save();
      render();
    }
    updateClock();
  }

  // ------------------------------------------------------------ Render
  function selected() {
    return state.party.find((m) => m.uid === selectedUid) || state.party[0] || null;
  }

  function render() {
    if (!root || !ready) return;
    renderSide();
    renderParkStatic();
    syncActors();
    renderGround();
    updateBagBadge();
  }

  function shell() {
    root.innerHTML = `
      <aside class="pp-side">
        <div class="pp-team"></div>
        <div class="pp-detail"></div>
      </aside>
      <div class="pp-park" data-tod="day">
        <div class="pp-sky"><div class="pp-stars"></div><div class="pp-sun"></div></div>
        ${SCENERY_SVG}
        <div class="pp-ground"><div class="pp-items"></div><div class="pp-mons"></div></div>
        <div class="pp-hud">
          <span class="pp-chip pp-clock"></span>
          <span class="pp-chip pp-count"></span>
        </div>
        <div class="pp-empty"></div>
        <button type="button" class="pp-bag-btn" title="Bolsa" aria-label="Abrir la bolsa">
          ${BAG_SVG}<span class="pp-bag-badge"></span>
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
          ? `<button type="button" class="pp-slot ${sel && m.uid === sel.uid ? "is-active" : ""}" data-pp="select" data-uid="${m.uid}" title="${esc(displayName(m))}">
               <img src="${SPRITE_PNG(species(m.sp).sd)}" alt="" onerror="this.onerror=null;this.src='${species(m.sp).sprite || ""}'">
               <span class="pp-slot-lv">Nv.${m.lv}</span>
             </button>`
          : `<button type="button" class="pp-slot is-empty" data-pp="pick" title="Elegir Pokémon">${icon("plus")}</button>`
      );
    }
    team.innerHTML = `
      <div class="pp-team-head"><span class="section-eyebrow">PokéPark</span><span class="pp-team-count">${state.party.length}/${PARTY_MAX}</span></div>
      <div class="pp-slots">${slots.join("")}</div>`;

    const det = root.querySelector(".pp-detail");
    if (!sel) {
      det.innerHTML = `
        <div class="pp-welcome">
          <h3>Tu parque está vacío</h3>
          <p>Elige a tu compañero. Ganará experiencia mientras tengas la app abierta, podrás darle de comer, limpiarlo y verlo evolucionar.</p>
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
    const cleanWait = (sel.cleanedAt || 0) + CLEAN_COOLDOWN_MS - now();
    const hints = evolutionHints(sel);
    const gender = sel.g === "m" ? '<span class="pp-g is-m">♂</span>' : sel.g === "f" ? '<span class="pp-g is-f">♀</span>' : "";

    det.innerHTML = `
      <div class="pp-card">
        <div class="pp-portrait">${spriteHtml(sel.sp, "pp-portrait-img")}</div>
        <div class="pp-name-row">
          <label class="pp-nick" title="Pulsa para ponerle un mote">
            <input class="pp-nick-input" value="${esc(displayName(sel))}" maxlength="12" spellcheck="false" aria-label="Mote">
            ${icon("pencil", "pp-nick-icon")}
          </label>
          ${gender}
        </div>
        <p class="pp-species">${sel.nick ? `${esc(s.n)} · ` : ""}Nº ${String(s.id).padStart(4, "0")}</p>
        <div class="pp-types">${s.t.map((t) => `<span class="pp-type" style="--tc:${TYPE_COLORS[t] || "#888"}">${esc(dex.types[t] || t)}</span>`).join("")}</div>

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

        <div class="pp-held">
          <span class="pp-held-label">Objeto</span>
          ${
            sel.held
              ? `<span class="pp-held-item">${itemImg(sel.held)}${esc(itemName(sel.held))}</span>
                 <button type="button" class="pp-link" data-pp="unequip">Quitar</button>`
              : `<span class="pp-held-none">Ninguno</span>`
          }
        </div>

        ${
          hints.length
            ? `<div class="pp-evo-hints"><span class="pp-held-label">Evolución</span>${hints
                .map(
                  (h) => `<p class="${h.blocked ? "is-blocked" : ""}"><img src="${SPRITE_PNG(species(h.to).sd)}" alt="" onerror="this.style.display='none'"><span><b>${esc(speciesName(h.to))}</b>${esc(h.text)}</span></p>`
                )
                .join("")}</div>`
            : `<div class="pp-evo-hints"><span class="pp-held-label">Evolución</span><p class="is-final"><span>No evoluciona más.</span></p></div>`
        }

        <div class="pp-actions">
          <button type="button" class="sl-btn sl-btn-primary" data-pp="feed" ${fi.left ? "" : "disabled"}>
            ${BERRY_SVG}<span>Dar de comer</span>
          </button>
          <button type="button" class="sl-btn sl-btn-ghost" data-pp="clean" ${cleanWait > 0 ? "disabled" : ""}>
            ${icon("sparkles")}<span>Limpiar</span>
          </button>
        </div>
        <p class="pp-cooldowns">
          ${fi.left ? `Comidas con experiencia: ${fi.left}/${FEED_MAX}` : `Lleno · vuelve a tener hambre en ${fmtDuration(fi.resetIn)}`}
          ${cleanWait > 0 ? ` · Limpio (${fmtDuration(cleanWait)})` : ""}
        </p>
      </div>`;
  }

  function renderParkStatic() {
    root.querySelector(".pp-count").textContent = `${state.party.length}/${PARTY_MAX} Pokémon`;
    const empty = root.querySelector(".pp-empty");
    empty.innerHTML = state.party.length
      ? ""
      : `<div class="pp-empty-card"><p>Aquí vivirán tus Pokémon</p><button type="button" class="sl-btn sl-btn-primary" data-pp="pick">${icon("plus")}Elegir Pokémon</button></div>`;
  }

  function updateClock() {
    if (!root) return;
    const tod = timeOfDay();
    const park = root.querySelector(".pp-park");
    if (park && park.dataset.tod !== tod) park.dataset.tod = tod;
    const c = root.querySelector(".pp-clock");
    if (c) {
      const d = new Date();
      c.innerHTML = `${tod === "day" ? SUN_SVG : MOON_SVG}${tod === "day" ? "Día" : "Noche"} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }

  function updateBagBadge() {
    const n = Object.values(state.bag).reduce((a, b) => a + b, 0);
    const badge = root.querySelector(".pp-bag-badge");
    if (badge) {
      badge.textContent = n > 99 ? "99+" : n;
      badge.style.display = n ? "" : "none";
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

  function groundRect() {
    const g = root?.querySelector(".pp-ground");
    return g ? { w: g.clientWidth, h: g.clientHeight } : { w: 0, h: 0 };
  }

  function syncActors() {
    const layer = root.querySelector(".pp-mons");
    const { w, h } = groundRect();
    const alive = new Set(state.party.map((m) => m.uid));
    for (const [uid, a] of actors) {
      if (!alive.has(uid)) {
        a.el.remove();
        actors.delete(uid);
      }
    }
    for (const mon of state.party) {
      let a = actors.get(mon.uid);
      if (!a) {
        const el = document.createElement("div");
        el.className = "pp-mon";
        el.dataset.uid = mon.uid;
        el.dataset.pp = "select";
        a = { el, x: rand(0.1, 0.9) * (w || 600), y: rand(0.2, 0.85) * (h || 300), tx: 0, ty: 0, idleUntil: now() + rand(300, 2500), facing: 1, sp: null };
        layer.appendChild(el);
        actors.set(mon.uid, a);
      }
      if (a.sp !== mon.sp) {
        a.sp = mon.sp;
        a.el.innerHTML = `<span class="pp-mon-ring"></span><span class="pp-mon-shadow"></span>${spriteHtml(mon.sp, "pp-mon-img")}<span class="pp-mon-name"></span>`;
      }
      a.el.querySelector(".pp-mon-name").textContent = displayName(mon);
      a.el.classList.toggle("is-selected", mon.uid === selected()?.uid);
    }
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame(t) {
    rafId = null;
    const visible = document.getElementById("pokepark")?.classList.contains("active");
    const dt = Math.min(0.05, (t - (lastFrame || t)) / 1000);
    lastFrame = t;
    if (visible) {
      const { w, h } = groundRect();
      for (const [uid, a] of actors) {
        const mon = state.party.find((m) => m.uid === uid);
        if (!mon || !w) continue;
        if (now() < a.idleUntil) {
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

  function sparkle(mon) {
    const el = actorOf(mon);
    if (!el) return;
    for (let i = 0; i < 6; i++) {
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
    if (!t) return;
    const act = t.dataset.pp;
    const mon = selected();
    if (act === "select") {
      selectedUid = t.dataset.uid;
      hop(selectedUid);
      render();
    } else if (act === "pick") openPicker();
    else if (act === "feed" && mon) openFeedMenu(mon, t);
    else if (act === "clean" && mon) clean(mon);
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
      addToBag(g.slug);
      t.classList.add("is-taken");
      setTimeout(() => render(), 300);
      showNotification(`Has recogido ${itemName(g.slug)}.`);
      save();
    }
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".pp-bag-btn")) openBag();
    if (!e.target.closest(".pp-feed-menu") && !e.target.closest('[data-pp="feed"]')) closeFeedMenu();
  });

  // ------------------------------------------------------------ Dar de comer
  function closeFeedMenu() {
    document.querySelector(".pp-feed-menu")?.remove();
  }

  function openFeedMenu(mon, anchor) {
    closeFeedMenu();
    const berries = Object.keys(BERRIES).filter((b) => state.bag[b] > 0);
    const menu = document.createElement("div");
    menu.className = "pp-feed-menu";
    menu.innerHTML = berries.length
      ? `<p class="pp-feed-title">¿Qué baya le das a ${esc(displayName(mon))}?</p>
         ${berries
           .map(
             (b) => `<button type="button" class="pp-feed-opt" data-berry="${b}">
               ${itemImg(b)}<span><b>${esc(BERRIES[b].n)}</b><small>${esc(BERRIES[b].desc)}</small></span><em>×${state.bag[b]}</em>
             </button>`
           )
           .join("")}`
      : `<p class="pp-feed-title">No tienes bayas</p><p class="pp-feed-empty">Aparecen por el parque de vez en cuando, y a veces tus Pokémon las encuentran.</p>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.max(12, Math.min(window.innerWidth - menu.offsetWidth - 12, r.left))}px`;
    menu.style.top = `${r.top - mh - 8 > 12 ? r.top - mh - 8 : r.bottom + 8}px`;
    menu.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-berry]");
      if (!opt) return;
      closeFeedMenu();
      feed(mon, opt.dataset.berry);
    });
  }

  // ------------------------------------------------------------ Elegir Pokémon
  async function openPicker() {
    if (state.party.length >= PARTY_MAX) {
      showNotification(`Ya tienes ${PARTY_MAX} Pokémon en el parque.`, "error");
      return;
    }
    const list = dex.species.filter(isPickable);
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
      title: "Elige un Pokémon",
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
          <p class="pp-pick-note"><span class="pp-pick-count"></span> · Solo Pokémon en su primera etapa. Legendarios, singulares y ultraentes no se pueden elegir. Te quedan ${PARTY_MAX - state.party.length} de ${PARTY_MAX} huecos.</p>
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
      text: `Solo puedes tener ${PARTY_MAX} Pokémon en el parque y no se puede deshacer. ${
        left ? `Después te quedarán ${left} ${left === 1 ? "hueco" : "huecos"}.` : "Será el último hueco libre."
      }`,
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
      g: s.g === -1 ? null : Math.random() * 8 < s.g ? "f" : "m",
      iv: Array.from({ length: 6 }, () => Math.floor(Math.random() * 32)),
      held: null,
      at: now(),
    };
    state.party.push(mon);
    selectedUid = mon.uid;
    save();
    render();
    hop(mon.uid);
    showNotification(`¡${s.n} se ha unido a tu parque!`);
  }

  // ------------------------------------------------------------ Bolsa
  async function openBag() {
    let tab = "berries";
    let action = null; // { slug, mode: 'use' | 'equip' }

    const groups = () => {
      const entries = Object.entries(state.bag).filter(([, n]) => n > 0);
      return {
        berries: entries.filter(([s]) => isBerry(s)),
        use: entries.filter(([s]) => !isBerry(s) && useItems.has(s)),
        held: entries.filter(([s]) => !isBerry(s) && !useItems.has(s)),
      };
    };

    function body(popup) {
      const g = groups();
      const box = popup.querySelector(".pp-bag-body");
      popup.querySelectorAll(".pp-bag-tab").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.tab === tab);
        b.querySelector("em").textContent = g[b.dataset.tab].reduce((a, [, n]) => a + n, 0);
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
        berries: "No tienes bayas. Aparecen por el parque y tus Pokémon las encuentran de vez en cuando.",
        use: "No tienes objetos evolutivos. Las piedras y demás aparecen por el parque o las encuentra algún Pokémon.",
        held: "No tienes objetos para equipar.",
      };
      box.innerHTML = list.length
        ? `<div class="pp-bag-list">${list
            .map(([slug, n]) => {
              const btn =
                tab === "berries"
                  ? `<span class="pp-bag-hint">Desde «Dar de comer»</span>`
                  : tab === "use"
                    ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bag="use" data-slug="${slug}">Usar</button>`
                    : `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bag="equip" data-slug="${slug}">Equipar</button>`;
              const sub =
                tab === "berries"
                  ? BERRIES[slug].desc
                  : tab === "use"
                    ? "Se gasta al usarlo para evolucionar."
                    : heldNote(slug);
              return `<div class="pp-bag-row">${itemImg(slug)}<span class="pp-bag-name"><b>${esc(itemName(slug))}</b><small>${esc(sub)}</small></span><em>×${n}</em>${btn}</div>`;
            })
            .join("")}</div>`
        : `<p class="pp-bag-empty">${empty[tab]}</p>`;
    }

    function heldNote(slug) {
      const trade = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "trade"));
      const level = dex.species.some((s) => (s.evo || []).some((d) => d.held === slug && kindOf(d) === "level"));
      if (level) return "Equípaselo: al subir de nivel puede hacerle evolucionar.";
      if (trade) return "Para evolucionar por intercambio (llegará con el modo online).";
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

  // ------------------------------------------------------------ SVG
  const BAG_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M5 13h14"/><path d="M11 13v2h2v-2"/></svg>';
  const BERRY_SVG =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 7c0-2 1-4 4-4"/><path d="M12 7c-1-1.5-3-2-5-1.5"/></svg>';
  const SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  // Paisaje del parque: colinas, árboles, estanque y flores. Los colores
  // salen del tema activo (ver pokepark.css), así combina con cada uno.
  const SCENERY_SVG = `
    <svg class="pp-scenery" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path class="pp-hill-far" d="M0 250 C120 190 220 215 330 200 C450 182 520 228 640 205 C760 182 860 196 1000 215 L1000 600 L0 600Z"/>
      <path class="pp-hill-mid" d="M0 290 C160 245 280 270 420 258 C560 246 650 285 800 268 C880 260 950 262 1000 270 L1000 600 L0 600Z"/>
      <g class="pp-tree"><rect x="78" y="190" width="12" height="80" rx="4"/><circle cx="84" cy="180" r="42"/><circle cx="58" cy="205" r="28"/><circle cx="110" cy="203" r="30"/></g>
      <g class="pp-tree pp-tree-b"><rect x="884" y="180" width="12" height="90" rx="4"/><circle cx="890" cy="168" r="48"/><circle cx="860" cy="196" r="30"/><circle cx="922" cy="194" r="32"/></g>
      <g class="pp-tree pp-tree-c"><rect x="738" y="214" width="9" height="56" rx="3"/><circle cx="742" cy="206" r="30"/><circle cx="722" cy="222" r="20"/><circle cx="764" cy="222" r="21"/></g>
      <path class="pp-ground-fill" d="M0 300 C200 285 380 295 520 290 C700 284 850 292 1000 288 L1000 600 L0 600Z"/>
      <ellipse class="pp-pond" cx="210" cy="470" rx="120" ry="34"/>
      <ellipse class="pp-pond-shine" cx="190" cy="462" rx="54" ry="8"/>
      <g class="pp-bush"><circle cx="560" cy="300" r="22"/><circle cx="586" cy="296" r="26"/><circle cx="612" cy="302" r="20"/></g>
      <g class="pp-bush"><circle cx="300" cy="306" r="18"/><circle cx="322" cy="300" r="22"/></g>
      <g class="pp-flowers">
        <circle cx="420" cy="520" r="5"/><circle cx="436" cy="530" r="4"/><circle cx="660" cy="430" r="5"/><circle cx="676" cy="438" r="4"/>
        <circle cx="830" cy="520" r="5"/><circle cx="120" cy="360" r="4"/><circle cx="520" cy="380" r="4"/><circle cx="950" cy="400" r="5"/>
      </g>
      <g class="pp-grass">
        <path d="M380 450 l4 -16 l4 16 M386 450 l6 -12"/><path d="M720 520 l4 -16 l4 16 M726 520 l6 -12"/>
        <path d="M600 360 l4 -14 l4 14"/><path d="M90 520 l4 -16 l4 16 M96 520 l6 -12"/><path d="M900 480 l4 -16 l4 16"/>
      </g>
    </svg>`;

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
    state = saved && Array.isArray(saved.party) ? { ...newState(), ...saved } : newState();
    state.bag ||= {};
    state.ground ||= [];
    ready = true;
    shell();
    render();
    setInterval(tick, TICK_MS);
    setInterval(updateClock, 30 * 1000);
  }

  window.PokePark = {
    onShow() {
      if (!ready) return;
      render();
    },
    _spriteError: spriteError,
  };

  init();
})();
