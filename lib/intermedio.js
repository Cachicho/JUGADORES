"use strict";
const { freshDeck } = require("./deck");

const DEFAULT_ANTE = 200;

/**
 * Crea el estado inicial de una mesa de Intermedio (In-Between / Acey-Deucey)
 * para una sala. El estado vive en memoria del servidor — es la única fuente
 * de verdad; los clientes nunca calculan resultados, solo los reciben.
 */
function createIntermedioState() {
  return {
    phase: "waiting", // waiting | ante | turn | revealed | round_over
    deck: [],
    pot: 0,
    ante: DEFAULT_ANTE,
    turnOrder: [],     // array de playerId en orden de turno
    turnIndex: 0,
    currentCards: null, // { a, b } las dos cartas boca arriba del turno actual
    thirdCard: null,    // carta revelada al resolver el turno
    currentBet: null,   // { playerId, amount }
    log: [],            // historial de acciones visible para todos
    forcedSkip: false,  // true si las 2 cartas no permiten apuesta (consecutivas)
  };
}

function pushLog(state, message) {
  state.log.unshift({ message, ts: Date.now() });
  state.log = state.log.slice(0, 60);
}

/** Inicia una nueva ronda: cobra el ante a todos los jugadores activos y forma el pozo. */
function startRound(state, players, playerIdsInRoom) {
  const eligible = playerIdsInRoom.filter((id) => {
    const p = players.get(id);
    return p && p.balance >= state.ante;
  });
  if (eligible.length < 2) {
    return { ok: false, error: "Se necesitan al menos 2 jugadores con saldo suficiente para el ante." };
  }

  let potCollected = 0;
  for (const id of eligible) {
    const p = players.get(id);
    p.balance -= state.ante;
    potCollected += state.ante;
  }

  state.deck = freshDeck();
  state.pot = potCollected;
  state.turnOrder = eligible;
  state.turnIndex = 0;
  state.phase = "turn";
  state.currentCards = null;
  state.thirdCard = null;
  state.currentBet = null;
  pushLog(state, `Nueva ronda: ${eligible.length} jugadores aportaron $${state.ante} c/u al pozo ($${potCollected} total).`);

  dealTurnCards(state);
  return { ok: true };
}

function currentPlayerId(state) {
  if (state.turnOrder.length === 0) return null;
  return state.turnOrder[state.turnIndex % state.turnOrder.length];
}

function rankSpread(a, b) {
  const lo = Math.min(a.value, b.value);
  const hi = Math.max(a.value, b.value);
  return { lo, hi, gap: hi - lo };
}

/** Reparte las dos cartas del turno actual y determina si la apuesta está permitida. */
function dealTurnCards(state) {
  if (state.deck.length < 3) state.deck = freshDeck();
  const a = state.deck.pop();
  const b = state.deck.pop();
  state.currentCards = { a, b };
  state.thirdCard = null;
  state.currentBet = null;

  const { gap } = rankSpread(a, b);
  const isPair = a.value === b.value;
  const isConsecutive = !isPair && gap === 1;

  state.forcedSkip = isConsecutive; // calle: no hay número entre ambas, no se puede apostar
  state.phase = "turn";
  state.isPair = isPair;

  const pid = currentPlayerId(state);
  pushLog(state, `Turno de jugador — cartas: ${a.rank}${a.suit} y ${b.rank}${b.suit}${isPair ? " (PAR — premio especial si la 3ª iguala)" : isConsecutive ? " (CONSECUTIVAS — sin apuesta posible)" : ""}.`);
}

/** El jugador en turno coloca su apuesta (entre 1 y el pozo actual). */
function placeBet(state, players, playerId, amount) {
  if (state.phase !== "turn") return { ok: false, error: "No es momento de apostar." };
  if (currentPlayerId(state) !== playerId) return { ok: false, error: "No es tu turno." };
  if (state.forcedSkip) return { ok: false, error: "Cartas consecutivas: este turno se salta automáticamente." };

  const player = players.get(playerId);
  if (!player) return { ok: false, error: "Jugador no encontrado." };

  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount < 1) return { ok: false, error: "Monto inválido." };
  if (amount > state.pot) return { ok: false, error: "No puedes apostar más que el pozo actual." };
  if (amount > player.balance) return { ok: false, error: "No tienes saldo suficiente." };

  state.currentBet = { playerId, amount };
  state.phase = "revealing";
  pushLog(state, `Apostó $${amount} de un pozo de $${state.pot}.`);
  return { ok: true };
}

/** Pasa el turno sin apostar (solo permitido si forcedSkip o el jugador decide no jugar). */
function skipTurn(state) {
  if (state.phase !== "turn") return { ok: false, error: "No es momento de pasar turno." };
  pushLog(state, state.forcedSkip ? "Turno saltado automáticamente (cartas consecutivas)." : "El jugador decidió no apostar este turno.");
  advanceTurn(state);
  return { ok: true };
}

function advanceTurn(state) {
  state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
  if (state.pot <= 0) {
    state.phase = "round_over";
    pushLog(state, "El pozo se vació. Ronda terminada — el administrador puede iniciar una nueva.");
    return;
  }
  dealTurnCards(state);
}

/** Revela la tercera carta y liquida el turno: gana, pierde o "poste" (empate con el límite). */
function revealThird(state, players) {
  if (state.phase !== "revealing" || !state.currentBet) {
    return { ok: false, error: "No hay apuesta pendiente para revelar." };
  }
  if (state.deck.length < 1) state.deck = freshDeck();
  const third = state.deck.pop();
  state.thirdCard = third;

  const { a, b } = state.currentCards;
  const { lo, hi } = rankSpread(a, b);
  const { playerId, amount } = state.currentBet;
  const player = players.get(playerId);

  let outcome, delta, potDelta;

  if (state.isPair) {
    // Pareja: solo hay premio especial si la tercera también iguala (trío) — paga el cuádruple del pozo disponible
    if (third.value === a.value) {
      const prize = Math.min(amount * 4, state.pot);
      outcome = "jackpot";
      delta = prize;
      potDelta = -prize;
    } else {
      outcome = "lose";
      delta = -amount;
      potDelta = amount;
    }
  } else if (third.value === lo || third.value === hi) {
    // "Poste": la tercera empata con uno de los límites — penalización doble hacia el pozo
    const penalty = Math.min(amount * 2, player.balance + amount); // no puede quedar en negativo
    outcome = "post";
    delta = -penalty;
    potDelta = penalty;
  } else if (third.value > lo && third.value < hi) {
    outcome = "win";
    delta = amount;
    potDelta = -amount;
  } else {
    outcome = "lose";
    delta = -amount;
    potDelta = amount;
  }

  player.balance += delta;
  state.pot = Math.max(0, state.pot + potDelta);
  state.phase = "result";

  pushLog(
    state,
    `Tercera carta: ${third.rank}${third.suit} → ${
      outcome === "win" ? `¡Ganó $${delta}!` :
      outcome === "jackpot" ? `¡TRÍO! Ganó $${delta} del pozo!` :
      outcome === "post" ? `Poste (empate con el límite): perdió $${Math.abs(delta)} (doble penalización).` :
      `Perdió $${Math.abs(delta)} hacia el pozo.`
    }`
  );

  return { ok: true, outcome, delta, third };
}

/** Continúa al siguiente turno tras mostrar el resultado. */
function nextTurn(state) {
  if (state.phase !== "result") return { ok: false, error: "Aún no se resolvió el turno actual." };
  advanceTurn(state);
  return { ok: true };
}

module.exports = {
  createIntermedioState,
  startRound,
  currentPlayerId,
  placeBet,
  skipTurn,
  revealThird,
  nextTurn,
  pushLog,
  DEFAULT_ANTE,
};
