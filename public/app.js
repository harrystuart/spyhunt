const socket = io();

const nameInput = document.querySelector("#name");
const emailInput = document.querySelector("#email");
const roomCodeInput = document.querySelector("#room-code");
const createRoomButton = document.querySelector("#create-room");
const joinRoomButton = document.querySelector("#join-room");
const startGameButton = document.querySelector("#start-game");
const leaveRoomButton = document.querySelector("#leave-room");
const status = document.querySelector("#status");
const role = document.querySelector("#role");
const turn = document.querySelector("#turn");
const result = document.querySelector("#result");
const beliefUpdate = document.querySelector("#belief-update");
const beliefQuestionerLine = document.querySelector("#belief-questioner-line");
const beliefAnswererLine = document.querySelector("#belief-answerer-line");
const questionerBeliefSelect = document.querySelector("#questioner-belief");
const answererBeliefSelect = document.querySelector("#answerer-belief");
const submitBeliefUpdateButton = document.querySelector("#submit-belief-update");
const spyGuessLocationSelect = document.querySelector("#spy-guess-location");
const spyGuessButton = document.querySelector("#spy-guess");
const accusation = document.querySelector("#accusation");
const accusedSelect = document.querySelector("#accused");
const startAccusationButton = document.querySelector("#start-accusation");
const voteYesButton = document.querySelector("#vote-yes");
const voteNoButton = document.querySelector("#vote-no");
const playersList = document.querySelector("#players");
const messagesList = document.querySelector("#messages");
const answererSelect = document.querySelector("#answerer");
const chatMessageInput = document.querySelector("#chat-message");
const sendChatMessageButton = document.querySelector("#send-chat-message");

socket.on("connect", () => {
  status.textContent = `Connected as ${socket.id}`;
});

createRoomButton.addEventListener("click", () => {
  socket.emit("create_room", {
    name: nameInput.value,
    email: emailInput.value
  });
});

joinRoomButton.addEventListener("click", () => {
  socket.emit("join_room", {
    code: roomCodeInput.value,
    name: nameInput.value,
    email: emailInput.value
  });
});

startGameButton.addEventListener("click", () => {
  socket.emit("start_game");
});

leaveRoomButton.addEventListener("click", () => {
  socket.emit("leave_room");
});

submitBeliefUpdateButton.addEventListener("click", () => {
  socket.emit("submit_belief_update", {
    questionerBelief: questionerBeliefSelect.value,
    answererBelief: answererBeliefSelect.value
  });
});

spyGuessButton.addEventListener("click", () => {
  socket.emit("spy_guess_location", {
    location: spyGuessLocationSelect.value
  });
});

startAccusationButton.addEventListener("click", () => {
  socket.emit("start_accusation", {
    accusedName: accusedSelect.value
  });
});

voteYesButton.addEventListener("click", () => {
  socket.emit("vote_accusation", {
    vote: "yes"
  });
});

voteNoButton.addEventListener("click", () => {
  socket.emit("vote_accusation", {
    vote: "no"
  });
});

sendChatMessageButton.addEventListener("click", () => {
  sendMessage();
});

chatMessageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

function sendMessage() {
  socket.emit("send_chat_message", {
    text: chatMessageInput.value,
    answererName: answererSelect.value
  });

  chatMessageInput.value = "";
}

socket.on("room_created", ({ code }) => {
  roomCodeInput.value = code;
  role.textContent = "";
  turn.textContent = "";
  result.textContent = "";
  beliefUpdate.textContent = "";
  accusation.textContent = "";
  status.textContent = `Created room ${code}`;
});

socket.on("room_joined", ({ code }) => {
  roomCodeInput.value = code;
  role.textContent = "";
  turn.textContent = "";
  result.textContent = "";
  beliefUpdate.textContent = "";
  accusation.textContent = "";
  status.textContent = `Joined room ${code}`;
});

socket.on("room_left", () => {
  roomCodeInput.value = "";
  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  answererSelect.innerHTML = "";
  accusedSelect.innerHTML = "";
  spyGuessLocationSelect.innerHTML = "";
  role.textContent = "";
  turn.textContent = "";
  result.textContent = "";
  beliefUpdate.textContent = "";
  accusation.textContent = "";
  status.textContent = "Left room";
});

socket.on("room_destroyed", ({ message }) => {
  roomCodeInput.value = "";
  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  answererSelect.innerHTML = "";
  accusedSelect.innerHTML = "";
  spyGuessLocationSelect.innerHTML = "";
  role.textContent = "";
  turn.textContent = "";
  result.textContent = "";
  beliefUpdate.textContent = "";
  accusation.textContent = "";
  status.textContent = "Room destroyed";
  alert(message);
});

socket.on("room_updated", ({
  status: roomStatus,
  turn: currentTurn,
  beliefUpdate: currentBeliefUpdate,
  accusation: currentAccusation,
  result: gameResult,
  locations,
  players,
  messages
}) => {
  status.textContent = `Room status: ${roomStatus}`;

  if (!currentTurn) {
    turn.textContent = roomStatus === "finished" ? "Game finished." : "Free chat before the game starts.";
  } else if (currentTurn.phase === "asking") {
    turn.textContent = `${currentTurn.currentQuestionerName} asks next.`;
  } else if (currentTurn.phase === "answering") {
    turn.textContent = `${currentTurn.currentAnswererName} is answering ${currentTurn.currentQuestionerName}.`;
  } else {
    turn.textContent = "Belief updates are pending.";
  }

  if (!currentBeliefUpdate) {
    beliefUpdate.textContent = "No active belief update.";
    beliefQuestionerLine.textContent = "Does the questioner seem more or less like a spy?";
    beliefAnswererLine.textContent = "Does the answerer seem more or less like a spy?";
  } else {
    beliefUpdate.textContent =
      `Belief update for ${currentBeliefUpdate.questionerName} asking ${currentBeliefUpdate.answererName}. ` +
      `${currentBeliefUpdate.submittedCount} of ${currentBeliefUpdate.totalCount} submitted.`;

    beliefQuestionerLine.textContent =
      `Does the questioner ${currentBeliefUpdate.questionerName} seem more or less like a spy?`;

    beliefAnswererLine.textContent =
      `Does the answerer ${currentBeliefUpdate.answererName} seem more or less like a spy?`;
  }

  if (!gameResult) {
    result.textContent = "";
  } else if (gameResult.reason === "spy_guessed_location") {
    result.textContent =
      `Spy wins. ${gameResult.spyName} correctly guessed ${gameResult.guessedLocation}.`;
  } else if (gameResult.reason === "spy_wrong_location_guess") {
    result.textContent =
      `Players win. ${gameResult.spyName} guessed ${gameResult.guessedLocation}, but the location was ${gameResult.location}.`;
  } else if (gameResult.winner === "players") {
    result.textContent =
      `Players win. ${gameResult.accusedName} was the spy. Location was ${gameResult.location}.`;
  } else {
    result.textContent =
      `Spy wins. ${gameResult.accusedName} was not the spy. The spy was ${gameResult.spyName}. Location was ${gameResult.location}.`;
  }

  if (!currentAccusation) {
    accusation.textContent = "No active accusation.";
  } else {
    const voteText = currentAccusation.votes
      .map(vote => {
        if (vote.automatic) {
          return `${vote.voterName}: ${vote.vote} (accusation)`;
        }

        return `${vote.voterName}: ${vote.vote}`;
      })
      .join(", ");

    const pendingText = currentAccusation.pendingVoterNames.join(", ");

    accusation.textContent =
      `${currentAccusation.accuserName} accused ${currentAccusation.accusedName}. ` +
      `Votes so far: ${voteText}. ` +
      (pendingText ? `Waiting for: ${pendingText}.` : "All eligible votes are in.");
  }

  playersList.innerHTML = "";

  for (const player of players) {
    const li = document.createElement("li");
    li.textContent = player.isHost ? `${player.name} (host)` : player.name;
    playersList.appendChild(li);
  }

  answererSelect.innerHTML = "";
  accusedSelect.innerHTML = "";

  for (const player of players) {
    const answererOption = document.createElement("option");
    answererOption.value = player.name;
    answererOption.textContent = player.name;
    answererSelect.appendChild(answererOption);

    const accusedOption = document.createElement("option");
    accusedOption.value = player.name;
    accusedOption.textContent = player.name;
    accusedSelect.appendChild(accusedOption);
  }

  spyGuessLocationSelect.innerHTML = "";

  for (const location of locations) {
    const option = document.createElement("option");
    option.value = location;
    option.textContent = location;
    spyGuessLocationSelect.appendChild(option);
  }

  messagesList.innerHTML = "";

  for (const message of messages) {
    const li = document.createElement("li");

    if (message.type === "question") {
      li.textContent = `${message.senderName} → ${message.recipientName}: ${message.text}`;
    } else if (message.type === "system") {
      li.textContent = message.text;
    } else {
      li.textContent = `${message.senderName}: ${message.text}`;
    }

    messagesList.appendChild(li);
  }
});

socket.on("role_assigned", ({ role: assignedRole, location }) => {
  if (assignedRole === "spy") {
    role.textContent = "You are the spy";
  } else {
    role.textContent = `Location: ${location}`;
  }
});

socket.on("app_error", message => {
  alert(message);
});