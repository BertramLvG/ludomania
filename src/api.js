'use strict';

const auth = require('./auth');

const MAX_BODY = 4096;

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new Error('Expected JSON'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);

// Account routes under /api. `secret` signs session cookies.
function createApi({ store, secret, limiter = auth.createLimiter() }) {
  // The logged-in user for a request (HTTP or the WebSocket upgrade), or null.
  async function authenticate(req) {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
    const id = auth.verifySession(token, secret);
    return id == null ? null : store.findById(id);
  }

  async function register(req, res) {
    const { username, password } = await readJson(req);
    const problem = auth.validateUsername(username) || auth.validatePassword(password);
    if (problem) return send(res, 400, { error: problem });
    let user;
    try {
      user = await store.createUser(username, await auth.hashPassword(password));
    } catch (err) {
      if (err.message === 'taken') return send(res, 409, { error: 'That username is taken' });
      throw err;
    }
    send(res, 201, { username: user.username }, { 'Set-Cookie': auth.sessionCookie(auth.signSession(user.id, secret), isSecure(req)) });
  }

  async function login(req, res) {
    const { username, password } = await readJson(req);
    if (typeof username !== 'string' || typeof password !== 'string') return send(res, 400, { error: 'Enter username and password' });
    const key = (req.socket.remoteAddress || '') + '|' + username.toLowerCase();
    if (limiter.blocked(key)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes' });
    const user = await store.findByName(username);
    // always do the expensive hash work, so a missing user takes as long as a wrong password
    const ok = await auth.verifyPassword(password, user ? user.passwordHash : 'x:y');
    if (!user || !ok) {
      limiter.fail(key);
      return send(res, 401, { error: 'Wrong username or password' });
    }
    limiter.reset(key);
    send(res, 200, { username: user.username }, { 'Set-Cookie': auth.sessionCookie(auth.signSession(user.id, secret), isSecure(req)) });
  }

  // Returns true when the request was an API route.
  async function handle(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return false;
    try {
      if (req.method === 'POST' && path === '/api/register') await register(req, res);
      else if (req.method === 'POST' && path === '/api/login') await login(req, res);
      else if (req.method === 'POST' && path === '/api/logout') send(res, 204, undefined, { 'Set-Cookie': auth.clearCookie(isSecure(req)) });
      else if (req.method === 'GET' && path === '/api/me') {
        const user = await authenticate(req);
        if (!user) return send(res, 401, { error: 'Not logged in' }), true;
        send(res, 200, { username: user.username, stats: await store.getStats(user.id) });
      } else if (req.method === 'GET' && path === '/api/leaderboard') {
        if (!(await authenticate(req))) return send(res, 401, { error: 'Not logged in' }), true;
        send(res, 200, { players: await store.leaderboard(10) });
      } else send(res, 404, { error: 'Not found' });
    } catch (err) {
      const client = ['Expected JSON', 'Invalid JSON', 'Too large'].includes(err.message);
      if (!client) console.error('API error:', err);
      if (!res.headersSent) send(res, client ? 400 : 500, { error: client ? err.message : 'Something went wrong' });
    }
    return true;
  }

  return { handle, authenticate };
}

module.exports = { createApi };
