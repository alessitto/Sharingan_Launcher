// Parser mínimo de tablas HTML (wikitables) con rowspan/colspan.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", "#160": " ", thinsp: " ", "#8201": " ", minus: "-", "#8722": "-", ndash: "-", "#8211": "-", times: "×" };
const text = (h) =>
  h
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&([#a-z0-9]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCharCode(parseInt(e.slice(1), 10)) : m))
    .replace(/\[\s*(?:\d+|[a-z]|note \d+|citation needed)\s*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

function tables(html) {
  const out = [];
  const re = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    // título más cercano antes de la tabla
    const before = html.slice(Math.max(0, m.index - 6000), m.index);
    const heads = [...before.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)];
    const title = heads.length ? text(heads[heads.length - 1][1]) : "";
    const grid = [];
    const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => r[1]);
    rows.forEach((row, ri) => {
      grid[ri] ||= [];
      let ci = 0;
      for (const c of row.matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        while (grid[ri][ci] !== undefined) ci++;
        const rs = Number(/rowspan="?(\d+)/i.exec(c[2])?.[1] || 1);
        const cs = Number(/colspan="?(\d+)/i.exec(c[2])?.[1] || 1);
        const cell = { th: c[1].toLowerCase() === "th", t: text(c[3]) };
        for (let r = 0; r < rs; r++) for (let k = 0; k < cs; k++) {
          grid[ri + r] ||= [];
          grid[ri + r][ci + k] = cell;
        }
        ci += cs;
      }
    });
    // cabecera = filas iniciales que son todo th
    let h = 0;
    while (h < grid.length && grid[h].every((c) => c?.th) && h < 4) h++;
    const width = Math.max(...grid.map((r) => r.length));
    const header = Array.from({ length: width }, (_, i) =>
      [...new Set(grid.slice(0, h).map((r) => r[i]?.t).filter(Boolean))].join(" / ")
    );
    let body = grid.slice(h).map((r) => Array.from({ length: width }, (_, i) => r[i]?.t ?? ""));
    // Tablas con la cabecera mal marcada: la primera fila hace de cabecera
    if (header.every((x) => !x) && body.length) {
      const first = body.shift();
      header.splice(0, header.length, ...first);
    }
    out.push({ title, header, body });
  }
  return out;
}

module.exports = { tables, text };
