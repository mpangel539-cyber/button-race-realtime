const socket = io();

const $ = (id) => document.getElementById(id);
const roomCodeEl = $("roomCode");
const startBtn = $("startBtn");
const resetBtn = $("resetBtn");
const copyBtn = $("copyBtn");
const resetScoresBtn = $("resetScoresBtn");
const clearHistoryBtn = $("clearHistoryBtn");
const roundStatus = $("roundStatus");
const resultsBody = $("resultsBody");
const resultsEmpty = $("resultsEmpty");
const playersEl = $("players");
const scoreboardEl = $("scoreboard");
const playerCount = $("playerCount");
const historyEl = $("history");
const toastEl = $("toast");
const countdownOverlay = $("countdownOverlay");
const countdownNumber = $("countdownNumber");

let code = sessionStorage.getItem("adminRoomCode") || "";
let countdownInterval = null;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function medal(position) {
  if (position === 1) return "🥇 1.º";
  if (position === 2) return "🥈 2.º";
  if (position === 3) return "🥉 3.º";
  return `${position}.º`;
}

function showCountdown(endsAt) {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = false;
  const update = () => {
    const remaining = Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
    countdownNumber.textContent = remaining;
  };
  update();
  countdownInterval = setInterval(update, 100);
}

function hideCountdown() {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = true;
}

function render(state) {
  roomCodeEl.textContent = state.code;
  const connected = state.players.filter(p => p.connected);
  playerCount.textContent = `(${connected.length}/${state.players.length})`;

  playersEl.innerHTML = state.players.length ? "" : `<div class="empty">Esperando jugadores...</div>`;
  state.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<div class="player-identity"><span class="${p.connected ? "online" : "offline"}"></span><span>${escapeHtml(p.name)}</span></div><span class="muted">${p.connected ? "Conectado" : "Desconectado"}</span>`;
    playersEl.appendChild(row);
  });

  scoreboardEl.innerHTML = state.players.length ? "" : `<div class="empty">El marcador aparecerá aquí.</div>`;
  state.players.forEach((p, i) => {
    const item = document.createElement("div");
    item.className = `score-row ${i === 0 && p.score > 0 ? "leader" : ""}`;
    item.innerHTML = `<span class="score-rank">${i + 1}</span><span class="score-name">${escapeHtml(p.name)}</span><strong>${p.score} pts</strong>`;
    scoreboardEl.appendChild(item);
  });

  resultsBody.innerHTML = "";
  resultsEmpty.style.display = state.results.length ? "none" : "block";
  state.results.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${medal(r.position)}</td><td>${escapeHtml(r.playerName)}</td><td>${r.elapsedSeconds.toFixed(3)} s</td><td><span class="points-badge">+${r.pointsAwarded}</span></td>`;
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

  [copyBtn, resetScoresBtn, clearHistoryBtn].forEach(b => b.disabled = false);

  historyEl.innerHTML = state.history.length ? "" : `<div class="empty">Aún no hay rondas guardadas.</div>`;
  [...state.history].reverse().forEach(round => {
    const div = document.createElement("div");
    div.className = "history-item";
    const rows = round.results.length
      ? round.results.map(r => `<div class="history-line"><span>${medal(r.position)} ${escapeHtml(r.playerName)}</span><span>${r.elapsedSeconds.toFixed(3)} s · +${r.pointsAwarded} pts</span></div>`).join("")
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
    render(res.state);
  });
}

function createOrResumeRoom() {
  if (!code) return createRoom();
  socket.emit("admin:resumeRoom", { code }, (res) => {
    if (res.ok) return render(res.state);
    sessionStorage.removeItem("adminRoomCode");
    code = "";
    createRoom();
  });
}

socket.on("connect", createOrResumeRoom);
socket.on("room:state", state => { if (state.code === code) render(state); });
socket.on("round:countdown", ({ endsAtEpochMs }) => showCountdown(endsAtEpochMs));
socket.on("round:started", hideCountdown);

startBtn.addEventListener("click", () => socket.emit("admin:startRound", { code }, res => { if (!res.ok) toast(res.message); }));
resetBtn.addEventListener("click", () => socket.emit("admin:resetRound", { code }, res => { if (!res.ok) toast(res.message); }));
resetScoresBtn.addEventListener("click", () => {
  if (!confirm("¿Reiniciar a 0 los puntos de todos los jugadores?")) return;
  socket.emit("admin:resetScores", { code }, res => { if (!res.ok) toast(res.message); });
});
clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("¿Borrar el historial de rondas?")) return;
  socket.emit("admin:clearHistory", { code }, res => { if (!res.ok) toast(res.message); });
});
copyBtn.addEventListener("click", async () => {
  const url = `${location.origin}/player?room=${encodeURIComponent(code)}`;
  try { await navigator.clipboard.writeText(url); toast("Enlace de jugador copiado."); }
  catch { prompt("Copia este enlace:", url); }
});
