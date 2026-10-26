// Utilidades de las plantillas: parámetros de la URL, *palabra* en rojo,
// tomoe en SVG y ajuste del titular a su caja.
(function () {
  const q = new URLSearchParams(location.search);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Texto de la URL: \n o | = salto de línea; *así* = palabra en rojo.
  const rich = (s) => esc(s).replace(/\\n|\|/g, "<br>").replace(/\*([^*]+)\*/g, '<span class="rojo">$1</span>');
  const TOMOE = '<path d="M12.6 2.2C7.4 2.6 3.5 6.9 3.5 12.3c0 4.6 3.6 8.4 8.1 8.4a6.3 6.3 0 0 0 .5-12.6c-2.6 0-4.8 1.4-5.8 3.5C6.8 6.8 9.2 3.6 12.6 2.2Z"/>';
  const tomoe = (n, on) => Array.from({ length: n }, (_, i) => `<svg viewBox="0 0 24 24" class="${i < on ? "on" : ""}" aria-hidden="true">${TOMOE}</svg>`).join("");
  // Baja el tamaño de letra hasta que el texto quepa en su caja.
  function fit(el, min = 24) {
    if (!el) return;
    let size = parseFloat(getComputedStyle(el).fontSize);
    while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && size > min) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  }
  function fill() {
    document.querySelectorAll("[data-p]").forEach((el) => {
      const v = q.get(el.dataset.p);
      if (v != null) el.innerHTML = rich(v);
      else if (el.dataset.rich !== undefined) el.innerHTML = rich(el.textContent.trim());
    });
    document.querySelectorAll("[data-img]").forEach((el) => {
      const v = q.get(el.dataset.img);
      if (v) el.tagName === "IMG" ? (el.src = v) : (el.style.backgroundImage = `url("${v}")`);
    });
    document.querySelectorAll("[data-tomoe]").forEach((el) => {
      const [n, on] = (q.get("paso") || el.dataset.tomoe).split("/").map(Number);
      el.innerHTML = tomoe(n || 3, on || 0);
    });
    document.querySelectorAll("[data-show]").forEach((el) => {
      if (q.get(el.dataset.show) === null && el.dataset.default !== "on") el.remove();
    });
    const v = q.get("v");
    if (v) document.body.dataset.v = v;
  }
  window.SL = { q, rich, tomoe, fit };
  fill();
  document.fonts.ready.then(() => {
    document.querySelectorAll("[data-fit]").forEach((el) => fit(el, +el.dataset.fit || 24));
    document.body.classList.add("is-ready");
  });
})();
