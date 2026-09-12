const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;
const COUNTDOWN_SECONDS = 3;

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/player", (_req, res) => res.sendFile(path.join(__dirname, "public", "player.html")));

app.get("/api/qr", async (req, res) => {
  try {
    const room = String(req.query.room || "").trim();
    if (!room) return res.status(400).send("Falta el código de sala.");

    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol = forwardedProto ? String(forwardedProto).split(",")[0] : req.protocol;
    const host = req.get("host");
    const playerUrl = `${protocol}://${host}/player?room=${encodeURIComponent(room)}`;

    const svg = await QRCode.toString(playerUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 260
    });

    res.type("image/svg+xml").send(svg);
  } catch (error) {
    console.error("QR error:", error);
    res.status(500).send("No se pudo generar el QR.");
  }
});

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
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
}

function getPublicPlayers(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, connected: p.connected }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getRoundPayload(room) {
  return {
    code: room.code,
    roundNumber: room.roundNumber,
    roundActive: room.roundActive,
    countdownActive: room.countdownActive,
    countdownEndsAtEpochMs: room.countdownEndsAtEpochMs,
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
  const exists = room.history.some((h) => h.roundNumber === room.roundNumber);
  if (exists) return;

  room.history.push({
    roundNumber: room.roundNumber,
    startedAtEpochMs: room.roundStartedAtEpochMs,
    endedAtEpochMs: Date.now(),
    results: room.results.map((r) => ({ ...r }))
  });

  if (room.history.length > 100) room.history.shift();
}

function cancelCountdown(room) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  room.countdownActive = false;
  room.countdownEndsAtEpochMs = null;
}

function activateRound(room) {
  room.countdownTimer = null;
  room.countdownActive = false;
  room.countdownEndsAtEpochMs = null;
  room.roundActive = true;
  room.roundStartedAtNs = process.hrtime.bigint();
  room.roundStartedAtEpochMs = Date.now();

  io.to(room.code).emit("round:started", {
    roundNumber: room.roundNumber,
    startedAtEpochMs: room.roundStartedAtEpochMs
  });
  emitRoomState(room);
}

io.on("connection", (socket) => {
  socket.on("admin:createRoom", (callback = () => {}) => {
    const code = generateRoomCode();
    const room = {
      code,
      adminSocketId: socket.id,
      roundNumber: 0,
      roundActive: false,
      countdownActive: false,
      countdownEndsAtEpochMs: null,
      countdownTimer: null,
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
    if (!room) return callback({ ok: false, message: "La sala ya no existe en el servidor." });

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
      return callback({ ok: false, message: "No tienes control de esta sala." });
    }
    if (room.roundActive || room.countdownActive) {
      return callback({ ok: false, message: "Ya hay una ronda activa o iniciándose." });
    }

    closeRoundToHistory(room);
    room.roundNumber += 1;
    room.results = [];
    room.roundActive = false;
    room.roundStartedAtNs = null;
    room.roundStartedAtEpochMs = null;
    room.countdownActive = true;
    room.countdownEndsAtEpochMs = Date.now() + COUNTDOWN_SECONDS * 1000;

    for (const player of room.players.values()) player.pressedRound = null;

    io.to(code).emit("round:countdown", {
      roundNumber: room.roundNumber,
      seconds: COUNTDOWN_SECONDS,
      endsAtEpochMs: room.countdownEndsAtEpochMs
    });
    emitRoomState(room);

    room.countdownTimer = setTimeout(() => activateRound(room), COUNTDOWN_SECONDS * 1000);
    callback({ ok: true });
  });

  socket.on("admin:resetRound", ({ code }, callback = () => {}) => {
    const room = rooms.get(String(code || ""));
    if (!room || room.adminSocketId !== socket.id) {
      return callback({ ok: false, message: "No tienes control de esta sala." });
    }

    if (room.roundActive) closeRoundToHistory(room);
    cancelCountdown(room);
    room.roundActive = false;
    room.roundStartedAtNs = null;
    room.roundStartedAtEpochMs = null;
    room.results = [];
    for (const player of room.players.values()) player.pressedRound = null;

    io.to(code).emit("round:reset", { roundNumber: room.roundNumber });
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("admin:clearHistory", ({ code }, callback = () => {}) => {
    const room = rooms.get(String(code || ""));
    if (!room || room.adminSocketId !== socket.id) {
      return callback({ ok: false, message: "No tienes control de esta sala." });
    }
    room.history = [];
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("player:join", ({ code, name, playerId }, callback = () => {}) => {
    code = String(code || "").trim();
    name = safeName(name);
    if (!rooms.has(code)) return callback({ ok: false, message: "No existe una sala con ese código." });
    if (!name) return callback({ ok: false, message: "Escribe tu nombre." });

    const room = rooms.get(code);
    let player = playerId ? room.players.get(playerId) : null;

    if (player) {
      player.name = name;
      player.socketId = socket.id;
      player.connected = true;
    } else {
      const duplicate = [...room.players.values()].find(
        (p) => p.connected && p.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) return callback({ ok: false, message: "Ese nombre ya está siendo usado en la sala." });

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
    if (!room) return callback({ ok: false, message: "La sala ya no existe." });

    const player = room.players.get(playerId);
    if (!player || player.socketId !== socket.id) return callback({ ok: false, message: "Jugador no válido." });
    if (!room.roundActive) return callback({ ok: false, message: "La ronda todavía no está activa." });
    if (roundNumber !== room.roundNumber) return callback({ ok: false, message: "La ronda cambió. Sincronizando..." });

    if (player.pressedRound === room.roundNumber) {
      const prior = room.results.find((r) => r.playerId === player.id);
      return callback({ ok: true, duplicate: true, result: prior });
    }

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
});
