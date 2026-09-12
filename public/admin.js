const socket = io();
const $ = (id) => document.getElementById(id);

const roomCodeEl = $("roomCode");
const startBtn = $("startBtn");
const resetBtn = $("resetBtn");
const copyBtn = $("copyBtn");
const soundBtn = $("soundBtn");
const clearHistoryBtn = $("clearHistoryBtn");
const roundStatus = $("roundStatus");
const resultsBody = $("resultsBody");
const resultsEmpty = $("resultsEmpty");
const playersEl = $("players");
const playerCount = $("playerCount");
const historyEl = $("history");
const toastEl = $("toast");
const countdownOverlay = $("countdownOverlay");
const countdownNumber = $("countdownNumber");
const podiumEl = $("podium");
const qrImage = $("qrImage");

let code = sessionStorage.getItem("adminRoomCode") || "";
let countdownInterval = null;
let lastCountdownValue = null;
let soundEnabled = true;
let audioCtx = null;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function medal(position) {
  if (position === 1) return "🥇 1.º";
  if (position === 2) return "🥈 2.º";
  if (position === 3) return "🥉 3.º";
  return `${position}.º`;
}

function ensureAudio() {
  if (!soundEnabled) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(frequency = 600, duration = 0.12, type = "sine", volume = 0.08) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playCountdownTick(value) {
  if (!soundEnabled) return;
  if (value > 0) tone(520 + (3 - value) * 70, 0.12, "sine", 0.08);
}

function playGoSound() {
  if (!soundEnabled) return;
  tone(900, 0.13, "square", 0.07);
  setTimeout(() => tone(1200, 0.22, "square", 0.07), 120);
}

function playResultSound(position) {
  if (!soundEnabled) return;
  const freq = position === 1 ? 1050 : position === 2 ? 850 : position === 3 ? 720 : 620;
  tone(freq, 0.14, "triangle", 0.06);
}

function renderPodium(results) {
  const top = [results[1], results[0], results[2]];
  const places = [
    { pos: 2, cls: "second", medal: "🥈" },
    { pos: 1, cls: "first", medal: "🥇" },
    { pos: 3, cls: "third", medal: "🥉" }
  ];

  podiumEl.innerHTML = places.map((place, index) => {
    const r = top[index];
    return `
      <div class="podium-place ${place.cls} ${r ? "filled" : ""}">
        <div class="podium-medal">${place.medal}</div>
        <strong>${place.pos}.º</strong>
        <span>${r ? escapeHtml(r.playerName) : "Esperando..."}</span>
        <small>${r ? `${r.elapsedSeconds.toFixed(3)} s` : "—"}</small>
      </div>
    `;
  }).join("");
}

function showCountdown(endsAt) {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = false;
  lastCountdownValue = null;

  const update = () => {
    const remainingMs = endsAt - Date.now();
    const remaining = Math.max(1, Math.ceil(remainingMs / 1000));
    countdownNumber.textContent = remaining;

    if (remaining !== lastCountdownValue && remainingMs > 0) {
      lastCountdownValue = remaining;
      playCountdownTick(remaining);
    }
  };

  update();
  countdownInterval = setInterval(update, 80);
}

function hideCountdown() {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = true;
  lastCountdownValue = null;
}

function updateQr() {
  if (!code) return;
  qrImage.src = `/api/qr?room=${encodeURIComponent(code)}&v=${Date.now()}`;
}

function render(state) {
  roomCodeEl.textContent = state.code;
  const connected = state.players.filter(p => p.connected);
  playerCount.textContent = `(${connected.length}/${state.players.length})`;

  playersEl.innerHTML = state.players.length ? "" : `<div class="empty">Esperando jugadores...</div>`;
  state.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <div class="player-identity">
        <span class="${p.connected ? "online" : "offline"}"></span>
        <span>${escapeHtml(p.name)}</span>
      </div>
      <span class="muted">${p.connected ? "Conectado" : "Desconectado"}</span>
    `;
    playersEl.appendChild(row);
  });

  renderPodium(state.results);

  resultsBody.innerHTML = "";
  resultsEmpty.style.display = state.results.length ? "none" : "block";
  state.results.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${medal(r.position)}</td><td>${escapeHtml(r.playerName)}</td><td>${r.elapsedSeconds.toFixed(3)} s</td>`;
    resultsBody.appendChild(tr);
  });

  if (state.countdownActive) {
    showCountdown(state.countdownEndsAtEpochMs);
    roundStatus.className = "status countdown-status";
    roundStatus.innerHTML = `<span class="dot"></span><span>Ronda ${state.roundNumber} iniciando...</span>`;
    startBtn.disabled = true;
    resetBtn.disabled = false;
  } else if (state.roundActive) {
    hideCountdown();
    roundStatus.className = "status live";
    roundStatus.innerHTML = `<span class="dot"></span><span>Ronda ${state.roundNumber} activa</span>`;
    startBtn.disabled = true;
    resetBtn.disabled = false;
  } else {
    hideCountdown();
    roundStatus.className = "status";
    roundStatus.innerHTML = `<span class="dot"></span><span>${state.roundNumber ? `Ronda ${state.roundNumber} en espera` : "Listo para comenzar"}</span>`;
    startBtn.disabled = false;
    resetBtn.disabled = false;
  }

  copyBtn.disabled = false;
  clearHistoryBtn.disabled = false;

  historyEl.innerHTML = state.history.length ? "" : `<div class="empty">Aún no hay rondas guardadas.</div>`;
  [...state.history].reverse().forEach(round => {
    const div = document.createElement("div");
    div.className = "history-item";
    const rows = round.results.length
      ? round.results.map(r => `<div class="history-line"><span>${medal(r.position)} ${escapeHtml(r.playerName)}</span><span>${r.elapsedSeconds.toFixed(3)} s</span></div>`).join("")
      : `<div class="muted">Sin pulsaciones</div>`;
    div.innerHTML = `<strong>Ronda ${round.roundNumber}</strong><div class="history-results">${rows}</div>`;
    historyEl.appendChild(div);
  });
}

function createRoom() {
  socket.emit("admin:createRoom", (res) => {
    if (!res.ok) return;
    code = res.code;
    sessionStorage.setItem("adminRoomCode", code);
    updateQr();
    render(res.state);
  });
}

function createOrResumeRoom() {
  if (!code) return createRoom();
  socket.emit("admin:resumeRoom", { code }, (res) => {
    if (res.ok) {
      updateQr();
      return render(res.state);
    }
    sessionStorage.removeItem("adminRoomCode");
    code = "";
    createRoom();
  });
}

socket.on("connect", createOrResumeRoom);
socket.on("room:state", state => { if (state.code === code) render(state); });
socket.on("round:countdown", ({ endsAtEpochMs }) => showCountdown(endsAtEpochMs));
socket.on("round:started", () => {
  hideCountdown();
  playGoSound();
});
socket.on("round:result", result => playResultSound(result.position));

startBtn.addEventListener("click", () => {
  ensureAudio();
  socket.emit("admin:startRound", { code }, res => {
    if (!res.ok) toast(res.message);
  });
});

resetBtn.addEventListener("click", () => {
  socket.emit("admin:resetRound", { code }, res => {
    if (!res.ok) toast(res.message);
  });
});

clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("¿Borrar el historial de rondas?")) return;
  socket.emit("admin:clearHistory", { code }, res => {
    if (!res.ok) toast(res.message);
  });
});

copyBtn.addEventListener("click", async () => {
  const url = `${location.origin}/player?room=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Enlace de jugador copiado.");
  } catch {
    prompt("Copia este enlace:", url);
  }
});

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? "🔊 Sonido: ON" : "🔇 Sonido: OFF";
  if (soundEnabled) {
    ensureAudio();
    tone(700, 0.1, "sine", 0.05);
  }
});
