'use strict';

// Builds the board as HTML/CSS (see DESIGN.md) and draws tokens from the game state.
// Geometry comes from the shared /board.js (window.Board): x = column, y = row on the 15x15 grid.
(function () {
  const B = window.Board;
  const COLORS = B.COLORS;
  const STAR_ICON = '<svg class="icon-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/></svg>';
  const GLOBE_PATHS = '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.4 2.2 3.6 4.9 3.6 8s-1.2 5.8-3.6 8c-2.4-2.2-3.6-4.9-3.6-8S9.6 6.2 12 4z"/>';
  const GLOBE_ICON = '<svg class="icon-globe" viewBox="0 0 24 24" aria-hidden="true">' + GLOBE_PATHS + '</svg>';

  // Power-ups: what they are called, what they do (shown in the pickup message) and their icon.
  const POWER_UPS = {
    reroll: {
      name: 'Reroll', text: 'You roll again after this move.',
      icon: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>',
    },
    shield: {
      name: 'Shield', text: 'This token is protected like on a globe until your next turn.',
      icon: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/>',
    },
    boost: {
      name: 'Speed boost', text: 'Your next roll counts double.',
      icon: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    },
  };
  const iconSvg = (type) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + POWER_UPS[type].icon + '</svg>';

  let slots = {};      // color -> [4 slot elements]
  let bases = {};      // color -> base element
  let itemLayer = null;   // power-ups, below the tokens
  let tokenLayer = null;
  const boardTokens = new Map(); // "color-index" -> element, kept so tokens can glide between squares

  function build(boardEl) {
    boardEl.innerHTML = '<div class="grid"></div>';
    const grid = boardEl.firstChild;

    // what each square is: coloured start globe, finish lane, plain globe, star
    const kind = {};
    COLORS.forEach((color) => {
      const [sx, sy] = B.START_XY[color];
      kind[sx + ',' + sy] = { type: 'start', color };
      B.FINISH_XY[color].forEach(([x, y]) => { kind[x + ',' + y] = { type: 'lane', color }; });
    });
    B.RING_XY.forEach(([x, y], i) => {
      const key = x + ',' + y;
      if (kind[key]) return;
      if (B.GLOBES.has(i)) kind[key] = { type: 'globe' };
      else if (B.STARS.has(i)) kind[key] = { type: 'star' };
    });

    // track: the cross (rows or columns 6-8) without the 3x3 centre
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        const inCross = (y >= 6 && y <= 8) || (x >= 6 && x <= 8);
        const inCenter = y >= 6 && y <= 8 && x >= 6 && x <= 8;
        if (!inCross || inCenter) continue;
        const k = kind[x + ',' + y];
        const cell = document.createElement('div');
        cell.className = 'cell' + (k && k.color ? ' lane ' + k.color : '');
        cell.style.gridRow = y + 1;
        cell.style.gridColumn = x + 1;
        if (k && (k.type === 'start' || k.type === 'globe')) cell.innerHTML = GLOBE_ICON;
        else if (k && k.type === 'star') cell.innerHTML = STAR_ICON;
        grid.appendChild(cell);
      }
    }

    // bases with four slots each
    slots = {}; bases = {};
    COLORS.forEach((color) => {
      const base = document.createElement('div');
      base.className = 'base ' + color;
      const inner = document.createElement('div');
      inner.className = 'base-inner';
      slots[color] = [];
      for (let i = 0; i < 4; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        inner.appendChild(slot);
        slots[color].push(slot);
      }
      base.appendChild(inner);
      boardEl.appendChild(base);
      bases[color] = base;
    });

    // centre: four triangles pointing in, each in its player's colour
    const center = document.createElement('div');
    center.className = 'center';
    center.innerHTML =
      '<svg viewBox="0 0 30 30" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon points="0,0 15,15 0,30" fill="var(--red)"/>' +
      '<polygon points="0,0 30,0 15,15" fill="var(--green)"/>' +
      '<polygon points="30,0 30,30 15,15" fill="var(--yellow)"/>' +
      '<polygon points="0,30 30,30 15,15" fill="var(--blue)"/>' +
      '<rect x="11" y="11" width="8" height="8" rx="2.5" fill="var(--center)" transform="rotate(45 15 15)"/>' +
      '</svg>';
    boardEl.appendChild(center);

    itemLayer = document.createElement('div');
    itemLayer.className = 'items';
    boardEl.appendChild(itemLayer);

    tokenLayer = document.createElement('div');
    tokenLayer.className = 'tokens';
    boardEl.appendChild(tokenLayer);
    boardTokens.clear();
  }

  // Column and row of a token on the track or in its finish column; null for yard and home.
  function squareOf(color, p) {
    if (p < 0 || p > 55) return null;
    if (p <= 50) return B.RING_XY[(B.START_INDEX[color] + p) % B.TRACK_LENGTH];
    return B.FINISH_XY[color][p - 51];
  }

  const label = (color, i, can) => color + ' token ' + (i + 1) + (can ? ', can move' : '');

  const place = (el, x, y) => {
    el.style.left = 'calc((100% + var(--board-gap)) * ' + x + ' / 15)';
    el.style.top = 'calc((100% + var(--board-gap)) * ' + y + ' / 15)';
  };

  // The square a token ends on; the centre cell when it reaches home.
  const targetSquare = (color, p) => (p === 56 ? [7, 7] : squareOf(color, p));

  // movable: Map of token index -> move kind for my colour. onPick(token) is called when one is chosen.
  // selected: the token index being previewed. preview: { color, to, via } of that token's move, or null.
  // How long a token takes to hop from one square to the next. Used to chain the two hops of a star carry.
  const HOP_MS = 330;
  let renderId = 0;

  // onConfirm() is called when a highlighted square of the previewed move is clicked.
  // options.events: the events of the latest server message; a move that passed a star is animated through that star.
  function render(state, movable, me, onPick, preview, selected, onConfirm, options = {}) {
    const thisRender = ++renderId;
    const events = options.events;
    // bases: a token waits in its slot; an empty slot means that token is out on the board
    COLORS.forEach((color) => {
      const playing = state.colors.includes(color);
      bases[color].classList.toggle('idle', !playing);
      slots[color].forEach((slot, i) => {
        slot.textContent = '';
        if (!playing || state.tokens[color][i] !== -1) return;
        const can = color === me && movable.has(i);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.disabled = !can;
        btn.tabIndex = can ? 0 : -1;
        if (can) btn.className = 'movable' + (selected === i ? ' selected' : '');
        btn.setAttribute('aria-label', label(color, i, can) + (can && selected === i ? ', selected' : ''));
        btn.innerHTML = '<span class="token ' + color + '"></span>';
        if (can) btn.onclick = () => onPick(i);
        slot.appendChild(btn);
      });
    });

    // tokens on the board
    const onBoard = {};
    const seen = new Set();
    state.colors.forEach((color) => {
      state.tokens[color].forEach((p, i) => {
        const sq = squareOf(color, p);
        if (!sq) return;
        const key = sq[0] + ',' + sq[1];
        (onBoard[key] = onBoard[key] || []).push({ color, i, sq, p });
      });
    });
    Object.values(onBoard).forEach((group) => {
      // Tokens sharing a square are drawn on top of each other: one token shows the count, the rest are hidden.
      const canMove = (t) => t.color === me && movable.has(t.i);
      const top = group.find(canMove) || group[group.length - 1];
      group.forEach((t) => {
        const id = t.color + '-' + t.i;
        seen.add(id);
        let el = boardTokens.get(id);
        if (!el) {
          el = document.createElement('button');
          el.type = 'button';
          el.innerHTML = '<span class="token ' + t.color + '"></span>';
          tokenLayer.appendChild(el);
          boardTokens.set(id, el);
        }
        const isTop = t === top;
        const can = canMove(t) && isTop;
        const picked = can && selected === t.i;
        // a token on a globe cannot be captured (only the track has globes, not the finish lane)
        const safe = t.p <= 50 && B.GLOBES.has((B.START_INDEX[t.color] + t.p) % B.TRACK_LENGTH);
        // A token carried from one star to the next hops to the first star, then on to the second.
        const hop = (events || []).find((ev) => ev.type === 'move' && ev.color === t.color && ev.token === t.i &&
          ev.via !== undefined && ev.to === t.p);
        const viaSq = hop && squareOf(t.color, hop.via);
        if (viaSq) {
          place(el, viaSq[0], viaSq[1]);
          setTimeout(() => { if (thisRender === renderId) place(el, t.sq[0], t.sq[1]); }, HOP_MS);
        } else {
          place(el, t.sq[0], t.sq[1]);
        }
        el.className = 'token-on-board' + (can ? ' movable' : '') + (picked ? ' selected' : '') + (isTop ? '' : ' covered');
        el.disabled = !can;
        el.tabIndex = can ? 0 : -1;
        el.onclick = can ? () => onPick(t.i) : null;

        // a power-up shield protects like a globe, so it gets its own badge; otherwise the globe badge
        const shielded = Boolean(state.shield && state.shield[t.color] && state.shield[t.color][t.i]);
        const markKind = shielded ? 'shield' : safe ? 'globe' : null;
        let mark = el.querySelector('.safe-mark');
        if (mark && (!isTop || mark.dataset.kind !== markKind)) { mark.remove(); mark = null; }
        if (isTop && markKind && !mark) {
          mark = document.createElement('span');
          mark.className = 'safe-mark' + (shielded ? ' shield' : '');
          mark.dataset.kind = markKind;
          mark.setAttribute('aria-hidden', 'true');
          mark.innerHTML = '<svg viewBox="0 0 24 24">' + (shielded ? POWER_UPS.shield.icon : GLOBE_PATHS) + '</svg>';
          el.appendChild(mark);
        }

        let badge = el.querySelector('.stack-count');
        if (isTop && group.length > 1) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'stack-count';
            badge.setAttribute('aria-hidden', 'true');
            el.appendChild(badge);
          }
          badge.textContent = String(group.length);
        } else if (badge) {
          badge.remove();
        }
        el.setAttribute('aria-label', label(t.color, t.i, can) + (picked ? ', selected' : '') +
          (isTop && shielded ? ', shielded' : isTop && safe ? ', on a globe, protected' : '') +
          (isTop && group.length > 1 ? ', ' + group.length + ' tokens on this square' : ''));
      });
    });
    boardTokens.forEach((el, id) => {
      if (!seen.has(id)) { el.remove(); boardTokens.delete(id); }
    });

    // Power-ups lie on the board for everyone to see.
    itemLayer.textContent = '';
    const ringSquare = (ring) => B.RING_XY[ring];
    (state.powerUps || []).forEach((item) => {
      const [x, y] = ringSquare(item.ring);
      const el = document.createElement('div');
      el.className = 'powerup ' + item.type;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', POWER_UPS[item.type].name + ': ' + POWER_UPS[item.type].text);
      el.title = POWER_UPS[item.type].name + ': ' + POWER_UPS[item.type].text;
      el.innerHTML = iconSvg(item.type);
      place(el, x, y);
      itemLayer.appendChild(el);
    });

    // Preview of the selected move: a ghost token where it will land (and the star it passes on the way).
    tokenLayer.querySelectorAll('.dest, .via').forEach((e) => e.remove());
    if (preview) {
      if (preview.via !== undefined) {
        const vs = targetSquare(preview.color, preview.via);
        if (vs) {
          // the star you land on first can be clicked too: the token still ends up on the next star
          const via = document.createElement('button');
          via.type = 'button';
          via.className = 'via';
          via.setAttribute('aria-label', 'Move here, passing this star');
          if (onConfirm) via.onclick = onConfirm;
          place(via, vs[0], vs[1]);
          tokenLayer.appendChild(via);
        }
      }
      const ds = targetSquare(preview.color, preview.to);
      if (ds) {
        const dest = document.createElement('button');
        dest.type = 'button';
        dest.className = 'dest';
        dest.setAttribute('aria-label', 'Move here');
        dest.innerHTML = '<span class="token ' + preview.color + '"></span>';
        if (onConfirm) dest.onclick = onConfirm;
        place(dest, ds[0], ds[1]);
        tokenLayer.appendChild(dest);
      }
    }
  }

  window.BoardView = { build, render, GLOBE_PATHS, POWER_UPS };
})();
