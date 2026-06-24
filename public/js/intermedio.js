"use strict";
/* global App, formatCOP, showToast, escapeHtml */

(function () {
  let socket = null;
  let state = null;

  function suitClass(suit) { return (suit === "♥" || suit === "♦") ? "suit-red" : ""; }

  function renderCardFace(elId, card, faceDown) {
    const el = document.getElementById(elId);
    if (faceDown || !card) { el.innerHTML = `<div class="card-face card-face-back">🂠</div>`; return; }
    el.innerHTML = `<div class="card-face ${suitClass(card.suit)}">${card.rank}${card.suit}</div>`;
  }

  function renderTurnOrder() {
    const el = document.getElementById("turn-order-strip");
    if (!state || state.turnOrder.length === 0) { el.innerHTML = ""; return; }
    el.innerHTML = state.turnOrder.map((pid) => {
      const p = App.players.find((x) => x.id === pid);
      if (!p) return "";
      const active = pid === state.currentPlayerId;
      return `<div class="turn-chip ${active ? "active" : ""}"><span class="tc-avatar">${p.avatar}</span><span class="tc-name">${escapeHtml(p.name)}</span></div>`;
    }).join("");
  }

  function renderPlayers() {
    const el = document.getElementById("intermedio-players");
    el.innerHTML = App.players.map((p) => `
      <div class="pl-row ${state && p.id === state.currentPlayerId ? "current-turn" : ""}">
        <span>${p.avatar}</span><span>${escapeHtml(p.name)}</span><span class="pl-balance">${formatCOP(p.balance)}</span>
      </div>
    `).join("");
  }

  function renderLog() {
    const el = document.getElementById("intermedio-log");
    if (!state) { el.innerHTML = ""; return; }
    el.innerHTML = state.log.map((entry) => `<div class="feed-item"><span>${escapeHtml(entry.message)}</span></div>`).join("");
  }

  function renderStatusAndControls() {
    const statusEl = document.getElementById("intermedio-status");
    const betControls = document.getElementById("bet-controls");
    const revealControls = document.getElementById("reveal-controls");
    const nextControls = document.getElementById("next-controls");
    const startBtn = document.getElementById("btn-start-intermedio");
    const anteControls = document.getElementById("ante-controls");
    const anteInput = document.getElementById("intermedio-ante-amount");
    const phaseLabel = document.getElementById("intermedio-phase-label");

    betControls.classList.add("hidden");
    revealControls.classList.add("hidden");
    nextControls.classList.add("hidden");

    if (!state || state.phase === "waiting" || state.phase === "round_over") {
      phaseLabel.textContent = state?.phase === "round_over" ? "Ronda terminada" : "Esperando ronda...";
      anteControls.classList.remove("hidden");
      startBtn.disabled = !App.player?.isAdmin;
      anteInput.disabled = !App.player?.isAdmin;
      statusEl.textContent = state?.phase === "round_over" ? "El pozo se vació. El administrador puede iniciar una nueva ronda." : "Define el pozo inicial (ante) y presiona iniciar.";
      return;
    }

    anteControls.classList.add("hidden");
    const isMyTurn = state.currentPlayerId === App.player?.id;
    const me = App.players.find((p) => p.id === App.player?.id);

    if (state.phase === "turn") {
      phaseLabel.textContent = "🃏 En juego";
      if (state.forcedSkip) {
        statusEl.textContent = "Cartas consecutivas: no hay número entre ellas. Turno saltado automáticamente.";
      } else if (isMyTurn) {
        statusEl.textContent = state.isPair ? "¡Pareja! Solo ganas premio especial si la 3ª carta también iguala." : "Es tu turno: elige cuánto apostar.";
        betControls.classList.remove("hidden");
        document.getElementById("intermedio-bet-amount").max = state.pot;
        document.getElementById("intermedio-bet-amount").value = "";
      } else {
        const p = App.players.find((x) => x.id === state.currentPlayerId);
        statusEl.textContent = `Esperando a que ${p?.name || "otro jugador"} apueste...`;
      }
    } else if (state.phase === "revealing") {
      phaseLabel.textContent = "🎴 Revelando...";
      if (isMyTurn) {
        statusEl.textContent = `Apostaste ${formatCOP(state.currentBet.amount)}. ¡Revela la tercera carta!`;
        revealControls.classList.remove("hidden");
      } else {
        statusEl.textContent = "Esperando a que se revele la tercera carta...";
      }
    } else if (state.phase === "result") {
      phaseLabel.textContent = "✅ Resultado";
      statusEl.textContent = "Listo para el siguiente turno.";
      nextControls.classList.remove("hidden");
    }
  }

  function renderCards() {
    if (!state || !state.currentCards) {
      renderCardFace("card-a", null, true);
      renderCardFace("card-b", null, true);
      renderCardFace("card-c", null, true);
      return;
    }
    renderCardFace("card-a", state.currentCards.a, false);
    renderCardFace("card-b", state.currentCards.b, false);
    renderCardFace("card-c", state.thirdCard, !state.thirdCard);
  }

  function renderAll() {
    document.getElementById("pot-display").textContent = state ? formatCOP(state.pot) : "$0";
    renderTurnOrder();
    renderPlayers();
    renderLog();
    renderCards();
    renderStatusAndControls();
  }

  function attachSocket(s) {
    socket = s;
    socket.on("intermedio:state", (st) => { state = st; renderAll(); });
  }

  function onPlayers() { renderPlayers(); renderTurnOrder(); }
  function onEnter() { renderAll(); }

  document.getElementById("btn-start-intermedio")?.addEventListener("click", () => {
    const ante = Number(document.getElementById("intermedio-ante-amount").value);
    if (!ante || ante < 1) return showToast("Define un pozo inicial (ante) válido.", "error");
    socket.emit("intermedio:start_round", { ante });
  });
  document.getElementById("btn-intermedio-bet")?.addEventListener("click", () => {
    const amount = Number(document.getElementById("intermedio-bet-amount").value);
    if (!amount || amount < 1) return showToast("Ingresa un monto válido.", "error");
    socket.emit("intermedio:place_bet", { amount });
  });
  document.getElementById("btn-intermedio-skip")?.addEventListener("click", () => socket.emit("intermedio:skip_turn"));
  document.getElementById("btn-intermedio-reveal")?.addEventListener("click", () => socket.emit("intermedio:reveal"));
  document.getElementById("btn-intermedio-next")?.addEventListener("click", () => socket.emit("intermedio:next_turn"));

  window.Intermedio = { attachSocket, onPlayers, onEnter };
})();
