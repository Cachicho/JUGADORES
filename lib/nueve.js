"use strict";
const { freshNueveDeck } = require("./deck");

const DEFAULT_ANTE = 200;

/**
 * Crea el estado inicial de una mesa de "9" para una sala. El estado vive en
 * memoria del servidor — es la única fuente de verdad; los clientes nunca
 * calculan resultados, solo los reciben. Mismo patrón que createIntermedioState().
 */
function createNueveState() {
  return {
    phase: "waiting", // waiting | turn | round_over
    deck: [],
    pot: 0,
    ante: DEFAULT_ANTE,
    turnOrder: [],      // playerIds que deciden en esta fase (ronda principal o desempate)
    turnIndex: 0,
    hands: {},          // playerId -> { cards:[...], acted, score, special, label, rankKey }
    tiebreakRound: 0,   // 0 = ronda principal; 1,2,... = rondas de desempate
    lastWinner: null,   // { id, payout, special, label } tras liquidar
    log: [],
  };
}

function pushLog(state, message) {
  state.log.unshift({ message, ts: Date.now() });
  state.log = state.log.slice(0, 60);
}

// ── Evaluación de manos ─────────────────────────────────────────────────────
// El valor "real" de una mano no-especial es la suma de sus cartas módulo 10
// (igual que el punto de un bacará): por eso la jerarquía nunca pasa de 9 y
// por eso 5+5, 6+4 y 7+3 (que dan exactamente 10 = el peor resultado posible,
// módulo 10 = 0) se descartan y se reparten de nuevo antes de poder jugar.
//
// `rankKey` es el valor usado SOLO para comparar manos entre sí: los tres
// "9" (dos ases, tres negras, 9 normal) empatan en `score` pero tienen un
// orden estricto entre ellos según la jerarquía pedida, así que cada uno usa
// un rankKey distinto (9.3 / 9.2 / 9.0) que ordena exactamente igual que el
// score para todo lo demás.
function evaluateHand(cards) {
  const aces = cards.filter((c) => c.value === 1 && !c.isFigure).length;
  const figures = cards.filter((c) => c.isFigure).length;

  if (cards.length === 2 && aces === 2) {
    return { score: 9, special: "two_aces", label: "Dos Ases (9 especial)", rankKey: 9.3 };
  }
  if (cards.length === 3 && figures === 3) {
    return { score: 9, special: "three_blacks", label: "Tres negras (9)", rankKey: 9.2 };
  }
  if (cards.length === 3 && figures === 2 && aces === 1) {
    return { score: 8.5, special: "two_blacks_ace", label: "Dos negras y un As (8.5)", rankKey: 8.5 };
  }

  const sum = cards.reduce((s, c) => s + c.value, 0);
  const score = sum % 10;
  return { score, special: null, label: `${score}`, rankKey: score };
}

function buildHandState(cards) {
  return { cards, acted: false, ...evaluateHand(cards) };
}

/** Reparte 2 cartas; si suman exactamente 10 se descartan y se reparten de nuevo (regla del juego). */
function dealStartingHand(state) {
  let cards;
  do {
    if (state.deck.length < 2) state.deck = freshNueveDeck();
    cards = [state.deck.pop(), state.deck.pop()];
  } while (cards[0].value + cards[1].value === 10);
  return cards;
}

function currentPlayerId(state) {
  return state.turnOrder[state.turnIndex] ?? null;
}

/** Inicia una nueva ronda: cobra el ante a todos los jugadores activos, forma el pozo
 *  y reparte 2 cartas a cada uno. `customAnte`, si se manda, reemplaza el ante por defecto. */
function startRound(state, players, playerIdsInRoom, customAnte) {
  if (customAnte !== undefined) {
    const ante = Math.floor(Number(customAnte));
    if (!Number.isFinite(ante) || ante < 1) {
      return { ok: false, error: "El pozo inicial (ante) debe ser un número mayor a 0." };
    }
    state.ante = ante;
  }

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

  state.deck = freshNueveDeck();
  state.pot = potCollected;
  state.turnOrder = eligible;
  state.turnIndex = 0;
  state.tiebreakRound = 0;
  state.lastWinner = null;
  state.hands = {};
  for (const id of eligible) {
    state.hands[id] = buildHandState(dealStartingHand(state));
  }
  state.phase = "turn";
  pushLog(state, `Nueva ronda: ${eligible.length} jugadores aportaron $${state.ante} c/u al pozo ($${potCollected} total).`);
  return { ok: true };
}

/** El jugador en turno pide su única carta adicional permitida. */
function hit(state, players, playerId) {
  if (state.phase !== "turn") return { ok: false, error: "No es momento de jugar." };
  if (currentPlayerId(state) !== playerId) return { ok: false, error: "No es tu turno." };
  const hand = state.hands[playerId];
  if (!hand) return { ok: false, error: "No tienes mano activa." };
  if (hand.acted) return { ok: false, error: "Ya jugaste este turno." };
  if (hand.cards.length >= 3) return { ok: false, error: "Ya tienes tres cartas — no puedes pedir más." };

  if (state.deck.length < 1) state.deck = freshNueveDeck();
  const card = state.deck.pop();
  hand.cards.push(card);
  Object.assign(hand, evaluateHand(hand.cards));
  hand.acted = true;

  pushLog(state, `Pidió carta: ${card.rank}${card.suit} → mano: ${hand.label}.`);
  advanceTurn(state, players);
  return { ok: true };
}

/** El jugador en turno se planta con sus 2 cartas. */
function stand(state, players, playerId) {
  if (state.phase !== "turn") return { ok: false, error: "No es momento de jugar." };
  if (currentPlayerId(state) !== playerId) return { ok: false, error: "No es tu turno." };
  const hand = state.hands[playerId];
  if (!hand) return { ok: false, error: "No tienes mano activa." };
  if (hand.acted) return { ok: false, error: "Ya jugaste este turno." };

  hand.acted = true;
  pushLog(state, `Se plantó con ${hand.label}.`);
  advanceTurn(state, players);
  return { ok: true };
}

function advanceTurn(state, players) {
  state.turnIndex += 1;
  if (state.turnIndex >= state.turnOrder.length) {
    resolveShowdown(state, players);
  }
}

/** Evalúa todas las manos activas, paga al ganador único o arma un desempate
 *  (mismo mazo, sin devolver cartas usadas, repartiendo de nuevo SOLO a los empatados). */
function resolveShowdown(state, players) {
  const evaluated = state.turnOrder.map((id) => ({ id, hand: state.hands[id] }));
  const best = Math.max(...evaluated.map((e) => e.hand.rankKey));
  const winners = evaluated.filter((e) => e.hand.rankKey === best).map((e) => e.id);

  if (winners.length === 1) {
    const winnerId = winners[0];
    const player = players.get(winnerId);
    const winningHand = state.hands[winnerId];
    const isDouble = winningHand.special === "two_aces";
    const payout = isDouble ? state.pot * 2 : state.pot;

    player.balance += payout;
    state.lastWinner = { id: winnerId, payout, special: winningHand.special, label: winningHand.label };
    state.pot = 0;
    state.phase = "round_over";
    pushLog(state, `Ganó con ${winningHand.label}${isDouble ? " — ¡PAGO DOBLE!" : ""}: +$${payout}.`);
  } else {
    state.tiebreakRound += 1;
    state.turnOrder = winners;
    state.turnIndex = 0;
    for (const id of winners) {
      state.hands[id] = buildHandState(dealStartingHand(state));
    }
    state.phase = "turn";
    pushLog(state, `Empate entre ${winners.length} jugadores — desempate ronda ${state.tiebreakRound}.`);
  }
}

module.exports = {
  createNueveState,
  startRound,
  currentPlayerId,
  hit,
  stand,
  evaluateHand,
  dealStartingHand,
  resolveShowdown,
  pushLog,
  DEFAULT_ANTE,
};
