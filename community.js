// =====================================================================
// Cuenta y Comunidad
// =====================================================================
// - Botón de cuenta (arriba a la derecha): entrar / crear cuenta / perfil.
// - Sección Comunidad: chat por canales, reportes (bugs, sugerencias y
//   dudas) y logros.
// - Puntuaciones: la media de la gente sale solo en Descubrir; en Juegos
//   pasados puntúas tú (y solo ves tu nota).
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
    { id: "juegos", name: "Juegos", desc: "Qué estás jugando, recomendaciones y opiniones" },
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

  function avatar(name, cls = "") {
    return `<span class="cm-avatar ${cls}" style="--h:${hue(name)}">${esc(String(name).charAt(0).toUpperCase())}</span>`;
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

  function linkify(text) {
    return esc(text).replace(/\n/g, "<br>");
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
      ? `${avatar(me.username, "is-sm")}<span>${esc(me.username)}</span>${cloudStatus.pending ? `<i class="cm-sync-dot" title="Cambios pendientes de subir"></i>` : ""}`
      : `${icon("user")}<span>Entrar</span>`;
    btn.title = me ? "Tu cuenta" : "Inicia sesión o crea una cuenta";
  }

  async function openAuth(mode = "login", why = "") {
    let current = mode;
    const form = () => `
      <div class="cm-auth">
        ${why ? `<p class="cm-auth-why">${esc(why)}</p>` : ""}
        <div class="cm-seg">
          <button type="button" data-mode="login" class="${current === "login" ? "is-active" : ""}">Entrar</button>
          <button type="button" data-mode="register" class="${current === "register" ? "is-active" : ""}">Crear cuenta</button>
        </div>
        <label class="cm-field"><span>Usuario</span><input type="text" class="cm-in-user" maxlength="20" autocomplete="username" spellcheck="false"></label>
        <label class="cm-field"><span>Contraseña</span><input type="password" class="cm-in-pass" maxlength="200" autocomplete="${current === "login" ? "current-password" : "new-password"}"></label>
        ${current === "register" ? `<label class="cm-field"><span>Repite la contraseña</span><input type="password" class="cm-in-pass2" maxlength="200" autocomplete="new-password"></label>` : ""}
        <p class="cm-auth-hint">${
          current === "register"
            ? "De 3 a 20 caracteres (letras, números, . - _) y una contraseña de al menos 8. Tu biblioteca, tu PokéPark y tus logros se guardarán en tu cuenta."
            : "Al entrar, tu biblioteca y tu PokéPark se sincronizan con tu cuenta."
        }</p>
        <p class="cm-auth-error" hidden></p>
        <button type="button" class="sl-btn sl-btn-primary cm-auth-go">${current === "register" ? "Crear cuenta" : "Entrar"}</button>
      </div>`;

    await openModal({
      eyebrow: "Cuenta",
      title: "Sharingan Launcher",
      width: 440,
      html: `<div class="cm-auth-wrap">${form()}</div>`,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: (popup) => {
        const wrap = popup.querySelector(".cm-auth-wrap");
        const bind = () => {
          wrap.querySelector(".cm-in-user").focus();
          wrap.querySelectorAll("input").forEach((i) =>
            i.addEventListener("keydown", (e) => e.key === "Enter" && wrap.querySelector(".cm-auth-go").click())
          );
        };
        bind();
        wrap.addEventListener("click", async (e) => {
          const seg = e.target.closest("[data-mode]");
          if (seg) {
            const user = wrap.querySelector(".cm-in-user").value;
            current = seg.dataset.mode;
            wrap.innerHTML = form();
            wrap.querySelector(".cm-in-user").value = user;
            bind();
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
          Swal.close();
          showNotification(current === "register" ? `¡Bienvenido, ${res.user.username}! Tu cuenta está lista.` : `Hola de nuevo, ${res.user.username}.`);
        });
      },
    });
  }

  async function openProfile() {
    if (!me) return openAuth();
    const list = window.Achievements?.list() || [];
    const got = list.filter((a) => a.unlockedAt).length;
    await openModal({
      eyebrow: "Tu cuenta",
      title: me.username,
      width: 460,
      html: `
        <div class="cm-profile">
          <div class="cm-profile-top">
            ${avatar(me.username, "is-lg")}
            <div>
              <p class="cm-profile-name">${esc(me.username)} ${me.admin ? adminBadge() : ""}</p>
              <p class="cm-profile-meta">Miembro desde ${me.createdAt ? new Date(me.createdAt).toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "hoy"}</p>
            </div>
          </div>
          <div class="cm-profile-row">
            <span>${icon("trophy")}Logros</span><b>${got} / ${list.length}</b>
          </div>
          <div class="cm-profile-row">
            <span>${icon("refresh")}Sincronización</span>
            <b class="cm-sync-text">${cloudStatus.pending ? "Cambios pendientes de subir" : `Al día · ${ago(cloudStatus.lastSync)}`}</b>
          </div>
          <div class="cm-profile-actions">
            <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="sync">${icon("refresh")}Sincronizar ahora</button>
            <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="ach">${icon("trophy")}Ver logros</button>
            <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-p="logout">${icon("logout")}Cerrar sesión</button>
          </div>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: (popup) =>
        popup.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-p]");
          if (!b) return;
          if (b.dataset.p === "sync") {
            b.disabled = true;
            const res = await api("syncNow");
            b.disabled = false;
            popup.querySelector(".cm-sync-text").textContent = res.ok ? `Al día · ${ago(res.lastSync)}` : res.error;
          } else if (b.dataset.p === "ach") {
            Swal.close();
            openCommunity("achievements");
          } else if (b.dataset.p === "logout") {
            const ok = await confirmDialog({
              title: "¿Cerrar sesión?",
              text: "Lo que tienes en este PC se queda aquí. Tu cuenta conserva todo para cuando vuelvas a entrar.",
              confirmText: "Cerrar sesión",
            });
            if (!ok) return;
            await api("logout");
            showNotification("Sesión cerrada.");
          }
        }),
    });
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
      <div class="cm-head">
        <div>
          <span class="section-eyebrow">Comunidad</span>
          <h2 class="section-title cm-title">Comunidad</h2>
        </div>
        <div class="cm-tabs">
          <button type="button" data-tab="chat">${icon("message")}Chat</button>
          <button type="button" data-tab="reports">${icon("flag")}Reportes</button>
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
      box.querySelector("[data-login]").onclick = () => openAuth("login", "Para escribir en el chat necesitas una cuenta.");
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
      box.innerHTML = `<p class="cm-empty-chat">${st ? "Todavía no hay mensajes en este canal. ¡Rompe el hielo!" : "Cargando…"}</p>`;
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
            ${grouped ? `<span class="cm-msg-time-side">${when(m.createdAt).slice(-5)}</span>` : avatar(m.author)}
            <div class="cm-msg-main">
              ${grouped ? "" : `<p class="cm-msg-head"><b>${esc(m.author)}</b>${m.admin ? adminBadge() : ""}<time>${when(m.createdAt)}</time></p>`}
              <p class="cm-msg-body">${linkify(m.body)}</p>
            </div>
            ${canDelete ? `<button type="button" class="cm-msg-del" data-del="${m.id}" title="Borrar mensaje">${icon("trash")}</button>` : ""}
          </div>`;
      })
      .join("");
    if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------ Reportes
  const rep = { type: "", state: "", view: null };

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

    const res = await api("reports", rep.type ? { type: rep.type } : {});
    const listBox = body.querySelector(".cm-rep-list");
    if (!listBox) return;
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
          <p class="cm-auth-error" hidden></p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: "Enviar",
      cancelButtonText: "Cancelar",
      didOpen: (popup) => {
        const help = {
          bug: "Cuenta qué hacías, qué esperabas que pasara y qué pasó. Se adjunta tu versión de la app.",
          suggestion: "¿Qué echas en falta? Cuanto más concreta, más fácil de aceptar.",
          question: "Cualquiera de la comunidad puede responderte.",
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
          appVersion: (document.getElementById("versionLink")?.textContent || "").replace(/^v/, ""),
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
            <span>${me ? "Prueba todo lo que hace la app para conseguirlos." : "Tu progreso ya se está contando, pero los logros solo se desbloquean con cuenta."}</span>
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
                </div>`
                )
                .join("")}
            </div>
          </section>`;
        }).join("")}
      </div>`;
    body.querySelector("[data-login]")?.addEventListener("click", () => openAuth("register"));
  }

  // ------------------------------------------------------------ Puntuaciones
  // Descubrir: media de la comunidad en la carátula.
  // id -> { r: { avg, count } | null, at }. Las medias valen 5 min; "sin
  // puntuaciones" solo 30 s, para que se vea enseguida la primera nota.
  const avgCache = new Map();
  const fresh = (e) => e && Date.now() - e.at < (e.r ? 5 * 60 * 1000 : 30 * 1000);

  async function decorateDiscover() {
    const grid = document.getElementById("gamesList");
    if (!grid) return;
    const cards = [...grid.querySelectorAll(".game-card[data-game-id]")].filter((c) => !c.querySelector(".cm-avg"));
    const missing = [...new Set(cards.map((c) => Number(c.dataset.gameId)).filter((id) => !fresh(avgCache.get(id))))];
    if (missing.length) {
      const res = await api("ratingsAvg", missing);
      if (res.ok) missing.forEach((id) => avgCache.set(id, { r: res.ratings[id] || null, at: Date.now() }));
    }
    for (const c of cards) {
      const r = avgCache.get(Number(c.dataset.gameId))?.r;
      if (!r || c.querySelector(".cm-avg")) continue;
      const tag = document.createElement("span");
      tag.className = "cm-avg";
      tag.title = `Media de ${r.count} ${r.count === 1 ? "persona" : "personas"} de la comunidad`;
      tag.innerHTML = `${icon("star")}${r.avg.toFixed(1).replace(".", ",")}<small>${r.count}</small>`;
      c.querySelector(".card-cover")?.appendChild(tag);
    }
  }

  // Juegos pasados: tu nota (1-5 estrellas). La media de la gente no sale.
  let myRatings = new Map();

  function decorateCompleted() {
    const grid = document.getElementById("completedList");
    if (!grid) return;
    for (const card of grid.querySelectorAll(".game-card[data-game-id]")) {
      if (card.querySelector(".cm-myrate")) continue;
      const id = Number(card.dataset.gameId);
      const row = document.createElement("div");
      row.className = "cm-myrate";
      row.dataset.id = id;
      paintStars(row, myRatings.get(id) || 0);
      card.querySelector(".card-actions")?.before(row);
    }
  }

  function paintStars(row, score) {
    row.innerHTML =
      `<span class="cm-myrate-label">${score ? "Tu nota" : "Puntúalo"}</span>` +
      [1, 2, 3, 4, 5].map((n) => `<button type="button" class="cm-star ${n <= score ? "is-on" : ""}" data-score="${n}" aria-label="${n} de 5">${icon("star")}</button>`).join("");
  }

  async function rate(row, score) {
    if (!needLogin("Para puntuar juegos necesitas una cuenta.")) return;
    const id = Number(row.dataset.id);
    const next = myRatings.get(id) === score ? 0 : score; // repetir la misma nota la quita
    paintStars(row, next);
    const res = await api("rate", id, next);
    if (!res.ok) {
      paintStars(row, myRatings.get(id) || 0);
      return showNotification(res.error, "error");
    }
    if (next) myRatings.set(id, next);
    else myRatings.delete(id);
    avgCache.delete(id);
    window.Achievements?.trackMax("ratings", myRatings.size);
    if (next) showNotification(`Has puntuado este juego con ${next} ${next === 1 ? "estrella" : "estrellas"}.`);
  }

  async function loadMyRatings() {
    myRatings = new Map();
    if (me) {
      const res = await api("ratingsMine");
      if (res.ok) myRatings = new Map(Object.entries(res.ratings).map(([k, v]) => [Number(k), v]));
    }
    document.querySelectorAll("#completedList .cm-myrate").forEach((row) => paintStars(row, myRatings.get(Number(row.dataset.id)) || 0));
  }

  // ------------------------------------------------------------ Init
  function applyStatus(s) {
    cloudStatus = s || {};
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
    watch("gamesList", decorateDiscover);
    watch("completedList", decorateCompleted);
    document.getElementById("completedList")?.addEventListener("click", (e) => {
      const star = e.target.closest(".cm-star");
      if (!star) return;
      e.stopPropagation();
      rate(star.closest(".cm-myrate"), Number(star.dataset.score));
    });
  }

  window.Community = {
    setVisible(on) {
      visible = on;
      if (on) switchTab(tab);
      else stopChat();
    },
    openAuth,
    openProfile,
  };

  init();
})();
