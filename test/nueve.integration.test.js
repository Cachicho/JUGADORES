"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const nueve = require("../lib/nueve");

function card(rank, value, isFigure = false, suit = "🪙") {
  return { suit, rank, value, isFigure };
}
const ace = (suit) => card("As", 1, false, suit);
const num = (n) => card(String(n), n, false);

test("integración: dos Ases gana y paga EL DOBLE del pozo", () => {
  const state = nueve.createNueveState();
  const players = new Map([
    ["p1", { balance: 1000 }],
    ["p2", { balance: 1000 }],
  ]);
  state.pot = 500;
  state.turnOrder = ["p1", "p2"];
  state.hands = {
    p1: { cards: [ace("🪙"), ace("🍷")], acted: true, ...nueve.evaluateHand([ace("🪙"), ace("🍷")]) },
    p2: { cards: [num(4)], acted: true, ...nueve.evaluateHand([num(4)]) },
  };

  nueve.resolveShowdown(state, players);

  assert.equal(state.phase, "round_over");
  assert.equal(state.pot, 0);
  assert.equal(players.get("p1").balance, 1000 + 1000); // 500 * 2
  assert.equal(state.lastWinner.id, "p1");
  assert.equal(state.lastWinner.special, "two_aces");
  assert.equal(state.lastWinner.payout, 1000);
});

test("integración: empate entre dos jugadores arma un desempate (mismo mazo, sin pagar todavía)", () => {
  const state = nueve.createNueveState();
  const players = new Map([
    ["p1", { balance: 1000 }],
    ["p2", { balance: 1000 }],
    ["p3", { balance: 1000 }],
  ]);
  state.pot = 900;
  state.deck = [num(3), num(2), num(5), num(4)]; // cartas disponibles para repartir en el desempate
  state.turnOrder = ["p1", "p2", "p3"];
  state.hands = {
    p1: { cards: [num(4), num(4)], acted: true, ...nueve.evaluateHand([num(4), num(4)]) }, // 8
    p2: { cards: [num(3), num(5)], acted: true, ...nueve.evaluateHand([num(3), num(5)]) }, // 8
    p3: { cards: [num(2), num(3)], acted: true, ...nueve.evaluateHand([num(2), num(3)]) }, // 5 (eliminado)
  };

  nueve.resolveShowdown(state, players);

  // p3 queda eliminado (no estaba en el mejor puntaje); p1 y p2 van a desempate.
  assert.equal(state.phase, "turn");
  assert.equal(state.tiebreakRound, 1);
  assert.deepEqual([...state.turnOrder].sort(), ["p1", "p2"]);
  assert.equal(state.pot, 900); // el pozo no se reparte hasta que haya un único ganador
  assert.equal(state.hands.p1.cards.length, 2); // se repartió una mano nueva
  assert.equal(state.hands.p2.cards.length, 2);
  // Las cartas usadas en la mano original no vuelven al mazo: el mazo de desempate
  // se sigue consumiendo desde donde quedó.
  assert.equal(state.deck.length, 0);
});

test("integración: ronda completa vía API pública (startRound + hit/stand) conserva el dinero total", () => {
  for (let trial = 0; trial < 25; trial++) {
    const state = nueve.createNueveState();
    const players = new Map([
      ["p1", { balance: 10000 }],
      ["p2", { balance: 10000 }],
      ["p3", { balance: 10000 }],
    ]);
    const totalBefore = [...players.values()].reduce((s, p) => s + p.balance, 0);

    const started = nueve.startRound(state, players, ["p1", "p2", "p3"], 100);
    assert.equal(started.ok, true);
    assert.equal(totalBefore - 300, [...players.values()].reduce((s, p) => s + p.balance, 0));
    assert.equal(state.pot, 300);

    // Cada jugador en turno decide aleatoriamente pedir carta (si puede) o plantarse,
    // hasta que la ronda completa (incluyendo posibles desempates) quede resuelta.
    let guard = 0;
    while (state.phase === "turn" && guard < 200) {
      guard += 1;
      const pid = nueve.currentPlayerId(state);
      const hand = state.hands[pid];
      const canHit = hand.cards.length < 3 && !hand.acted;
      const action = canHit && Math.random() < 0.5 ? "hit" : "stand";
      const result = action === "hit" ? nueve.hit(state, players, pid) : nueve.stand(state, players, pid);
      assert.equal(result.ok, true, result.error);
    }

    assert.ok(guard < 200, "la ronda no debería quedar en bucle infinito");
    assert.equal(state.phase, "round_over");
    assert.equal(state.pot, 0);

    // El dinero total (suma de saldos) se conserva exactamente: el pozo viene de
    // las antes de todos y vuelve completo (x1 o x2) a un único ganador.
    const totalAfter = [...players.values()].reduce((s, p) => s + p.balance, 0);
    const expectedTotal = state.lastWinner.special === "two_aces" ? totalBefore + 300 : totalBefore;
    assert.equal(totalAfter, expectedTotal);

    // Toda mano final tiene 2 o 3 cartas, nunca más.
    for (const hand of Object.values(state.hands)) {
      assert.ok(hand.cards.length === 2 || hand.cards.length === 3);
    }
  }
});

test("integración: hit/stand fuera de fase 'turn' es rechazado", () => {
  const state = nueve.createNueveState(); // fase 'waiting'
  const players = new Map([["p1", { balance: 1000 }]]);
  const hitResult = nueve.hit(state, players, "p1");
  const standResult = nueve.stand(state, players, "p1");
  assert.equal(hitResult.ok, false);
  assert.equal(standResult.ok, false);
});
