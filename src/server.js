'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { createHub } = require('./hub');
const { createStore } = require('./store');
const { createApi } = require('./api');

// Optional local settings (DATABASE_URL, SESSION_SECRET) from a .env file that is never committed.
try { process.loadEnvFile(); } catch { /* no .env file */ }

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const SHARED_FILES = {
  '/board.js': path.join(__dirname, 'board.js'),
  '/settings.js': path.join(__dirname, 'settings.js'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function main() {
  const store = await createStore();
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('SESSION_SECRET is not set: everyone is logged out whenever the server restarts.');
  }
  const api = createApi({ store, secret });
  const hub = createHub({ store });

  const server = http.createServer(async (req, res) => {
    if (await api.handle(req, res)) return;
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    // these files are used by both the server and the browser, so they live in src/
    const shared = SHARED_FILES[urlPath];
    const file = shared || path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
    if (!shared && !file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: 4096,
    // only accept sockets opened by pages from this same site
    verifyClient: ({ origin, req }) => {
      if (!origin) return true;
      try { return new URL(origin).host === req.headers.host; } catch { return false; }
    },
  });

  wss.on('connection', (ws, req) => {
    // messages that arrive while the login check is still running are kept and handled afterwards
    const early = [];
    let id = null;
    let closed = false;
    const handleRaw = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      hub.handle(id, msg);
    };
    ws.on('message', (data) => (id === null ? early.push(data) : handleRaw(data)));
    ws.on('close', () => { closed = true; if (id !== null) hub.disconnect(id); });

    api.authenticate(req).then((user) => {
      if (closed) return;
      if (!user) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not logged in' }));
        ws.close();
        return;
      }
      id = hub.connect((msg) => ws.send(JSON.stringify(msg)), { id: user.id, username: user.username });
      early.splice(0).forEach(handleRaw);
    }).catch((err) => {
      console.error('Login check failed:', err);
      ws.close();
    });
  });

  server.listen(PORT, () => console.log('Ludomania listening on http://localhost:' + PORT + ' (' + store.kind + ' store)'));
}

main().catch((err) => {
  console.error('Could not start the server:', err);
  process.exit(1);
});
