const socket = io();

const PLAYER_SIGNATURE_STORAGE_KEY = "spyseek.playerSignature";
const playerSignature = getOrCreatePlayerSignature();

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 6;

const EMOTES = [
  { id: "smile", codepoint: "1f604", label: "Smile" },
  { id: "thinking", codepoint: "1f914", label: "Thinking" },
  { id: "shocked", codepoint: "1f631", label: "Shocked" },
  { id: "magnifying-glass", codepoint: "1f50e", label: "Magnifying Glass" },
  { id: "monster", codepoint: "1fac8", label: "Monster" },
  { id: "disguise", codepoint: "1f978", label: "Disguise" }
];

const entryScreen = document.querySelector("#entry-screen");
const lobbyScreen = document.querySelector("#lobby-screen");
const gameScreen = document.querySelector("#game-screen");

const nameInput = document.querySelector("#name");
const playerIdInput = document.querySelector("#player-id");
const roomCodeInput = document.querySelector("#room-code");
const createRoomButton = document.querySelector("#create-room");
const joinRandomRoomButton = document.querySelector("#join-random-room");
const joinRoomButton = document.querySelector("#join-room");

const lobbyRoomCode = document.querySelector("#lobby-room-code");
const lobbyPlayersList = document.querySelector("#lobby-players");
const startGameButton = document.querySelector("#start-game");
const leaveRoomButton = document.querySelector("#leave-room");
const lobbyActions = document.querySelector(".lobby-actions");

const gameStateText = document.querySelector("#game-state");
const gameStateCard = gameStateText.closest(".game-state-card");
const gameTimerText = document.querySelector("#game-timer");
const timerCard = gameTimerText.closest(".timer-card");
const replayButton = createReplayButton();
const roleText = document.querySelector("#role");
const gamePlayersList = document.querySelector("#game-players");
const locationsList = document.querySelector("#locations");
const messagesList = document.querySelector("#messages");
const chatControls = document.querySelector("#chat-controls");
const answererSelect = document.querySelector("#answerer");
const chatMessageInput = document.querySelector("#chat-message");
const sendChatMessageButton = document.querySelector("#send-chat-message");

const statusText = document.querySelector("#status");
const roomIdBadge = document.querySelector("#room-id-badge");

const helpButton = document.querySelector("#help-button");
const helpModal = document.querySelector("#help-modal");
const closeHelpModalButton = document.querySelector("#close-help-modal");
const helpPreviousPageButton = document.querySelector("#help-previous-page");
const helpNextPageButton = document.querySelector("#help-next-page");
const helpPages = Array.from(document.querySelectorAll("[data-help-page]"));
const helpPageDots = document.querySelector("#help-page-dots");

const researchDataConsentInput = document.querySelector("#research-data-consent");
const noPiiConsentInput = document.querySelector("#no-pii-consent");

let lobbyWaitingText = document.querySelector("#lobby-waiting-text");

roomCodeInput.value = "";

if (!lobbyWaitingText) {
  lobbyWaitingText = document.createElement("p");
  lobbyWaitingText.id = "lobby-waiting-text";
  lobbyWaitingText.className = "subtitle";
  lobbyWaitingText.textContent = "Waiting for host to start.";
  lobbyWaitingText.hidden = true;
  lobbyActions.insertAdjacentElement("afterend", lobbyWaitingText);
}

const guessConfirmationModal = createGuessConfirmationModal();
const roleRevealModal = createRoleRevealModal();

let currentRoomCode = null;
let latestRoom = null;
let assignedRoleText = "Waiting for role.";
let assignedRoleKind = null;
let assignedLocation = null;
let normalAccusationUsed = false;
let pendingAccusationName = null;
let pendingBeliefUpdateKey = null;
let pendingVoteKey = null;
let pendingSpyGuessLocation = null;
let pendingGuessConfirmationLocation = null;
let statusTimer = null;
let helpPageIndex = 0;
let entryIsBusy = false;

const submittedBeliefUpdateKeys = new Set();
const submittedVoteKeys = new Set();
const beliefDrafts = new Map();

setInterval(renderGameTimer, 1000);

socket.on("connect", () => {
  clearStatus();
});

socket.on("disconnect", () => {
  showError("Disconnected from server.");
  setEntryBusy(false);
  setLobbyBusy(false);
});

socket.on("connect_error", () => {
  showError("Could not connect to server.");
  setEntryBusy(false);
  setLobbyBusy(false);
});

window.addEventListener("resize", scheduleHelpButtonPosition);
window.addEventListener("load", scheduleHelpButtonPosition);

researchDataConsentInput.addEventListener("change", () => {
  updateEntryButtons();
});

noPiiConsentInput.addEventListener("change", () => {
  updateEntryButtons();
});

helpButton.addEventListener("click", () => {
  openHelpModal();
});

closeHelpModalButton.addEventListener("click", () => {
  closeHelpModal();
});

helpModal.querySelector(".modal-backdrop").addEventListener("click", () => {
  closeHelpModal();
});

helpPreviousPageButton.addEventListener("click", () => {
  showPreviousHelpPage();
});

helpNextPageButton.addEventListener("click", () => {
  showNextHelpPage();
});

createRoomButton.addEventListener("click", () => {
  clearStatus();
  setEntryBusy(true);

  socket.emit("create_room", {
    name: nameInput.value,
    playerId: playerIdInput.value,
    playerSignature,
    researchDataConsent: researchDataConsentInput.checked,
    noPiiConsent: noPiiConsentInput.checked
  });
});

joinRandomRoomButton.addEventListener("click", () => {
  clearStatus();
  setEntryBusy(true);

  socket.emit("join_random_room", {
    name: nameInput.value,
    playerId: playerIdInput.value,
    playerSignature,
    researchDataConsent: researchDataConsentInput.checked,
    noPiiConsent: noPiiConsentInput.checked
  });
});

joinRoomButton.addEventListener("click", () => {
  clearStatus();
  setEntryBusy(true);

  socket.emit("join_room", {
    code: roomCodeInput.value,
    name: nameInput.value,
    playerId: playerIdInput.value,
    playerSignature,
    researchDataConsent: researchDataConsentInput.checked,
    noPiiConsent: noPiiConsentInput.checked
  });
});

startGameButton.addEventListener("click", () => {
  clearStatus();
  setLobbyBusy(true);

  socket.emit("start_game");
});

leaveRoomButton.addEventListener("click", () => {
  clearStatus();
  setLobbyBusy(true);

  socket.emit("leave_room");
});

sendChatMessageButton.addEventListener("click", () => {
  sendChatMessage();
});

chatMessageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    sendChatMessage();
  }
});

gamePlayersList.addEventListener("click", event => {
  const emoteOption = event.target.closest(".emote-option");

  if (emoteOption) {
    playEmote(emoteOption);
    return;
  }

  const accuseButton = event.target.closest(".accuse-button");

  if (!accuseButton || accuseButton.disabled) {
    return;
  }

  const accusedName = accuseButton.dataset.accusedName;

  if (!accusedName) {
    return;
  }

  clearStatus();

  pendingAccusationName = accusedName;
  renderRoom(latestRoom);

  socket.emit("start_accusation", {
    accusedName
  });
});

locationsList.addEventListener("click", event => {
  const guessButton = event.target.closest(".guess-button");

  if (!guessButton || guessButton.disabled) {
    return;
  }

  const location = guessButton.dataset.location;

  if (!location) {
    return;
  }

  openGuessConfirmation(location);
});

guessConfirmationModal.cancelButton.addEventListener("click", () => {
  closeGuessConfirmation();
});

guessConfirmationModal.closeButton.addEventListener("click", () => {
  closeGuessConfirmation();
});

guessConfirmationModal.backdrop.addEventListener("click", () => {
  closeGuessConfirmation();
});

guessConfirmationModal.confirmButton.addEventListener("click", () => {
  confirmSpyGuess();
});

roleRevealModal.closeButton.addEventListener("click", closeRoleRevealModal);

roleRevealModal.backdrop.addEventListener("click", closeRoleRevealModal);

roleRevealModal.acknowledgeButton.addEventListener("click", closeRoleRevealModal);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeGuessConfirmation();
    closeHelpModal();
    closeRoleRevealModal();
  }
});

messagesList.addEventListener("click", event => {
  const beliefButton = event.target.closest(".submit-belief-button");

  if (beliefButton && !beliefButton.disabled) {
    submitBeliefUpdate(beliefButton);
    return;
  }

  const voteButton = event.target.closest(".vote-button");

  if (voteButton && !voteButton.disabled) {
    submitAccusationVote(voteButton);
  }
});

messagesList.addEventListener("change", event => {
  const prompt = event.target.closest(".belief-prompt");

  if (!prompt) {
    return;
  }

  const submitButton = prompt.querySelector(".submit-belief-button");

  if (!submitButton) {
    return;
  }

  const beliefKey = submitButton.dataset.beliefKey;

  if (!beliefKey) {
    return;
  }

  const questionerRadio = prompt.querySelector("input[data-belief-target='questioner']:checked");
  const answererRadio = prompt.querySelector("input[data-belief-target='answerer']:checked");

  const suspectedLocations = Array.from(
    prompt.querySelectorAll("input[data-belief-location]:checked")
  ).map(input => input.value);

  beliefDrafts.set(beliefKey, {
    questionerBelief: questionerRadio ? questionerRadio.value : "",
    answererBelief: answererRadio ? answererRadio.value : "",
    suspectedLocations
  });
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

roomCodeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    joinRoomButton.click();
  }
});

nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    createRoomButton.click();
  }
});

playerIdInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    createRoomButton.click();
  }
});

answererSelect.addEventListener("change", () => {
  if (latestRoom) {
    renderChatControls(latestRoom);
  }
});

socket.on("room_created", ({ code }) => {
  currentRoomCode = code;
  roomCodeInput.value = code;
  resetGameLocalState();

  clearStatus();
  setEntryBusy(false);
  showLobby();
});

socket.on("room_joined", ({ code }) => {
  currentRoomCode = code;
  roomCodeInput.value = code;
  resetGameLocalState();

  clearStatus();
  setEntryBusy(false);
  showLobby();
});

socket.on("room_updated", room => {
  latestRoom = room;

  if (!currentRoomCode) {
    return;
  }

  updateLocalAccusationState(room);
  clearFinishedPendingState(room);
  renderRoom(room);
});

socket.on("role_assigned", ({ role, location }) => {
  assignedRoleKind = role;
  assignedLocation = role === "spy" ? null : location;

  if (role === "spy") {
    assignedRoleText = "Spy: learn the secret location!";
    roleRevealModal.title.textContent = "You are the spy!"
    roleRevealModal.message.textContent = "You need to try and figure out the secret location without giving yourself away. Don't let the agents catch you! You can guess the location by clicking on the blue button next to the corresponding location name. Be careful, you can only guess once!";
  } else {
    assignedRoleText = "Agent: find the spy!";
    roleRevealModal.title.textContent = "You are an agent!"
    roleRevealModal.message.textContent = "You need to try and figure out who the spy is before they guess the secret location! You can accuse a player of being the spy the pressing the red button next to their name.";
  }

  renderRole();

  if (latestRoom) {
    renderRoom(latestRoom);
  }

  // Show the role reveal modal
  roleRevealModal.element.classList.remove("is-hidden");
  roleRevealModal.element.setAttribute("aria-hidden", "false");
  roleRevealModal.acknowledgeButton.focus();
});

socket.on("room_destroyed", ({ message }) => {
  currentRoomCode = null;
  latestRoom = null;
  roomCodeInput.value = "";
  resetGameLocalState();

  setEntryBusy(false);
  setLobbyBusy(false);
  //clearResearchConsent();
  showEntry();
  showError(message || "Room destroyed.");
});

socket.on("room_left", () => {
  currentRoomCode = null;
  latestRoom = null;
  roomCodeInput.value = "";
  resetGameLocalState();

  clearStatus();
  setEntryBusy(false);
  setLobbyBusy(false);
  //clearResearchConsent();
  showEntry();
});

socket.on("app_error", message => {
  if (pendingBeliefUpdateKey) {
    submittedBeliefUpdateKeys.delete(pendingBeliefUpdateKey);
    pendingBeliefUpdateKey = null;
  }

  if (pendingVoteKey) {
    submittedVoteKeys.delete(pendingVoteKey);
    pendingVoteKey = null;
  }

  pendingAccusationName = null;
  pendingSpyGuessLocation = null;

  setEntryBusy(false);
  setLobbyBusy(false);

  if (currentRoomCode && latestRoom) {
    renderRoom(latestRoom);
  }

  showError(message);
});

socket.on("emote_played", emote => {
  playEmoteAnimation(emote.playerName, emote.emoteId);
});

function sendChatMessage() {
  if (sendChatMessageButton.disabled) {
    return;
  }

  if (
    latestRoom &&
    latestRoom.status === "playing" &&
    latestRoom.turn &&
    latestRoom.turn.phase === "asking" &&
    !answererSelect.value
  ) {
    showError("Choose who to ask first.");
    return;
  }

  clearStatus();

  socket.emit("send_chat_message", {
    text: chatMessageInput.value,
    answererName: answererSelect.value
  });

  chatMessageInput.value = "";
}

function openHelpModal() {
  renderHelpPage();
  helpModal.classList.remove("is-hidden");
  helpModal.setAttribute("aria-hidden", "false");
  closeHelpModalButton.focus();
}

function closeHelpModal() {
  helpModal.classList.add("is-hidden");
  helpModal.setAttribute("aria-hidden", "true");
}

let helpButtonPositionFrame = null;

function scheduleHelpButtonPosition() {
  if (helpButtonPositionFrame) {
    cancelAnimationFrame(helpButtonPositionFrame);
  }

  helpButtonPositionFrame = requestAnimationFrame(() => {
    helpButtonPositionFrame = null;
    updateHelpButtonPosition();
  });
}

function updateHelpButtonPosition() {
  if (!helpButton) {
    return;
  }

  const activeInterface = getActiveInterfaceElement();

  if (!activeInterface) {
    return;
  }

  const interfaceRect = activeInterface.getBoundingClientRect();
  const buttonRect = helpButton.getBoundingClientRect();
  const gap = 12;
  const viewportPadding = 18;

  const preferredLeft = interfaceRect.right + gap;
  const maxLeft = window.innerWidth - buttonRect.width - viewportPadding;

  const preferredTop = interfaceRect.top;
  const minTop = viewportPadding;

  helpButton.style.left = `${Math.min(preferredLeft, maxLeft)}px`;
  helpButton.style.top = `${Math.max(preferredTop, minTop)}px`;
}

function getActiveInterfaceElement() {
  const interfaces = [entryScreen, lobbyScreen, gameScreen];

  return interfaces.find(element => {
    return element && !element.classList.contains("is-hidden");
  });
}

function showPreviousHelpPage() {
  helpPageIndex =
    helpPageIndex === 0 ? helpPages.length - 1 : helpPageIndex - 1;

  renderHelpPage();
}

function showNextHelpPage() {
  helpPageIndex =
    helpPageIndex === helpPages.length - 1 ? 0 : helpPageIndex + 1;

  renderHelpPage();
}

function renderHelpPage() {
  if (!helpPages.length || !helpPageDots) {
    return;
  }

  helpPages.forEach((page, index) => {
    const isActive = index === helpPageIndex;

    page.classList.toggle("is-active", isActive);
    page.hidden = !isActive;
  });

  renderHelpPageDots();
}

function renderHelpPageDots() {
  helpPageDots.innerHTML = "";

  helpPages.forEach((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "help-page-dot";
    dot.setAttribute("aria-label", `Go to rules page ${index + 1}`);

    if (index === helpPageIndex) {
      dot.classList.add("is-active");
      dot.setAttribute("aria-current", "true");
    }

    dot.addEventListener("click", () => {
      helpPageIndex = index;
      renderHelpPage();
    });

    helpPageDots.appendChild(dot);
  });
}

function openGuessConfirmation(location) {
  pendingGuessConfirmationLocation = location;
  guessConfirmationModal.locationText.textContent = location;
  guessConfirmationModal.element.classList.remove("is-hidden");
  guessConfirmationModal.element.setAttribute("aria-hidden", "false");
  guessConfirmationModal.confirmButton.focus();
}

function closeGuessConfirmation() {
  pendingGuessConfirmationLocation = null;
  guessConfirmationModal.element.classList.add("is-hidden");
  guessConfirmationModal.element.setAttribute("aria-hidden", "true");
}

function closeRoleRevealModal() {
  roleRevealModal.element.classList.add("is-hidden");
  roleRevealModal.element.setAttribute("aria-hidden", "true");
}

function confirmSpyGuess() {
  const location = pendingGuessConfirmationLocation;

  if (!location || !canGuessLocation(latestRoom)) {
    closeGuessConfirmation();
    return;
  }

  clearStatus();

  pendingSpyGuessLocation = location;
  closeGuessConfirmation();
  renderRoom(latestRoom);

  socket.emit("spy_guess_location", {
    location
  });
}

function submitBeliefUpdate(button) {
  const beliefKey = button.dataset.beliefKey;
  const prompt = button.closest(".temporary-message");

  if (!beliefKey || !prompt || !latestRoom || !latestRoom.beliefUpdate) {
    return;
  }

  let questionerBelief = "";
  let answererBelief = "";
  let suspectedLocations = [];

  if (assignedRoleKind === "spy") {
    suspectedLocations = Array.from(prompt.querySelectorAll("input[data-belief-location]:checked"))
      .map(input => input.value);
  } else {
    const questionerRadio = prompt.querySelector("input[data-belief-target='questioner']:checked");
    const answererRadio = prompt.querySelector("input[data-belief-target='answerer']:checked");

    if (questionerRadio) {
      questionerBelief = questionerRadio.value;
    }

    if (answererRadio) {
      answererBelief = answererRadio.value;
    }
  }

  pendingBeliefUpdateKey = beliefKey;
  submittedBeliefUpdateKeys.add(beliefKey);

  clearStatus();
  renderRoom(latestRoom);

  socket.emit("submit_belief_update", {
    questionerBelief,
    answererBelief,
    suspectedLocations
  });
}

function submitAccusationVote(button) {
  const voteKey = button.dataset.voteKey;
  const vote = button.dataset.vote;

  if (!voteKey || !vote) {
    return;
  }

  pendingVoteKey = voteKey;
  submittedVoteKeys.add(voteKey);

  clearStatus();
  renderRoom(latestRoom);

  socket.emit("vote_accusation", {
    vote
  });
}

function renderRoom(room) {
  if (!room) {
    return;
  }

  if (room.status === "lobby") {
    showLobby();
    renderLobby(room);
    return;
  }

  if (room.status === "playing" || room.status === "finished") {
    showGame();
    renderGame(room);
  }
}

function showEntry() {
  entryScreen.classList.remove("is-hidden");
  lobbyScreen.classList.add("is-hidden");
  gameScreen.classList.add("is-hidden");
  lobbyWaitingText.hidden = true;
  closeGuessConfirmation();
  renderGameTimer();
  renderRoomIdBadge();
  helpButton.classList.toggle("is-pulsing", true);
  scheduleHelpButtonPosition();
}

function showLobby() {
  entryScreen.classList.add("is-hidden");
  lobbyScreen.classList.remove("is-hidden");
  gameScreen.classList.add("is-hidden");

  lobbyRoomCode.textContent = currentRoomCode || "----";
  lobbyPlayersList.innerHTML = "";
  startGameButton.disabled = true;
  leaveRoomButton.disabled = false;
  closeGuessConfirmation();
  renderGameTimer();
  renderRoomIdBadge();
  helpButton.classList.toggle("is-pulsing", true);
  scheduleHelpButtonPosition();
}

function showGame() {
  entryScreen.classList.add("is-hidden");
  lobbyScreen.classList.add("is-hidden");
  gameScreen.classList.remove("is-hidden");
  lobbyWaitingText.hidden = true;
  renderRoomIdBadge();
  helpButton.classList.toggle("is-pulsing", false);
  scheduleHelpButtonPosition();
}

function renderLobby(room) {
  lobbyRoomCode.textContent = currentRoomCode || "----";

  lobbyPlayersList.innerHTML = "";

  for (const player of sortPlayersForDisplay(room.players)) {
    const item = document.createElement("li");
    const name = document.createElement("span");

    name.textContent = player.name;
    item.appendChild(name);

    if (player.isHost) {
      const badge = document.createElement("span");
      badge.className = "host-badge";
      badge.textContent = "Host";
      item.appendChild(badge);
    }

    lobbyPlayersList.appendChild(item);
  }

  renderLobbyControls(room);
}

function renderLobbyControls(room) {
  const currentPlayer = findCurrentPlayer(room.players);
  const currentPlayerIsHost = Boolean(currentPlayer && currentPlayer.isHost);
  const hasEnoughPlayers = room.players.length >= MIN_PLAYERS;
  const roomIsOverLimit = room.players.length > MAX_PLAYERS;

  startGameButton.disabled = !currentPlayerIsHost || !hasEnoughPlayers || roomIsOverLimit;
  leaveRoomButton.disabled = false;

  if (!hasEnoughPlayers) {
    lobbyWaitingText.hidden = false;
    lobbyWaitingText.textContent =
      `Not enough players. ${room.players.length}/${MIN_PLAYERS} joined.`;
    return;
  }

  if (!currentPlayerIsHost) {
    lobbyWaitingText.hidden = false;
    lobbyWaitingText.textContent = "Waiting for host to start.";
    return;
  }

  lobbyWaitingText.hidden = true;
  lobbyWaitingText.textContent = "";
}

function renderGame(room) {
  renderGameState(room);
  renderGameTimer();
  renderRole();
  renderGamePlayers(room);
  renderAnswererOptions(room);
  renderChatControls(room);
  renderLocations(room);
  renderMessages(room);
}

function renderGameState(room) {
  gameStateCard.classList.remove("is-win", "is-loss", "is-your-action");

  if (room.status !== "finished" && isCurrentPlayerActionRequired(room)) {
    gameStateCard.classList.add("is-your-action");
  }

  if (room.status === "finished") {
    const personalResult = getPersonalResult(room);

    if (personalResult === "win") {
      gameStateCard.classList.add("is-win");
      gameStateText.textContent = "You won. Chat is open for discussion.";
      return;
    }

    if (personalResult === "loss") {
      gameStateCard.classList.add("is-loss");
      gameStateText.textContent = "You lost. Chat is open for discussion.";
      return;
    }

    gameStateText.textContent = "Game finished. Chat is open for discussion.";
    return;
  }

  const voteState = getActiveVoteState(room);

  if (voteState) {
    const progress = getVoteProgress(room, voteState);
    
    gameStateText.textContent =
      `Waiting for players to vote. ${progress.submittedCount}/${progress.totalCount} voted.`;

    return;
  }

  if (!room.turn) {
    gameStateText.textContent = "Waiting for the game to begin.";
    return;
  }

  if (room.turn.phase === "asking") {
    if (isCurrentUser(room.turn.currentQuestionerName)) {
      gameStateText.textContent = "Waiting for you to ask a question.";
    } else {
      gameStateText.textContent = `Waiting for ${room.turn.currentQuestionerName} to ask a question.`;
    }

    return;
  }

  if (room.turn.phase === "answering") {
    if (isCurrentUser(room.turn.currentAnswererName)) {
      gameStateText.textContent = `Waiting for you to answer ${room.turn.currentQuestionerName}.`;
    } else if (isCurrentUser(room.turn.currentQuestionerName)) {
      gameStateText.textContent = `Waiting for ${room.turn.currentAnswererName} to answer you.`;
    } else {
      gameStateText.textContent =
        `Waiting for ${room.turn.currentAnswererName} to answer ${room.turn.currentQuestionerName}.`;
    }

    return;
  }

  if (room.turn.phase === "belief") {
    if (room.beliefUpdate) {
      gameStateText.textContent =
        `Waiting for everyone to submit belief updates. ` +
        `${room.beliefUpdate.submittedCount}/${room.beliefUpdate.totalCount} submitted.`;
    } else {
      gameStateText.textContent = "Waiting for everyone to submit belief updates.";
    }

    return;
  }

  if (room.turn.phase === "final_accusing") {
    if (room.finalAccusation && isCurrentUser(room.finalAccusation.currentAccuserName)) {
      gameStateText.textContent = "Final accusation phase. Waiting for you to accuse.";
    } else if (room.finalAccusation) {
      gameStateText.textContent =
        `Final accusation phase. Waiting for ${room.finalAccusation.currentAccuserName} to accuse.`;
    } else {
      gameStateText.textContent = "Final accusation phase.";
    }

    return;
  }

  if (room.turn.phase === "final_voting") {
    gameStateText.textContent = "Final accusation vote in progress.";
    return;
  }

  gameStateText.textContent = "Waiting for the next action.";
}

function getPersonalResult(room) {
  const winningSide = getWinningSide(room.result);

  if (!winningSide || !assignedRoleKind) {
    return null;
  }

  if (assignedRoleKind === "spy") {
    return winningSide === "spy" ? "win" : "loss";
  }

  return winningSide === "agents" ? "win" : "loss";
}

function getWinningSide(result) {
  if (!result) {
    return null;
  }

  if (result.spyWon === true || result.spyWins === true) {
    return "spy";
  }

  if (result.agentsWon === true || result.agentsWin === true || result.playersWon === true) {
    return "agents";
  }

  const candidateValues = [
    result.winner,
    result.winningTeam,
    result.winningSide,
    result.outcome,
    result.result
  ];

  for (const value of candidateValues) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.toLowerCase();

    if (normalized.includes("spy")) {
      return "spy";
    }

    if (
      normalized.includes("agent") ||
      normalized.includes("agents") ||
      normalized.includes("player") ||
      normalized.includes("players") ||
      normalized.includes("crew") ||
      normalized.includes("non-spy") ||
      normalized.includes("non_spy")
    ) {
      return "agents";
    }
  }

  return null;
}

function renderGameTimer() {
  if (latestRoom && latestRoom.status === "finished") {
    gameTimerText.textContent = "";
    timerCard.classList.remove("is-urgent");
    timerCard.classList.add("is-replay");
    replayButton.hidden = false;
    return;
  }

  timerCard.classList.remove("is-replay");
  replayButton.hidden = true;

  if (!latestRoom || latestRoom.status !== "playing" || !latestRoom.roundEndsAt) {
    gameTimerText.textContent = "--:--";
    timerCard.classList.remove("is-urgent");
    return;
  }

  const roundEndsAt = new Date(latestRoom.roundEndsAt).getTime();
  const remainingMilliseconds = roundEndsAt - Date.now();
  const remainingSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  gameTimerText.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;

  timerCard.classList.toggle("is-urgent", remainingMilliseconds <= 60000);
}

function renderRole() {
  roleText.textContent = assignedRoleText;
}

function renderGamePlayers(room) {
  gamePlayersList.innerHTML = "";

  for (const player of sortPlayersForDisplay(room.players)) {
    const item = document.createElement("li");
    item.className = "player-row";
    item.dataset.playerName = player.name;

    const name = document.createElement("span");
    name.className = "player-name-line";
    name.textContent = player.isHost ? `${player.name} · Host` : player.name;
    item.appendChild(name);

    const actions = document.createElement("div");
    actions.className = "player-actions";

    if (isCurrentUser(player.name)) {
      actions.appendChild(createEmotePicker());
    }

    if (!isCurrentUser(player.name)) {
      const emoteSlot = document.createElement("span");
      emoteSlot.className = "emote-play-slot";
      actions.appendChild(emoteSlot);

      const tooltip = document.createElement("span");
      tooltip.className = "tooltip-wrap player-action-slot";
      tooltip.dataset.tooltip = `Do you want to accuse ${player.name} of being the spy?`;

      const accuseButton = document.createElement("button");
      accuseButton.className = "accuse-button";
      accuseButton.type = "button";
      accuseButton.dataset.accusedName = player.name;
      accuseButton.disabled = !canAccuse(player, room);

      const icon = document.createElement("span");
      icon.className = "material-symbols-rounded";
      icon.textContent = "gavel";

      accuseButton.appendChild(icon);
      tooltip.appendChild(accuseButton);
      actions.appendChild(tooltip);
    }

    item.appendChild(actions);
    gamePlayersList.appendChild(item);
  }
}

function createEmotePicker() {
  const picker = document.createElement("span");
  picker.className = "emote-picker";

  picker.addEventListener("mouseleave", () => {
    picker.classList.remove("is-closed");
  });

  const trigger = document.createElement("span");
  trigger.className = "emote-button";
  trigger.setAttribute("aria-label", "Choose emote");

  const icon = document.createElement("span");
  icon.className = "material-symbols-rounded";
  icon.textContent = "mood";

  trigger.appendChild(icon);
  picker.appendChild(trigger);

  const popover = document.createElement("div");
  popover.className = "emote-popover";

  for (const emote of EMOTES) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "emote-option";
    option.dataset.emoteId = emote.id;
    option.setAttribute("aria-label", emote.label);

    option.appendChild(createEmotePicture(emote));

    popover.appendChild(option);
  }

  picker.appendChild(popover);

  return picker;
}

function createEmotePicture(emote) {
  const picture = document.createElement("picture");

  picture.innerHTML = `
    <source srcset="https://fonts.gstatic.com/s/e/notoemoji/latest/${emote.codepoint}/512.webp" type="image/webp">
    <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/${emote.codepoint}/512.webp" alt="${emote.label}">
  `;

  return picture;
}

function playEmoteAnimation(playerName, emoteId) {
  const emote = EMOTES.find(emote => emote.id === emoteId);
  const row = findPlayerRow(playerName);

  if (isCurrentUser(playerName)) {
    const button = row.querySelector(".emote-button");

    button.classList.add("is-playing");
    button.innerHTML = "";
    button.appendChild(createEmoteBurst(emote));

    setTimeout(() => {
      button.classList.remove("is-playing");
      button.innerHTML = "";

      const icon = document.createElement("span");
      icon.className = "material-symbols-rounded";
      icon.textContent = "mood";

      button.appendChild(icon);
    }, 4000);

    return;
  }

  const slot = row.querySelector(".emote-play-slot");

  slot.innerHTML = "";
  slot.appendChild(createEmoteBurst(emote));

  setTimeout(() => {
    slot.innerHTML = "";
  }, 4000);
}

function findPlayerRow(playerName) {
  return Array.from(gamePlayersList.querySelectorAll(".player-row")).find(row => {
    return namesMatch(row.dataset.playerName, playerName);
  });
}

function createEmoteBurst(emote) {
  const burst = document.createElement("span");
  burst.className = "emote-burst";
  burst.appendChild(createEmotePicture(emote));

  return burst;
}

function renderAnswererOptions(room) {
  const previousValue = answererSelect.value;
  const forbiddenAnswererName = getForbiddenAnswererName(room);

  answererSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose who to ask";
  placeholder.disabled = true;
  placeholder.selected = true;
  answererSelect.appendChild(placeholder);

  for (const player of sortPlayersAlphabetically(room.players)) {
    if (isCurrentUser(player.name)) {
      continue;
    }

    if (forbiddenAnswererName && namesMatch(player.name, forbiddenAnswererName)) {
      continue;
    }

    const option = document.createElement("option");
    option.value = player.name;
    option.textContent = player.name;
    answererSelect.appendChild(option);
  }

  const previousOptionStillExists = Array.from(answererSelect.options).some(option => {
    return option.value === previousValue && previousValue !== "";
  });

  if (previousOptionStillExists) {
    answererSelect.value = previousValue;
  } else {
    answererSelect.value = "";
  }
}

function getForbiddenAnswererName(room) {
  if (!room || !room.turn || room.turn.phase !== "asking") {
    return null;
  }

  if (!isCurrentUser(room.turn.currentQuestionerName)) {
    return null;
  }

  const latestQuestion = [...room.messages].reverse().find(message => {
    return message.type === "question";
  });

  if (!latestQuestion) {
    return null;
  }

  if (!isCurrentUser(latestQuestion.recipientName)) {
    return null;
  }

  return latestQuestion.senderName;
}

function renderChatControls(room) {
  const canDiscuss = room.status === "finished";
  const chatIsLocked = isBeliefCollectionActive(room) || Boolean(getActiveVoteState(room));

  const canAsk =
    room.status === "playing" &&
    !chatIsLocked &&
    room.turn &&
    room.turn.phase === "asking" &&
    isCurrentUser(room.turn.currentQuestionerName);

  const canAnswer =
    room.status === "playing" &&
    !chatIsLocked &&
    room.turn &&
    room.turn.phase === "answering" &&
    isCurrentUser(room.turn.currentAnswererName);

  const hasEligibleAnswerer = Array.from(answererSelect.options).some(option => {
    return option.value !== "";
  });

  const hasChosenAnswerer = answererSelect.value !== "";

  chatControls.classList.toggle("is-answer-mode", canAnswer);
  chatControls.classList.toggle("is-discussion", canDiscuss);
  chatControls.classList.toggle("is-waiting", chatIsLocked || (!canDiscuss && !canAsk && !canAnswer));

  if (canDiscuss) {
    answererSelect.disabled = true;
    chatMessageInput.disabled = false;
    sendChatMessageButton.disabled = false;
    chatMessageInput.placeholder = "Discuss the game";
    return;
  }

  if (chatIsLocked) {
    answererSelect.disabled = true;
    chatMessageInput.disabled = true;
    sendChatMessageButton.disabled = true;

    if (isBeliefCollectionActive(room)) {
      chatMessageInput.placeholder = "Belief updates in progress";
    } else {
      chatMessageInput.placeholder = "Voting in progress";
    }

    return;
  }

  answererSelect.disabled = !canAsk || !hasEligibleAnswerer;

  chatMessageInput.disabled =
    (!canAsk && !canAnswer) ||
    (canAsk && (!hasEligibleAnswerer || !hasChosenAnswerer));

  sendChatMessageButton.disabled =
    (!canAsk && !canAnswer) ||
    (canAsk && (!hasEligibleAnswerer || !hasChosenAnswerer));

  if (canAsk && hasEligibleAnswerer && !hasChosenAnswerer) {
    chatMessageInput.placeholder = "Choose who to ask first";
    return;
  }

  if (canAsk && hasEligibleAnswerer && hasChosenAnswerer) {
    chatMessageInput.placeholder = "e.g. what is your favourite memory here?";
    return;
  }

  if (canAsk && !hasEligibleAnswerer) {
    chatMessageInput.placeholder = "No valid player to ask";
    return;
  }

  if (canAnswer) {
    chatMessageInput.placeholder = "Type your answer";
    return;
  }

  chatMessageInput.placeholder = "Waiting for your turn";
}

function isBeliefCollectionActive(room) {
  if (!room || room.status !== "playing") {
    return false;
  }

  if (room.turn && room.turn.phase === "belief") {
    return true;
  }

  return Boolean(room.beliefUpdate);
}

function renderLocations(room) {
  locationsList.innerHTML = "";

  for (const location of room.locations) {
    const isOwnAgentLocation =
      assignedRoleKind !== "spy" &&
      assignedLocation &&
      namesMatch(location, assignedLocation);

    const item = document.createElement("li");
    item.className = "location-row";

    if (isOwnAgentLocation) {
      item.classList.add("is-own-location");
    }

    const name = document.createElement("span");
    name.className = "location-name-line";

    const nameText = document.createElement("span");
    nameText.className = "location-name-text";
    nameText.textContent = location;
    name.appendChild(nameText);

    if (isOwnAgentLocation) {
      const secretBadge = document.createElement("span");
      secretBadge.className = "secret-location-badge";
      secretBadge.textContent = "Secret";
      name.appendChild(secretBadge);
    }

    item.appendChild(name);

    const tooltip = document.createElement("span");
    tooltip.className = "tooltip-wrap location-action-slot";
    tooltip.dataset.tooltip = `Do you want to guess that ${location} is the hidden location?`;

    const guessButton = document.createElement("button");
    guessButton.type = "button";
    guessButton.className = "guess-button";
    guessButton.dataset.location = location;
    guessButton.disabled = !canGuessLocation(room);

    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = "add_location_alt";

    guessButton.appendChild(icon);
    tooltip.appendChild(guessButton);
    item.appendChild(tooltip);

    if (assignedRoleKind !== "spy") {
      tooltip.classList.add("is-hidden-action");
    }

    locationsList.appendChild(item);
  }
}

function renderMessages(room) {
  messagesList.innerHTML = "";

  for (const message of room.messages) {
    const item = document.createElement("li");

    if (message.type === "question") {
      item.className = "question-message";
      item.textContent = `${message.senderName} → ${message.recipientName}: ${message.text}`;
    } else if (message.type === "answer") {
      item.className = "answer-message";
      item.textContent = `${message.senderName}: ${message.text}`;
    } else if (message.type === "system") {
      item.className = "system-message";
      item.textContent = message.text;
    } else {
      item.textContent = `${message.senderName}: ${message.text}`;
    }

    messagesList.appendChild(item);
  }

  renderTemporarySystemPrompt(room);

  messagesList.scrollTop = messagesList.scrollHeight;
}

function renderTemporarySystemPrompt(room) {
  const beliefPrompt = createBeliefPrompt(room);

  if (beliefPrompt) {
    messagesList.appendChild(beliefPrompt);
    return;
  }

  const votePrompt = createVotePrompt(room);

  if (votePrompt) {
    messagesList.appendChild(votePrompt);
  }
}

function createBeliefPrompt(room) {
  if (!room || room.status !== "playing" || !room.beliefUpdate || !room.turn || room.turn.phase !== "belief") {
    return null;
  }

  const beliefKey = buildBeliefUpdateKey(room);

  if (!beliefKey) {
    return null;
  }

  if (pendingBeliefUpdateKey === beliefKey || submittedBeliefUpdateKeys.has(beliefKey)) {
    return null;
  }

  const draft = beliefDrafts.get(beliefKey) || {
    questionerBelief: "",
    answererBelief: "",
    suspectedLocations: []
  };

  const prompt = document.createElement("li");
  prompt.className = "temporary-message belief-prompt";

  const intro = document.createElement("p");
  intro.className = "prompt-body";
  intro.textContent = "This is private. It will not appear in the chat log.";
  prompt.appendChild(intro);

  if (assignedRoleKind === "spy") {
    prompt.appendChild(createSpyBeliefForm(room, draft));
  } else {
    prompt.appendChild(createAgentBeliefForm(room, draft));
  }

  const actions = document.createElement("div");
  actions.className = "prompt-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary submit-belief-button";
  button.dataset.beliefKey = beliefKey;
  button.textContent = "Submit";

  actions.appendChild(button);
  prompt.appendChild(actions);

  return prompt;
}

function createAgentBeliefForm(room, draft) {
  const form = document.createElement("div");
  form.className = "belief-form";

  const questionerName = room.beliefUpdate.questionerName;
  const answererName = room.beliefUpdate.answererName;

  const currentUserIsQuestioner = isCurrentUser(questionerName);
  const currentUserIsAnswerer = isCurrentUser(answererName);

  if (!currentUserIsQuestioner) {
    form.appendChild(createBeliefScaleQuestion(
      "questioner",
      `Does ${questionerName} seem more or less like a spy?`,
      draft.questionerBelief
    ));
  }

  if (!currentUserIsAnswerer) {
    form.appendChild(createBeliefScaleQuestion(
      "answerer",
      `Does ${answererName} seem more or less like a spy?`,
      draft.answererBelief
    ));
  }

  return form;
}

function createSpyBeliefForm(room, draft) {
  const form = document.createElement("div");
  form.className = "belief-form";

  const question = document.createElement("p");
  question.className = "belief-question";
  question.textContent = "Which of these locations became more likely (select 0 or more)?";
  form.appendChild(question);

  const options = document.createElement("div");
  options.className = "spy-belief-location-grid";

  const locations = room.beliefUpdate.spyLocationOptions || [];

  for (const location of locations) {
    const label = document.createElement("label");
    label.className = "spy-belief-location-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = location;
    checkbox.dataset.beliefLocation = "true";
    checkbox.checked = draft.suspectedLocations.includes(location);

    const text = document.createElement("span");
    text.textContent = location;

    label.appendChild(checkbox);
    label.appendChild(text);
    options.appendChild(label);
  }

  form.appendChild(options);

  return form;
}

function createBeliefScaleQuestion(target, labelText, selectedValue = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "belief-scale";

  const text = document.createElement("p");
  text.className = "belief-question";
  text.textContent = labelText;
  wrapper.appendChild(text);

  const options = document.createElement("div");
  options.className = "belief-options";

  const choices = [
    { value: "-", label: "Less spy-like" },
    { value: "N", label: "No difference" },
    { value: "+", label: "More spy-like" }
  ];

  for (const choice of choices) {
    const label = document.createElement("label");
    label.className = "belief-radio";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = `belief-${target}`;
    input.value = choice.value;
    input.dataset.beliefTarget = target;
    input.checked = choice.value === selectedValue;

    const span = document.createElement("span");
    span.textContent = choice.label;

    label.appendChild(input);
    label.appendChild(span);
    options.appendChild(label);
  }

  wrapper.appendChild(options);

  return wrapper;
}

function createVotePrompt(room) {
  const voteState = getActiveVoteState(room);

  if (!voteState) {
    return null;
  }

  if (!voteState.pendingVoterNames.some(name => isCurrentUser(name))) {
    return null;
  }

  if (submittedVoteKeys.has(voteState.key)) {
    return null;
  }

  const prompt = document.createElement("li");
  prompt.className = "temporary-message vote-prompt";

  const title = document.createElement("h3");
  title.className = "prompt-title";
  title.textContent = voteState.isFinal ? "Final accusation vote" : "Accusation vote";
  prompt.appendChild(title);

  const body = document.createElement("p");
  body.className = "prompt-body";
  body.textContent = `${voteState.accuserName} accused ${voteState.accusedName}. Do you agree?`;
  prompt.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "vote-actions";

  const yesButton = document.createElement("button");
  yesButton.type = "button";
  yesButton.className = "button button-primary vote-button";
  yesButton.dataset.vote = "yes";
  yesButton.dataset.voteKey = voteState.key;
  yesButton.textContent = "Vote yes";

  const noButton = document.createElement("button");
  noButton.type = "button";
  noButton.className = "button button-danger vote-button";
  noButton.dataset.vote = "no";
  noButton.dataset.voteKey = voteState.key;
  noButton.textContent = "Vote no";

  actions.appendChild(yesButton);
  actions.appendChild(noButton);
  prompt.appendChild(actions);

  return prompt;
}

function getActiveVoteState(room) {
  if (room.accusation) {
    return {
      key: `normal:${room.accusation.accuserName}:${room.accusation.accusedName}`,
      isFinal: false,
      accuserName: room.accusation.accuserName,
      accusedName: room.accusation.accusedName,
      pendingVoterNames: room.accusation.pendingVoterNames
    };
  }

  if (room.finalAccusation && room.finalAccusation.accusedName) {
    return {
      key:
        `final:${room.finalAccusation.currentAccuserNumber}:` +
        `${room.finalAccusation.currentAccuserName}:${room.finalAccusation.accusedName}`,
      isFinal: true,
      accuserName: room.finalAccusation.currentAccuserName,
      accusedName: room.finalAccusation.accusedName,
      pendingVoterNames: room.finalAccusation.pendingVoterNames
    };
  }

  return null;
}

function canAccuse(player, room) {
  if (!room || room.status !== "playing") {
    return false;
  }

  if (isCurrentUser(player.name)) {
    return false;
  }

  if (pendingAccusationName) {
    return false;
  }

  if (room.turn && room.turn.phase === "belief") {
    return false;
  }

  if (room.beliefUpdate) {
    return false;
  }

  if (room.accusation) {
    return false;
  }

  if (room.finalAccusation) {
    return canMakeFinalAccusation(room);
  }

  if (normalAccusationUsed) {
    return false;
  }

  return true;
}

function canGuessLocation(room) {
  if (!room || room.status !== "playing") {
    return false;
  }

  if (assignedRoleKind !== "spy") {
    return false;
  }

  if (pendingSpyGuessLocation) {
    return false;
  }

  if (room.turn && room.turn.phase === "belief") {
    return false;
  }

  if (room.beliefUpdate) {
    return false;
  }

  if (room.finalAccusation) {
    return false;
  }

  return true;
}

function canMakeFinalAccusation(room) {
  if (!room.turn || room.turn.phase !== "final_accusing") {
    return false;
  }

  if (!room.finalAccusation) {
    return false;
  }

  return isCurrentUser(room.finalAccusation.currentAccuserName);
}

function updateLocalAccusationState(room) {
  if (!room || !room.players) {
    return;
  }

  if (room.status === "lobby") {
    normalAccusationUsed = false;
    pendingAccusationName = null;
    pendingSpyGuessLocation = null;
    return;
  }

  if (room.status === "finished") {
    pendingAccusationName = null;
    pendingSpyGuessLocation = null;
  }

  if (room.accusation && isCurrentUser(room.accusation.accuserName)) {
    normalAccusationUsed = true;
    pendingAccusationName = null;
    return;
  }

  if (room.messages.some(message => isOwnNormalAccusationMessage(message))) {
    normalAccusationUsed = true;
  }

  if (pendingAccusationName && room.accusation) {
    pendingAccusationName = null;
  }

  if (pendingAccusationName && room.finalAccusation && room.finalAccusation.accusedName) {
    pendingAccusationName = null;
  }
}

function clearFinishedPendingState(room) {
  if (!room) {
    return;
  }

  if (pendingBeliefUpdateKey && buildBeliefUpdateKey(room) !== pendingBeliefUpdateKey) {
    pendingBeliefUpdateKey = null;
  }

  if (pendingVoteKey && !getActiveVoteState(room)) {
    pendingVoteKey = null;
  }

  if (room.status === "finished") {
    pendingSpyGuessLocation = null;
  }
}

function buildBeliefUpdateKey(room) {
  if (!room || !room.beliefUpdate) {
    return null;
  }

  const lastAnswerIndex = room.messages.reduce((latestIndex, message, index) => {
    if (message.type === "answer") {
      return index;
    }

    return latestIndex;
  }, -1);

  return [
    "belief",
    room.beliefUpdate.questionerName,
    room.beliefUpdate.answererName,
    lastAnswerIndex
  ].join(":");
}

function isOwnNormalAccusationMessage(message) {
  if (message.type !== "system") {
    return false;
  }

  const currentName = getCurrentUserName();

  if (!currentName) {
    return false;
  }

  return message.text.startsWith(`${currentName} accused `);
}

function sortPlayersForDisplay(players) {
  const currentPlayer = findCurrentPlayer(players);
  const others = players.filter(player => {
    return !isCurrentUser(player.name);
  });

  others.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  if (!currentPlayer) {
    return others;
  }

  return [currentPlayer, ...others];
}

function sortPlayersAlphabetically(players) {
  return [...players].sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function findCurrentPlayer(players) {
  const currentName = getCurrentUserName().toLowerCase();

  return players.find(player => {
    return player.name.toLowerCase() === currentName;
  });
}

function isCurrentUser(playerName) {
  if (!playerName) {
    return false;
  }

  return namesMatch(playerName, getCurrentUserName());
}

function namesMatch(a, b) {
  if (!a || !b) {
    return false;
  }

  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function getCurrentUserName() {
  return nameInput.value.trim();
}

function resetGameLocalState() {
  assignedRoleText = "Waiting for role.";
  assignedRoleKind = null;
  assignedLocation = null;
  normalAccusationUsed = false;
  pendingAccusationName = null;
  pendingBeliefUpdateKey = null;
  pendingVoteKey = null;
  pendingSpyGuessLocation = null;
  pendingGuessConfirmationLocation = null;
  submittedBeliefUpdateKeys.clear();
  submittedVoteKeys.clear();
  beliefDrafts.clear();
  closeGuessConfirmation();
}

function createGuessConfirmationModal() {
  let element = document.querySelector("#guess-confirmation-modal");

  if (element) {
    return {
      element,
      backdrop: element.querySelector(".modal-backdrop"),
      locationText: element.querySelector("#guess-confirmation-location"),
      confirmButton: element.querySelector("#confirm-location-guess"),
      cancelButton: element.querySelector("#cancel-location-guess"),
      closeButton: element.querySelector("#close-location-guess")
    };
  }

  element = document.createElement("div");
  element.id = "guess-confirmation-modal";
  element.className = "modal-overlay is-hidden";
  element.setAttribute("aria-hidden", "true");

  element.innerHTML = `
    <div class="modal-backdrop"></div>

    <section class="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="guess-confirmation-title">
      <button id="close-location-guess" class="modal-close" type="button" aria-label="Close">
        ×
      </button>

      <p class="mini-label">Confirm guess</p>

      <h2 id="guess-confirmation-title">Guess hidden location?</h2>

      <p class="modal-copy">
        Are you sure you want to guess <strong id="guess-confirmation-location"></strong>
        as the hidden location? This will terminate the game.
      </p>

      <div class="modal-actions">
        <button id="cancel-location-guess" class="button button-secondary" type="button">
          Cancel
        </button>

        <button id="confirm-location-guess" class="button button-danger" type="button">
          Guess location
        </button>
      </div>
    </section>
  `;

  document.body.appendChild(element);

  return {
    element,
    backdrop: element.querySelector(".modal-backdrop"),
    locationText: element.querySelector("#guess-confirmation-location"),
    confirmButton: element.querySelector("#confirm-location-guess"),
    cancelButton: element.querySelector("#cancel-location-guess"),
    closeButton: element.querySelector("#close-location-guess")
  };
}

function createRoleRevealModal() {
  let element = document.querySelector("#role-reveal-modal");

  if (element) {
    return {
      element,
      backdrop: element.querySelector(".modal-backdrop"),
      message: element.querySelector("#role-reveal-message"),
      closeButton: element.querySelector("#close-role-reveal"),
      acknowledgeButton: element.querySelector("#acknowledge-role")
    };
  }

  element = document.createElement("div");
  element.id = "role-reveal-modal";
  element.className = "modal-overlay is-hidden";
  element.setAttribute("aria-hidden", "true");

  element.innerHTML = `
    <div class="modal-backdrop"></div>
    <section class="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="role-reveal-title">
      <button id="close-role-reveal" class="modal-close" type="button" aria-label="Close">×</button>
      <h2 id="role-reveal-title"></h2>
      <p id="role-reveal-message" class="modal-copy"></p>
      <div class="modal-actions">
        <button id="acknowledge-role" class="button button-primary" type="button">Got it!</button>
      </div>
    </section>
  `;

  document.body.appendChild(element);

  return {
    element,
    backdrop: element.querySelector(".modal-backdrop"),
    title: element.querySelector("#role-reveal-title"),
    message: element.querySelector("#role-reveal-message"),
    closeButton: element.querySelector("#close-role-reveal"),
    acknowledgeButton: element.querySelector("#acknowledge-role")
  };
}

function showError(message) {
  statusText.textContent = message;
  statusText.classList.add("is-visible");

  clearTimeout(statusTimer);

  statusTimer = setTimeout(() => {
    clearStatus();
  }, 3000);
}

function clearStatus() {
  clearTimeout(statusTimer);
  statusTimer = null;

  statusText.textContent = "";
  statusText.classList.remove("is-visible");
}

function setEntryBusy(isBusy) {
  entryIsBusy = isBusy;
  updateEntryButtons();
}

function updateEntryButtons() {
  const hasConsent = hasRequiredResearchConsent();
  const shouldDisable = entryIsBusy || !hasConsent;

  createRoomButton.disabled = shouldDisable;
  joinRoomButton.disabled = shouldDisable;
  joinRandomRoomButton.disabled = shouldDisable;
}

function hasRequiredResearchConsent() {
  return researchDataConsentInput.checked && noPiiConsentInput.checked;
}

function setLobbyBusy(isBusy) {
  startGameButton.disabled = isBusy;
  leaveRoomButton.disabled = isBusy;
}

function createReplayButton() {
  let button = document.querySelector("#replay-game");

  if (button) {
    return button;
  }

  button = document.createElement("button");
  button.id = "replay-game";
  button.type = "button";
  button.className = "button button-primary replay-button";
  button.textContent = "New Game";
  button.hidden = true;

  button.addEventListener("click", () => {
    socket.emit("leave_room");
  });

  timerCard.appendChild(button);

  return button;
}

function isCurrentPlayerActionRequired(room) {
  if (!room || room.status !== "playing") {
    return false;
  }

  if (pendingAccusationName) {
    return false;
  }

  const voteState = getActiveVoteState(room);

  if (voteState) {
    return currentUserNeedsAccusationVote(room);
  }

  if (!room.turn) {
    return false;
  }

  if (room.turn.phase === "asking") {
    return isCurrentUser(room.turn.currentQuestionerName);
  }

  if (room.turn.phase === "answering") {
    return isCurrentUser(room.turn.currentAnswererName);
  }

  if (room.turn.phase === "belief") {
    return currentUserNeedsBeliefUpdate(room);
  }

  if (room.turn.phase === "final_accusing") {
    return Boolean(
      room.finalAccusation &&
      isCurrentUser(room.finalAccusation.currentAccuserName)
    );
  }

  if (room.turn.phase === "final_voting") {
    return currentUserNeedsAccusationVote(room);
  }

  return false;
}

function currentUserNeedsBeliefUpdate(room) {
  if (!room || !room.beliefUpdate || !room.turn || room.turn.phase !== "belief") {
    return false;
  }

  const beliefKey = buildBeliefUpdateKey(room);

  if (!beliefKey) {
    return false;
  }

  return (
    pendingBeliefUpdateKey !== beliefKey &&
    !submittedBeliefUpdateKeys.has(beliefKey)
  );
}

function currentUserNeedsAccusationVote(room) {
  const voteState = getActiveVoteState(room);

  if (!voteState) {
    return false;
  }

  if (pendingVoteKey === voteState.key || submittedVoteKeys.has(voteState.key)) {
    return false;
  }

  return voteState.pendingVoterNames.some(name => isCurrentUser(name));
}

function getVoteProgress(room, voteState) {
  const pendingCount = voteState.pendingVoterNames.length;

  let totalCount = null;

  if (Number.isInteger(voteState.totalCount)) {
    totalCount = voteState.totalCount;
  } else if (Number.isInteger(voteState.voterCount)) {
    totalCount = voteState.voterCount;
  } else if (room && Array.isArray(room.players)) {
    totalCount = Math.max(0, room.players.length - 1);
  }

  if (!Number.isInteger(totalCount)) {
    totalCount = pendingCount;
  }

  return {
    submittedCount: Math.max(0, totalCount - pendingCount),
    totalCount
  };
}

function renderRoomIdBadge() {
  if (!roomIdBadge) {
    return;
  }

  if (!latestRoom) {
    roomIdBadge.hidden = true;
    roomIdBadge.textContent = "";
    return;
  }

  roomIdBadge.hidden = false;
  roomIdBadge.textContent = `Room ${latestRoom.id}`;
}

function getOrCreatePlayerSignature() {
  const existingSignature = localStorage.getItem(PLAYER_SIGNATURE_STORAGE_KEY);

  if (existingSignature) {
    return existingSignature;
  }

  const newSignature = window.crypto.randomUUID();
  localStorage.setItem(PLAYER_SIGNATURE_STORAGE_KEY, newSignature);

  return newSignature;
}

function clearResearchConsent() {
  researchDataConsentInput.checked = false;
  noPiiConsentInput.checked = false;
  updateEntryButtons();
}

function playEmote(option) {
  const picker = option.closest(".emote-picker");
  const emoteId = option.dataset.emoteId;

  picker.classList.add("is-closed");

  socket.emit("play_emote", {
    emoteId
  });
}

showEntry();
renderHelpPage();
updateEntryButtons();

// UI scale

function updateUiScale() {
  const scale = Math.min(1, Math.max(0.82, window.innerHeight / 1352));
  document.documentElement.style.setProperty("--ui-scale", String(scale));
}

window.addEventListener("resize", updateUiScale);
window.addEventListener("load", updateUiScale);
updateUiScale();