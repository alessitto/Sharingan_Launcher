// =====================================================================
// Cuenta y Comunidad
// =====================================================================
// - Botón de cuenta (arriba a la derecha): entrar / crear cuenta / perfil.
// - Sección Comunidad: chat por canales, reportes (bugs, sugerencias y
//   dudas) y logros.
// - Puntuaciones: se ponen en la página del juego (Reseñas, con comentario
//   opcional); en Juegos pasados se ve tu nota en la portada.
// - Foto de perfil: se encuadra aquí y se sube recortada.
// Todo pasa por main.js (cloud.js), que habla con la API.
//
// Usa de index.html: openModal, confirmDialog, icon, escapeHtml,
// showNotification, showSection, loadLibrary y Swal.
(() => {
  "use strict";

  const api = (action, ...args) => window.electronAPI.cloud(action, ...args).catch(() => ({ ok: false, error: "No se puede conectar con el servidor." }));
  const esc = (s) => escapeHtml(String(s ?? ""));
  let me = null; // usuario con sesión
  let cloudStatus = {};

  const CHANNELS = [
    { id: "general", name: "General", desc: "De todo un poco" },
    { id: "juegos", name: "Juegos", desc: "Qué estás jugando" },
    { id: "pokepark", name: "PokéPark", desc: "Tus Pokémon, evoluciones y legendarios" },
    { id: "ayuda", name: "Ayuda", desc: "Dudas rápidas sobre la app" },
  ];
  const TYPES = {
    bug: { name: "Bug", plural: "Bugs", icon: "bug" },
    suggestion: { name: "Sugerencia", plural: "Sugerencias", icon: "lightbulb" },
    question: { name: "Duda", plural: "Dudas", icon: "help" },
  };
  const STATUS = {
    bug: { open: "Abierto", solved: "Solucionado" },
    suggestion: { open: "Pendiente", accepted: "Aceptada", rejected: "Desechada" },
    question: { open: "Abierta", solved: "Resuelta" },
  };

  // ------------------------------------------------------------ Utilidades
  function hue(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }

  // Foto de perfil (si la persona tiene) o su inicial sobre un color propio.
  // user: { id, avatarV }. La inicial queda debajo por si la foto no carga.
  let apiUrl = null;
  const avatarUrl = (u) => (apiUrl && u?.id && u?.avatarV ? `${apiUrl}?r=avatar&u=${encodeURIComponent(u.id)}&v=${encodeURIComponent(u.avatarV)}` : null);
  function avatar(name, cls = "", user = null) {
    const url = avatarUrl(user);
    return `<span class="cm-avatar ${cls}${url ? " has-img" : ""}" style="--h:${hue(name)}"><i>${esc(String(name).charAt(0).toUpperCase())}</i>${
      url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-img');this.remove()">` : ""
    }</span>`;
  }

  const adminBadge = () => `<span class="cm-admin" title="Administrador">${icon("crown")}Admin</span>`;

  function when(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const today = new Date();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (d.toDateString() === today.toDateString()) return hm;
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `ayer ${hm}`;
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)} ${hm}`;
  }

  function ago(iso) {
    if (!iso) return "nunca";
    const s = Math.max(0, (Date.now() - new Date(iso.replace(" ", "T")).getTime()) / 1000);
    if (s < 60) return "ahora mismo";
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} días`;
  }

  // Saltos de línea y enlaces https (se abren en el navegador).
  function linkify(text) {
    return esc(text)
      .replace(/https:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`)
      .replace(/\n/g, "<br>");
  }

  // Pide sesión: abre el login y devuelve false si no hay usuario.
  function needLogin(why) {
    if (me) return true;
    openAuth("login", why);
    return false;
  }

  // ------------------------------------------------------------ Cuenta
  function renderAccountBtn() {
    const btn = document.getElementById("accountBtn");
    if (!btn) return;
    btn.classList.toggle("is-in", !!me);
    btn.innerHTML = me
      ? `${avatar(me.username, "is-md", me)}<span class="side-account-text"><b>${esc(me.username)}</b><small>${
          cloudStatus.pending ? `<i class="cm-sync-dot"></i>Cambios sin subir` : `<i class="cm-online-dot"></i>Conectado`
        }</small></span>`
      : `<span class="cm-avatar is-md is-guest">${icon("user")}</span><span class="side-account-text"><b>Entrar</b><small>Inicia sesión o crea una cuenta</small></span>`;
    btn.title = me ? "Tu cuenta" : "Inicia sesión o crea una cuenta";
  }

  // Formulario de entrar / crear cuenta dentro de "wrap" (un modal o la
  // página Cuenta de Ajustes). onDone(res, modo) al entrar bien.
  function bindAuth(wrap, { mode = "login", why = "", onDone, autofocus = true } = {}) {
    let current = mode;
    // En "Entrar", el campo de repetir la contraseña, la pista y la línea de
    // error ocupan su sitio sin verse: cambiar de pestaña o que salga un
    // error no cambia el tamaño de la ventana.
    const form = () => `
      <div class="cm-auth">
        ${why ? `<p class="cm-auth-why">${esc(why)}</p>` : ""}
        <div class="cm-seg">
          <button type="button" data-mode="login" class="${current === "login" ? "is-active" : ""}">Entrar</button>
          <button type="button" data-mode="register" class="${current === "register" ? "is-active" : ""}">Crear cuenta</button>
        </div>
        <label class="cm-field"><span>Usuario</span><input type="text" class="cm-in-user" maxlength="20" autocomplete="username" spellcheck="false"></label>
        <label class="cm-field"><span>Contraseña</span><input type="password" class="cm-in-pass" maxlength="200" autocomplete="${current === "login" ? "current-password" : "new-password"}"></label>
        <label class="cm-field${current === "register" ? "" : " is-ghost"}" ${current === "register" ? "" : 'aria-hidden="true"'}><span>Repite la contraseña</span><input type="password" class="cm-in-pass2" maxlength="200" autocomplete="new-password" ${current === "register" ? "" : 'tabindex="-1" disabled'}></label>
        <p class="cm-auth-hint${current === "register" ? "" : " is-ghost"}" ${current === "register" ? "" : 'aria-hidden="true"'}>Usuario de 3 a 20 caracteres y contraseña de 8 o más.</p>
        <p class="cm-auth-error" role="alert"></p>
        <button type="button" class="sl-btn sl-btn-primary cm-auth-go">${current === "register" ? "Crear cuenta" : "Entrar"}</button>
        <p class="cm-auth-foot">${
          current === "register"
            ? `Al crear la cuenta aceptas la <button type="button" class="cm-link" data-privacy>política de privacidad</button>.`
            : `<button type="button" class="cm-link" data-forgot>¿Has olvidado la contraseña?</button>`
        }</p>
      </div>`;

    wrap.innerHTML = form();
    const bind = (focus) => {
      if (focus) wrap.querySelector(".cm-in-user").focus();
      wrap.querySelectorAll("input").forEach((i) =>
        i.addEventListener("keydown", (e) => e.key === "Enter" && wrap.querySelector(".cm-auth-go").click())
      );
    };
    bind(autofocus);
    wrap.addEventListener("click", async (e) => {
      if (e.target.closest("[data-forgot]")) return window.Social?.openForgot(wrap.querySelector(".cm-in-user")?.value.trim() || "");
      if (e.target.closest("[data-privacy]")) return window.electronAPI.openExternal("https://alejandrodev.es/sharingan_launcher/privacidad.html");
      const seg = e.target.closest("[data-mode]");
      if (seg) {
        const user = wrap.querySelector(".cm-in-user").value;
        current = seg.dataset.mode;
        wrap.innerHTML = form();
        wrap.querySelector(".cm-in-user").value = user;
        bind(true);
        return;
      }
      const go = e.target.closest(".cm-auth-go");
      if (!go) return;
      const err = wrap.querySelector(".cm-auth-error");
      const username = wrap.querySelector(".cm-in-user").value.trim();
      const password = wrap.querySelector(".cm-in-pass").value;
      const show = (msg) => {
        err.textContent = msg;
        err.hidden = false;
      };
      if (!username || !password) return show("Rellena el usuario y la contraseña.");
      if (current === "register" && password !== wrap.querySelector(".cm-in-pass2").value) return show("Las contraseñas no coinciden.");
      go.disabled = true;
      go.textContent = current === "register" ? "Creando cuenta…" : "Entrando…";
      const res = await api(current, username, password);
      if (!res.ok) {
        go.disabled = false;
        go.textContent = current === "register" ? "Crear cuenta" : "Entrar";
        return show(res.error);
      }
      showNotification(current === "register" ? `¡Bienvenido, ${res.user.username}! Tu cuenta está lista.` : `Hola de nuevo, ${res.user.username}.`);
      onDone?.(res, current);
    });
  }

  async function openAuth(mode = "login", why = "") {
    await openModal({
      eyebrow: "Cuenta",
      title: "Sharingan Launcher",
      width: 440,
      html: `<div class="cm-auth-wrap"></div>`,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: (popup) => bindAuth(popup.querySelector(".cm-auth-wrap"), { mode, why, onDone: () => Swal.close() }),
    });
  }

  function profileHtml() {
    const list = window.Achievements?.list() || [];
    const got = list.filter((a) => a.unlockedAt).length;
    // Cabecera (tú), dos tarjetas iguales (logros y nube) y después los
    // grupos de ajustes de la cuenta, con el mismo aspecto que el resto.
    return `
        <div class="cm-profile acc">
          <div class="acc-head">
            <button type="button" class="cm-avatar-edit" data-p="photo" title="Cambiar foto de perfil">
              ${avatar(me.username, "is-lg", me)}
              <span class="cm-avatar-cam">${icon("pencil")}</span>
            </button>
            <div class="acc-id">
              <p class="cm-profile-name">${esc(me.username)} ${me.admin ? adminBadge() : ""}</p>
              <p class="cm-profile-meta">Miembro desde ${me.createdAt ? new Date(me.createdAt).toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "hoy"}</p>
              <p class="acc-photo">
                <button type="button" class="acc-link" data-p="photo">${me.avatarV ? "Cambiar foto" : "Poner foto"}</button>
                ${me.avatarV ? `<span aria-hidden="true">·</span><button type="button" class="acc-link" data-p="photo-off">Quitar</button>` : ""}
              </p>
            </div>
            <div class="acc-head-actions">
              ${window.Social ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="my-profile">${icon("user")}Ver mi perfil</button>` : ""}
              <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-p="logout">${icon("logout")}Cerrar sesión</button>
            </div>
          </div>
          <div class="acc-stats">
            <div class="acc-stat">
              <span class="acc-stat-label">${icon("trophy")}Logros</span>
              <b class="acc-stat-value">${got} <small>/ ${list.length}</small></b>
              <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="ach">Ver logros</button>
            </div>
            <div class="acc-stat">
              <span class="acc-stat-label">${icon("refresh")}Sincronización</span>
              <b class="acc-stat-value cm-sync-text">${cloudStatus.pending ? "Pendiente de subir" : `Al día · ${ago(cloudStatus.lastSync)}`}</b>
              <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="sync">Sincronizar ahora</button>
            </div>
          </div>
          ${window.Social?.accountExtrasHtml(me) || ""}
        </div>`;
  }

  // Botones del perfil. La confirmación de cerrar sesión es otro modal:
  // al acabar se llama a "back" para volver a donde se estaba (Ajustes).
  function bindProfile(box, back) {
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-p]");
      if (!b) return;
      if (["email", "email-verify", "email-off", "privacy", "privacy-policy", "my-profile", "export", "delete"].includes(b.dataset.p)) {
        const changed = await window.Social?.handleAccountAction(b.dataset.p, b, box);
        if (!changed) return;
        if (b.dataset.p === "delete") return back?.();
        const r = await api("refreshMe");
        if (r.ok) me = r.user;
        if (box.isConnected && me) box.innerHTML = profileHtml();
        return;
      }
      if (b.dataset.p === "photo" || b.dataset.p === "photo-off") {
        const changed = b.dataset.p === "photo" ? await pickAvatar() : await removeAvatar();
        if (changed && box.isConnected) {
          box.innerHTML = profileHtml();
        }
        return;
      }
      if (b.dataset.p === "sync") {
        b.disabled = true;
        const res = await api("syncNow");
        b.disabled = false;
        box.querySelector(".cm-sync-text").textContent = res.ok ? `Al día · ${ago(res.lastSync)}` : res.error;
      } else if (b.dataset.p === "ach") {
        Swal.close();
        openCommunity("achievements");
      } else if (b.dataset.p === "logout") {
        const ok = await confirmDialog({
          title: "¿Cerrar sesión?",
          text: "Tus datos se quedan en este PC y en tu cuenta.",
          confirmText: "Cerrar sesión",
        });
        if (ok) {
          await api("logout");
          showNotification("Sesión cerrada.");
        }
        back?.();
      }
    });
  }

  // ------------------------------------------------------------ Foto de perfil
  // Se elige una imagen, se encuadra en un círculo (arrastrar y zoom) y se
  // sube ya recortada a 256 px. Así pesa poco y sale igual en todas partes.
  const AVATAR_PX = 256;

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  }

  function avatarError(res) {
    if (res.code === "not_found" || res.code === "http_404") return "El servidor todavía no admite fotos de perfil. Hay que actualizar la API.";
    return res.error;
  }

  async function pickAvatar() {
    if (!me) return false;
    const file = await pickFile();
    if (!file) return false;
    if (file.size > 25 * 1024 * 1024) {
      showNotification("Esa imagen es demasiado grande (máximo 25 MB).", "error");
      return false;
    }
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      showNotification("No se ha podido abrir esa imagen.", "error");
      return false;
    }
    const data = await cropAvatar(bmp);
    bmp.close?.();
    if (!data) return false;
    const res = await api("setAvatar", data);
    if (!res.ok) {
      showNotification(avatarError(res), "error");
      return false;
    }
    me = { ...me, avatarV: res.avatarV };
    renderAccountBtn();
    showNotification("Foto de perfil actualizada.");
    return true;
  }

  async function removeAvatar() {
    const ok = await confirmDialog({ title: "¿Quitar tu foto de perfil?", text: "Volverá a salir tu inicial.", confirmText: "Quitar", iconName: "user" });
    if (!ok) return false;
    const res = await api("setAvatar", null);
    if (!res.ok) {
      showNotification(avatarError(res), "error");
      return false;
    }
    me = { ...me, avatarV: null };
    renderAccountBtn();
    return true;
  }

  // Encuadre: la imagen cubre el círculo como mínimo; se arrastra y se
  // acerca con la rueda o la barra. Devuelve la data URL o null.
  function cropAvatar(bmp) {
    const VIEW = 260;
    const base = Math.max(VIEW / bmp.width, VIEW / bmp.height);
    const st = { zoom: 1, x: 0, y: 0 };
    let canvas;
    const clamp = () => {
      const s = base * st.zoom;
      const maxX = Math.max(0, (bmp.width * s - VIEW) / 2);
      const maxY = Math.max(0, (bmp.height * s - VIEW) / 2);
      st.x = Math.max(-maxX, Math.min(maxX, st.x));
      st.y = Math.max(-maxY, Math.min(maxY, st.y));
    };
    const draw = (ctx, size) => {
      const k = size / VIEW;
      const s = base * st.zoom * k;
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, size / 2 - (bmp.width * s) / 2 + st.x * k, size / 2 - (bmp.height * s) / 2 + st.y * k, bmp.width * s, bmp.height * s);
    };
    const paint = () => {
      clamp();
      draw(canvas.getContext("2d"), canvas.width);
    };
    return openModal({
      eyebrow: "Tu cuenta",
      title: "Foto de perfil",
      width: 420,
      html: `
        <div class="cm-crop">
          <div class="cm-crop-stage"><canvas width="${VIEW * 2}" height="${VIEW * 2}"></canvas></div>
          <label class="cm-crop-zoom">${icon("search")}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"></label>
          <p class="cm-crop-hint">Arrastra para encuadrar · rueda para acercar</p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: "Guardar foto",
      cancelButtonText: "Cancelar",
      didOpen: (popup) => {
        canvas = popup.querySelector("canvas");
        const range = popup.querySelector("input[type=range]");
        paint();
        let drag = null;
        canvas.addEventListener("pointerdown", (e) => {
          drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y };
          canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener("pointermove", (e) => {
          if (!drag) return;
          st.x = drag.sx + (e.clientX - drag.x);
          st.y = drag.sy + (e.clientY - drag.y);
          paint();
        });
        canvas.addEventListener("pointerup", () => (drag = null));
        canvas.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            st.zoom = Math.max(1, Math.min(4, st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
            range.value = String(st.zoom);
            paint();
          },
          { passive: false }
        );
        range.addEventListener("input", () => {
          st.zoom = Number(range.value);
          paint();
        });
      },
      preConfirm: () => {
        const out = document.createElement("canvas");
        out.width = out.height = AVATAR_PX;
        draw(out.getContext("2d"), AVATAR_PX);
        let url = out.toDataURL("image/webp", 0.88);
        if (!url.startsWith("data:image/webp")) url = out.toDataURL("image/jpeg", 0.9);
        return url;
      },
    }).then((r) => (r.isConfirmed ? r.value : null));
  }

  async function openProfile() {
    if (!me) return openAuth();
    await openModal({
      title: "Tu cuenta",
      width: 560,
      html: profileHtml(),
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: (popup) => bindProfile(popup),
    });
  }

  // Página "Cuenta" de Ajustes: el perfil o, sin sesión, el formulario.
  function renderAccount(box, back) {
    if (me) {
      box.innerHTML = profileHtml();
      bindProfile(box, back);
    } else {
      bindAuth(box, { autofocus: false, onDone: () => back?.() });
    }
  }

  // ------------------------------------------------------------ Comunidad
  let root = null;
  let visible = false;
  let tab = "chat";

  function openCommunity(t) {
    if (t) tab = t;
    const nav = [...document.querySelectorAll(".topnav-item")].find((x) => x.dataset.section === "community");
    showSection("community", nav);
  }

  function shell() {
    root.innerHTML = `
      <div class="cm-head page-head">
        <div class="page-head-title">
          <span class="section-eyebrow">Comunidad</span>
          <h2 class="section-title cm-title">Comunidad</h2>
        </div>
        <div class="cm-tabs">
          <button type="button" data-tab="chat">${icon("message")}Chat</button>
          <button type="button" data-tab="reports">${icon("flag")}Reportes</button>
          <button type="button" data-tab="friends">${icon("users")}Amigos</button>
          <button type="button" data-tab="achievements">${icon("trophy")}Logros</button>
        </div>
      </div>
      <div class="cm-body"></div>`;
    root.querySelector(".cm-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) switchTab(b.dataset.tab);
    });
  }

  function switchTab(t) {
    tab = t;
    root.querySelectorAll(".cm-tabs [data-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === t));
    stopChat();
    const body = root.querySelector(".cm-body");
    if (t === "chat") renderChat(body);
    else if (t === "reports") renderReports(body);
    else if (t === "friends") window.Social?.renderFriendsTab(body);
    else renderAchievements(body);
  }

  // ------------------------------------------------------------ Chat
  let channel = "general";
  const chatState = new Map(); // canal -> { list, lastId }
  let chatTimer = null;
  let chatBusy = false;

  function stopChat() {
    clearInterval(chatTimer);
    chatTimer = null;
  }

  function renderChat(body) {
    body.innerHTML = `
      <div class="cm-chat">
        <aside class="cm-channels">
          ${CHANNELS.map(
            (c) => `<button type="button" class="cm-channel" data-ch="${c.id}">${icon("hash")}<span><b>${esc(c.name)}</b><small>${esc(c.desc)}</small></span></button>`
          ).join("")}
        </aside>
        <section class="cm-room">
          <header class="cm-room-head"></header>
          <div class="cm-messages"></div>
          <div class="cm-composer"></div>
        </section>
      </div>`;
    body.querySelector(".cm-channels").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ch]");
      if (b) selectChannel(b.dataset.ch);
    });
    body.querySelector(".cm-messages").addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (!del) return;
      const res = await api("deleteChat", Number(del.dataset.del));
      if (!res.ok) return showNotification(res.error, "error");
      const st = chatState.get(channel);
      if (st) st.list = st.list.filter((m) => m.id !== Number(del.dataset.del));
      paintMessages(false);
    });
    selectChannel(channel);
  }

  function renderComposer() {
    const box = root.querySelector(".cm-composer");
    if (!box) return;
    if (!me) {
      box.innerHTML = `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-login>${icon("user")}Inicia sesión para escribir</button>`;
      box.querySelector("[data-login]").onclick = () => openAuth("login", "Inicia sesión para escribir.");
      return;
    }
    box.innerHTML = `
      <textarea class="cm-input" rows="1" maxlength="500" placeholder="Escribe en #${esc(CHANNELS.find((c) => c.id === channel)?.name || channel)}…"></textarea>
      <button type="button" class="cm-send" title="Enviar (Intro)" aria-label="Enviar">${icon("send")}</button>`;
    const input = box.querySelector(".cm-input");
    const send = async () => {
      const text = input.value.trim();
      if (!text || chatBusy) return;
      chatBusy = true;
      const res = await api("sendChat", channel, text);
      chatBusy = false;
      if (!res.ok) return showNotification(res.error, "error");
      input.value = "";
      input.style.height = "";
      window.Achievements?.track("chat");
      pollChat(true);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener("input", () => {
      input.style.height = "";
      input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    });
    box.querySelector(".cm-send").onclick = send;
  }

  function selectChannel(id) {
    channel = id;
    const c = CHANNELS.find((x) => x.id === id);
    root.querySelectorAll(".cm-channel").forEach((b) => b.classList.toggle("is-active", b.dataset.ch === id));
    root.querySelector(".cm-room-head").innerHTML = `${icon("hash")}<b>${esc(c.name)}</b><span>${esc(c.desc)}</span>`;
    renderComposer();
    paintMessages(true);
    pollChat(true);
    stopChat();
    chatTimer = setInterval(() => pollChat(false), 3000);
  }

  async function pollChat(stick) {
    const ch = channel;
    const st = chatState.get(ch) || { list: [], lastId: 0 };
    const res = await api("chat", ch, st.lastId);
    if (!res.ok || ch !== channel) return;
    const gone = new Set(res.deleted || []);
    const before = st.list.length;
    st.list = [...st.list.filter((m) => !gone.has(m.id)), ...res.messages.filter((m) => !st.list.some((x) => x.id === m.id))].slice(-300);
    st.lastId = Math.max(st.lastId, ...st.list.map((m) => m.id), 0);
    chatState.set(ch, st);
    if (st.list.length !== before || gone.size) paintMessages(stick);
    else if (!root.querySelector(".cm-msg, .cm-empty-chat")) paintMessages(stick);
  }

  function paintMessages(forceBottom) {
    const box = root?.querySelector(".cm-messages");
    if (!box) return;
    const st = chatState.get(channel);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (!st || !st.list.length) {
      box.innerHTML = `<p class="cm-empty-chat">${st ? "Aún no hay mensajes. ¡Rompe el hielo!" : "Cargando…"}</p>`;
      return;
    }
    let prev = null;
    box.innerHTML = st.list
      .map((m) => {
        // Mensajes seguidos de la misma persona (menos de 5 min) van juntos.
        const grouped = prev && prev.author === m.author && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60 * 1000;
        prev = m;
        const canDelete = me && (me.username === m.author || me.admin);
        return `
          <div class="cm-msg ${grouped ? "is-grouped" : ""} ${m.admin ? "is-admin" : ""}">
            ${grouped ? `<span class="cm-msg-time-side">${when(m.createdAt).slice(-5)}</span>` : avatar(m.author, "", { id: m.authorId, avatarV: m.avatarV })}
            <div class="cm-msg-main">
              ${grouped ? "" : `<p class="cm-msg-head"><b class="cm-user" data-profile="${esc(m.author)}">${esc(m.author)}</b>${m.admin ? adminBadge() : ""}<time>${when(m.createdAt)}</time></p>`}
              <p class="cm-msg-body">${linkify(m.body)}</p>
            </div>
            ${canDelete ? `<button type="button" class="cm-msg-del" data-del="${m.id}" title="Borrar mensaje">${icon("trash")}</button>` : ""}
          </div>`;
      })
      .join("");
    if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------ Reportes
  const rep = { type: "", state: "", view: null, seq: 0 };

  async function renderReports(body) {
    if (rep.view) return renderReportDetail(body, rep.view);
    body.innerHTML = `
      <div class="cm-reports">
        <div class="cm-rep-bar">
          <div class="cm-chips">
            <button type="button" data-type="">Todos</button>
            ${Object.entries(TYPES).map(([k, t]) => `<button type="button" data-type="${k}">${icon(t.icon)}${t.plural}</button>`).join("")}
          </div>
          <select class="cm-rep-state">
            <option value="">Todos los estados</option>
            <option value="open">Abiertos</option>
            <option value="closed">Cerrados</option>
          </select>
          <button type="button" class="sl-btn sl-btn-primary sl-btn-sm cm-rep-new">${icon("plus")}Nuevo reporte</button>
        </div>
        <div class="cm-rep-list"><p class="cm-muted">Cargando…</p></div>
      </div>`;
    body.querySelectorAll(".cm-chips [data-type]").forEach((b) => b.classList.toggle("is-active", b.dataset.type === rep.type));
    body.querySelector(".cm-rep-state").value = rep.state;
    body.querySelector(".cm-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]");
      if (!b) return;
      rep.type = b.dataset.type;
      renderReports(body);
    });
    body.querySelector(".cm-rep-state").addEventListener("change", (e) => {
      rep.state = e.target.value;
      renderReports(body);
    });
    body.querySelector(".cm-rep-new").addEventListener("click", () => newReport(body));

    const seq = ++rep.seq;
    const res = await api("reports", rep.type ? { type: rep.type } : {});
    const listBox = body.querySelector(".cm-rep-list");
    if (!listBox || seq !== rep.seq) return;
    if (!res.ok) return (listBox.innerHTML = `<p class="cm-muted">${esc(res.error)}</p>`);
    const items = res.reports.filter((r) => !rep.state || (rep.state === "open" ? r.status === "open" : r.status !== "open"));
    listBox.innerHTML = items.length
      ? items
          .map(
            (r) => `
          <button type="button" class="cm-rep" data-id="${r.id}">
            <span class="cm-rep-type is-${r.type}">${icon(TYPES[r.type].icon)}${TYPES[r.type].name}</span>
            <span class="cm-rep-main">
              <b>${esc(r.title)}</b>
              <small>${esc(r.author)}${r.authorAdmin ? " · admin" : ""} · ${when(r.createdAt)}${r.replies ? ` · ${r.replies} ${r.replies === 1 ? "respuesta" : "respuestas"}` : ""}</small>
            </span>
            ${r.adminReplied ? `<span class="cm-rep-adminreply" title="El administrador ha respondido">${icon("crown")}Respondido</span>` : ""}
            <span class="cm-status is-${r.status}">${STATUS[r.type][r.status]}</span>
          </button>`
          )
          .join("")
      : `<p class="cm-muted">No hay reportes con estos filtros.</p>`;
    listBox.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      rep.view = Number(b.dataset.id);
      renderReportDetail(body, rep.view);
    });
  }

  async function newReport(body) {
    if (!needLogin("Para enviar un reporte necesitas una cuenta.")) return;
    let type = rep.type || "bug";
    let created = null;
    await openModal({
      eyebrow: "Comunidad",
      title: "Nuevo reporte",
      width: 560,
      html: `
        <div class="cm-new">
          <div class="cm-seg cm-new-type">
            ${Object.entries(TYPES).map(([k, t]) => `<button type="button" data-t="${k}" class="${k === type ? "is-active" : ""}">${icon(t.icon)}${t.name}</button>`).join("")}
          </div>
          <p class="cm-new-help"></p>
          <label class="cm-field"><span>Título</span><input type="text" class="cm-new-title" maxlength="120"></label>
          <label class="cm-field"><span>Descripción</span><textarea class="cm-new-body" rows="6" maxlength="5000"></textarea></label>
          <p class="cm-auth-error" role="alert"></p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: "Enviar",
      cancelButtonText: "Cancelar",
      didOpen: (popup) => {
        const help = {
          bug: "Qué hacías y qué pasó.",
          suggestion: "¿Qué echas en falta?",
          question: "",
        };
        const setType = (t) => {
          type = t;
          popup.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("is-active", b.dataset.t === t));
          popup.querySelector(".cm-new-help").textContent = help[t];
        };
        setType(type);
        popup.querySelector(".cm-new-type").addEventListener("click", (e) => {
          const b = e.target.closest("[data-t]");
          if (b) setType(b.dataset.t);
        });
        popup.querySelector(".cm-new-title").focus();
      },
      preConfirm: async () => {
        const popup = Swal.getPopup();
        const err = popup.querySelector(".cm-auth-error");
        const res = await api("createReport", {
          type,
          title: popup.querySelector(".cm-new-title").value,
          body: popup.querySelector(".cm-new-body").value,
          appVersion: window.appVersion || "",
        });
        if (!res.ok) {
          err.textContent = res.error;
          err.hidden = false;
          return false;
        }
        created = res.id;
        return true;
      },
    });
    if (!created) return;
    window.Achievements?.track("reports");
    showNotification("Reporte enviado. ¡Gracias!");
    rep.view = created;
    renderReportDetail(body, created);
  }

  async function renderReportDetail(body, id) {
    body.innerHTML = `<p class="cm-muted">Cargando…</p>`;
    const res = await api("report", id);
    if (rep.view !== id || tab !== "reports") return;
    if (!res.ok) {
      body.innerHTML = `<p class="cm-muted">${esc(res.error)}</p>`;
      return;
    }
    const r = res.report;
    const t = TYPES[r.type];
    // Las respuestas del administrador van primero y destacadas.
    const replies = [...r.replies.filter((x) => x.admin), ...r.replies.filter((x) => !x.admin)];
    const adminActions = !me?.admin
      ? ""
      : {
          bug: r.status === "solved" ? [["open", "Reabrir"]] : [["solved", "Marcar como solucionado"]],
          suggestion: r.status === "open" ? [["accepted", "Aceptar"], ["rejected", "Desechar"]] : [["open", "Volver a pendiente"]],
          question: r.status === "solved" ? [["open", "Reabrir"]] : [["solved", "Marcar como resuelta"]],
        }[r.type]
          .map(([st, label]) => `<button type="button" class="sl-btn ${st === "rejected" ? "sl-btn-danger-ghost" : st === "open" ? "sl-btn-ghost" : "sl-btn-primary"} sl-btn-sm" data-status="${st}">${label}</button>`)
          .join("");

    body.innerHTML = `
      <div class="cm-detail">
        <button type="button" class="pp-link cm-back">${icon("arrowLeft")}Volver a reportes</button>
        <div class="cm-detail-card">
          <div class="cm-detail-top">
            <span class="cm-rep-type is-${r.type}">${icon(t.icon)}${t.name}</span>
            <span class="cm-status is-${r.status}">${STATUS[r.type][r.status]}</span>
            ${adminActions ? `<span class="cm-detail-admin">${adminActions}</span>` : ""}
          </div>
          <h3>${esc(r.title)}</h3>
          <p class="cm-detail-meta">${avatar(r.author, "is-sm")}${esc(r.author)}${r.authorAdmin ? adminBadge() : ""} · ${when(r.createdAt)}${r.appVersion ? ` · v${esc(r.appVersion)}` : ""}</p>
          <p class="cm-detail-body">${linkify(r.body)}</p>
        </div>
        <h4 class="cm-replies-title">${replies.length ? `${replies.length} ${replies.length === 1 ? "respuesta" : "respuestas"}` : "Sin respuestas todavía"}</h4>
        <div class="cm-replies">
          ${replies
            .map(
              (x) => `
            <div class="cm-reply ${x.admin ? "is-admin" : ""}">
              ${x.admin ? `<span class="cm-reply-flag">${icon("crown")}Respuesta del administrador</span>` : ""}
              <p class="cm-detail-meta">${avatar(x.author, "is-sm")}<b>${esc(x.author)}</b>${x.admin ? adminBadge() : ""} · ${when(x.createdAt)}</p>
              <p class="cm-detail-body">${linkify(x.body)}</p>
            </div>`
            )
            .join("")}
        </div>
        <div class="cm-reply-box">
          ${
            me
              ? `<textarea class="cm-reply-input" rows="3" maxlength="5000" placeholder="${r.type === "question" ? "Responde a esta duda…" : "Añade un comentario…"}"></textarea>
                 <button type="button" class="sl-btn sl-btn-primary sl-btn-sm cm-reply-send">${icon("send")}Responder</button>`
              : `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-login>${icon("user")}Inicia sesión para responder</button>`
          }
        </div>
      </div>`;

    body.querySelector(".cm-back").onclick = () => {
      rep.view = null;
      renderReports(body);
    };
    body.querySelector("[data-login]")?.addEventListener("click", () => openAuth("login", "Para responder necesitas una cuenta."));
    body.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        const out = await api("setReportStatus", r.id, b.dataset.status);
        if (!out.ok) {
          b.disabled = false;
          return showNotification(out.error, "error");
        }
        showNotification(`Marcado como «${STATUS[r.type][b.dataset.status]}».`);
        renderReportDetail(body, r.id);
      })
    );
    body.querySelector(".cm-reply-send")?.addEventListener("click", async (e) => {
      const input = body.querySelector(".cm-reply-input");
      const text = input.value.trim();
      if (text.length < 2) return;
      e.currentTarget.disabled = true;
      const out = await api("replyReport", r.id, text);
      if (!out.ok) {
        e.currentTarget.disabled = false;
        return showNotification(out.error, "error");
      }
      if (r.type === "question" && r.author !== me.username) window.Achievements?.track("answers");
      renderReportDetail(body, r.id);
    });
  }

  // ------------------------------------------------------------ Logros
  function renderAchievements(body) {
    const A = window.Achievements;
    if (!A) return (body.innerHTML = "");
    const list = A.list();
    const got = list.filter((a) => a.unlockedAt).length;
    body.innerHTML = `
      <div class="cm-ach">
        <div class="cm-ach-summary">
          <div>
            <b>${got} de ${list.length} logros</b>
            <span>${A.isTester() ? "Modo tester" : me ? "" : "Inicia sesión para desbloquearlos."}</span>
          </div>
          ${me ? "" : `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-login>${icon("user")}Entrar o crear cuenta</button>`}
          <i class="cm-ach-bar"><em style="width:${(got / list.length) * 100}%"></em></i>
        </div>
        ${A.CATEGORIES.map((c) => {
          const items = list.filter((a) => a.cat === c.id);
          return `
          <section class="cm-ach-cat">
            <h4>${esc(c.name)} <small>${items.filter((a) => a.unlockedAt).length}/${items.length}</small></h4>
            <div class="cm-ach-grid">
              ${items
                .map(
                  (a) => `
                <div class="cm-ach-card ${a.unlockedAt ? "is-done" : ""}">
                  <span class="cm-ach-icon">${icon(a.icon)}</span>
                  <span class="cm-ach-text">
                    <b>${esc(a.name)}</b>
                    <small>${esc(a.desc)}</small>
                    ${
                      a.unlockedAt
                        ? `<em>Conseguido el ${new Date(a.unlockedAt).toLocaleDateString("es-ES")}</em>`
                        : a.max > 1
                          ? `<i><span style="width:${(a.cur / a.max) * 100}%"></span></i><em>${a.cur} / ${a.max}</em>`
                          : `<em>${a.done && !me ? "Listo: entra para desbloquearlo" : "Pendiente"}</em>`
                    }
                  </span>
                  ${A.isTester() ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm cm-ach-toggle" data-ach-toggle="${a.id}">${a.unlockedAt ? "Quitar" : "Dar"}</button>` : ""}
                </div>`
                )
                .join("")}
            </div>
          </section>`;
        }).join("")}
      </div>`;
    body.querySelector("[data-login]")?.addEventListener("click", () => openAuth("register"));
    body.querySelectorAll("[data-ach-toggle]").forEach((b) =>
      b.addEventListener("click", async () => {
        const a = A.list().find((x) => x.id === b.dataset.achToggle);
        if (!a) return;
        await A.setUnlocked(a.id, !a.unlockedAt);
        renderAchievements(body);
      })
    );
  }

  // ------------------------------------------------------------ Puntuaciones
  // Media de la comunidad (1-5) para la ficha del juego, por id de IGDB.
  // id -> { r: { avg, count } | null, at }. Las medias valen 5 min; "sin
  // puntuaciones" solo 30 s, para que se vea enseguida la primera nota.
  const avgCache = new Map();
  const fresh = (e) => e && Date.now() - e.at < (e.r ? 5 * 60 * 1000 : 30 * 1000);

  async function avgOf(igdbId) {
    const id = Number(igdbId);
    if (!(id > 0)) return null;
    if (!fresh(avgCache.get(id))) {
      const res = await api("ratingsAvg", [id]);
      if (!res.ok) return null;
      avgCache.set(id, { r: res.ratings[id] || null, at: Date.now() });
    }
    return avgCache.get(id).r;
  }

  // Juegos pasados: tu nota (1-5 estrellas). La media de la gente no sale.
  // Las notas van por el id de IGDB: los importados (Steam/Epic/GOG/carpeta)
  // tienen otro id y se usa el igdbId que main.js busca y guarda.
  let myRatings = new Map(); // id de IGDB -> nota

  const isImported = (g) => !!(g.installDir || g.steamAppId || g.epicAppName || g.gogGameId || g.gogProductId || Number(g.id) < 0);
  function ratingKey(localId) {
    const g = (typeof completedGamesCache !== "undefined" ? completedGamesCache : []).find((x) => Number(x.id) === localId);
    if (!g) return localId > 0 ? localId : null;
    return g.igdbId || (!isImported(g) && localId > 0 ? localId : null);
  }
  const myRatingOf = (localId) => myRatings.get(ratingKey(localId)) || 0;

  // Juegos de la biblioteca: tu nota en una esquina de la portada (se pone
  // y se cambia en la página del juego, en Reseñas).
  function decorateCompleted() {
    const grid = document.getElementById("libraryList");
    if (!grid) return;
    for (const card of grid.querySelectorAll(".game-card[data-game-id]")) {
      const score = myRatingOf(Number(card.dataset.gameId));
      let badge = card.querySelector(".card-rating");
      if (!score) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "card-rating";
        badge.title = "Tu nota";
        card.querySelector(".card-cover")?.appendChild(badge);
      }
      const html = `${icon("star")}${score}`;
      if (badge.innerHTML !== html) badge.innerHTML = html;
    }
  }

  async function loadMyRatings() {
    myRatings = new Map();
    if (me) {
      const res = await api("ratingsMine");
      if (res.ok) myRatings = new Map(Object.entries(res.ratings).map(([k, v]) => [Number(k), v]));
    }
    decorateCompleted();
  }

  // La página del juego guarda una nota nueva: que se vea ya en la tarjeta.
  function noteRated(igdbId, score) {
    if (!(igdbId > 0)) return;
    if (score) myRatings.set(igdbId, score);
    else myRatings.delete(igdbId);
    avgCache.delete(igdbId);
    window.Achievements?.trackMax("ratings", myRatings.size);
    decorateCompleted();
  }

  // ------------------------------------------------------------ Init
  function applyStatus(s) {
    cloudStatus = s || {};
    if (cloudStatus.apiUrl) apiUrl = cloudStatus.apiUrl;
    const prev = me?.id;
    me = cloudStatus.user || null;
    renderAccountBtn();
    if ((me?.id || null) !== (prev || null)) {
      loadMyRatings();
      if (visible) switchTab(tab);
    }
  }

  async function init() {
    root = document.getElementById("cmRoot");
    document.getElementById("accountBtn")?.addEventListener("click", () => (me ? openProfile() : openAuth()));
    if (root) shell();
    window.Achievements?.onChange(() => {
      if (visible && tab === "achievements") renderAchievements(root.querySelector(".cm-body"));
    });

    window.electronAPI.onCloudStatus(applyStatus);
    window.electronAPI.onCloudData(async (what) => {
      if (what?.library) await loadLibrary();
      if (what?.pokepark) await window.PokePark?.reload();
      showNotification("Tus datos se han sincronizado con tu cuenta.");
    });
    applyStatus((await api("status")) || {});
    // Con sesión, se refresca el usuario por si cambió (p. ej. ahora es admin).
    if (me) api("refreshMe").then((r) => r.ok && applyStatus({ ...cloudStatus, user: r.user }));

    // Las tarjetas se repintan a menudo: se decoran cuando aparecen.
    const watch = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          fn();
        });
      }).observe(el, { childList: true, subtree: true });
      fn();
    };
    watch("libraryList", decorateCompleted);
  }

  window.Community = {
    setVisible(on) {
      visible = on;
      if (on) switchTab(tab);
      else stopChat();
    },
    openAuth,
    openProfile,
    renderAccount,
    openCommunity,
    openUserProfile: (u) => window.Social?.openUserProfile(u),
    friendsNow: () => window.Social?.friendsNow() || [],
    avgOf,
    avatar,
    noteRated,
    myRating: (igdbId) => myRatings.get(Number(igdbId)) || 0,
    user: () => me,
    needLogin,
  };

  init();
})();
