"use strict";
const crypto = require("crypto");

// Rueda europea — un solo cero, 37 casillas, orden físico real
const WHEEL_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const PAYOUTS = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  line: 5,
  column: 2,
  dozen: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
};

function getColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

// RNG seguro de servidor — fuente única de verdad, el cliente nunca decide el resultado
function secureRandomInt(maxExclusive) {
  // Rechaza valores fuera de rango para evitar sesgo de módulo
  const range = maxExclusive;
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % range);
  let buf;
  do {
    buf = crypto.randomBytes(4).readUInt32BE(0);
  } while (buf >= limit);
  return buf % range;
}

function spin() {
  const idx = secureRandomInt(WHEEL_NUMBERS.length);
  const number = WHEEL_NUMBERS[idx];
  return { number, color: getColor(number), idx, wheelLength: WHEEL_NUMBERS.length };
}

// Valida que una apuesta tenga forma correcta y números coherentes con su tipo
function validateBet(bet) {
  if (!bet || typeof bet !== "object") return false;
  if (typeof bet.amount !== "number" || !Number.isFinite(bet.amount) || bet.amount <= 0) return false;
  if (!Array.isArray(bet.numbers) || bet.numbers.length === 0) return false;
  if (!PAYOUTS[bet.type]) return false;
  const validNums = bet.numbers.every(
    (n) => n === 0 || (typeof n === "number" && n >= 1 && n <= 36)
  );
  if (!validNums) return false;

  const expectedCounts = {
    straight: 1, split: 2, street: 3, corner: 4, line: 6,
    column: 12, dozen: 12, red: 18, black: 18, even: 18, odd: 18, low: 18, high: 18,
  };
  if (bet.numbers.length !== expectedCounts[bet.type]) return false;
  return true;
}

function settleBets(bets, resultNumber) {
  return bets.map((bet) => {
    const win = bet.numbers.includes(resultNumber);
    const payout = win ? bet.amount * PAYOUTS[bet.type] : -bet.amount;
    return { bet, win, payout };
  });
}

module.exports = {
  WHEEL_NUMBERS,
  RED_NUMBERS,
  PAYOUTS,
  getColor,
  spin,
  validateBet,
  settleBets,
};
