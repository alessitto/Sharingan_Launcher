// Filtro de la biblioteca, nombre para ordenar y gestor de sagas.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// Filtro biblioteca
// ===============================
function toggleLinkedFilter() {
  showOnlyLinked = !showOnlyLinked;
  localStorage.setItem("libraryLinkedFilter", showOnlyLinked);
  applyLibraryFilter();
  updateGamepadFocus(true);
}

function applyLibraryFilter() {
  const btn = document.getElementById("linkedFilterBtn");
  btn.classList.toggle("active", showOnlyLinked);

  let gamesToShow = libraryGamesCache;
  if (showOnlyLinked) gamesToShow = libraryGamesCache.filter(canPlay);

  const title = document.getElementById("libraryTitle");
  title.textContent = `Juegos (${gamesToShow.length})`;

  displayGames("libraryList", gamesToShow, "library");
}

async function confirmUnlink(id) {
  const ok = await confirmDialog({
    title: "¿Desvincular el ejecutable?",
    text: "El juego sigue en tu biblioteca.",
    confirmText: "Desvincular",
    iconName: "link",
  });
  if (!ok) return;

  try {
    await window.electronAPI.unlinkExecutable(id);
    await loadLibrary();
    refreshSearchUI();
    showNotification("Ejecutable desvinculado correctamente.");
  } catch (err) {
    console.error(err);
    showNotification("Error al desvincular el ejecutable.", "error");
  }
}

async function openSortKeyEditor(id) {
  let game = libraryGamesCache.find((g) => String(g.id) === String(id));
  if (!game) {
    const { games, completedGames } = await window.electronAPI.getGames();
    game =
      games.find((g) => String(g.id) === String(id)) ||
      completedGames.find((g) => String(g.id) === String(id));
  }

  if (!game) {
    showNotification("No se encontró el juego.", "error");
    return;
  }

  const name = game.name || "Sin nombre";
  const currentSortKey = game.sortKey || name;

  const { value: newSortKey } = await openModal({
    eyebrow: "Biblioteca",
    title: "Nombre para ordenar",
    width: 440,
    html: `
    <div class="sortkey-modal">
      <img src="${coverOf(game)}" alt="${escapeHtml(name)}" class="sortkey-cover">
      <p>${escapeHtml(name)}</p>
      <span class="sl-hint">Ej.: "Witcher 3" en vez de "The Witcher 3".</span>
    </div>
  `,
    input: "text",
    inputValue: currentSortKey,
    showCancelButton: true,
    confirmButtonText: "Guardar",
    cancelButtonText: "Cancelar",
  });

  if (newSortKey === undefined) return;

  try {
    await window.electronAPI.updateSortKey(id, newSortKey);
    await loadLibrary();
    showNotification("Orden actualizado correctamente.");
  } catch (err) {
    console.error(err);
    showNotification("Error al actualizar el orden.", "error");
  }
}

// ===============================
// Sagas
// ===============================
// Una saga es una carpeta de juegos: se crea, se le meten juegos y ya
// está - el orden lo pone sola por fecha de lanzamiento (main.js la
// busca en IGDB si el juego no la trae). Se puede retocar arrastrando,
// y "Ordenar por lanzamiento" lo vuelve a dejar cronológico. Biblioteca
// y pasados muestran cada saga como un bloque en ese mismo orden.
async function openSagasModal(selectId = null) {
  let sagas = (await window.electronAPI.getSagas()) || [];
  const { games: libGames, completedGames: doneGames } = await window.electronAPI.getGames();
  const allOwned = [...(libGames || []), ...(doneGames || [])];
  const byId = new Map(allOwned.map((g) => [Number(g.id), g]));
  const doneIds = new Set((doneGames || []).map((g) => Number(g.id)));

  let selectedId = sagas.some((s) => s.id === selectId) ? selectId : sagas[0]?.id || null;
  let query = "";
  let confirmingDelete = false;
  let busy = false;
  let root = null;
  // Propuesta de orden de la IA: solo se enseña; se aplica si el
  // usuario quiere y después puede seguir moviéndolos a mano.
  let aiProposal = null;
  let aiThinking = false;
  // Sagas sugeridas (se cargan al abrir) y, para las que se acaban de
  // crear desde una sugerencia, qué juegos la formaban: salen abajo
  // como sugerencias para que el usuario meta los que quiera.
  let suggestions = null;
  const suggestedFor = new Map();

  const esc = escapeHtml;
  const selected = () => sagas.find((s) => s.id === selectedId) || null;
  const ownerOf = (gid) => sagas.find((s) => s.gameIds.includes(Number(gid)));
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9ñ ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const countLabel = (n) => `${n} ${n === 1 ? "juego" : "juegos"}`;

  async function refresh(list) {
    sagas = list || (await window.electronAPI.getSagas()) || [];
    if (!sagas.some((s) => s.id === selectedId)) selectedId = sagas[0]?.id || null;
  }

  function thumbs(saga) {
    const covers = saga.gameIds.slice(0, 3).map((id) => coverOf(byId.get(id)));
    if (!covers.length) return `<span class="sg-thumb-empty">${icon("layers")}</span>`;
    return covers.map((c) => `<img src="${c}" alt="">`).join("");
  }

  function renderList() {
    const ul = root.querySelector(".sg-list");
    ul.innerHTML = sagas.length
      ? sagas
          .map(
            (s) => `
        <li class="sg-item ${s.id === selectedId ? "is-active" : ""}" data-id="${s.id}" draggable="true">
          <span class="sg-item-thumbs">${thumbs(s)}</span>
          <span class="sg-item-text">
            <span class="sg-item-name">${esc(s.name)}</span>
            <span class="sg-item-count">${countLabel(s.gameIds.length)}</span>
          </span>
          <span class="sg-grip" title="Arrastra para reordenar">${icon("grip")}</span>
        </li>`
          )
          .join("")
      : `<li class="sg-list-empty">Aún no tienes sagas.</li>`;
    root.querySelector(".sg-side-hint").style.display = sagas.length > 1 ? "" : "none";
  }

  function renderDetail() {
    const s = selected();
    const d = root.querySelector(".sg-detail");
    if (!s) {
      d.innerHTML = `
        <div class="sg-blank">
          <span class="sg-blank-icon">${icon("layers")}</span>
          <h3>Agrupa tus juegos por saga</h3>
          <p>Se ordenan solos por fecha de lanzamiento.</p>
        </div>`;
      return;
    }

    const deleteHtml = confirmingDelete
      ? `<span class="sg-del-confirm">
           <span>¿Eliminar la saga? Los juegos no se borran.</span>
           <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="del-no">Cancelar</button>
           <button type="button" class="sl-btn sl-btn-danger sl-btn-sm" data-act="del-yes">Eliminar</button>
         </span>`
      : `<button type="button" class="icon-btn sg-del" data-act="del" title="Eliminar saga" aria-label="Eliminar saga">${icon("trash")}</button>`;

    d.innerHTML = `
      <div class="sg-head">
        <div class="sg-name-wrap" title="Haz clic para renombrar">
          <input type="text" class="sg-name" value="${esc(s.name)}" maxlength="80" spellcheck="false" aria-label="Nombre de la saga">
          ${icon("pencil", "sg-name-icon")}
        </div>
        <div class="sg-head-actions">
          ${confirmingDelete ? "" : `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm needs-account ${aiThinking ? "is-loading" : ""}" data-act="ai-sort" title="Ordenar por historia con IA" ${aiThinking ? "disabled" : ""}>${icon("sparkles")}<span>${aiThinking ? "Pensando…" : "Orden con IA"}</span></button>`}
          ${confirmingDelete ? "" : `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="sort" title="Ordenar por fecha de lanzamiento">${icon("calendar")}<span>Ordenar por lanzamiento</span></button>`}
          ${deleteHtml}
        </div>
      </div>
      <ol class="sg-games"></ol>
      <div class="sg-add">
        <label class="sg-search">
          ${icon("search")}
          <input type="text" class="sg-search-input" placeholder="Añadir juegos: busca en tu biblioteca" value="${esc(query)}">
        </label>
        <div class="sg-results"></div>
      </div>`;
    renderGames();
    renderResults();
  }

  function renderGames() {
    const s = selected();
    const ol = root.querySelector(".sg-games");
    if (!s || !ol) return;
    // Ordenar solo tiene sentido con dos juegos o más.
    root.querySelector('[data-act="sort"]')?.toggleAttribute("hidden", s.gameIds.length < 2);
    root.querySelector('[data-act="ai-sort"]')?.toggleAttribute("hidden", s.gameIds.length < 2);
    // Propuesta de la IA pendiente (si la saga no ha cambiado entretanto).
    const p = aiProposal;
    if (p && (p.sagaId !== s.id || p.order.length !== s.gameIds.length || p.order.some((o) => !s.gameIds.includes(o.id)))) {
      aiProposal = null;
    }
    if (aiProposal) {
      ol.innerHTML =
        `<li class="sg-ai">
          <span class="sg-ai-head">${icon("sparkles")}<b>Orden cronológico propuesto por la IA</b></span>
          <span class="sg-ai-summary">${esc(aiProposal.summary)}</span>
          <span class="sg-ai-actions">
            <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="ai-discard">Descartar</button>
            <button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-act="ai-apply">${icon("check")}Aplicar este orden</button>
          </span>
        </li>` +
        aiProposal.order
          .map((o, i) => {
            const g = byId.get(o.id);
            const before = s.gameIds.indexOf(o.id) + 1;
            const moved = before !== i + 1;
            return `
          <li class="sg-game is-proposal">
            <span class="sg-game-pos">${i + 1}</span>
            <img class="sg-game-cover" src="${coverOf(g)}" alt="">
            <span class="sg-game-text">
              <span class="sg-game-name">${esc(g?.name || "Juego eliminado")}</span>
              <span class="sg-game-meta">${esc(o.note || releaseYear(g) || "")}</span>
            </span>
            <span class="sg-ai-move ${moved ? "is-moved" : ""}">${moved ? `antes ${before}º` : "igual"}</span>
          </li>`;
          })
          .join("");
      return;
    }
    ol.innerHTML = s.gameIds.length
      ? s.gameIds
          .map((gid, i) => {
            const g = byId.get(gid);
            const meta = [releaseYear(g), doneIds.has(gid) ? "Pasado" : null].filter(Boolean).join(" · ");
            return `
          <li class="sg-game" draggable="true" data-gid="${gid}">
            <span class="sg-grip" title="Arrastra para reordenar">${icon("grip")}</span>
            <span class="sg-game-pos">${i + 1}</span>
            <img class="sg-game-cover" src="${coverOf(g)}" alt="">
            <span class="sg-game-text">
              <span class="sg-game-name">${esc(g?.name || "Juego eliminado")}</span>
              <span class="sg-game-meta">${meta || "Sin fecha de lanzamiento"}</span>
            </span>
            <button type="button" class="icon-btn sg-game-remove" data-act="remove" data-gid="${gid}" title="Quitar de la saga" aria-label="Quitar de la saga">${icon("x")}</button>
          </li>`;
          })
          .join("")
      : `<li class="sg-games-empty">${icon("plus")}<span>Saga vacía. Añade sus juegos desde abajo.</span></li>`;
  }

  function renderResults() {
    const s = selected();
    const box = root.querySelector(".sg-results");
    if (!s || !box) return;

    const q = norm(query);
    let list = allOwned.filter((g) => !s.gameIds.includes(Number(g.id)));
    let heading;
    if (q) {
      list = list.filter((g) => norm(g.name).includes(q));
      heading = `${icon("search")}Resultados`;
    } else {
      // Sugerencias: juegos cuyo nombre contiene el de la saga, más los
      // que la formaban si se creó desde una saga sugerida.
      const sn = norm(s.name);
      const extra = new Set(suggestedFor.get(s.id) || []);
      list = list.filter((g) => (sn && norm(g.name).includes(sn)) || extra.has(Number(g.id)));
      heading = `${icon("sparkles")}Sugerencias para esta saga`;
    }
    list = list
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "es", { numeric: true }))
      .slice(0, 40);

    if (!list.length) {
      box.innerHTML = q
        ? `<p class="sg-results-empty">Ningún juego de tu biblioteca coincide con "${esc(query)}".</p>`
        : "";
      return;
    }

    box.innerHTML = `
      <span class="sg-results-title">${heading}</span>
      <div class="sg-results-grid">
        ${list
          .map((g) => {
            const owner = ownerOf(g.id);
            return `
          <button type="button" class="sg-result" data-act="add" data-gid="${g.id}" title="Añadir a ${esc(s.name)}">
            <img src="${coverOf(g)}" alt="">
            <span class="sg-result-text">
              <span class="sg-result-name">${esc(g.name)}</span>
              ${owner ? `<span class="sg-result-meta">Ahora en ${esc(owner.name)}</span>` : ""}
            </span>
            <span class="sg-result-add">${icon("plus")}</span>
          </button>`;
          })
          .join("")}
      </div>`;
  }

  function renderSuggestions() {
    const box = root.querySelector(".sg-sugs");
    if (!box) return;
    if (suggestions === null) {
      box.innerHTML = `<p class="sg-sugs-loading"><span class="sl-spinner"></span>Buscando sagas en tu biblioteca…</p>`;
      return;
    }
    const taken = new Set(sagas.map((x) => norm(x.name)));
    suggestions = suggestions.filter((x) => !taken.has(norm(x.name)));
    if (!suggestions.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `
      <span class="sg-sugs-title">${icon("sparkles")}Sagas sugeridas</span>
      <ul class="sg-sugs-list">
        ${suggestions
          .map(
            (x, i) => `
          <li class="sg-sug">
            <span class="sg-sug-text">
              <span class="sg-sug-name">${esc(x.name)}</span>
              <span class="sg-sug-meta">${countLabel(x.gameIds.length)} de tu biblioteca</span>
            </span>
            <button type="button" class="icon-btn sg-sug-yes" data-act="sug-yes" data-idx="${i}" title="Crear la saga" aria-label="Crear la saga">${icon("check")}</button>
            <button type="button" class="icon-btn sg-sug-no" data-act="sug-no" data-idx="${i}" title="No sugerir más" aria-label="No sugerir más">${icon("x")}</button>
          </li>`
          )
          .join("")}
      </ul>`;
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    root.classList.add("is-busy");
    try {
      await fn();
    } catch (err) {
      console.error(err);
      showNotification("No se pudo guardar el cambio en la saga.", "error");
    } finally {
      busy = false;
      root.classList.remove("is-busy");
    }
  }

  async function createSaga(name) {
    const before = new Set(sagas.map((s) => s.id));
    await refresh(await window.electronAPI.createSaga(name));
    const created = sagas.find((s) => !before.has(s.id));
    if (created) selectedId = created.id;
    query = "";
    confirmingDelete = false;
    renderList();
    renderDetail();
    renderSuggestions();
    root.querySelector(".sg-search-input")?.focus();
    return created;
  }

  async function saveName(input) {
    const s = selected();
    const name = input.value.trim();
    if (!s) return;
    if (!name) {
      input.value = s.name;
      return;
    }
    if (name === s.name) return;
    await refresh(await window.electronAPI.renameSaga(s.id, name));
    renderList();
    renderResults();
  }

  function bind() {
    root.querySelector(".sg-new").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = root.querySelector(".sg-new-input");
      const name = input.value.trim();
      if (!name) return input.focus();
      input.value = "";
      run(() => createSaga(name));
    });

    root.addEventListener("click", (e) => {
      const item = e.target.closest(".sg-item");
      if (item && item.dataset.id !== selectedId) {
        selectedId = item.dataset.id;
        query = "";
        confirmingDelete = false;
        renderList();
        renderDetail();
        return;
      }

      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const s = selected();
      const act = btn.dataset.act;

      if (act === "sug-yes" || act === "sug-no") {
        const sug = suggestions?.[Number(btn.dataset.idx)];
        if (!sug) return;
        suggestions = suggestions.filter((x) => x !== sug);
        if (act === "sug-no") {
          window.electronAPI.dismissSagaSuggestion(sug.name);
          renderSuggestions();
          return;
        }
        // Se crea vacía: sus juegos salen abajo como sugerencias.
        run(async () => {
          const before = new Set(sagas.map((x) => x.id));
          await refresh(await window.electronAPI.createSaga(sug.name));
          const created = sagas.find((x) => !before.has(x.id));
          if (created) {
            suggestedFor.set(created.id, sug.gameIds.map(Number));
            selectedId = created.id;
          }
          query = "";
          confirmingDelete = false;
          renderList();
          renderDetail();
          renderSuggestions();
        });
        return;
      }

      if (act === "add") {
        btn.classList.add("is-adding");
        run(async () => {
          await refresh(await window.electronAPI.addGameToSaga(s.id, btn.dataset.gid));
          renderList();
          renderGames();
          renderResults();
        });
      } else if (act === "remove") {
        run(async () => {
          await refresh(await window.electronAPI.removeGameFromSaga(s.id, btn.dataset.gid));
          renderList();
          renderGames();
          renderResults();
        });
      } else if (act === "ai-sort") {
        if (aiThinking) return;
        aiThinking = true;
        const sagaId = s.id;
        renderDetail();
        window.electronAPI
          .aiOrderSaga(sagaId)
          .catch(() => ({ ok: false, error: "No se ha podido hablar con la IA." }))
          .then((res) => {
            aiThinking = false;
            if (res.ok) aiProposal = { sagaId, order: res.order, summary: res.summary };
            else showNotification(res.error, "error");
            if (selected()?.id === sagaId) renderDetail();
          });
      } else if (act === "ai-discard") {
        aiProposal = null;
        renderGames();
      } else if (act === "ai-apply" && aiProposal) {
        const ids = aiProposal.order.map((o) => o.id);
        run(async () => {
          await refresh(await window.electronAPI.setSagaOrder(s.id, ids));
          aiProposal = null;
          window.Achievements?.track("aiSagas");
          renderList();
          renderGames();
          showNotification(`"${s.name}" ordenada en orden cronológico.`);
        });
      } else if (act === "sort") {
        btn.classList.add("is-loading");
        run(async () => {
          await refresh(await window.electronAPI.sortSagaByRelease(s.id));
          renderList();
          renderGames();
          showNotification(`"${s.name}" ordenada por fecha de lanzamiento.`);
        });
      } else if (act === "del") {
        confirmingDelete = true;
        renderDetail();
      } else if (act === "del-no") {
        confirmingDelete = false;
        renderDetail();
      } else if (act === "del-yes") {
        run(async () => {
          await window.electronAPI.deleteSaga(s.id);
          confirmingDelete = false;
          query = "";
          await refresh();
          renderList();
          renderDetail();
          showNotification(`Saga "${s.name}" eliminada.`);
        });
      }
    });

    root.addEventListener("input", (e) => {
      if (e.target.matches(".sg-search-input")) {
        query = e.target.value;
        renderResults();
      }
    });

    root.addEventListener("keydown", (e) => {
      if (e.target.matches(".sg-name") && (e.key === "Enter" || e.key === "Escape")) {
        if (e.key === "Escape") e.target.value = selected()?.name || "";
        e.preventDefault();
        e.stopPropagation();
        e.target.blur();
      }
    });

    root.addEventListener("focusout", (e) => {
      if (e.target.matches(".sg-name")) run(() => saveName(e.target));
    });

    // Arrastrar y soltar: juegos dentro de la saga y sagas en la lista.
    // Se mueve el elemento en vivo y al soltar se guarda el orden que
    // haya quedado en pantalla.
    let dragEl = null;
    root.addEventListener("dragstart", (e) => {
      const el = e.target.closest?.(".sg-game, .sg-item");
      if (!el) return;
      dragEl = el;
      el.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    });
    root.addEventListener("dragover", (e) => {
      if (!dragEl) return;
      e.preventDefault();
      const sel = dragEl.classList.contains("sg-game") ? ".sg-game" : ".sg-item";
      const over = e.target.closest?.(sel);
      if (!over || over === dragEl || over.parentNode !== dragEl.parentNode) return;
      const r = over.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      over.parentNode.insertBefore(dragEl, after ? over.nextSibling : over);
    });
    root.addEventListener("drop", (e) => e.preventDefault());
    root.addEventListener("dragend", () => {
      if (!dragEl) return;
      const el = dragEl;
      dragEl = null;
      el.classList.remove("is-dragging");
      if (el.classList.contains("sg-game")) {
        const ids = [...root.querySelectorAll(".sg-games .sg-game")].map((li) => Number(li.dataset.gid));
        run(async () => {
          await refresh(await window.electronAPI.setSagaOrder(selectedId, ids));
          renderList();
          renderGames();
        });
      } else {
        const ids = [...root.querySelectorAll(".sg-list .sg-item")].map((li) => li.dataset.id);
        run(async () => {
          await refresh(await window.electronAPI.reorderSagas(ids));
          renderList();
        });
      }
    });
  }

  await openModal({
    eyebrow: "Biblioteca",
    title: "Sagas",
    width: 1000,
    html: `
      <div class="sg-root">
        <aside class="sg-side">
          <form class="sg-new">
            <input type="text" class="sg-new-input" placeholder="Nueva saga" maxlength="80" aria-label="Nombre de la nueva saga">
            <button type="submit" class="sl-btn sl-btn-primary sl-btn-sm" title="Crear saga">${icon("plus")}<span>Crear</span></button>
          </form>
          <ul class="sg-list"></ul>
          <p class="sg-side-hint">Arrastra para cambiar el orden.</p>
          <div class="sg-sugs"></div>
        </aside>
        <section class="sg-detail"></section>
      </div>`,
    showConfirmButton: false,
    showCloseButton: true,
    customClass: { popup: "sagas-popup" },
    didOpen: (popup) => {
      root = popup.querySelector(".sg-root");
      renderList();
      renderDetail();
      renderSuggestions();
      bind();
      if (!sagas.length) root.querySelector(".sg-new-input").focus();
      window.electronAPI
        .getSagaSuggestions()
        .catch(() => [])
        .then((list) => {
          suggestions = Array.isArray(list) ? list : [];
          if (root?.isConnected) renderSuggestions();
        });
    },
  });

  await loadLibrary();
}

// Atajo desde el menú de una card: elegir saga (o crear una) sin pasar
// por el gestor completo.
async function openAddToSagaModal(gameId) {
  const game = [...libraryGamesCache, ...completedGamesCache].find((g) => String(g.id) === String(gameId));
  const sagas = sagasCache;
  let chosen = null;

  await openModal({
    eyebrow: "Añadir a una saga",
    title: game?.name || "Juego",
    width: 460,
    html: `
      <div class="sg-pick">
        ${
          sagas.length
            ? `<div class="sg-pick-list">
                ${sagas
                  .map(
                    (s) => `
                  <button type="button" class="sg-pick-item" data-id="${s.id}">
                    ${icon("layers")}
                    <span class="sg-pick-name">${escapeHtml(s.name)}</span>
                    <span class="sg-pick-count">${s.gameIds.length}</span>
                  </button>`
                  )
                  .join("")}
              </div>
              <div class="sg-pick-or"><span>o crea una nueva</span></div>`
            : ""
        }
        <form class="sg-pick-new">
          <input type="text" placeholder="Nombre de la saga" maxlength="80" aria-label="Nombre de la saga">
          <button type="submit" class="sl-btn sl-btn-primary sl-btn-sm">${icon("plus")}<span>Crear y añadir</span></button>
        </form>
      </div>`,
    showConfirmButton: false,
    showCloseButton: true,
    didOpen: (popup) => {
      popup.querySelectorAll(".sg-pick-item").forEach((b) => {
        b.onclick = () => {
          chosen = { id: b.dataset.id };
          Swal.close();
        };
      });
      const form = popup.querySelector(".sg-pick-new");
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.querySelector("input").value.trim();
        if (!name) return form.querySelector("input").focus();
        chosen = { name };
        Swal.close();
      };
      if (!sagas.length) form.querySelector("input").focus();
    },
  });

  if (!chosen) return;
  try {
    let saga = sagas.find((s) => s.id === chosen.id);
    if (!saga) {
      const before = new Set(sagas.map((s) => s.id));
      const list = await window.electronAPI.createSaga(chosen.name);
      saga = (list || []).find((s) => !before.has(s.id));
    }
    if (!saga) return;
    await window.electronAPI.addGameToSaga(saga.id, gameId);
    await loadLibrary();
    showNotification(`Añadido a la saga "${saga.name}".`);
  } catch (err) {
    console.error(err);
    showNotification("No se pudo añadir a la saga.", "error");
  }
}

async function removeGameFromItsSaga(gameId) {
  const saga = sagaForGame(gameId);
  if (!saga) return;
  await window.electronAPI.removeGameFromSaga(saga.id, gameId);
  await loadLibrary();
  showNotification(`Quitado de la saga "${saga.name}".`);
}
