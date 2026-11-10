"""
Worker tests — run with:  pytest -q   (from ai-worker/)
No Kafka or Stockfish needed.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chess  # noqa: E402
import chess.engine  # noqa: E402

import main  # noqa: E402
from opening_book import OpeningBook  # noqa: E402

BOOK = OpeningBook(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "openings"))


def play(*sans):
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


def test_book_is_loaded():
    assert len(BOOK) > 5000


def test_book_recognises_and_names_openings():
    hit, name = BOOK.lookup(play("e4", "e5", "Nf3", "d6"))
    assert hit and name == "Philidor Defense"
    hit, name = BOOK.lookup(play("e4", "e5", "Nf3", "Nc6", "Bc4", "Nd4"))
    assert hit and "Blackburne" in name


def test_book_rejects_nonsense():
    hit, _ = BOOK.lookup(play("h4", "a5", "Rh3", "Ra6", "Rg3"))
    assert not hit


def test_format_score_checkmate_names_winner():
    board = play("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#")
    assert main.format_score(board, None) == "Mate in 0 for White"


def test_format_score_centipawns_and_mate():
    board = chess.Board()
    cp = {"score": chess.engine.PovScore(chess.engine.Cp(34), chess.WHITE)}
    assert main.format_score(board, cp) == "+0.34"
    mate = {"score": chess.engine.PovScore(chess.engine.Mate(-2), chess.WHITE)}
    assert main.format_score(board, mate) == "Mate in 2 for Black"


def test_format_score_draw_positions():
    assert main.format_score(chess.Board(), None) == "+0.00"


class FakeEngine:
    """Returns a fixed two-line analysis like Stockfish with MultiPV 2."""

    def analyse(self, board, limit, multipv):
        moves = list(board.legal_moves)
        return [
            {"score": chess.engine.PovScore(chess.engine.Cp(25), chess.WHITE), "pv": moves[:3]},
            {"score": chess.engine.PovScore(chess.engine.Cp(5), chess.WHITE), "pv": moves[1:2]},
        ]


def test_analyse_position_returns_best_alt_and_line():
    result = main.analyse_position(FakeEngine(), chess.Board())
    assert result["eval"] == "+0.25"
    assert result["alt"] == "+0.05"
    assert result["best"] == result["line"].split()[0]
    assert len(result["line"].split()) == 3


def test_analyse_position_game_over():
    board = play("f3", "e5", "g4", "Qh4#")
    result = main.analyse_position(FakeEngine(), board)
    assert result == {"eval": "Mate in 0 for Black", "best": None, "alt": None, "line": None}
