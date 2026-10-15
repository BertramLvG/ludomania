'use strict';

const crypto = require('node:crypto');
const { createGame, currentColor, roll, move, placeTrap, trapSquares } = require('./engine');
const { chooseMove, chooseTrapSquare } = require('./bot');
const settings = require('./settings');

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const SEATS = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: ['red', 'green', 'yellow', 'blue'] };
const MAX_PLAYERS = 4;
const REJOIN_MS = 60 * 1000;
const BOT_DELAY_MS = 900;

const secureRng = () => crypto.randomInt(0, 1e9) / 1e9;

function publicState(room) {
  const s = room.state;
  const names = { ...room.botNames };
  const away = [];
  room.players.forEach((p) => {
    if (!p.color) return;
    names[p.color] = p.name;
    if (p.gone && !room.bots.has(p.color)) away.push(p.color);
  });
  return {
    colors: s.colors, tokens: s.tokens, turn: s.turn, phase: s.phase,
    face: s.face, moves: s.moves, winner: s.winner, bots: [...room.bots], away, names,
    settings: room.settings,
    // power-ups: everything on the board is public
    powerUps: s.powerUps, traps: s.traps, shield: s.shield, boost: s.boost, boosted: s.boosted,
    placing: s.phase === 'place' ? { color: s.colors[s.turn], squares: trapSquares(s) } : null,
  };
}

// Connection-independent game hub: holds rooms and handles client messages.
// `send(obj)` is supplied per connection, so this works with real sockets or in tests.
// A player who disconnects mid-game has `rejoinMs` to come back with their secret token.
// After that a bot plays their seat, taking a move every `botDelayMs`.
function createHub({
  rejoinMs = REJOIN_MS, setTimer = setTimeout, clearTimer = clearTimeout,
  botDelayMs = BOT_DELAY_MS, setBotTimer = setTimeout,
  store = null, // where finished games are recorded for the players' statistics
} = {}) {
  const rooms = new Map();
  const conns = new Map(); // id -> connection record
  let nextId = 1;

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[crypto.randomInt(0, CODE_LETTERS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  const sendTo = (player, msg) => { try { if (!player.gone) player.send(msg); } catch { /* connection gone */ } };
  // The lobby message tells each player whether they are the host (only the host sees the start controls).
  const broadcast = (room, msg) => room.players.forEach((p) => {
    sendTo(p, msg.type === 'lobby' ? { ...msg, youHost: p === room.host } : msg);
  });
  const lobbyMsg = (room) => ({
    type: 'lobby', code: room.code,
    players: room.players.map((p) => ({ name: p.name, host: p === room.host })),
    bots: room.botCount,
    settings: room.settings,
  });
  const stateMsg = (room, events = []) => ({ type: 'state', state: publicState(room), events });

  function fail(conn, message) { sendTo(conn, { type: 'error', message }); }

  function cleanName(name) {
    const n = String(name || '').trim().slice(0, 20);
    return n || 'Player';
  }

  function join(conn, room, name) {
    if (conn.room) return fail(conn, 'Already in a room');
    if (room.state) return fail(conn, 'Game already started');
    if (room.players.length + room.botCount >= MAX_PLAYERS) return fail(conn, 'Room is full');
    if (conn.user && room.players.some((p) => p.user && p.user.id === conn.user.id)) {
      return fail(conn, 'You are already in this room');
    }
    conn.room = room;
    conn.name = conn.user ? conn.user.username : cleanName(name); // logged-in players use their account name
    room.players.push(conn);
    if (!room.host) room.host = conn;
    sendTo(conn, { type: 'joined', code: room.code });
    broadcast(room, lobbyMsg(room));
  }

  function scheduleBot(room) {
    if (room.botTimer || !room.state || room.state.winner) return;
    if (!room.bots.has(currentColor(room.state))) return;
    room.botTimer = setBotTimer(() => { room.botTimer = null; botStep(room); }, botDelayMs);
  }

  function botStep(room) {
    const s = room.state;
    if (!rooms.has(room.code) || s.winner || !room.bots.has(currentColor(s))) return;
    const result = s.phase === 'roll' ? roll(s)
      : s.phase === 'place' ? placeTrap(s, chooseTrapSquare(s))
      : move(s, chooseMove(s));
    room.state = result.state;
    broadcast(room, stateMsg(room, result.events));
    finishIfDone(room);
    scheduleBot(room);
  }

  // When a game ends, every logged-in player who took part gets a played game, and the winner a win.
  // Games that are abandoned before anyone wins are not counted.
  function finishIfDone(room) {
    if (!room.state.winner || room.recorded) return;
    room.recorded = true;
    if (!store) return;
    const humans = room.players.filter((p) => p.user);
    const winner = humans.find((p) => p.color === room.state.winner);
    store.recordGame({ winnerId: winner ? winner.user.id : null, playerIds: humans.map((p) => p.user.id), rolls: room.rolls })
      .catch((err) => console.error('Could not record game:', err));
  }

  // The absent player ran out of time: a bot takes over their seat for the rest of the game.
  function giveUp(room, player) {
    player.timer = null;
    if (!rooms.has(room.code) || !player.gone || room.bots.has(player.color)) return;
    // nobody is connected and nobody still has time to return: drop the room
    if (room.players.every((p) => p.gone && !p.timer)) { rooms.delete(room.code); return; }
    room.bots.add(player.color);
    broadcast(room, stateMsg(room, [{ type: 'bot', color: player.color }]));
    scheduleBot(room);
  }

  // The room of a host who is still in the lobby; otherwise tells the player why not and returns null.
  function lobbyHost(conn) {
    const room = conn.room;
    if (!room) { fail(conn, 'Not in a room'); return null; }
    if (room.host !== conn) { fail(conn, 'Only the host can do that'); return null; }
    if (room.state) { fail(conn, 'Game already started'); return null; }
    return room;
  }

  const handlers = {
    create(conn, msg) {
      const room = {
        code: newCode(), players: [], host: null, state: null,
        botCount: 0, bots: new Set(), botNames: {}, botTimer: null,
        rolls: {}, // userId -> dice that player rolled in this game (bots are not counted)
        settings: settings.defaults(), // the host changes these in the lobby
      };
      rooms.set(room.code, room);
      join(conn, room, msg.name);
    },

    join(conn, msg) {
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return fail(conn, 'No room with that code');
      join(conn, room, msg.name);
    },

    // The host changes game settings in the lobby. Only the keys sent are changed, and every value is checked.
    settings(conn, msg) {
      const room = lobbyHost(conn);
      if (!room) return;
      room.settings = settings.normalize(msg.settings, room.settings);
      broadcast(room, lobbyMsg(room));
    },

    addBot(conn) {
      const room = lobbyHost(conn);
      if (!room) return;
      if (room.players.length + room.botCount >= MAX_PLAYERS) return fail(conn, 'Room is full');
      room.botCount++;
      broadcast(room, lobbyMsg(room));
    },

    removeBot(conn) {
      const room = lobbyHost(conn);
      if (!room) return;
      if (room.botCount > 0) room.botCount--;
      broadcast(room, lobbyMsg(room));
    },

    // msg.fillBots: fill every empty seat (up to 4 players) with bots before starting
    start(conn, msg) {
      const room = lobbyHost(conn);
      if (!room) return;
      if (msg && msg.fillBots === true) room.botCount = Math.max(room.botCount, MAX_PLAYERS - room.players.length);
      const total = room.players.length + room.botCount;
      if (total < 2) return fail(conn, 'Need at least 2 players (add a bot to play solo)');
      const seats = SEATS[total];
      room.players.forEach((p, i) => {
        p.color = seats[i];
        p.secret = crypto.randomBytes(16).toString('hex');
      });
      for (let i = 0; i < room.botCount; i++) {
        const color = seats[room.players.length + i];
        room.bots.add(color);
        room.botNames[color] = 'Bot ' + (i + 1);
      }
      room.state = createGame(seats, secureRng, room.settings);
      room.players.forEach((p) => sendTo(p, { type: 'started', you: p.color, secret: p.secret }));
      broadcast(room, stateMsg(room));
      scheduleBot(room);
    },

    rejoin(conn, msg) {
      if (conn.room) return fail(conn, 'Already in a room');
      const room = rooms.get(String(msg.code || '').toUpperCase());
      const old = room && room.state && room.players.find((p) => p.secret && p.secret === msg.secret);
      if (!old || !old.gone || room.bots.has(old.color)) return fail(conn, 'Cannot rejoin this game');
      if (old.user && (!conn.user || conn.user.id !== old.user.id)) return fail(conn, 'Cannot rejoin this game');
      if (old.timer) { clearTimer(old.timer); old.timer = null; }
      // the new connection takes over the old player's seat
      Object.assign(conn, { room, color: old.color, name: old.name, secret: old.secret, gone: false });
      room.players[room.players.indexOf(old)] = conn;
      if (room.host === old) room.host = conn;
      sendTo(conn, { type: 'started', you: conn.color, secret: conn.secret });
      broadcast(room, stateMsg(room));
    },

    roll(conn) {
      const room = conn.room;
      if (!room || !room.state) return fail(conn, 'No game in progress');
      if (currentColor(room.state) !== conn.color) return fail(conn, 'Not your turn');
      const result = roll(room.state);
      room.state = result.state;
      if (conn.user) room.rolls[conn.user.id] = (room.rolls[conn.user.id] || 0) + 1; // every press of Roll counts
      broadcast(room, stateMsg(room, result.events));
      finishIfDone(room);
      scheduleBot(room);
    },

    // After picking up a trap the player chooses a square (ring index) for it.
    placeTrap(conn, msg) {
      const room = conn.room;
      if (!room || !room.state) return fail(conn, 'No game in progress');
      if (currentColor(room.state) !== conn.color) return fail(conn, 'Not your turn');
      const result = placeTrap(room.state, Number(msg.ring));
      room.state = result.state;
      broadcast(room, stateMsg(room, result.events));
      scheduleBot(room);
    },

    move(conn, msg) {
      const room = conn.room;
      if (!room || !room.state) return fail(conn, 'No game in progress');
      if (currentColor(room.state) !== conn.color) return fail(conn, 'Not your turn');
      const result = move(room.state, { token: msg.token, kind: msg.kind });
      room.state = result.state;
      broadcast(room, stateMsg(room, result.events));
      finishIfDone(room);
      scheduleBot(room);
    },
  };

  return {
    // `user` is the logged-in account ({ id, username }); the server only opens sockets for logged-in users.
    connect(send, user = null) {
      const id = nextId++;
      conns.set(id, { send, user, room: null, color: null, name: null, gone: false });
      return id;
    },

    handle(id, msg) {
      const conn = conns.get(id);
      if (!conn || !msg || typeof msg !== 'object') return;
      const handler = Object.prototype.hasOwnProperty.call(handlers, msg.type) ? handlers[msg.type] : null;
      if (!handler) return fail(conn, 'Unknown message');
      try { handler(conn, msg); } catch (err) { fail(conn, err.message); }
    },

    disconnect(id) {
      const conn = conns.get(id);
      conns.delete(id);
      if (!conn || !conn.room) return;
      const room = conn.room;
      if (!room.state) {
        room.players = room.players.filter((p) => p !== conn);
        if (room.players.length === 0) { rooms.delete(room.code); return; }
        if (room.host === conn) room.host = room.players[0];
        broadcast(room, lobbyMsg(room));
        return;
      }
      conn.gone = true;
      // the room is kept until every absent player has either returned or run out of time
      conn.timer = setTimer(() => giveUp(room, conn), rejoinMs);
      broadcast(room, stateMsg(room));
    },

    roomCount: () => rooms.size,
  };
}

module.exports = { createHub, publicState, REJOIN_MS };
