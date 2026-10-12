'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApi } = require('../src/api');
const { memoryStore } = require('../src/store');
const auth = require('../src/auth');

async function start() {
  const store = memoryStore();
  const api = createApi({ store, secret: 'test-secret' });
  const server = http.createServer(async (req, res) => {
    if (!(await api.handle(req, res))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, path, body, cookie, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const setCookie = res.headers.getSetCookie()[0] || '';
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie.split(';')[0], setCookie };
  };
  return { store, call, close: () => server.close() };
}

test('registering creates an account and logs the user in', async (t) => {
  const { call, close } = await start();
  t.after(close);
  const r = await call('POST', '/api/register', { username: 'Anna', password: 'password123' });
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /HttpOnly/);
  const me = await call('GET', '/api/me', undefined, r.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'Anna');
  assert.deepEqual(me.body.stats, { played: 0, won: 0, diceRolled: 0 });
});

test('the password is never stored in plain text', async (t) => {
  const { call, store, close } = await start();
  t.after(close);
  await call('POST', '/api/register', { username: 'Anna', password: 'password123' });
  const user = await store.findByName('Anna');
  assert.ok(!user.passwordHash.includes('password123'));
});

test('bad registrations are rejected', async (t) => {
  const { call, close } = await start();
  t.after(close);
  assert.equal((await call('POST', '/api/register', { username: 'ab', password: 'password123' })).status, 400);
  assert.equal((await call('POST', '/api/register', { username: 'Anna', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/register', {})).status, 400);
  await call('POST', '/api/register', { username: 'Anna', password: 'password123' });
  assert.equal((await call('POST', '/api/register', { username: 'ANNA', password: 'password456' })).status, 409);
});

test('login works with the right password and fails with the wrong one', async (t) => {
  const { call, close } = await start();
  t.after(close);
  await call('POST', '/api/register', { username: 'Anna', password: 'password123' });
  const ok = await call('POST', '/api/login', { username: 'anna', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.username, 'Anna');
  assert.equal((await call('POST', '/api/login', { username: 'Anna', password: 'nope-nope' })).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'Nobody', password: 'password123' })).status, 401);
});

test('too many wrong passwords lock the account for a while', async (t) => {
  const { call, close } = await start();
  t.after(close);
  await call('POST', '/api/register', { username: 'Anna', password: 'password123' });
  for (let i = 0; i < 8; i++) await call('POST', '/api/login', { username: 'Anna', password: 'wrong-wrong' });
  assert.equal((await call('POST', '/api/login', { username: 'Anna', password: 'password123' })).status, 429);
});

test('without a valid cookie the user is not logged in', async (t) => {
  const { call, close } = await start();
  t.after(close);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', undefined, 'ludo_session=garbage')).status, 401);
  const forged = auth.signSession(1, 'wrong-secret');
  assert.equal((await call('GET', '/api/me', undefined, 'ludo_session=' + forged)).status, 401);
  assert.equal((await call('GET', '/api/leaderboard')).status, 401);
});

test('logout clears the cookie', async (t) => {
  const { call, close } = await start();
  t.after(close);
  const r = await call('POST', '/api/logout');
  assert.equal(r.status, 204);
  assert.match(r.setCookie, /Max-Age=0/);
});

test('the leaderboard lists players with finished games', async (t) => {
  const { call, store, close } = await start();
  t.after(close);
  const a = await call('POST', '/api/register', { username: 'Anna', password: 'password123' });
  const user = await store.findByName('Anna');
  await store.recordGame({ winnerId: user.id, playerIds: [user.id] });
  const board = await call('GET', '/api/leaderboard', undefined, a.cookie);
  assert.deepEqual(board.body.players, [{ username: 'Anna', played: 1, won: 1 }]);
});

test('requests that are not JSON are refused', async (t) => {
  const { call, close } = await start();
  t.after(close);
  const r = await call('POST', '/api/login', undefined, undefined, { 'Content-Type': 'text/plain' });
  assert.equal(r.status, 400);
});
