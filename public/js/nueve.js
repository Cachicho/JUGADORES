"use strict";
/* global App, formatCOP, showToast, escapeHtml */

(function () {
  let socket = null;
  let state = null;

  function renderHandCardsHtml(cards) {
    return cards.map((c) => `<div class="card-face card-face-sm">${c.rank}${c.suit}</div>`).join("");
  }

  function renderTurnOrder() {
    const el = document.getElementById("nueve-turn-order-strip");
    if (!state || state.turnOrder.length === 0) { el.innerHTML = ""; return; }
    el.innerHTML = state.turnOrder.map((pid) => {
      const p = App.players.find((x) => x.id === pid);
      if (!p) return "";
      const active = pid === state.currentPlayerId;
      return `<div class="turn-chip ${active ? "active" : ""}"><span class="tc-avatar">${p.avatar}</span><span class="tc-name">${escapeHtml(p.name)}</span></div>`;
    }).join("");
  }

  function renderPlayers() {
    const el = document.getElementById("nueve-players");
    el.innerHTML = App.players.map((p) => `
      <div class="pl-row ${state && p.id === state.currentPlayerId ? "current-turn" : ""}">
        <span>${p.avatar}</span><span>${escapeHtml(p.name)}</span><span class="pl-balance">${formatCOP(p.balance)}</span>
      </div>
    `).join("");
  }

  function renderLog() {
    const el = document.getElementById("nueve-log");
    if (!state) { el.innerHTML = ""; return; }
    el.innerHTML = state.log.map((entry) => `<div class="feed-item"><span>${escapeHtml(entry.message)}</span></div>`).join("");
  }

  function renderHandsGrid() {
    const el = document.getElementById("nueve-hands-grid");
    if (!state || !state.turnOrder.length) { el.innerHTML = ""; return; }
    el.innerHTML = state.turnOrder.map((pid) => {
      const p = App.players.find((x) => x.id === pid);
      const hand = state.hands[pid];
      if (!p || !hand) return "";
      const isMe = pid === App.player?.id;
      const isCurrent = pid === state.currentPlayerId;
      // Mientras la mano sigue en juego, solo el propio jugador ve sus cartas con valor;
      // a los demás se les oculta el detalle hasta que termina de actuar (igual de "secreto"
      // que en Intermedio se revela todo a la vez al resolver el turno actual).
      const reveal = hand.acted || state.phase === "round_over" || isMe;
      return `
        <div class="nueve-hand-block ${isCurrent ? "active" : ""}">
          <div class="nueve-hand-head"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>
          <div class="nueve-hand-cards">${reveal ? renderHandCardsHtml(hand.cards) : hand.cards.map(() => `<div class="card-face card-face-sm card-face-back">🂠</div>`).join("")}</div>
          <div class="nueve-hand-label">${reveal ? escapeHtml(hand.label) : "?"}</div>
        </div>
      `;
    }).join("");
  }

  function renderStatusAndControls() {
    const statusEl = document.getElementById("nueve-status");
    const turnControls = document.getElementById("nueve-turn-controls");
    const anteControls = document.getElementById("nueve-ante-controls");
    const anteInput = document.getElementById("nueve-ante-amount");
    const startBtn = document.getElementById("btn-start-nueve");
    const phaseLabel = document.getElementById("nueve-phase-label");

    turnControls.classList.add("hidden");

    if (!state || state.phase === "waiting" || state.phase === "round_over") {
      phaseLabel.textContent = state?.phase === "round_over" ? "Ronda terminada" : "Esperando ronda...";
      anteControls.classList.remove("hidden");
      startBtn.disabled = !App.player?.isAdmin;
      anteInput.disabled = !App.player?.isAdmin;
      if (state?.phase === "round_over" && state.lastWinner) {
        const w = App.players.find((p) => p.id === state.lastWinner.id);
        statusEl.textContent = `Ganó ${w?.name || "un jugador"} con ${state.lastWinner.label}${state.lastWinner.special === "two_aces" ? " — ¡pago doble!" : ""}: +${formatCOP(state.lastWinner.payout)}.`;
      } else {
        statusEl.textContent = "Define el pozo inicial (ante) y presiona iniciar.";
      }
      return;
    }

    anteControls.classList.add("hidden");
    const isMyTurn = state.currentPlayerId === App.player?.id;

    phaseLabel.textContent = state.tiebreakRound > 0 ? `🃏 Desempate (ronda ${state.tiebreakRound})` : "🃏 En juego";
    if (isMyTurn) {
      const myHand = state.hands[App.player.id];
      statusEl.textContent = `Tu mano: ${myHand.label}. ¿Pides carta o te plantas?`;
      turnControls.classList.remove("hidden");
      document.getElementById("btn-nueve-hit").disabled = myHand.cards.length >= 3;
    } else {
      const p = App.players.find((x) => x.id === state.currentPlayerId);
      statusEl.textContent = `Esperando a que ${p?.name || "otro jugador"} juegue...`;
    }
  }

  function renderAll() {
    document.getElementById("nueve-pot-display").textContent = state ? formatCOP(state.pot) : "$0";
    document.getElementById("nueve-pot-display-mobile").textContent = `Pozo: ${state ? formatCOP(state.pot) : "$0"}`;
    renderTurnOrder();
    renderPlayers();
    renderLog();
    renderHandsGrid();
    renderStatusAndControls();
  }

  function attachSocket(s) {
    socket = s;
    socket.on("nueve:state", (st) => { state = st; renderAll(); });
  }

  function onPlayers() { renderPlayers(); renderTurnOrder(); renderHandsGrid(); }
  function onEnter() { renderAll(); }

  document.getElementById("btn-start-nueve")?.addEventListener("click", () => {
    const ante = Number(document.getElementById("nueve-ante-amount").value);
    if (!ante || ante < 1) return showToast("Define un pozo inicial (ante) válido.", "error");
    socket.emit("nueve:start_round", { ante });
  });
  document.getElementById("btn-nueve-hit")?.addEventListener("click", () => socket.emit("nueve:hit"));
  document.getElementById("btn-nueve-stand")?.addEventListener("click", () => socket.emit("nueve:stand"));

  window.Nueve = { attachSocket, onPlayers, onEnter };
})();
