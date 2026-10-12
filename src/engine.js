'use strict';

const { COLORS, TRACK_LENGTH, START_INDEX, GLOBES, STARS } = require('./board');

// Token positions, relative to the token's own colour:
//   -1        in the yard
//   0..50     on the track (0 = own start globe, 50 = last track square before the finish column)
//   51..55    in the finish column
//   56        home (the centre)
const YARD = -1;
const LAST_TRACK = 50;
const HOME = 56;
const TOKENS_PER_PLAYER = 4;

const DIE = [1, 2, 'star', 4, 'globus', 6];

const isOnTrack = (p) => p >= 0 && p <= LAST_TRACK;
const ringIndex = (color, p) => (START_INDEX[color] + p) % TRACK_LENGTH;

function createGame(colors, rng = Math.random) {
  if (colors.length < 2 || colors.length > 4 || colors.some((c) => !COLORS.includes(c))) {
    throw new Error('A game needs 2-4 distinct colours from ' + COLORS.join(', '));
  }
  if (new Set(colors).size !== colors.length) throw new Error('Colours must be distinct');
  const tokens = {};
  for (const c of colors) tokens[c] = new Array(TOKENS_PER_PLAYER).fill(YARD);
  return { colors: [...colors], tokens, turn: 0, phase: 'roll', face: null, moves: [], winner: null, attempts: 0, rng };
}

// A player whose only unfinished tokens are all in the yard gets up to 3 rolls per turn to throw a globus.
const MAX_YARD_ATTEMPTS = 3;
const onlyYardTokens = (tokens) => tokens.some((p) => p === YARD) && tokens.every((p) => p === YARD || p === HOME);

const currentColor = (state) => state.colors[state.turn];

function rollDie(rng = Math.random) {
  return DIE[Math.floor(rng() * DIE.length)];
}

// Opponent tokens standing on a ring square: [{ color, token }].
function occupantsAt(state, ring, exceptColor) {
  const found = [];
  for (const color of state.colors) {
    if (color === exceptColor) continue;
    state.tokens[color].forEach((p, token) => {
      if (isOnTrack(p) && ringIndex(color, p) === ring) found.push({ color, token });
    });
  }
  return found;
}

// Next position strictly ahead of p (still on the track) whose square is in `set`, or null.
function nextInSet(color, p, set) {
  for (let q = p + 1; q <= LAST_TRACK; q++) if (set.has(ringIndex(color, q))) return q;
  return null;
}

function numberMove(p, n) {
  let to = p + n;
  if (to > HOME) to = HOME - (to - HOME); // exact roll needed: the rest bounces back
  return to;
}

function legalMoves(state, face) {
  const color = currentColor(state);
  const tokens = state.tokens[color];
  const moves = [];

  if (typeof face === 'number') {
    tokens.forEach((p, token) => {
      if (p === YARD || p === HOME) return;
      let to = numberMove(p, face);
      let via;
      // Landing on a star with a normal roll carries the token on to the next star
      // (not for star or globus moves, and not when there is no star left ahead).
      if (isOnTrack(to) && STARS.has(ringIndex(color, to))) {
        const next = nextInSet(color, to, STARS);
        if (next !== null) { via = to; to = next; }
      }
      moves.push({ token, from: p, to, via, kind: 'step' });
    });
  } else if (face === 'star') {
    tokens.forEach((p, token) => {
      if (!isOnTrack(p)) return;
      const to = nextInSet(color, p, STARS);
      if (to !== null) moves.push({ token, from: p, to, kind: 'star' });
    });
  } else if (face === 'globus') {
    // Any token in the yard can be the one to come out; any token on the track can hop to the next globe.
    tokens.forEach((p, token) => {
      if (p === YARD) { moves.push({ token, from: YARD, to: 0, kind: 'enter' }); return; }
      if (!isOnTrack(p)) return;
      const to = nextInSet(color, p, GLOBES);
      if (to !== null) moves.push({ token, from: p, to, kind: 'globe' });
    });
  }

  // Tell the player what each move would do, so the client can preview it before they confirm.
  for (const m of moves) {
    const probe = cloneState(state);
    const events = resolveMove(probe, m);
    m.captures = events.filter((e) => e.type === 'capture').length;
    m.sentHome = events.some((e) => e.type === 'captured');
  }
  return moves;
}

// Applies a move to the state in place and returns the events that happened.
function resolveMove(state, move) {
  const color = currentColor(state);
  const tokens = state.tokens[color];
  const events = [{ type: 'move', color, token: move.token, from: move.from, to: move.to, via: move.via }];
  tokens[move.token] = move.to;
  if (!isOnTrack(move.to)) return events;

  const ring = ringIndex(color, move.to);
  const others = occupantsAt(state, ring, color);
  if (others.length === 0) return events;

  const enteringOnOwnStart = move.kind === 'enter';
  if (enteringOnOwnStart) {
    for (const o of others) {
      state.tokens[o.color][o.token] = YARD;
      events.push({ type: 'capture', color: o.color, token: o.token, by: color });
    }
    return events;
  }

  const perColor = {};
  for (const o of others) perColor[o.color] = (perColor[o.color] || 0) + 1;
  const defended = GLOBES.has(ring) || Object.values(perColor).some((n) => n >= 2);
  if (defended) {
    tokens[move.token] = YARD;
    events.push({ type: 'captured', color, token: move.token });
  } else {
    for (const o of others) {
      state.tokens[o.color][o.token] = YARD;
      events.push({ type: 'capture', color: o.color, token: o.token, by: color });
    }
  }
  return events;
}

function nextTurn(state) {
  state.turn = (state.turn + 1) % state.colors.length;
  state.attempts = 0;
}

// Phase "roll" -> rolls the die (face may be injected for tests). Passes the turn if nothing can move.
function roll(state, face = rollDie(state.rng)) {
  if (state.winner) throw new Error('Game is over');
  if (state.phase !== 'roll') throw new Error('Not time to roll');
  const next = cloneState(state);
  next.face = face;
  next.moves = legalMoves(next, face);
  if (next.moves.length === 0) {
    const color = currentColor(state);
    let reroll = false;
    if (face === 'globus') {
      // A globus always gives another roll, even when nothing could be moved.
    } else if (onlyYardTokens(next.tokens[color]) && next.attempts + 1 < MAX_YARD_ATTEMPTS) {
      next.attempts++;
      reroll = true;
    } else {
      nextTurn(next);
    }
    next.phase = 'roll';
    next.face = face;
    return { state: next, events: [{ type: 'skip', color, face, reroll }] };
  }
  next.phase = 'move';
  return { state: next, events: [{ type: 'roll', color: currentColor(state), face }] };
}

// Phase "move" -> plays one of the legal moves returned by roll().
function move(state, choice) {
  if (state.phase !== 'move') throw new Error('Not time to move');
  const chosen = state.moves.find((m) => m.token === choice.token && m.kind === choice.kind);
  if (!chosen) throw new Error('Illegal move');
  const next = cloneState(state);
  const events = resolveMove(next, chosen);
  const color = currentColor(next);
  if (next.tokens[color].every((p) => p === HOME)) {
    next.winner = color;
    events.push({ type: 'win', color });
  } else if (next.face !== 'globus') {
    nextTurn(next);
  } else {
    next.attempts = 0; // leaving the yard ends the re-roll allowance
  }
  next.phase = 'roll';
  next.moves = [];
  return { state: next, events };
}

function cloneState(state) {
  const tokens = {};
  for (const c of state.colors) tokens[c] = [...state.tokens[c]];
  return { ...state, colors: [...state.colors], tokens, moves: state.moves.map((m) => ({ ...m })) };
}

module.exports = {
  YARD, HOME, LAST_TRACK, DIE,
  createGame, currentColor, rollDie, legalMoves, roll, move, ringIndex,
};
