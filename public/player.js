const socket = io();
const $ = (id) => document.getElementById(id);

const joinView = $("joinView");
const gameView = $("gameView");
const roomInput = $("roomInput");
const nameInput = $("nameInput");
const joinBtn = $("joinBtn");
const joinError = $("joinError");
const playerNameEl = $("playerName");
const playerRoomEl = $("playerRoom");
const playerScoreEl = $("playerScore");
const statusText = $("statusText");
const roundHint = $("roundHint");
const buzzer = $("buzzer");
const buzzerIcon = $("buzzerIcon");
const buzzerText = $("buzzerText");
const resultBox = $("resultBox");
const toastEl = $("toast");
const countdownOverlay = $("countdownOverlay");
const countdownNumber = $("countdownNumber");

const params = new URLSearchParams(location.search);
if (params.get("room")) roomInput.value = params.get("room");

let code = "";
let playerId = localStorage.getItem("buttonRacePlayerId") || "";
let playerName = localStorage.getItem("buttonRacePlayerName") || "";
let currentRound = 0;
let roundActive = false;
let alreadyPressed = false;
let countdownInterval = null;
if (playerName) nameInput.value = playerName;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function setBuzzerState(state) {
  buzzer.className = `buzzer ${state}`;
  if (state === "waiting") {
    buzzer.disabled = true; buzzerIcon.textContent = "⏳"; buzzerText.textContent = "ESPERA";
  } else if (state === "ready") {
    buzzer.disabled = false; buzzerIcon.textContent = "⚡"; buzzerText.textContent = "¡PULSA!";
  } else {
    buzzer.disabled = true; buzzerIcon.textContent = "✓"; buzzerText.textContent = "LISTO";
  }
}

function showCountdown(endsAt) {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = false;
  setBuzzerState("waiting");
  statusText.textContent = "Prepárate…";
  roundHint.textContent = "No pulses hasta que aparezca ¡YA!";
  const update = () => countdownNumber.textContent = Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
  update();
  countdownInterval = setInterval(update, 100);
}

function hideCountdown() {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = true;
}

function applyState(state, myResult = null) {
  currentRound = state.roundNumber;
  roundActive = state.roundActive;
  const me = state.players.find(p => p.id === playerId);
  if (me) playerScoreEl.textContent = me.score;

  if (state.countdownActive) {
    alreadyPressed = false;
    showCountdown(state.countdownEndsAtEpochMs);
    return;
  }

  hideCountdown();
  const result = myResult || state.results.find(r => r.playerId === playerId);
  alreadyPressed = Boolean(result);

  if (result) {
    setBuzzerState("pressed");
    statusText.textContent = "¡Registrado!";
    roundHint.textContent = `Ganaste +${result.pointsAwarded} punto${result.pointsAwarded === 1 ? "" : "s"} en esta ronda.`;
    resultBox.innerHTML = `<div class="result-position">${result.position === 1 ? "🥇" : result.position === 2 ? "🥈" : result.position === 3 ? "🥉" : "⚡"} Posición ${result.position}.º</div><div class="result-time">${result.elapsedSeconds.toFixed(3)} s</div>`;
  } else if (state.roundActive) {
    setBuzzerState("ready");
    statusText.textContent = "¡YA!";
    roundHint.textContent = "Pulsa lo más rápido que puedas.";
    resultBox.textContent = "";
  } else {
    setBuzzerState("waiting");
    statusText.textContent = "Esperando al administrador…";
    roundHint.textContent = "El botón se activará cuando comience la ronda.";
    resultBox.textContent = "";
  }
}

function joinRoom() {
  const desiredCode = roomInput.value.trim();
  const desiredName = nameInput.value.trim();
  joinError.textContent = "";
  joinBtn.disabled = true;
  socket.emit("player:join", { code: desiredCode, name: desiredName, playerId }, (res) => {
    joinBtn.disabled = false;
    if (!res.ok) { joinError.textContent = res.message || "No se pudo entrar."; return; }

    code = desiredCode;
    playerId = res.playerId;
    playerName = res.player.name;
    localStorage.setItem("buttonRacePlayerId", playerId);
    localStorage.setItem("buttonRacePlayerName", playerName);
    sessionStorage.setItem("buttonRaceRoomCode", code);

    playerNameEl.textContent = playerName;
    playerRoomEl.textContent = code;
    playerScoreEl.textContent = res.player.score || 0;
    joinView.hidden = true;
    gameView.hidden = false;
    applyState(res.state, res.result);
  });
}

joinBtn.addEventListener("click", joinRoom);
nameInput.addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(); });

buzzer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (!roundActive || alreadyPressed || buzzer.disabled) return;
  alreadyPressed = true;
  setBuzzerState("pressed");
  statusText.textContent = "Enviando…";
  roundHint.textContent = "El servidor está confirmando tu posición.";

  socket.emit("player:press", { code, playerId, roundNumber: currentRound }, (res) => {
    if (!res.ok) {
      alreadyPressed = false;
      toast(res.message || "No se pudo registrar.");
      if (roundActive) setBuzzerState("ready");
      return;
    }
    if (res.result) {
      const r = res.result;
      playerScoreEl.textContent = r.totalScore;
      statusText.textContent = "¡Registrado!";
      roundHint.textContent = `Ganaste +${r.pointsAwarded} punto${r.pointsAwarded === 1 ? "" : "s"} en esta ronda.`;
      resultBox.innerHTML = `<div class="result-position">${r.position === 1 ? "🥇" : r.position === 2 ? "🥈" : r.position === 3 ? "🥉" : "⚡"} Posición ${r.position}.º</div><div class="result-time">${r.elapsedSeconds.toFixed(3)} s</div>`;
    }
  });
});

socket.on("round:countdown", ({ roundNumber, endsAtEpochMs }) => {
  currentRound = roundNumber;
  roundActive = false;
  alreadyPressed = false;
  resultBox.textContent = "";
  showCountdown(endsAtEpochMs);
});

socket.on("round:started", ({ roundNumber }) => {
  hideCountdown();
  currentRound = roundNumber;
  roundActive = true;
  alreadyPressed = false;
  resultBox.textContent = "";
  statusText.textContent = "¡YA!";
  roundHint.textContent = "Pulsa lo más rápido que puedas.";
  setBuzzerState("ready");
});

socket.on("round:reset", () => {
  hideCountdown();
  roundActive = false;
  alreadyPressed = false;
  statusText.textContent = "Esperando al administrador…";
  roundHint.textContent = "El botón se activará cuando comience la ronda.";
  resultBox.textContent = "";
  setBuzzerState("waiting");
});

socket.on("room:state", state => { if (code && state.code === code) applyState(state); });
socket.on("admin:disconnected", () => toast("El administrador se desconectó."));
socket.on("scores:reset", () => { playerScoreEl.textContent = "0"; toast("El marcador volvió a cero."); });

socket.on("connect", () => {
  const savedCode = sessionStorage.getItem("buttonRaceRoomCode");
  if (!code && savedCode && playerId && playerName) {
    code = savedCode;
    socket.emit("player:join", { code, name: playerName, playerId }, (res) => {
      if (!res.ok) { code = ""; sessionStorage.removeItem("buttonRaceRoomCode"); return; }
      joinView.hidden = true;
      gameView.hidden = false;
      playerNameEl.textContent = playerName;
      playerRoomEl.textContent = code;
      playerScoreEl.textContent = res.player.score || 0;
      applyState(res.state, res.result);
    });
  }
});
