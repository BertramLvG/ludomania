'use strict';

// Where users and their statistics live. Two interchangeable stores with the same methods:
//   createUser(username, passwordHash) -> { id, username }   (throws Error('taken') if the name exists)
//   findByName(username) / findById(id) -> { id, username, passwordHash } | null
//   recordGame({ winnerId, playerIds, rolls })   adds a played game to every player and a win to the winner;
//                                                 rolls is { userId: number of dice they rolled in this game }
//   getStats(id) -> { played, won, diceRolled } | null
//   leaderboard(limit) -> [{ username, played, won }]

function memoryStore() {
  const users = new Map(); // id -> user
  let nextId = 1;
  const byName = (name) => [...users.values()].find((u) => u.usernameLower === String(name).toLowerCase());

  return {
    kind: 'memory',
    async createUser(username, passwordHash) {
      if (byName(username)) throw new Error('taken');
      const user = { id: nextId++, username, usernameLower: username.toLowerCase(), passwordHash, played: 0, won: 0, diceRolled: 0 };
      users.set(user.id, user);
      return { id: user.id, username };
    },
    async findByName(username) { return byName(username) || null; },
    async findById(id) { return users.get(Number(id)) || null; },
    async recordGame({ winnerId, playerIds, rolls = {} }) {
      for (const id of new Set(playerIds)) {
        const u = users.get(Number(id));
        if (u) { u.played++; u.diceRolled += rolls[id] || 0; }
      }
      const w = users.get(Number(winnerId));
      if (w) w.won++;
    },
    async getStats(id) {
      const u = users.get(Number(id));
      return u ? { played: u.played, won: u.won, diceRolled: u.diceRolled } : null;
    },
    async leaderboard(limit = 10) {
      return rank([...users.values()].map((u) => ({ username: u.username, played: u.played, won: u.won })), limit);
    },
  };
}

// Most wins first, then the better win rate, then the name.
function rank(rows, limit) {
  return rows
    .filter((r) => r.played > 0)
    .sort((a, b) => b.won - a.won || b.won / b.played - a.won / a.played || a.username.localeCompare(b.username))
    .slice(0, limit);
}

// `pool` is a pg Pool (or anything with .query(text, values)).
async function postgresStore(pool) {
  const works = (sql) => pool.query(sql).then(() => true, () => false);
  if (!(await works('SELECT 1 FROM users LIMIT 1'))) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        games_played INTEGER NOT NULL DEFAULT 0,
        games_won INTEGER NOT NULL DEFAULT 0,
        dice_rolled INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);
  } else if (!(await works('SELECT dice_rolled FROM users LIMIT 1'))) {
    // a table created before dice were counted gets the new column
    await pool.query('ALTER TABLE users ADD COLUMN dice_rolled INTEGER NOT NULL DEFAULT 0');
    await pool.query('UPDATE users SET dice_rolled = 0'); // the column was just added, so every row starts at 0
  }

  const toUser = (r) => (r ? { id: r.id, username: r.username, passwordHash: r.password_hash } : null);

  return {
    kind: 'postgres',
    async createUser(username, passwordHash) {
      try {
        const res = await pool.query(
          'INSERT INTO users (username, username_lower, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
          [username, username.toLowerCase(), passwordHash]);
        return { id: res.rows[0].id, username: res.rows[0].username };
      } catch (err) {
        if (err && (err.code === '23505' || /unique|duplicate/i.test(String(err.message)))) throw new Error('taken');
        throw err;
      }
    },
    async findByName(username) {
      const res = await pool.query('SELECT * FROM users WHERE username_lower = $1', [String(username).toLowerCase()]);
      return toUser(res.rows[0]);
    },
    async findById(id) {
      const res = await pool.query('SELECT * FROM users WHERE id = $1', [Number(id)]);
      return toUser(res.rows[0]);
    },
    async recordGame({ winnerId, playerIds, rolls = {} }) {
      for (const id of new Set(playerIds)) {
        await pool.query(
          'UPDATE users SET games_played = games_played + 1, dice_rolled = dice_rolled + $2 WHERE id = $1',
          [Number(id), rolls[id] || 0]);
      }
      if (winnerId != null) await pool.query('UPDATE users SET games_won = games_won + 1 WHERE id = $1', [Number(winnerId)]);
    },
    async getStats(id) {
      const res = await pool.query('SELECT games_played, games_won, dice_rolled FROM users WHERE id = $1', [Number(id)]);
      const r = res.rows[0];
      return r ? { played: r.games_played, won: r.games_won, diceRolled: r.dice_rolled } : null;
    },
    async leaderboard(limit = 10) {
      const res = await pool.query('SELECT username, games_played, games_won FROM users WHERE games_played > 0');
      return rank(res.rows.map((r) => ({ username: r.username, played: r.games_played, won: r.games_won })), limit);
    },
  };
}

// DATABASE_URL set -> Postgres (Supabase, Neon, Render...). Otherwise an in-memory store for local development.
async function createStore(env = process.env) {
  if (!env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set: using an in-memory store. Accounts are lost when the server restarts.');
    return memoryStore();
  }
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 5,
  });
  return postgresStore(pool);
}

module.exports = { memoryStore, postgresStore, createStore };
