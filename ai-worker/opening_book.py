"""
Local opening book built from the Lichess `chess-openings` dataset
(https://github.com/lichess-org/chess-openings, CC0 public domain).

Every position reached along every named line counts as "book", so
transpositions are recognised too. No network calls, no API token.
"""

import csv
import glob
import os
from typing import Optional, Tuple

import chess


class OpeningBook:
    def __init__(self, folder: str):
        self.positions: set[str] = set()
        self.names: dict[str, str] = {}
        for path in sorted(glob.glob(os.path.join(folder, "*.tsv"))):
            with open(path, encoding="utf-8") as fh:
                for row in csv.DictReader(fh, delimiter="\t"):
                    board = chess.Board()
                    try:
                        for token in row["pgn"].split():
                            if token[0].isdigit():  # move numbers like "1." / "12."
                                continue
                            board.push_san(token)
                            self.positions.add(board.epd())
                    except ValueError:
                        continue
                    # The first (most general) name wins for a given position
                    self.names.setdefault(board.epd(), row["name"])

    def __len__(self) -> int:
        return len(self.positions)

    def lookup(self, board: chess.Board) -> Tuple[bool, Optional[str]]:
        """(is the position book?, opening name if this exact position is named)"""
        epd = board.epd()
        return epd in self.positions, self.names.get(epd)
