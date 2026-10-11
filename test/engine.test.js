'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');
const { createGame, roll, move, legalMoves, ringIndex, YARD, HOME } = require('../src/engine');

const names = (set) => [...set].map((i) => board.RING[i]).sort();

function game(tokens, colors = ['red', 'green']) {
  const g = createGame(colors);
  for (const [color, positions] of Object.entries(tokens)) g.tokens[color] = positions;
  return g;
}

test('board has 52 track squares and the agreed globes and stars', () => {
  assert.equal(board.RING.length, 52);
  assert.equal(new Set(board.RING).size, 52);
  assert.deepEqual(names(board.GLOBES), ['B7', 'C9', 'G14', 'G3', 'I13', 'I2', 'M7', 'N9']);
  assert.deepEqual(names(board.STARS), ['A8', 'F9', 'G6', 'H1', 'H15', 'I10', 'J7', 'O8']);
});

test('start squares and finish columns match the board', () => {
  assert.equal(board.RING[board.START_INDEX.red], 'B7');
  assert.equal(board.RING[board.START_INDEX.green], 'I2');
  assert.equal(board.RING[board.START_INDEX.yellow], 'N9');
  assert.equal(board.RING[board.START_INDEX.blue], 'G14');
  assert.deepEqual(board.FINISH.red, ['B8', 'C8', 'D8', 'E8', 'F8']);
});

test('a number roll moves tokens on the track but not tokens in the yard', () => {
  const g = game({ red: [YARD, 10, YARD, YARD] });
  const moves = legalMoves(g, 4);
  assert.deepEqual(moves.map((m) => [m.token, m.to]), [[1, 14]]);
});

test('with only yard tokens a player gets three rolls to throw a globus', () => {
  let s = createGame(['red', 'green']);
  let r = roll(s, 6);
  assert.equal(r.events[0].reroll, true);
  assert.equal(r.state.turn, 0);
  r = roll(r.state, 1);
  assert.equal(r.state.turn, 0);
  r = roll(r.state, 'star');
  assert.equal(r.events[0].reroll, false);
  assert.equal(r.state.turn, 1);
  assert.equal(r.state.attempts, 0);
});

test('throwing a globus on a re-roll brings a token out and gives a normal extra roll only', () => {
  let r = roll(createGame(['red', 'green']), 4);
  r = roll(r.state, 'globus');
  r = move(r.state, r.state.moves[0]);
  assert.equal(r.state.tokens.red[0], 0);
  assert.equal(r.state.turn, 0);
  assert.equal(r.state.attempts, 0);
  // red now has a token on the track, so a failed roll passes the turn straight away
  r = roll(r.state, 6);
  assert.equal(r.state.turn, 0); // the 6 moves the token
  r = move(r.state, r.state.moves[0]);
  assert.equal(r.state.turn, 1);
});

test('re-rolls also apply when the other tokens are already home', () => {
  const g = game({ red: [HOME, HOME, HOME, YARD] });
  const r = roll(g, 2);
  assert.equal(r.events[0].reroll, true);
  assert.equal(r.state.turn, 0);
});

test('no re-rolls when a token is on the track', () => {
  const h = game({ red: [YARD, 52, YARD, YARD] });
  assert.equal(roll(h, 6).state.turn, 0); // 6 from 52 is a legal bounce move
  assert.equal(roll(h, 'star').state.turn, 1);
});

test('globus can bring a token out and gives another roll', () => {
  const g = createGame(['red', 'green']);
  const r = roll(g, 'globus');
  assert.equal(r.state.phase, 'move');
  assert.equal(r.state.moves.length, 1); // all yard tokens are equivalent
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.tokens.red[0], 0);
  assert.equal(m.state.turn, 0);
  assert.equal(m.state.phase, 'roll');
});

test('globus with nothing to move still gives another roll', () => {
  const g = game({ red: [HOME, HOME, HOME, 56] });
  const { state } = roll(g, 'globus');
  assert.equal(state.turn, 0);
  assert.equal(state.phase, 'roll');
});

test('globus can instead move a track token to the next globe', () => {
  // red start (p0) is a globe; the next globe ahead is the start of green (13 squares on)
  const g = game({ red: [3, YARD, YARD, YARD] });
  const moves = legalMoves(g, 'globus');
  const toGlobe = moves.find((m) => m.kind === 'globe');
  assert.ok(toGlobe);
  assert.equal(board.RING[ringIndex('red', toGlobe.to)], 'G3'); // G3 is green's extra globe
  assert.ok(moves.find((m) => m.kind === 'enter'));
});

test('star moves a track token to the next star and gives no extra roll', () => {
  const g = game({ red: [0, YARD, YARD, YARD] });
  const r = roll(g, 'star');
  assert.equal(board.RING[ringIndex('red', r.state.moves[0].to)], 'G6');
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.tokens.red[0], 5);
  assert.equal(m.state.turn, 1);
});

test('star cannot be used by tokens in the yard or the finish column', () => {
  const g = game({ red: [YARD, 52, HOME, YARD] });
  assert.equal(legalMoves(g, 'star').length, 0);
  const { state } = roll(g, 'star');
  assert.equal(state.turn, 1);
});

// Green's relative position of the square that red reaches at relative position redP.
const greenAt = (redP) => (ringIndex('red', redP) - board.START_INDEX.green + 52) % 52;

test('landing on a single opponent captures it', () => {
  const g = game({ red: [20, YARD, YARD, YARD] });
  g.tokens.green = [greenAt(22), YARD, YARD, YARD];
  const r = roll(g, 2);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.tokens.red[0], 22);
  assert.equal(m.state.tokens.green[0], YARD);
});

test('landing on two opponent tokens sends your own token home', () => {
  const g = game({ red: [20, YARD, YARD, YARD] });
  g.tokens.green = [greenAt(22), greenAt(22), YARD, YARD];
  const r = roll(g, 2);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.tokens.red[0], YARD);
  assert.equal(m.state.tokens.green[0], greenAt(22));
  assert.equal(m.state.tokens.green[1], greenAt(22));
});

test('a token on a globe is protected, so the lander goes back to the yard', () => {
  const target = board.START_INDEX.yellow; // N9, yellow's start globe
  const redP = (target - board.START_INDEX.red + 52) % 52;
  const greenP = (target - board.START_INDEX.green + 52) % 52;
  const g = game({ red: [redP - 1, YARD, YARD, YARD], green: [greenP, YARD, YARD, YARD] });
  const r = roll(g, 1);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.tokens.red[0], YARD);
  assert.equal(m.state.tokens.green[0], greenP);
});

test('leaving the yard onto your start globe captures any opponent standing there', () => {
  const onRedStart = (board.START_INDEX.red - board.START_INDEX.green + 52) % 52;
  const g = game({ red: [YARD, YARD, YARD, YARD], green: [onRedStart, onRedStart, YARD, YARD] });
  const r = roll(g, 'globus');
  const m = move(r.state, r.state.moves.find((x) => x.kind === 'enter'));
  assert.equal(m.state.tokens.red[0], 0);
  assert.equal(m.state.tokens.green[0], YARD);
  assert.equal(m.state.tokens.green[1], YARD);
});

test('an exact roll is needed to reach the centre; overshoot bounces back', () => {
  const g = game({ red: [54, YARD, YARD, YARD] }); // needs 2 to get home
  assert.equal(legalMoves(g, 2)[0].to, HOME);
  assert.equal(legalMoves(g, 6)[0].to, 52); // 2 in, 4 back
});

test('a token at home cannot move', () => {
  const g = game({ red: [HOME, YARD, YARD, YARD] });
  assert.equal(legalMoves(g, 1).length, 0);
});

test('a 6 gives no extra roll and captures give none either', () => {
  const g = game({ red: [10, YARD, YARD, YARD] });
  const r = roll(g, 6);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.turn, 1);
});

test('getting all four tokens home wins the game', () => {
  const g = game({ red: [HOME, HOME, HOME, 55] });
  const r = roll(g, 1);
  const m = move(r.state, r.state.moves[0]);
  assert.equal(m.state.winner, 'red');
  assert.throws(() => roll(m.state, 1));
});

test('illegal moves are rejected', () => {
  const g = game({ red: [10, YARD, YARD, YARD] });
  const r = roll(g, 2);
  assert.throws(() => move(r.state, { token: 3, kind: 'step' }));
});
