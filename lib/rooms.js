"use strict";
const crypto = require("crypto");
const { createIntermedioState } = require("./intermedio");

const STARTING_BALANCE = Number(process.env.STARTING_BALANCE ?? 0);
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1 ambiguos

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)];
  }
  return code;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // playerId -> { id, name, avatar, balance, isAdmin, socketId, connected }
    this.game = "lobby"; // lobby | roulette | intermedio
    this.createdAt = Date.now();

    this.roulette = {
      phase: "waiting", // waiting | betting | spinning | settled
      bets: new Map(), // playerId -> [{id,type,numbers,amount,label}]
      history: [],
      countdownEndsAt: null,
      lastResult: null,
      lastPayouts: null,
    };

    this.intermedio = createIntermedioState();

    // Registro de jugadores que salieron/fueron eliminados, con el saldo que
    // tenían en ese momento. Permite que el admin les devuelva ese saldo a
    // mano si vuelven a entrar (p. ej. se les cerró la sesión por accidente).
    this.departed = [];
  }

  playerList() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      balance: p.balance,
      isAdmin: p.isAdmin,
      connected: p.connected,
    }));
  }

  recordDeparture(player, reason) {
    this.departed.unshift({
      id: crypto.randomUUID(),
      name: player.name,
      avatar: player.avatar,
      balance: player.balance,
      reason, // "salió" | "eliminado"
      ts: Date.now(),
    });
    this.departed = this.departed.slice(0, 30);
  }

  isEmpty() {
    return this.players.size === 0;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom() {
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || "").toUpperCase());
  }

  removeRoomIfEmpty(code) {
    const room = this.rooms.get(code);
    if (room && room.isEmpty()) this.rooms.delete(code);
  }

  addPlayer(room, { name, avatar, isAdmin, socketId, playerId }) {
    const id = playerId || crypto.randomUUID();
    const player = {
      id,
      name: String(name).slice(0, 24),
      avatar: avatar || "🎩",
      balance: STARTING_BALANCE,
      isAdmin: !!isAdmin,
      socketId,
      connected: true,
    };
    room.players.set(id, player);
    return player;
  }
}

module.exports = { RoomManager, STARTING_BALANCE };
