// =====================================================================
// Página del juego: capturas, logros de Steam y mods
// =====================================================================
// - Capturas, arte, vídeos y enlaces: IGDB.
// - Logros: la lista (nombres, iconos y % de jugadores) es la de Steam
//   (GetSchemaForGame + porcentajes globales). Cuáles tienes:
//     · de tu cuenta de Steam vinculada (GetPlayerAchievements, necesita
//       "Detalles de juegos" en público), y
//     · de los archivos que dejan en el PC los emuladores de Steam
//       (Goldberg/GSE, CODEX, RUNE, EMPRESS, OnlineFix, SKIDROW): así los
//       juegos que no son de Steam también cuentan sus logros.
//   Mientras uno de esos juegos está abierto se vigilan sus archivos y se
//   avisa en cuanto desbloqueas uno (watch).
// - Mods: Nexus Mods (su API GraphQL pública, sin clave) y, si el juego
//   está en Steam, el Workshop. Solo se ven; descargar o instalar se hace
//   en su web o en Steam.
const fs = require("fs");
const path = require("path");

const NEXUS_GQL = "https://api.nexusmods.com/v2/graphql";
const STEAM_API = "https://api.steampowered.com";
const DAY = 864e5;

function createGameInfo({ fetch, igdbQuery, steamKey, steamAppList, Fuse, steamId, cacheFile, notify, onAllUnlocked }) {
  // ------------------------------------------------------------ Caché en disco
  let cache = null;
  let saveTimer = null;
  const load = () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      cache = {};
    }
    for (const k of ["appid", "schema", "global", "nexusGame", "media"]) cache[k] ||= {};
    return cache;
  };
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
      } catch {}
    }, 1500);
  };
  const cached = (bucket, key, maxAge) => {
    const e = load()[bucket][key];
    return e && Date.now() - e.at < maxAge ? e : null;
  };
  const put = (bucket, key, data) => {
    load()[bucket][key] = { ...data, at: Date.now() };
    save();
  };

  async function getJson(url, opts = {}) {
    const res = await fetch(url, { timeout: 20000, ...opts, headers: { "User-Agent": "SharinganLauncher", Accept: "application/json", ...(opts.headers || {}) } });
    if (!res.ok) {
      const err = new Error(`http_${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[®™©]/g, "")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b/g, (r) => ({ i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 })[r])
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  // ------------------------------------------------------------ IGDB: capturas y enlaces
  const LINK_KINDS = [
    [/store\.steampowered\.com/, "steam", "Steam"],
    [/gog\.com/, "gog", "GOG"],
    [/epicgames\.com/, "epic", "Epic Games"],
    [/wikipedia\.org/, "wiki", "Wikipedia"],
    [/(fandom|wikia)\.com/, "fandom", "Wiki"],
    [/reddit\.com/, "reddit", "Reddit"],
    [/discord\.(gg|com)/, "discord", "Discord"],
    [/youtube\.com/, "youtube", "YouTube"],
    [/(twitter|x)\.com/, "x", "X"],
  ];

  async function media({ igdbId }) {
    const id = Number(igdbId);
    if (!(id > 0)) return { screenshots: [], artworks: [], videos: [], links: [] };
    const hit = cached("media", id, 7 * DAY);
    if (hit?.data?.hero !== undefined) return hit.data;
    const rows = await igdbQuery(
      `fields screenshots.image_id,screenshots.width,screenshots.height,artworks.image_id,artworks.width,artworks.height,videos.video_id,videos.name,websites.url,websites.trusted,storyline; where id = ${id};`
    ).catch(() => null);
    const g = Array.isArray(rows) ? rows[0] : null;
    if (!g) return { screenshots: [], artworks: [], videos: [], links: [] };
    const links = [];
    const seen = new Set();
    for (const w of g.websites || []) {
      if (!w?.url) continue;
      const kind = LINK_KINDS.find(([re]) => re.test(w.url));
      const key = kind ? kind[1] : "web";
      if (seen.has(key) || (!kind && links.some((l) => l.kind === "web"))) continue;
      seen.add(key);
      links.push({ kind: key, label: kind ? kind[2] : "Web oficial", url: w.url });
    }
    // Fondo de la cabecera: un arte apaisado y grande (hay "artes" que son
    // franjas o fondos negros); si no hay ninguno así, la primera captura.
    const wide = (x) => x?.image_id && x.width >= 1280 && x.width / Math.max(1, x.height) >= 1.3 && x.width / Math.max(1, x.height) <= 2.4;
    const hero = (g.artworks || []).find(wide)?.image_id || (g.screenshots || []).find((x) => x?.image_id)?.image_id || null;
    const data = {
      hero,
      screenshots: (g.screenshots || []).map((s) => s.image_id).filter(Boolean).slice(0, 16),
      artworks: (g.artworks || []).map((s) => s.image_id).filter(Boolean).slice(0, 8),
      videos: (g.videos || []).filter((v) => v.video_id).slice(0, 6).map((v) => ({ id: v.video_id, name: v.name || "Tráiler" })),
      links: links.filter((l) => /^https:\/\//.test(l.url)),
      storyline: g.storyline || "",
    };
    put("media", id, { data });
    return data;
  }

  // ------------------------------------------------------------ appid de Steam
  // Por orden: el que ya tiene el juego, el de los archivos del emulador en
  // su carpeta, el que da IGDB y, por último, buscarlo por el nombre en la
  // lista de Steam (solo si coincide de verdad: un logro de otro juego
  // sería peor que ninguno).
  const APPID_FILES = ["steam_appid.txt", "steam_settings/steam_appid.txt"];
  const APPID_INIS = ["steam_emu.ini", "codex.ini", "rune.ini", "ali213.ini", "smartsteamemu.ini", "onlinefix.ini", "cream_api.ini", "steam_settings/configs.app.ini"];

  function appIdFromDir(dir) {
    if (!dir) return null;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return null;
    }
    const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
    for (const f of APPID_FILES) {
      const [first, rest] = f.split("/");
      const real = lower.get(first);
      if (!real) continue;
      try {
        const txt = fs.readFileSync(path.join(dir, real, ...(rest ? [rest] : [])), "utf8").trim();
        if (/^\d{2,8}$/.test(txt)) return Number(txt);
      } catch {}
    }
    for (const f of APPID_INIS) {
      const [first, rest] = f.split("/");
      const real = lower.get(first);
      if (!real) continue;
      try {
        const txt = fs.readFileSync(path.join(dir, real, ...(rest ? [rest] : [])), "utf8");
        const m = txt.match(/^\s*(?:real)?app_?id\s*=\s*(\d{2,8})/im);
        if (m) return Number(m[1]);
      } catch {}
    }
    return null;
  }

  async function resolveAppId(game) {
    if (!game) return null;
    if (Number(game.steamAppId) > 0) return Number(game.steamAppId);
    const key = String(game.id);
    const hit = cached("appid", key, 30 * DAY);
    if (hit) return hit.appid || null;

    let appid = null;
    // Carpeta del .exe y la del juego (y la de arriba del .exe, por si el
    // ejecutable está en bin/ o Binaries/Win64).
    const dirs = new Set();
    if (game.executable) {
      const d = path.dirname(game.executable);
      dirs.add(d);
      dirs.add(path.dirname(d));
      dirs.add(path.dirname(path.dirname(d)));
    }
    if (game.installDir) dirs.add(game.installDir);
    for (const d of dirs) {
      appid = appIdFromDir(d);
      if (appid) break;
    }

    if (!appid && Number(game.igdbId || 0) > 0) {
      const rows = await igdbQuery(`fields uid; where game = ${Number(game.igdbId)} & external_game_source = 1; limit 1;`, "external_games").catch(() => null);
      if (Array.isArray(rows) && /^\d+$/.test(rows[0]?.uid || "")) appid = Number(rows[0].uid);
    }

    if (!appid && game.name) {
      try {
        const list = await steamAppList();
        const target = norm(game.name);
        const exact = list.find((a) => norm(a.name) === target);
        if (exact) appid = exact.appid;
        else {
          const r = new Fuse(list, { keys: ["name"], threshold: 0.15, includeScore: true }).search(game.name, { limit: 1 })[0];
          if (r && r.score <= 0.05) appid = r.item.appid;
        }
      } catch {}
    }
    put("appid", key, { appid: appid || 0 });
    return appid;
  }

  // ------------------------------------------------------------ Logros
  async function schemaOf(appid) {
    const hit = cached("schema", appid, 7 * DAY);
    if (hit) return hit.list;
    if (!steamKey) return null;
    const j = await getJson(`${STEAM_API}/ISteamUserStats/GetSchemaForGame/v2/?key=${steamKey}&appid=${appid}&l=spanish`).catch(() => null);
    if (!j) return null;
    const list = (j.game?.availableGameStats?.achievements || []).map((a) => ({
      name: a.name,
      title: a.displayName || a.name,
      desc: a.description || "",
      icon: a.icon || "",
      iconGray: a.icongray || a.icon || "",
      hidden: !!a.hidden,
    }));
    put("schema", appid, { list });
    return list;
  }

  async function globalOf(appid) {
    const hit = cached("global", appid, DAY);
    if (hit) return hit.map;
    const j = await getJson(`${STEAM_API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => null);
    const map = {};
    for (const a of j?.achievementpercentages?.achievements || []) map[a.name] = Number(a.percent) || 0;
    put("global", appid, { map });
    return map;
  }

  // Tus logros en Steam (cuenta vinculada). null = no se ha podido saber.
  const playerCache = new Map();
  async function playerOf(appid) {
    const sid = steamId();
    if (!sid || !steamKey) return null;
    const c = playerCache.get(appid);
    if (c && Date.now() - c.at < 2 * 60 * 1000) return c.map;
    let map = null;
    try {
      const j = await getJson(`${STEAM_API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${steamKey}&steamid=${sid}&appid=${appid}`);
      if (j?.playerstats?.success) {
        map = {};
        for (const a of j.playerstats.achievements || []) if (a.achieved) map[a.apiname] = (a.unlocktime || 0) * 1000;
      }
    } catch {
      // 400/403: no lo tienes en Steam o el perfil es privado
    }
    playerCache.set(appid, { map, at: Date.now() });
    return map;
  }

  // Dónde guarda cada emulador los logros (Windows).
  function emuFiles(appid) {
    const env = process.env;
    const appData = env.APPDATA || "";
    const local = env.LOCALAPPDATA || "";
    const pub = env.PUBLIC || "C:\\Users\\Public";
    const docs = path.join(pub, "Documents");
    return [
      { emu: "Goldberg", type: "json", file: path.join(appData, "Goldberg SteamEmu Saves", String(appid), "achievements.json") },
      { emu: "Goldberg", type: "json", file: path.join(appData, "GSE Saves", String(appid), "achievements.json") },
      { emu: "EMPRESS", type: "json", file: path.join(appData, "EMPRESS", String(appid), "remote", String(appid), "achievements.json") },
      { emu: "EMPRESS", type: "json", file: path.join(docs, "EMPRESS", String(appid), "remote", String(appid), "achievements.json") },
      { emu: "CODEX", type: "ini", file: path.join(docs, "Steam", "CODEX", String(appid), "achievements.ini") },
      { emu: "CODEX", type: "ini", file: path.join(appData, "Steam", "CODEX", String(appid), "achievements.ini") },
      { emu: "RUNE", type: "ini", file: path.join(docs, "Steam", "RUNE", String(appid), "achievements.ini") },
      { emu: "OnlineFix", type: "ini", file: path.join(docs, "OnlineFix", String(appid), "Stats", "Achievements.ini") },
      { emu: "SKIDROW", type: "ini", file: path.join(local, "SKIDROW", String(appid), "SteamEmu", "UserStats", "achiev.ini") },
    ];
  }

  function parseIni(txt) {
    const out = {};
    let sec = null;
    for (const raw of String(txt).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === ";" || line[0] === "#") continue;
      const s = line.match(/^\[(.+)\]$/);
      if (s) {
        sec = s[1];
        out[sec] ||= {};
        continue;
      }
      const i = line.indexOf("=");
      if (i > 0 && sec) out[sec][line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return out;
  }

  // nombre del logro (en minúsculas) -> ms del desbloqueo (0 si no se sabe)
  function readEmu({ type, file }) {
    let txt;
    try {
      txt = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const got = {};
    const secs = (t) => {
      const n = Number(t) || 0;
      return n > 1e12 ? n : n * 1000;
    };
    if (type === "json") {
      let j;
      try {
        j = JSON.parse(txt.replace(/^\uFEFF/, ""));
      } catch {
        return null;
      }
      const entries = Array.isArray(j) ? j.map((a) => [a.name, a]) : Object.entries(j || {});
      for (const [name, a] of entries) {
        if (!name || !a) continue;
        if (a.earned === true || a.earned === 1 || a.achieved === true || a.Achieved === 1) got[String(name).toLowerCase()] = secs(a.earned_time ?? a.UnlockTime ?? a.unlocktime);
      }
      return got;
    }
    const ini = parseIni(txt);
    for (const [sec, kv] of Object.entries(ini)) {
      const s = sec.toLowerCase();
      if (s === "achievementsunlocktimes") {
        for (const [k, v] of Object.entries(kv)) got[k] = secs(v);
        continue;
      }
      if (s === "achievements") {
        for (const [k, v] of Object.entries(kv)) if (v === "1" || v === "true") got[k] ??= 0;
        continue;
      }
      if (s === "steamachievements" || s === "stats") continue;
      const done = /^(1|true)$/i.test(kv.achieved ?? kv.unlocked ?? "");
      if (done) got[s] = secs(kv.unlocktime ?? kv.timestamp ?? kv.time);
    }
    return got;
  }

  function localOf(appid) {
    const merged = {};
    const emus = new Set();
    for (const f of emuFiles(appid)) {
      const got = readEmu(f);
      if (!got) continue;
      emus.add(f.emu);
      for (const [k, t] of Object.entries(got)) merged[k] = merged[k] ? Math.min(merged[k], t || merged[k]) : t;
    }
    return { map: merged, emus: [...emus] };
  }

  async function achievements(game) {
    const appid = await resolveAppId(game);
    if (!appid) return { ok: false, reason: "no_steam" };
    const [schema, global, player] = await Promise.all([schemaOf(appid), globalOf(appid), playerOf(appid)]);
    if (!schema) return { ok: false, reason: steamKey ? "network" : "no_key", appid };
    const local = localOf(appid);
    const list = schema.map((a) => {
      const steamAt = player ? player[a.name] : undefined;
      const localAt = local.map[a.name.toLowerCase()];
      const unlocked = steamAt !== undefined || localAt !== undefined;
      return {
        ...a,
        percent: global[a.name] ?? null,
        unlocked,
        unlockedAt: unlocked ? Math.max(steamAt || 0, localAt || 0) || null : null,
        source: steamAt !== undefined ? "steam" : localAt !== undefined ? "local" : null,
      };
    });
    return {
      ok: true,
      appid,
      list,
      total: list.length,
      unlocked: list.filter((a) => a.unlocked).length,
      steamLinked: !!steamId(),
      steamData: !!player,
      emus: local.emus,
    };
  }

  // ------------------------------------------------------------ Vigilar logros mientras juegas
  // Solo los de los emuladores: los de Steam ya los avisa Steam.
  const watched = new Map(); // id del juego -> { appid, known:Set, timer }
  async function watch(runningGames) {
    const ids = new Set(runningGames.map((g) => String(g.id)));
    for (const [id, w] of watched) {
      if (ids.has(id)) continue;
      clearInterval(w.timer);
      watched.delete(id);
    }
    for (const g of runningGames) {
      const id = String(g.id);
      if (watched.has(id)) continue;
      const w = { appid: null, known: null, timer: null };
      watched.set(id, w);
      w.appid = await resolveAppId(g).catch(() => null);
      if (!w.appid || watched.get(id) !== w) continue;
      w.known = new Set(Object.keys(localOf(w.appid).map));
      w.timer = setInterval(async () => {
        const now = localOf(w.appid).map;
        const fresh = Object.keys(now).filter((k) => !w.known.has(k));
        if (!fresh.length) return;
        fresh.forEach((k) => w.known.add(k));
        const schema = (await schemaOf(w.appid).catch(() => null)) || [];
        for (const k of fresh) {
          const a = schema.find((s) => s.name.toLowerCase() === k);
          notify({ gameId: g.id, gameName: g.name, name: k, title: a?.title || k, desc: a?.desc || "", icon: a?.icon || "" });
        }
        // Con el último, platino
        if (schema.length && schema.every((s) => w.known.has(s.name.toLowerCase()))) onAllUnlocked?.(g);
      }, 5000);
    }
  }

  // ------------------------------------------------------------ Nexus Mods
  async function gql(query, variables) {
    const j = await getJson(NEXUS_GQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    if (j.errors?.length) throw new Error(j.errors[0].message);
    return j.data;
  }

  const CONSOLE = /playstation|xbox|switch|ps4|ps5|nintendo|\bvr\b|mobile/i;
  async function nexusSearch(term) {
    const data = await gql(
      `query($f: GamesSearchFilter) { games(filter: $f, count: 30) { nodes { id name domainName modCount } } }`,
      { f: { name: [{ value: term, op: "WILDCARD" }] } }
    );
    return data?.games?.nodes || [];
  }

  // Juego de Nexus para un nombre: exacto si lo hay; si no, el que más mods
  // tenga entre los que se parecen de verdad (uno dentro del otro).
  async function nexusGameFor(game, override) {
    const key = String(game.id);
    if (override) {
      put("nexusGame", key, { game: override, manual: true });
      return override;
    }
    const hit = cached("nexusGame", key, 14 * DAY);
    if (hit) return hit.game;
    const name = String(game.name || "").replace(/[®™©]/g, "");
    const parts = name.split(/\s*[:\-–]\s+/);
    const words = name.split(/\s+/);
    const terms = [...new Set([name, parts[parts.length - 1], parts[0], words.slice(0, 2).join(" ")].map((t) => t.trim()).filter((t) => t.length >= 3))].slice(0, 4);
    const cands = new Map();
    for (const t of terms) {
      try {
        for (const n of await nexusSearch(t)) cands.set(n.domainName, n);
      } catch {}
    }
    const target = norm(name);
    const all = [...cands.values()].filter((c) => c.modCount > 0 && !CONSOLE.test(c.name));
    let best = all.find((c) => norm(c.name) === target) || null;
    if (!best) {
      // Primero los de Nexus que caben enteros en el nombre del juego (el más
      // largo: Skyrim Special Edition antes que Skyrim); si no, los que
      // contienen el nombre del juego (el que más mods tenga).
      const inside = all.filter((c) => norm(c.name) && target.includes(norm(c.name)));
      inside.sort((a, b) => norm(b.name).length - norm(a.name).length || b.modCount - a.modCount);
      const around = all.filter((c) => norm(c.name).includes(target));
      around.sort((a, b) => b.modCount - a.modCount);
      best = inside[0] || around[0] || null;
    }
    const out = best ? { domain: best.domainName, name: best.name, modCount: best.modCount } : null;
    put("nexusGame", key, { game: out });
    return out;
  }

  const NEXUS_SORT = { popular: "endorsements", downloads: "downloads", updated: "updatedAt", new: "createdAt" };
  async function nexusMods(domain, { sort = "popular", query = "", page = 0 } = {}) {
    const filter = { gameDomainName: [{ value: domain }], adultContent: [{ value: false }] };
    if (query) filter.name = [{ value: query, op: "WILDCARD" }];
    const data = await gql(
      `query($f: ModsFilter, $s: [ModsSort!], $o: Int) { mods(filter: $f, sort: $s, offset: $o, count: 24) { totalCount nodes { modId name summary pictureUrl thumbnailUrl endorsements downloads updatedAt category version uploader { name } } } }`,
      { f: filter, s: [{ [NEXUS_SORT[sort] || "endorsements"]: { direction: "DESC" } }], o: page * 24 }
    );
    const m = data?.mods || {};
    return {
      total: m.totalCount || 0,
      items: (m.nodes || []).map((n) => ({
        id: n.modId,
        name: n.name,
        summary: n.summary || "",
        image: n.thumbnailUrl || n.pictureUrl || "",
        endorsements: n.endorsements || 0,
        downloads: n.downloads || 0,
        updatedAt: n.updatedAt || null,
        category: n.category || "",
        version: n.version || "",
        author: n.uploader?.name || "",
        url: `https://www.nexusmods.com/${domain}/mods/${n.modId}`,
      })),
    };
  }

  // ------------------------------------------------------------ Steam Workshop
  const WS_SORT = { popular: 3, downloads: 9, updated: 21, new: 1 };
  async function workshop(appid, { sort = "popular", query = "", page = 0 } = {}) {
    if (!steamKey || !appid) return null;
    const q = new URLSearchParams({
      key: steamKey,
      appid: String(appid),
      query_type: String(query ? 12 : WS_SORT[sort] ?? 3),
      page: String(page + 1),
      numperpage: "24",
      return_previews: "false",
      return_short_description: "true",
      return_vote_data: "true",
      return_tags: "true",
      days: "3650",
    });
    if (query) q.set("search_text", query);
    const j = await getJson(`${STEAM_API}/IPublishedFileService/QueryFiles/v1/?${q}`).catch(() => null);
    const r = j?.response;
    if (!r) return null;
    return {
      total: r.total || 0,
      items: (r.publishedfiledetails || [])
        .filter((f) => f.result === 1 && f.title)
        .map((f) => ({
          id: f.publishedfileid,
          name: f.title,
          summary: (f.short_description || "").replace(/\[[^\]]+\]/g, ""),
          image: f.preview_url || "",
          subscriptions: Number(f.lifetime_subscriptions || f.subscriptions || 0),
          favorited: Number(f.favorited || 0),
          score: f.vote_data?.score ?? null,
          updatedAt: f.time_updated ? new Date(f.time_updated * 1000).toISOString() : null,
          tags: (f.tags || []).map((t) => t.display_name || t.tag).filter(Boolean).slice(0, 3),
          url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${f.publishedfileid}`,
        })),
    };
  }

  async function mods(game, opts = {}) {
    const source = opts.source === "workshop" ? "workshop" : "nexus";
    const out = { source, nexusGame: null, steamAppId: null, nexus: null, workshop: null };
    const [nexusGame, appid] = await Promise.all([nexusGameFor(game, opts.nexusOverride).catch(() => null), resolveAppId(game).catch(() => null)]);
    out.nexusGame = nexusGame;
    out.steamAppId = appid;
    if (source === "nexus" && nexusGame) out.nexus = await nexusMods(nexusGame.domain, opts).catch(() => null);
    if (source === "workshop" && appid) out.workshop = await workshop(appid, opts);
    // Para saber si enseñar la pestaña del Workshop: una consulta mínima.
    if (appid && source === "nexus" && steamKey) {
      const probe = await getJson(`${STEAM_API}/IPublishedFileService/QueryFiles/v1/?key=${steamKey}&appid=${appid}&numperpage=1&query_type=0`).catch(() => null);
      out.workshopCount = probe?.response?.total || 0;
    }
    return out;
  }

  return {
    media,
    achievements,
    mods,
    watch,
    nexusSearch: (term) => nexusSearch(String(term || "").slice(0, 80)).then((l) => l.filter((c) => c.modCount > 0).map((c) => ({ domain: c.domainName, name: c.name, modCount: c.modCount }))),
    resolveAppId,
  };
}

module.exports = { createGameInfo };
