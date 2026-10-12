'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const FACE = { star: 'Star', globus: 'Globus' };

  let ws = null;
  let me = null;       // my colour once the game starts
  let leaving = false;
  const log = [];

  function show(section) {
    for (const id of ['menu', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== section);
    $('leaveBtn').classList.toggle('hidden', section === 'menu');
  }
  const setError = (text) => { $('error').textContent = text || ''; };

  /* ---------- Day / Night ---------- */
  // Always starts in night mode; the switch only changes the theme for this visit.
  const themeSwitch = $('themeSwitch');
  function setTheme(night) {
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    themeSwitch.setAttribute('aria-checked', String(night));
    $('themeLabel').textContent = night ? 'Night' : 'Day';
  }
  themeSwitch.addEventListener('click', () => setTheme(themeSwitch.getAttribute('aria-checked') !== 'true'));

  /* ---------- Rules ---------- */
  $('rulesBtn').onclick = () => $('rules').showModal();
  $('rulesClose').onclick = () => $('rules').close();

  /* ---------- Connection ---------- */
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
    leaving = false;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = then;
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (leaving) return;
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

  const name = () => $('name').value.trim() || 'Player';

  $('create').onclick = () => { setError(''); connect(() => send({ type: 'create', name: name() })); };
  $('join').onclick = () => {
    setError('');
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) return setError('Enter the 4-letter room code');
    connect(() => send({ type: 'join', code, name: name() }));
  };
  // The host can start with two or more people. Unless the lobby is full, they are asked about bots first.
  let lobbyInfo = null;
  $('start').onclick = () => {
    if (!lobbyInfo) return;
    const n = lobbyInfo.players.length;
    if (n >= 4) return send({ type: 'start' });
    $('startText').textContent = 'There ' + (n === 1 ? 'is 1 player' : 'are ' + n + ' players') +
      ' in the lobby. Do you want bots to fill the empty seats, or play with just the people here?';
    $('startAsIs').textContent = 'Play with ' + n + ' players';
    $('startAsIs').classList.toggle('hidden', n < 2);
    $('startDialog').showModal();
  };
  $('startBots').onclick = () => { $('startDialog').close(); send({ type: 'start', fillBots: true }); };
  $('startAsIs').onclick = () => { $('startDialog').close(); send({ type: 'start' }); };
  $('startCancel').onclick = () => $('startDialog').close();
  let soloPending = false;
  $('solo').onclick = () => {
    setError('');
    soloPending = true;
    connect(() => send({ type: 'create', name: name() }));
  };

  $('leaveBtn').onclick = () => {
    if (!window.confirm('Leave this game?')) return;
    leaving = true;
    clearSession();
    clearTimeout(retryTimer);
    if (ws) ws.close();
    ws = null; me = null; roomCode = null;
    log.length = 0;
    resetRolls();
    game = null; selected = null;
    setError('');
    show('menu');
  };

  /* ---------- Messages ---------- */
  function describe(ev, names) {
    const who = (c) => names[c] || c;
    switch (ev.type) {
      case 'roll': return who(ev.color) + ' rolled ' + (FACE[ev.face] || ev.face) + (ev.face === 'globus' ? ' - roll again!' : '');
      case 'skip':
        return who(ev.color) + ' rolled ' + (FACE[ev.face] || ev.face) +
          (ev.reroll ? ' and rolls again (all tokens in the base)' : ev.face === 'globus' ? ' - roll again!' : ' and could not move');
      case 'capture': return who(ev.by) + ' sent ' + who(ev.color) + "'s token home";
      case 'captured': return who(ev.color) + "'s token landed on a defended square and went home";
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
      case 'joined':
        roomCode = msg.code;
        $('roomCode').textContent = msg.code;
        show('lobby');
        if (soloPending) {
          soloPending = false;
          for (let i = 0; i < 3; i++) send({ type: 'addBot' });
          send({ type: 'start' });
        }
        break;
      case 'lobby': renderLobby(msg); break;
      case 'started':
        me = msg.you;
        if (roomCode || saved()) saveSession({ code: roomCode || saved().code, secret: msg.secret });
        show('game');
        BoardView.build($('board'));
        break;
      case 'left': log.unshift(msg.name + ' left the game'); renderLog(); break;
      case 'state': applyState(msg); break;
    }
  }

  function renderLobby(msg) {
    $('roomCode').textContent = msg.code;
    $('lobbyPlayers').textContent = '';
    const chip = (text) => {
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = text;
      $('lobbyPlayers').appendChild(s);
    };
    msg.players.forEach((p) => chip(p.name + (p.host ? ' (host)' : '')));
    for (let i = 0; i < msg.bots; i++) chip('Bot ' + (i + 1));

    lobbyInfo = msg;
    const enough = msg.players.length + msg.bots >= 2;
    $('start').classList.toggle('hidden', !msg.youHost);
    $('start').disabled = !enough;
    $('lobbyHint').textContent = !msg.youHost
      ? 'Waiting for the host to start the game'
      : enough ? 'Start whenever you are ready.' : 'Waiting for one more player to join.';
  }

  function renderLog() {
    $('log').textContent = '';
    log.slice(0, 4).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      $('log').appendChild(li);
    });
  }

  /* ---------- Dice ---------- */
  // Pip indices on the 3x3 grid for each number; star and globus faces show an icon instead.
  const PIPS = { 1: [4], 2: [0, 8], 4: [0, 2, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const diceEl = $('dice');
  $('legendGlobe').innerHTML = BoardView.GLOBE_PATHS;

  // Adds the pips and the star/globus icons to an empty die element.
  function buildDie(el) {
    for (let i = 0; i < 9; i++) el.appendChild(Object.assign(document.createElement('div'), { className: 'pip' }));
    el.insertAdjacentHTML('beforeend',
      '<div class="dice-icon" aria-hidden="true">' +
      '<svg class="d-star" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/></svg>' +
      '<svg class="d-globe" viewBox="0 0 24 24">' + BoardView.GLOBE_PATHS + '</svg></div>');
  }

  function setDie(el, face, label) {
    const isIcon = face === 'star' || face === 'globus';
    el.classList.toggle('icon', isIcon);
    el.querySelector('.d-star').style.display = face === 'star' ? 'block' : 'none';
    el.querySelector('.d-globe').style.display = face === 'globus' ? 'block' : 'none';
    el.querySelectorAll('.pip').forEach((pip, i) => {
      pip.classList.toggle('on', typeof face === 'number' && PIPS[face].includes(i));
    });
    el.setAttribute('aria-label', label || (face === null ? 'Dice not rolled yet' : 'Dice showing ' + (FACE[face] || face)));
  }

  buildDie(diceEl);

  /* ---------- Earlier rolls this turn ---------- */
  // A player with only base tokens rolls up to 3 times. Each earlier roll shrinks into a small die
  // beside the big one, so all rolls stay visible.
  let earlier = [];        // faces rolled before the big die, in the same run of base rolls
  let runColor = null;
  let runOpen = false;     // true while the same player is still using their base re-rolls
  let lastFace = null;

  function trackRolls(events) {
    let grew = false;
    events.forEach((ev) => {
      if (ev.type !== 'roll' && ev.type !== 'skip') return;
      if (runOpen && ev.color === runColor) { earlier.push(lastFace); grew = true; } else earlier = [];
      lastFace = ev.face;
      runColor = ev.color;
      runOpen = ev.type === 'skip' && ev.reroll === true;
    });
    return grew;
  }

  function renderTrail(animate) {
    const box = $('trail');
    box.textContent = '';
    earlier.forEach((face, i) => {
      const mini = document.createElement('div');
      mini.className = 'dice mini' + (animate && i === earlier.length - 1 ? ' minimise' : '');
      mini.setAttribute('role', 'img');
      buildDie(mini);
      setDie(mini, face, 'Roll ' + (i + 1) + ': ' + (FACE[face] || face));
      box.appendChild(mini);
    });
    if (earlier.length) {
      const note = document.createElement('span');
      note.className = 'trail-note';
      note.textContent = 'Earlier rolls';
      box.appendChild(note);
    }
  }

  function resetRolls() { earlier = []; runColor = null; runOpen = false; lastFace = null; renderTrail(false); }

  /* ---------- Game state ---------- */
  function applyState(msg) {
    const s = msg.state;
    setError('');
    msg.events.forEach((ev) => { const t = describe(ev, s.names); if (t) log.unshift(t); });
    renderLog();

    const color = s.colors[s.turn];
    const myTurn = !s.winner && color === me;

    // turn card
    $('turnName').textContent = s.winner ? s.names[s.winner] + ' wins!' : s.names[color];
    const shown = s.winner || color;
    $('turnSwatch').style.background = 'var(--' + shown + ')';
    const btn = $('roll');
    btn.style.background = 'var(--' + color + '-btn)';
    btn.style.color = 'var(--' + color + '-ink)';

    if (msg.events.some((ev) => ev.type === 'roll' || ev.type === 'skip')) {
      diceEl.classList.remove('rolling'); void diceEl.offsetWidth; diceEl.classList.add('rolling');
    }
    const grew = trackRolls(msg.events);
    renderTrail(grew);
    setDie(diceEl, s.face);

    if (s.winner) clearSession();
    renderPlayers(s, color);

    // The moves the player can make now (token index -> move). With only one choice it is pre-selected.
    game = { s, myTurn, movable: new Map() };
    if (myTurn && s.phase === 'move') s.moves.forEach((m) => { if (!game.movable.has(m.token)) game.movable.set(m.token, m); });
    selected = game.movable.size === 1 ? [...game.movable.keys()][0] : null;
    redraw();
  }

  /* ---------- Choosing a move: pick a token, see where it goes, then confirm ---------- */
  let game = null;       // { s, myTurn, movable } for the latest state
  let selected = null;   // token index being previewed

  function pickToken(token) {
    selected = selected === token ? null : token;
    redraw();
  }

  function previewText(m) {
    let text = m.kind === 'enter' ? 'Bring this token out onto your start globe'
      : m.to === 56 ? 'This token reaches the centre'
      : m.via !== undefined ? 'Lands on a star and is carried to the next star'
      : m.kind === 'globe' ? 'This token hops to the next globe'
      : m.kind === 'star' ? 'This token jumps to the next star'
      : 'This token moves to the marked square';
    if (m.captures > 0) text += ' and sends ' + (m.captures > 1 ? m.captures + ' tokens' : 'a token') + ' home';
    if (m.sentHome) text += '. Careful: it would be sent home (defended square or a globe)';
    return text + '.';
  }

  // Draws the board with the current preview, and sets the main button and the status line.
  function redraw() {
    if (!game) return;
    const { s, myTurn, movable } = game;
    const color = s.colors[s.turn];
    const move = selected !== null ? movable.get(selected) : null;
    const choosing = myTurn && s.phase === 'move';

    const btn = $('roll');
    btn.textContent = choosing ? 'Confirm move' : 'Roll';
    btn.disabled = choosing ? !move : !(myTurn && s.phase === 'roll');

    if (s.winner) $('status').textContent = '';
    else if (!myTurn) $('status').textContent = s.names[color] + "'s turn";
    else if (s.phase === 'roll') $('status').textContent = 'Your turn - tap Roll';
    else if (!move) $('status').textContent = 'Pick a token to see where it goes';
    else $('status').textContent = previewText(move);

    BoardView.render(s, movable, me, pickToken,
      move ? { color: me, to: move.to, via: move.via } : null, selected, confirmMove);
  }

  // Plays the previewed move. Used by the Confirm button and by clicking the highlighted square.
  function confirmMove() {
    if (!game || game.s.phase !== 'move') return;
    const move = selected !== null ? game.movable.get(selected) : null;
    if (move) send({ type: 'move', token: move.token, kind: move.kind });
  }

  // One button does both jobs: Roll in the roll phase, Confirm move in the move phase.
  $('roll').onclick = () => {
    if (!game) return;
    if (game.s.phase === 'roll') return send({ type: 'roll' });
    confirmMove();
  };

  function renderPlayers(s, current) {
    const box = $('players');
    box.textContent = '';
    s.colors.forEach((c, i) => {
      const tokens = s.tokens[c];
      const inBase = tokens.filter((p) => p === -1).length;
      const home = tokens.filter((p) => p === 56).length;
      const onBoard = 4 - inBase - home;

      const row = document.createElement('div');
      row.className = 'player';
      row.style.background = !s.winner && c === current ? 'var(--' + c + '-tint)' : 'transparent';

      const badge = document.createElement('div');
      badge.className = 'player-badge';
      badge.style.background = 'var(--' + c + ')';
      badge.style.color = 'var(--' + c + '-ink)';
      badge.textContent = String(i + 1);

      const info = document.createElement('div');
      info.className = 'player-info';
      const nm = document.createElement('div');
      nm.className = 'player-name';
      nm.textContent = s.names[c] + (c === me ? ' (you)' : '');
      const sub = document.createElement('div');
      sub.className = 'player-sub';
      const tags = (s.bots.includes(c) ? 'Bot · ' : '') + (s.away.includes(c) ? 'Away, can rejoin · ' : '');
      sub.textContent = tags + inBase + ' in base · ' + onBoard + ' on board';
      info.append(nm, sub);

      const dots = document.createElement('div');
      dots.className = 'home-dots';
      dots.setAttribute('role', 'img');
      dots.setAttribute('aria-label', 'Tokens home: ' + home + ' of 4');
      for (let d = 0; d < 4; d++) {
        const dot = document.createElement('span');
        if (d < home) dot.style.background = 'var(--' + c + ')';
        dots.appendChild(dot);
      }

      row.append(badge, info, dots);
      box.appendChild(row);
    });
  }

  setTheme(true);
  show('menu');
  if (saved()) rejoin();
})();
