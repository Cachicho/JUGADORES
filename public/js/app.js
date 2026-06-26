"use strict";
/* global io */

// ═══════════════════ ESTADO GLOBAL COMPARTIDO ═══════════════════
const AVATARS = ["🎩","🦁","🐯","🐻","🦊","🐺","🐸","🐲","🎭","👑","💎","🃏","🎰","🌟","🔥","⚡","🦅","🦋","🐉","🦄","🤠","😎","🥷","🧙"];
const RELOAD_AMOUNTS = [10000, 50000, 100000, 500000, 1000000];

const App = {
  socket: null,
  player: null,
  roomCode: null,
  players: [],
  departed: [],
  game: "lobby",
  selectedAvatarJoin: "🎩",
  selectedAvatarCreate: "🎩",
};

function formatCOP(n) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function showToast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${name}`).classList.remove("hidden");
}

function persistSession() {
  if (!App.player || !App.roomCode) return;
  localStorage.setItem("yamba_session", JSON.stringify({
    roomCode: App.roomCode,
    playerId: App.player.id,
    name: App.player.name,
    avatar: App.player.avatar,
  }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("yamba_session") || "null");
  } catch {
    return null;
  }
}

// ═══════════════════ AVATAR GRIDS ═══════════════════
function buildAvatarGrid(containerId, onSelect, initial) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  AVATARS.forEach((a) => {
    const btn = document.createElement("button");
    btn.className = "avatar-btn" + (a === initial ? " selected" : "");
    btn.textContent = a;
    btn.type = "button";
    btn.addEventListener("click", () => {
      el.querySelectorAll(".avatar-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      onSelect(a);
    });
    el.appendChild(btn);
  });
}

// ═══════════════════ INIT SOCKET ═══════════════════
function initSocket() {
  App.socket = io({ transports: ["websocket", "polling"] });

  App.socket.on("connect", () => {
    const saved = loadSession();
    if (saved && saved.roomCode && saved.playerId && !App.player) {
      App.socket.emit("hub:join_room", {
        roomCode: saved.roomCode, name: saved.name, avatar: saved.avatar, playerId: saved.playerId,
      }, (res) => {
        if (res.ok) enterRoom(res.roomCode, res.player, res.players, res.game || "lobby");
      });
    }
  });

  App.socket.on("connect_error", () => showToast("No se pudo conectar al servidor.", "error"));
  App.socket.on("error:toast", (msg) => showToast(msg, "error"));
  App.socket.on("room:kicked", () => resetToHub("El administrador te eliminó de la sala.", "error"));
  App.socket.on("room:closed", () => resetToHub("El administrador cerró la sala.", "error"));

  App.socket.on("room:state", (state) => {
    App.players = state.players;
    App.game = state.game;
    App.departed = state.departed || [];
    renderTopbarPlayer();
    renderLobbyPlayers();
    renderAdminList();
    if (window.Roulette) window.Roulette.onPlayers(state.players);
    if (window.Intermedio) window.Intermedio.onPlayers(state.players);
    if (window.Nueve) window.Nueve.onPlayers(state.players);
  });

  if (window.Roulette) window.Roulette.attachSocket(App.socket);
  if (window.Intermedio) window.Intermedio.attachSocket(App.socket);
  if (window.Nueve) window.Nueve.attachSocket(App.socket);
}

// ═══════════════════ TOPBAR / PLAYER WIDGETS ═══════════════════
function renderTopbarPlayer() {
  const me = App.players.find((p) => p.id === App.player?.id);
  if (me) App.player.balance = me.balance;
  const html = App.player
    ? `<span class="tp-avatar">${App.player.avatar}</span>
       <div><div class="tp-name">${escapeHtml(App.player.name)}</div>
       <div class="tp-balance">${formatCOP(App.player.balance)}</div></div>`
    : "";
  ["topbar-player", "topbar-player-roulette", "topbar-player-intermedio", "topbar-player-nueve"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
  document.getElementById("btn-admin-panel").classList.toggle("hidden", !App.player?.isAdmin);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function renderLobbyPlayers() {
  const el = document.getElementById("lobby-players");
  if (!el) return;
  el.innerHTML = App.players.map((p) => `
    <div class="player-row">
      <span class="${p.connected ? "pr-online" : "pr-offline"}"></span>
      <span class="pr-avatar">${p.avatar}</span>
      <span class="pr-name">${escapeHtml(p.name)}</span>
      ${p.isAdmin ? '<span class="pr-admin">ADMIN</span>' : ""}
      <span class="pr-balance">${formatCOP(p.balance)}</span>
    </div>
  `).join("");
  document.getElementById("lobby-room-code").textContent = App.roomCode;
}

// ═══════════════════ HUB: TABS ═══════════════════
document.querySelectorAll(".hub-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".hub-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".hub-tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

buildAvatarGrid("avatar-grid-join", (a) => (App.selectedAvatarJoin = a), App.selectedAvatarJoin);
buildAvatarGrid("avatar-grid-create", (a) => (App.selectedAvatarCreate = a), App.selectedAvatarCreate);

document.getElementById("input-room-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

// ═══════════════════ HUB: CREAR SALA ═══════════════════
document.getElementById("btn-create").addEventListener("click", () => {
  const name = document.getElementById("input-name-create").value.trim();
  const pin = document.getElementById("input-pin").value.trim();
  const errEl = document.getElementById("create-error");
  errEl.textContent = "";
  if (!name) return (errEl.textContent = "Escribe tu nombre.");
  if (!pin) return (errEl.textContent = "Ingresa el PIN de administrador.");

  App.socket.emit("hub:create_room", { name, avatar: App.selectedAvatarCreate, pin }, (res) => {
    if (!res.ok) return (errEl.textContent = res.error);
    enterRoom(res.roomCode, res.player, res.players, "lobby");
  });
});

// ═══════════════════ HUB: UNIRSE A SALA ═══════════════════
document.getElementById("btn-join").addEventListener("click", () => {
  const roomCode = document.getElementById("input-room-code").value.trim();
  const name = document.getElementById("input-name-join").value.trim();
  const errEl = document.getElementById("join-error");
  errEl.textContent = "";
  if (!roomCode || roomCode.length !== 5) return (errEl.textContent = "Código de sala inválido (5 caracteres).");
  if (!name) return (errEl.textContent = "Escribe tu nombre.");

  App.socket.emit("hub:join_room", { roomCode, name, avatar: App.selectedAvatarJoin }, (res) => {
    if (!res.ok) return (errEl.textContent = res.error);
    enterRoom(res.roomCode, res.player, res.players, res.game || "lobby");
  });
});

function enterRoom(roomCode, player, players, game) {
  App.roomCode = roomCode;
  App.player = player;
  App.players = players;
  App.game = game;
  persistSession();
  renderTopbarPlayer();
  renderLobbyPlayers();
  renderAdminList();
  navigateToGame(game === "lobby" ? "lobby" : game);
  showToast(`¡Bienvenido a la sala ${roomCode}!`, "success");
}

// ═══════════════════ NAVEGACIÓN ENTRE JUEGOS ═══════════════════
function navigateToGame(game) {
  App.game = game;
  if (game === "lobby") showView("lobby");
  else if (game === "roulette") { showView("roulette"); window.Roulette?.onEnter(); }
  else if (game === "intermedio") { showView("intermedio"); window.Intermedio?.onEnter(); }
  else if (game === "nueve") { showView("nueve"); window.Nueve?.onEnter(); }
}

document.querySelectorAll(".game-card").forEach((card) => {
  card.addEventListener("click", () => {
    const game = card.dataset.game;
    App.socket.emit("hub:select_game", { game });
    navigateToGame(game);
  });
});

document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    App.socket.emit("hub:select_game", { game: "lobby" });
    navigateToGame("lobby");
  });
});

// ═══════════════════ PANEL ADMIN ═══════════════════
document.getElementById("btn-admin-panel").addEventListener("click", () => {
  document.getElementById("admin-modal").classList.remove("hidden");
  renderAdminList();
});
document.getElementById("btn-close-admin").addEventListener("click", () => {
  document.getElementById("admin-modal").classList.add("hidden");
});

function renderDepartedList() {
  const box = document.getElementById("admin-departed-box");
  const el = document.getElementById("admin-departed-list");
  if (!box || !el || !App.player?.isAdmin) return;
  const list = App.departed || [];
  box.classList.toggle("hidden", list.length === 0);
  if (list.length === 0) return;
  el.innerHTML = list.map((d) => {
    const minsAgo = Math.max(0, Math.round((Date.now() - d.ts) / 60000));
    return `
    <div class="admin-player-card">
      <div class="admin-player-head">
        <span style="font-size:20px">${d.avatar}</span>
        <span style="font-weight:700">${escapeHtml(d.name)}</span>
        <span class="ap-balance">${formatCOP(d.balance)}</span>
      </div>
      <p class="admin-sublabel">${d.reason} hace ${minsAgo} min — dale este monto manualmente si vuelve a entrar</p>
      <button class="btn btn-outline-gold" data-action="clear-departed" data-id="${d.id}" style="margin-top:6px; padding:6px 12px; font-size:12px;">✓ Ya se le pagó / descartar</button>
    </div>
  `;
  }).join("");

  el.querySelectorAll("[data-action='clear-departed']").forEach((b) =>
    b.addEventListener("click", () => App.socket.emit("admin:clear_departed", { id: b.dataset.id }))
  );
}

function renderAdminList() {
  renderDepartedList();
  const el = document.getElementById("admin-players-list");
  if (!el || !App.player?.isAdmin) return;
  el.innerHTML = App.players.map((p) => `
    <div class="admin-player-card">
      <div class="admin-player-head">
        <span style="font-size:20px">${p.avatar}</span>
        <span style="font-weight:700">${escapeHtml(p.name)}</span>
        <span class="ap-balance">${formatCOP(p.balance)}</span>
        ${p.id !== App.player?.id ? `<button class="btn btn-outline-red" data-action="kick" data-id="${p.id}" style="margin-left:8px; padding:4px 10px; font-size:11px;">Eliminar</button>` : ""}
      </div>
      <p class="admin-sublabel">Recargar</p>
      <div class="admin-amt-row">
        ${RELOAD_AMOUNTS.map((amt) => `<button class="admin-amt-btn reload" data-action="reload" data-id="${p.id}" data-amt="${amt}">+ ${formatCOP(amt)}</button>`).join("")}
      </div>
      <p class="admin-sublabel">Bajar saldo</p>
      <div class="admin-amt-row">
        ${RELOAD_AMOUNTS.map((amt) => `<button class="admin-amt-btn deduct" data-action="deduct" data-id="${p.id}" data-amt="${amt}">− ${formatCOP(amt)}</button>`).join("")}
      </div>
      <div class="admin-custom-row">
        <input type="number" min="0" placeholder="Monto exacto" class="field-input" id="custom-${p.id}" />
        <button class="btn btn-outline-gold" data-action="custom-reload" data-id="${p.id}">+</button>
        <button class="btn btn-outline-red" data-action="custom-deduct" data-id="${p.id}">−</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll("[data-action='reload']").forEach((b) =>
    b.addEventListener("click", () => App.socket.emit("admin:reload", { playerId: b.dataset.id, amount: Number(b.dataset.amt) }))
  );
  el.querySelectorAll("[data-action='deduct']").forEach((b) =>
    b.addEventListener("click", () => App.socket.emit("admin:deduct", { playerId: b.dataset.id, amount: Number(b.dataset.amt) }))
  );
  el.querySelectorAll("[data-action='custom-reload']").forEach((b) =>
    b.addEventListener("click", () => {
      const v = Number(document.getElementById(`custom-${b.dataset.id}`).value);
      if (v > 0) App.socket.emit("admin:reload", { playerId: b.dataset.id, amount: v });
    })
  );
  el.querySelectorAll("[data-action='custom-deduct']").forEach((b) =>
    b.addEventListener("click", () => {
      const v = Number(document.getElementById(`custom-${b.dataset.id}`).value);
      if (v > 0) App.socket.emit("admin:deduct", { playerId: b.dataset.id, amount: v });
    })
  );
  el.querySelectorAll("[data-action='kick']").forEach((b) =>
    b.addEventListener("click", () => {
      const target = App.players.find((p) => p.id === b.dataset.id);
      if (!confirm(`¿Eliminar a ${target?.name || "este jugador"} de la sala?`)) return;
      App.socket.emit("admin:kick_player", { playerId: b.dataset.id });
    })
  );
}

// ═══════════════════ SALIR / CERRAR SALA ═══════════════════
function resetToHub(message, type) {
  localStorage.removeItem("yamba_session");
  App.player = null;
  App.roomCode = null;
  App.players = [];
  document.getElementById("admin-modal").classList.add("hidden");
  showView("hub");
  if (message) showToast(message, type || "success");
}

document.getElementById("btn-leave-room")?.addEventListener("click", () => {
  if (!confirm("¿Seguro que quieres salir de la sala?")) return;
  App.socket.emit("room:leave_room", {}, () => resetToHub("Saliste de la sala.", "success"));
});

document.getElementById("btn-close-room")?.addEventListener("click", () => {
  if (!confirm("Esto cierra la sala para TODOS los jugadores. ¿Continuar?")) return;
  App.socket.emit("admin:close_room");
  resetToHub("Cerraste la sala.", "success");
});

// ═══════════════════ BOOT ═══════════════════
window.App = App;
window.formatCOP = formatCOP;
window.showToast = showToast;
window.escapeHtml = escapeHtml;

// Se espera a que todos los scripts (roulette.js, intermedio.js) hayan definido
// window.Roulette / window.Intermedio antes de conectar el socket, para que
// attachSocket() les llegue correctamente y sus botones queden conectados.
document.addEventListener("DOMContentLoaded", initSocket);

// Intenta reconexión automática si había una sesión guardada
const saved = loadSession();
if (saved) {
  // Pedimos nombre/avatar igual por si el server reinició y no reconoce el playerId;
  // si lo reconoce, el server restaura el mismo jugador (mismo saldo).
  document.getElementById("input-room-code").value = saved.roomCode;
}
