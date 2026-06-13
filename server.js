import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createGame, LOCATIONS } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_CHAT_MESSAGE_LENGTH = 500;
const BELIEF_VALUES = ["--", "-", "N", "+", "++"];

const rooms = new Map();

app.use(express.static("public"));

io.on("connection", socket => {
  console.log("connected", socket.id);

  socket.on("create_room", ({ name, email }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const playerError = validatePlayerInput(name, email);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    const player = createPlayer(socket.id, name, email);

    rooms.set(code, {
      hostId: socket.id,
      status: "lobby",
      players: [player],
      messages: [],
      game: null
    });

    socket.data.roomCode = code;
    socket.join(code);

    socket.emit("room_created", { code });
    io.to(code).emit("room_updated", publicRoom(rooms.get(code)));

    console.log(rooms);
  });

  socket.on("join_room", ({ code, name, email }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const roomCodeError = validateRoomCodeInput(code);

    if (roomCodeError) {
      socket.emit("app_error", roomCodeError);
      return;
    }

    const playerError = validatePlayerInput(name, email);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const roomCode = code.trim().toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("app_error", `Room ${roomCode} does not exist`);
      return;
    }

    if (room.status !== "lobby") {
      socket.emit("app_error", "Game has already started");
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("app_error", `Room ${roomCode} is full`);
      return;
    }

    const duplicatePlayerError = validateUniquePlayerInRoom(room, name, email);

    if (duplicatePlayerError) {
      socket.emit("app_error", duplicatePlayerError);
      return;
    }

    const player = createPlayer(socket.id, name, email);

    room.players.push(player);
    socket.data.roomCode = roomCode;
    socket.join(roomCode);

    socket.emit("room_joined", { code: roomCode });
    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("start_game", () => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.hostId !== socket.id) {
      socket.emit("app_error", "Only the host can start the game");
      return;
    }

    if (room.status === "playing") {
      socket.emit("app_error", "Game is already playing");
      return;
    }

    if (room.status === "finished") {
      socket.emit("app_error", "Game is already finished");
      return;
    }

    if (room.players.length < MIN_PLAYERS) {
      socket.emit("app_error", `Need at least ${MIN_PLAYERS} players to start`);
      return;
    }

    room.status = "playing";
    room.game = createGame(room.players);

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: "Game started.",
      sentAt: new Date().toISOString()
    });

    io.to(roomCode).emit("room_updated", publicRoom(room));
    sendPlayerRoles(room);

    console.log(rooms);
  });

  socket.on("submit_belief_update", ({ questionerBelief, answererBelief }) => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.status === "finished") {
      socket.emit("app_error", "Game is finished");
      return;
    }

    if (room.status !== "playing") {
      socket.emit("app_error", "Belief update can only happen during a game");
      return;
    }

    if (!room.game) {
      throw new Error(`Room ${roomCode} is playing without a game`);
    }

    if (room.game.accusation) {
      socket.emit("app_error", "Voting is in progress");
      return;
    }

    if (room.game.phase !== "belief") {
      socket.emit("app_error", "Belief update is only allowed after an answer");
      return;
    }

    if (!room.game.beliefUpdate) {
      throw new Error(`Room ${roomCode} is in belief phase without beliefUpdate`);
    }

    const player = room.players.find(player => player.id === socket.id);

    if (!player) {
      throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
    }

    if (socket.id === room.game.spyId) {
      socket.emit("app_error", "Spy cannot submit belief updates");
      return;
    }

    if (!room.game.beliefUpdate.voterIds.includes(socket.id)) {
      throw new Error(`Socket ${socket.id} is not eligible for belief update in room ${roomCode}`);
    }

    const existingUpdate = room.game.beliefUpdate.updates.find(update => {
      return update.voterId === socket.id;
    });

    if (existingUpdate) {
      socket.emit("app_error", "You have already submitted a belief update");
      return;
    }

    const beliefValidation = validateBeliefUpdateForPlayer(
      room.game.beliefUpdate,
      socket.id,
      questionerBelief,
      answererBelief
    );

    if (beliefValidation.error) {
      socket.emit("app_error", beliefValidation.error);
      return;
    }

    room.game.beliefUpdate.updates.push({
      voterId: socket.id,
      voterName: player.name,
      questionerBelief: beliefValidation.questionerBelief,
      answererBelief: beliefValidation.answererBelief,
      submittedAt: new Date().toISOString()
    });

    const remainingVoterIds = room.game.beliefUpdate.voterIds.filter(voterId => {
      return !room.game.beliefUpdate.updates.find(update => update.voterId === voterId);
    });

    if (remainingVoterIds.length === 0) {
      const nextQuestioner = room.players.find(player => {
        return player.id === room.game.currentQuestionerId;
      });

      if (!nextQuestioner) {
        throw new Error(`Current questioner ${room.game.currentQuestionerId} is missing from players`);
      }

      room.game.beliefUpdate.endedAt = new Date().toISOString();
      room.game.beliefUpdates.push(room.game.beliefUpdate);
      room.game.beliefUpdate = null;
      room.game.phase = "asking";

      room.messages.push({
        type: "system",
        senderId: null,
        senderName: "System",
        recipientName: null,
        text: `All belief updates submitted. ${nextQuestioner.name} asks next.`,
        sentAt: new Date().toISOString()
      });

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: "A belief update was submitted.",
      sentAt: new Date().toISOString()
    });

    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("spy_guess_location", ({ location }) => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const locationError = validateLocationGuessInput(location);

    if (locationError) {
      socket.emit("app_error", locationError);
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.status === "finished") {
      socket.emit("app_error", "Game is finished");
      return;
    }

    if (room.status !== "playing") {
      socket.emit("app_error", "You can only guess during a game");
      return;
    }

    if (!room.game) {
      throw new Error(`Room ${roomCode} is playing without a game`);
    }

    if (socket.id !== room.game.spyId) {
      socket.emit("app_error", "Only the spy can guess the location");
      return;
    }

    resolveSpyGuess(room, location.trim());

    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("start_accusation", ({ accusedName }) => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.status === "finished") {
      socket.emit("app_error", "Game is finished");
      return;
    }

    if (room.status !== "playing") {
      socket.emit("app_error", "You can only accuse during a game");
      return;
    }

    if (!room.game) {
      throw new Error(`Room ${roomCode} is playing without a game`);
    }

    if (room.game.accusation) {
      socket.emit("app_error", "An accusation vote is already active");
      return;
    }

    if (room.game.accuserIds.includes(socket.id)) {
      socket.emit("app_error", "You have already accused this game");
      return;
    }

    const accusedError = validateAccusedInput(accusedName);

    if (accusedError) {
      socket.emit("app_error", accusedError);
      return;
    }

    const accuser = room.players.find(player => player.id === socket.id);

    if (!accuser) {
      throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
    }

    const accused = room.players.find(player => {
      return player.name.toLowerCase() === accusedName.trim().toLowerCase();
    });

    if (!accused) {
      socket.emit("app_error", "Accused player is not in this room");
      return;
    }

    if (accused.id === socket.id) {
      socket.emit("app_error", "You cannot accuse yourself");
      return;
    }

    const votingPlayerIds = room.players
      .filter(player => player.id !== accused.id)
      .filter(player => player.id !== accuser.id)
      .map(player => player.id);

    room.game.accuserIds.push(socket.id);

    const accusation = {
      accuserId: accuser.id,
      accusedId: accused.id,
      votingPlayerIds,
      votes: [
        {
          voterId: accuser.id,
          voterName: accuser.name,
          vote: "yes",
          automatic: true,
          votedAt: new Date().toISOString()
        }
      ],
      startedAt: new Date().toISOString()
    };

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: `${accuser.name} accused ${accused.name}. The accusation is ${accuser.name}'s yes vote. No discussion.`,
      sentAt: new Date().toISOString()
    });

    if (votingPlayerIds.length === 0) {
      resolveConviction(room, accusation);
      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    room.game.accusation = accusation;

    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("vote_accusation", ({ vote }) => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const voteError = validateVoteInput(vote);

    if (voteError) {
      socket.emit("app_error", voteError);
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.status === "finished") {
      socket.emit("app_error", "Game is finished");
      return;
    }

    if (room.status !== "playing") {
      socket.emit("app_error", "You can only vote during a game");
      return;
    }

    if (!room.game) {
      throw new Error(`Room ${roomCode} is playing without a game`);
    }

    if (!room.game.accusation) {
      socket.emit("app_error", "There is no active accusation");
      return;
    }

    const voter = room.players.find(player => player.id === socket.id);

    if (!voter) {
      throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
    }

    const accused = room.players.find(player => {
      return player.id === room.game.accusation.accusedId;
    });

    if (!accused) {
      throw new Error(`Accused ${room.game.accusation.accusedId} is missing from room ${roomCode}`);
    }

    if (socket.id === room.game.accusation.accusedId) {
      socket.emit("app_error", "Accused cannot vote");
      return;
    }

    if (socket.id === room.game.accusation.accuserId) {
      socket.emit("app_error", "The accusation is your vote");
      return;
    }

    if (!room.game.accusation.votingPlayerIds.includes(socket.id)) {
      socket.emit("app_error", "You are not eligible to vote on this accusation");
      return;
    }

    const existingVote = room.game.accusation.votes.find(vote => {
      return vote.voterId === socket.id;
    });

    if (existingVote) {
      socket.emit("app_error", "You have already voted");
      return;
    }

    room.game.accusation.votes.push({
      voterId: socket.id,
      voterName: voter.name,
      vote,
      automatic: false,
      votedAt: new Date().toISOString()
    });

    if (vote === "no") {
      room.messages.push({
        type: "system",
        senderId: null,
        senderName: "System",
        recipientName: null,
        text: `${voter.name} voted no. The accusation against ${accused.name} failed.`,
        sentAt: new Date().toISOString()
      });

      room.game.accusation.result = "failed";
      room.game.accusation.endedAt = new Date().toISOString();
      room.game.accusations.push(room.game.accusation);
      room.game.accusation = null;

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    const remainingVoterIds = room.game.accusation.votingPlayerIds.filter(voterId => {
      return !room.game.accusation.votes.find(vote => vote.voterId === voterId);
    });

    if (remainingVoterIds.length === 0) {
      room.messages.push({
        type: "system",
        senderId: null,
        senderName: "System",
        recipientName: null,
        text: `${voter.name} voted yes.`,
        sentAt: new Date().toISOString()
      });

      resolveConviction(room, room.game.accusation);

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: `${voter.name} voted yes.`,
      sentAt: new Date().toISOString()
    });

    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("send_chat_message", ({ text, answererName }) => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const messageError = validateChatMessageInput(text);

    if (messageError) {
      socket.emit("app_error", messageError);
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    const player = room.players.find(player => player.id === socket.id);

    if (!player) {
      throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
    }

    if (room.status === "lobby" || room.status === "finished") {
      room.messages.push({
        type: "chat",
        senderId: socket.id,
        senderName: player.name,
        recipientName: null,
        text: text.trim(),
        sentAt: new Date().toISOString()
      });

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    if (room.status !== "playing") {
      throw new Error(`Unknown room status ${room.status}`);
    }

    if (!room.game) {
      throw new Error(`Room ${roomCode} is playing without a game`);
    }

    if (room.game.accusation) {
      socket.emit("app_error", "Voting is in progress. No discussion.");
      return;
    }

    if (room.game.phase === "belief") {
      socket.emit("app_error", "Belief updates are pending");
      return;
    }

    if (room.game.phase === "asking") {
      if (room.game.currentQuestionerId !== socket.id) {
        socket.emit("app_error", "It is not your turn to ask");
        return;
      }

      const answererError = validateAnswererInput(answererName);

      if (answererError) {
        socket.emit("app_error", answererError);
        return;
      }

      const answerer = room.players.find(player => {
        return player.name.toLowerCase() === answererName.trim().toLowerCase();
      });

      if (!answerer) {
        socket.emit("app_error", "Answerer is not in this room");
        return;
      }

      if (answerer.id === socket.id) {
        socket.emit("app_error", "You cannot ask yourself");
        return;
      }

      if (answerer.id === room.game.previousQuestionerId) {
        socket.emit("app_error", "You cannot ask the previous questioner");
        return;
      }

      room.messages.push({
        type: "question",
        senderId: socket.id,
        senderName: player.name,
        recipientName: answerer.name,
        text: text.trim(),
        sentAt: new Date().toISOString()
      });

      room.game.phase = "answering";
      room.game.currentAnswererId = answerer.id;

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    if (room.game.phase === "answering") {
      if (room.game.currentAnswererId !== socket.id) {
        socket.emit("app_error", "It is not your turn to answer");
        return;
      }

      const questionerId = room.game.currentQuestionerId;
      const answererId = socket.id;

      room.messages.push({
        type: "answer",
        senderId: socket.id,
        senderName: player.name,
        recipientName: null,
        text: text.trim(),
        sentAt: new Date().toISOString()
      });

      room.game.previousQuestionerId = questionerId;
      room.game.currentQuestionerId = answererId;
      room.game.currentAnswererId = null;
      room.game.phase = "belief";

      room.game.beliefUpdate = {
        questionerId,
        answererId,
        voterIds: room.players
          .filter(player => player.id !== room.game.spyId)
          .map(player => player.id),
        updates: [],
        startedAt: new Date().toISOString()
      };

      room.messages.push({
        type: "system",
        senderId: null,
        senderName: "System",
        recipientName: null,
        text: "Belief update required before the next question.",
        sentAt: new Date().toISOString()
      });

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    throw new Error(`Unknown game phase ${room.game.phase}`);
  });

  socket.on("leave_room", () => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.status === "playing") {
      destroyRoom(roomCode, "A player left during the game. The room was destroyed.");
      console.log(rooms);
      return;
    }

    leaveRoom(socket);
    socket.emit("room_left");

    console.log(rooms);
  });

  socket.on("disconnect", () => {
    if (!socket.data.roomCode) {
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} disconnected from missing room ${roomCode}`);
    }

    if (room.status === "playing") {
      destroyRoom(roomCode, "A player disconnected during the game. The room was destroyed.");
      console.log(rooms);
      return;
    }

    leaveRoom(socket);

    console.log(rooms);
  });
});

function validatePlayerInput(name, email) {
  if (typeof name !== "string") {
    return "Username is required";
  }

  if (typeof email !== "string") {
    return "Email is required";
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName) {
    return "Username is required";
  }

  if (cleanName.length > 32) {
    return "Username must be 32 characters or fewer";
  }

  if (!cleanEmail) {
    return "Email is required";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return "Email is invalid";
  }
}

function validateRoomCodeInput(code) {
  if (typeof code !== "string") {
    return "Room code is required";
  }

  const roomCode = code.trim().toUpperCase();

  if (!roomCode) {
    return "Room code is required";
  }

  if (!/^[A-Z0-9]{4}$/.test(roomCode)) {
    return "Room code must be 4 letters or numbers";
  }
}

function validateChatMessageInput(text) {
  if (typeof text !== "string") {
    return "Message is required";
  }

  const cleanText = text.trim();

  if (!cleanText) {
    return "Message is required";
  }

  if (cleanText.length > MAX_CHAT_MESSAGE_LENGTH) {
    return `Message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer`;
  }
}

function validateAnswererInput(answererName) {
  if (typeof answererName !== "string") {
    return "Choose someone to answer";
  }

  if (!answererName.trim()) {
    return "Choose someone to answer";
  }
}

function validateAccusedInput(accusedName) {
  if (typeof accusedName !== "string") {
    return "Choose someone to accuse";
  }

  if (!accusedName.trim()) {
    return "Choose someone to accuse";
  }
}

function validateVoteInput(vote) {
  if (vote !== "yes" && vote !== "no") {
    return "Vote must be yes or no";
  }
}

function validateBeliefUpdateForPlayer(beliefUpdate, playerId, questionerBelief, answererBelief) {
  const cleanQuestionerBelief = normalizeBeliefValue(questionerBelief);
  const cleanAnswererBelief = normalizeBeliefValue(answererBelief);

  if (playerId === beliefUpdate.questionerId) {
    if (cleanQuestionerBelief !== null) {
      return { error: "Questioner cannot submit belief about themselves" };
    }

    if (!BELIEF_VALUES.includes(cleanAnswererBelief)) {
      return { error: "Questioner must submit belief about the answerer" };
    }

    return {
      questionerBelief: null,
      answererBelief: cleanAnswererBelief
    };
  }

  if (playerId === beliefUpdate.answererId) {
    if (cleanAnswererBelief !== null) {
      return { error: "Answerer cannot submit belief about themselves" };
    }

    if (!BELIEF_VALUES.includes(cleanQuestionerBelief)) {
      return { error: "Answerer must submit belief about the questioner" };
    }

    return {
      questionerBelief: cleanQuestionerBelief,
      answererBelief: null
    };
  }

  if (!BELIEF_VALUES.includes(cleanQuestionerBelief)) {
    return { error: "Belief about the questioner is required" };
  }

  if (!BELIEF_VALUES.includes(cleanAnswererBelief)) {
    return { error: "Belief about the answerer is required" };
  }

  return {
    questionerBelief: cleanQuestionerBelief,
    answererBelief: cleanAnswererBelief
  };
}

function normalizeBeliefValue(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  return value;
}

function validateLocationGuessInput(location) {
  if (typeof location !== "string") {
    return "Choose a location";
  }

  const cleanLocation = location.trim();

  if (!cleanLocation) {
    return "Choose a location";
  }

  if (!LOCATIONS.includes(cleanLocation)) {
    return "Location is not valid";
  }
}

function validateUniquePlayerInRoom(room, name, email) {
  const cleanName = name.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  const duplicateName = room.players.find(player => {
    return player.name.toLowerCase() === cleanName;
  });

  if (duplicateName) {
    return "Username is already taken in this room";
  }

  const duplicateEmail = room.players.find(player => {
    return player.email === cleanEmail;
  });

  if (duplicateEmail) {
    return "Email is already in this room";
  }
}

function createPlayer(id, name, email) {
  return {
    id,
    name: name.trim(),
    email: email.trim().toLowerCase()
  };
}

function sendPlayerRoles(room) {
  if (!room.game) {
    throw new Error("Cannot send player roles before game exists");
  }

  for (const player of room.players) {
    const playerSocket = io.sockets.sockets.get(player.id);

    if (!playerSocket) {
      throw new Error(`Player ${player.id} has no active socket`);
    }

    if (player.id === room.game.spyId) {
      playerSocket.emit("role_assigned", {
        role: "spy"
      });
    } else {
      playerSocket.emit("role_assigned", {
        role: "player",
        location: room.game.location
      });
    }
  }
}

function resolveSpyGuess(room, guessedLocation) {
  if (!room.game) {
    throw new Error("Cannot resolve spy guess without game");
  }

  const spy = room.players.find(player => player.id === room.game.spyId);

  if (!spy) {
    throw new Error(`Spy ${room.game.spyId} is missing from players`);
  }

  if (room.game.accusation) {
    room.game.accusation.result = "interrupted_by_spy_guess";
    room.game.accusation.endedAt = new Date().toISOString();
    room.game.accusations.push(room.game.accusation);
    room.game.accusation = null;
  }

  if (room.game.beliefUpdate) {
    room.game.beliefUpdate.result = "interrupted_by_spy_guess";
    room.game.beliefUpdate.endedAt = new Date().toISOString();
    room.game.beliefUpdates.push(room.game.beliefUpdate);
    room.game.beliefUpdate = null;
  }

  const guessedCorrectly = guessedLocation === room.game.location;

  room.game.result = {
    winner: guessedCorrectly ? "spy" : "players",
    reason: guessedCorrectly ? "spy_guessed_location" : "spy_wrong_location_guess",
    spyName: spy.name,
    location: room.game.location,
    guessedLocation,
    endedAt: new Date().toISOString()
  };

  room.status = "finished";

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: guessedCorrectly
      ? `${spy.name} guessed ${guessedLocation}. The spy was correct. Spy wins.`
      : `${spy.name} guessed ${guessedLocation}. The spy was wrong. Players win.`,
    sentAt: new Date().toISOString()
  });

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: `Location was ${room.game.location}.`,
    sentAt: new Date().toISOString()
  });
}

function resolveConviction(room, accusation) {
  if (!room.game) {
    throw new Error("Cannot resolve conviction without game");
  }

  const accused = room.players.find(player => player.id === accusation.accusedId);
  const spy = room.players.find(player => player.id === room.game.spyId);

  if (!accused) {
    throw new Error(`Accused ${accusation.accusedId} is missing from players`);
  }

  if (!spy) {
    throw new Error(`Spy ${room.game.spyId} is missing from players`);
  }

  const accusedWasSpy = accused.id === room.game.spyId;

  accusation.result = "convicted";
  accusation.endedAt = new Date().toISOString();

  room.game.accusations.push(accusation);
  room.game.accusation = null;

  if (room.game.beliefUpdate) {
    room.game.beliefUpdate.result = "interrupted_by_conviction";
    room.game.beliefUpdate.endedAt = new Date().toISOString();
    room.game.beliefUpdates.push(room.game.beliefUpdate);
    room.game.beliefUpdate = null;
  }

  room.game.result = {
    winner: accusedWasSpy ? "players" : "spy",
    reason: accusedWasSpy ? "spy_convicted" : "wrong_player_convicted",
    accusedName: accused.name,
    spyName: spy.name,
    location: room.game.location,
    endedAt: new Date().toISOString()
  };

  room.status = "finished";

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: accusedWasSpy
      ? `${accused.name} was the spy. Players win.`
      : `${accused.name} was not the spy. The spy was ${spy.name}. Spy wins.`,
    sentAt: new Date().toISOString()
  });

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: `Location was ${room.game.location}.`,
    sentAt: new Date().toISOString()
  });
}

function leaveRoom(socket) {
  const roomCode = socket.data.roomCode;
  const room = rooms.get(roomCode);

  if (!room) {
    throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
  }

  const player = room.players.find(player => player.id === socket.id);

  if (!player) {
    throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
  }

  room.players = room.players.filter(player => player.id !== socket.id);
  socket.leave(roomCode);
  delete socket.data.roomCode;

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
  }

  io.to(roomCode).emit("room_updated", publicRoom(room));
}

function destroyRoom(roomCode, message) {
  const room = rooms.get(roomCode);

  if (!room) {
    throw new Error(`Tried to destroy missing room ${roomCode}`);
  }

  io.to(roomCode).emit("room_destroyed", { message });

  for (const player of room.players) {
    const playerSocket = io.sockets.sockets.get(player.id);

    if (playerSocket) {
      delete playerSocket.data.roomCode;
      playerSocket.leave(roomCode);
    }
  }

  rooms.delete(roomCode);
}

function publicRoom(room) {
  const host = room.players.find(player => player.id === room.hostId);

  if (!host) {
    throw new Error(`Room host ${room.hostId} is missing from players`);
  }

  let turn = null;
  let beliefUpdate = null;
  let accusation = null;
  let result = null;

  if (room.status === "playing") {
    if (!room.game) {
      throw new Error("Playing room has no game");
    }

    const currentQuestioner = room.players.find(player => {
      return player.id === room.game.currentQuestionerId;
    });

    if (!currentQuestioner) {
      throw new Error(`Current questioner ${room.game.currentQuestionerId} is missing from players`);
    }

    const currentAnswerer = room.game.currentAnswererId
      ? room.players.find(player => player.id === room.game.currentAnswererId)
      : null;

    if (room.game.currentAnswererId && !currentAnswerer) {
      throw new Error(`Current answerer ${room.game.currentAnswererId} is missing from players`);
    }

    turn = {
      phase: room.game.phase,
      currentQuestionerName: currentQuestioner.name,
      currentAnswererName: currentAnswerer ? currentAnswerer.name : null
    };

    if (room.game.beliefUpdate) {
      const questioner = room.players.find(player => {
        return player.id === room.game.beliefUpdate.questionerId;
      });

      const answerer = room.players.find(player => {
        return player.id === room.game.beliefUpdate.answererId;
      });

      if (!questioner) {
        throw new Error(`Belief questioner ${room.game.beliefUpdate.questionerId} is missing from players`);
      }

      if (!answerer) {
        throw new Error(`Belief answerer ${room.game.beliefUpdate.answererId} is missing from players`);
      }

      beliefUpdate = {
        questionerName: questioner.name,
        answererName: answerer.name,
        submittedCount: room.game.beliefUpdate.updates.length,
        totalCount: room.game.beliefUpdate.voterIds.length
      };
    }

    if (room.game.accusation) {
      const accuser = room.players.find(player => player.id === room.game.accusation.accuserId);
      const accused = room.players.find(player => player.id === room.game.accusation.accusedId);

      if (!accuser) {
        throw new Error(`Accuser ${room.game.accusation.accuserId} is missing from players`);
      }

      if (!accused) {
        throw new Error(`Accused ${room.game.accusation.accusedId} is missing from players`);
      }

      const pendingVoterNames = room.game.accusation.votingPlayerIds
        .filter(voterId => {
          return !room.game.accusation.votes.find(vote => vote.voterId === voterId);
        })
        .map(voterId => {
          const voter = room.players.find(player => player.id === voterId);

          if (!voter) {
            throw new Error(`Pending voter ${voterId} is missing from players`);
          }

          return voter.name;
        });

      accusation = {
        accuserName: accuser.name,
        accusedName: accused.name,
        pendingVoterNames,
        votes: room.game.accusation.votes.map(vote => ({
          voterName: vote.voterName,
          vote: vote.vote,
          automatic: vote.automatic
        }))
      };
    }
  }

  if (room.status === "finished") {
    if (!room.game) {
      throw new Error("Finished room has no game");
    }

    if (!room.game.result) {
      throw new Error("Finished game has no result");
    }

    result = room.game.result;
  }

  return {
    status: room.status,
    turn,
    beliefUpdate,
    accusation,
    result,
    locations: LOCATIONS,
    players: room.players.map(player => ({
      name: player.name,
      isHost: player.id === room.hostId
    })),
    messages: room.messages.map(message => ({
      type: message.type,
      senderName: message.senderName,
      recipientName: message.recipientName,
      text: message.text,
      sentAt: message.sentAt
    }))
  };
}

server.listen(3000, () => {
  console.log("listening on http://localhost:3000");
});