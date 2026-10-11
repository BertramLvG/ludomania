'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');
const { createGame, roll, move, ringIndex, YARD, HOME } = require('../src/engine');
const { chooseMove, threats } = require('../src/bot');

// Relative position, for the given colour, of the square that red reaches at relative position redP.
const posFor = (color, redP) => (ringIndex('red', redP) - board.START_INDEX[color] + 52) % 52;

function setup(tokens, face) {
  const g = createGame(['red', 'green'], () => 0.3);
  for (const [color, positions] of Object.entries(tokens)) g.tokens[color] = positions;
  return roll(g, face).state;
}

test('the bot takes a capture over a quiet move', () => {
  const s = setup({
    red: [20, 30, YARD, YARD],
    green: [posFor('green', 22), YARD, YARD, YARD],
  }, 2);
  const choice = chooseMove(s);
  assert.equal(choice.token, 0); // 20 + 2 = 22 captures
});

test('the bot does not walk onto two defending opponent tokens', () => {
  const target = posFor('green', 22);
  const s = setup({
    red: [20, 30, YARD, YARD],
    green: [target, target, YARD, YARD],
  }, 2);
  assert.equal(chooseMove(s).token, 1);
});

test('the bot brings a token out on a globus when it has nothing better', () => {
  const s = setup({ red: [YARD, YARD, YARD, YARD] }, 'globus');
  assert.equal(chooseMove(s).kind, 'enter');
});

test('the bot prefers to move a token that an opponent can hit', () => {
  // red token 0 sits 2 squares ahead of a green token (in danger); token 1 is far from everything
  const s = setup({
    red: [20, 40, YARD, YARD],
    green: [posFor('green', 18), YARD, YARD, YARD],
  }, 6); // a 6 takes token 0 out of reach (8 squares ahead); a 4 would leave it 6 ahead, still in reach
  assert.ok(threats(s, 'red', 0) > 0);
  assert.equal(chooseMove(s).token, 0);
});

test('the bot finishes a token when it can', () => {
  const s = setup({ red: [54, 20, YARD, YARD] }, 2);
  assert.equal(chooseMove(s).token, 0);
});

test('four bots can play a whole game to the end with legal moves only', () => {
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let state = createGame(['red', 'green', 'yellow', 'blue'], rng);
  for (let i = 0; i < 20000 && !state.winner; i++) {
    let r = roll(state, undefined);
    state = r.state;
    if (state.phase === 'move') state = move(state, chooseMove(state, rng)).state;
  }
  assert.ok(state.winner, 'game should finish');
  assert.ok(state.tokens[state.winner].every((p) => p === HOME));
});
