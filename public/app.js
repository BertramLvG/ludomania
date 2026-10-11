'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const FACE = { star: 'Star', globus: 'Globus' };

  let ws = null;
  let me = null;       // my colour once the game starts
  let latest = null;   // latest public state
  const log = [];

  function show(section) {
    for (const id of ['menu', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== section);
  }
  const setError = (text) => { $('error').textContent = text || ''; };

  // The room code and secret survive a reload of this tab, so a dropped player can rejoin within a minute.
  let roomCode = null;
  const SESSION_KEY = 'ludomania-session';
  const saved = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } };
  const saveSession = (s) => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };
  const clearSession = () => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ } };
  let retryTimer = null;

  function rejoin() {
    const s = saved();
    if (!s) return;
    setError('Reconnecting to your game...');
    connect(() => send({ type: 'rejoin', code: s.code, secret: s.secret }));
  }

  function connect(then) {
    if (ws && ws.readyState === WebSocket.OPEN) return then();
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = then;
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (saved()) {
        // in a game: keep trying, the server holds the seat for 60 seconds
        setError('Connection lost. Trying to reconnect (you have 60 seconds)...');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(rejoin, 2000);
      } else {
        setError('Disconnected from the server. Reload the page to reconnect.');
      }
    };
  }
  const send = (msg) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  function name() { return $('name').value.trim() || 'Player'; }

  $('create').onclick = () => { setError(''); connect(() => send({ type: 'create', name: name() })); };
  $('join').onclick = () => {
    setError('');
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) return setError('Enter the 4-letter room code');
    connect(() => send({ type: 'join', code, name: name() }));
  };
  $('start').onclick = () => send({ type: 'start' });
  $('roll').onclick = () => send({ type: 'roll' });

  function describe(ev, names) {
    const who = (c) => names[c] || c;
    switch (ev.type) {
      case 'roll': return who(ev.color) + ' rolled ' + (FACE[ev.face] || ev.face);
      case 'skip':
        return who(ev.color) + ' rolled ' + (FACE[ev.face] || ev.face) +
          (ev.reroll ? ' and rolls again (all tokens in the yard)' : ' and could not move');
      case 'capture': return who(ev.by) + ' sent ' + who(ev.color) + "'s token home";
      case 'captured': return who(ev.color) + "'s token landed on a defended square and went back to the yard";
      case 'win': return who(ev.color) + ' wins!';
      case 'bot': return who(ev.color) + ' did not come back in time. A bot now plays that seat';
      default: return null;
    }
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'error':
        setError(msg.message);
        if (msg.message === 'Cannot rejoin this game') { clearSession(); clearTimeout(retryTimer); show('menu'); }
        break;
      case 'joined': roomCode = msg.code; $('roomCode').textContent = msg.code; show('lobby'); break;
      case 'lobby': renderLobby(msg); break;
      case 'started':
        me = msg.you;
        if (roomCode || saved()) saveSession({ code: roomCode || saved().code, secret: msg.secret });
        show('game');
        BoardView.drawBoard($('board'));
        break;
      case 'left': log.unshift(msg.name + ' left the game'); renderLog(); break;
      case 'state': latest = msg.state; applyState(msg); break;
    }
  }

  function renderLobby(msg) {
    $('roomCode').textContent = msg.code;
    $('lobbyPlayers').textContent = '';
    msg.players.forEach((p) => {
      const s = document.createElement('span');
      s.textContent = p.name + (p.host ? ' (host)' : '');
      $('lobbyPlayers').appendChild(s);
    });
    // the server enforces that only the host can start
    $('lobbyHint').textContent = msg.players.length < 2 ? 'Waiting for at least one more player' : 'Only the host can start the game';
  }

  function renderLog() {
    $('log').textContent = '';
    log.slice(0, 6).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      $('log').appendChild(li);
    });
  }

  function applyState(msg) {
    const s = msg.state;
    setError('');
    msg.events.forEach((ev) => { const t = describe(ev, s.names); if (t) log.unshift(t); });
    renderLog();

    $('players').textContent = '';
    s.colors.forEach((c, i) => {
      const span = document.createElement('span');
      const sw = document.createElement('i');
      sw.className = 'swatch';
      sw.style.background = BoardView.THEME[c].token;
      span.appendChild(sw);
      const tags = (c === me ? ' (you)' : '') + (s.bots.includes(c) ? ' (bot)' : '') +
        (s.away.includes(c) ? ' (away, can rejoin)' : '') + (i === s.turn && !s.winner ? ' - turn' : '');
      span.appendChild(document.createTextNode(s.names[c] + tags));
      $('players').appendChild(span);
    });

    const myTurn = !s.winner && s.colors[s.turn] === me;
    $('roll').disabled = !(myTurn && s.phase === 'roll');
    $('die').textContent = s.face === null ? '-' : (FACE[s.face] || s.face);

    const movable = new Map();
    if (myTurn && s.phase === 'move') s.moves.forEach((m) => movable.set(m.token, m.kind));

    if (s.winner) { $('status').textContent = s.names[s.winner] + ' wins!'; clearSession(); }
    else if (!myTurn) $('status').textContent = s.names[s.colors[s.turn]] + "'s turn";
    else $('status').textContent = s.phase === 'roll' ? 'Your turn - roll the die' : 'Pick a token to move';

    BoardView.drawTokens($('board'), s, new Set(movable.keys()), me, (token) => {
      send({ type: 'move', token, kind: movable.get(token) });
    });
  }

  show('menu');
  if (saved()) rejoin();
})();
