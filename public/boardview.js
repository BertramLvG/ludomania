'use strict';

// Builds the board as HTML/CSS (see DESIGN.md) and draws tokens from the game state.
// Geometry comes from the shared /board.js (window.Board): x = column, y = row on the 15x15 grid.
(function () {
  const B = window.Board;
  const COLORS = B.COLORS;
  const STAR_ICON = '<svg class="icon-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/></svg>';
  const GLOBE_PATHS = '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.4 2.2 3.6 4.9 3.6 8s-1.2 5.8-3.6 8c-2.4-2.2-3.6-4.9-3.6-8S9.6 6.2 12 4z"/>';
  const GLOBE_ICON = '<svg class="icon-globe" viewBox="0 0 24 24" aria-hidden="true">' + GLOBE_PATHS + '</svg>';

  let slots = {};      // color -> [4 slot elements]
  let bases = {};      // color -> base element
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
  function render(state, movable, me, onPick, preview, selected) {
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
        place(el, t.sq[0], t.sq[1]);
        el.className = 'token-on-board' + (can ? ' movable' : '') + (picked ? ' selected' : '') + (isTop ? '' : ' covered');
        el.disabled = !can;
        el.tabIndex = can ? 0 : -1;
        el.onclick = can ? () => onPick(t.i) : null;

        let mark = el.querySelector('.safe-mark');
        if (isTop && safe) {
          if (!mark) {
            mark = document.createElement('span');
            mark.className = 'safe-mark';
            mark.setAttribute('aria-hidden', 'true');
            mark.innerHTML = '<svg viewBox="0 0 24 24">' + GLOBE_PATHS + '</svg>';
            el.appendChild(mark);
          }
        } else if (mark) {
          mark.remove();
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
          (isTop && safe ? ', on a globe, protected' : '') +
          (isTop && group.length > 1 ? ', ' + group.length + ' tokens on this square' : ''));
      });
    });
    boardTokens.forEach((el, id) => {
      if (!seen.has(id)) { el.remove(); boardTokens.delete(id); }
    });

    // Preview of the selected move: a ghost token where it will land (and the star it passes on the way).
    tokenLayer.querySelectorAll('.dest, .via').forEach((e) => e.remove());
    if (preview) {
      if (preview.via !== undefined) {
        const vs = targetSquare(preview.color, preview.via);
        if (vs) {
          const via = document.createElement('div');
          via.className = 'via';
          place(via, vs[0], vs[1]);
          tokenLayer.appendChild(via);
        }
      }
      const ds = targetSquare(preview.color, preview.to);
      if (ds) {
        const dest = document.createElement('div');
        dest.className = 'dest';
        dest.innerHTML = '<span class="token ' + preview.color + '"></span>';
        place(dest, ds[0], ds[1]);
        tokenLayer.appendChild(dest);
      }
    }
  }

  window.BoardView = { build, render, GLOBE_PATHS };
})();
