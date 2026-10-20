// Mando: foco en las tarjetas y botones.
// (Antes en el <script> de index.html; los scripts de la ventana comparten
// el ámbito global, así que el orden de carga importa: ver index.html.)

// ===============================
// GAMEPAD: foco + acciones
// ===============================
// El bucle del mando solo corre con un mando conectado (antes leía
// los mandos 60 veces por segundo aunque no hubiera ninguno).
let padLoop = 0;
function startPadLoop() {
  if (!padLoop) padLoop = requestAnimationFrame(tickGamepad);
}

function setupGamepad() {
  window.addEventListener("gamepadconnected", (e) => {
    activePadIndex = e.gamepad.index;
    showNotification(`Mando conectado`, "success");
    startPadLoop();
  });

  window.addEventListener("gamepaddisconnected", (e) => {
    if (activePadIndex === e.gamepad.index) activePadIndex = null;
    showNotification(`Mando desconectado`, "error");
  });

  if ((navigator.getGamepads?.() || []).some(Boolean)) startPadLoop();
}

function getPad() {
  const pads = navigator.getGamepads?.() || [];
  if (activePadIndex != null && pads[activePadIndex])
    return pads[activePadIndex];
  return pads.find(Boolean) || null;
}

function edge(now, key) {
  const fired = now && !gpLast[key];
  gpLast[key] = now;
  return fired;
}

function getCardsInActiveGrid() {
  const secId = getActiveSectionId();
  if (secId === "game") return [];
  if (secId === "popular")
    return Array.from(document.querySelectorAll("#gamesList .game-card"));
  if (secId === "library")
    return Array.from(
      document.querySelectorAll("#libraryList .game-card")
    );
  if (secId === "play")
    return Array.from(document.querySelectorAll("#playList .game-card"));
  return [];
}

// El foco del mando solo se ve (y solo mueve el scroll) mientras se usa
// el mando: con ratón o teclado no hay ni marco ni saltos al repintar.
let padInUse = false;
function setPadInUse(on) {
  if (padInUse === on) return;
  padInUse = on;
  document.body.classList.toggle("pad-in-use", on);
  if (on) updateGamepadFocus();
}
["mousemove", "mousedown", "wheel", "keydown"].forEach((ev) =>
  window.addEventListener(ev, () => setPadInUse(false), { passive: true })
);

function updateGamepadFocus(force = false) {
  const cards = getCardsInActiveGrid();
  cards.forEach((c) => c.classList.remove("gp-focused"));

  if (cards.length === 0) return;

  if (focusedIndex < 0) focusedIndex = 0;
  if (focusedIndex >= cards.length) focusedIndex = cards.length - 1;
  if (!padInUse) return;

  const focused = cards[focusedIndex];
  if (focused) {
    focused.classList.add("gp-focused");
    focused.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: force ? "auto" : "smooth",
    });
  }
}

// Mueve el foco a la tarjeta más cercana en esa dirección según su
// posición real en pantalla (las columnas las elige el usuario y los
// bloques de saga rompen cualquier cuenta fija de "N por fila").
function moveGamepadFocus(dir) {
  const cards = getCardsInActiveGrid();
  if (!cards.length) return;
  const from = cards[Math.min(Math.max(focusedIndex, 0), cards.length - 1)].getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  cards.forEach((c, i) => {
    if (i === focusedIndex) return;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2 - cx;
    const y = r.top + r.height / 2 - cy;
    const main = dir === "left" ? -x : dir === "right" ? x : dir === "up" ? -y : y;
    const cross = dir === "left" || dir === "right" ? Math.abs(y) : Math.abs(x);
    if (main <= 4) return;
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best >= 0) focusedIndex = best;
  updateGamepadFocus();
}

function clickPrimaryActionOnFocused() {
  const cards = getCardsInActiveGrid();
  const card = cards[focusedIndex];
  if (!card) return;

  // Prioridad: botón primary (Jugar/Agregar)
  const primary = card.querySelector("button.primary");
  if (primary) return primary.click();

  // Si no hay primary, click al primer button normal
  const anyBtn = card.querySelector("button");
  if (anyBtn) return anyBtn.click();
}

function backAction() {
  const popup = Swal.getPopup?.();
  if (popup) {
    Swal.close();
    return;
  }
  if (getActiveSectionId() === "game") return window.GamePage?.back();

  // Volver a biblioteca como acción "atrás" sencilla
  showSection(
    "library",
    document.querySelectorAll(".topnav-item")[1]
  );
}

function switchSection(delta) {
  const items = Array.from(document.querySelectorAll(".topnav-item"));
  const activeIdx = items.findIndex((li) =>
    li.classList.contains("active")
  );
  if (activeIdx < 0) return;
  let next = activeIdx + delta;
  if (next < 0) next = items.length - 1;
  if (next >= items.length) next = 0;
  items[next].click();
}

function tickGamepad() {
  const gp = getPad();

  if (gp) {
    const up = !!gp.buttons[12]?.pressed || (gp.axes?.[1] ?? 0) < -0.6;
    const down = !!gp.buttons[13]?.pressed || (gp.axes?.[1] ?? 0) > 0.6;
    const left = !!gp.buttons[14]?.pressed || (gp.axes?.[0] ?? 0) < -0.6;
    const right = !!gp.buttons[15]?.pressed || (gp.axes?.[0] ?? 0) > 0.6;

    const a = !!gp.buttons[0]?.pressed; // A / Cross
    const b = !!gp.buttons[1]?.pressed; // B / Circle
    const x = !!gp.buttons[2]?.pressed;
    const y = !!gp.buttons[3]?.pressed;
    const lb = !!gp.buttons[4]?.pressed;
    const rb = !!gp.buttons[5]?.pressed;

    const fired = { up: edge(up, "up"), down: edge(down, "down"), left: edge(left, "left"), right: edge(right, "right") };
    const pressA = edge(a, "a");
    const pressB = edge(b, "b");
    const pressLb = edge(lb, "lb");
    const pressRb = edge(rb, "rb");
    const pressX = edge(x, "x");
    const pressY = edge(y, "y");
    if (Object.values(fired).some(Boolean) || pressA || pressB || pressLb || pressRb || pressX || pressY) setPadInUse(true);

    // Con un modal abierto, A acepta y B cierra; lo de detrás no se toca.
    if (Swal.isVisible()) {
      if (pressA && Swal.getConfirmButton()?.offsetParent) Swal.clickConfirm();
      if (pressB) Swal.close();
      padLoop = requestAnimationFrame(tickGamepad);
      return;
    }

    for (const dir of ["up", "down", "left", "right"]) if (fired[dir]) moveGamepadFocus(dir);

    if (pressA) {
      if (getActiveSectionId() === "game") document.querySelector("#game .gp-primary")?.click();
      else clickPrimaryActionOnFocused();
    }
    if (pressB) backAction();

    if (pressLb) switchSection(-1);
    if (pressRb) switchSection(+1);

    if (pressX) {
      if (getActiveSectionId() === "library") toggleLinkedFilter();
    }

    if (pressY) {
      const sec = getActiveSectionId();
      if (sec === "popular") {
        document.getElementById("searchInput")?.focus();
      } else if (sec === "library" || sec === "play") {
        // Y: la página del juego enfocado
        const card = getCardsInActiveGrid()[focusedIndex];
        if (card?.dataset.gameId) window.GamePage?.open(card.dataset.gameId);
      }
    }
  }

  // Sin mandos conectados el bucle se para hasta que llegue uno.
  padLoop = (navigator.getGamepads?.() || []).some(Boolean) ? requestAnimationFrame(tickGamepad) : 0;
}
