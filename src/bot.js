'use strict';

const { GLOBES, TRACK_LENGTH } = require('./board');
const { move, currentColor, ringIndex, trapSquares, HOME, LAST_TRACK } = require('./engine');

// Distances an opponent can cover with one number roll.
const REACH = [1, 2, 4, 6];

// What picking up each power-up is worth to the bot.
const PICKUP_VALUE = { boost: 30, trap: 22, reroll: 20, shield: 18 };

const onTrack = (p) => p >= 0 && p <= LAST_TRACK;

// How many opponent tokens could land on this token with their next number roll.
function threats(state, color, token) {
  const p = state.tokens[color][token];
  if (!onTrack(p)) return 0;
  const ring = ringIndex(color, p);
  if (GLOBES.has(ring)) return 0; // globes protect
  if (state.shield && state.shield[color][token]) return 0; // so does a shield
  const buddies = state.tokens[color].filter((q) => onTrack(q) && ringIndex(color, q) === ring).length;
  if (buddies >= 2) return 0; // two together defend the square
  let n = 0;
  for (const other of state.colors) {
    if (other === color) continue;
    for (const q of state.tokens[other]) {
      if (!onTrack(q)) continue;
      const gap = (ring - ringIndex(other, q) + TRACK_LENGTH) % TRACK_LENGTH;
      if (REACH.includes(gap)) n++;
    }
  }
  return n;
}

function score(state, choice, rng) {
  const color = currentColor(state);
  // the real rules decide what the move does (rng is given so a simulated spawn cannot fail)
  const result = move({ ...state, rng }, choice);
  const after = result.state;
  let s = 0;

  for (const ev of result.events) {
    if (ev.type === 'capture' && ev.by === color) s += 100 + 2 * lostProgress(state, ev);
    if (ev.type === 'captured' || ev.type === 'trapped') s -= 150; // landed on a defended square, a globe, a shield or a trap
    if (ev.type === 'win') s += 1000;
    if (ev.type === 'pickup' && ev.color === color) s += PICKUP_VALUE[ev.kind] || 0;
  }

  const { from, to, token } = choice;
  if (choice.kind === 'enter') s += choice.second !== undefined ? 110 : 60;
  if (to === HOME) s += 80;
  else if (to > LAST_TRACK) s += 40;
  s += (to - from) * 1.5 + to * 0.3; // progress, favouring tokens that are further along
  if (onTrack(to) && GLOBES.has(ringIndex(color, to))) s += 15;

  // run away from danger, avoid walking into it
  s += 25 * (threats(state, color, token) - threats(after, color, token));
  // leaving the finish run or yard never exposes other tokens, but moving one of a defending pair does
  state.tokens[color].forEach((p, i) => {
    if (i !== token && onTrack(p) && threats(after, color, i) > threats(state, color, i)) s -= 20;
  });

  return s + rng() * 0.5; // tiny jitter so identical moves are not always chosen in the same order
}

// How far the captured token had travelled: capturing an advanced token hurts more.
function lostProgress(state, ev) {
  const p = state.tokens[ev.color][ev.token];
  return onTrack(p) ? p / 10 : 0;
}

function chooseMove(state, rng = state.rng || Math.random) {
  let best = null;
  let bestScore = -Infinity;
  for (const choice of state.moves) {
    const s = score(state, choice, rng);
    if (s > bestScore) { best = choice; bestScore = s; }
  }
  return best;
}

// Where to put a trap: on the square an opponent token is most likely to land on, i.e. just ahead of the most
// opponent tokens (within one or two rolls). Ties and quiet boards are settled at random.
function chooseTrapSquare(state, rng = state.rng || Math.random) {
  const color = currentColor(state);
  const squares = trapSquares(state);
  const opponents = [];
  for (const other of state.colors) {
    if (other === color) continue;
    state.tokens[other].forEach((p) => { if (onTrack(p)) opponents.push(ringIndex(other, p)); });
  }
  let best = squares[0];
  let bestScore = -Infinity;
  for (const ring of squares) {
    let s = rng();
    for (const o of opponents) {
      const gap = (ring - o + TRACK_LENGTH) % TRACK_LENGTH;
      if (REACH.includes(gap)) s += 3;
      else if (gap > 0 && gap <= 12) s += 1;
    }
    if (s > bestScore) { best = ring; bestScore = s; }
  }
  return best;
}

module.exports = { chooseMove, chooseTrapSquare, threats };
