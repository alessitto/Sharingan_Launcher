// =====================================================================
// Minijuegos del PokéPark: Pokédle, Voltorb Flip y Blackjack
// =====================================================================
// Todo se decide aquí, en el proceso principal: la ventana solo recibe lo
// que ya se puede ver (cartas boca arriba, casillas volteadas, la silueta)
// y nunca el tablero, la baraja o la respuesta. La apuesta la cobra la
// ventana al empezar y el premio lo calcula este módulo a partir de la
// apuesta guardada en la partida; cada partida se paga una sola vez.
//
//  - Pokédle: 5 siluetas al día (las mismas para todos), 5 intentos cada
//    una y 500 ₽ por acierto. El día sale de la hora del servidor, no del
//    reloj del PC. El progreso se guarda por cuenta y se combina con el del
//    parque sincronizado, así no se repite en otro PC.
//  - Voltorb Flip y Blackjack: sin límite. Los premios están calibrados para
//    que a la larga gane la casa (ver VOLTORB_MULT), así que no se farmea.
const crypto = require("crypto");

const POKEDLE_COUNT = 5;
const POKEDLE_TRIES = 5;
const POKEDLE_REWARD = 500;
const MIN_BET = 100;
const MAX_BET = 10_000_000;

// Voltorb Flip: (×2, ×3, Voltorbs) por nivel, como en HeartGold/SoulSilver.
const VOLTORB_LEVELS = [
  [[3, 1, 6], [0, 3, 6], [5, 0, 6], [2, 2, 6], [4, 1, 6]],
  [[1, 3, 7], [6, 0, 7], [3, 2, 7], [0, 4, 7], [5, 1, 7]],
  [[2, 3, 8], [7, 0, 8], [4, 2, 8], [1, 4, 8], [6, 1, 8]],
  [[3, 3, 8], [0, 5, 8], [8, 0, 10], [5, 2, 10], [2, 4, 10]],
  [[7, 1, 10], [4, 3, 10], [1, 5, 10], [9, 0, 10], [6, 2, 10]],
  [[3, 4, 10], [0, 6, 10], [8, 1, 10], [5, 3, 10], [2, 5, 10]],
  [[7, 2, 10], [4, 4, 10], [1, 6, 13], [9, 1, 13], [6, 3, 10]],
  [[0, 7, 10], [8, 2, 10], [5, 4, 10], [2, 6, 10], [7, 3, 10]],
];
// Premio por limpiar el tablero (× la apuesta). Calibrado con 40.000 partidas
// simuladas por nivel con un jugador que voltea siempre la casilla más segura:
// incluso jugando bien, la casa gana un poco (no se farmea).
const VOLTORB_MULT = [1.1, 1.25, 1.5, 1.85, 2.5, 2.6, 3.5, 3.5];
// Retirarse paga la parte de monedas conseguidas, con un 30 % de descuento.
const VOLTORB_RETIRE = 0.7;

class GameError extends Error {}

function createMinigames({ fs, path, fetch, dataDir, dex, getAccount, spriteDataUrl }) {
  const rnd = (n) => crypto.randomInt(n);
  const storePath = path.join(dataDir, "minigames.json");
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(storePath, "utf8")) || {};
  } catch {}
  const persist = () => {
    try {
      const tmp = storePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
      fs.renameSync(tmp, storePath);
    } catch {}
  };
  const mine = () => {
    const k = String(getAccount() ?? "local");
    return (store[k] ||= {});
  };

  const cleanBet = (bet) => {
    const b = Math.floor(Number(bet));
    if (!Number.isFinite(b) || b < MIN_BET || b > MAX_BET) throw new GameError(`La apuesta tiene que ser de ${MIN_BET} ₽ como mínimo.`);
    return b;
  };

  // ------------------------------------------------------------ Hora del servidor
  // El día del Pokédle sale de la cabecera Date de alejandrodev.es (hora de
  // España), así cambiar el reloj del PC no da siluetas nuevas.
  let clock = { offset: null, at: 0 };
  async function serverNow() {
    if (clock.offset !== null && Date.now() - clock.at < 30 * 60 * 1000) return Date.now() + clock.offset;
    let res;
    try {
      res = await fetch("https://alejandrodev.es/", { method: "HEAD", timeout: 8000 });
    } catch {
      throw new GameError("Necesitas conexión para el Pokédle de hoy.");
    }
    const t = Date.parse(res.headers.get("date") || "");
    if (!Number.isFinite(t)) throw new GameError("No se ha podido saber la fecha de hoy.");
    clock = { offset: t - Date.now(), at: Date.now() };
    return t;
  }
  const madrid = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  // Milisegundos hasta la medianoche de España.
  function msToMidnight(t) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(t)).split(":").map(Number);
    return ((23 - parts[0]) * 3600 + (59 - parts[1]) * 60 + (60 - parts[2])) * 1000;
  }

  // ------------------------------------------------------------ Pokédle
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const pool = dex.species.filter((s) => s.id >= 1 && s.id <= 1025 && (s.sd || s.sprite));

  // Las 5 del día, las mismas para todos (semilla = fecha).
  function pokedleSpecies(day) {
    let h = crypto.createHash("sha256").update(`sharingan-pokedle:${day}`).digest();
    const out = [];
    let k = 0;
    while (out.length < POKEDLE_COUNT) {
      if (k + 4 > h.length) {
        h = crypto.createHash("sha256").update(h).digest();
        k = 0;
      }
      const s = pool[h.readUInt32BE(k) % pool.length];
      k += 4;
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  const blankSlots = () => Array.from({ length: POKEDLE_COUNT }, () => ({ tries: 0, state: "open", guesses: [] }));

  // Progreso de hoy: el guardado aquí combinado con el del parque (que viaja
  // con la cuenta): de cada silueta se queda el más avanzado.
  function pokedleProgress(day, fromPark) {
    const m = mine();
    if (m.pokedle?.day !== day) m.pokedle = { day, slots: blankSlots() };
    if (fromPark?.day === day && Array.isArray(fromPark.slots)) {
      m.pokedle.slots = m.pokedle.slots.map((a, i) => {
        const b = fromPark.slots[i];
        if (!b) return a;
        const done = (x) => x.state === "win" || x.state === "fail";
        if (done(a)) return a;
        if (done(b)) return { tries: Math.min(POKEDLE_TRIES, Number(b.tries) || 0), state: b.state === "win" ? "win" : "fail", guesses: (b.guesses || []).slice(0, POKEDLE_TRIES).map(String) };
        return (Number(b.tries) || 0) > a.tries ? { tries: Math.min(POKEDLE_TRIES, Number(b.tries) || 0), state: "open", guesses: (b.guesses || []).slice(0, POKEDLE_TRIES).map(String) } : a;
      });
    }
    persist();
    return m.pokedle;
  }

  function hintsFor(s, tries) {
    const hints = [];
    if (tries >= 1) hints.push({ k: "gen", v: `${s.gen}ª generación` });
    if (tries >= 2) hints.push({ k: "type", v: s.t.map((t) => dex.types[t] || t).join(" / ") });
    if (tries >= 3) hints.push({ k: "first", v: `Empieza por ${s.n[0].toUpperCase()}` });
    if (tries >= 4) hints.push({ k: "len", v: `${s.n.replace(/[^\p{L}\p{N}]/gu, "").length} letras` });
    return hints;
  }

  // Lo que ve la ventana de cada silueta: sin el nombre mientras esté abierta.
  function slotView(day, i, slot, s) {
    const done = slot.state !== "open";
    return {
      i,
      state: slot.state,
      tries: slot.tries,
      left: POKEDLE_TRIES - slot.tries,
      guesses: slot.guesses,
      hints: hintsFor(s, slot.tries),
      answer: done ? { id: s.id, name: s.n } : null,
    };
  }

  async function pokedleToday(fromPark) {
    const now = await serverNow();
    const day = madrid(now);
    const species = pokedleSpecies(day);
    const prog = pokedleProgress(day, fromPark);
    return {
      day,
      reward: POKEDLE_REWARD,
      tries: POKEDLE_TRIES,
      nextIn: msToMidnight(now),
      slots: prog.slots.map((sl, i) => slotView(day, i, sl, species[i])),
      progress: prog,
    };
  }

  async function pokedleSilhouette(i) {
    const day = madrid(await serverNow());
    const s = pokedleSpecies(day)[Number(i)];
    if (!s) throw new GameError("Esa silueta no existe.");
    const url = s.sd ? `https://play.pokemonshowdown.com/sprites/gen5/${s.sd}.png` : s.sprite;
    return { img: await spriteDataUrl(url) };
  }

  async function pokedleGuess(i, guess, fromPark) {
    const now = await serverNow();
    const day = madrid(now);
    const idx = Number(i);
    const species = pokedleSpecies(day);
    const s = species[idx];
    if (!s) throw new GameError("Esa silueta no existe.");
    const prog = pokedleProgress(day, fromPark);
    const slot = prog.slots[idx];
    if (slot.state !== "open") throw new GameError("Esa silueta ya está resuelta.");
    const g = norm(guess);
    if (!g) throw new GameError("Escribe un nombre.");
    if (!dex.species.some((x) => norm(x.n) === g || norm(x.slug) === g)) throw new GameError("Ese Pokémon no existe.");
    if (slot.guesses.some((x) => norm(x) === g)) throw new GameError("Ya has probado con ese.");
    slot.tries++;
    slot.guesses.push(String(guess).trim().slice(0, 30));
    let reward = 0;
    if (g === norm(s.n) || g === norm(s.slug)) {
      slot.state = "win";
      reward = POKEDLE_REWARD;
    } else if (slot.tries >= POKEDLE_TRIES) slot.state = "fail";
    persist();
    return { slot: slotView(day, idx, slot, s), reward, progress: prog };
  }

  // ------------------------------------------------------------ Voltorb Flip
  let voltorb = null;

  function voltorbBoard(level) {
    const [x2, x3, v] = VOLTORB_LEVELS[level - 1][rnd(5)];
    const cells = Array(25).fill(1);
    const idx = Array.from({ length: 25 }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let k = 0;
    for (let i = 0; i < x2; i++) cells[idx[k++]] = 2;
    for (let i = 0; i < x3; i++) cells[idx[k++]] = 3;
    for (let i = 0; i < v; i++) cells[idx[k++]] = 0;
    return cells;
  }

  function voltorbClues(b) {
    const line = (get) => {
      let sum = 0, vol = 0;
      for (let j = 0; j < 5; j++) {
        const x = get(j);
        if (x) sum += x;
        else vol++;
      }
      return { sum, vol };
    };
    return {
      rows: Array.from({ length: 5 }, (_, i) => line((j) => b[i * 5 + j])),
      cols: Array.from({ length: 5 }, (_, i) => line((j) => b[j * 5 + i])),
    };
  }

  const vLevel = () => Math.min(8, Math.max(1, Number(mine().voltorbLevel) || 1));
  const vMax = (b) => b.reduce((p, x) => (x >= 2 ? p * x : p), 1);

  function voltorbView(extra = {}) {
    if (!voltorb) return { active: false, level: vLevel(), mult: VOLTORB_MULT[vLevel() - 1], minBet: MIN_BET, ...extra };
    const g = voltorb;
    return {
      active: !g.over,
      level: g.level,
      mult: VOLTORB_MULT[g.level - 1],
      bet: g.bet,
      coins: g.coins,
      maxCoins: g.max,
      prize: Math.floor(g.bet * VOLTORB_MULT[g.level - 1]),
      retireNow: g.coins > 1 ? Math.floor(g.bet * VOLTORB_MULT[g.level - 1] * (g.coins / g.max) * VOLTORB_RETIRE) : 0,
      clues: g.clues,
      revealed: g.board.map((x, i) => (g.over || g.open.has(i) ? x : null)),
      minBet: MIN_BET,
      ...extra,
    };
  }

  function voltorbStart(bet) {
    const b = cleanBet(bet);
    const level = vLevel();
    const board = voltorbBoard(level);
    voltorb = { level, bet: b, board, open: new Set(), coins: 1, max: vMax(board), clues: voltorbClues(board), over: false };
    return voltorbView();
  }

  function voltorbEnd(result, payout) {
    const g = voltorb;
    g.over = true;
    const m = mine();
    const before = g.level;
    if (result === "won") m.voltorbLevel = Math.min(8, before + 1);
    else if (result === "lost") m.voltorbLevel = Math.max(1, before - 1);
    persist();
    const view = voltorbView({ result, payout, nextLevel: vLevel() });
    voltorb = null;
    return view;
  }

  function voltorbFlip(i) {
    const g = voltorb;
    const k = Number(i);
    if (!g || g.over) throw new GameError("No hay ninguna partida en curso.");
    if (!Number.isInteger(k) || k < 0 || k > 24 || g.open.has(k)) throw new GameError("Esa casilla no vale.");
    g.open.add(k);
    const v = g.board[k];
    if (v === 0) return voltorbEnd("lost", 0);
    g.coins *= v;
    if (g.coins >= g.max && g.board.every((x, j) => x < 2 || g.open.has(j))) {
      return voltorbEnd("won", Math.floor(g.bet * VOLTORB_MULT[g.level - 1]));
    }
    return voltorbView({ flipped: { i: k, v } });
  }

  function voltorbRetire() {
    const g = voltorb;
    if (!g || g.over) throw new GameError("No hay ninguna partida en curso.");
    const pay = g.coins > 1 ? Math.floor(g.bet * VOLTORB_MULT[g.level - 1] * (g.coins / g.max) * VOLTORB_RETIRE) : 0;
    return voltorbEnd("retired", pay);
  }

  // ------------------------------------------------------------ Blackjack
  // Baraja infinita (cada carta al azar), el crupier se planta en 17,
  // blackjack paga 3:2, se puede doblar con las dos primeras. Sin dividir.
  let bj = null;
  const SUITS = ["s", "h", "d", "c"];
  const draw = () => ({ r: rnd(13) + 1, s: SUITS[rnd(4)] });
  const cardVal = (c) => (c.r === 1 ? 11 : Math.min(10, c.r));
  function total(hand) {
    let t = hand.reduce((a, c) => a + cardVal(c), 0);
    let aces = hand.filter((c) => c.r === 1).length;
    while (t > 21 && aces > 0) {
      t -= 10;
      aces--;
    }
    return t;
  }
  const isBJ = (hand) => hand.length === 2 && total(hand) === 21;

  function bjView(extra = {}) {
    if (!bj) return { active: false, minBet: MIN_BET, ...extra };
    const hide = !bj.over;
    return {
      active: !bj.over,
      bet: bj.bet,
      doubled: bj.doubled,
      player: bj.player,
      playerTotal: total(bj.player),
      dealer: hide ? [bj.dealer[0], null] : bj.dealer,
      dealerTotal: hide ? total([bj.dealer[0]]) : total(bj.dealer),
      canDouble: !bj.over && bj.player.length === 2 && !bj.doubled,
      minBet: MIN_BET,
      ...extra,
    };
  }

  function bjFinish(result) {
    const b = bj.bet * (bj.doubled ? 2 : 1);
    const pay = { blackjack: Math.floor(b * 2.5), win: b * 2, push: b, lose: 0 }[result];
    bj.over = true;
    const view = bjView({ result, payout: pay });
    bj = null;
    return view;
  }

  function bjDealerPlay() {
    while (total(bj.dealer) < 17) bj.dealer.push(draw());
    const p = total(bj.player);
    const d = total(bj.dealer);
    if (d > 21 || p > d) return bjFinish("win");
    if (p === d) return bjFinish("push");
    return bjFinish("lose");
  }

  function bjDeal(bet) {
    const b = cleanBet(bet);
    bj = { bet: b, player: [draw(), draw()], dealer: [draw(), draw()], doubled: false, over: false };
    const pBJ = isBJ(bj.player);
    const dBJ = isBJ(bj.dealer);
    if (pBJ && dBJ) return bjFinish("push");
    if (pBJ) return bjFinish("blackjack");
    if (dBJ) return bjFinish("lose");
    return bjView();
  }

  function bjHit() {
    if (!bj || bj.over) throw new GameError("No hay ninguna mano en curso.");
    bj.player.push(draw());
    const t = total(bj.player);
    if (t > 21) return bjFinish("lose");
    if (t === 21) return bjDealerPlay();
    return bjView();
  }

  function bjStand() {
    if (!bj || bj.over) throw new GameError("No hay ninguna mano en curso.");
    return bjDealerPlay();
  }

  // La ventana ya ha cobrado la segunda apuesta antes de llamar.
  function bjDouble() {
    if (!bj || bj.over || bj.player.length !== 2 || bj.doubled) throw new GameError("Ahora no se puede doblar.");
    bj.doubled = true;
    bj.player.push(draw());
    if (total(bj.player) > 21) return bjFinish("lose");
    return bjDealerPlay();
  }

  // ------------------------------------------------------------ IPC
  const safe = (fn) => async (...args) => {
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      if (!(err instanceof GameError)) console.error("minijuegos", err);
      return { ok: false, error: err instanceof GameError ? err.message : "Algo ha fallado. Prueba otra vez." };
    }
  };

  const ipc = {
    pokedleToday: safe((p) => pokedleToday(p)),
    pokedleSilhouette: safe((i) => pokedleSilhouette(i)),
    pokedleGuess: safe((i, g, p) => pokedleGuess(i, g, p)),
    voltorbState: safe(() => voltorbView()),
    voltorbStart: safe((bet) => voltorbStart(bet)),
    voltorbFlip: safe((i) => voltorbFlip(i)),
    voltorbRetire: safe(() => voltorbRetire()),
    bjState: safe(() => bjView()),
    bjDeal: safe((bet) => bjDeal(bet)),
    bjHit: safe(() => bjHit()),
    bjStand: safe(() => bjStand()),
    bjDouble: safe(() => bjDouble()),
  };

  return { ipc, VOLTORB_MULT, MIN_BET };
}

module.exports = { createMinigames };
