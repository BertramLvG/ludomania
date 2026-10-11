'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHub } = require('../src/hub');

function client(hub) {
  const inbox = [];
  const id = hub.connect((m) => inbox.push(m));
  return {
    inbox,
    send: (msg) => hub.handle(id, msg),
    last: (type) => [...inbox].reverse().find((m) => m.type === type),
    leave: () => hub.disconnect(id),
  };
}

function startedGame(hub, names = ['Anna', 'Ben']) {
  const clients = names.map(() => client(hub));
  clients[0].send({ type: 'create', name: names[0] });
  const code = clients[0].last('joined').code;
  clients.slice(1).forEach((c, i) => c.send({ type: 'join', code, name: names[i + 1] }));
  clients[0].send({ type: 'start' });
  return { clients, code };
}

test('creating and joining a room fills the lobby', () => {
  const hub = createHub();
  const { clients, code } = startedGame(hub);
  assert.match(code, /^[A-Z]{4}$/);
  assert.deepEqual(clients[1].inbox.find((m) => m.type === 'lobby').players.map((p) => p.name), ['Anna', 'Ben']);
});

test('joining an unknown room is an error', () => {
  const hub = createHub();
  const c = client(hub);
  c.send({ type: 'join', code: 'ZZZZ', name: 'Eve' });
  assert.equal(c.last('error').message, 'No room with that code');
});

test('only the host can start, and it needs two players', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  a.send({ type: 'start' });
  assert.match(a.last('error').message, /^Need at least 2 players/);
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  b.send({ type: 'start' });
  assert.equal(b.last('error').message, 'Only the host can do that');
});

test('two players get red and yellow, and the state is broadcast', () => {
  const hub = createHub();
  const { clients } = startedGame(hub);
  assert.equal(clients[0].last('started').you, 'red');
  assert.equal(clients[1].last('started').you, 'yellow');
  const state = clients[1].last('state').state;
  assert.deepEqual(state.colors, ['red', 'yellow']);
  assert.deepEqual(state.names, { red: 'Anna', yellow: 'Ben' });
  assert.equal(state.rng, undefined);
});

test('players cannot roll out of turn', () => {
  const hub = createHub();
  const { clients } = startedGame(hub);
  clients[1].send({ type: 'roll' });
  assert.equal(clients[1].last('error').message, 'Not your turn');
});

test('the server rolls the die for the current player', () => {
  const hub = createHub();
  const { clients } = startedGame(hub);
  clients[0].send({ type: 'roll' });
  const update = clients[1].last('state');
  assert.ok(update.events.length > 0);
  assert.ok(['roll', 'skip'].includes(update.events[0].type));
});

test('bad input is rejected without crashing', () => {
  const hub = createHub();
  const { clients } = startedGame(hub);
  clients[0].send({ type: 'move', token: 0, kind: 'step' });
  assert.ok(clients[0].last('error'));
  clients[0].send({ type: 'nonsense' });
  assert.equal(clients[0].last('error').message, 'Unknown message');
  clients[0].send({ type: '__proto__' });
  clients[0].send(null);
});

// A hub whose 60-second timers only fire when the test says so.
function manualHub() {
  const pending = new Map();
  const botQueue = [];
  let n = 0;
  const hub = createHub({
    rejoinMs: 60000,
    setTimer: (fn) => { pending.set(++n, fn); return n; },
    clearTimer: (id) => pending.delete(id),
    setBotTimer: (fn) => { botQueue.push(fn); return botQueue.length; },
  });
  return {
    hub, pending,
    fireAll: () => [...pending.values()].forEach((fn) => { pending.clear(); fn(); }),
    // lets the bots play until it is a human's turn again
    runBots: () => { let steps = 0; while (botQueue.length && steps++ < 500) botQueue.shift()(); return steps; },
  };
}

test('a player can rejoin before the time runs out and carry on', () => {
  const { hub, pending } = manualHub();
  const { clients, code } = startedGame(hub);
  const secret = clients[0].last('started').secret;
  clients[0].leave();
  assert.deepEqual(clients[1].last('state').state.away, ['red']);
  assert.equal(pending.size, 1);

  const back = client(hub);
  back.send({ type: 'rejoin', code, secret });
  assert.equal(back.last('started').you, 'red');
  assert.deepEqual(back.last('state').state.away, []);
  assert.equal(pending.size, 0); // the countdown was cancelled

  back.send({ type: 'roll' });
  assert.ok(back.last('state').events.length > 0);
});

test('rejoining needs the right secret', () => {
  const { hub } = manualHub();
  const { clients, code } = startedGame(hub);
  clients[0].leave();
  const thief = client(hub);
  thief.send({ type: 'rejoin', code, secret: 'nope' });
  assert.equal(thief.last('error').message, 'Cannot rejoin this game');
  // the other player's secret is not a way into red's seat either
  thief.send({ type: 'rejoin', code, secret: clients[1].last('started').secret });
  assert.equal(thief.last('error').message, 'Cannot rejoin this game');
});

test('after 60 seconds a bot takes over the absent player and the game carries on', () => {
  const { hub, fireAll, runBots } = manualHub();
  const { clients, code } = startedGame(hub);
  const secret = clients[0].last('started').secret;
  clients[0].leave(); // red, whose turn it is
  fireAll();
  assert.deepEqual(clients[1].last('state').state.bots, ['red']);
  assert.ok(clients[1].inbox.some((m) => m.type === 'state' && m.events.some((e) => e.type === 'bot')));

  runBots(); // the bot plays red's turn until it passes to yellow
  const state = clients[1].last('state').state;
  assert.equal(state.winner, null);
  assert.equal(state.colors[state.turn], 'yellow');
  assert.ok(clients[1].inbox.some((m) => m.type === 'state' && m.events.some((e) => e.color === 'red' && (e.type === 'roll' || e.type === 'skip'))));

  // the human keeps playing, and the bot answers on its next turn
  clients[1].send({ type: 'roll' });
  const after = clients[1].last('state').state;
  if (after.phase === 'move') clients[1].send({ type: 'move', token: after.moves[0].token, kind: after.moves[0].kind });
  runBots();
  assert.equal(clients[1].last('state').state.colors[clients[1].last('state').state.turn], 'yellow');

  const late = client(hub);
  late.send({ type: 'rejoin', code, secret });
  assert.equal(late.last('error').message, 'Cannot rejoin this game');
});

test('a bot does not play while the absent player still has time to return', () => {
  const { hub, runBots } = manualHub();
  const { clients } = startedGame(hub);
  clients[0].leave();
  assert.equal(runBots(), 0);
  assert.equal(clients[1].last('state').state.colors[clients[1].last('state').state.turn], 'red');
});

test('when two players are away, the second still gets their full minute', () => {
  const { hub, pending } = manualHub();
  const { clients, code } = startedGame(hub, ['Anna', 'Ben', 'Cleo']);
  const secretB = clients[1].last('started').secret;
  clients[0].leave();
  clients[1].leave();
  const first = [...pending.keys()][0];
  pending.get(first)(); // Anna's minute is up, Ben's is not
  pending.delete(first);
  assert.equal(hub.roomCount(), 1);
  const back = client(hub);
  back.send({ type: 'rejoin', code, secret: secretB });
  assert.equal(back.last('started').you, 'green');
});

test('a room is removed once everyone has left and run out of time', () => {
  const { hub, fireAll } = manualHub();
  const { clients } = startedGame(hub);
  assert.equal(hub.roomCount(), 1);
  clients.forEach((c) => c.leave());
  assert.equal(hub.roomCount(), 1); // still waiting for possible rejoins
  fireAll();
  assert.equal(hub.roomCount(), 0);
});

test('the host can add bots and play solo; bots take their turns', () => {
  const { hub, runBots } = manualHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  a.send({ type: 'addBot' });
  a.send({ type: 'addBot' });
  a.send({ type: 'addBot' });
  assert.equal(a.last('lobby').bots, 3);
  a.send({ type: 'addBot' });
  assert.equal(a.last('error').message, 'Room is full');
  a.send({ type: 'removeBot' });
  a.send({ type: 'start' });
  const state = a.last('state').state;
  assert.deepEqual(state.colors, ['red', 'green', 'yellow']);
  assert.deepEqual(state.bots, ['green', 'yellow']);
  assert.deepEqual(state.names, { green: 'Bot 1', yellow: 'Bot 2', red: 'Anna' });

  // play: the human rolls, the bots answer until it is the human's turn again
  for (let i = 0; i < 20; i++) {
    const s = a.last('state').state;
    if (s.colors[s.turn] !== 'red') { runBots(); continue; }
    if (s.phase === 'roll') a.send({ type: 'roll' });
    else a.send({ type: 'move', token: s.moves[0].token, kind: s.moves[0].kind });
  }
  assert.ok(a.inbox.some((m) => m.type === 'state' && m.events.some((e) => e.color === 'green')));
});

test('only the host can add bots, and not after the game has started', () => {
  const { hub } = manualHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  b.send({ type: 'addBot' });
  assert.equal(b.last('error').message, 'Only the host can do that');
  a.send({ type: 'start' });
  a.send({ type: 'addBot' });
  assert.equal(a.last('error').message, 'Game already started');
});

test('a solo game is removed when the only human leaves and the minute is up', () => {
  const { hub, fireAll } = manualHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  a.send({ type: 'addBot' });
  a.send({ type: 'start' });
  a.leave();
  assert.equal(hub.roomCount(), 1);
  fireAll();
  assert.equal(hub.roomCount(), 0);
});

test('leaving the lobby before the game starts removes the player straight away', () => {
  const { hub } = manualHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  a.leave();
  assert.deepEqual(b.last('lobby').players, [{ name: 'Ben', host: true }]);
});

test('a full room rejects a fifth player', () => {
  const hub = createHub();
  const { code } = startedGame(hub, ['A']);
  const joiners = [1, 2, 3].map(() => client(hub));
  joiners.forEach((c) => c.send({ type: 'join', code, name: 'x' }));
  const fifth = client(hub);
  fifth.send({ type: 'join', code, name: 'late' });
  assert.equal(fifth.last('error').message, 'Room is full');
});
