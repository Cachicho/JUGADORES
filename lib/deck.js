"use strict";
const crypto = require("crypto");

// Mazo español de truco: 4 palos, sin 8 ni 9 (40 cartas).
// `value` queda reindexado de forma SECUENCIAL (1..10) para que la lógica de
// "está en medio" del Intermedio funcione bien sin tratar el 8/9 como un hueco:
// el 7 y el 10 quedan en valores consecutivos (7 y 8), exactamente como pide
// el juego ("el 8 y el 9 no existen y están en medio de la partida").
const SUITS = ["🪙", "🍷", "⚔️", "🌳"]; // Oro, Copa, Espada, Basto
const RANKS = [
  { label: "1", value: 1 }, { label: "2", value: 2 }, { label: "3", value: 3 },
  { label: "4", value: 4 }, { label: "5", value: 5 }, { label: "6", value: 6 },
  { label: "7", value: 7 }, { label: "10", value: 8 }, { label: "11", value: 9 },
  { label: "12", value: 10 },
];

function secureRandomInt(maxExclusive) {
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  let buf;
  do {
    buf = crypto.randomBytes(4).readUInt32BE(0);
  } while (buf >= limit);
  return buf % maxExclusive;
}

function freshDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank: rank.label, value: rank.value });
    }
  }
  // Fisher-Yates con RNG criptográficamente seguro
  for (let i = deck.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

module.exports = { freshDeck, SUITS, RANKS };
