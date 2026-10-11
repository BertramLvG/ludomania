'use strict';

// Draws the board and the tokens. Uses the shared geometry from /board.js (window.Board).
(function () {
  const B = window.Board;
  const C = 40, OX = 40, OY = 30;
  const NS = 'http://www.w3.org/2000/svg';

  const THEME = {
    red:    { fill: '#f7c1c1', stroke: '#a32d2d', token: '#e24b4a', yard: [0, 0] },
    green:  { fill: '#c0dd97', stroke: '#3b6d11', token: '#639922', yard: [9, 0] },
    yellow: { fill: '#fac775', stroke: '#854f0b', token: '#ef9f27', yard: [9, 9] },
    blue:   { fill: '#b5d4f4', stroke: '#185fa5', token: '#378add', yard: [0, 9] },
  };

  const px = (x) => OX + x * C;
  const py = (y) => OY + y * C;
  const center = ([x, y]) => [px(x) + C / 2, py(y) + C / 2];

  function star(cx, cy) {
    const pts = [];
    for (let j = 0; j < 10; j++) {
      const r = j % 2 ? 3.6 : 8.5, a = -Math.PI / 2 + (j * Math.PI) / 5;
      pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="#fff" stroke="#222" stroke-width="1.2"/>';
  }
  const globe = (cx, cy, filled) =>
    '<circle cx="' + cx + '" cy="' + cy + '" r="7.5" fill="' + (filled ? '#222' : '#fff') + '" stroke="#222" stroke-width="1.2"/>';

  const JOINED = new Set(['5,6', '6,5', '8,5', '9,6', '9,8', '8,9', '5,8', '6,9']);

  function drawBoard(svg) {
    const L = 'ABCDEFGHIJKLMNO';
    let out = '';
    const ringKind = {};
    for (const color of B.COLORS) {
      const s = B.START_INDEX[color];
      ringKind[s] = { t: 'start', color };
      const g = (s + 47) % 52;
      if (!ringKind[g]) ringKind[g] = { t: 'globe' };
    }
    B.STARS.forEach((i) => { ringKind[i] = { t: 'star' }; });

    for (const color of B.COLORS) {
      const t = THEME[color], [yx, yy] = t.yard;
      out += '<rect x="' + px(yx) + '" y="' + py(yy) + '" width="' + 6 * C + '" height="' + 6 * C +
        '" rx="8" fill="' + t.fill + '" fill-opacity="0.5" stroke="' + t.stroke + '" stroke-width="0.8"/>';
    }

    const E = 14;
    [[5, 6, 6, 5, 6, 6], [9, 6, 8, 5, 8, 6], [9, 8, 8, 9, 8, 8], [5, 8, 6, 9, 6, 8]].forEach((q) => {
      const [hx, , , vy, qx, qy] = q;
      const dh = qx > hx ? 1 : -1, dv = qy > vy ? 1 : -1;
      const xe = (dh > 0 ? qx : qx + 1) * C + OX, ye = (dv > 0 ? qy : qy + 1) * C + OY;
      const hfar = (dh > 0 ? hx : hx + 1) * C + OX, vfar = ye - dv * C;
      const xo = xe + dh * C, yo = ye + dv * C;
      const pts = [[hfar, ye], [xe, ye], [xe, vfar], [xo, vfar], [xo, ye + dv * E], [xe + dh * E, ye + dv * E], [xe + dh * E, yo], [hfar, yo]];
      out += '<polygon points="' + pts.map((a) => a.join(',')).join(' ') + '" fill="#f5f4ee" stroke="#888" stroke-width="0.8"/>' +
        '<line x1="' + xe + '" y1="' + ye + '" x2="' + (xe + dh * E) + '" y2="' + (ye + dv * E) + '" stroke="#888" stroke-width="0.8"/>';
    });

    const cell = (x, y, fill, stroke, sym) =>
      (JOINED.has(x + ',' + y) ? '' :
        '<rect x="' + px(x) + '" y="' + py(y) + '" width="' + C + '" height="' + C + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="0.8"/>') +
      (sym || '') +
      '<text x="' + (px(x) + C / 2) + '" y="' + (py(y) + 31) + '" text-anchor="middle" dominant-baseline="central" class="coord">' + L[x] + (y + 1) + '</text>';

    B.RING_XY.forEach(([x, y], i) => {
      const k = ringKind[i];
      let fill = '#f5f4ee', stroke = '#888', sym = '';
      const cx = px(x) + C / 2, cy = py(y) + 13;
      if (k) {
        if (k.t === 'start') { fill = THEME[k.color].fill; stroke = THEME[k.color].stroke; sym = globe(cx, cy, true); }
        else if (k.t === 'globe') sym = globe(cx, cy, false);
        else sym = star(cx, cy);
      }
      out += cell(x, y, fill, stroke, sym);
    });
    for (const color of B.COLORS) {
      B.FINISH_XY[color].forEach(([x, y]) => { out += cell(x, y, THEME[color].fill, THEME[color].stroke, ''); });
    }
    out += '<circle cx="' + (OX + 7.5 * C) + '" cy="' + (OY + 7.5 * C) + '" r="' + 1.5 * C + '" fill="#d3d1c7" stroke="#5f5e5a" stroke-width="0.8"/>';
    for (let i = 0; i < 15; i++) {
      out += '<text class="coord" x="' + (OX + i * C + C / 2) + '" y="' + (OY - 12) + '" text-anchor="middle" dominant-baseline="central">' + L[i] + '</text>';
      out += '<text class="coord" x="' + (OX - 8) + '" y="' + (OY + i * C + C / 2) + '" text-anchor="end" dominant-baseline="central">' + (i + 1) + '</text>';
    }
    out += '<g id="tokens"></g>';
    svg.innerHTML = out;
  }

  const HOME_ANGLE = { red: Math.PI, green: -Math.PI / 2, yellow: 0, blue: Math.PI / 2 };

  // Pixel position of a token, before any offset for stacking.
  function tokenXY(color, p, token) {
    if (p === -1) {
      const [yx, yy] = THEME[color].yard;
      const slot = [[2, 2], [4, 2], [2, 4], [4, 4]][token];
      return [px(yx + slot[0]), py(yy + slot[1])];
    }
    if (p <= 50) return center(B.RING_XY[(B.START_INDEX[color] + p) % 52]);
    if (p <= 55) return center(B.FINISH_XY[color][p - 51]);
    const a = HOME_ANGLE[color] + (token - 1.5) * 0.45;
    return [OX + 7.5 * C + Math.cos(a) * 34, OY + 7.5 * C + Math.sin(a) * 34];
  }

  // Draws every token. `movable` is a Set of token indexes of `myColor` that can be clicked.
  function drawTokens(svg, state, movable, myColor, onPick) {
    const g = svg.querySelector('#tokens');
    g.innerHTML = '';
    const seen = {};
    for (const color of state.colors) {
      state.tokens[color].forEach((p, token) => {
        let [x, y] = tokenXY(color, p, token);
        if (p >= 0 && p <= 55) {
          const key = x + ',' + y;
          const n = seen[key] || 0;
          seen[key] = n + 1;
          x += n * 7 - 3.5 * (n ? 1 : 0);
          y += n * 5;
        }
        const can = color === myColor && movable.has(token);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 11);
        c.setAttribute('fill', THEME[color].token);
        c.setAttribute('stroke', can ? '#111' : '#fff');
        c.setAttribute('stroke-width', can ? 3 : 2);
        if (can) {
          c.setAttribute('class', 'movable');
          c.addEventListener('click', () => onPick(token));
        }
        g.appendChild(c);
      });
    }
  }

  window.BoardView = { drawBoard, drawTokens, THEME };
})();
