// =====================================================================
// Duración de los juegos (HowLongToBeat)
// =====================================================================
// HowLongToBeat no tiene API pública: se usa la misma que su web. Primero
// pide un token (api/search/site/init) y con él busca (POST api/search/site).
// De cada juego da tres tiempos en segundos: historia (comp_main), historia
// con extras (comp_plus) y completarlo al 100 % (comp_100).
//
// Si HowLongToBeat cambia su web y deja de responder, se usan los tiempos de
// IGDB (game_time_to_beats) para que la ficha no se quede vacía.
//
// Las respuestas se guardan 14 días en userData/hltb-cache.json (lo que no
// se encuentra, 1 día).
const fs = require("fs");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BASE = "https://howlongtobeat.com";
const OK_TTL = 14 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000;

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function createHltb({ fetch, cacheFile, igdbQuery }) {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")) || {};
  } catch {}
  const persist = () => {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {}
  };

  let token = null;
  let tokenAt = 0;
  const headers = { "User-Agent": UA, Referer: `${BASE}/`, Origin: BASE };

  async function getToken(force) {
    if (!force && token && Date.now() - tokenAt < 20 * 60 * 1000) return token;
    const res = await fetch(`${BASE}/api/search/site/init?t=${Date.now()}`, { headers, timeout: 12000 });
    if (!res.ok) throw new Error(`init ${res.status}`);
    token = (await res.json()).token;
    tokenAt = Date.now();
    if (!token) throw new Error("sin token");
    return token;
  }

  async function search(name, retry = false) {
    const t = await getToken(retry);
    const body = {
      searchType: "games",
      searchTerms: norm(name).split(" ").filter(Boolean),
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: null, max: null }, gameplay: { perspective: "", flow: "", genre: "", difficulty: "" }, rangeYear: { min: "", max: "" }, modifier: "" },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "",
        sort: 0,
        randomizer: 0,
      },
      useCache: true,
    };
    const res = await fetch(`${BASE}/api/search/site`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "x-auth-token": t },
      body: JSON.stringify(body),
      timeout: 15000,
    });
    if (res.status === 403 && !retry) return search(name, true); // token caducado
    if (!res.ok) throw new Error(`search ${res.status}`);
    return (await res.json()).data || [];
  }

  // El mejor resultado: mismo nombre (y mismo año si se sabe); si no, el
  // primero que contenga el nombre; si no, el más popular.
  function pick(list, name, year) {
    const q = norm(name);
    const withTimes = list.filter((g) => g.comp_main > 0 || g.comp_plus > 0 || g.comp_100 > 0);
    if (!withTimes.length) return null;
    const same = withTimes.filter((g) => norm(g.game_name) === q || norm(g.game_alias || "") === q);
    if (same.length) return same.find((g) => year && Number(g.release_world) === Number(year)) || same[0];
    if (year) {
      const y = withTimes.find((g) => Number(g.release_world) === Number(year) && norm(g.game_name).includes(q));
      if (y) return y;
    }
    return withTimes.find((g) => norm(g.game_name).includes(q)) || withTimes[0];
  }

  async function fromIgdb(igdbId) {
    if (!igdbId || !igdbQuery) return null;
    const rows = await igdbQuery(`fields hastily,normally,completely; where game_id = ${Number(igdbId)};`, "game_time_to_beats");
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r || !(r.hastily || r.normally || r.completely)) return null;
    return { source: "igdb", main: r.hastily || 0, plus: r.normally || 0, full: r.completely || 0 };
  }

  // { source, id, name, main, plus, full } en segundos, o null.
  async function lookup({ name, year, igdbId }) {
    const key = igdbId ? `igdb:${igdbId}` : `name:${norm(name)}:${year || ""}`;
    const c = cache[key];
    if (c && Date.now() - c.at < (c.data ? OK_TTL : MISS_TTL)) return c.data;
    let data = null;
    let failed = false;
    try {
      const g = pick(await search(name), name, year);
      if (g) data = { source: "hltb", id: g.game_id, name: g.game_name, main: g.comp_main || 0, plus: g.comp_plus || 0, full: g.comp_100 || 0 };
    } catch (err) {
      failed = true;
      console.error("HowLongToBeat", err.message);
    }
    if (!data) data = await fromIgdb(igdbId).catch(() => null);
    // Si HowLongToBeat ha fallado (sin conexión...) no se apunta el "no hay".
    if (data || !failed) {
      cache[key] = { at: Date.now(), data };
      persist();
    }
    return data;
  }

  return { lookup };
}

module.exports = { createHltb };
