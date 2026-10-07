// =====================================================================
// Juegos gratis (Steam, Epic y GOG)
// =====================================================================
// Juegos de pago que están gratis para quedártelos durante un tiempo. Se
// miran al arrancar y cada hora; lo que deja de estar gratis desaparece de
// la lista en la siguiente vuelta (y si se sabe la fecha de fin, en cuanto
// pasa). De cada tienda:
//
//  - Epic: su API pública freeGamesPromotions (los de esta semana y los de
//    la siguiente, que salen como "próximamente").
//  - Steam: búsqueda de la tienda con descuento y precio 0 (solo juegos), y
//    cada uno se confirma con appdetails (precio original > 0 y 100 % de
//    descuento: así no salen los gratuitos de siempre). La fecha de fin, si
//    la hay, sale de la página del juego.
//  - GOG: catálogo con descuento y precio 0, más el regalo de la portada
//    (el "giveaway", que se reclama desde gog.com).
//
// La lista se guarda en userData/freegames.json. Los ids ya avisados van en
// settings.freeSeen para no repetir el aviso.
const fs = require("fs");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const REFRESH_MS = 60 * 60 * 1000;

function createFreeGames({ fetch, cacheFile, onChange }) {
  let data = { items: [], fetchedAt: 0, stores: {} };
  try {
    const d = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (d && Array.isArray(d.items)) data = d;
  } catch {}
  let loading = null;
  let timer = null;

  const persist = () => {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch {}
  };
  const get = (url, opts = {}) => fetch(url, { timeout: 20000, ...opts, headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", ...(opts.headers || {}) } });
  const ms = (s) => {
    const t = Date.parse(s || "");
    return Number.isFinite(t) ? t : null;
  };

  // ---------------- Epic
  async function epic() {
    const res = await get("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=es-ES&country=ES&allowCountries=ES");
    if (!res.ok) throw new Error(`epic ${res.status}`);
    const json = await res.json();
    const out = [];
    const now = Date.now();
    for (const g of json?.data?.Catalog?.searchStore?.elements || []) {
      const offers = (list) => (list || []).flatMap((x) => x.promotionalOffers || []).filter((o) => o?.discountSetting?.discountPercentage === 0);
      const cur = offers(g.promotions?.promotionalOffers).find((o) => ms(o.startDate) <= now && (!ms(o.endDate) || ms(o.endDate) > now));
      const up = offers(g.promotions?.upcomingPromotionalOffers)[0];
      const o = cur || up;
      if (!o) continue;
      const slug =
        g.catalogNs?.mappings?.find((m) => m.pageType === "productHome")?.pageSlug ||
        g.offerMappings?.find((m) => m.pageType === "productHome")?.pageSlug ||
        String(g.productSlug || g.urlSlug || "").replace(/\/home$/, "");
      const img = (types) => types.map((t) => g.keyImages?.find((k) => k.type === t)?.url).find(Boolean) || null;
      out.push({
        id: `epic:${g.id}`,
        store: "epic",
        title: g.title,
        // Las de Epic pesan mucho (2560 px): se piden reducidas.
        image: ((u) => (u && /epicgames\.com/.test(u) ? `${u}${u.includes("?") ? "&" : "?"}h=270&quality=medium&resize=1&w=480` : u))(
          img(["OfferImageWide", "DieselStoreFrontWide", "featuredMedia", "Thumbnail", "OfferImageTall"])
        ),
        url: slug ? `https://store.epicgames.com/es-ES/${g.offerType === "BUNDLE" ? "bundles" : "p"}/${slug}` : "https://store.epicgames.com/es-ES/free-games",
        start: ms(o.startDate),
        end: ms(o.endDate),
        upcoming: !cur,
        price: g.price?.totalPrice?.originalPrice ? g.price.totalPrice.originalPrice / 100 : null,
      });
    }
    return out;
  }

  // ---------------- Steam
  async function steamEnd(appid) {
    try {
      const res = await get(`https://store.steampowered.com/app/${appid}/?cc=es&l=spanish`, { headers: { Cookie: "birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1" } });
      const html = await res.text();
      const m = html.match(/InitDailyDealTimer\(\s*\$DiscountCountdown\s*,\s*(\d{9,})/);
      if (m) return Number(m[1]) * 1000;
      // "Gratis si lo consigues antes del 12 OCT a las 19:00" / "termina el 12 de octubre"
      const t = html.match(/(?:antes del|termina el)\s+(\d{1,2})\s+(?:de\s+)?([a-záé]{3})[a-záé]*\.?(?:\s+a las\s+(\d{1,2}):(\d{2}))?/i);
      const mon = t && ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"].indexOf(t[2].toLowerCase());
      if (!t || mon < 0) return null;
      const now = new Date();
      let d = new Date(now.getFullYear(), mon, Number(t[1]), t[3] ? Number(t[3]) : 19, t[4] ? Number(t[4]) : 0);
      if (d.getTime() < now.getTime() - 86400000) d = new Date(now.getFullYear() + 1, mon, Number(t[1]), d.getHours(), d.getMinutes());
      return d.getTime();
    } catch {
      return null;
    }
  }

  async function steam() {
    const res = await get("https://store.steampowered.com/search/results/?query&maxprice=free&specials=1&category1=998&json=1&cc=es&l=spanish&count=50&infinite=1");
    if (!res.ok) throw new Error(`steam ${res.status}`);
    const json = await res.json();
    const rows = String(json.results_html || "").split(/<a href="/).slice(1);
    const found = [];
    for (const r of rows) {
      const appid = r.match(/data-ds-appid="(\d+)"/)?.[1];
      const title = r.match(/<span class="title">([^<]+)/)?.[1];
      if (appid && title) found.push({ appid, title: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') });
    }
    const out = [];
    for (const f of found.slice(0, 30)) {
      // Confirmar que es una promoción (no un juego gratuito de siempre).
      const det = await get(`https://store.steampowered.com/api/appdetails?appids=${f.appid}&cc=es&filters=price_overview`).then((r) => r.json()).catch(() => null);
      const p = det?.[f.appid]?.data?.price_overview;
      // Con el 100 % Steam deja final = initial y discount_percent = 100.
      if (!p || !(p.initial > 0) || !(p.discount_percent === 100 || p.final === 0)) continue;
      out.push({
        id: `steam:${f.appid}`,
        store: "steam",
        title: f.title,
        image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${f.appid}/header.jpg`,
        url: `https://store.steampowered.com/app/${f.appid}/`,
        start: null,
        end: await steamEnd(f.appid),
        upcoming: false,
        price: p.initial / 100,
      });
    }
    return out;
  }

  // ---------------- GOG
  async function gog() {
    const res = await get("https://catalog.gog.com/v1/catalog?limit=48&countryCode=ES&locale=es-ES&currencyCode=EUR&productType=in:game,pack&discounted=eq:true&price=between:0,0&order=desc:trending");
    if (!res.ok) throw new Error(`gog ${res.status}`);
    const json = await res.json();
    const out = (json.products || [])
      .filter((p) => p.price && Number(String(p.price.finalMoney?.amount ?? p.price.final ?? "1").replace(/[^\d.,]/g, "").replace(",", ".")) === 0)
      .map((p) => ({
        id: `gog:${p.id}`,
        store: "gog",
        title: p.title,
        image: p.coverHorizontal || p.coverVertical || null,
        url: p.storeLink || `https://www.gog.com/es/game/${p.slug}`,
        start: null,
        end: null,
        upcoming: false,
        price: Number(String(p.price.baseMoney?.amount ?? "").replace(",", ".")) || null,
      }));
    // El regalo de la portada (se reclama desde gog.com con tu cuenta).
    try {
      const html = await (await get("https://www.gog.com/es/")).text();
      const block = html.match(/<giveaway[\s\S]{0,6000}?<\/giveaway>/i)?.[0] || html.match(/class="[^"]*giveaway__[^"]*"[\s\S]{0,6000}/i)?.[0] || "";
      const link = block.match(/href="(https:\/\/www\.gog\.com\/[a-z]{2}\/game\/[^"#?]+)"/i)?.[1] || block.match(/href="(\/[a-z]{2}\/game\/[^"#?]+)"/i)?.[1];
      if (link) {
        const url = link.startsWith("http") ? link : `https://www.gog.com${link}`;
        const page = await (await get(url)).text();
        const title = (page.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || url.split("/").pop().replace(/_/g, " ")).replace(/ en GOG\.COM$| on GOG\.com$/i, "");
        const image = page.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || null;
        const end = Number(block.match(/data-end-date="(\d{10,13})"/)?.[1]) || null;
        if (!out.some((x) => x.url === url)) {
          out.unshift({ id: `gog:giveaway:${url.split("/").pop()}`, store: "gog", title, image, url: "https://www.gog.com/es/#giveaway", start: null, end: end && end < 1e12 ? end * 1000 : end, upcoming: false, price: null, giveaway: true });
        }
      }
    } catch {}
    return out;
  }

  const SOURCES = { epic, steam, gog };

  // Lo que ya ha terminado no se enseña aunque la tienda aún no responda.
  const fresh = (items) => items.filter((x) => !x.end || x.end > Date.now());

  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      const prev = data.items;
      const items = [];
      const stores = {};
      await Promise.all(
        Object.entries(SOURCES).map(async ([store, fn]) => {
          try {
            items.push(...(await fn()));
            stores[store] = { ok: true, at: Date.now() };
          } catch (err) {
            console.error("juegos gratis", store, err.message);
            // Si una tienda falla se quedan los suyos de la última vez.
            items.push(...prev.filter((x) => x.store === store));
            stores[store] = { ok: false, at: data.stores?.[store]?.at || 0 };
          }
        })
      );
      const seen = new Set();
      data = {
        items: fresh(items).filter((x) => (seen.has(x.id) ? false : seen.add(x.id))),
        fetchedAt: Date.now(),
        stores,
      };
      persist();
      onChange?.(list());
      return list();
    })().finally(() => (loading = null));
    return loading;
  }

  function list() {
    // Los de "próximamente" cuyo día ya ha llegado pasan a ser de ahora.
    const now = Date.now();
    const items = fresh(data.items).map((x) => (x.upcoming && x.start && x.start <= now ? { ...x, upcoming: false } : x));
    return { items, fetchedAt: data.fetchedAt, stores: data.stores || {} };
  }

  return {
    start() {
      if (timer) return;
      setTimeout(() => refresh().catch(() => {}), 8000);
      timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS);
    },
    refresh,
    // Al abrir la página: lo guardado, y si tiene más de 15 min se pide de nuevo.
    async get(force) {
      if (force || Date.now() - data.fetchedAt > 15 * 60 * 1000) refresh().catch(() => {});
      return list();
    },
    list,
  };
}

module.exports = { createFreeGames };
