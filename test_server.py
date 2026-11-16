import http.cookiejar
import json
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import server
import mongomock


class BiblioServerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        server.DATABASE_PATH = Path(self.temp_dir.name) / "test.sqlite3"
        server.initialize_db()
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.BiblioHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.cookies = http.cookiejar.CookieJar()
        self.client = build_opener(HTTPCookieProcessor(self.cookies))

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.temp_dir.cleanup()

    def request(self, method, path, payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            response = self.client.open(request)
        except HTTPError as error:
            status, result = error.code, json.loads(error.read())
            error.close()
            return status, result
        return response.status, json.loads(response.read())

    def register(self, email="reader@example.com"):
        status, result = self.request(
            "POST",
            "/api/register",
            {"email": email, "display_name": "Книжный читатель", "password": "secure-pass-123"},
        )
        self.assertEqual(status, 201)
        return result["user"]

    def test_registration_login_and_account_password_change(self):
        user = self.register()
        self.assertEqual(user["email"], "reader@example.com")
        status, result = self.request(
            "POST",
            "/api/login",
            {"email": "reader@example.com", "password": "wrong-password"},
        )
        self.assertEqual(status, 401)

        self.request(
            "POST",
            "/api/logout",
            {},
        )
        status, result = self.request(
            "POST",
            "/api/login",
            {"email": "READER@example.com", "password": "secure-pass-123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["id"], user["id"])
        status, result = self.request(
            "POST",
            "/api/account/password",
            {"current_password": "secure-pass-123", "new_password": "another-pass-456"},
        )
        self.assertEqual(status, 200)
        status, _ = self.request(
            "POST",
            "/api/login",
            {"email": "reader@example.com", "password": "another-pass-456"},
        )
        self.assertEqual(status, 200)

    def test_registered_account_stats_counts_real_users(self):
        self.register("first-stats@example.com")
        self.request("POST", "/api/logout", {})
        self.register("second-stats@example.com")
        status, result = self.request("GET", "/api/stats")
        self.assertEqual(status, 200)
        self.assertEqual(result["registered_accounts"], 2)

    def test_draft_is_private_and_published_book_is_public(self):
        self.register()
        draft = {
            "title": "Черновик истории",
            "author": "Автор",
            "genre": "Романы",
            "age_rating": "12+",
            "description": "Пока только автор может это увидеть.",
            "status": "draft",
            "chapters": [{"title": "Глава 1", "content": "Текст черновика"}],
        }
        status, result = self.request("POST", "/api/books", draft)
        self.assertEqual(status, 201)
        draft_id = result["book"]["id"]
        status, result = self.request("GET", "/api/books")
        self.assertEqual(status, 200)
        self.assertEqual(result["books"], [])
        status, result = self.request("GET", "/api/my/books")
        self.assertEqual(status, 200)
        self.assertEqual(result["books"][0]["id"], draft_id)

        published = {
            **draft,
            "title": "Опубликованная история",
            "description": "Доступно читателям.",
            "status": "published",
            "chapters": [{"title": "Первая глава", "content": "Начало книги."}],
        }
        status, result = self.request("POST", "/api/books", published)
        self.assertEqual(status, 201)
        status, result = self.request("GET", "/api/books")
        self.assertEqual(status, 200)
        self.assertEqual(len(result["books"]), 1)
        self.assertEqual(result["books"][0]["title"], "Опубликованная история")
        published_id = result["books"][0]["id"]
        status, result = self.request("GET", f"/api/books/{published_id}")
        self.assertEqual(status, 200)
        self.assertEqual(result["book"]["chapters"][0]["title"], "Первая глава")

    def test_multi_chapter_book_appears_once_with_all_chapters(self):
        self.register()
        book = {
            "title": "Одна книга, три главы",
            "author": "Автор",
            "genre": "Романы",
            "age_rating": "12+",
            "status": "published",
            "chapters": [
                {"title": "Начало", "content": "Текст первой главы."},
                {"title": "Продолжение", "content": "Текст второй главы."},
                {"title": "Финал", "content": "Текст третьей главы."},
            ],
        }
        status, result = self.request("POST", "/api/books", book)
        self.assertEqual(status, 201)
        book_id = result["book"]["id"]
        self.assertEqual(result["book"]["chapter_count"], 3)
        self.assertEqual(len(result["book"]["chapters"]), 3)

        status, result = self.request("GET", "/api/books")
        self.assertEqual(status, 200)
        self.assertEqual(len(result["books"]), 1)
        self.assertEqual(result["books"][0]["id"], book_id)
        self.assertEqual(result["books"][0]["title"], "Одна книга, три главы")
        self.assertEqual(result["books"][0]["chapter_count"], 3)

        status, result = self.request("GET", f"/api/books/{book_id}")
        self.assertEqual(status, 200)
        self.assertEqual(
            [chapter["title"] for chapter in result["book"]["chapters"]],
            ["Начало", "Продолжение", "Финал"],
        )

    def test_book_changes_are_limited_to_owner(self):
        self.register("first@example.com")
        status, result = self.request(
            "POST",
            "/api/books",
            {
                "title": "Моя книга",
                "author": "Автор",
                "genre": "Детективы",
                "age_rating": "16+",
                "status": "draft",
                "chapters": [],
            },
        )
        self.assertEqual(status, 201)
        book_id = result["book"]["id"]
        self.request("POST", "/api/logout", {})
        self.register("second@example.com")
        status, _ = self.request(
            "PUT",
            f"/api/books/{book_id}",
            {
                "title": "Чужая книга",
                "author": "Другой автор",
                "genre": "Романы",
                "age_rating": "0+",
                "status": "draft",
                "chapters": [],
            },
        )
        self.assertEqual(status, 404)
        status, result = self.request("GET", "/api/my/books")
        self.assertEqual(status, 200)
        self.assertEqual(result["books"], [])

    def test_public_api_hides_drafts_and_newsletter_persists_subscriptions(self):
        self.register()
        status, result = self.request("POST", "/api/newsletter", {"email": "fan@example.com"})
        self.assertEqual(status, 201)
        self.assertTrue(result["ok"])
        status, result = self.request("POST", "/api/newsletter", {"email": "FAN@example.com"})
        self.assertEqual(status, 409)
        self.assertIn("подписан", result["error"])

        draft_status, draft_result = self.request(
            "POST",
            "/api/books",
            {
                "title": "Скрытый черновик",
                "author": "Автор",
                "genre": "Романы",
                "age_rating": "0+",
                "status": "draft",
                "chapters": [],
            },
        )
        self.assertEqual(draft_status, 201)
        status, result = self.request("GET", f"/api/books/{draft_result['book']['id']}")
        self.assertEqual(status, 404)

    def test_publishing_requires_a_chapter_with_text(self):
        self.register()
        book = {
            "title": "Пустая книга",
            "author": "Автор",
            "genre": "Другое",
            "age_rating": "0+",
            "status": "published",
            "chapters": [{"title": "Глава 1", "content": "  "}],
        }
        status, result = self.request("POST", "/api/books", book)
        self.assertEqual(status, 400)
        self.assertIn("главу", result["error"])

        book["chapters"] = [
            {"title": "Глава 1", "content": "Текст главы."},
            {"title": "Глава 2", "content": ""},
        ]
        status, result = self.request(
            "POST",
            "/api/books",
            book,
        )
        self.assertEqual(status, 400)
        self.assertIn("пустые главы", result["error"])

    def test_published_books_include_catalog_metadata_and_ratings(self):
        self.register("author@example.com")
        status, result = self.request(
            "POST",
            "/api/books",
            {
                "title": "Книга для каталога",
                "author": "Автор",
                "genre": "Фантастика",
                "age_rating": "12+",
                "language": "English",
                "tags": [" космос ", "приключения", "КОСМОС"],
                "description": "Описание",
                "status": "published",
                "chapters": [{"title": "Глава 1", "content": "слово " * 400}],
            },
        )
        self.assertEqual(status, 201)
        book = result["book"]
        book_id = book["id"]
        self.assertEqual(book["language"], "English")
        self.assertEqual(book["tags"], ["космос", "приключения"])
        self.assertEqual(book["page_count"], 2)
        self.assertEqual(book["chapter_count"], 1)

        status, result = self.request("GET", "/api/books")
        self.assertEqual(status, 200)
        self.assertEqual(result["books"][0]["page_count"], 2)
        self.assertEqual(result["books"][0]["chapter_count"], 1)
        status, _ = self.request(
            "POST", f"/api/books/{book_id}/rating", {"rating": 5}
        )
        self.assertEqual(status, 403)
        self.request("POST", "/api/logout", {})
        self.register("reader@example.com")

        status, _ = self.request(
            "POST", f"/api/books/{book_id}/rating", {"rating": 6}
        )
        self.assertEqual(status, 400)
        status, result = self.request(
            "POST", f"/api/books/{book_id}/rating", {"rating": 5}
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["rating"], 5.0)
        status, result = self.request("GET", f"/api/books/{book_id}")
        self.assertEqual(status, 200)
        self.assertEqual(result["book"]["rating_count"], 1)
        self.assertEqual(result["book"]["user_rating"], 5)

        status, result = self.request(
            "POST", f"/api/books/{book_id}/rating", {"rating": 3}
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["rating_count"], 1)
        self.assertEqual(result["rating"], 3.0)

    def test_mongodb_backend_supports_accounts_books_and_ratings(self):
        uri = "mongodb://biblio-test/"
        client = mongomock.MongoClient()
        original_uri = server.MONGODB_URI
        server.MONGODB_URI = uri
        server._MONGO_CLIENTS[uri] = client
        try:
            server.initialize_db()
            author = self.register("mongo-author@example.com")
            status, result = self.request(
                "POST",
                "/api/books",
                {
                    "title": "Книга в MongoDB",
                    "author": "Автор",
                    "genre": "Фантастика",
                    "age_rating": "12+",
                    "status": "published",
                    "chapters": [{"title": "Глава", "content": "Текст главы"}],
                },
            )
            self.assertEqual(status, 201)
            book_id = result["book"]["id"]
            self.assertEqual(result["book"]["chapter_count"], 1)
            self.assertEqual(result["book"]["chapters"][0]["position"], 1)

            self.request("POST", "/api/logout", {})
            reader = self.register("mongo-reader@example.com")
            self.assertNotEqual(author["id"], reader["id"])
            status, result = self.request(
                "POST", f"/api/books/{book_id}/rating", {"rating": 5}
            )
            self.assertEqual(status, 200)
            self.assertEqual(result["rating"], 5.0)
            status, result = self.request("GET", f"/api/books/{book_id}")
            self.assertEqual(status, 200)
            self.assertEqual(result["book"]["user_rating"], 5)

            self.request("POST", "/api/logout", {})
            self.register("mongo-reader-two@example.com")
            status, result = self.request(
                "POST", f"/api/books/{book_id}/rating", {"rating": 3}
            )
            self.assertEqual(status, 200)

            status, result = self.request("GET", "/api/books")
            self.assertEqual(status, 200)
            self.assertEqual(len(result["books"]), 1)
            self.assertEqual(result["books"][0]["rating"], 4.0)
            self.assertEqual(result["books"][0]["rating_count"], 2)

            status, result = self.request(
                "POST", "/api/newsletter", {"email": "mongo-fan@example.com"}
            )
            self.assertEqual(status, 201)
            status, result = self.request(
                "POST", "/api/newsletter", {"email": "MONGO-FAN@example.com"}
            )
            self.assertEqual(status, 409)
            self.assertIn("подписан", result["error"])
        finally:
            server.MONGODB_URI = original_uri
            server._MONGO_CLIENTS.pop(uri, None)
            client.close()

    def test_game_room_flow_supports_private_access_and_xp(self):
        owner = self.register("owner-games@example.com")
        status, result = self.request(
            "POST",
            "/api/games",
            {
                "name": "Кампания «Закат»",
                "description": "Мрачная экспедиция по заброшенному городу.",
                "access": "private",
                "join_code": "RAID-42",
                "catalog_game_slug": "dnd",
            },
        )
        self.assertEqual(status, 201)
        game_id = result["game"]["id"]
        status, result = self.request("GET", "/api/games")
        self.assertEqual(status, 200)
        self.assertNotIn(game_id, [game["id"] for game in result["games"]])
        status, result = self.request("GET", "/api/catalog/games/dnd")
        self.assertEqual(status, 200)
        self.assertEqual(result["rooms"], [])
        self.assertEqual([room["id"] for room in result["private_rooms"]], [game_id])

        status, result = self.request("POST", f"/api/games/{game_id}/join-code", {})
        self.assertEqual(status, 200)
        self.assertTrue(result["game"]["join_code"])
        wrong_code = result["game"]["join_code"]

        self.request("POST", "/api/logout", {})
        guest = self.register("guest-games@example.com")
        status, result = self.request("GET", "/api/games")
        self.assertEqual(status, 200)
        self.assertNotIn(game_id, [game["id"] for game in result["games"]])
        status, result = self.request("GET", "/api/catalog/games/dnd")
        self.assertEqual(status, 200)
        self.assertEqual(result["rooms"], [])
        self.assertEqual(result["private_rooms"], [])
        status, result = self.request(
            "POST",
            f"/api/games/{game_id}/join",
            {"join_code": "wrong", "owner_name": owner["display_name"]},
        )
        self.assertEqual(status, 403)
        status, result = self.request(
            "POST",
            "/api/games/enter",
            {"code": wrong_code, "owner_name": "Someone else"},
        )
        self.assertEqual(status, 404)
        status, result = self.request(
            "POST",
            "/api/games/enter",
            {"code": wrong_code, "owner_name": owner["display_name"].lower()},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["game_id"], game_id)

        status, result = self.request(
            "POST",
            f"/api/games/{game_id}/characters",
            {
                "name": "Элин",
                "class_name": "Воин",
                "race": "Человек",
                "strength": 16,
                "hp": 18,
                "max_hp": 22,
                "armor_class": 15,
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(result["character"]["name"], "Элин")
        self.assertEqual(result["character"]["strength"], 16)
        self.assertEqual(result["character"]["hp"], 18)
        status, result = self.request("GET", f"/api/games/{game_id}")
        self.assertEqual(status, 200)
        self.assertTrue(result["game"]["is_member"])
        self.assertFalse(result["game"]["is_owner"])
        status, _ = self.request(
            "PATCH",
            f"/api/games/{game_id}/characters/{guest['id']}",
            {"strength": 20},
        )
        self.assertEqual(status, 403)

        self.request("POST", "/api/logout", {})
        status, result = self.request(
            "POST",
            "/api/login",
            {"email": owner["email"], "password": "secure-pass-123"},
        )
        self.assertEqual(status, 200)
        status, result = self.request("GET", f"/api/games/{game_id}")
        self.assertTrue(result["game"]["is_member"])
        self.assertTrue(result["game"]["is_owner"])

        status, _ = self.request(
            "POST",
            f"/api/games/{game_id}/characters",
            {"name": "Персонаж ведущего"},
        )
        self.assertEqual(status, 403)
        status, result = self.request(
            "PATCH",
            f"/api/games/{game_id}/characters/{guest['id']}",
            {"strength": 18, "hp": 12, "max_hp": 24, "armor_class": 17},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["character"]["strength"], 18)
        self.assertEqual(result["character"]["hp"], 12)
        status, _ = self.request(
            "PATCH",
            f"/api/games/{game_id}/characters/{guest['id']}",
            {"hp": 25, "max_hp": 24},
        )
        self.assertEqual(status, 400)

        status, result = self.request(
            "POST",
            f"/api/games/{game_id}/sessions",
            {"user_id": guest["id"], "title": "Падение башни", "xp_awarded": 120},
        )
        self.assertEqual(status, 201)
        self.assertEqual(result["session"]["xp_awarded"], 120)
        status, result = self.request("GET", f"/api/games/{game_id}")
        self.assertEqual(status, 200)
        self.assertEqual(result["game"]["heroes"][0]["xp"], 120)
        self.assertEqual(result["game"]["heroes"][0]["level"], 2)

    def test_game_catalog_ratings_and_live_viewer_presence(self):
        status, result = self.request("GET", "/api/catalog/games")
        self.assertEqual(status, 200)
        game = result["games"][0]
        self.assertEqual(game["slug"], "dnd")
        self.assertEqual(game["title"], "Dungeons & Dragons")
        self.assertIn("двадцатигранного кубика", game["description"])
        self.assertGreater(len(game["description"]), 400)
        self.assertEqual(game["rating_count"], 0)
        self.assertEqual(game["active_viewers"], 0)

        viewer_token = "123e4567-e89b-12d3-a456-426614174000"
        status, result = self.request(
            "POST",
            "/api/catalog/games/dnd/presence",
            {"viewer_token": viewer_token},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["active_viewers"], 1)
        status, result = self.request(
            "POST",
            "/api/catalog/games/dnd/presence",
            {"viewer_token": viewer_token},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["active_viewers"], 1)
        status, result = self.request("GET", "/api/catalog/games/dnd")
        self.assertEqual(status, 200)
        self.assertEqual(result["game"]["active_viewers"], 1)
        status, result = self.request("GET", "/api/catalog/games")
        self.assertEqual(status, 200)
        self.assertEqual(result["games"][0]["active_viewers"], 1)

        status, result = self.request(
            "POST",
            "/api/catalog/games/dnd/presence",
            {"viewer_token": "not-a-uuid"},
        )
        self.assertEqual(status, 400)
        status, _ = self.request(
            "POST", "/api/catalog/games/dnd/rating", {"rating": 5}
        )
        self.assertEqual(status, 401)

        self.register("catalog-rater@example.com")
        status, result = self.request(
            "POST", "/api/catalog/games/dnd/rating", {"rating": 5}
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["rating"], 5.0)
        self.assertEqual(result["rating_count"], 1)
        status, result = self.request("GET", "/api/catalog/games")
        self.assertEqual(status, 200)
        self.assertEqual(result["games"][0]["user_rating"], 5)

    def test_game_catalog_rooms_persist_until_the_creator_deletes_them(self):
        with server.connect_db() as db:
            db.execute(
                """
                INSERT INTO game_catalog (slug, title, description, cover_symbol, cover_theme)
                VALUES ('other-game', 'Другая игра', 'Описание', 'OG', 'fantasy')
                """
            )
        owner = self.register("catalog-room-owner@example.com")
        status, result = self.request(
            "POST",
            "/api/games",
            {
                "name": "Кампания «Северный путь»",
                "description": "Сохранённое описание кампании.",
                "access": "public",
                "catalog_game_slug": "dnd",
            },
        )
        self.assertEqual(status, 201)
        room_id = result["game"]["id"]
        self.assertEqual(result["game"]["catalog_game_slug"], "dnd")
        status, other_room = self.request(
            "POST",
            "/api/games",
            {"name": "Чужая кампания", "catalog_game_slug": "other-game"},
        )
        self.assertEqual(status, 201)

        status, result = self.request("GET", "/api/catalog/games/dnd")
        self.assertEqual(status, 200)
        self.assertEqual(len(result["rooms"]), 1)
        self.assertEqual(result["rooms"][0]["id"], room_id)
        self.assertEqual(result["rooms"][0]["description"], "Сохранённое описание кампании.")

        self.request("POST", "/api/logout", {})
        self.register("catalog-room-visitor@example.com")
        status, result = self.request("GET", "/api/catalog/games/dnd")
        self.assertEqual(status, 200)
        self.assertEqual(result["rooms"][0]["id"], room_id)
        status, _ = self.request("DELETE", f"/api/games/{room_id}")
        self.assertEqual(status, 403)

        self.request("POST", "/api/logout", {})
        self.request(
            "POST",
            "/api/login",
            {"email": owner["email"], "password": "secure-pass-123"},
        )
        status, result = self.request("DELETE", f"/api/games/{room_id}")
        self.assertEqual(status, 200)
        status, result = self.request("GET", "/api/catalog/games/dnd")
        self.assertEqual(status, 200)
        self.assertEqual(result["rooms"], [])
        status, result = self.request("GET", "/api/catalog/games/other-game")
        self.assertEqual(status, 200)
        self.assertEqual(result["rooms"][0]["id"], other_room["game"]["id"])

    def test_mongodb_game_catalog_ratings_and_live_viewer_presence(self):
        uri = "mongodb://biblio-catalog-test/"
        client = mongomock.MongoClient()
        original_uri = server.MONGODB_URI
        server.MONGODB_URI = uri
        server._MONGO_CLIENTS[uri] = client
        try:
            server.initialize_db()
            server.initialize_db()
            status, result = self.request("GET", "/api/catalog/games")
            self.assertEqual(status, 200)
            self.assertEqual(result["games"][0]["slug"], "dnd")
            viewer_token = "123e4567-e89b-12d3-a456-426614174000"
            status, result = self.request(
                "POST",
                "/api/catalog/games/dnd/presence",
                {"viewer_token": viewer_token},
            )
            self.assertEqual(status, 200)
            self.assertEqual(result["active_viewers"], 1)
            self.register("mongo-catalog-rater@example.com")
            status, result = self.request(
                "POST", "/api/catalog/games/dnd/rating", {"rating": 4}
            )
            self.assertEqual(status, 200)
            self.assertEqual(result["rating"], 4.0)
            status, result = self.request("GET", "/api/catalog/games/dnd")
            self.assertEqual(status, 200)
            self.assertEqual(result["game"]["user_rating"], 4)
            self.assertEqual(result["game"]["active_viewers"], 1)
            status, result = self.request("GET", "/api/catalog/games")
            self.assertEqual(status, 200)
            self.assertEqual(result["games"][0]["active_viewers"], 1)
        finally:
            server.MONGODB_URI = original_uri
            server._MONGO_CLIENTS.pop(uri, None)
            client.close()

    def test_mongodb_game_catalog_rooms_persist_until_the_creator_deletes_them(self):
        uri = "mongodb://biblio-catalog-rooms-test/"
        client = mongomock.MongoClient()
        original_uri = server.MONGODB_URI
        server.MONGODB_URI = uri
        server._MONGO_CLIENTS[uri] = client
        try:
            server.initialize_db()
            client["biblio"].game_catalog.insert_one({
                "slug": "other-game",
                "title": "Другая игра",
                "description": "Описание",
                "cover_symbol": "OG",
                "cover_theme": "fantasy",
            })
            owner = self.register("mongo-catalog-room-owner@example.com")
            status, result = self.request(
                "POST",
                "/api/games",
                {
                    "name": "Mongo campaign",
                    "description": "Persistent room",
                    "catalog_game_slug": "dnd",
                },
            )
            self.assertEqual(status, 201)
            room_id = result["game"]["id"]
            status, other_room = self.request(
                "POST",
                "/api/games",
                {"name": "Other campaign", "catalog_game_slug": "other-game"},
            )
            self.assertEqual(status, 201)

            status, result = self.request("GET", "/api/catalog/games/dnd")
            self.assertEqual(status, 200)
            self.assertEqual(len(result["rooms"]), 1)
            self.assertEqual(result["rooms"][0]["id"], room_id)
            self.assertEqual(result["rooms"][0]["description"], "Persistent room")

            self.request("POST", "/api/logout", {})
            self.register("mongo-catalog-room-visitor@example.com")
            status, _ = self.request("DELETE", f"/api/games/{room_id}")
            self.assertEqual(status, 403)

            self.request("POST", "/api/logout", {})
            self.request(
                "POST",
                "/api/login",
                {"email": owner["email"], "password": "secure-pass-123"},
            )
            status, _ = self.request("DELETE", f"/api/games/{room_id}")
            self.assertEqual(status, 200)
            status, result = self.request("GET", "/api/catalog/games/dnd")
            self.assertEqual(status, 200)
            self.assertEqual(result["rooms"], [])
            status, result = self.request("GET", "/api/catalog/games/other-game")
            self.assertEqual(status, 200)
            self.assertEqual(result["rooms"][0]["id"], other_room["game"]["id"])
        finally:
            server.MONGODB_URI = original_uri
            server._MONGO_CLIENTS.pop(uri, None)
            client.close()

    def test_mongodb_game_room_flow_supports_private_access_and_xp(self):
        uri = "mongodb://biblio-test/"
        client = mongomock.MongoClient()
        original_uri = server.MONGODB_URI
        server.MONGODB_URI = uri
        server._MONGO_CLIENTS[uri] = client
        try:
            server.initialize_db()
            owner = self.register("mongo-owner@example.com")
            status, result = self.request(
                "POST",
                "/api/games",
                {
                    "name": "Mongo room",
                    "access": "private",
                    "join_code": "MONGO-1",
                    "catalog_game_slug": "dnd",
                },
            )
            self.assertEqual(status, 201)
            game_id = result["game"]["id"]

            status, result = self.request("POST", f"/api/games/{game_id}/join-code", {})
            self.assertEqual(status, 200)
            join_code = result["game"]["join_code"]
            status, result = self.request("GET", "/api/catalog/games/dnd")
            self.assertEqual(status, 200)
            self.assertEqual(result["rooms"], [])
            self.assertEqual([room["id"] for room in result["private_rooms"]], [game_id])

            self.request("POST", "/api/logout", {})
            guest = self.register("mongo-guest@example.com")
            status, result = self.request("GET", "/api/games")
            self.assertNotIn(game_id, [game["id"] for game in result["games"]])
            status, result = self.request("GET", "/api/catalog/games/dnd")
            self.assertEqual(result["rooms"], [])
            self.assertEqual(result["private_rooms"], [])
            status, result = self.request(
                "POST",
                "/api/games/enter",
                {"code": join_code, "owner_name": "Someone else"},
            )
            self.assertEqual(status, 404)
            status, result = self.request(
                "POST",
                "/api/games/enter",
                {"code": join_code, "owner_name": owner["display_name"]},
            )
            self.assertEqual(status, 200)
            self.assertEqual(result["game_id"], game_id)
            status, result = self.request(
                "POST",
                f"/api/games/{game_id}/characters",
                {"name": "Свет", "class_name": "Маг", "race": "Эльф", "wisdom": 14},
            )
            self.assertEqual(status, 201)
            self.assertEqual(result["character"]["wisdom"], 14)

            self.request("POST", "/api/logout", {})
            status, result = self.request(
                "POST",
                "/api/login",
                {"email": owner["email"], "password": "secure-pass-123"},
            )
            self.assertEqual(status, 200)
            status, result = self.request(
                "PATCH",
                f"/api/games/{game_id}/characters/{guest['id']}",
                {"dexterity": 17, "hp": 16, "max_hp": 20},
            )
            self.assertEqual(status, 200)
            self.assertEqual(result["character"]["dexterity"], 17)
            status, result = self.request(
                "POST",
                f"/api/games/{game_id}/sessions",
                {"user_id": guest["id"], "title": "Бой", "xp_awarded": 120},
            )
            self.assertEqual(status, 201)
            status, result = self.request("GET", f"/api/games/{game_id}")
            self.assertEqual(status, 200)
            self.assertEqual(result["game"]["heroes"][0]["xp"], 120)
            self.assertEqual(result["game"]["heroes"][0]["level"], 2)
        finally:
            server.MONGODB_URI = original_uri
            server._MONGO_CLIENTS.pop(uri, None)
            client.close()

    def test_existing_database_is_migrated_with_catalog_metadata(self):
        original_path = server.DATABASE_PATH
        legacy_path = Path(self.temp_dir.name) / "legacy.sqlite3"
        try:
            server.DATABASE_PATH = legacy_path
            with sqlite3.connect(legacy_path) as db:
                db.executescript(
                    """
                    PRAGMA foreign_keys = ON;
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT ''
                    );
                    CREATE TABLE books (
                        id INTEGER PRIMARY KEY,
                        owner_id INTEGER NOT NULL REFERENCES users(id),
                        title TEXT NOT NULL,
                        author TEXT NOT NULL,
                        genre TEXT NOT NULL,
                        age_rating TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL DEFAULT ''
                    );
                    CREATE TABLE chapters (
                        id INTEGER PRIMARY KEY,
                        book_id INTEGER NOT NULL REFERENCES books(id),
                        position INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL DEFAULT ''
                    );
                    INSERT INTO users (id, email, display_name, password_hash)
                    VALUES (1, 'legacy@example.com', 'Legacy author', 'hash');
                    INSERT INTO books (id, owner_id, title, author, genre, age_rating, status)
                    VALUES (1, 1, 'Старая книга', 'Автор', 'Романы', '12+', 'published');
                    INSERT INTO chapters (book_id, position, title, content)
                    VALUES (1, 1, 'Глава', 'текст');
                    """
                )
                db.execute(
                    "UPDATE chapters SET content = ? WHERE book_id = 1", ("а" * 3600,)
                )
            server.initialize_db()
            with sqlite3.connect(legacy_path) as db:
                columns = {row[1] for row in db.execute("PRAGMA table_info(books)")}
                page_count = db.execute(
                    "SELECT page_count FROM books WHERE id = 1"
                ).fetchone()[0]
            self.assertTrue({"language", "tags", "page_count"}.issubset(columns))
            self.assertEqual(page_count, 2)
        finally:
            server.DATABASE_PATH = original_path

    def test_changing_email_requires_password_and_updates_profile(self):
        self.register()
        status, _ = self.request(
            "PATCH",
            "/api/account",
            {
                "display_name": "Новое имя",
                "email": "new@example.com",
                "current_password": "",
            },
        )
        self.assertEqual(status, 401)
        status, result = self.request(
            "PATCH",
            "/api/account",
            {
                "display_name": "Новое имя",
                "email": "new@example.com",
                "current_password": "secure-pass-123",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["display_name"], "Новое имя")
        self.assertEqual(result["user"]["email"], "new@example.com")
        status, result = self.request("GET", "/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["email"], "new@example.com")

    def test_verification_email_is_sent_through_google_apps_script(self):
        original_url = server.GMAIL_SCRIPT_URL
        original_secret = server.GMAIL_SCRIPT_SECRET
        server.GMAIL_SCRIPT_URL = "https://script.google.com/macros/s/test/exec"
        server.GMAIL_SCRIPT_SECRET = "test-shared-secret"
        try:
            response = type("Response", (), {
                "__enter__": lambda self: self,
                "__exit__": lambda self, *args: None,
                "read": lambda self: b'{"accepted":true}',
            })()
            with patch("server.urllib.request.urlopen", return_value=response) as urlopen:
                result = server.send_verification_email(
                    "reader@example.com", "Тестовый читатель", "123456"
                )
                self.assertEqual(result, {"accepted": True})
                urlopen.assert_called_once()
                request = urlopen.call_args.args[0]
                self.assertEqual(request.full_url, server.GMAIL_SCRIPT_URL)
                self.assertEqual(request.get_method(), "POST")
                self.assertEqual(request.get_header("Content-type"), "application/json")
                payload = json.loads(request.data.decode("utf-8"))
                self.assertEqual(payload["secret"], "test-shared-secret")
                self.assertEqual(payload["to"], "reader@example.com")
                self.assertEqual(payload["name"], "Тестовый читатель")
                self.assertIn("123456", payload["text"])
                self.assertIn("123456", payload["html"])
                self.assertEqual(urlopen.call_args.kwargs["timeout"], 20)
        finally:
            server.GMAIL_SCRIPT_URL = original_url
            server.GMAIL_SCRIPT_SECRET = original_secret

    def test_registration_requires_six_digit_email_verification(self):
        original_script_url = server.GMAIL_SCRIPT_URL
        original_script_secret = server.GMAIL_SCRIPT_SECRET
        original_sender = server.send_verification_email
        sent = {}
        server.GMAIL_SCRIPT_URL = "https://script.google.com/macros/s/test/exec"
        server.GMAIL_SCRIPT_SECRET = "test-shared-secret"
        server.send_verification_email = lambda email, name, code: sent.update(
            {"email": email, "name": name, "code": code}
        )
        try:
            status, result = self.request(
                "POST",
                "/api/register",
                {
                    "email": "verified-reader@example.com",
                    "display_name": "Проверенный читатель",
                    "password": "secure-pass-123",
                },
            )
            self.assertEqual(status, 202)
            self.assertTrue(result["verification_required"])
            self.assertEqual(result["email"], "verified-reader@example.com")
            self.assertEqual(sent["email"], "verified-reader@example.com")
            self.assertEqual(len(sent["code"]), 6)
            self.assertTrue(sent["code"].isdigit())

            status, result = self.request("GET", "/api/me")
            self.assertEqual(status, 200)
            self.assertIsNone(result["user"])

            status, result = self.request(
                "POST",
                "/api/verify-email",
                {"email": "verified-reader@example.com", "code": "000000" if sent["code"] != "000000" else "000001"},
            )
            self.assertEqual(status, 401)

            status, result = self.request(
                "POST",
                "/api/verify-email",
                {"email": "verified-reader@example.com", "code": sent["code"]},
            )
            self.assertEqual(status, 201)
            self.assertEqual(result["user"]["email"], "verified-reader@example.com")
            status, result = self.request("GET", "/api/me")
            self.assertEqual(status, 200)
            self.assertEqual(result["user"]["email"], "verified-reader@example.com")
        finally:
            server.GMAIL_SCRIPT_URL = original_script_url
            server.GMAIL_SCRIPT_SECRET = original_script_secret
            server.send_verification_email = original_sender

    def test_mongodb_registration_requires_six_digit_email_verification(self):
        uri = "mongodb://biblio-email-verification-test/"
        client = mongomock.MongoClient()
        original_uri = server.MONGODB_URI
        original_script_url = server.GMAIL_SCRIPT_URL
        original_script_secret = server.GMAIL_SCRIPT_SECRET
        original_sender = server.send_verification_email
        sent = {}
        server.MONGODB_URI = uri
        server._MONGO_CLIENTS[uri] = client
        server.GMAIL_SCRIPT_URL = "https://script.google.com/macros/s/test/exec"
        server.GMAIL_SCRIPT_SECRET = "test-shared-secret"
        server.send_verification_email = lambda email, name, code: sent.update(
            {"email": email, "name": name, "code": code}
        )
        try:
            server.initialize_db()
            status, result = self.request(
                "POST",
                "/api/register",
                {
                    "email": "mongo-verified-reader@example.com",
                    "display_name": "Mongo читатель",
                    "password": "secure-pass-123",
                },
            )
            self.assertEqual(status, 202)
            self.assertTrue(result["verification_required"])
            self.assertEqual(sent["email"], "mongo-verified-reader@example.com")
            self.assertEqual(len(sent["code"]), 6)
            self.assertTrue(sent["code"].isdigit())

            status, result = self.request(
                "POST",
                "/api/verify-email",
                {"email": "mongo-verified-reader@example.com", "code": sent["code"]},
            )
            self.assertEqual(status, 201)
            self.assertEqual(result["user"]["email"], "mongo-verified-reader@example.com")
            status, result = self.request("GET", "/api/me")
            self.assertEqual(status, 200)
            self.assertEqual(result["user"]["email"], "mongo-verified-reader@example.com")
        finally:
            server.MONGODB_URI = original_uri
            server.GMAIL_SCRIPT_URL = original_script_url
            server.GMAIL_SCRIPT_SECRET = original_script_secret
            server.send_verification_email = original_sender
            server._MONGO_CLIENTS.pop(uri, None)
            client.close()

    def test_static_site_is_served_by_the_application_server(self):
        request = Request(self.base_url + "/", method="GET")
        with self.client.open(request) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("Biblio", response.read().decode("utf-8"))
        for path in ("/catalog", "/authors", "/club", "/games/dnd", "/games/dnd/play", "/library", "/settings"):
            with self.subTest(path=path), self.client.open(self.base_url + path) as response:
                self.assertEqual(response.status, 200)
                page = response.read().decode("utf-8")
                self.assertIn('data-page-link="catalog"', page)
                self.assertIn('id="settings-page"', page)
        for path in ("/server.py", "/data/biblio.sqlite3"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                self.client.open(self.base_url + path)
            self.assertEqual(error.exception.code, 404)
            error.exception.close()


if __name__ == "__main__":
    unittest.main()
