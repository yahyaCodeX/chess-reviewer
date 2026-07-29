import { Chess } from 'chess.js';
const moves = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"];
const game = new Chess();
for (const move of moves) {
  try {
    game.move(move);
  } catch (err) {
    console.error("Error:", move, err.message);
  }
}
console.log(game.fen());
