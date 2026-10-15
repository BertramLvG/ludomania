'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../src/settings');
const { createHub } = require('../src/hub');

function client(hub, user) {
  const inbox = [];
  const id = hub.connect((m) => inbox.push(m), user);
  return {
    inbox,
    send: (msg) => hub.handle(id, msg),
    last: (type) => [...inbox].reverse().find((m) => m.type === type),
  };
}

test('by default power-ups are off', () => {
  const d = settings.defaults();
  assert.equal(d.powerUps, false);
  assert.equal(d.powerUpRate, 5);
  assert.equal(d.powerUpMax, 3);
});

test('valid values are accepted, sliders are rounded and kept inside their range', () => {
  const n = settings.normalize({ powerUps: true, powerUpRate: 7.6, powerUpMax: 99 });
  assert.deepEqual(n, { powerUps: true, powerUpRate: 8, powerUpMax: 8 });
  assert.equal(settings.normalize({ powerUpRate: -5 }).powerUpRate, 1);
});

test('invalid values and unknown keys are ignored', () => {
  const base = { powerUps: true, powerUpRate: 9, powerUpMax: 2 };
  const n = settings.normalize({ powerUps: 'yes', powerUpRate: 'fast', powerUpMax: null, evil: 1, __proto__: { x: 1 } }, base);
  assert.deepEqual(n, base);
  assert.equal(settings.normalize(null, base).powerUpRate, 9);
  assert.equal(settings.normalize({ powerUpRate: true }, base).powerUpRate, 9);
  assert.equal(settings.normalize({ powerUpRate: '' }, base).powerUpRate, 9);
});

test('a partial update only changes the keys sent', () => {
  const base = { powerUps: true, powerUpRate: 9, powerUpMax: 2 };
  assert.deepEqual(settings.normalize({ powerUpRate: 3 }, base), { powerUps: true, powerUpRate: 3, powerUpMax: 2 });
});

test('the host changes settings in the lobby and everyone sees them', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  assert.equal(a.last('lobby').settings.powerUps, false);

  a.send({ type: 'settings', settings: { powerUps: true, powerUpRate: 8 } });
  assert.deepEqual(b.last('lobby').settings, { powerUps: true, powerUpRate: 8, powerUpMax: 3 });
  a.send({ type: 'settings', settings: { powerUpMax: 5 } });
  assert.deepEqual(a.last('lobby').settings, { powerUps: true, powerUpRate: 8, powerUpMax: 5 });
});

test('only the host can change settings, and not after the game has started', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  b.send({ type: 'settings', settings: { powerUps: true } });
  assert.equal(b.last('error').message, 'Only the host can do that');
  assert.equal(a.last('lobby').settings.powerUps, false);

  a.send({ type: 'settings', settings: { powerUps: true } });
  a.send({ type: 'start' });
  a.send({ type: 'settings', settings: { powerUps: false } });
  assert.equal(a.last('error').message, 'Game already started');
});

test('the chosen settings go with the game state', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  a.send({ type: 'settings', settings: { powerUps: true, powerUpRate: 2, powerUpMax: 6 } });
  a.send({ type: 'start' });
  assert.deepEqual(b.last('state').state.settings, { powerUps: true, powerUpRate: 2, powerUpMax: 6 });
});

test('with power-ups on, the public state carries everything the board needs', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  a.send({ type: 'settings', settings: { powerUps: true } });
  a.send({ type: 'start' });
  const s = b.last('state').state;
  assert.deepEqual(s.powerUps, []);
  assert.deepEqual(s.traps, []);
  assert.deepEqual(s.shield.red, [false, false, false, false]);
  assert.deepEqual(s.boost, { red: 0, yellow: 0 });
  assert.equal(s.boosted, false);
  assert.equal(s.placing, null);
});

test('placing a trap out of turn, or when none is due, is refused', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  const b = client(hub);
  b.send({ type: 'join', code: a.last('joined').code, name: 'Ben' });
  a.send({ type: 'start' });
  b.send({ type: 'placeTrap', ring: 5 });
  assert.equal(b.last('error').message, 'Not your turn');
  a.send({ type: 'placeTrap', ring: 5 });
  assert.equal(a.last('error').message, 'Not time to place a trap');
  a.send({ type: 'placeTrap', ring: 'abc' });
  assert.ok(a.last('error'));
});

test('garbage in the settings message cannot break the room', () => {
  const hub = createHub();
  const a = client(hub);
  a.send({ type: 'create', name: 'Anna' });
  a.send({ type: 'settings' });
  a.send({ type: 'settings', settings: 'nope' });
  a.send({ type: 'settings', settings: { powerUpRate: {} } });
  assert.deepEqual(a.last('lobby').settings, settings.defaults());
});
