"use strict";
require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { RoomManager } = require("./lib/rooms");
const roulette = require("./lib/roulette");
const intermedio = require("./lib/intermedio");
const nueve = require("./lib/nueve");

const PORT = Number(process.env.PORT || 3402);
const APP_URL = process.env.APP_URL || "http://localhost:3402";
const ADMIN_PIN = process.env.ADMIN_PIN || "";
const BET_WINDOW_MS = 30000;

if (!ADMIN_PIN) {
  console.warn("[ADVERTENCIA] No configuraste ADMIN_PIN en .env — nadie podrá entrar como administrador.");
}

const app = express();

// ── Security headers (Helmet + CSP estricta) ────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    frameguard: { action: "deny" }, // X-Frame-Options: DENY
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    noSniff: true, // X-Content-Type-Options: nosniff
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);

// ── CORS estricto: solo el dominio oficial de la app ───────────────────────
const corsOptions = {
  origin(origin, callback) {
    // Peticiones sin Origin (mismo servidor, curl interno) se permiten;
    // cualquier origen externo (Postman con Origin falso, otros dominios) se bloquea.
    if (!origin || origin === APP_URL) return callback(null, true);
    return callback(new Error("CORS: origen no permitido"));
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: "32kb" }));

// Sin caché: evita que navegadores o el CDN del hosting sirvan una versión
// vieja de la app después de actualizar el código (problema recurrente).
app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.set("Cache-Control", "no-store"),
  })
);

app.get("/healthz", (req, res) => res.json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: APP_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 16 * 1024,
});

const roomManager = new RoomManager();

// socketId -> { roomCode, playerId }
const socketIndex = new Map();

function emitRoomState(room) {
  io.to(room.code).emit("room:state", {
    code: room.code,
    game: room.game,
    players: room.playerList(),
    departed: room.departed,
  });
}

function serializeBets(room) {
  const out = {};
  for (const [playerId, bets] of room.roulette.bets.entries()) {
    out[playerId] = bets;
  }
  return out;
}

function emitRouletteState(room) {
  io.to(room.code).emit("roulette:state", {
    phase: room.roulette.phase,
    countdownEndsAt: room.roulette.countdownEndsAt,
    bets: serializeBets(room),
    history: room.roulette.history,
    lastResult: room.roulette.lastResult,
    lastPayouts: room.roulette.lastPayouts,
  });
}

function emitIntermedioState(room) {
  const st = room.intermedio;
  io.to(room.code).emit("intermedio:state", {
    phase: st.phase,
    pot: st.pot,
    ante: st.ante,
    turnOrder: st.turnOrder,
    turnIndex: st.turnIndex,
    currentPlayerId: intermedio.currentPlayerId(st),
    currentCards: st.currentCards,
    thirdCard: st.thirdCard,
    currentBet: st.currentBet,
    forcedSkip: st.forcedSkip,
    isPair: st.isPair,
    log: st.log,
  });
}

function emitNueveState(room) {
  const st = room.nueve;
  io.to(room.code).emit("nueve:state", {
    phase: st.phase,
    pot: st.pot,
    ante: st.ante,
    turnOrder: st.turnOrder,
    turnIndex: st.turnIndex,
    currentPlayerId: nueve.currentPlayerId(st),
    hands: st.hands,
    tiebreakRound: st.tiebreakRound,
    lastWinner: st.lastWinner,
    log: st.log,
  });
}

function requireRoom(socket) {
  const idx = socketIndex.get(socket.id);
  if (!idx) return null;
  const room = roomManager.getRoom(idx.roomCode);
  if (!room) return null;
  return { room, playerId: idx.playerId };
}

function requireAdmin(socket) {
  const ctx = requireRoom(socket);
  if (!ctx) return null;
  const player = ctx.room.players.get(ctx.playerId);
  if (!player || !player.isAdmin) return null;
  return ctx;
}

io.on("connection", (socket) => {
  // ── Hub: crear sala ────────────────────────────────────────────────────
  socket.on("hub:create_room", ({ name, avatar, pin }, cb) => {
    try {
      if (typeof cb !== "function") return;
      if (!name || !String(name).trim()) return cb({ ok: false, error: "Nombre requerido." });
      const isAdmin = !!pin && pin === ADMIN_PIN;
      if (!isAdmin) return cb({ ok: false, error: "PIN de administrador incorrecto." });

      const room = roomManager.createRoom();
      const player = roomManager.addPlayer(room, {
        name, avatar, isAdmin: true, socketId: socket.id,
      });

      socket.join(room.code);
      socketIndex.set(socket.id, { roomCode: room.code, playerId: player.id });

      cb({ ok: true, roomCode: room.code, player, players: room.playerList() });
      emitRoomState(room);
    } catch (err) {
      console.error(err);
      cb({ ok: false, error: "Error interno creando la sala." });
    }
  });

  // ── Hub: unirse a sala existente ──────────────────────────────────────
  socket.on("hub:join_room", ({ roomCode, name, avatar, pin, playerId }, cb) => {
    try {
      if (typeof cb !== "function") return;
      const room = roomManager.getRoom(roomCode);
      if (!room) return cb({ ok: false, error: "Código de sala inválido." });
      if (!name || !String(name).trim()) return cb({ ok: false, error: "Nombre requerido." });

      // Reconexión: si manda un playerId que ya existe en la sala, lo recupera (mismo saldo)
      let player = playerId && room.players.get(playerId);
      if (player) {
        player.connected = true;
        player.socketId = socket.id;
      } else {
        const wantsAdmin = !!pin && pin === ADMIN_PIN;
        player = roomManager.addPlayer(room, {
          name, avatar, isAdmin: wantsAdmin, socketId: socket.id,
        });
      }

      socket.join(room.code);
      socketIndex.set(socket.id, { roomCode: room.code, playerId: player.id });

      cb({
        ok: true,
        roomCode: room.code,
        player,
        players: room.playerList(),
        game: room.game,
      });
      emitRoomState(room);
      socket.emit("roulette:state", null); // el cliente pedirá estado completo tras unirse
      emitRouletteState(room);
      emitIntermedioState(room);
      emitNueveState(room);
    } catch (err) {
      console.error(err);
      cb({ ok: false, error: "Error interno uniéndose a la sala." });
    }
  });

  // ── Hub: seleccionar juego activo (cualquier jugador puede navegar; el estado es compartido) ──
  socket.on("hub:select_game", ({ game }) => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    if (!["lobby", "roulette", "intermedio", "nueve"].includes(game)) return;
    ctx.room.game = game;
    emitRoomState(ctx.room);
  });

  // ── Admin: recargar / bajar saldo ─────────────────────────────────────
  socket.on("admin:reload", ({ playerId, amount }) => {
    const ctx = requireAdmin(socket);
    if (!ctx) return socket.emit("error:toast", "Solo el administrador puede recargar fichas.");
    const target = ctx.room.players.get(playerId);
    amount = Math.floor(Number(amount));
    if (!target || !Number.isFinite(amount) || amount <= 0) return;
    target.balance += amount;
    emitRoomState(ctx.room);
  });

  socket.on("admin:deduct", ({ playerId, amount }) => {
    const ctx = requireAdmin(socket);
    if (!ctx) return socket.emit("error:toast", "Solo el administrador puede bajar saldo.");
    const target = ctx.room.players.get(playerId);
    amount = Math.floor(Number(amount));
    if (!target || !Number.isFinite(amount) || amount <= 0) return;
    target.balance = Math.max(0, target.balance - amount);
    emitRoomState(ctx.room);
  });

  // ══════════════════════════ RULETA ══════════════════════════════════════
  socket.on("roulette:start_round", () => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    const r = ctx.room.roulette;
    if (r.phase === "betting" || r.phase === "spinning") return;

    r.phase = "betting";
    r.bets = new Map();
    r.countdownEndsAt = Date.now() + BET_WINDOW_MS;
    emitRouletteState(ctx.room);

    clearTimeout(ctx.room.roulette._timer);
    ctx.room.roulette._timer = setTimeout(() => doSpin(ctx.room), BET_WINDOW_MS);
  });

  socket.on("roulette:place_bet", (bet) => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const r = ctx.room.roulette;
    if (r.phase !== "betting") return socket.emit("error:toast", "Las apuestas no están abiertas.");
    if (!roulette.validateBet(bet)) return socket.emit("error:toast", "Apuesta inválida.");

    const player = ctx.room.players.get(ctx.playerId);
    if (!player) return;

    const existing = r.bets.get(ctx.playerId) || [];
    const totalPending = existing.reduce((s, b) => s + b.amount, 0);
    if (totalPending + bet.amount > player.balance) {
      return socket.emit("error:toast", "No tienes saldo suficiente para esa apuesta.");
    }

    const merged = existing.find((b) => b.id === bet.id);
    if (merged) merged.amount += bet.amount;
    else existing.push({ ...bet });
    r.bets.set(ctx.playerId, existing);

    emitRouletteState(ctx.room);
    io.to(ctx.room.code).emit("roulette:feed", {
      name: player.name, avatar: player.avatar, label: bet.label, amount: bet.amount, ts: Date.now(),
    });
  });

  socket.on("roulette:clear_bets", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const r = ctx.room.roulette;
    if (r.phase !== "betting") return;
    r.bets.delete(ctx.playerId);
    emitRouletteState(ctx.room);
  });

  socket.on("roulette:repeat_last", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const r = ctx.room.roulette;
    if (r.phase !== "betting") return;
    const last = r.lastBetsByPlayer && r.lastBetsByPlayer.get(ctx.playerId);
    if (!last || last.length === 0) return;
    r.bets.set(ctx.playerId, last.map((b) => ({ ...b })));
    emitRouletteState(ctx.room);
  });

  socket.on("roulette:double", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const r = ctx.room.roulette;
    if (r.phase !== "betting") return;
    const player = ctx.room.players.get(ctx.playerId);
    const base = r.bets.get(ctx.playerId) || r.lastBetsByPlayer?.get(ctx.playerId) || [];
    if (base.length === 0) return;
    const doubled = base.map((b) => ({ ...b, amount: b.amount * 2 }));
    const total = doubled.reduce((s, b) => s + b.amount, 0);
    if (total > player.balance) return socket.emit("error:toast", "No tienes saldo suficiente para redoblar.");
    r.bets.set(ctx.playerId, doubled);
    emitRouletteState(ctx.room);
  });

  socket.on("roulette:force_spin", () => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    if (ctx.room.roulette.phase !== "betting") return;
    clearTimeout(ctx.room.roulette._timer);
    doSpin(ctx.room);
  });

  // ══════════════════════════ INTERMEDIO ══════════════════════════════════
  socket.on("intermedio:start_round", (payload) => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    const room = ctx.room;
    const playerIds = Array.from(room.players.keys());
    const customAnte = payload && payload.ante !== undefined ? payload.ante : undefined;
    const result = intermedio.startRound(room.intermedio, room.players, playerIds, customAnte);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(room);
    emitIntermedioState(room);
    scheduleAutoSkipIfNeeded(room);
  });

  socket.on("intermedio:place_bet", ({ amount }) => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const result = intermedio.placeBet(ctx.room.intermedio, ctx.room.players, ctx.playerId, amount);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitIntermedioState(ctx.room);
  });

  socket.on("intermedio:skip_turn", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    if (intermedio.currentPlayerId(ctx.room.intermedio) !== ctx.playerId && !ctx.room.players.get(ctx.playerId)?.isAdmin) return;
    const result = intermedio.skipTurn(ctx.room.intermedio);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(ctx.room);
    emitIntermedioState(ctx.room);
    scheduleAutoSkipIfNeeded(ctx.room);
  });

  socket.on("intermedio:reveal", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    if (intermedio.currentPlayerId(ctx.room.intermedio) !== ctx.playerId) return;
    const result = intermedio.revealThird(ctx.room.intermedio, ctx.room.players);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(ctx.room);
    emitIntermedioState(ctx.room);
  });

  socket.on("intermedio:next_turn", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const result = intermedio.nextTurn(ctx.room.intermedio);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(ctx.room);
    emitIntermedioState(ctx.room);
    scheduleAutoSkipIfNeeded(ctx.room);
  });

  // Si las dos cartas repartidas son consecutivas (no hay número "en medio"),
  // nadie puede apostar — el servidor avanza solo al siguiente turno tras una
  // pausa breve para que se llegue a leer el aviso en pantalla.
  function scheduleAutoSkipIfNeeded(room) {
    clearTimeout(room.intermedio._autoSkipTimer);
    if (room.intermedio.phase !== "turn" || !room.intermedio.forcedSkip) return;
    room.intermedio._autoSkipTimer = setTimeout(() => {
      const result = intermedio.skipTurn(room.intermedio);
      if (!result.ok) return;
      emitRoomState(room);
      emitIntermedioState(room);
      scheduleAutoSkipIfNeeded(room); // por si la siguiente mano también es consecutiva
    }, 2800);
  }

  // ══════════════════════════ "9" ══════════════════════════════════════════
  socket.on("nueve:start_round", (payload) => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    const room = ctx.room;
    const playerIds = Array.from(room.players.keys());
    const customAnte = payload && payload.ante !== undefined ? payload.ante : undefined;
    const result = nueve.startRound(room.nueve, room.players, playerIds, customAnte);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(room);
    emitNueveState(room);
  });

  socket.on("nueve:hit", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const result = nueve.hit(ctx.room.nueve, ctx.room.players, ctx.playerId);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(ctx.room);
    emitNueveState(ctx.room);
  });

  socket.on("nueve:stand", () => {
    const ctx = requireRoom(socket);
    if (!ctx) return;
    const result = nueve.stand(ctx.room.nueve, ctx.room.players, ctx.playerId);
    if (!result.ok) return socket.emit("error:toast", result.error);
    emitRoomState(ctx.room);
    emitNueveState(ctx.room);
  });

  // ── Salir de la sala (cualquier jugador, voluntario) ───────────────────
  socket.on("room:leave_room", (_data, cb) => {
    const ctx = requireRoom(socket);
    if (!ctx) return typeof cb === "function" && cb({ ok: false });
    const { room, playerId } = ctx;
    const player = room.players.get(playerId);
    if (player) room.recordDeparture(player, "salió");
    room.players.delete(playerId);
    socket.leave(room.code);
    socketIndex.delete(socket.id);
    emitRoomState(room);
    roomManager.removeRoomIfEmpty(room.code);
    if (typeof cb === "function") cb({ ok: true });
  });

  // ── Admin: eliminar a un jugador de la sala ────────────────────────────
  socket.on("admin:kick_player", ({ playerId }) => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    if (playerId === ctx.playerId) return; // el admin se va con "salir" o "cerrar sala", no con esto
    const target = ctx.room.players.get(playerId);
    if (!target) return;

    const targetSocket = io.sockets.sockets.get(target.socketId);
    if (targetSocket) {
      targetSocket.emit("room:kicked");
      targetSocket.leave(ctx.room.code);
      socketIndex.delete(targetSocket.id);
    }
    ctx.room.recordDeparture(target, "eliminado");
    ctx.room.players.delete(playerId);
    emitRoomState(ctx.room);
  });

  // ── Admin: marca como "ya pagado" un registro de jugador que se fue ─────
  socket.on("admin:clear_departed", ({ id }) => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    ctx.room.departed = ctx.room.departed.filter((d) => d.id !== id);
    emitRoomState(ctx.room);
  });

  // ── Admin: cerrar la sala completa para todos ──────────────────────────
  socket.on("admin:close_room", () => {
    const ctx = requireAdmin(socket);
    if (!ctx) return;
    const room = ctx.room;

    for (const player of room.players.values()) {
      const playerSocket = io.sockets.sockets.get(player.socketId);
      if (playerSocket) {
        playerSocket.emit("room:closed");
        playerSocket.leave(room.code);
        socketIndex.delete(playerSocket.id);
      }
    }
    clearTimeout(room.roulette._timer);
    clearTimeout(room.intermedio._autoSkipTimer);
    roomManager.rooms.delete(room.code);
  });

  // ── Desconexión ─────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const idx = socketIndex.get(socket.id);
    socketIndex.delete(socket.id);
    if (!idx) return;
    const room = roomManager.getRoom(idx.roomCode);
    if (!room) return;
    const player = room.players.get(idx.playerId);
    if (player) player.connected = false;
    emitRoomState(room);

    // Da 5 minutos de gracia para reconectar con el mismo playerId (recupera
    // el saldo automáticamente). Si no vuelve, se guarda en "departed" con su
    // saldo exacto para que el admin pueda restituirlo a mano si reaparece
    // como jugador nuevo (p. ej. se le cerró la sesión sin querer).
    setTimeout(() => {
      const stillThere = room.players.get(idx.playerId);
      if (stillThere && !stillThere.connected) {
        room.recordDeparture(stillThere, "se desconectó");
        room.players.delete(idx.playerId);
        emitRoomState(room);
        roomManager.removeRoomIfEmpty(room.code);
      }
    }, 5 * 60 * 1000);
  });
});

function doSpin(room) {
  const r = room.roulette;
  r.phase = "spinning";
  const result = roulette.spin();
  io.to(room.code).emit("roulette:spin", result);

  // Guarda copia de apuestas para "repetir" antes de liquidar
  r.lastBetsByPlayer = new Map(r.bets);

  setTimeout(() => {
    const payoutsByPlayer = {};
    for (const [playerId, bets] of r.bets.entries()) {
      const player = room.players.get(playerId);
      if (!player) continue;
      const settled = roulette.settleBets(bets, result.number);
      const net = settled.reduce((s, x) => s + x.payout, 0);
      player.balance = Math.max(0, player.balance + net);
      payoutsByPlayer[playerId] = settled.map((x) => ({
        label: x.bet.label, win: x.win, payout: x.payout,
      }));
    }

    r.phase = "settled";
    r.lastResult = result;
    r.lastPayouts = payoutsByPlayer;
    r.history.unshift({ number: result.number, color: result.color, ts: Date.now() });
    r.history = r.history.slice(0, 30);
    r.bets = new Map();
    r.countdownEndsAt = null;

    emitRoomState(room);
    emitRouletteState(room);
  }, 7000); // tiempo de animación de la rueda en el cliente
}

server.listen(PORT, () => {
  console.log(`🎰 TODO YAMBA corriendo en ${APP_URL} (puerto ${PORT})`);
});
