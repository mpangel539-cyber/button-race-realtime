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
const statusText = $("statusText");
const roundHint = $("roundHint");
const buzzer = $("buzzer");
const buzzerIcon = $("buzzerIcon");
const buzzerText = $("buzzerText");
const resultBox = $("resultBox");
const toastEl = $("toast");
const countdownOverlay = $("countdownOverlay");
const countdownNumber = $("countdownNumber");
const soundBtn = $("soundBtn");

const params = new URLSearchParams(location.search);
if (params.get("room")) roomInput.value = params.get("room");

let code = "";
let playerId = localStorage.getItem("buttonRacePlayerId") || "";
let playerName = localStorage.getItem("buttonRacePlayerName") || "";
let currentRound = 0;
let roundActive = false;
let alreadyPressed = false;
let countdownInterval = null;
let lastCountdownValue = null;
let soundEnabled = true;
let audioCtx = null;

if (playerName) nameInput.value = playerName;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
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
  tone(520 + (3 - value) * 70, 0.12, "sine", 0.08);
}

function playGoSound() {
  if (!soundEnabled) return;
  tone(900, 0.13, "square", 0.07);
  setTimeout(() => tone(1200, 0.22, "square", 0.07), 120);
}

function playPressSound() {
  if (!soundEnabled) return;
  tone(1000, 0.10, "triangle", 0.07);
  setTimeout(() => tone(760, 0.14, "triangle", 0.05), 90);
}

function setBuzzerState(state) {
  buzzer.className = `buzzer ${state}`;
  if (state === "waiting") {
    buzzer.disabled = true;
    buzzerIcon.textContent = "⏳";
    buzzerText.textContent = "ESPERA";
  } else if (state === "ready") {
    buzzer.disabled = false;
    buzzerIcon.textContent = "⚡";
    buzzerText.textContent = "¡PULSA!";
  } else {
    buzzer.disabled = true;
    buzzerIcon.textContent = "✓";
    buzzerText.textContent = "LISTO";
  }
}

function showCountdown(endsAt) {
  clearInterval(countdownInterval);
  countdownOverlay.hidden = false;
  setBuzzerState("waiting");
  statusText.textContent = "Prepárate…";
  roundHint.textContent = "No pulses hasta que aparezca ¡YA!";
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

function applyState(state, myResult = null) {
  currentRound = state.roundNumber;
  roundActive = state.roundActive;

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
    roundHint.textContent = "El servidor confirmó tu posición.";
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
  ensureAudio();

  socket.emit("player:join", { code: desiredCode, name: desiredName, playerId }, (res) => {
    joinBtn.disabled = false;
    if (!res.ok) {
      joinError.textContent = res.message || "No se pudo entrar.";
      return;
    }

    code = desiredCode;
    playerId = res.playerId;
    playerName = res.player.name;

    localStorage.setItem("buttonRacePlayerId", playerId);
    localStorage.setItem("buttonRacePlayerName", playerName);
    sessionStorage.setItem("buttonRaceRoomCode", code);

    playerNameEl.textContent = playerName;
    playerRoomEl.textContent = code;
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
  playPressSound();
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
      statusText.textContent = "¡Registrado!";
      roundHint.textContent = "El servidor confirmó tu posición.";
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
  playGoSound();
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

socket.on("room:state", state => {
  if (code && state.code === code) applyState(state);
});

socket.on("admin:disconnected", () => toast("El administrador se desconectó."));

socket.on("connect", () => {
  const savedCode = sessionStorage.getItem("buttonRaceRoomCode");
  if (!code && savedCode && playerId && playerName) {
    code = savedCode;
    socket.emit("player:join", { code, name: playerName, playerId }, (res) => {
      if (!res.ok) {
        code = "";
        sessionStorage.removeItem("buttonRaceRoomCode");
        return;
      }

      joinView.hidden = true;
      gameView.hidden = false;
      playerNameEl.textContent = playerName;
      playerRoomEl.textContent = code;
      applyState(res.state, res.result);
    });
  }
});

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
  if (soundEnabled) {
    ensureAudio();
    tone(700, 0.1, "sine", 0.05);
  }
});
