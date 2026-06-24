"use strict";
const crypto = require("crypto");

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [
  { label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 },
  { label: "5", value: 5 }, { label: "6", value: 6 }, { label: "7", value: 7 },
  { label: "8", value: 8 }, { label: "9", value: 9 }, { label: "10", value: 10 },
  { label: "J", value: 11 }, { label: "Q", value: 12 }, { label: "K", value: 13 },
  { label: "A", value: 14 },
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
