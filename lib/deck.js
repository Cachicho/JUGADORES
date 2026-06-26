"use strict";
const crypto = require("crypto");

const SUITS = ["🪙", "🍷", "⚔️", "🌳"]; // Oro, Copa, Espada, Basto

function secureRandomInt(maxExclusive) {
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  let buf;
  do {
    buf = crypto.randomBytes(4).readUInt32BE(0);
  } while (buf >= limit);
  return buf % maxExclusive;
}

/** Fisher-Yates con RNG criptográficamente seguro — reutilizado por todos los mazos. */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Construye y mezcla un mazo a partir de palos y definiciones de rango ({label, value, ...extra}). */
function buildDeck(suits, rankDefs) {
  const deck = [];
  for (const suit of suits) {
    for (const def of rankDefs) {
      const { label, ...rest } = def;
      deck.push({ suit, rank: label, ...rest });
    }
  }
  return shuffle(deck);
}

// ── Mazo de truco (usado por Intermedio): 4 palos, sin 8 ni 9 (40 cartas).
// `value` queda reindexado de forma SECUENCIAL (1..10) para que la lógica de
// "está en medio" del Intermedio funcione bien sin tratar el 8/9 como un hueco:
// el 7 y el 10 quedan en valores consecutivos (7 y 8), exactamente como pide
// el juego ("el 8 y el 9 no existen y están en medio de la partida").
const RANKS = [
  { label: "1", value: 1 }, { label: "2", value: 2 }, { label: "3", value: 3 },
  { label: "4", value: 4 }, { label: "5", value: 5 }, { label: "6", value: 6 },
  { label: "7", value: 7 }, { label: "10", value: 8 }, { label: "11", value: 9 },
  { label: "12", value: 10 },
];
function freshDeck() {
  return buildDeck(SUITS, RANKS);
}

// ── Mazo español real (usado por "9"): 4 palos, 10 cartas cada uno (40 cartas).
// As=1, 2-7=su valor, Sota/Caballo/Rey=0 y marcadas isFigure=true ("negras"
// para las reglas del juego, sin relación con el color real de la carta).
const RANKS_NUEVE = [
  { label: "As", value: 1, isFigure: false },
  { label: "2", value: 2, isFigure: false },
  { label: "3", value: 3, isFigure: false },
  { label: "4", value: 4, isFigure: false },
  { label: "5", value: 5, isFigure: false },
  { label: "6", value: 6, isFigure: false },
  { label: "7", value: 7, isFigure: false },
  { label: "Sota", value: 0, isFigure: true },
  { label: "Caballo", value: 0, isFigure: true },
  { label: "Rey", value: 0, isFigure: true },
];
function freshNueveDeck() {
  return buildDeck(SUITS, RANKS_NUEVE);
}

module.exports = { freshDeck, freshNueveDeck, shuffle, buildDeck, SUITS, RANKS, RANKS_NUEVE };
