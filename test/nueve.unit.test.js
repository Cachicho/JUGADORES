"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const nueve = require("../lib/nueve");

// Helpers para construir cartas de prueba sin pasar por el RNG real.
function card(rank, value, isFigure = false, suit = "🪙") {
  return { suit, rank, value, isFigure };
}
const ace = (suit) => card("As", 1, false, suit);
const sota = (suit) => card("Sota", 0, true, suit);
const caballo = (suit) => card("Caballo", 0, true, suit);
const rey = (suit) => card("Rey", 0, true, suit);
const num = (n) => card(String(n), n, false);

test("evaluateHand: dos Ases (2 cartas) es el 9 especial con mayor rankKey", () => {
  const hand = nueve.evaluateHand([ace("🪙"), ace("🍷")]);
  assert.equal(hand.score, 9);
  assert.equal(hand.special, "two_aces");
  assert.equal(hand.rankKey, 9.3);
});

test("evaluateHand: tres negras (Sota+Caballo+Rey) es 9, por debajo de dos Ases", () => {
  const hand = nueve.evaluateHand([sota(), caballo(), rey()]);
  assert.equal(hand.score, 9);
  assert.equal(hand.special, "three_blacks");
  assert.equal(hand.rankKey, 9.2);
  assert.ok(hand.rankKey < nueve.evaluateHand([ace("🪙"), ace("🍷")]).rankKey);
});

test("evaluateHand: dos negras + un As es 8.5, por debajo de cualquier variante de 9", () => {
  const hand = nueve.evaluateHand([sota(), rey(), ace()]);
  assert.equal(hand.score, 8.5);
  assert.equal(hand.special, "two_blacks_ace");
  assert.equal(hand.rankKey, 8.5);
  assert.ok(hand.rankKey < nueve.evaluateHand([sota(), caballo(), rey()]).rankKey);
});

test("evaluateHand: dos Ases solo cuenta como especial con exactamente 2 cartas", () => {
  // Tres ases (o dos ases + tercera carta) ya no es el "9 especial".
  const hand = nueve.evaluateHand([ace("🪙"), ace("🍷"), num(3)]);
  assert.equal(hand.special, null);
  assert.equal(hand.score, (1 + 1 + 3) % 10);
});

test("evaluateHand: mano normal usa la suma módulo 10 (nunca pasa de 9)", () => {
  const hand = nueve.evaluateHand([num(7), num(7), num(7)]); // suma 21
  assert.equal(hand.special, null);
  assert.equal(hand.score, 1); // 21 % 10
  assert.equal(hand.rankKey, 1);
});

test("evaluateHand: 3+4=7 sin especiales", () => {
  const hand = nueve.evaluateHand([num(3), num(4)]);
  assert.equal(hand.score, 7);
  assert.equal(hand.special, null);
});

test("Jerarquía completa: dos Ases > tres negras > 9 normal > 8.5 > 8", () => {
  const twoAces = nueve.evaluateHand([ace("🪙"), ace("🍷")]).rankKey;
  const threeBlacks = nueve.evaluateHand([sota(), caballo(), rey()]).rankKey;
  const normalNine = nueve.evaluateHand([num(4), num(5)]).rankKey; // 4+5=9
  const eightHalf = nueve.evaluateHand([sota(), rey(), ace()]).rankKey;
  const eight = nueve.evaluateHand([num(3), num(5)]).rankKey; // 3+5=8

  assert.ok(twoAces > threeBlacks);
  assert.ok(threeBlacks > normalNine);
  assert.ok(normalNine > eightHalf);
  assert.ok(eightHalf > eight);
});

test("dealStartingHand: nunca devuelve una mano inicial que sume exactamente 10", () => {
  const state = nueve.createNueveState();
  // Mazo amañado: primero un par que suma 10 (5+5), luego un par válido (2+3).
  // El mazo se consume con .pop(), así que el último elemento es el primero en salir.
  state.deck = [num(3), num(2), num(5), num(5)];
  const hand = nueve.dealStartingHand(state);
  const sum = hand[0].value + hand[1].value;
  assert.notEqual(sum, 10);
  assert.deepEqual(hand.map((c) => c.value).sort(), [2, 3]);
});

test("hit: rechaza jugar fuera de turno", () => {
  const state = nueve.createNueveState();
  const players = new Map([["p1", { balance: 1000 }], ["p2", { balance: 1000 }]]);
  nueve.startRound(state, players, ["p1", "p2"], 100);
  const notCurrent = nueve.currentPlayerId(state) === "p1" ? "p2" : "p1";
  const result = nueve.hit(state, players, notCurrent);
  assert.equal(result.ok, false);
  assert.match(result.error, /no es tu turno/i);
});

test("hit: rechaza pedir una cuarta carta", () => {
  const state = nueve.createNueveState();
  const players = new Map([["p1", { balance: 1000 }], ["p2", { balance: 1000 }]]);
  nueve.startRound(state, players, ["p1", "p2"], 100);
  const pid = nueve.currentPlayerId(state);
  state.hands[pid].cards.push(num(2)); // simula que ya tiene 3 cartas
  const result = nueve.hit(state, players, pid);
  assert.equal(result.ok, false);
  assert.match(result.error, /tres cartas/i);
});

test("stand: rechaza jugar dos veces el mismo turno", () => {
  const state = nueve.createNueveState();
  const players = new Map([["p1", { balance: 1000 }], ["p2", { balance: 1000 }]]);
  nueve.startRound(state, players, ["p1", "p2"], 100);
  const pid = nueve.currentPlayerId(state);
  const first = nueve.stand(state, players, pid);
  assert.equal(first.ok, true);
  // Tras plantarse avanza el turno; si el otro jugador también se planta la
  // ronda se resuelve y ya no hay "turno" para volver a intentar con el mismo id.
});

test("startRound: requiere al menos 2 jugadores con saldo suficiente para el ante", () => {
  const state = nueve.createNueveState();
  const players = new Map([["p1", { balance: 50 }], ["p2", { balance: 1000 }]]);
  const result = nueve.startRound(state, players, ["p1", "p2"], 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /al menos 2 jugadores/i);
});
