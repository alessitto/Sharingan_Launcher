// =====================================================================
// Minijuegos del PokéPark: Pokédle, Voltorb Flip y Blackjack
// =====================================================================
// Desde la 3.5.7 se juegan en el servidor (pokepark_econ.php en la API de
// alejandrodev.es), que guarda la partida, cobra la apuesta y paga el premio
// en el dinero de la cuenta. Este módulo solo hace de puente: la ventana
// recibe lo que ya se puede ver (cartas boca arriba, casillas volteadas) y
// la silueta del Pokédle como imagen, nunca el tablero ni la baraja.
//
// Cada respuesta trae "money": el saldo de la cuenta después de la jugada.

// Nombre normalizado para el Pokédle: sin tildes, símbolos ni mayúsculas
// (el servidor compara así).
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

function createMinigames({ econ, describe, spriteDataUrl }) {
  const call = (route, body, query) => econ()(route, body, query);

  // Envoltorio para IPC: { ok, ...datos } o { ok: false, error }.
  const safe = (fn) => async (...args) => {
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      if (!err?.code) console.error("minijuegos", err);
      return { ok: false, error: describe()(err) || "Algo ha fallado. Prueba otra vez." };
    }
  };

  async function pokedleSilhouette(i) {
    const res = await call("econ/pokedle/sprite", null, { i: Number(i) });
    const img = await spriteDataUrl(res.url);
    if (!img) throw Object.assign(new Error("sprite"), { code: "sprite" });
    return { img };
  }

  const ipc = {
    pokedleToday: safe(() => call("econ/pokedle")),
    pokedleSilhouette: safe((i) => pokedleSilhouette(i)),
    pokedleGuess: safe((i, guess) => call("econ/pokedle/guess", { i: Number(i), g: norm(guess), guess: String(guess || "").trim().slice(0, 30) })),
    voltorbState: safe(() => call("econ/voltorb")),
    voltorbStart: safe((bet) => call("econ/voltorb/start", { bet })),
    voltorbFlip: safe((i) => call("econ/voltorb/flip", { i: Number(i) })),
    voltorbRetire: safe(() => call("econ/voltorb/retire", {})),
    bjState: safe(() => call("econ/bj")),
    bjDeal: safe((bet) => call("econ/bj/deal", { bet })),
    bjHit: safe(() => call("econ/bj/hit", {})),
    bjStand: safe(() => call("econ/bj/stand", {})),
    bjDouble: safe(() => call("econ/bj/double", {})),
  };

  return { ipc };
}

module.exports = { createMinigames };
