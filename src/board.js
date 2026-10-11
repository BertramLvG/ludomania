'use strict';

// Board geometry. Columns A-O (x 0-14), rows 1-15 (y 0-14), matching board.html.
const COLUMNS = 'ABCDEFGHIJKLMNO';
const coord = (x, y) => COLUMNS[x] + (y + 1);

const TRACK_LENGTH = 52;
const COLORS = ['red', 'green', 'yellow', 'blue'];

// The 52 track squares in clockwise order.
const RING_XY = [];
const add = (x, y) => RING_XY.push([x, y]);
for (let i = 5; i >= 0; i--) add(6, i);
add(7, 0);
for (let i = 0; i <= 5; i++) add(8, i);
for (let i = 9; i <= 14; i++) add(i, 6);
add(14, 7);
for (let i = 14; i >= 9; i--) add(i, 8);
for (let i = 9; i <= 14; i++) add(8, i);
add(7, 14);
for (let i = 14; i >= 9; i--) add(6, i);
for (let i = 5; i >= 0; i--) add(i, 8);
add(0, 7);
for (let i = 0; i <= 5; i++) add(i, 6);

const RING = RING_XY.map(([x, y]) => coord(x, y));

const START_XY = { red: [1, 6], green: [8, 1], yellow: [13, 8], blue: [6, 13] };

const FINISH_XY = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};

// Ring index of each colour's start square.
const START_INDEX = {};
for (const color of COLORS) {
  const [sx, sy] = START_XY[color];
  START_INDEX[color] = RING_XY.findIndex(([x, y]) => x === sx && y === sy);
}

const FINISH = {};
for (const color of COLORS) FINISH[color] = FINISH_XY[color].map(([x, y]) => coord(x, y));

// Globes: every start square, plus the square 5 before each start square.
// Stars: 5 squares after each start square, and the last track square before each finish column.
const GLOBES = new Set();
const STARS = new Set();
for (const color of COLORS) {
  const s = START_INDEX[color];
  GLOBES.add(s);
  GLOBES.add((s - 5 + TRACK_LENGTH) % TRACK_LENGTH);
  STARS.add((s + 5) % TRACK_LENGTH);
  STARS.add((s + 50) % TRACK_LENGTH);
}

const Board = {
  COLORS, TRACK_LENGTH, RING, RING_XY, START_XY, FINISH_XY, START_INDEX, FINISH, GLOBES, STARS, coord,
};

// Works both in Node (tests, server) and in the browser (served as /board.js).
if (typeof module !== 'undefined' && module.exports) module.exports = Board;
else window.Board = Board;
