// Pinta las plantillas de marketing/templates a PNG con Chromium (Playwright).
//
//   node marketing/render.js                  todo lo de marketing/export (el kit)
//   (.jpg = JPEG al 92 %; .png = PNG, transparente en rótulo y subtítulos)
//   node marketing/render.js <plantilla> <salida.png> [clave=valor ...]
//
// Ejemplos:
//   node marketing/render.js thumbnail mini.jpg "t=¿Te va *Cyberpunk*?" img=../shots/juego-requisitos.jpg
//   node marketing/render.js thumbnail mini.jpg v=numero n=914 u=h "t=Mi año jugando"
//   node marketing/render.js lower-third rotulo.png "nombre=Alex" "cargo=Creador de Sharingan Launcher"
//
// Las imágenes (img=...) van relativas a marketing/templates/ o como ruta absoluta.
// Necesita Playwright: npm i -D playwright && npx playwright install chromium
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = __dirname;
const SIZES = {
  thumbnail: [1280, 720],
  "lower-third": [1920, 1080],
  "end-screen": [1920, 1080],
  "chapter-card": [1920, 1080],
  captions: [1920, 1080],
  "yt-banner": [2560, 1440],
  "x-header": [1500, 500],
  "social-preview": [1280, 640],
  avatar: [800, 800],
  "discord-banner": [960, 540],
  "brand-card": [1920, 1080],
};
// Plantillas con fondo transparente (para poner encima del vídeo)
const ALPHA = new Set(["lower-third", "captions"]);

// El kit que se regenera con `node marketing/render.js`
const KIT = [
  ["thumbnail", "miniatura-funcion.jpg", { t: "Todos tus juegos en *uno*", k: "Steam · Epic · GOG", img: "../shots/inicio.jpg" }],
  ["thumbnail", "miniatura-numero.jpg", { v: "numero", n: "914", u: "h", t: "Mi año *jugando*", k: "Tu año en Sharingan", img: "../shots/estadisticas.jpg" }],
  ["thumbnail", "miniatura-versus.jpg", { v: "versus", t: "Uno para *todo*", k: "Adiós a 3 launchers", img: "../shots/biblioteca.jpg" }],
  ["thumbnail", "miniatura-serie.jpg", { v: "serie", t: "¿Me va este *juego*?", k: "Semáforo de requisitos", img: "../shots/juego-requisitos.jpg", pos: "40% 70%", zoom: "1.5", ep: "Ep. 2", paso: "3/2" }],
  ["lower-third", "rotulo-nombre.png", {}],
  ["end-screen", "pantalla-final.jpg", {}],
  ["chapter-card", "capitulo.jpg", {}],
  ["captions", "subtitulos.png", {}],
  ["yt-banner", "banner-youtube.jpg", {}],
  ["x-header", "cabecera-x.jpg", {}],
  ["social-preview", "vista-previa-github.jpg", {}],
  ["avatar", "avatar.png", {}],
  ["discord-banner", "banner-discord.jpg", {}],
  ["brand-card", "cartela-marca.jpg", {}],
];

async function render(browser, tpl, out, params) {
  const [w, h] = SIZES[tpl] || [1920, 1080];
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const fixed = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, /^(img|bg)$/.test(k) && path.isAbsolute(v) ? "file://" + v : v])
  );
  const url = "file://" + path.join(ROOT, "templates", tpl + ".html") + "?" + new URLSearchParams(fixed);
  await page.goto(url);
  await page.waitForFunction(() => document.body.classList.contains("is-ready"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(250);
  const jpg = /\.jpe?g$/i.test(out);
  await page.screenshot({ path: out, omitBackground: ALPHA.has(tpl) && !jpg, type: jpg ? "jpeg" : "png", quality: jpg ? 92 : undefined });
  await page.close();
  console.log("✓", path.relative(process.cwd(), out));
}

(async () => {
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  const [tpl, out, ...rest] = process.argv.slice(2);
  if (tpl) {
    const params = Object.fromEntries(rest.map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));
    await render(browser, tpl, path.resolve(out || `${tpl}.png`), params);
  } else {
    fs.mkdirSync(path.join(ROOT, "export"), { recursive: true });
    for (const [t, o, p] of KIT) await render(browser, t, path.join(ROOT, "export", o), p);
  }
  await browser.close();
})();
