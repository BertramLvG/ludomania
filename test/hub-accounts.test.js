'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHub } = require('../src/hub');
const { chooseMove } = require('../src/bot');
const { memoryStore } = require('../src/store');

function client(hub, user) {
  const inbox = [];
  const id = hub.connect((m) => inbox.push(m), user);
  return {
    inbox,
    send: (msg) => hub.handle(id, msg),
    last: (type) => [...inbox].reverse().find((m) => m.type === type),
    leave: () => hub.disconnect(id),
  };
}

test('logged-in players use their account name, whatever the client sends', () => {
  const hub = createHub();
  const a = client(hub, { id: 1, username: 'Anna' });
  a.send({ type: 'create', name: 'Somebody Else' });
  const b = client(hub, { id: 2, username: 'Ben' });
  b.send({ type: 'join', code: a.last('joined').code, name: 'Impostor' });
  assert.deepEqual(a.last('lobby').players.map((p) => p.name), ['Anna', 'Ben']);
});

test('the same account cannot take two seats in one room', () => {
  const hub = createHub();
  const a = client(hub, { id: 1, username: 'Anna' });
  a.send({ type: 'create' });
  const again = client(hub, { id: 1, username: 'Anna' });
  again.send({ type: 'join', code: a.last('joined').code });
  assert.equal(again.last('error').message, 'You are already in this room');
});

test('only the account that owns a seat can rejoin it', () => {
  const timers = new Map();
  let n = 0;
  const hub = createHub({ setTimer: (fn) => { timers.set(++n, fn); return n; }, clearTimer: (id) => timers.delete(id) });
  const a = client(hub, { id: 1, username: 'Anna' });
  a.send({ type: 'create' });
  const code = a.last('joined').code;
  const b = client(hub, { id: 2, username: 'Ben' });
  b.send({ type: 'join', code });
  a.send({ type: 'start' });
  const secret = a.last('started').secret;
  a.leave();

  const other = client(hub, { id: 3, username: 'Mallory' });
  other.send({ type: 'rejoin', code, secret }); // even with the stolen secret
  assert.equal(other.last('error').message, 'Cannot rejoin this game');

  const back = client(hub, { id: 1, username: 'Anna' });
  back.send({ type: 'rejoin', code, secret });
  assert.equal(back.last('started').you, 'red');
});

test('a finished game is recorded for the human players, and the winner gets the win', async () => {
  const store = memoryStore();
  const anna = await store.createUser('Anna', 'h');
  const ben = await store.createUser('Ben', 'h');
  const hub = createHub({ store });
  const a = client(hub, anna);
  a.send({ type: 'create' });
  const b = client(hub, ben);
  b.send({ type: 'join', code: a.last('joined').code });
  a.send({ type: 'start' });
  const players = { red: a, yellow: b };

  // both humans play a whole game, always picking the bot's preferred move
  let state = a.last('state').state;
  let rolled = 0;
  for (let i = 0; i < 20000 && !state.winner; i++) {
    const me = players[state.colors[state.turn]];
    if (state.phase === 'roll') { me.send({ type: 'roll' }); rolled++; }
    else {
      const m = chooseMove(state);
      me.send({ type: 'move', token: m.token, kind: m.kind });
    }
    state = a.last('state').state;
  }
  assert.ok(state.winner, 'the game should finish');
  await new Promise((resolve) => setImmediate(resolve));

  const winnerUser = state.winner === 'red' ? anna : ben;
  const loserUser = state.winner === 'red' ? ben : anna;
  const w = await store.getStats(winnerUser.id);
  const l = await store.getStats(loserUser.id);
  assert.deepEqual([w.played, w.won, l.played, l.won], [1, 1, 1, 0]);
  // every press of Roll was counted: the two players' counts add up to the rolls in the log
  assert.ok(w.diceRolled > 0 && l.diceRolled > 0);
  assert.equal(w.diceRolled + l.diceRolled, rolled);
});

test('when a bot wins, the human still gets a played game but no win', async () => {
  const store = memoryStore();
  const anna = await store.createUser('Anna', 'h');
  const timers = [];
  const hub = createHub({ store, setBotTimer: (fn) => { timers.push(fn); return timers.length; } });
  const a = client(hub, anna);
  a.send({ type: 'create' });
  a.send({ type: 'addBot' });
  a.send({ type: 'start' });

  // Anna just passes along (rolls and picks moves) while the bot plays; run until someone wins
  let state = a.last('state').state;
  for (let i = 0; i < 40000 && !state.winner; i++) {
    if (state.colors[state.turn] === 'red') {
      if (state.phase === 'roll') a.send({ type: 'roll' });
      else { const m = state.moves[0]; a.send({ type: 'move', token: m.token, kind: m.kind }); }
    } else if (timers.length) timers.shift()();
    state = a.last('state').state;
  }
  assert.ok(state.winner, 'the game should finish');
  await new Promise((resolve) => setImmediate(resolve));
  const stats = await store.getStats(anna.id);
  assert.equal(stats.played, 1);
  assert.equal(stats.won, state.winner === 'red' ? 1 : 0);
  assert.ok(stats.diceRolled > 0); // only Anna's own rolls, not the bot's
});

test('a game that nobody wins is not recorded', async () => {
  const store = memoryStore();
  const anna = await store.createUser('Anna', 'h');
  const hub = createHub({ store });
  const a = client(hub, anna);
  a.send({ type: 'create' });
  a.send({ type: 'addBot' });
  a.send({ type: 'start' });
  a.leave();
  assert.deepEqual(await store.getStats(anna.id), { played: 0, won: 0, diceRolled: 0 });
});
