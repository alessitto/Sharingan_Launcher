# Marketing: marca para redes y vídeo

Todo lo necesario para publicar Sharingan Launcher en YouTube, X, Reddit, Discord y la web con una imagen coherente. No forma parte de la app: `package.json` lo deja fuera del instalador.

- **Design system** (app + marca, con reglas de uso): https://claude.ai/artifact/X3n5AcFBx9BnypLoifhUpx — secciones *Marca* y *Redes y vídeo*.
- **Plan de vídeos** (12 semanas, 26 ideas, guion, producción, SEO y métricas): https://claude.ai/artifact/L3XCssCAAcwJszW5UVAZoK

## Qué hay

| Carpeta | Contenido |
| --- | --- |
| `brand/brand.css` | Colores, letra, logotipo, sello 写輪眼, tomoe, halo, grano y anillo. Lo cargan todas las plantillas. |
| `brand/fonts/` | Inter 400–900 y Shippori Mincho 800 (solo los caracteres que se usan), licencia SIL OFL 1.1. |
| `brand/logo/` | El ojo (`sharingan-mark.png`), el logotipo para fondo oscuro y claro, y el sello. |
| `templates/` | Plantillas HTML: miniatura (4 variantes), rótulo, subtítulos, cortinilla de capítulo, cartela, pantalla final, banner de YouTube, cabecera de X, vista previa social, avatar, banner de Discord y logotipo. |
| `export/` | Lo que sale de las plantillas con los textos por defecto, listo para subir. |
| `shots/` | Capturas 1920×1080 de cada sección de la 4.4.1 con una biblioteca **de ejemplo** (juegos inventados). Sirven para probar las plantillas; para publicar, captura tu biblioteca real. |
| `video/` | El sting de marca (`sting-intro-marca.mp4`, la intro real de la app que acaba en la cartela, con el jingle) y la versión que acaba en la app (`sting-intro-app.mp4`). 1920×1080, 30 fps. |

## Pintar las plantillas

Necesita Playwright con Chromium (`npm i -D playwright && npx playwright install chromium`).

```bash
# Todo el kit en marketing/export
node marketing/render.js

# Una miniatura con tu texto y tu captura (*palabra* en rojo, | = salto de línea)
node marketing/render.js thumbnail mini.jpg "t=¿Me va *Cyberpunk*?" k="Semáforo de requisitos" img=/ruta/captura.png pos="40% 70%" zoom=1.5

# Variantes de miniatura: v=numero (n=914 u=h), v=versus, v=serie (ep="Ep. 2" paso=3/2)
node marketing/render.js thumbnail mini.jpg v=numero n=1240 u=h "t=Mi año *jugando*" img=/ruta/estadisticas.png

# Rótulo con tu nombre (PNG transparente para poner encima del vídeo)
node marketing/render.js lower-third rotulo.png "nombre=Alex" "cargo=Creador de Sharingan Launcher"
```

Parámetros comunes: `t` (titular), `k` (antetítulo), `img` (captura), `pos`/`zoom` (encuadre), `url`, `paso` (tomoe encendidos, p. ej. `3/2`). También se pueden abrir las plantillas en el navegador con los parámetros en la URL.

## Reglas rápidas

- Fondo de tinta con el halo rojo, la app real con anillo de 2 px, titular corto en Inter 900 con UNA palabra en rojo y el sello una vez.
- La marca usa siempre el tema Itachi + estilo Predeterminado; los demás temas se enseñan como función.
- No uses arte ni metraje de Naruto o Pokémon, ni esos nombres como gancho; no enseñes funciones relacionadas con copias no oficiales de juegos.
