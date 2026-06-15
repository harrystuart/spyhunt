import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import { createGame, LOCATIONS } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const MAX_CHAT_MESSAGE_LENGTH = 500;
const ROUND_SECONDS = 900;
const BELIEF_VALUES = ["-", "N", "+"];
const SPY_BELIEF_LOCATION_OPTION_COUNT = 6;

const ROOM_KIND_PRIVATE = "private";
const ROOM_KIND_RANDOM = "random";

const ROOM_SNAPSHOT_DIR =
  process.env.ROOM_SNAPSHOT_DIR || path.join(process.cwd(), "data", "rooms");

const rooms = new Map();

app.use(express.static("public"));

function validateResearchConsent(researchDataConsent, noPiiConsent) {
  if (researchDataConsent !== true || noPiiConsent !== true) {
    return "Both research consent boxes must be ticked before entering a lobby.";
  }

  return null;
}

io.on("connection", socket => {
  console.log("connected", socket.id);

  socket.on("create_room", ({ name, playerId, playerSignature, researchDataConsent, noPiiConsent }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const consentError = validateResearchConsent(researchDataConsent, noPiiConsent);

    if (consentError) {
      socket.emit("app_error", consentError);
      return;
    }

    const playerError = validatePlayerInput(name, playerId);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const playerSignatureError = validatePlayerSignatureInput(playerSignature);

    if (playerSignatureError) {
      socket.emit("app_error", playerSignatureError);
      return;
    }

    const code = createUniqueRoomCode();
    const player = createPlayer(socket.id, name, playerId, playerSignature);

    rooms.set(code, {
      id: crypto.randomUUID(),
      code,
      kind: ROOM_KIND_PRIVATE,
      hostId: socket.id,
      status: "lobby",
      createdAt: new Date().toISOString(),
      players: [player],
      playedPlayers: [],
      messages: [],
      game: null,
      roundTimer: null
    });

    socket.data.roomCode = code;
    socket.join(code);

    socket.emit("room_created", { code });
    io.to(code).emit("room_updated", publicRoom(rooms.get(code)));

    console.log(rooms);
  });

  socket.on("join_room", ({ code, name, playerId, playerSignature, researchDataConsent, noPiiConsent }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const consentError = validateResearchConsent(researchDataConsent, noPiiConsent);

    if (consentError) {
      socket.emit("app_error", consentError);
      return;
    }

    const roomCodeError = validateRoomCodeInput(code);

    if (roomCodeError) {
      socket.emit("app_error", roomCodeError);
      return;
    }

    const playerError = validatePlayerInput(name, playerId);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const playerSignatureError = validatePlayerSignatureInput(playerSignature);

    if (playerSignatureError) {
      socket.emit("app_error", playerSignatureError);
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

    const duplicatePlayerError = validateUniquePlayerInRoom(room, name, playerId);

    if (duplicatePlayerError) {
      socket.emit("app_error", duplicatePlayerError);
      return;
    }

    const player = createPlayer(socket.id, name, playerId, playerSignature);

    room.players.push(player);
    socket.data.roomCode = roomCode;
    socket.join(roomCode);

    socket.emit("room_joined", { code: roomCode });
    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("join_random_room", ({ name, playerId, playerSignature, researchDataConsent, noPiiConsent }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const consentError = validateResearchConsent(researchDataConsent, noPiiConsent);

    if (consentError) {
      socket.emit("app_error", consentError);
      return;
    }

    const playerError = validatePlayerInput(name, playerId);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const playerSignatureError = validatePlayerSignatureInput(playerSignature);

    if (playerSignatureError) {
      socket.emit("app_error", playerSignatureError);
      return;
    }

    const existingRoom = findAvailableRandomRoom(name, playerId);

    if (existingRoom) {
      const player = createPlayer(socket.id, name, playerId, playerSignature);

      existingRoom.players.push(player);
      socket.data.roomCode = existingRoom.code;
      socket.join(existingRoom.code);

      socket.emit("room_joined", { code: existingRoom.code });
      io.to(existingRoom.code).emit("room_updated", publicRoom(existingRoom));

      console.log(rooms);
      return;
    }

    const code = createUniqueRoomCode();
    const player = createPlayer(socket.id, name, playerId, playerSignature);

    const room = {
      id: crypto.randomUUID(),
      code,
      kind: ROOM_KIND_RANDOM,
      hostId: socket.id,
      status: "lobby",
      createdAt: new Date().toISOString(),
      players: [player],
      playedPlayers: [],
      messages: [],
      game: null,
      roundTimer: null
    };

    rooms.set(code, room);

    socket.data.roomCode = code;
    socket.join(code);

    socket.emit("room_joined", { code });
    io.to(code).emit("room_updated", publicRoom(room));

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
    room.playedPlayers = structuredClone(room.players);
    room.game = createGame(room.players);
    startRoundTimer(roomCode, room);

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: `Game started. Timer: ${ROUND_SECONDS} seconds.`,
      sentAt: new Date().toISOString()
    });

    io.to(roomCode).emit("room_updated", publicRoom(room));
    sendPlayerRoles(room);

    console.log(rooms);
  });

  socket.on("submit_belief_update", ({ questionerBelief, answererBelief, suspectedLocations }) => {
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

    if (room.game.finalAccusation) {
      socket.emit("app_error", "Timer expired. Belief updates are closed.");
      return;
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
      room.game.spyId,
      socket.id,
      questionerBelief,
      answererBelief,
      suspectedLocations
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
      suspectedLocations: beliefValidation.suspectedLocations,
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

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

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

    if (room.game.finalAccusation) {
      socket.emit("app_error", "Timer expired. Spy can no longer guess.");
      return;
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

    if (room.game.finalAccusation) {
      startFinalAccusation(roomCode, room, socket, accusedName);
      return;
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
      kind: "normal",
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
      text: `${accuser.name} accused ${accused.name}. The accusation is ${accuser.name}'s yes vote.`,
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

    if (room.game.finalAccusation) {
      voteFinalAccusation(roomCode, room, socket, vote);
      return;
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

    if (room.game.finalAccusation) {
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
        voterIds: room.players.map(player => player.id),
        spyLocationOptions: chooseSpyBeliefLocationOptions(),
        updates: [],
        startedAt: new Date().toISOString()
      };

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

function startRoundTimer(roomCode, room) {
  if (!room.game) {
    throw new Error("Cannot start timer before game exists");
  }

  clearRoundTimer(room);

  room.game.roundEndsAt = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();

  room.roundTimer = setTimeout(() => {
    expireRoundTimer(roomCode);
  }, ROUND_SECONDS * 1000);
}

function clearRoundTimer(room) {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
}

function expireRoundTimer(roomCode) {
  const room = rooms.get(roomCode);

  if (!room) {
    return;
  }

  room.roundTimer = null;

  if (room.status !== "playing") {
    return;
  }

  if (!room.game) {
    throw new Error(`Room ${roomCode} is playing without a game`);
  }

  if (room.game.result) {
    return;
  }

  if (room.game.finalAccusation) {
    return;
  }

  startFinalAccusationPhase(room);

  io.to(roomCode).emit("room_updated", publicRoom(room));

  console.log(rooms);
}

function startFinalAccusationPhase(room) {
  if (!room.game) {
    throw new Error("Cannot start final accusation phase without game");
  }

  const hostIndex = room.players.findIndex(player => player.id === room.hostId);

  if (hostIndex === -1) {
    throw new Error(`Host ${room.hostId} is missing from players`);
  }

  if (room.game.accusation) {
    room.game.accusation.result = "interrupted_by_timer";
    room.game.accusation.endedAt = new Date().toISOString();
    room.game.accusations.push(room.game.accusation);
    room.game.accusation = null;
  }

  if (room.game.beliefUpdate) {
    room.game.beliefUpdate.result = "interrupted_by_timer";
    room.game.beliefUpdate.endedAt = new Date().toISOString();
    room.game.beliefUpdates.push(room.game.beliefUpdate);
    room.game.beliefUpdate = null;
  }

  const accuserOrder = room.players
    .slice(hostIndex)
    .concat(room.players.slice(0, hostIndex));

  room.game.finalAccusation = {
    accuserOrderIds: accuserOrder.map(player => player.id),
    currentAccuserIndex: 0,
    accusation: null,
    accusations: [],
    startedAt: new Date().toISOString()
  };

  room.game.currentAnswererId = null;
  room.game.phase = "final_accusing";

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: `Timer expired. Final accusations begin with ${accuserOrder[0].name}.`,
    sentAt: new Date().toISOString()
  });
}

function startFinalAccusation(roomCode, room, socket, accusedName) {
  if (!room.game) {
    throw new Error("Cannot start final accusation without game");
  }

  if (!room.game.finalAccusation) {
    throw new Error("Cannot start final accusation without final accusation state");
  }

  if (room.game.phase !== "final_accusing") {
    socket.emit("app_error", "Final accusation vote is already active");
    return;
  }

  if (room.game.finalAccusation.accusation) {
    throw new Error("Final accusation phase is asking while accusation exists");
  }

  const currentAccuserId = room.game.finalAccusation.accuserOrderIds[
    room.game.finalAccusation.currentAccuserIndex
  ];

  if (socket.id !== currentAccuserId) {
    socket.emit("app_error", "It is not your turn to accuse");
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

  const accusation = {
    kind: "final",
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

  room.game.finalAccusation.accusation = accusation;
  room.game.phase = "final_voting";

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: `${accuser.name} made a final accusation against ${accused.name}.`,
    sentAt: new Date().toISOString()
  });

  if (votingPlayerIds.length === 0) {
    resolveConviction(room, accusation);
  }

  io.to(roomCode).emit("room_updated", publicRoom(room));

  console.log(rooms);
}

function voteFinalAccusation(roomCode, room, socket, vote) {
  if (!room.game) {
    throw new Error("Cannot vote final accusation without game");
  }

  if (!room.game.finalAccusation) {
    throw new Error("Cannot vote final accusation without final accusation state");
  }

  if (room.game.phase !== "final_voting") {
    socket.emit("app_error", "There is no active accusation");
    return;
  }

  const accusation = room.game.finalAccusation.accusation;

  if (!accusation) {
    throw new Error("Final voting phase has no accusation");
  }

  const voter = room.players.find(player => player.id === socket.id);

  if (!voter) {
    throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
  }

  const accused = room.players.find(player => {
    return player.id === accusation.accusedId;
  });

  if (!accused) {
    throw new Error(`Accused ${accusation.accusedId} is missing from room ${roomCode}`);
  }

  if (socket.id === accusation.accusedId) {
    socket.emit("app_error", "Accused cannot vote");
    return;
  }

  if (socket.id === accusation.accuserId) {
    socket.emit("app_error", "The accusation is your vote");
    return;
  }

  if (!accusation.votingPlayerIds.includes(socket.id)) {
    socket.emit("app_error", "You are not eligible to vote on this accusation");
    return;
  }

  const existingVote = accusation.votes.find(vote => {
    return vote.voterId === socket.id;
  });

  if (existingVote) {
    socket.emit("app_error", "You have already voted");
    return;
  }

  accusation.votes.push({
    voterId: socket.id,
    voterName: voter.name,
    vote,
    automatic: false,
    votedAt: new Date().toISOString()
  });

  if (vote === "no") {
    accusation.result = "failed";
    accusation.endedAt = new Date().toISOString();
    room.game.finalAccusation.accusations.push(accusation);
    room.game.accusations.push(accusation);
    room.game.finalAccusation.accusation = null;

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: `${voter.name} voted no. The final accusation against ${accused.name} failed.`,
      sentAt: new Date().toISOString()
    });

    advanceFinalAccuser(room);

    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
    return;
  }

  const remainingVoterIds = accusation.votingPlayerIds.filter(voterId => {
    return !accusation.votes.find(vote => vote.voterId === voterId);
  });

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: `${voter.name} voted yes.`,
    sentAt: new Date().toISOString()
  });

  if (remainingVoterIds.length === 0) {
    resolveConviction(room, accusation);
  }

  io.to(roomCode).emit("room_updated", publicRoom(room));

  console.log(rooms);
}

function advanceFinalAccuser(room) {
  if (!room.game) {
    throw new Error("Cannot advance final accuser without game");
  }

  if (!room.game.finalAccusation) {
    throw new Error("Cannot advance final accuser without final accusation state");
  }

  const nextIndex = room.game.finalAccusation.currentAccuserIndex + 1;

  if (nextIndex >= room.game.finalAccusation.accuserOrderIds.length) {
    resolveFinalAccusationsFailed(room);
    return;
  }

  room.game.finalAccusation.currentAccuserIndex = nextIndex;
  room.game.phase = "final_accusing";

  const nextAccuser = room.players.find(player => {
    return player.id === room.game.finalAccusation.accuserOrderIds[nextIndex];
  });

  if (!nextAccuser) {
    throw new Error(`Final accuser ${room.game.finalAccusation.accuserOrderIds[nextIndex]} is missing`);
  }

  room.messages.push({
    type: "system",
    senderId: null,
    senderName: "System",
    recipientName: null,
    text: `${nextAccuser.name} makes the next final accusation.`,
    sentAt: new Date().toISOString()
  });
}

function resolveFinalAccusationsFailed(room) {
  if (!room.game) {
    throw new Error("Cannot resolve final accusations without game");
  }

  const spy = room.players.find(player => player.id === room.game.spyId);

  if (!spy) {
    throw new Error(`Spy ${room.game.spyId} is missing from players`);
  }

  clearRoundTimer(room);

  room.game.finalAccusation.endedAt = new Date().toISOString();
  room.game.finalAccusation.result = "all_failed";

  room.game.result = {
    winner: "spy",
    reason: "final_accusations_failed",
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
    text: `All final accusations failed. The spy was ${spy.name}. Spy wins.`,
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

function validatePlayerInput(name, playerId) {
  if (typeof name !== "string") {
    return "Nickname is required";
  }

  const cleanName = name.trim();

  if (!cleanName) {
    return "Nickname is required";
  }

  if (cleanName.length > 32) {
    return "Nickname must be 32 characters or fewer";
  }

  if (playerId !== undefined && playerId !== null && typeof playerId !== "string") {
    return "Player Id is invalid";
  }

  const cleanPlayerId = typeof playerId === "string" ? playerId.trim() : "";

  if (cleanPlayerId.length > 64) {
    return "Player Id must be 64 characters or fewer";
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

function validateBeliefUpdateForPlayer(
  beliefUpdate,
  spyId,
  playerId,
  questionerBelief,
  answererBelief,
  suspectedLocations
) {
  const cleanQuestionerBelief = normalizeBeliefValue(questionerBelief);
  const cleanAnswererBelief = normalizeBeliefValue(answererBelief);
  const suspectedLocationValidation = normalizeSuspectedLocations(suspectedLocations);

  if (suspectedLocationValidation.error) {
    return { error: suspectedLocationValidation.error };
  }

  const cleanSuspectedLocations = suspectedLocationValidation.suspectedLocations;

  if (playerId === spyId) {
    if (cleanQuestionerBelief !== null || cleanAnswererBelief !== null) {
      return { error: "Spy cannot submit player belief updates" };
    }

    const allowedLocations = beliefUpdate.spyLocationOptions || [];

    const invalidSpyLocation = cleanSuspectedLocations.find(location => {
      return !allowedLocations.includes(location);
    });

    if (invalidSpyLocation) {
      return { error: "Spy can only submit one of the shown locations" };
    }

    return {
      questionerBelief: null,
      answererBelief: null,
      suspectedLocations: cleanSuspectedLocations
    };
  }

  if (cleanSuspectedLocations.length > 0) {
    return { error: "Only spy can submit suspected locations" };
  }

  if (playerId === beliefUpdate.questionerId) {
    if (cleanQuestionerBelief !== null) {
      return { error: "Questioner cannot submit belief about themselves" };
    }

    if (!BELIEF_VALUES.includes(cleanAnswererBelief)) {
      return { error: "Questioner must submit belief about the answerer" };
    }

    return {
      questionerBelief: null,
      answererBelief: cleanAnswererBelief,
      suspectedLocations: []
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
      answererBelief: null,
      suspectedLocations: []
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
    answererBelief: cleanAnswererBelief,
    suspectedLocations: []
  };
}

function normalizeBeliefValue(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  return value;
}

function normalizeSuspectedLocations(suspectedLocations) {
  if (suspectedLocations === undefined || suspectedLocations === null) {
    return { suspectedLocations: [] };
  }

  if (!Array.isArray(suspectedLocations)) {
    return { error: "Suspected locations must be a list" };
  }

  const cleanSuspectedLocations = suspectedLocations.map(location => {
    if (typeof location !== "string") {
      return location;
    }

    return location.trim();
  });

  if (cleanSuspectedLocations.find(location => typeof location !== "string")) {
    return { error: "Suspected locations must be strings" };
  }

  if (cleanSuspectedLocations.includes("none") && cleanSuspectedLocations.length > 1) {
    return { error: "Cannot choose none with suspected locations" };
  }

  const uniqueLocations = new Set(cleanSuspectedLocations);

  if (uniqueLocations.size !== cleanSuspectedLocations.length) {
    return { error: "Suspected locations must not contain duplicates" };
  }

  if (cleanSuspectedLocations.includes("none")) {
    return { suspectedLocations: ["none"] };
  }

  const invalidLocation = cleanSuspectedLocations.find(location => {
    return !LOCATIONS.includes(location);
  });

  if (invalidLocation) {
    return { error: "Suspected location is not valid" };
  }

  return { suspectedLocations: cleanSuspectedLocations };
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

function validateUniquePlayerInRoom(room, name, playerId) {
  const cleanName = name.trim().toLowerCase();
  const cleanPlayerId = typeof playerId === "string" ? playerId.trim() : "";

  const duplicateName = room.players.find(player => {
    return player.name.toLowerCase() === cleanName;
  });

  if (duplicateName) {
    return "Nickname is already taken in this room";
  }

  if (cleanPlayerId) {
    const duplicatePlayerId = room.players.find(player => {
      return player.playerId === cleanPlayerId;
    });

    if (duplicatePlayerId) {
      return "Player Id is already in this room";
    }
  }
}

function createPlayer(id, name, playerId, playerSignature) {
  const cleanPlayerId = typeof playerId === "string" ? playerId.trim() : "";

  return {
    id,
    name: name.trim(),
    playerId: cleanPlayerId || null,
    playerSignature: playerSignature.trim().toLowerCase(),
    joinedAt: new Date().toISOString()
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

  clearRoundTimer(room);

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
      : `${spy.name} guessed ${guessedLocation}. The spy was wrong. Agents win.`,
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

  clearRoundTimer(room);

  const accusedWasSpy = accused.id === room.game.spyId;

  accusation.result = "convicted";
  accusation.endedAt = new Date().toISOString();

  room.game.accusations.push(accusation);
  room.game.accusation = null;

  if (room.game.finalAccusation && room.game.finalAccusation.accusation === accusation) {
    room.game.finalAccusation.accusations.push(accusation);
    room.game.finalAccusation.accusation = null;
    room.game.finalAccusation.result = "convicted";
    room.game.finalAccusation.endedAt = new Date().toISOString();
  }

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
      ? `${accused.name} was the spy. Agents win.`
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

  const isLastPlayer = room.players.length === 1;

  socket.leave(roomCode);
  delete socket.data.roomCode;

  if (isLastPlayer) {
    room.closedByPlayerId = socket.id;
    deleteRoom(roomCode, "last_player_left");
    return;
  }

  room.players = room.players.filter(player => player.id !== socket.id);

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

  room.destroyedAt = new Date().toISOString();
  room.destroyReason = message;
  room.status = "destroyed";

  io.to(roomCode).emit("room_destroyed", { message });

  for (const player of room.players) {
    const playerSocket = io.sockets.sockets.get(player.id);

    if (playerSocket) {
      delete playerSocket.data.roomCode;
      playerSocket.leave(roomCode);
    }
  }

  deleteRoom(roomCode, "destroyed_during_play");
}

function publicRoom(room) {
  const host = room.players.find(player => player.id === room.hostId);

  if (!host) {
    throw new Error(`Room host ${room.hostId} is missing from players`);
  }

  let turn = null;
  let beliefUpdate = null;
  let accusation = null;
  let finalAccusation = null;
  let result = null;
  let roundEndsAt = null;

  if (room.status === "playing") {
    if (!room.game) {
      throw new Error("Playing room has no game");
    }

    roundEndsAt = room.game.roundEndsAt;

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
        spyLocationOptions: room.game.beliefUpdate.spyLocationOptions || [],
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

    if (room.game.finalAccusation) {
      const currentAccuserId = room.game.finalAccusation.accuserOrderIds[
        room.game.finalAccusation.currentAccuserIndex
      ];

      const currentAccuser = room.players.find(player => {
        return player.id === currentAccuserId;
      });

      if (!currentAccuser) {
        throw new Error(`Final accuser ${currentAccuserId} is missing from players`);
      }

      finalAccusation = {
        currentAccuserName: currentAccuser.name,
        currentAccuserNumber: room.game.finalAccusation.currentAccuserIndex + 1,
        totalAccusers: room.game.finalAccusation.accuserOrderIds.length,
        accusedName: null,
        pendingVoterNames: [],
        votes: []
      };

      if (room.game.finalAccusation.accusation) {
        const activeFinalAccusation = room.game.finalAccusation.accusation;

        const accused = room.players.find(player => {
          return player.id === activeFinalAccusation.accusedId;
        });

        if (!accused) {
          throw new Error(`Final accused ${activeFinalAccusation.accusedId} is missing from players`);
        }

        const pendingVoterNames = activeFinalAccusation.votingPlayerIds
          .filter(voterId => {
            return !activeFinalAccusation.votes.find(vote => vote.voterId === voterId);
          })
          .map(voterId => {
            const voter = room.players.find(player => player.id === voterId);

            if (!voter) {
              throw new Error(`Final pending voter ${voterId} is missing from players`);
            }

            return voter.name;
          });

        finalAccusation.accusedName = accused.name;
        finalAccusation.pendingVoterNames = pendingVoterNames;
        finalAccusation.votes = activeFinalAccusation.votes.map(vote => ({
          voterName: vote.voterName,
          vote: vote.vote,
          automatic: vote.automatic
        }));
      }
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
    id: room.id,
    status: room.status,
    turn,
    beliefUpdate,
    accusation,
    finalAccusation,
    result,
    roundEndsAt,
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

function deleteRoom(roomCode, deleteReason) {
  const room = rooms.get(roomCode);

  if (!room) {
    throw new Error(`Tried to delete missing room ${roomCode}`);
  }

  room.deletedAt = new Date().toISOString();
  room.deleteReason = deleteReason;

  clearRoundTimer(room);

  saveRoom(room, deleteReason);

  rooms.delete(roomCode);
}

function saveRoom(room, reason) {
  if (!room.id) {
    throw new Error("Cannot save room without id");
  }

  room.savedAt = new Date().toISOString();
  room.saveReason = reason;

  fs.mkdirSync(ROOM_SNAPSHOT_DIR, { recursive: true });

  const filename = `${room.code}_${room.id}.json`;
  const filePath = path.join(ROOM_SNAPSHOT_DIR, filename);

  fs.writeFileSync(filePath, JSON.stringify(room, null, 2));

  console.log(`Saved room ${room.id} with code ${room.code} to ${filePath}`);

  return filePath;
}

function chooseSpyBeliefLocationOptions() {
  const locations = [...LOCATIONS];

  for (let index = locations.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(0, index + 1);

    [locations[index], locations[randomIndex]] = [locations[randomIndex], locations[index]];
  }

  return locations.slice(0, SPY_BELIEF_LOCATION_OPTION_COUNT);
}

function createUniqueRoomCode() {
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = crypto.randomBytes(3)
      .toString("base64url")
      .replace(/[^A-Z0-9]/gi, "")
      .slice(0, 4)
      .toUpperCase();

    if (code.length === 4 && !rooms.has(code)) {
      return code;
    }
  }

  throw new Error("Could not create a unique room code");
}

function findAvailableRandomRoom(name, playerId) {
  for (const room of rooms.values()) {
    if (room.kind !== ROOM_KIND_RANDOM) {
      continue;
    }

    if (room.status !== "lobby") {
      continue;
    }

    if (room.players.length >= MAX_PLAYERS) {
      continue;
    }

    if (validateUniquePlayerInRoom(room, name, playerId)) {
      continue;
    }

    return room;
  }

  return null;
}

function validatePlayerSignatureInput(playerSignature) {
  if (typeof playerSignature !== "string") {
    return "Player signature is required";
  }

  const cleanPlayerSignature = playerSignature.trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanPlayerSignature)) {
    return "Player signature is invalid";
  }
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on port ${PORT}`);
});