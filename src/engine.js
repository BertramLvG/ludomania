'use strict';

const { COLORS, TRACK_LENGTH, START_INDEX, GLOBES, STARS } = require('./board');
const gameSettings = require('./settings');

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

// Power-ups (only when the host turned them on). See RULES.md.
//   reroll  an extra roll once the move is done
//   shield  protects that token like a globe until the owner's next turn
//   boost   the owner's next roll counts double
const SPAWN_WEIGHTS = { reroll: 4, shield: 4, boost: 1 }; // boost is the rarest
const SPAWN_CHANCE_PER_RATE = 0.05; // spawn rate 1-10 -> 5%-50% chance each time the turn passes
const PLAIN_SQUARES = [];
for (let i = 0; i < TRACK_LENGTH; i++) if (!GLOBES.has(i) && !STARS.has(i)) PLAIN_SQUARES.push(i);

const isOnTrack = (p) => p >= 0 && p <= LAST_TRACK;
const ringIndex = (color, p) => (START_INDEX[color] + p) % TRACK_LENGTH;

function createGame(colors, rng = Math.random, settings = {}) {
  if (colors.length < 2 || colors.length > 4 || colors.some((c) => !COLORS.includes(c))) {
    throw new Error('A game needs 2-4 distinct colours from ' + COLORS.join(', '));
  }
  if (new Set(colors).size !== colors.length) throw new Error('Colours must be distinct');
  const tokens = {};
  const shield = {};
  const boost = {};
  for (const c of colors) {
    tokens[c] = new Array(TOKENS_PER_PLAYER).fill(YARD);
    shield[c] = new Array(TOKENS_PER_PLAYER).fill(false);
    boost[c] = 0;
  }
  return {
    colors: [...colors], tokens, turn: 0, phase: 'roll', face: null, moves: [], winner: null, attempts: 0, rng,
    settings: gameSettings.normalize(settings),
    powerUps: [],        // on the board: { id, type, ring }
    shield, boost,       // shield[color][token] is true while shielded; boost[color] counts boosts waiting
    boosted: false,      // the roll in progress counts double
    extraRoll: false,    // a reroll was picked up this move
    nextPowerUpId: 1,
  };
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

// A move to the next star or globe; with a speed boost, to the one after it (passing the first).
function hopMove(color, p, set, boosted) {
  const first = nextInSet(color, p, set);
  if (first === null) return null;
  if (boosted) {
    const second = nextInSet(color, first, set);
    if (second !== null) return { to: second, via: first };
  }
  return { to: first };
}

function legalMoves(state, face) {
  const color = currentColor(state);
  const tokens = state.tokens[color];
  const boosted = Boolean(state.boosted);
  const moves = [];
  const push = (m) => moves.push(boosted ? { ...m, boosted: true } : m);

  if (typeof face === 'number') {
    const steps = boosted ? face * 2 : face;
    tokens.forEach((p, token) => {
      if (p === YARD || p === HOME) return;
      let to = numberMove(p, steps);
      let via;
      // Landing on a star with a normal roll carries the token on to the next star
      // (not for star or globus moves, and not when there is no star left ahead).
      if (isOnTrack(to) && STARS.has(ringIndex(color, to))) {
        const next = nextInSet(color, to, STARS);
        if (next !== null) { via = to; to = next; }
      }
      push({ token, from: p, to, via, kind: 'step' });
    });
  } else if (face === 'star') {
    tokens.forEach((p, token) => {
      if (!isOnTrack(p)) return;
      const hop = hopMove(color, p, STARS, boosted);
      if (hop) push({ token, from: p, ...hop, kind: 'star' });
    });
  } else if (face === 'globus') {
    // Any token in the yard can be the one to come out (with a boost, two come out together);
    // any token on the track can hop to the next globe (with a boost, to the one after it).
    tokens.forEach((p, token) => {
      if (p === YARD) {
        const move = { token, from: YARD, to: 0, kind: 'enter' };
        if (boosted) {
          const other = tokens.findIndex((q, i) => q === YARD && i !== token);
          if (other !== -1) move.second = other;
        }
        push(move);
        return;
      }
      if (!isOnTrack(p)) return;
      const hop = hopMove(color, p, GLOBES, boosted);
      if (hop) push({ token, from: p, ...hop, kind: 'globe' });
    });
  }

  // Tell the player what each move would do, so the client can preview it before they confirm.
  for (const m of moves) {
    const probe = cloneState(state);
    const events = resolveMove(probe, m);
    m.captures = events.filter((e) => e.type === 'capture').length;
    m.sentHome = events.some((e) => e.type === 'captured');
    const pickup = events.find((e) => e.type === 'pickup');
    if (pickup) m.pickup = pickup.kind;
  }
  return moves;
}

function sendHome(state, color, token) {
  state.tokens[color][token] = YARD;
  state.shield[color][token] = false;
}

// Applies a move to the state in place and returns the events that happened.
function resolveMove(state, move) {
  const color = currentColor(state);
  const tokens = state.tokens[color];
  const events = [{ type: 'move', color, token: move.token, from: move.from, to: move.to, via: move.via }];
  tokens[move.token] = move.to;
  if (move.second !== undefined) {
    tokens[move.second] = move.to;
    events.push({ type: 'move', color, token: move.second, from: YARD, to: move.to });
  }
  if (!isOnTrack(move.to)) return events;

  const ring = ringIndex(color, move.to);

  const others = occupantsAt(state, ring, color);
  if (others.length > 0) {
    const captureAll = () => {
      for (const o of others) {
        sendHome(state, o.color, o.token);
        events.push({ type: 'capture', color: o.color, token: o.token, by: color });
      }
    };
    if (move.kind === 'enter') {
      captureAll(); // leaving the yard onto your own start globe captures anyone there
    } else {
      const perColor = {};
      for (const o of others) perColor[o.color] = (perColor[o.color] || 0) + 1;
      const shielded = others.some((o) => state.shield[o.color][o.token]); // a shield works like a globe
      const defended = GLOBES.has(ring) || shielded || Object.values(perColor).some((n) => n >= 2);
      if (defended) {
        sendHome(state, color, move.token);
        events.push({ type: 'captured', color, token: move.token });
        return events;
      }
      captureAll();
    }
  }

  // Landing on a power-up picks it up.
  const found = state.powerUps.findIndex((p) => p.ring === ring);
  if (found !== -1) {
    const [item] = state.powerUps.splice(found, 1);
    events.push({ type: 'pickup', color, token: move.token, kind: item.type, ring });
    if (item.type === 'reroll') state.extraRoll = true;
    else if (item.type === 'shield') state.shield[color][move.token] = true;
    else if (item.type === 'boost') state.boost[color] += 1;
  }
  return events;
}

function pickWeighted(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

// Maybe puts a new power-up on the board. It appears more often on squares far from any token on the track.
function maybeSpawn(state) {
  const s = state.settings;
  if (!s.powerUps || state.powerUps.length >= s.powerUpMax) return [];
  if (state.rng() >= s.powerUpRate * SPAWN_CHANCE_PER_RATE) return [];

  const taken = new Set(state.powerUps.map((p) => p.ring));
  const tokenRings = [];
  for (const color of state.colors) {
    state.tokens[color].forEach((p) => { if (isOnTrack(p)) tokenRings.push(ringIndex(color, p)); });
  }
  tokenRings.forEach((r) => taken.add(r));
  const candidates = PLAIN_SQUARES.filter((i) => !taken.has(i));
  if (candidates.length === 0) return [];

  const gap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, TRACK_LENGTH - d); };
  const weights = candidates.map((i) => (tokenRings.length === 0 ? 1 : 1 + Math.min(...tokenRings.map((r) => gap(i, r)))));
  const ring = pickWeighted(candidates, weights, state.rng);
  const kinds = Object.keys(SPAWN_WEIGHTS);
  const type = pickWeighted(kinds, kinds.map((k) => SPAWN_WEIGHTS[k]), state.rng);
  const id = state.nextPowerUpId++;
  state.powerUps.push({ id, type, ring });
  return [{ type: 'spawn', kind: type, ring, id }];
}

// Passes the turn. The new player's shields run out, and a power-up may appear. Returns the events.
function nextTurn(state) {
  state.turn = (state.turn + 1) % state.colors.length;
  state.attempts = 0;
  const events = [];
  const color = currentColor(state);
  if (state.shield[color].some(Boolean)) {
    state.shield[color] = state.shield[color].map(() => false);
    events.push({ type: 'shieldEnd', color });
  }
  events.push(...maybeSpawn(state));
  return events;
}

// Ends the current action: the player rolls again if `keep`, otherwise the turn passes.
function finishTurn(state, keep, events) {
  if (keep) state.attempts = 0; // leaving the yard ends the re-roll allowance
  else events.push(...nextTurn(state));
  state.phase = 'roll';
  state.moves = [];
}

// Phase "roll" -> rolls the die (face may be injected for tests). Passes the turn if nothing can move.
function roll(state, face = rollDie(state.rng)) {
  if (state.winner) throw new Error('Game is over');
  if (state.phase !== 'roll') throw new Error('Not time to roll');
  const next = cloneState(state);
  const color = currentColor(state);
  next.boosted = next.settings.powerUps && next.boost[color] > 0; // a waiting speed boost doubles this roll
  next.face = face;
  next.moves = legalMoves(next, face);
  if (next.moves.length === 0) {
    const events = [];
    let reroll = false;
    if (face === 'globus') {
      // A globus always gives another roll, even when nothing could be moved.
    } else if (onlyYardTokens(next.tokens[color]) && next.attempts + 1 < MAX_YARD_ATTEMPTS) {
      next.attempts++;
      reroll = true;
    } else {
      events.push(...nextTurn(next));
    }
    next.phase = 'roll';
    next.face = face;
    // the boost is only used up by a roll that actually moves something
    return { state: next, events: [{ type: 'skip', color, face, reroll }, ...events] };
  }
  next.phase = 'move';
  return { state: next, events: [{ type: 'roll', color, face }] };
}

// Phase "move" -> plays one of the legal moves returned by roll().
function move(state, choice) {
  if (state.phase !== 'move') throw new Error('Not time to move');
  const chosen = state.moves.find((m) => m.token === choice.token && m.kind === choice.kind);
  if (!chosen) throw new Error('Illegal move');
  const next = cloneState(state);
  const events = resolveMove(next, chosen);
  const color = currentColor(next);
  if (next.boosted) next.boost[color] -= 1;
  next.boosted = false;
  const keep = next.face === 'globus' || next.extraRoll;
  next.extraRoll = false;
  if (next.tokens[color].every((p) => p === HOME)) {
    next.winner = color;
    events.push({ type: 'win', color });
    next.phase = 'roll';
    next.moves = [];
  } else {
    finishTurn(next, keep, events);
  }
  return { state: next, events };
}

function cloneState(state) {
  const tokens = {};
  const shield = {};
  const boost = { ...state.boost };
  for (const c of state.colors) {
    tokens[c] = [...state.tokens[c]];
    shield[c] = [...state.shield[c]];
  }
  return {
    ...state,
    colors: [...state.colors],
    tokens,
    shield,
    boost,
    powerUps: state.powerUps.map((p) => ({ ...p })),
    moves: state.moves.map((m) => ({ ...m })),
  };
}

module.exports = {
  YARD, HOME, LAST_TRACK, DIE, SPAWN_WEIGHTS,
  createGame, currentColor, rollDie, legalMoves, roll, move, maybeSpawn, ringIndex,
};
