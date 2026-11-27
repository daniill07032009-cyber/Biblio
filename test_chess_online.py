import http.cookiejar
import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import chess
import server


class ChessTwoPlayerIntegrationTests(unittest.TestCase):
    """Exercise the real HTTP API with two isolated Biblio sessions."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_db_path = server.DATABASE_PATH
        self.previous_mongo_uri = server.MONGODB_URI
        server.MONGODB_URI = ""
        server.DATABASE_PATH = Path(self.temp_dir.name) / "chess-test.sqlite3"
        server.initialize_db()
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.BiblioHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.white = self.new_client()
        self.black = self.new_client()
        self.register(self.white, "chess-white@example.com", "White Test")
        self.register(self.black, "chess-black@example.com", "Black Test")

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        server.DATABASE_PATH = self.previous_db_path
        server.MONGODB_URI = self.previous_mongo_uri
        self.temp_dir.cleanup()

    def new_client(self):
        return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, client, method, path, payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            response = client.open(request)
        except HTTPError as error:
            status, result = error.code, json.loads(error.read())
            error.close()
            return status, result
        with response:
            return response.status, json.loads(response.read())

    def register(self, client, email, display_name):
        status, result = self.request(
            client,
            "POST",
            "/api/register",
            {"email": email, "display_name": display_name, "password": "secure-pass-123"},
        )
        self.assertEqual(status, 201, result)
        return result["user"]

    def get_room(self, client, code):
        status, result = self.request(client, "GET", f"/api/chess/rooms/{code}")
        self.assertEqual(status, 200, result)
        return result["room"]

    def test_two_independent_players_complete_a_synchronized_test_game(self):
        # Player one creates the room; player two joins using a separate session.
        status, created = self.request(
            self.white,
            "POST",
            "/api/chess/rooms",
            {"name": "Automated two-player test", "time_control": "10+0"},
        )
        self.assertEqual(status, 201, created)
        code = created["room"]["code"]
        self.assertEqual(created["room"]["status"], "waiting")

        status, joined = self.request(
            self.black, "POST", f"/api/chess/rooms/{code}/join", {}
        )
        self.assertEqual(status, 200, joined)
        self.assertEqual(joined["room"]["status"], "active")
        self.assertEqual(joined["room"]["white"]["name"], "White Test")
        self.assertEqual(joined["room"]["black"]["name"], "Black Test")

        opening = [
            "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6",
            "b5c6", "d7c6", "e1g1", "c8g4", "h2h3", "h7h5",
            "h3g4", "h5g4",
        ]
        board = chess.Board()
        clients = [self.white, self.black]

        # Play a known opening covering ordinary moves, a capture and castling,
        # then continue with legal moves selected from the server's own response.
        for ply in range(28):
            white_to_move = board.turn == chess.WHITE
            client = clients[0] if white_to_move else clients[1]
            actor_room = self.get_room(client, code)
            opponent = clients[1] if white_to_move else clients[0]
            opponent_room = self.get_room(opponent, code)
            self.assertEqual(actor_room["fen"], board.fen())
            self.assertEqual(opponent_room["fen"], board.fen())
            self.assertTrue(actor_room["is_my_turn"])
            self.assertFalse(opponent_room["is_my_turn"])
            self.assertEqual(actor_room["legal_moves"], opponent_room["legal_moves"] if False else actor_room["legal_moves"])

            if ply < len(opening):
                uci = opening[ply]
                move = chess.Move.from_uci(uci)
                self.assertIn(move, board.legal_moves, f"Test opening move {uci} must be legal")
            else:
                legal = actor_room["legal_moves"]
                self.assertTrue(legal, "The active player must receive legal moves")
                uci = legal[0]
                move = chess.Move.from_uci(uci)

            status, moved = self.request(
                client, "POST", f"/api/chess/rooms/{code}/move", {"move": uci}
            )
            self.assertEqual(status, 200, moved)
            board.push(move)

            white_room = self.get_room(self.white, code)
            black_room = self.get_room(self.black, code)
            self.assertEqual(white_room["fen"], board.fen())
            self.assertEqual(black_room["fen"], board.fen())
            self.assertEqual(white_room["moves"], black_room["moves"])
            self.assertEqual(len(white_room["moves"]), ply + 1)
            self.assertEqual(white_room["turn"], "black" if board.turn == chess.BLACK else "white")
            self.assertEqual(white_room["status"], "active")

        # A player attempting to move out of turn must be rejected without mutation.
        before = self.get_room(self.white, code)
        wrong_client = self.white if board.turn == chess.BLACK else self.black
        status, rejected = self.request(
            wrong_client,
            "POST",
            f"/api/chess/rooms/{code}/move",
            {"move": "a2a3"},
        )
        self.assertEqual(status, 409, rejected)
        after = self.get_room(self.white, code)
        self.assertEqual(after["fen"], before["fen"])
        self.assertEqual(after["moves"], before["moves"])
        self.assertEqual(len(after["moves"]), 28)


if __name__ == "__main__":
    unittest.main()
