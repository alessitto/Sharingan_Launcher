// =====================================================================
// Estadísticas y resumen del año
// =====================================================================
// Todo sale del tiempo jugado que ya mide playtime.js:
//   playLog   segundos por día (desde la 4.1, exacto)
//   playDays  días jugados (los de antes de la 4.1): el tiempo que no está
//             en playLog se reparte a partes iguales entre esos días y se
//             avisa de que es aproximado.
// Gráficos de una sola serie (el acento legible del tema), con tooltip al
// pasar el ratón. "Tu año en Sharingan" genera una imagen para compartir.
(() => {
  "use strict";

  const root = document.getElementById("statsRoot");
  if (!root) return;
  const esc = (s) => escapeHtml(String(s ?? ""));
  const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const WEEK = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const WEEK_LONG = ["los lunes", "los martes", "los miércoles", "los jueves", "los viernes", "los sábados", "los domingos"];
  let period = String(new Date().getFullYear());

  const allGames = () => [...libraryGamesCache, ...completedGamesCache];
  const hours = (s) => s / 3600;
  const fmtH = (s) => (s >= 36000 ? `${Math.round(hours(s)).toLocaleString("es-ES")} h` : s >= 3600 ? `${String(Math.round(hours(s) * 10) / 10).replace(".", ",")} h` : `${Math.round(s / 60)} min`);

  // Segundos por día de un juego (con el reparto aproximado de lo antiguo)
  function daysOf(g) {
    const map = {};
    let logged = 0;
    for (const [d, s] of Object.entries(g.playLog || {})) {
      map[d] = Number(s) || 0;
      logged += map[d];
    }
    let approx = false;
    const rest = Math.max(0, (g.playSecs || 0) - logged);
    const missing = (g.playDays || []).filter((d) => !(d in map));
    if (rest > 60 && missing.length) {
      approx = true;
      for (const d of missing) map[d] = rest / missing.length;
    }
    return { map, approx };
  }

  const inPeriod = (day) => period === "all" || day.startsWith(period);

  function compute() {
    let total = 0;
    let approx = false;
    const byMonth = new Map(); // "AAAA-MM" -> s
    const byWeekday = Array(7).fill(0);
    const byGame = [];
    const byGenre = new Map();
    const daySet = new Set();
    for (const g of allGames()) {
      const { map, approx: ap } = daysOf(g);
      let s = 0;
      for (const [d, v] of Object.entries(map)) {
        if (!inPeriod(d) || !(v > 0)) continue;
        s += v;
        daySet.add(d);
        byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) || 0) + v);
        const wd = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
        byWeekday[wd] += v;
      }
      if (!(s > 0)) continue;
      if (ap) approx = true;
      total += s;
      byGame.push({ g, s });
      for (const gen of g.genres || []) if (gen?.name) byGenre.set(gen.name, (byGenre.get(gen.name) || 0) + s);
    }
    byGame.sort((a, b) => b.s - a.s);
    // Racha más larga de días seguidos
    const sorted = [...daySet].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const d of sorted) {
      const t = new Date(`${d}T12:00:00`).getTime();
      run = prev != null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    }
    const inYear = (ms) => ms && (period === "all" || new Date(ms).getFullYear() === Number(period));
    const done = completedGamesCache.filter((g) => inYear(g.completedAt));
    const plats = completedGamesCache.filter((g) => g.isPlatinum && inYear(g.platinumAt || g.completedAt));
    return { total, approx, byMonth, byWeekday, byGame, byGenre, days: daySet.size, streak: best, done, plats };
  }

  function years() {
    const ys = new Set([new Date().getFullYear()]);
    for (const g of allGames()) for (const d of Object.keys(daysOf(g).map)) ys.add(Number(d.slice(0, 4)));
    return [...ys].filter(Boolean).sort((a, b) => b - a);
  }

  // ------------------------------------------------------------ Gráficos
  // Barras verticales (meses o días de la semana)
  function columnChart(rows, { height = 220 } = {}) {
    const max = Math.max(...rows.map((r) => r.v), 1);
    const nice = niceMax(hours(max));
    const W = 100 / rows.length;
    const ticks = [0, nice / 2, nice];
    return `
      <div class="st-chart" style="--h:${height}px">
        <div class="st-axis">${ticks
          .slice()
          .reverse()
          .map((t) => `<span>${String(Math.round(t * 10) / 10).replace(".", ",")} h</span>`)
          .join("")}</div>
        <div class="st-plot">
          ${ticks.map((t) => `<i class="st-grid" style="bottom:${(t / nice) * 100}%"></i>`).join("")}
          ${rows
            .map(
              (r, i) => `
            <div class="st-col" style="left:${i * W}%;width:${W}%" data-tip="${esc(r.tip)}">
              <span class="st-bar" style="height:${r.v > 0 ? Math.max(1.5, (hours(r.v) / nice) * 100) : 0}%"></span>
            </div>`
            )
            .join("")}
        </div>
        <div class="st-labels">${rows.map((r) => `<span>${esc(r.label)}</span>`).join("")}</div>
      </div>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // Barras horizontales con etiqueta (juegos, géneros)
  function barList(rows) {
    const max = Math.max(...rows.map((r) => r.v), 1);
    return `<div class="st-hbars">${rows
      .map(
        (r) => `
      <div class="st-hbar${r.img ? "" : " no-img"}" data-tip="${esc(r.tip)}"${r.open ? ` data-open="${esc(r.open)}"` : ""}>
        ${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.onerror=null;this.src=noCoverSvg('')">` : ""}
        <span class="st-hbar-name">${esc(r.label)}</span>
        <span class="st-hbar-track"><i style="width:${Math.max(1.5, (r.v / max) * 100)}%"></i></span>
        <b>${esc(fmtH(r.v))}</b>
      </div>`
      )
      .join("")}</div>`;
  }

  // ------------------------------------------------------------ Pintar
  function render() {
    const d = compute();
    const ys = years();
    const label = period === "all" ? "Desde siempre" : period;
    let monthRows;
    if (period === "all") {
      // Los últimos 12 meses
      const now = new Date();
      monthRows = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        const v = d.byMonth.get(key) || 0;
        return { v, label: MONTHS[dt.getMonth()], tip: `${MONTHS_LONG[dt.getMonth()]} ${dt.getFullYear()}: ${v ? fmtH(v) : "nada"}` };
      });
    } else {
      monthRows = MONTHS.map((m, i) => {
        const v = d.byMonth.get(`${period}-${String(i + 1).padStart(2, "0")}`) || 0;
        return { v, label: m, tip: `${MONTHS_LONG[i]}: ${v ? fmtH(v) : "nada"}` };
      });
    }
    const favDay = d.byWeekday.indexOf(Math.max(...d.byWeekday));
    const genres = [...d.byGenre.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    root.innerHTML = `
      <header class="page-head">
        <div class="page-head-title"><h2 class="section-title">Estadísticas</h2></div>
        <div class="page-head-actions">
          <select class="lib-select" data-period aria-label="Periodo">
            ${ys.map((y) => `<option value="${y}"${String(y) === period ? " selected" : ""}>${y}</option>`).join("")}
            <option value="all"${period === "all" ? " selected" : ""}>Desde siempre</option>
          </select>
          <button type="button" class="sl-btn sl-btn-primary" data-wrapped ${d.total ? "" : "disabled"}>${icon("sparkles")}Tu ${period === "all" ? "historia" : period} en Sharingan</button>
        </div>
      </header>
      ${
        !d.total
          ? `<div class="empty-state"><span class="empty-icon">${icon("clock")}</span><p class="empty-title">Sin tiempo jugado ${period === "all" ? "todavía" : `en ${period}`}</p><p class="empty-text">El launcher mide solo el tiempo de los juegos con carpeta o .exe, los abras desde donde los abras.</p></div>`
          : `
      <div class="st-tiles">
        <div class="st-tile is-hero"><small>Tiempo jugado · ${esc(label)}</small><b>${esc(fmtH(d.total))}</b></div>
        <div class="st-tile"><small>Juegos jugados</small><b>${d.byGame.length}</b></div>
        <div class="st-tile"><small>Días jugando</small><b>${d.days}</b></div>
        <div class="st-tile"><small>Racha más larga</small><b>${d.streak} ${d.streak === 1 ? "día" : "días"}</b></div>
        <div class="st-tile"><small>Pasados</small><b>${d.done.length}</b></div>
        <div class="st-tile"><small>Platinos</small><b>${d.plats.length}</b></div>
      </div>
      <div class="st-grid2">
        <section class="st-card st-wide">
          <h3 class="st-h">Horas por mes</h3>
          ${columnChart(monthRows)}
        </section>
        <section class="st-card">
          <h3 class="st-h">Lo que más has jugado</h3>
          ${barList(d.byGame.slice(0, 8).map(({ g, s }) => ({ v: s, label: g.name, img: coverOf(g), tip: `${g.name}: ${fmtH(s)}`, open: g.id })))}
        </section>
        <section class="st-card">
          <h3 class="st-h">Días de la semana</h3>
          <p class="st-note">Juegas más ${WEEK_LONG[favDay]}.</p>
          ${columnChart(d.byWeekday.map((v, i) => ({ v, label: WEEK[i], tip: `${WEEK_LONG[i]}: ${v ? fmtH(v) : "nada"}` })), { height: 170 })}
          ${
            genres.length
              ? `<h3 class="st-h st-h-gap">Por género</h3>${barList(genres.map(([n, v]) => ({ v, label: n, tip: `${n}: ${fmtH(v)}` })))}`
              : ""
          }
        </section>
      </div>
      ${d.approx ? `<p class="st-foot">${icon("info")}El tiempo de antes de la versión 4.1 se reparte por igual entre los días en que jugaste: esas horas por día y por mes son aproximadas.</p>` : ""}`
      }
      <div class="st-tip" hidden></div>`;
  }

  // ------------------------------------------------------------ Tu año (imagen)
  async function wrapped() {
    const d = compute();
    const W = 1080;
    const H = 1350;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const v = (n, fb) => css.getPropertyValue(n).trim() || fb;
    const bg = v("--ink-950", "#0d0d0d");
    const card = v("--ink-900", "#151515");
    const fg = v("--washi-50", "#fafafa");
    const muted = v("--ink-300", "#999");
    const accentText = v("--accent-text", "#e05555");
    const font = (w, s) => `${w} ${s}px Inter, "Segoe UI", sans-serif`;
    const title = period === "all" ? "Mi historia en Sharingan" : `Mi ${period} en Sharingan`;

    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    const grad = x.createRadialGradient(W * 0.85, 0, 50, W * 0.85, 0, 900);
    grad.addColorStop(0, `rgba(${v("--red-500-rgb", "166, 20, 20")}, 0.4)`);
    grad.addColorStop(1, `rgba(${v("--red-500-rgb", "166, 20, 20")}, 0)`);
    x.fillStyle = grad;
    x.fillRect(0, 0, W, H);

    const logo = await loadImg("assets/icon.png");
    if (logo) x.drawImage(logo, 80, 80, 64, 64);
    x.fillStyle = muted;
    x.font = font(600, 28);
    x.fillText("Sharingan Launcher", 164, 124);
    x.fillStyle = fg;
    x.font = font(800, 72);
    x.fillText(title, 80, 250);

    // Cifras
    x.fillStyle = accentText;
    x.font = font(800, 150);
    x.fillText(fmtH(d.total), 80, 430);
    x.fillStyle = muted;
    x.font = font(500, 32);
    x.fillText("jugando", 80, 478);
    const tiles = [
      ["Juegos", d.byGame.length],
      ["Días", d.days],
      ["Racha", `${d.streak} d`],
      ["Platinos", d.plats.length],
    ];
    tiles.forEach(([k, val], i) => {
      const tx = 80 + i * 235;
      roundRect(x, tx, 530, 215, 140, 22, card);
      x.fillStyle = muted;
      x.font = font(500, 26);
      x.fillText(k, tx + 26, 578);
      x.fillStyle = fg;
      x.font = font(800, 52);
      x.fillText(String(val), tx + 26, 640);
    });

    // Top 5
    x.fillStyle = fg;
    x.font = font(700, 38);
    x.fillText("Lo que más jugué", 80, 750);
    const top = d.byGame.slice(0, 5);
    const max = Math.max(...top.map((t) => t.s), 1);
    for (let i = 0; i < top.length; i++) {
      const y = 790 + i * 100;
      const img = await loadImg(coverOf(top[i].g));
      if (img) {
        x.save();
        roundRect(x, 80, y, 60, 80, 8, card);
        x.clip();
        x.drawImage(img, 80, y, 60, 80);
        x.restore();
      }
      x.fillStyle = fg;
      x.font = font(600, 30);
      x.fillText(clip(x, top[i].g.name, 560), 166, y + 34);
      roundRect(x, 166, y + 52, 640, 12, 6, card);
      roundRect(x, 166, y + 52, Math.max(12, (top[i].s / max) * 640), 12, 6, accentText);
      x.fillStyle = muted;
      x.font = font(600, 28);
      x.textAlign = "right";
      x.fillText(fmtH(top[i].s), W - 80, y + 64);
      x.textAlign = "left";
    }
    x.fillStyle = muted;
    x.font = font(500, 24);
    x.fillText("alejandrodev.es/sharingan_launcher", 80, H - 70);

    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${title}.png`;
    a.click();
    showNotification("Imagen creada: elige dónde guardarla.");
  }

  function roundRect(x, X, Y, w, h, r, fill) {
    x.beginPath();
    x.roundRect(X, Y, w, h, r);
    x.fillStyle = fill;
    x.fill();
  }
  function clip(x, text, max) {
    let t = String(text);
    while (x.measureText(t).width > max && t.length > 3) t = t.slice(0, -2);
    return t === text ? t : `${t.trimEnd()}…`;
  }
  function loadImg(src) {
    return new Promise((res) => {
      if (!src) return res(null);
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });
  }

  // ------------------------------------------------------------ Eventos
  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-period]")) {
      period = e.target.value;
      render();
    }
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-wrapped]")) return wrapped().catch(() => showNotification("No se ha podido crear la imagen.", "error"));
    const open = e.target.closest("[data-open]");
    if (open) window.GamePage?.open(open.dataset.open);
  });
  // Tooltip de las barras
  root.addEventListener("pointermove", (e) => {
    const tip = root.querySelector(".st-tip");
    const el = e.target.closest("[data-tip]");
    if (!tip) return;
    if (!el) return (tip.hidden = true);
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = root.getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left + 14}px`;
    tip.style.top = `${e.clientY - r.top + 14}px`;
  });
  root.addEventListener("pointerleave", () => {
    const tip = root.querySelector(".st-tip");
    if (tip) tip.hidden = true;
  });

  const isActive = () => document.getElementById("stats")?.classList.contains("active");
  window.Stats = { onShow: render, refresh: () => isActive() && render() };
})();
