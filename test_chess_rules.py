import unittest

import chess


class ChessRulesEngineTests(unittest.TestCase):
    def test_castling_en_passant_and_promotion_are_legal_moves(self):
        castling = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
        self.assertIn(chess.Move.from_uci("e1g1"), castling.legal_moves)
        self.assertIn(chess.Move.from_uci("e1c1"), castling.legal_moves)

        en_passant = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2")
        self.assertIn(chess.Move.from_uci("e5d6"), en_passant.legal_moves)

        promotion = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
        for piece in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT):
            self.assertIn(chess.Move(chess.A7, chess.A8, promotion=piece), promotion.legal_moves)

    def test_checkmate_and_stalemate_are_detected(self):
        board = chess.Board()
        for uci in ("f2f3", "e7e5", "g2g4", "d8h4"):
            board.push_uci(uci)
        self.assertTrue(board.is_checkmate())

        stalemate = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
        self.assertTrue(stalemate.is_stalemate())


if __name__ == "__main__":
    unittest.main()
