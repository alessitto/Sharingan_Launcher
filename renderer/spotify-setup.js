// =====================================================================
// Spotify: asistente para conectar tu propia app ("trae tu Client ID")
// =====================================================================
// Spotify solo deja entrar en una app en modo desarrollo a su dueño, así
// que cada usuario crea la suya en el Dashboard y pega aquí su Client ID.
// Cuatro pasos: por qué → crear la app → pegar el Client ID → conectar.
// Se pinta dentro de la pantalla completa de Spotify (spotify-ui.js), con
// los colores y el estilo del tema.
//
// SpotifySetup.mount(contenedor, { sp, ic, logo, step, config, onDone, onSkip })
(() => {
  "use strict";

  const DASHBOARD = "https://developer.spotify.com/dashboard";
  const APP_NAME = "Sharingan Launcher";
  const APP_DESC = "Mi música en el launcher";
  const TOTAL = 4;
  const HELP_AFTER_MS = 12000; // si tarda, se enseña qué mirar
  const esc = (s) => escapeHtml(String(s ?? ""));

  // Lo que se pega: quita espacios y saca el ID aunque venga en una URL.
  function readId(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (/^[0-9a-f]{32}$/.test(s)) return { id: s };
    const found = s.match(/[0-9a-f]{32}/)?.[0];
    if (found) return { id: found };
    const compact = s.replace(/\s+/g, "");
    if (!compact) return { empty: true };
    if (/[^0-9a-f]/.test(compact)) return { bad: true };
    return { short: 32 - compact.length };
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  function mount(root, opts) {
    const { sp, ic, logo } = opts;
    let config = opts.config || {};
    let step = Math.min(TOTAL, Math.max(1, opts.step || 1));
    let pendingId = null; // Client ID comprobado en el paso 3
    let checkTimer = null;
    let checkSeq = 0;
    let helpTimer = null;
    let connecting = false;
    let alive = true;
    const uri = () => config.redirectUri || "http://127.0.0.1:43821/callback";

    // Cabecera del panel de Spotify (el dibujo imita la web real, no el tema).
    const spTop = `<div class="sps-sp-top">${logo}<b>Spotify</b><span>for Developers</span><i></i><em>Dashboard</em></div>`;
    const copyBtn = (value, label = "Copiar") =>
      `<button type="button" class="sps-copy" data-copy="${esc(value)}" title="Copiar">${ic("copy")}<span>${label}</span></button>`;

    // ---------------------------------------------------------- Pasos
    const STEPS = {
      1: () => `
        <div class="sps-hero">
          <span class="sps-orb" aria-hidden="true">${logo}</span>
          <h2 class="sps-title">Tu música, dentro del launcher</h2>
          <p class="sps-lead">Spotify solo deja conectarse a quien crea la app, así que vamos a crear la tuya. Son 2 minutos y es gratis.</p>
          <ul class="sps-chips">
            <li>${ic("clock")}2 minutos</li>
            <li>${ic("check")}Gratis</li>
            <li class="is-premium">${ic("crown")}Necesitas Premium</li>
          </ul>
          <p class="sps-note">Spotify no deja controlar la música con cuentas gratis.</p>
          <div class="sps-actions is-center">
            <button type="button" class="sl-btn sl-btn-primary sps-big" data-go="2">Empezar${ic("arrow")}</button>
          </div>
          <button type="button" class="sps-text-btn" data-go="3">Ya tengo mi Client ID</button>
        </div>`,

      2: () => `
        <div class="sps-split">
          <div class="sps-copytext">
            <h2 class="sps-title">Crea tu app en Spotify</h2>
            <ol class="sps-list">
              <li><span><b>Abre el panel de Spotify</b> y entra con tu cuenta.</span></li>
              <li><span>Pulsa <b>Create app</b> y rellénalo como en el dibujo. Usa los botones de copiar.</span></li>
              <li><span>Pulsa <b>Save</b>.</span></li>
            </ol>
            <button type="button" class="sl-btn sl-btn-primary sps-big" data-act="dashboard">${logo}Abrir panel de Spotify${ic("external")}</button>
            <p class="sps-tip">${ic("info")}<span>¿Ya tienes una app tuya? Spotify solo deja una: añade la Redirect URI en esa (Settings › Edit) y sigue.</span></p>
          </div>
          <figure class="sps-shot" aria-label="Así se rellena el formulario de Spotify">
            <div class="sps-chrome"><i></i><i></i><i></i><span>developer.spotify.com/dashboard/create</span></div>
            ${spTop}
            <div class="sps-form">
              <p class="sps-form-h">Create app</p>
              <div class="sps-field">
                <span class="sps-label">App name <em>*</em></span>
                <div class="sps-input"><span>${APP_NAME}</span>${copyBtn(APP_NAME)}</div>
              </div>
              <div class="sps-field">
                <span class="sps-label">App description <em>*</em></span>
                <div class="sps-input"><span>${APP_DESC}</span>${copyBtn(APP_DESC)}</div>
              </div>
              <div class="sps-field is-muted">
                <span class="sps-label">Website</span>
                <div class="sps-input is-empty"><span>Déjalo vacío</span></div>
              </div>
              <div class="sps-field is-key">
                <span class="sps-label">Redirect URIs <em>*</em><span class="sps-mark">La importante</span></span>
                <div class="sps-input"><code>${esc(uri())}</code>${copyBtn(uri())}<span class="sps-add">Add</span></div>
                <span class="sps-hint">Pégala tal cual y pulsa <b>Add</b>.</span>
              </div>
              <div class="sps-field">
                <span class="sps-label">Which API/SDKs are you planning to use?</span>
                <div class="sps-checks">
                  <span class="sps-check is-on is-key">${ic("check")}Web API<span class="sps-mark">Solo esta</span></span>
                  <span class="sps-check">Web Playback SDK</span>
                  <span class="sps-check">Android</span>
                  <span class="sps-check">iOS</span>
                </div>
              </div>
              <div class="sps-terms"><span class="sps-check is-on">${ic("check")}</span>I understand and agree with Spotify's Developer Terms of Service…</div>
              <div class="sps-form-foot"><span class="sps-cancel">Cancel</span><span class="sps-save">Save</span></div>
            </div>
          </figure>
        </div>`,

      3: () => `
        <div class="sps-split">
          <div class="sps-copytext">
            <h2 class="sps-title">Copia tu Client ID</h2>
            <p class="sps-lead">En tu app, pulsa <b>Settings</b> y copia el <b>Client ID</b>. Pégalo aquí:</p>
            <label class="sps-id">
              <input type="text" class="sps-id-input" spellcheck="false" autocomplete="off" placeholder="Pega aquí tu Client ID" value="${esc(pendingId || "")}" aria-describedby="spsIdMsg">
              <span class="sps-id-count" aria-hidden="true"></span>
              <span class="sps-id-state" aria-hidden="true"></span>
            </label>
            <p class="sps-id-msg" id="spsIdMsg" aria-live="polite"></p>
            <p class="sps-tip">${ic("info")}<span>El <b>Client secret</b> no hace falta: nunca lo pegues en ningún sitio.</span></p>
          </div>
          <figure class="sps-shot" aria-label="Dónde está el Client ID en tu app">
            <div class="sps-chrome"><i></i><i></i><i></i><span>developer.spotify.com/dashboard/…/settings</span></div>
            ${spTop}
            <div class="sps-form">
              <p class="sps-crumb">Home › ${APP_NAME}</p>
              <p class="sps-form-h">Basic Information</p>
              <div class="sps-tabs"><span class="is-on">Basic Information</span><span>User Management</span><span>Quota</span></div>
              <div class="sps-row is-key">
                <span class="sps-label">Client ID<span class="sps-mark">Este</span></span>
                <code class="sps-fake-id">3f9c2e71b84a4d0e9a6c15b7e2d08f4a</code>
              </div>
              <div class="sps-row is-muted">
                <span class="sps-label">Client secret<span class="sps-mark is-no">Este no</span></span>
                <span class="sps-fake-link">View client secret</span>
              </div>
              <div class="sps-row">
                <span class="sps-label">Redirect URIs</span>
                <code>${esc(uri())}</code>
              </div>
            </div>
          </figure>
        </div>`,

      4: () => `
        <div class="sps-hero sps-connect">
          <span class="sps-orb" aria-hidden="true">${logo}</span>
          <h2 class="sps-title">Conecta tu cuenta</h2>
          <p class="sps-lead">Se abrirá Spotify en el navegador. Entra con la cuenta con la que creaste la app y pulsa <b>Aceptar</b>.</p>
          <div class="sps-actions is-center">
            <button type="button" class="sl-btn sl-btn-primary sps-big" data-act="connect">${logo}Probar conexión</button>
          </div>
          <div class="sps-wait-box" hidden>
            <span class="sp-wait" aria-hidden="true"><i></i><i></i><i></i></span>
            <p>Esperando a que aceptes en el navegador…</p>
            <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-act="cancel">Cancelar</button>
          </div>
          <p class="sps-error" role="alert" hidden></p>
          <div class="sps-help" hidden>
            <p><b>¿Spotify dice «Invalid redirect URI»?</b> La Redirect URI de tu app tiene que ser exactamente esta:</p>
            <div class="sps-input is-inline"><code>${esc(uri())}</code>${copyBtn(uri())}</div>
            <button type="button" class="sps-text-btn" data-go="2">Ver otra vez cómo se pone</button>
          </div>
          <button type="button" class="sps-text-btn sps-change" data-go="3">Cambiar Client ID</button>
        </div>`,
    };

    // ---------------------------------------------------------- Esqueleto
    root.innerHTML = `
      <div class="sps" role="group" aria-label="Conectar Spotify">
        <div class="sps-top">
          <div class="sps-progress" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <span class="sps-step-label"></span>
        </div>
        <div class="sps-stage"></div>
        <div class="sps-foot">
          <button type="button" class="sps-text-btn sps-back" data-act="back">${ic("back")}Atrás</button>
          <span class="sps-foot-space"></span>
          <button type="button" class="sps-text-btn sps-skip" data-act="skip">Ahora no</button>
          <button type="button" class="sl-btn sl-btn-primary sps-next" data-act="next">Siguiente${ic("arrow")}</button>
        </div>
      </div>`;
    const box = root.querySelector(".sps");
    const stage = box.querySelector(".sps-stage");
    const $ = (s) => box.querySelector(s);

    function paintChrome(done = false) {
      box.querySelectorAll(".sps-progress i").forEach((el, i) => {
        el.classList.toggle("is-done", i < step - 1 || done);
        el.classList.toggle("is-now", i === step - 1 && !done);
      });
      $(".sps-step-label").textContent = done ? "¡Listo!" : `Paso ${step} de ${TOTAL}`;
      $(".sps-back").hidden = step === 1 || done;
      $(".sps-skip").hidden = done;
      // "Siguiente" solo en los pasos que no tienen su propio botón grande.
      const next = $(".sps-next");
      next.hidden = done || step === 1 || step === 4;
      next.innerHTML = `${step === 2 ? "Ya la tengo" : "Siguiente"}${ic("arrow")}`;
      if (step === 3) next.disabled = !pendingId;
      else next.disabled = false;
    }

    function go(n, dir = n > step ? 1 : -1) {
      clearTimeout(helpTimer);
      if (connecting) cancelConnect();
      step = Math.min(TOTAL, Math.max(1, n));
      stage.innerHTML = `<section class="sps-step sps-step-${step}" style="--dir:${dir}">${STEPS[step]()}</section>`;
      paintChrome();
      if (step === 3) bindId();
      // El foco va al principio del paso (o al campo del Client ID).
      requestAnimationFrame(() => {
        const target = step === 3 ? $(".sps-id-input") : stage.querySelector(".sl-btn-primary, button");
        target?.focus({ preventScroll: true });
      });
    }

    // ---------------------------------------------------------- Paso 3
    function bindId() {
      const input = $(".sps-id-input");
      input.addEventListener("input", () => validate(input.value));
      input.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text") || "";
        const r = readId(text);
        if (r.id) {
          e.preventDefault();
          input.value = r.id;
          validate(r.id, true);
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && pendingId) next();
      });
      if (input.value) validate(input.value, true);
      else validate("");
    }

    function idState(kind, text) {
      const label = $(".sps-id");
      if (!label) return;
      label.dataset.state = kind;
      $(".sps-id-state").innerHTML = kind === "ok" ? ic("check") : kind === "error" ? ic("x") : kind === "checking" ? '<span class="sps-spin"></span>' : "";
      $(".sps-id-msg").textContent = text;
      $(".sps-id-msg").dataset.state = kind;
    }

    function validate(raw, now = false) {
      clearTimeout(checkTimer);
      const seq = ++checkSeq;
      pendingId = null;
      paintChrome();
      const r = readId(raw);
      const compact = String(raw || "").replace(/\s+/g, "");
      const count = $(".sps-id-count");
      count.textContent = r.empty ? "" : `${Math.min(compact.length, 99)}/32`;
      count.classList.toggle("is-ok", !!r.id);
      if (r.empty) return idState("", "32 letras y números. Lo encontrarás en Settings › Basic Information.");
      if (r.bad) return idState("error", "Solo lleva números y letras de la a a la f. Cópialo otra vez.");
      if (r.short > 0) return idState("", `Faltan ${r.short} ${r.short === 1 ? "carácter" : "caracteres"}.`);
      if (r.short < 0) return idState("error", "Sobran caracteres. Cópialo otra vez.");
      idState("checking", "Comprobando con Spotify…");
      checkTimer = setTimeout(
        async () => {
          const res = await sp("checkClientId", r.id);
          if (!alive || seq !== checkSeq) return;
          if (res.ok) {
            pendingId = res.clientId;
            idState("ok", "¡Perfecto! Spotify reconoce tu app.");
          } else if (res.code === "network" || res.code?.startsWith?.("http_")) {
            // Sin conexión no se puede comprobar: se deja seguir igualmente.
            pendingId = r.id;
            idState("", "No se ha podido comprobar ahora, pero puedes seguir.");
          } else {
            idState("error", res.error);
          }
          paintChrome();
        },
        now ? 0 : 450
      );
    }

    // ---------------------------------------------------------- Paso 4
    function showConnectError(res) {
      const err = $(".sps-error");
      if (!err) return;
      err.textContent = res.error;
      err.hidden = false;
      $(".sps-connect").classList.add("is-compact"); // sin el logo, cabe todo
      // Con estos errores casi siempre es la Redirect URI.
      if (["login_failed", "login_timeout"].includes(res.code)) $(".sps-help").hidden = false;
    }

    async function connect() {
      if (connecting) return;
      connecting = true;
      $(".sps-error").hidden = true;
      $(".sps-help").hidden = true;
      $('[data-act="connect"]').closest(".sps-actions").hidden = true;
      $(".sps-change").hidden = true;
      $(".sps-wait-box").hidden = false;
      clearTimeout(helpTimer);
      helpTimer = setTimeout(() => {
        const help = $(".sps-help");
        if (!connecting || !help) return;
        help.hidden = false;
        $(".sps-connect").classList.add("is-compact");
      }, HELP_AFTER_MS);

      const res = await sp("connect");
      clearTimeout(helpTimer);
      if (!alive) return;
      connecting = false;
      if (step !== 4) return;
      if (!res.ok) {
        $(".sps-wait-box").hidden = true;
        $('[data-act="connect"]').closest(".sps-actions").hidden = false;
        $(".sps-change").hidden = false;
        if (res.code !== "login_cancelled") showConnectError(res);
        return;
      }
      // Conectado: quién es y si tiene Premium.
      const me = await sp("test");
      if (!alive) return;
      if (!me.ok && me.code === "not_allowed_user") {
        await sp("disconnect");
        $(".sps-wait-box").hidden = true;
        $('[data-act="connect"]').closest(".sps-actions").hidden = false;
        $(".sps-change").hidden = false;
        return showConnectError(me);
      }
      celebrate(me.ok ? me : {});
    }

    function cancelConnect() {
      connecting = false;
      sp("cancelConnect");
    }

    function celebrate(me) {
      const name = String(me.name || "").split(/\s+/)[0];
      // Confeti: piezas con ángulo, distancia y giro al azar (colores del tema).
      const bits = Array.from({ length: 26 }, (_, i) => {
        const a = (i / 26) * 360 + Math.random() * 12;
        const d = 95 + Math.random() * 95;
        const r = Math.round(Math.random() * 540 - 270);
        return `<i style="--a:${a.toFixed(1)}deg;--d:${d.toFixed(0)}px;--r:${r}deg;--delay:${(Math.random() * 0.12).toFixed(2)}s"></i>`;
      }).join("");
      stage.innerHTML = `
        <section class="sps-step sps-done" style="--dir:1">
          <div class="sps-hero">
            <span class="sps-burst" aria-hidden="true">${bits}</span>
            <span class="sps-tick" aria-hidden="true">${ic("check")}</span>
            <h2 class="sps-title">${name ? `¡Todo listo, ${esc(name)}!` : "¡Todo listo!"}</h2>
            <p class="sps-lead">Spotify ya está conectado. Tu música, aquí mismo.</p>
            ${
              me.premium === false
                ? `<p class="sps-warn">${ic("crown")}<span>Tu cuenta es gratuita: verás qué suena, pero Spotify solo deja controlarla con <b>Premium</b>.</span></p>`
                : ""
            }
            <div class="sps-actions is-center">
              <button type="button" class="sl-btn sl-btn-primary sps-big" data-act="done">${ic("play")}Ir al reproductor</button>
            </div>
          </div>
        </section>`;
      paintChrome(true);
      requestAnimationFrame(() => stage.querySelector('[data-act="done"]')?.focus({ preventScroll: true }));
    }

    // ---------------------------------------------------------- Acciones
    async function next() {
      if (step === 3) {
        if (!pendingId) return;
        const res = await sp("setClientId", pendingId);
        if (!alive) return;
        if (!res.ok) return idState("error", res.error);
        config = res;
        opts.onConfig?.(res);
      }
      go(step + 1);
    }

    box.addEventListener("click", async (e) => {
      const copyEl = e.target.closest("[data-copy]");
      if (copyEl) {
        const ok = await copy(copyEl.dataset.copy);
        const label = copyEl.querySelector("span");
        copyEl.classList.add(ok ? "is-copied" : "is-failed");
        if (label) label.textContent = ok ? "Copiado" : "Cópialo a mano";
        setTimeout(() => {
          copyEl.classList.remove("is-copied", "is-failed");
          if (label) label.textContent = "Copiar";
        }, 1600);
        return;
      }
      const goEl = e.target.closest("[data-go]");
      if (goEl) return go(Number(goEl.dataset.go));
      const el = e.target.closest("[data-act]");
      if (!el || el.disabled) return;
      const act = el.dataset.act;
      if (act === "next") next();
      else if (act === "back") go(step - 1);
      else if (act === "skip") {
        if (connecting) cancelConnect();
        opts.onSkip?.();
      } else if (act === "dashboard") window.electronAPI.openExternal(DASHBOARD);
      else if (act === "connect") connect();
      else if (act === "cancel") cancelConnect();
      else if (act === "done") opts.onDone?.();
    });

    go(step, 1);

    return {
      destroy() {
        alive = false;
        clearTimeout(checkTimer);
        clearTimeout(helpTimer);
        if (connecting) cancelConnect();
      },
    };
  }

  window.SpotifySetup = { mount };
})();
