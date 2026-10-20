// =====================================================================
// Amigos, perfiles y opciones de la cuenta (desde la 4.1)
// =====================================================================
// - Amigos: lista con quién está conectado y a qué juega, solicitudes
//   (pestaña Amigos de Comunidad) y los conectados en la barra lateral.
// - Presencia: cada minuto (y al abrir o cerrar un juego) se manda a qué
//   juegas; solo lo ven tus amigos.
// - Perfil público de cualquiera (clic en su nombre en el chat, las
//   reseñas o los amigos): horas, más jugados, pasados y reseñas.
// - Cuenta: correo para recuperar la contraseña, perfil privado, descargar
//   tus datos y borrar la cuenta (Ajustes › Cuenta).
// Todo pasa por cloud.js (main) y la API (social.php y account.php).
(() => {
  "use strict";

  const api = (action, ...args) => window.electronAPI.cloud(action, ...args).catch(() => ({ ok: false, error: "No se puede conectar con el servidor." }));
  const esc = (s) => escapeHtml(String(s ?? ""));
  const avatar = (name, cls, u) => window.Community?.avatar(name, cls, u) || "";
  const me = () => window.Community?.user?.() || null;
  const PRIVACY_URL = "https://alejandrodev.es/sharingan_launcher/privacidad.html";
  const fmtH = (h) => (h >= 10 ? `${Math.round(h).toLocaleString("es-ES")} h` : `${String(h).replace(".", ",")} h`);

  let data = { friends: [], incoming: [], outgoing: [] };
  let pollTimer = 0;

  // ------------------------------------------------------------ Amigos
  async function refreshFriends() {
    if (!me()) {
      data = { friends: [], incoming: [], outgoing: [] };
      paintSide();
      return data;
    }
    const res = await api("friends");
    if (res.ok) data = { friends: res.friends || [], incoming: res.incoming || [], outgoing: res.outgoing || [] };
    paintSide();
    window.Home?.refreshFriends?.();
    if (tabBody?.isConnected) renderFriendsTab(tabBody);
    return data;
  }

  // Barra lateral: amigos conectados y el contador de solicitudes
  function paintSide() {
    const box = document.getElementById("sideFriends");
    const list = document.getElementById("sideFriendsList");
    const badge = document.getElementById("navCommunityCount");
    if (badge) badge.textContent = data.incoming.length ? String(data.incoming.length) : "";
    if (!box || !list) return;
    const online = data.friends.filter((f) => f.online);
    box.hidden = !me() || !online.length;
    list.innerHTML = online
      .slice(0, 6)
      .map(
        (f) => `
      <button type="button" class="side-friend" data-profile="${esc(f.username)}" title="${esc(f.username)}">
        ${avatar(f.username, "is-sm", f)}<i class="side-friend-dot${f.playing ? " is-playing" : ""}"></i>
        <span><b>${esc(f.username)}</b><small>${f.playing ? `Jugando a ${esc(f.playing.name)}` : "En línea"}</small></span>
      </button>`
      )
      .join("");
  }

  let tabBody = null;
  function renderFriendsTab(body) {
    tabBody = body;
    if (!me()) {
      body.innerHTML = `<div class="cm-empty"><p>Entra en tu cuenta para tener amigos.</p><button type="button" class="sl-btn sl-btn-primary" data-login>Entrar</button></div>`;
      return;
    }
    const lastSeen = (f) => (f.lastSeen ? `Visto ${relTime(f.lastSeen)}` : "Desconectado");
    const row = (f, actions) => `
      <div class="fr-row">
        <button type="button" class="fr-who" data-profile="${esc(f.username)}">
          ${avatar(f.username, "is-md", f)}
          <span><b>${esc(f.username)}</b>${
            f.online !== undefined ? `<small class="${f.playing ? "is-playing" : f.online ? "is-online" : ""}">${f.playing ? `Jugando a ${esc(f.playing.name)}` : f.online ? "En línea" : esc(lastSeen(f))}</small>` : ""
          }</span>
        </button>
        ${f.playing?.cover ? `<img class="fr-game" src="${esc(f.playing.cover)}" alt="" title="${esc(f.playing.name)}">` : ""}
        <div class="fr-actions">${actions}</div>
      </div>`;
    body.innerHTML = `
      <div class="fr">
        <form class="fr-add">
          <label class="search-field">${icon("user")}<input type="text" name="u" maxlength="20" placeholder="Nombre de usuario de tu amigo" spellcheck="false" autocomplete="off"></label>
          <button type="submit" class="sl-btn sl-btn-primary">${icon("plus")}Añadir amigo</button>
        </form>
        ${
          data.incoming.length
            ? `<section class="fr-sec"><h3 class="fr-h">Solicitudes recibidas <em>${data.incoming.length}</em></h3>${data.incoming
                .map((f) =>
                  row(
                    f,
                    `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-accept="${esc(f.username)}">Aceptar</button><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-reject="${esc(f.username)}">Rechazar</button>`
                  )
                )
                .join("")}</section>`
            : ""
        }
        <section class="fr-sec">
          <h3 class="fr-h">Amigos <em>${data.friends.length}</em></h3>
          ${
            data.friends.length
              ? data.friends.map((f) => row(f, "")).join("")
              : `<p class="fr-empty">Todavía no tienes amigos aquí. Añade a alguien por su nombre de usuario: verás cuándo está conectado y a qué juega.</p>`
          }
        </section>
        ${
          data.outgoing.length
            ? `<section class="fr-sec"><h3 class="fr-h">Solicitudes enviadas</h3>${data.outgoing
                .map((f) => row(f, `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-cancel="${esc(f.username)}">Cancelar</button>`))
                .join("")}</section>`
            : ""
        }
      </div>`;
  }

  function relTime(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    const d = Math.round(s / 86400);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }

  async function friendAction(kind, username) {
    const res =
      kind === "add"
        ? await api("friendRequest", username)
        : kind === "accept" || kind === "reject"
          ? await api("friendRespond", username, kind === "accept")
          : await api("friendRemove", username);
    if (!res.ok) {
      showNotification(res.error, "error");
      return null;
    }
    if (kind === "add") showNotification(res.status === "friends" ? `Ahora eres amigo de ${username}.` : `Solicitud enviada a ${username}.`);
    if (kind === "accept") showNotification(`Ahora eres amigo de ${username}.`);
    await refreshFriends();
    return res;
  }

  // Clics dentro de la pestaña Amigos, la barra lateral y donde haya nombres
  document.addEventListener("click", async (e) => {
    const prof = e.target.closest("[data-profile]");
    if (prof && !e.target.closest(".swal2-container .up-actions")) {
      e.preventDefault();
      return openUserProfile(prof.dataset.profile);
    }
    if (!tabBody?.contains(e.target)) return;
    if (e.target.closest("[data-login]")) return window.Community?.openAuth();
    for (const k of ["accept", "reject", "cancel"]) {
      const b = e.target.closest(`[data-${k}]`);
      if (b) {
        b.disabled = true;
        return friendAction(k === "cancel" ? "remove" : k, b.dataset[k]);
      }
    }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".fr-add");
    if (!form) return;
    e.preventDefault();
    const name = form.u.value.trim();
    if (!name) return;
    const r = await friendAction("add", name);
    if (r) form.u.value = "";
  });

  // ------------------------------------------------------------ Presencia
  let lastPresence = "";
  function currentPlaying() {
    for (const id of playingNow) {
      const g = [...libraryGamesCache, ...completedGamesCache].find((x) => String(x.id) === String(id));
      if (!g) continue;
      const cover = coverOf(g);
      const imported = !!(g.installDir || g.steamAppId || g.epicAppName || g.gogGameId || g.gogProductId || Number(g.id) < 0);
      return { name: g.name, cover: /^https:\/\//.test(cover) ? cover : null, igdbId: g.igdbId || (!imported && Number(g.id) > 0 ? Number(g.id) : null) };
    }
    return null;
  }
  async function sendPresence(force) {
    if (!me()) return;
    const p = currentPlaying();
    const key = JSON.stringify(p);
    if (!force && key === lastPresence) return;
    lastPresence = key;
    await api("presence", p);
  }

  function startPolling() {
    clearInterval(pollTimer);
    if (!me()) return;
    const tick = () => {
      lastPresence = "";
      sendPresence(true);
      refreshFriends();
    };
    tick();
    pollTimer = setInterval(tick, 60 * 1000);
  }

  // ------------------------------------------------------------ Perfil público
  async function openUserProfile(username) {
    if (!username) return;
    loadingModal("Cargando perfil", username);
    const res = await api("profile", username);
    if (!Swal.isVisible() || !document.querySelector(".sl-loading")) return;
    if (!res.ok) {
      Swal.close();
      return showNotification(res.error || "No se ha encontrado ese perfil.", "error");
    }
    const p = res.profile;
    const since = p.createdAt ? new Date(p.createdAt).toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "";
    const status = p.playing ? `<span class="up-status is-playing"><i></i>Jugando a ${esc(p.playing.name)}</span>` : p.online ? `<span class="up-status is-online"><i></i>En línea</span>` : "";
    const rel = p.relation;
    const actions =
      rel === "self"
        ? `<button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-up="account">${icon("pencil")}Editar mi cuenta</button>`
        : !me()
          ? ""
          : rel === "friends"
            ? `<span class="up-friend">${icon("check")}Amigos</span><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-up="remove">Quitar amigo</button>`
            : rel === "pending_out"
              ? `<span class="up-friend is-muted">Solicitud enviada</span><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-up="remove">Cancelar</button>`
              : rel === "pending_in"
                ? `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-up="accept">${icon("check")}Aceptar solicitud</button>`
                : `<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-up="add">${icon("plus")}Añadir amigo</button>`;
    const covers = (list) =>
      `<div class="up-covers">${list
        .map(
          (g) =>
            `<div class="up-cover" title="${esc(g.name)}${g.hours ? ` · ${fmtH(g.hours)}` : ""}"><span>${
              g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : `<img src="${esc(noCoverSvg(g.name))}" alt="">`
            }${g.platinum ? `<i class="up-plat">${icon("crown")}</i>` : ""}</span><b>${esc(g.name)}</b>${g.hours ? `<small>${fmtH(g.hours)}</small>` : ""}</div>`
        )
        .join("")}</div>`;
    const stars = (n) => `<span class="up-stars">${"★".repeat(n)}<span>${"★".repeat(5 - n)}</span></span>`;
    const s = p.stats || {};
    const body = p.hidden
      ? `<div class="up-private">${icon("user")}<p><b>Este perfil es privado.</b><br>Solo sus amigos pueden ver sus juegos y estadísticas.</p></div>`
      : `
        <div class="up-tiles">
          <div><b>${fmtH(s.hours || 0)}</b><small>jugadas</small></div>
          <div><b>${s.library ?? 0}</b><small>en biblioteca</small></div>
          <div><b>${s.completed ?? 0}</b><small>pasados</small></div>
          <div><b>${s.platinum ?? 0}</b><small>platinos</small></div>
          <div><b>${p.friends ?? 0}</b><small>amigos</small></div>
        </div>
        ${p.topGames?.length ? `<h4 class="up-h">Lo más jugado</h4>${covers(p.topGames)}` : ""}
        ${p.recentCompleted?.length ? `<h4 class="up-h">Últimos pasados</h4>${covers(p.recentCompleted)}` : ""}
        ${
          p.reviews?.length
            ? `<h4 class="up-h">Reseñas</h4><div class="up-reviews">${p.reviews
                .map(
                  (r) =>
                    `<div class="up-review">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : ""}<div><p class="up-review-head"><b>${esc(r.name || "Juego")}</b>${stars(r.score)}</p>${
                      r.comment ? `<p class="up-review-body">${esc(r.comment)}</p>` : ""
                    }</div></div>`
                )
                .join("")}</div>`
            : ""
        }
        ${!p.topGames?.length && !p.recentCompleted?.length && !p.reviews?.length ? `<p class="up-empty">Todavía no hay nada que enseñar.</p>` : ""}`;

    await openModal({
      width: 720,
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: "up-popup" },
      html: `
        <div class="up">
          <div class="up-head">
            ${avatar(p.username, "is-xl", p)}
            <div class="up-id">
              <p class="up-name">${esc(p.username)} ${p.admin ? `<span class="cm-admin">${icon("crown")}Admin</span>` : ""}</p>
              <p class="up-meta">${since ? `Miembro desde ${esc(since)}` : ""}${p.private && !p.hidden ? ` · ${icon("user")}Perfil privado` : ""}</p>
              ${status}
            </div>
            <div class="up-actions">${actions}</div>
          </div>
          ${body}
        </div>`,
      didOpen: (popup) =>
        popup.querySelector(".up-actions")?.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-up]");
          if (!b) return;
          if (b.dataset.up === "account") {
            Swal.close();
            return setTimeout(() => openSettingsModal("account"), 120);
          }
          b.disabled = true;
          const kind = b.dataset.up;
          if (kind === "remove" && rel === "friends") {
            const ok = await confirmDialog({ title: `¿Quitar a ${p.username} de tus amigos?`, confirmText: "Quitar", danger: true });
            if (!ok) return openUserProfile(username);
          }
          await friendAction(kind, p.username);
          openUserProfile(username);
        }),
    });
  }

  // ------------------------------------------------------------ Cuenta: correo, privacidad y datos
  // Lo pinta community.js dentro de su página de la cuenta.
  function accountExtrasHtml(u) {
    const email = u.emailVerified
      ? `<div class="cm-profile-row"><span>${icon("send")}Correo</span><b>${esc(u.email)} <em class="ac-ok">${icon("check")}</em></b></div>
         <div class="ac-line"><button type="button" class="cm-link" data-p="email">Cambiar correo</button><span>·</span><button type="button" class="cm-link" data-p="email-off">Quitar</button></div>`
      : u.emailPending
        ? `<div class="cm-profile-row"><span>${icon("send")}Correo</span><b>Falta confirmar ${esc(u.emailPending)}</b></div>
           <div class="ac-verify"><input type="text" class="ac-code" inputmode="numeric" maxlength="6" placeholder="Código de 6 cifras"><button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-p="email-verify">Confirmar</button><button type="button" class="cm-link" data-p="email">Reenviar</button></div>`
        : `<div class="cm-profile-row is-warn"><span>${icon("send")}Correo</span><b>Sin correo: si olvidas la contraseña no podrás recuperarla</b></div>
           <div class="ac-line"><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="email">${icon("plus")}Añadir correo</button></div>`;
    return `
      <div class="ac">
        ${email}
        <label class="cm-profile-row ac-switch"><span>${icon("user")}Perfil privado <small>Solo tus amigos ven tus juegos y estadísticas</small></span><input type="checkbox" class="st-switch" data-p="privacy" ${u.profilePrivate ? "checked" : ""}></label>
        <div class="cm-profile-actions">
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="my-profile">${icon("user")}Ver mi perfil</button>
          <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" data-p="export">${icon("download")}Descargar mis datos</button>
          <button type="button" class="sl-btn sl-btn-danger-ghost sl-btn-sm" data-p="delete">${icon("trash")}Borrar mi cuenta</button>
        </div>
        <p class="ac-legal"><button type="button" class="cm-link" data-p="privacy-policy">Política de privacidad</button></p>
      </div>`;
  }

  // true si la cuenta ha cambiado y hay que repintar
  async function handleAccountAction(act, el, box) {
    const after = async (res, okMsg) => {
      if (!res.ok) {
        showNotification(res.error, "error");
        return false;
      }
      if (okMsg) showNotification(okMsg);
      await api("refreshMe");
      return true;
    };
    if (act === "privacy-policy") return void window.electronAPI.openExternal(PRIVACY_URL);
    if (act === "my-profile") return void openUserProfile(me()?.username);
    if (act === "privacy") return after(await api("setPrivacy", el.checked), el.checked ? "Tu perfil ahora es privado." : "Tu perfil ahora es público.");
    if (act === "email") {
      const r = await openModal({
        eyebrow: "Tu cuenta",
        title: "Correo para recuperar la cuenta",
        width: 440,
        html: `<p class="sl-hint">Solo se usa para mandarte un código si olvidas la contraseña. Nada de publicidad.</p>`,
        input: "email",
        inputPlaceholder: "tu@correo.com",
        showCancelButton: true,
        confirmButtonText: "Enviar código",
        cancelButtonText: "Cancelar",
        preConfirm: async (v) => {
          const res = await api("setEmail", v);
          if (!res.ok) Swal.showValidationMessage(res.error);
          return res.ok;
        },
      });
      if (!r.isConfirmed) return false;
      showNotification("Te hemos mandado un código. Escríbelo para confirmar.");
      await api("refreshMe");
      return true;
    }
    if (act === "email-verify") {
      const code = box.querySelector(".ac-code")?.value.trim();
      if (!code) return false;
      return after(await api("verifyEmail", code), "Correo confirmado.");
    }
    if (act === "email-off") {
      const ok = await confirmDialog({ title: "¿Quitar el correo?", text: "Si olvidas la contraseña no podrás recuperar la cuenta.", confirmText: "Quitar", danger: true });
      return ok ? after(await api("removeEmail"), "Correo quitado.") : false;
    }
    if (act === "export") {
      el.disabled = true;
      const res = await api("exportData");
      el.disabled = false;
      if (!res.ok) return showNotification(res.error, "error"), false;
      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sharingan-mis-datos-${me()?.username || "cuenta"}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return false;
    }
    if (act === "delete") {
      const r = await openModal({
        eyebrow: "Tu cuenta",
        title: "Borrar la cuenta",
        width: 460,
        html: `<p class="sl-hint">Se borra <b>todo</b> lo de tu cuenta en el servidor: biblioteca sincronizada, PokéPark, reseñas, mensajes, amigos y foto. No se puede deshacer. Lo que hay en este PC se queda.</p>`,
        input: "password",
        inputPlaceholder: "Tu contraseña para confirmar",
        showCancelButton: true,
        confirmButtonText: "Borrar para siempre",
        cancelButtonText: "Cancelar",
        customClass: { confirmButton: "sl-btn-danger" },
        preConfirm: async (pw) => {
          if (!pw) return Swal.showValidationMessage("Escribe tu contraseña."), false;
          const res = await api("deleteAccount", pw);
          if (!res.ok) Swal.showValidationMessage(res.error);
          return res.ok;
        },
      });
      if (r.isConfirmed) showNotification("Tu cuenta se ha borrado.");
      return r.isConfirmed;
    }
    return false;
  }

  // ------------------------------------------------------------ Recuperar la contraseña
  async function openForgot(prefill = "") {
    let step = 1;
    let login = prefill;
    await openModal({
      eyebrow: "Cuenta",
      title: "Recuperar la contraseña",
      width: 440,
      html: `<div class="fg-wrap"></div>`,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: (popup) => {
        const wrap = popup.querySelector(".fg-wrap");
        const paint = (sentTo) => {
          wrap.innerHTML =
            step === 1
              ? `<div class="cm-auth">
                   <p class="cm-auth-why">Escribe tu usuario o el correo de tu cuenta. Si tiene un correo confirmado, te llegará un código.</p>
                   <label class="cm-field"><span>Usuario o correo</span><input type="text" class="fg-login" value="${esc(login)}" spellcheck="false"></label>
                   <p class="cm-auth-error" role="alert"></p>
                   <button type="button" class="sl-btn sl-btn-primary" data-fg="send">Enviar código</button>
                 </div>`
              : `<div class="cm-auth">
                   <p class="cm-auth-why">${sentTo ? `Hemos mandado un código a <b>${esc(sentTo)}</b>.` : "Si la cuenta tiene un correo confirmado, te habrá llegado un código."} Caduca en 30 minutos.</p>
                   <label class="cm-field"><span>Código</span><input type="text" class="fg-code" inputmode="numeric" maxlength="6"></label>
                   <label class="cm-field"><span>Contraseña nueva</span><input type="password" class="fg-pass" maxlength="200" autocomplete="new-password"></label>
                   <label class="cm-field"><span>Repítela</span><input type="password" class="fg-pass2" maxlength="200" autocomplete="new-password"></label>
                   <p class="cm-auth-error" role="alert"></p>
                   <button type="button" class="sl-btn sl-btn-primary" data-fg="reset">Cambiar y entrar</button>
                 </div>`;
          wrap.querySelector("input")?.focus();
        };
        paint();
        wrap.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-fg]");
          if (!b) return;
          const err = wrap.querySelector(".cm-auth-error");
          const show = (m) => (err.textContent = m);
          b.disabled = true;
          if (b.dataset.fg === "send") {
            login = wrap.querySelector(".fg-login").value.trim();
            if (!login) return show("Escribe tu usuario o tu correo."), (b.disabled = false);
            const res = await api("forgot", login);
            if (!res.ok) return show(res.error), (b.disabled = false);
            step = 2;
            return paint(res.sentTo);
          }
          const code = wrap.querySelector(".fg-code").value.trim();
          const pass = wrap.querySelector(".fg-pass").value;
          if (pass !== wrap.querySelector(".fg-pass2").value) return show("Las contraseñas no coinciden."), (b.disabled = false);
          const res = await api("resetPassword", login, code, pass);
          if (!res.ok) return show(res.error), (b.disabled = false);
          Swal.close();
          showNotification(`Contraseña cambiada. Hola de nuevo, ${res.user.username}.`);
        });
        wrap.addEventListener("keydown", (e) => e.key === "Enter" && wrap.querySelector("[data-fg]")?.click());
      },
    });
  }

  // ------------------------------------------------------------ Arranque
  window.electronAPI.onCloudStatus?.((s) => {
    const was = pollTimer;
    if (s?.user && !was) startPolling();
    if (!s?.user) {
      clearInterval(pollTimer);
      pollTimer = 0;
      refreshFriends();
    }
  });
  window.electronAPI.cloud("status").then((s) => s?.user && startPolling()).catch(() => {});

  window.Social = {
    renderFriendsTab,
    refreshFriends,
    friendsNow: () => data.friends,
    openUserProfile,
    accountExtrasHtml,
    handleAccountAction,
    openForgot,
    presenceChanged: () => sendPresence(false),
  };
})();
