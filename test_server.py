import http.cookiejar
import json
import sqlite3
import tempfile
import threading
import unittest
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

    def test_static_site_is_served_by_the_application_server(self):
        request = Request(self.base_url + "/", method="GET")
        with self.client.open(request) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("Biblio", response.read().decode("utf-8"))
        for path in ("/catalog", "/authors", "/club", "/library", "/settings"):
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
