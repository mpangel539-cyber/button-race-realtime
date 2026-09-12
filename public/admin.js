const socket = io();

const roomCodeEl = document.getElementById("roomCode");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const copyBtn = document.getElementById("copyBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const roundStatus = document.getElementById("roundStatus");
const resultsBody = document.getElementById("resultsBody");
const resultsEmpty = document.getElementById("resultsEmpty");
const playersEl = document.getElementById("players");
const playerCount = document.getElementById("playerCount");
const historyEl = document.getElementById("history");
const toastEl = document.getElementById("toast");

let code = sessionStorage.getItem("adminRoomCode") || "";
let currentState = null;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function medal(position) {
  if (position === 1) return "🥇 1.º";
  if (position === 2) return "🥈 2.º";
  if (position === 3) return "🥉 3.º";
  return `${position}.º`;
}

function render(state) {
  currentState = state;
  roomCodeEl.textContent = state.code;

  const connectedPlayers = state.players.filter(p => p.connected);
  playerCount.textContent = `(${connectedPlayers.length}/${state.players.length})`;

  playersEl.innerHTML = "";
  if (!state.players.length) {
    playersEl.innerHTML = `<div class="empty">Esperando jugadores...</div>`;
  } else {
    for (const p of state.players) {
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <span class="${p.connected ? "online" : "offline"}"></span>
          <span>${escapeHtml(p.name)}</span>
        </div>
        <span class="muted">${p.connected ? "Conectado" : "Desconectado"}</span>
      `;
      playersEl.appendChild(row);
    }
  }

  resultsBody.innerHTML = "";
  resultsEmpty.style.display = state.results.length ? "none" : "block";
  for (const r of state.results) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${medal(r.position)}</td>
      <td>${escapeHtml(r.playerName)}</td>
      <td>${r.elapsedSeconds.toFixed(3)} s</td>
    `;
    resultsBody.appendChild(tr);
  }

  if (state.roundActive) {
    roundStatus.classList.add("live");
    roundStatus.innerHTML = `<span class="dot"></span><span>Ronda ${state.roundNumber} activa</span>`;
    startBtn.disabled = true;
    resetBtn.disabled = false;
  } else {
    roundStatus.classList.remove("live");
    roundStatus.innerHTML = `<span class="dot"></span><span>${state.roundNumber ? `Ronda ${state.roundNumber} finalizada o en espera` : "Esperando para iniciar la primera ronda"}</span>`;
    startBtn.disabled = false;
    resetBtn.disabled = false;
  }

  copyBtn.disabled = false;
  clearHistoryBtn.disabled = false;

  historyEl.innerHTML = "";
  if (!state.history.length) {
    historyEl.innerHTML = `<div class="empty">Aún no hay rondas guardadas.</div>`;
  } else {
    [...state.history].reverse().forEach(round => {
      const div = document.createElement("div");
      div.className = "history-item";
      const rows = round.results.length
        ? round.results.map(r => `${medal(r.position)} ${escapeHtml(r.playerName)} — ${r.elapsedSeconds.toFixed(3)} s`).join("<br>")
        : "Sin pulsaciones";
      div.innerHTML = `<strong>Ronda ${round.roundNumber}</strong><div class="muted" style="margin-top:8px">${rows}</div>`;
      historyEl.appendChild(div);
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createOrResumeRoom() {
  if (code) {
    socket.emit("admin:resumeRoom", { code }, (res) => {
      if (res.ok) {
        render(res.state);
        return;
      }
      sessionStorage.removeItem("adminRoomCode");
      code = "";
      createRoom();
    });
  } else {
    createRoom();
  }
}

function createRoom() {
  socket.emit("admin:createRoom", (res) => {
    if (!res.ok) return;
    code = res.code;
    sessionStorage.setItem("adminRoomCode", code);
    render(res.state);
  });
}

socket.on("connect", createOrResumeRoom);
socket.on("room:state", (state) => {
  if (!code || state.code !== code) return;
  render(state);
});
socket.on("round:result", () => {});
socket.on("admin:disconnected", () => {});

startBtn.addEventListener("click", () => {
  socket.emit("admin:startRound", { code }, (res) => {
    if (!res.ok) toast(res.message || "No se pudo iniciar.");
  });
});

resetBtn.addEventListener("click", () => {
  socket.emit("admin:resetRound", { code }, (res) => {
    if (!res.ok) toast(res.message || "No se pudo reiniciar.");
  });
});

copyBtn.addEventListener("click", async () => {
  const url = `${location.origin}/player?room=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Enlace copiado.");
  } catch {
    prompt("Copia este enlace:", url);
  }
});

clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("¿Seguro que quieres borrar todo el historial?")) return;
  socket.emit("admin:clearHistory", { code }, (res) => {
    if (!res.ok) toast(res.message || "No se pudo borrar.");
  });
});
