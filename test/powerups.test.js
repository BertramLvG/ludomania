'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');
const {
  createGame, roll, move, maybeSpawn, ringIndex, YARD, SPAWN_WEIGHTS,
} = require('../src/engine');
const { chooseMove } = require('../src/bot');

const ON = { powerUps: true, powerUpRate: 10, powerUpMax: 8 };

// A two-player game (red, green) with power-ups on and the given tokens.
function game(tokens = {}, settings = ON, rng = () => 0.5, colors = ['red', 'green']) {
  const g = createGame(colors, rng, settings);
  for (const [color, positions] of Object.entries(tokens)) g.tokens[color] = positions;
  return g;
}

const ringOf = (color, p) => ringIndex(color, p);
// the relative position, for `color`, of the square that red reaches at red position redP
const relFor = (color, redP) => (ringIndex('red', redP) - board.START_INDEX[color] + 52) % 52;

// red p12 is a plain square (ring 7): a good place for a power-up that red reaches with a 2 from p10
const PLAIN_RED = 12;

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

// ---------- the setting ----------

test('without the power-up setting nothing ever spawns', () => {
  const g = game({ red: [YARD, YARD, YARD, 52] }, { powerUps: false });
  let s = g;
  for (let i = 0; i < 20; i++) s = roll(s, 'star').state; // red cannot move, so the turn passes every time
  assert.deepEqual(s.powerUps, []);
});

// ---------- spawning ----------

test('a power-up can appear when the turn passes, but never more than the chosen maximum', () => {
  let g = game({ red: [YARD, YARD, YARD, 52], green: [YARD, YARD, YARD, 52] }, { ...ON, powerUpMax: 2 }, () => 0.1);
  for (let i = 0; i < 10; i++) g = roll(g, 'star').state;
  assert.equal(g.powerUps.length, 2);
});

test('the spawn rate sets how often: rate 1 is rare, rate 10 is frequent', () => {
  const count = (rate) => {
    const rng = seeded(7);
    let spawned = 0;
    for (let i = 0; i < 2000; i++) {
      const g = game({}, { ...ON, powerUpRate: rate, powerUpMax: 8 }, rng);
      spawned += maybeSpawn(g).length;
    }
    return spawned;
  };
  const rare = count(1);
  const often = count(10);
  assert.ok(rare > 40 && rare < 160, 'rate 1 should be about 5%, got ' + rare / 20 + '%');
  assert.ok(often > 850 && often < 1150, 'rate 10 should be about 50%, got ' + often / 20 + '%');
});

test('power-ups only spawn on plain tiles that are free', () => {
  const rng = seeded(3);
  const g = game({ red: [3, 10, YARD, YARD], green: [relFor('green', 20), YARD, YARD, YARD] }, ON, rng);
  const occupied = new Set([ringOf('red', 3), ringOf('red', 10), ringOf('red', 20)]);
  for (let i = 0; i < 500; i++) {
    const s = game({ red: g.tokens.red, green: g.tokens.green }, ON, rng);
    const events = maybeSpawn(s);
    for (const e of events) {
      assert.ok(!board.GLOBES.has(e.ring), 'not on a globe or start square');
      assert.ok(!board.STARS.has(e.ring), 'not on a star');
      assert.ok(!occupied.has(e.ring), 'not on a token');
    }
  }
});

test('spawns lean towards parts of the map with few tokens', () => {
  // red and green tokens bunched together on the track
  const bunched = { red: [3, 5, 8, 10], green: [relFor('green', 4), relFor('green', 6), YARD, YARD] };
  const rng = seeded(11);
  const gap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 52 - d); };
  const tokenRings = [ringOf('red', 3), ringOf('red', 5), ringOf('red', 8), ringOf('red', 10),
    ringOf('green', relFor('green', 4)), ringOf('green', relFor('green', 6))];
  const nearest = (ring) => Math.min(...tokenRings.map((r) => gap(r, ring)));

  let total = 0;
  let n = 0;
  for (let i = 0; i < 3000; i++) {
    const g = game(bunched, { ...ON, powerUpRate: 10 }, rng);
    const [e] = maybeSpawn(g);
    if (e) { total += nearest(e.ring); n++; }
  }
  const plain = [];
  for (let i = 0; i < 52; i++) if (!board.GLOBES.has(i) && !board.STARS.has(i) && !tokenRings.includes(i)) plain.push(i);
  const uniform = plain.reduce((a, r) => a + nearest(r), 0) / plain.length;
  assert.ok(total / n > uniform + 1.5, 'average distance from tokens ' + (total / n).toFixed(1) + ' should beat uniform ' + uniform.toFixed(1));
});

test('the speed boost is the rarest power-up', () => {
  const rng = seeded(5);
  const counts = { reroll: 0, shield: 0, boost: 0 };
  for (let i = 0; i < 4000; i++) {
    const [e] = maybeSpawn(game({}, { ...ON, powerUpRate: 10 }, rng));
    if (e) counts[e.kind]++;
  }
  const others = ['reroll', 'shield'];
  for (const k of others) assert.ok(counts.boost < counts[k] / 2, 'boost ' + counts.boost + ' vs ' + k + ' ' + counts[k]);
  assert.equal(Math.min(...Object.values(SPAWN_WEIGHTS)), SPAWN_WEIGHTS.boost);
});

// ---------- picking up ----------

function withPowerUp(type, extra = {}) {
  const g = game({ red: [10, YARD, YARD, YARD], ...extra });
  g.powerUps.push({ id: 1, type, ring: ringOf('red', PLAIN_RED) });
  return g;
}

test('landing on a power-up picks it up and removes it from the board', () => {
  const g = withPowerUp('shield');
  const r = roll(g, 2);
  assert.equal(r.state.moves[0].pickup, 'shield'); // the preview says what you will get
  const m = move(r.state, r.state.moves[0]);
  assert.deepEqual(m.state.powerUps, []);
  const pickup = m.events.find((e) => e.type === 'pickup');
  assert.deepEqual([pickup.color, pickup.kind, pickup.token], ['red', 'shield', 0]);
});

test('reroll: you roll again after the move', () => {
  const m = move(...(() => { const r = roll(withPowerUp('reroll'), 2); return [r.state, r.state.moves[0]]; })());
  assert.equal(m.state.turn, 0);
  assert.equal(m.state.phase, 'roll');
});

test('without a reroll the turn passes as usual', () => {
  const r = roll(withPowerUp('boost'), 2);
  assert.equal(move(r.state, r.state.moves[0]).state.turn, 1);
});

test('boost: it is kept for your next roll', () => {
  const r = roll(withPowerUp('boost'), 2);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.boost.red, 1);
  assert.equal(m.state.boost.green, 0);
});

// ---------- shield ----------

test('shield: the token that picked it up is protected like on a globe', () => {
  const r = roll(withPowerUp('shield'), 2);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.shield.red[0], true);
});

test('an opponent who lands on a shielded token is sent home, and the shielded token stays', () => {
  const g = game({ red: [18, YARD, YARD, YARD], green: [relFor('green', 20), YARD, YARD, YARD] });
  g.shield.green[0] = true;
  const r = roll(g, 2);
  assert.equal(r.state.moves[0].sentHome, true);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.tokens.red[0], YARD);
  assert.equal(m.state.tokens.green[0], relFor('green', 20));
  assert.equal(m.state.shield.green[0], false); // it was green's turn next, so the shield has run out now

  // the same move without the shield captures the lone token
  const plain = game({ red: [18, YARD, YARD, YARD], green: [relFor('green', 20), YARD, YARD, YARD] });
  const pm = move(...(() => { const x = roll(plain, 2); return [x.state, x.state.moves[0]]; })());
  assert.equal(pm.state.tokens.red[0], 20);
  assert.equal(pm.state.tokens.green[0], YARD);
});

test('a shield lasts until its owner\'s next turn begins', () => {
  const g = game({ red: [YARD, YARD, YARD, 52], green: [20, YARD, YARD, YARD] });
  g.shield.green[0] = true;
  const r = roll(g, 'star'); // red cannot move: the turn passes to green
  assert.equal(r.state.turn, 1);
  assert.equal(r.state.shield.green[0], false);
  assert.ok(r.events.some((e) => e.type === 'shieldEnd' && e.color === 'green'));
});

test('a shield survives its owner\'s extra roll from a globus', () => {
  const g = game({ red: [YARD, YARD, YARD, YARD] });
  g.tokens.green = [20, YARD, YARD, YARD];
  g.turn = 1;
  g.shield.green[0] = true;
  const r = roll(g, 'globus');
  const m = move(r.state, r.state.moves.find((x) => x.kind === 'enter'));
  assert.equal(m.state.turn, 1); // green rolls again
  assert.equal(m.state.shield.green[0], true);
});

test('leaving the yard onto your start captures even a shielded token, and the shield is lost', () => {
  const g = game({ red: [YARD, YARD, YARD, YARD], green: [relFor('green', 0), YARD, YARD, YARD] });
  g.shield.green[0] = true;
  const r = roll(g, 'globus');
  const m = move(r.state, r.state.moves.find((x) => x.kind === 'enter'));
  assert.equal(m.state.tokens.green[0], YARD);
  assert.equal(m.state.shield.green[0], false);
});

// ---------- speed boost ----------

function boosted(tokens, boostCount = 1) {
  const g = game(tokens);
  g.boost.red = boostCount;
  return g;
}

test('boost doubles a number roll, and is used up by the move', () => {
  const r = roll(boosted({ red: [10, YARD, YARD, YARD] }), 2);
  assert.equal(r.state.boosted, true);
  assert.equal(r.state.moves[0].to, 14); // 2 doubled is 4
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.boost.red, 0);
  // the next roll is normal
  const again = game({ red: [14, YARD, YARD, YARD] });
  assert.equal(roll(again, 2).state.moves[0].to, 16);
});

test('boosts can be stacked, one is used per roll', () => {
  const r = roll(boosted({ red: [10, YARD, YARD, YARD] }, 2), 1);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.boost.red, 1);
});

test('a boosted roll that cannot move anything does not use up the boost', () => {
  const r = roll(boosted({ red: [YARD, YARD, YARD, 52] }), 'star');
  assert.equal(r.state.boost.red, 1);
});

test('boost on a star roll: the star two ahead, passing the first', () => {
  const r = roll(boosted({ red: [0, YARD, YARD, YARD] }), 'star');
  const m = r.state.moves[0];
  assert.deepEqual([m.via, m.to], [5, 11]);
  assert.equal(m.boosted, true);
  // only one star left ahead: it goes there
  const last = roll(boosted({ red: [45, YARD, YARD, YARD] }), 'star').state.moves[0];
  assert.deepEqual([last.to, last.via], [50, undefined]);
});

test('boost on a globus: a track token hops to the globe two ahead', () => {
  const r = roll(boosted({ red: [3, YARD, YARD, YARD] }), 'globus');
  const hop = r.state.moves.find((m) => m.kind === 'globe');
  assert.deepEqual([hop.via, hop.to], [8, 13]);
});

test('boost on a globus: two tokens can leave the yard together', () => {
  const r = roll(boosted({ red: [YARD, YARD, YARD, YARD] }), 'globus');
  const enter = r.state.moves.find((m) => m.kind === 'enter' && m.token === 1);
  assert.equal(enter.second, 0);
  const m = move(r.state, enter);
  assert.deepEqual(m.state.tokens.red, [0, 0, YARD, YARD]);
  assert.equal(m.state.boost.red, 0);
  assert.equal(m.state.turn, 0); // a globus still gives another roll
});

test('boost on a globus with one token left in the yard brings out just that one', () => {
  const r = roll(boosted({ red: [YARD, 20, 30, 40] }), 'globus');
  const enter = r.state.moves.find((m) => m.kind === 'enter');
  assert.equal(enter.second, undefined);
});

test('a boosted number roll that ends on a star is still carried to the next star', () => {
  const r = roll(boosted({ red: [3, YARD, YARD, YARD] }), 1); // 1 doubled is 2: p5, a star
  const m = r.state.moves[0];
  assert.deepEqual([m.via, m.to], [5, 11]);
});

test('without a boost a roll is normal even when a boost is waiting for another player', () => {
  const g = game({ red: [10, YARD, YARD, YARD] });
  g.boost.green = 2;
  assert.equal(roll(g, 2).state.moves[0].to, 12);
});


// ---------- no traps ----------

test('there is no trap power-up any more', () => {
  assert.ok(!('trap' in SPAWN_WEIGHTS));
  const rng = seeded(9);
  for (let i = 0; i < 500; i++) {
    const [e] = maybeSpawn(game({}, { ...ON, powerUpRate: 10 }, rng));
    if (e) assert.notEqual(e.kind, 'trap');
  }
  const g = game();
  assert.equal(g.traps, undefined);
  assert.equal(g.placing, undefined);
});

// ---------- bots ----------

test('a bot likes picking up power-ups', () => {
  const g = game({ red: [10, 30, YARD, YARD] });
  g.powerUps.push({ id: 1, type: 'boost', ring: ringOf('red', 12) });
  assert.equal(chooseMove(roll(g, 2).state).token, 0);
});

// ---------- a whole game ----------

test('four bots can play a full game with power-ups on, and the board stays consistent', () => {
  const rng = seeded(2024);
  let state = createGame(['red', 'green', 'yellow', 'blue'], rng, { powerUps: true, powerUpRate: 10, powerUpMax: 8 });
  let spawned = 0;
  const seen = { reroll: 0, shield: 0, boost: 0 };
  for (let i = 0; i < 60000 && !state.winner; i++) {
    const r = state.phase === 'roll' ? roll(state) : move(state, chooseMove(state, rng));
    state = r.state;
    for (const e of r.events) {
      if (e.type === 'spawn') spawned++;
      if (e.type === 'pickup') seen[e.kind]++;
    }
    // invariants: nothing shares a square with a power-up, power-ups are within the limit, shields are on the track
    const rings = new Set();
    for (const c of state.colors) {
      state.tokens[c].forEach((p, t) => {
        if (state.shield[c][t]) assert.ok(p >= 0 && p <= 50, 'a shield only on a token on the track');
        if (p >= 0 && p <= 50) rings.add(ringIndex(c, p));
      });
    }
    for (const u of state.powerUps) assert.ok(!rings.has(u.ring), 'a power-up under a token');
    assert.ok(state.powerUps.length <= 8);
    for (const c of state.colors) assert.ok(state.boost[c] >= 0);
  }
  assert.ok(state.winner, 'the game should finish');
  assert.ok(spawned > 10, 'power-ups should have appeared');
  assert.ok(Object.values(seen).reduce((a, b) => a + b, 0) > 3, 'some should have been picked up');
});