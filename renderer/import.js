// Importar juegos instalados y elegir juegos de las cuentas vinculadas.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Importar juegos instalados
// ===============================
// Al pulsar se busca todo solo (Steam, Epic y GOG se localizan por el
// registro de Windows) y después se enseña qué se ha encontrado. Solo
// se pide una carpeta para lo que no se haya encontrado o haya fallado,
// y el .exe de los juegos que no se sepa cómo lanzar.
const IMPORT_PLATFORMS = {
  steam: {
    label: "Steam",
    key: "steamRoot",
    pickTitle: "Carpeta de Steam o de una biblioteca de Steam",
    notFound: "No se ha encontrado Steam en este equipo.",
  },
  epic: {
    label: "Epic Games",
    key: "epicManifestsDir",
    pickTitle: "Carpeta Manifests de Epic",
    notFound: "No se ha encontrado Epic Games Launcher.",
  },
  gog: {
    label: "GOG",
    key: "gogRoot",
    pickTitle: "Carpeta donde instalas los juegos de GOG",
    notFound: "No se ha encontrado GOG Galaxy ni la carpeta C:\\GOG Games.",
  },
  none: {
    label: "Sin launcher",
    key: "noneRoot",
    pickTitle: "Carpeta de juegos sin launcher",
    notFound: "",
  },
};

let enrichingCovers = false;
async function enrichCoversInBackground() {
  if (enrichingCovers) return;
  enrichingCovers = true;
  try {
    const r = await window.electronAPI.enrichCovers({ limit: 80 });
    if (r?.updated) await loadLibrary();
  } catch (err) {
    console.error(err);
  } finally {
    enrichingCovers = false;
  }
}

async function openImportModal() {
  loadingModal("Buscando juegos instalados", "Steam, Epic Games y GOG");

  let report;
  try {
    report = (await window.electronAPI.importInstalledGames({}))?.report || {};
    window.Achievements?.track("imports");
  } catch (err) {
    console.error(err);
    const retry = await confirmDialog({
      title: "No se ha podido completar la búsqueda",
      text: String(err?.message || err),
      confirmText: "Reintentar",
      iconName: "alert",
    });
    if (retry) openImportModal();
    return;
  }

  await loadLibrary();
  refreshSearchUI();
  enrichCoversInBackground();
  showImportResults(report);
}

function mergeImportReport(prev, next) {
  if (next.status !== "ok") {
    if (prev?.status === "ok") {
      showNotification(next.error || "No se encontró nada en esa carpeta.", "error");
      return prev;
    }
    return next;
  }
  if (!prev || prev.status !== "ok") return next;
  return {
    status: "ok",
    location: next.location,
    added: [...prev.added, ...next.added],
    existing: prev.existing + next.existing,
    noLaunch: [...prev.noLaunch, ...next.noLaunch.filter((n) => !prev.noLaunch.some((p) => p.id === n.id))],
    error: null,
  };
}

// Juegos de tus cuentas vinculadas que no tienes en la biblioteca: se
// marcan los que quieras y se añaden (con el botón Descargar). Nada se
// añade solo al vincular ni al importar.
async function openOwnedPicker(platform = null) {
  loadingModal("Buscando en tus cuentas", platform ? STORE_NAMES[platform] : "Steam, Epic Games y GOG");
  const res = await window.electronAPI.stores("available", { platforms: platform ? [platform] : undefined }).catch(() => null);
  if (!Swal.isVisible() || !document.querySelector(".sl-loading")) return;
  const list = res?.list || [];
  if (!res?.ok || !list.length) {
    Swal.close();
    showNotification(res?.ok ? "Ya tienes en la biblioteca todos los juegos de tus cuentas." : res?.error || "No se ha podido leer tu cuenta.", res?.ok ? "success" : "error");
    return;
  }
  const chosen = new Set();
  const r = await openModal({
    eyebrow: platform ? STORE_NAMES[platform] : "Tus cuentas",
    title: "Elige qué juegos añadir",
    width: 620,
    html: `
      <div class="own-pick">
        <div class="own-tools">
          <label class="search-field">${icon("search")}<input type="text" class="own-q" placeholder="Buscar en tus ${list.length} juegos…" aria-label="Buscar"></label>
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-all>Marcar todos</button>
        </div>
        <div class="own-list">${list
          .map(
            (g) => `
          <label class="own-row" data-name="${escapeHtml(g.name.toLowerCase())}">
            <input type="checkbox" value="${escapeHtml(g.key)}">
            <img src="${escapeHtml(g.coverUrl || noCoverSvg(g.name))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=noCoverSvg('')">
            <span>${escapeHtml(g.name)}</span>
            ${platform ? "" : `<i title="${STORE_NAMES[g.platform]}">${storeLogo(g.platform)}</i>`}
          </label>`
          )
          .join("")}</div>
        <p class="sl-hint">Se añaden sin instalar, con el botón <b>Descargar</b>. También te saldrán al buscarlos en Descubrir.</p>
      </div>`,
    showCancelButton: true,
    cancelButtonText: "Cancelar",
    confirmButtonText: "Añadir",
    didOpen: (popup) => {
      const ok = Swal.getConfirmButton();
      const sync = () => {
        ok.disabled = !chosen.size;
        ok.textContent = chosen.size ? `Añadir ${chosen.size}` : "Añadir";
      };
      sync();
      popup.querySelector(".own-list").addEventListener("change", (e) => {
        if (e.target.checked) chosen.add(e.target.value);
        else chosen.delete(e.target.value);
        sync();
      });
      const q = popup.querySelector(".own-q");
      q.addEventListener("input", () => {
        const t = q.value.trim().toLowerCase();
        popup.querySelectorAll(".own-row").forEach((row) => (row.hidden = !!t && !row.dataset.name.includes(t)));
      });
      popup.querySelector("[data-all]").addEventListener("click", (e) => {
        const rows = [...popup.querySelectorAll(".own-row:not([hidden]) input")];
        const all = rows.every((i) => i.checked);
        rows.forEach((i) => {
          i.checked = !all;
          if (!all) chosen.add(i.value);
          else chosen.delete(i.value);
        });
        e.currentTarget.textContent = all ? "Marcar todos" : "Desmarcar";
        sync();
      });
    },
  });
  if (!r.isConfirmed || !chosen.size) return;
  const out = await window.electronAPI.stores("addOwned", [...chosen]).catch(() => null);
  await loadLibrary();
  refreshSearchUI();
  const n = out?.added?.length || 0;
  showNotification(n ? `${n} ${n === 1 ? "juego añadido" : "juegos añadidos"} a tu biblioteca.` : "No se ha añadido ninguno.", n ? "success" : "error");
}

// Descubrir con texto: arriba, los juegos de tus cuentas que coinciden
// y aún no tienes en la biblioteca.
let ownedSeq = 0;
async function renderOwnedMatches(query) {
  const box = document.getElementById("ownedMatches");
  if (!box) return;
  const my = ++ownedSeq;
  const q = String(query || "").trim();
  if (q.length < 2 || isGuest()) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const res = await window.electronAPI.stores("available", { query: q }).catch(() => null);
  if (my !== ownedSeq) return;
  const list = (res?.list || []).slice(0, 12);
  box.hidden = !list.length;
  box.innerHTML = list.length
    ? `<p class="own-strip-title">${icon("link")}En tus cuentas y sin añadir</p>
       <div class="own-strip">${list
         .map(
           (g) => `
         <div class="own-chip">
           <img src="${escapeHtml(g.coverUrl || noCoverSvg(g.name))}" alt="" onerror="this.onerror=null;this.src=noCoverSvg('')">
           <span><b>${escapeHtml(g.name)}</b><small>${storeLogo(g.platform)}${STORE_NAMES[g.platform]}</small></span>
           <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-own-add="${escapeHtml(g.key)}">${icon("plus")}Añadir</button>
         </div>`
         )
         .join("")}</div>`
    : "";
}

document.getElementById("ownedMatches")?.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-own-add]");
  if (!b) return;
  b.disabled = true;
  const out = await window.electronAPI.stores("addOwned", [b.dataset.ownAdd]).catch(() => null);
  if (out?.added?.length) {
    showNotification(`"${out.added[0]}" añadido a tu biblioteca.`);
    b.closest(".own-chip")?.remove();
    if (!document.querySelector("#ownedMatches .own-chip")) renderOwnedMatches("");
    await loadLibrary();
  } else {
    b.disabled = false;
    showNotification("No se ha podido añadir.", "error");
  }
});

function showImportResults(report) {
  const linked = new Set();
  let root = null;
  let busy = false;

  function rowHtml(key) {
    const p = IMPORT_PLATFORMS[key];
    const r = report[key];
    if (!r) return "";

    let state, iconName, text;
    if (r.status === "ok") {
      const n = r.added.length;
      state = "ok";
      iconName = "checkCircle";
      text = n ? `${n} ${n === 1 ? "juego nuevo" : "juegos nuevos"}` : "Sin juegos nuevos";
      if (r.existing) text += ` · ${r.existing} ya ${r.existing === 1 ? "estaba" : "estaban"} en tu biblioteca`;
      if (!n && !r.existing) {
        state = "warn";
        iconName = "alert";
        text = "Encontrado, pero sin juegos instalados.";
      }
    } else if (r.status === "error") {
      state = "error";
      iconName = "xCircle";
      text = r.error || "No se ha podido leer.";
    } else {
      state = "missing";
      iconName = "searchX";
      text = p.notFound;
    }

    // Lo de la cuenta vinculada (sin instalar): no se añade solo, se
    // dice cuántos hay y se eligen con "Elegir".
    const acc = r.account;
    const avail = acc?.status === "ok" ? acc.available || 0 : 0;
    if (acc?.status === "ok" && state !== "ok") {
      state = "ok";
      iconName = "checkCircle";
      text = avail ? "Sin juegos instalados" : "Sin juegos nuevos en tu cuenta";
    } else if (acc?.status === "error") {
      if (state === "ok") state = "warn";
      text += ` · ${acc.error}`;
    }
    const addedNames = [...r.added, ...(acc?.added || [])];

    const needsAction = state === "missing" || state === "error";
    return `
      <div class="imp-row is-${state}" data-key="${key}">
        <span class="imp-row-icon">${icon(iconName)}</span>
        <div class="imp-row-text">
          <span class="imp-row-name">${p.label}</span>
          <span class="imp-row-detail">${escapeHtml(text)}</span>
          ${r.location && r.status === "ok" ? `<span class="imp-row-path">${escapeHtml(r.location)}</span>` : ""}
          ${
            addedNames.length
              ? `<details class="imp-added"><summary>Ver juegos nuevos</summary><p>${addedNames.map(escapeHtml).join(", ")}</p></details>`
              : ""
          }
          ${
            avail
              ? `<button type="button" class="imp-owned" data-owned="${key}">${icon("download")}<span>${avail} ${avail === 1 ? "juego" : "juegos"} de tu cuenta sin añadir · <b>Elegir cuáles</b></span></button>`
              : ""
          }
        </div>
        <button type="button" class="sl-btn ${needsAction ? "sl-btn-primary" : "sl-btn-ghost"} sl-btn-sm" data-pick="${key}" title="${escapeHtml(p.pickTitle)}">
          ${icon(needsAction ? "folderOpen" : "folderPlus")}<span>${needsAction ? "Indicar carpeta" : "Otra carpeta"}</span>
        </button>
      </div>`;
  }

  function noLaunchHtml() {
    const list = Object.values(report)
      .flatMap((r) => r?.noLaunch || [])
      .filter((g) => !linked.has(String(g.id)));
    if (!list.length) return "";
    return `
      <div class="imp-nolaunch">
        <div class="imp-section-title">${icon("alert")}Falta el ejecutable de ${list.length === 1 ? "1 juego" : `${list.length} juegos`}</div>
        <p class="sl-hint">No se ha encontrado su .exe. Elígelo ahora o más tarde.</p>
        ${list
          .map(
            (g) => `
          <div class="imp-nl-row">
            <span>${escapeHtml(g.name)}</span>
            <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-link="${g.id}">${icon("link")}<span>Elegir .exe</span></button>
          </div>`
          )
          .join("")}
      </div>`;
  }

  function render() {
    const reps = Object.values(report).filter(Boolean);
    const added = reps.reduce((n, r) => n + (r.added?.length || 0) + (r.account?.added?.length || 0), 0);
    const existing = reps.reduce((n, r) => n + (r.existing || 0), 0);
    const pending = reps.some((r) => r.status !== "ok");

    root.innerHTML = `
      <div class="imp-summary">
        <span class="imp-summary-num">${added}</span>
        <div>
          <span class="imp-summary-title">${added === 1 ? "juego importado" : "juegos importados"}</span>
          <span class="imp-summary-sub">${
            [existing ? `${existing} ya estaban en tu biblioteca` : null, pending ? "Revisa abajo lo que no se ha encontrado" : null]
              .filter(Boolean)
              .join(" · ") || "Todo encontrado"
          }</span>
        </div>
      </div>
      <div class="imp-rows">${["steam", "epic", "gog", "none"].map(rowHtml).join("")}</div>
      ${noLaunchHtml()}
      ${
        ["steam", "epic", "gog"].some((k) => !report[k]?.account)
          ? `<button type="button" class="imp-add-none" data-stores>
              ${icon("link")}
              <span>
                <b>Vincular Steam, Epic o GOG</b>
                <small>Para ver también los que no tienes instalados.</small>
              </span>
            </button>`
          : ""
      }
      <button type="button" class="imp-add-none" data-pick="none">
        ${icon("folderPlus")}
        <span>
          <b>Añadir una carpeta de juegos sin launcher</b>
          <small>Una subcarpeta por juego.</small>
        </span>
      </button>`;
  }

  async function pick(key) {
    const p = IMPORT_PLATFORMS[key];
    const res = await window.electronAPI.openDirectoryDialog({ title: p.pickTitle });
    if (res.canceled || !res.dirPath) return;

    root.querySelector(`.imp-row[data-key="${key}"]`)?.classList.add("is-loading");
    const out = await window.electronAPI.importInstalledGames({ platforms: [key], [p.key]: res.dirPath });
    const next = out?.report?.[key];
    if (next) report[key] = mergeImportReport(report[key], next);
    render();
    await loadLibrary();
    refreshSearchUI();
    enrichCoversInBackground();
  }

  async function link(id) {
    const res = await window.electronAPI.openFileDialog();
    if (res.canceled) return;
    await window.electronAPI.setExecutable(id, { path: res.filePath });
    linked.add(String(id));
    render();
    await loadLibrary();
  }

  openModal({
    eyebrow: "Importar",
    title: "Juegos instalados",
    width: 640,
    html: `<div class="imp-root"></div>`,
    confirmButtonText: "Listo",
    showCloseButton: true,
    customClass: { popup: "import-popup" },
    didOpen: (popup) => {
      root = popup.querySelector(".imp-root");
      render();
      root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-stores]")) {
          Swal.close();
          setTimeout(() => openSettingsModal("stores"), 120);
          return;
        }
        const own = e.target.closest("[data-owned]");
        if (own) {
          Swal.close();
          setTimeout(() => openOwnedPicker(own.dataset.owned), 120);
          return;
        }
        const b = e.target.closest("[data-pick], [data-link]");
        if (!b || busy) return;
        busy = true;
        root.classList.add("is-busy");
        try {
          if (b.dataset.pick) await pick(b.dataset.pick);
          else await link(b.dataset.link);
        } catch (err) {
          console.error(err);
          showNotification("No se pudo completar la acción.", "error");
          render();
        } finally {
          busy = false;
          root.classList.remove("is-busy");
        }
      });
    },
  });
}
