'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryStore, postgresStore } = require('../src/store');

// The same behaviour is expected from both stores. Postgres is run against pg-mem, an in-memory SQL engine.
async function stores() {
  const { newDb } = require('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  return [['memory', memoryStore()], ['postgres (pg-mem)', await postgresStore(new Pool())]];
}

test('both stores create and find users, ignoring case, and refuse duplicates', async () => {
  for (const [name, store] of await stores()) {
    const user = await store.createUser('Anna', 'hash1');
    assert.equal(user.username, 'Anna', name);
    assert.ok(user.id, name);
    assert.equal((await store.findByName('anna')).passwordHash, 'hash1', name);
    assert.equal((await store.findById(user.id)).username, 'Anna', name);
    assert.equal(await store.findByName('nobody'), null, name);
    await assert.rejects(() => store.createUser('ANNA', 'hash2'), { message: 'taken' }, name);
  }
});

test('both stores count played games and wins, and rank the leaderboard', async () => {
  for (const [name, store] of await stores()) {
    const a = await store.createUser('Anna', 'h');
    const b = await store.createUser('Ben', 'h');
    const c = await store.createUser('Cleo', 'h');
    assert.deepEqual(await store.getStats(a.id), { played: 0, won: 0 }, name);

    await store.recordGame({ winnerId: a.id, playerIds: [a.id, b.id] });
    await store.recordGame({ winnerId: a.id, playerIds: [a.id, b.id] });
    await store.recordGame({ winnerId: b.id, playerIds: [a.id, b.id] });
    await store.recordGame({ winnerId: null, playerIds: [c.id] }); // a bot won

    assert.deepEqual(await store.getStats(a.id), { played: 3, won: 2 }, name);
    assert.deepEqual(await store.getStats(b.id), { played: 3, won: 1 }, name);
    assert.deepEqual(await store.getStats(c.id), { played: 1, won: 0 }, name);
    assert.equal(await store.getStats(999), null, name);

    const board = await store.leaderboard(10);
    assert.deepEqual(board.map((r) => r.username), ['Anna', 'Ben', 'Cleo'], name);
    assert.deepEqual(await store.leaderboard(1), [{ username: 'Anna', played: 3, won: 2 }], name);
  }
});

test('players who never finished a game are not on the leaderboard', async () => {
  for (const [name, store] of await stores()) {
    await store.createUser('Idle', 'h');
    assert.deepEqual(await store.leaderboard(10), [], name);
  }
});

test('a game is counted once per player even if listed twice', async () => {
  for (const [name, store] of await stores()) {
    const a = await store.createUser('Anna', 'h');
    await store.recordGame({ winnerId: a.id, playerIds: [a.id, a.id] });
    assert.deepEqual(await store.getStats(a.id), { played: 1, won: 1 }, name);
  }
});
