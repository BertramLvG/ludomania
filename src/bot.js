'use strict';

// Placeholder bot that covers for a player who left. It only picks the first legal move.
// Smarter play (captures, safe squares, finishing) is planned for later.
function chooseMove(state) {
  return state.moves[0];
}

module.exports = { chooseMove };
