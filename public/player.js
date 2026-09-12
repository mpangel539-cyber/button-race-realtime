const socket = io();

const joinView = document.getElementById("joinView");
const gameView = document.getElementById("gameView");
const roomInput = document.getElementById("roomInput");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");
const playerNameEl = document.getElementById("playerName");
const playerRoomEl = document.getElementById("playerRoom");
const statusText = document.getElementById("statusText");
const buzzer = document.getElementById("buzzer");
const resultBox = document.getElementById("resultBox");
const toastEl = document.getElementById("toast");

const params = new URLSearchParams(location.search);
if (params.get("room")) roomInput.value = params.get("room");

let code = "";
let playerId = localStorage.getItem("buttonRacePlayerId") || "";
let playerName = localStorage.getItem("buttonRacePlayerName") || "";
let currentRound = 0;
let roundActive = false;
let alreadyPressed = false;

if (playerName) nameInput.value = playerName;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function setBuzzerState(state) {
  buzzer.className = `buzzer ${state}`;
  if (state === "waiting") {
    buzzer.disabled = true;
    buzzer.textContent = "ESPERA";
  } else if (state === "ready") {
    buzzer.disabled = false;
    buzzer.textContent = "¡PULSA!";
  } else {
    buzzer.disabled = true;
    buzzer.textContent = "PRESIONADO";
  }
}

function applyState(state, myResult = null) {
  currentRound = state.roundNumber;
  roundActive = state.roundActive;

  const result = myResult || state.results.find(r => r.playerId === playerId);
  alreadyPressed = Boolean(result);

  if (result) {
    setBuzzerState("pressed");
    statusText.textContent = "¡Botón presionado!";
    resultBox.innerHTML = `<strong>Posición ${result.position}.º</strong><br>${result.elapsedSeconds.toFixed(3)} s`;
  } else if (state.roundActive) {
    setBuzzerState("ready");
    statusText.textContent = `Ronda ${state.roundNumber}: ¡ya!`;
    resultBox.textContent = "";
  } else {
    setBuzzerState("waiting");
    statusText.textContent = "Esperando al administrador…";
    resultBox.textContent = "";
  }
}

function joinRoom() {
  const desiredCode = roomInput.value.trim();
  const desiredName = nameInput.value.trim();

  joinError.textContent = "";
  joinBtn.disabled = true;

  socket.emit("player:join", {
    code: desiredCode,
    name: desiredName,
    playerId
  }, (res) => {
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
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

buzzer.addEventListener("pointerdown", (event) => {
  event.preventDefault();

  if (!roundActive || alreadyPressed || buzzer.disabled) return;

  // Bloqueo inmediato en cliente para evitar doble toque.
  alreadyPressed = true;
  setBuzzerState("pressed");
  statusText.textContent = "Enviando pulsación…";

  socket.emit("player:press", {
    code,
    playerId,
    roundNumber: currentRound
  }, (res) => {
    if (!res.ok) {
      alreadyPressed = false;
      toast(res.message || "No se pudo registrar.");
      if (roundActive) setBuzzerState("ready");
      return;
    }

    const r = res.result;
    if (r) {
      statusText.textContent = "¡Botón presionado!";
      resultBox.innerHTML = `<strong>Posición ${r.position}.º</strong><br>${r.elapsedSeconds.toFixed(3)} s`;
    }
  });
});

socket.on("round:started", ({ roundNumber }) => {
  currentRound = roundNumber;
  roundActive = true;
  alreadyPressed = false;
  resultBox.textContent = "";
  statusText.textContent = `Ronda ${roundNumber}: ¡ya!`;
  setBuzzerState("ready");
});

socket.on("round:reset", () => {
  roundActive = false;
  alreadyPressed = false;
  statusText.textContent = "Esperando al administrador…";
  resultBox.textContent = "";
  setBuzzerState("waiting");
});

socket.on("round:result", (result) => {
  if (result.playerId !== playerId) return;
  alreadyPressed = true;
  setBuzzerState("pressed");
  statusText.textContent = "¡Botón presionado!";
  resultBox.innerHTML = `<strong>Posición ${result.position}.º</strong><br>${result.elapsedSeconds.toFixed(3)} s`;
});

socket.on("room:state", (state) => {
  if (!code || state.code !== code) return;
  applyState(state);
});

socket.on("admin:disconnected", () => {
  toast("El administrador se desconectó.");
});

socket.on("connect", () => {
  const savedCode = sessionStorage.getItem("buttonRaceRoomCode");
  if (!code && savedCode && playerId && playerName) {
    code = savedCode;
    socket.emit("player:join", {
      code,
      name: playerName,
      playerId
    }, (res) => {
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
