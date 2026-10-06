// =====================================================================
// Datos de la economía del PokéPark para el servidor
// =====================================================================
// Desde la 3.5.7 el dinero vive en la API (alejandrodev.es). El servidor
// necesita los precios de la tienda y las especies del Pokédle, y los saca de
// este fichero, generado a partir de la misma Pokédex que usa la app:
//
//   node tools/econ-data.js
//
// Escribe alejandrodev.es/public/sharingan_api/data/econ.json. Hay que
// volver a generarlo si cambian pokedex.json o los precios de pokepark.js
// (buyPrice, BERRY_SELL, MEGA_PRICE...), y subirlo con el resto de la web.
const fs = require("fs");
const path = require("path");

const dex = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "pokepark", "pokedex.json"), "utf8"));
const OUT = path.join(__dirname, "..", "..", "..", "alejandrodev.es", "public", "sharingan_api", "data", "econ.json");

// --- Precios: lo mismo que buyPrice()/sellPrice() de pokepark.js
const BALL_PRICE = 200;
const MEGA_PRICE = 10000;
const STONE_SLUGS = new Set(["fire-stone", "water-stone", "thunder-stone", "leaf-stone", "ice-stone", "moon-stone", "sun-stone", "shiny-stone", "dusk-stone", "dawn-stone"]);
const SWEET_SLUGS = new Set(["strawberry-sweet", "berry-sweet", "love-sweet", "star-sweet", "clover-sweet", "flower-sweet", "ribbon-sweet"]);
const RARE_SLUGS = new Set(["chipped-pot", "masterpiece-teacup", "metal-alloy"]);
const BERRY_SELL = { "oran-berry": 40, "sitrus-berry": 100, "cheri-berry": 40, "chesto-berry": 40, "pecha-berry": 40, "rawst-berry": 40, "aspear-berry": 40, "razz-berry": 60, "pinap-berry": 60, "lum-berry": 250 };
const ITEM_BLOCKLIST = new Set(["galarica-cuff", "galarica-wreath", "scroll-of-darkness", "scroll-of-waters"]);

let useItems = new Set();
let heldItems = new Set();
for (const s of dex.species) {
  for (const d of s.evo || []) {
    if (d.item) useItems.add(d.item);
    if (d.held) heldItems.add(d.held);
  }
}
const megaStones = new Set((dex.megas || []).filter((m) => m.stone).map((m) => m.stone));
useItems = new Set([...useItems].filter((s) => !ITEM_BLOCKLIST.has(s)));
heldItems = new Set([...heldItems].filter((s) => !ITEM_BLOCKLIST.has(s) && !useItems.has(s)));

function buyPrice(slug) {
  if (slug === "poke-ball") return BALL_PRICE;
  if (STONE_SLUGS.has(slug)) return 3000;
  if (SWEET_SLUGS.has(slug)) return 500;
  if (RARE_SLUGS.has(slug)) return 6000;
  if (slug === "oval-stone" || slug === "razor-fang" || slug === "razor-claw") return 2000;
  if (heldItems.has(slug)) return 2000;
  if (useItems.has(slug)) return 3000;
  if (megaStones.has(slug)) return MEGA_PRICE;
  return 0;
}

const buy = {};
const sell = {};
for (const slug of new Set(["poke-ball", ...useItems, ...heldItems, ...megaStones])) {
  const p = buyPrice(slug);
  if (p > 0) {
    buy[slug] = p;
    sell[slug] = Math.floor(p / 2);
  }
}
Object.assign(sell, BERRY_SELL);

// --- Pokédle: misma lista y mismo orden que minigames.js tenía en la app
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const pool = dex.species
  .filter((s) => s.id >= 1 && s.id <= 1025 && (s.sd || s.sprite))
  .map((s) => ({
    id: s.id,
    n: s.n,
    k: [...new Set([norm(s.n), norm(s.slug)])],
    gen: s.gen,
    t: s.t,
    first: s.n[0].toUpperCase(),
    len: s.n.replace(/[^\p{L}\p{N}]/gu, "").length,
    img: s.sd ? `https://play.pokemonshowdown.com/sprites/gen5/${s.sd}.png` : s.sprite,
  }));
const names = [...new Set(dex.species.flatMap((s) => [norm(s.n), norm(s.slug)]).filter(Boolean))].sort();

const out = { v: 1, prices: { buy, sell }, types: dex.types, pokedle: pool, names };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`econ.json: ${Object.keys(buy).length} precios, ${pool.length} especies, ${names.length} nombres → ${OUT}`);
