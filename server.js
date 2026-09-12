const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/player", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

/**
 * Las salas viven en memoria.
 * Para producción a gran escala conviene sustituir esto por Redis/DB.
 *
 * room = {
 *   code,
 *   adminSocketId,
 *   roundNumber,
 *   roundActive,
 *   roundStartedAtNs,
 *   roundStartedAtEpochMs,
 *   results,
 *   history,
 *   players: Map(playerId, { id, name, socketId, connected, pressedRound })
 * }
 */
const rooms = new Map();

function generateRoomCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function makePlayerId() {
  return crypto.randomUUID();
}

function safeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

function getPublicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected
  }));
}

function getRoundPayload(room) {
  return {
    code: room.code,
    roundNumber: room.roundNumber,
    roundActive: room.roundActive,
    startedAtEpochMs: room.roundStartedAtEpochMs,
    results: room.results,
    players: getPublicPlayers(room),
    history: room.history
  };
}

function emitRoomState(room) {
  io.to(room.code).emit("room:state", getRoundPayload(room));
}

function closeRoundToHistory(room) {
  if (!room.roundStartedAtEpochMs) return;
  if (room.results.length === 0 && !room.roundActive) return;

  const existing = room.history.find((h) => h.roundNumber === room.roundNumber);
  if (existing) return;

  room.history.push({
    roundNumber: room.roundNumber,
    startedAtEpochMs: room.roundStartedAtEpochMs,
    endedAtEpochMs: Date.now(),
    results: room.results.map((r) => ({ ...r }))
  });

  // Limita historial en memoria.
  if (room.history.length > 100) room.history.shift();
}

io.on("connection", (socket) => {
  socket.on("admin:createRoom", (callback = () => {}) => {
    const code = generateRoomCode();

    const room = {
      code,
      adminSocketId: socket.id,
      roundNumber: 0,
      roundActive: false,
      roundStartedAtNs: null,
      roundStartedAtEpochMs: null,
      results: [],
      history: [],
      players: new Map()
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.role = "admin";
    socket.data.roomCode = code;

    callback({ ok: true, code, state: getRoundPayload(room) });
    emitRoomState(room);
  });

  socket.on("admin:resumeRoom", ({ code }, callback = () => {}) => {
    code = String(code || "").trim();
    const room = rooms.get(code);

    if (!room) {
      callback({ ok: false, message: "La sala ya no existe en el servidor." });
      return;
    }

    room.adminSocketId = socket.id;
    socket.join(code);
    socket.data.role = "admin";
    socket.data.roomCode = code;

    callback({ ok: true, code, state: getRoundPayload(room) });
    emitRoomState(room);
  });

  socket.on("admin:startRound", ({ code }, callback = () => {}) => {
    const room = rooms.get(String(code || ""));
    if (!room || room.adminSocketId !== socket.id) {
      callback({ ok: false, message: "No tienes control de esta sala." });
      return;
    }

    if (room.roundActive) {
      callback({ ok: false, message: "La ronda ya está activa." });
      return;
    }

    closeRoundToHistory(room);

    room.roundNumber += 1;
    room.roundActive = true;
    room.roundStartedAtNs = process.hrtime.bigint();
    room.roundStartedAtEpochMs = Date.now();
    room.results = [];

    for (const player of room.players.values()) {
      player.pressedRound = null;
    }

    io.to(code).emit("round:started", {
      roundNumber: room.roundNumber,
      startedAtEpochMs: room.roundStartedAtEpochMs
    });

    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("admin:resetRound", ({ code }, callback = () => {}) => {
    const room = rooms.get(String(code || ""));
    if (!room || room.adminSocketId !== socket.id) {
      callback({ ok: false, message: "No tienes control de esta sala." });
      return;
    }

    closeRoundToHistory(room);

    room.roundActive = false;
    room.roundStartedAtNs = null;
    room.roundStartedAtEpochMs = null;
    room.results = [];

    for (const player of room.players.values()) {
      player.pressedRound = null;
    }

    io.to(code).emit("round:reset", {
      roundNumber: room.roundNumber
    });

    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("admin:clearHistory", ({ code }, callback = () => {}) => {
    const room = rooms.get(String(code || ""));
    if (!room || room.adminSocketId !== socket.id) {
      callback({ ok: false, message: "No tienes control de esta sala." });
      return;
    }

    room.history = [];
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("player:join", ({ code, name, playerId }, callback = () => {}) => {
    code = String(code || "").trim();
    name = safeName(name);

    if (!rooms.has(code)) {
      callback({ ok: false, message: "No existe una sala con ese código." });
      return;
    }

    if (!name) {
      callback({ ok: false, message: "Escribe tu nombre." });
      return;
    }

    const room = rooms.get(code);
    let player = playerId ? room.players.get(playerId) : null;

    if (player) {
      player.name = name;
      player.socketId = socket.id;
      player.connected = true;
    } else {
      // Evita dos jugadores activos con el mismo nombre.
      const duplicate = [...room.players.values()].find(
        (p) => p.connected && p.name.toLowerCase() === name.toLowerCase()
      );

      if (duplicate) {
        callback({
          ok: false,
          message: "Ese nombre ya está siendo usado en la sala."
        });
        return;
      }

      player = {
        id: makePlayerId(),
        name,
        socketId: socket.id,
        connected: true,
        pressedRound: null
      };
      room.players.set(player.id, player);
    }

    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    const existingResult = room.results.find((r) => r.playerId === player.id);

    callback({
      ok: true,
      playerId: player.id,
      player: { id: player.id, name: player.name },
      state: getRoundPayload(room),
      result: existingResult || null
    });

    emitRoomState(room);
  });

  socket.on("player:press", ({ code, playerId, roundNumber }, callback = () => {}) => {
    const room = rooms.get(String(code || ""));
    if (!room) {
      callback({ ok: false, message: "La sala ya no existe." });
      return;
    }

    const player = room.players.get(playerId);
    if (!player || player.socketId !== socket.id) {
      callback({ ok: false, message: "Jugador no válido." });
      return;
    }

    if (!room.roundActive) {
      callback({ ok: false, message: "La ronda todavía no está activa." });
      return;
    }

    if (roundNumber !== room.roundNumber) {
      callback({ ok: false, message: "La ronda cambió. Sincronizando..." });
      return;
    }

    if (player.pressedRound === room.roundNumber) {
      const prior = room.results.find((r) => r.playerId === player.id);
      callback({ ok: true, duplicate: true, result: prior });
      return;
    }

    // El servidor decide el instante de llegada.
    const arrivedAtNs = process.hrtime.bigint();
    const elapsedMs = Number(arrivedAtNs - room.roundStartedAtNs) / 1_000_000;
    const position = room.results.length + 1;

    player.pressedRound = room.roundNumber;

    const result = {
      position,
      playerId: player.id,
      playerName: player.name,
      elapsedMs,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
      serverReceivedAtEpochMs: Date.now()
    };

    room.results.push(result);

    io.to(code).emit("round:result", result);
    emitRoomState(room);

    callback({ ok: true, result });
  });

  socket.on("disconnect", () => {
    const { role, roomCode, playerId } = socket.data || {};
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === "player" && playerId) {
      const player = room.players.get(playerId);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        emitRoomState(room);
      }
    }

    if (role === "admin" && room.adminSocketId === socket.id) {
      room.adminSocketId = null;
      io.to(roomCode).emit("admin:disconnected");
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(`Administrador: http://localhost:${PORT}/admin`);
  console.log(`Jugador:       http://localhost:${PORT}/player`);
});
