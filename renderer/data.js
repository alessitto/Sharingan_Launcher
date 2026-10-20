// Borrar datos y copias de partidas.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Borrar todos los datos
// ===============================
async function wipeAllData() {
  const ok = await confirmDialog({
    title: "¿Borrar todos los datos?",
    text: "Se borra todo, también de tu cuenta. No se puede deshacer.",
    confirmText: "Borrar todo",
    danger: true,
  });
  if (!ok) return;
  try {
    await window.electronAPI.clearAllData();
    await loadLibrary();
    await loadDiscoverGames();
    showNotification("Se han borrado todos los datos.");
  } catch (err) {
    console.error(err);
    showNotification("No se pudieron borrar los datos.", "error");
  }
}

// ===============================
// Copia de partidas
// ===============================
// 1) main.js busca dónde guarda partidas cada juego (manifiesto de
//    Ludusavi), 2) se elige de cuáles hacer copia y dónde (por defecto
//    Documentos o la última carpeta usada), 3) se copian y se enseña de
//    cuáles se ha podido y de cuáles no.
function formatSize(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: n < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

window.electronAPI.onBackupProgress?.((p) => {
  const el = document.getElementById("slLoadingText");
  if (el && p?.name) el.textContent = `${p.done + 1} de ${p.total}: ${p.name}`;
});

async function openBackupModal() {
  loadingModal(
    "Buscando partidas guardadas",
    "La primera vez tarda un poco más."
  );
  let scan;
  try {
    scan = await window.electronAPI.scanSaves();
  } catch (err) {
    scan = { ok: false, error: err.message };
  }
  if (!scan?.ok) {
    await openModal({
      width: 440,
      html: `<div class="sl-confirm"><span class="sl-confirm-icon is-danger">${icon("alert")}</span>
        <h3 class="sl-confirm-title">No se pudo buscar</h3><p class="sl-confirm-text">${escapeHtml(scan?.error || "Error desconocido.")}</p></div>`,
      confirmButtonText: "Cerrar",
      customClass: { popup: "sl-modal-sm" },
    });
    return;
  }

  const owned = new Map([...libraryGamesCache, ...completedGamesCache].map((g) => [String(g.id), g]));
  const found = scan.games.filter((g) => g.count > 0).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const missing = scan.games.filter((g) => g.count === 0).sort((a, b) => a.name.localeCompare(b.name, "es"));
  let dir = scan.dir;

  if (!scan.games.length) {
    await openModal({
      width: 440,
      html: `<div class="sl-confirm"><span class="sl-confirm-icon">${icon("save")}</span>
        <h3 class="sl-confirm-title">No tienes juegos</h3><p class="sl-confirm-text">Añade juegos a tu biblioteca primero.</p></div>`,
      confirmButtonText: "Entendido",
      customClass: { popup: "sl-modal-sm" },
    });
    return;
  }

  const row = (g, enabled) => `
    <label class="bk-row ${enabled ? "" : "is-off"}">
      <input type="checkbox" class="bk-check" value="${escapeHtml(String(g.id))}" ${enabled ? "checked" : "disabled"}>
      <img src="${coverOf(owned.get(String(g.id)))}" alt="">
      <span class="bk-name">${escapeHtml(g.name)}</span>
      <span class="bk-meta">${enabled ? formatSize(g.size) : "Sin partidas localizadas"}</span>
    </label>`;

  const { isConfirmed, value } = await openModal({
    eyebrow: "Datos",
    title: "Copia de partidas",
    width: 620,
    html: `
      <div class="bk-root">
        ${
          found.length
            ? `<div class="bk-toolbar">
                <span class="bk-count">${found.length} ${found.length === 1 ? "juego" : "juegos"} con partidas</span>
                <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bk="all">Seleccionar todo</button>
                <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bk="none">Deseleccionar todo</button>
              </div>
              <div class="bk-list">${found.map((g) => row(g, true)).join("")}</div>`
            : `<p class="sl-hint">No se han encontrado partidas.</p>`
        }
        ${
          missing.length
            ? `<details class="bk-missing"><summary>Sin partidas localizadas (${missing.length})</summary>
                <div class="bk-list">${missing.map((g) => row(g, false)).join("")}</div></details>`
            : ""
        }
        <div class="bk-dest">
          <span class="bk-dest-label">Guardar en</span>
          <span class="bk-dest-path" title="${escapeHtml(dir)}">${escapeHtml(dir)}</span>
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-bk="dir">${icon("folderOpen")}Cambiar</button>
        </div>
      </div>`,
    showCancelButton: true,
    showConfirmButton: found.length > 0,
    confirmButtonText: "Hacer copia",
    cancelButtonText: found.length ? "Cancelar" : "Cerrar",
    customClass: { popup: "bk-popup" },
    didOpen: (popup) => {
      const checks = () => [...popup.querySelectorAll(".bk-list .bk-check:not(:disabled)")];
      const sync = () => {
        const n = checks().filter((c) => c.checked).length;
        const btn = Swal.getConfirmButton();
        if (btn) {
          btn.textContent = n ? `Hacer copia (${n})` : "Hacer copia";
          btn.disabled = n === 0;
        }
      };
      popup.addEventListener("change", (e) => e.target.matches(".bk-check") && sync());
      popup.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-bk]");
        if (!b) return;
        if (b.dataset.bk === "all") checks().forEach((c) => (c.checked = true));
        if (b.dataset.bk === "none") checks().forEach((c) => (c.checked = false));
        if (b.dataset.bk === "dir") {
          const chosen = await window.electronAPI.chooseBackupDir(dir);
          if (chosen) {
            dir = chosen;
            const p = popup.querySelector(".bk-dest-path");
            p.textContent = dir;
            p.title = dir;
          }
        }
        sync();
      });
      sync();
    },
    preConfirm: () => [...document.querySelectorAll(".bk-list .bk-check:checked")].map((c) => c.value),
  });
  if (!isConfirmed || !value?.length) return;

  loadingModal("Copiando partidas", "Preparando…");
  let res;
  try {
    res = await window.electronAPI.backupSaves(value, dir);
  } catch (err) {
    res = { ok: false, error: err.message };
  }
  if (res?.ok) window.Achievements?.track("backups");
  if (!res?.ok) {
    await openModal({
      width: 440,
      html: `<div class="sl-confirm"><span class="sl-confirm-icon is-danger">${icon("alert")}</span>
        <h3 class="sl-confirm-title">No se pudo hacer la copia</h3><p class="sl-confirm-text">${escapeHtml(res?.error || "")}</p></div>`,
      confirmButtonText: "Cerrar",
      customClass: { popup: "sl-modal-sm" },
    });
    return;
  }

  const ok = res.results.filter((r) => r.ok);
  const ko = res.results.filter((r) => !r.ok);
  const { isDenied } = await openModal({
    eyebrow: "Copia de partidas",
    title: ko.length ? "Copia terminada con avisos" : "Copia terminada",
    width: 560,
    html: `
      <div class="bk-result">
        <p class="bk-result-dir">${icon("folderOpen")}<span>${escapeHtml(res.dir)}</span></p>
        ${
          ok.length
            ? `<p class="bk-result-title is-ok">${icon("checkCircle")}Copiados (${ok.length})</p>
               <ul class="bk-result-list">${ok
                 .map(
                   (r) =>
                     `<li><span>${escapeHtml(r.name)}</span><span class="bk-meta">${formatSize(r.size)}${r.partial ? " · algún archivo en uso no se copió" : ""}</span></li>`
                 )
                 .join("")}</ul>`
            : ""
        }
        ${
          ko.length
            ? `<p class="bk-result-title is-ko">${icon("xCircle")}Sin copia (${ko.length})</p>
               <ul class="bk-result-list">${ko
                 .map((r) => `<li><span>${escapeHtml(r.name)}</span><span class="bk-meta">${escapeHtml(r.error)}</span></li>`)
                 .join("")}</ul>`
            : ""
        }
        ${
          missing.length
            ? `<p class="sl-hint">${missing.length} sin partidas en este equipo.</p>`
            : ""
        }
      </div>`,
    confirmButtonText: "Cerrar",
    showDenyButton: ok.length > 0,
    denyButtonText: "Abrir carpeta",
    customClass: { popup: "bk-popup" },
  });
  if (isDenied) window.electronAPI.openBackupDir(res.dir);
}
