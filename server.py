#!/usr/bin/env python3
"""Small application server for Biblio with SQLite and MongoDB storage."""

import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.cookies import CookieError
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("BIBLIO_DB_PATH", ROOT / "data" / "biblio.sqlite3"))
MONGODB_URI = os.environ.get("MONGODB_URI", "")
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "biblio")
SESSION_COOKIE = "biblio_session"
SESSION_SECONDS = 60 * 60 * 24 * 14
PASSWORD_ITERATIONS = 310_000
MAX_REQUEST_BYTES = 2_000_000
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$")
_MONGO_CLIENTS = {}
_MONGO_CLIENTS_LOCK = threading.Lock()


@contextmanager
def connect_db():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def get_mongo_database():
    if not MONGODB_URI:
        raise RuntimeError("MONGODB_URI is required to use MongoDB.")
    with _MONGO_CLIENTS_LOCK:
        client = _MONGO_CLIENTS.get(MONGODB_URI)
        if client is None:
            client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
            _MONGO_CLIENTS[MONGODB_URI] = client
    return client[MONGODB_DATABASE]


def next_mongo_id(db, collection):
    counter = db.counters.find_one_and_update(
        {"_id": collection},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return counter["value"]


def utc_timestamp():
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def initialize_db():
    if MONGODB_URI:
        db = get_mongo_database()
        db.users.create_index([("id", ASCENDING)], unique=True)
        db.users.create_index([("email", ASCENDING)], unique=True)
        db.books.create_index([("id", ASCENDING)], unique=True)
        db.books.create_index([("status", ASCENDING), ("updated_at", DESCENDING), ("id", DESCENDING)])
        db.books.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING), ("id", DESCENDING)])
        db.sessions.create_index([("token_hash", ASCENDING)], unique=True)
        db.sessions.create_index([("expires_at", ASCENDING)])
        db.newsletter_subscribers.create_index([("email", ASCENDING)], unique=True)
        db.book_ratings.create_index(
            [("book_id", ASCENDING), ("user_id", ASCENDING)], unique=True
        )
        for collection in ("users", "books"):
            maximum = db[collection].find_one(sort=[("id", DESCENDING)])
            db.counters.update_one(
                {"_id": collection},
                {"$setOnInsert": {"value": maximum["id"] if maximum else 0}},
                upsert=True,
            )
        return
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY,
                owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                genre TEXT NOT NULL,
                age_rating TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                language TEXT NOT NULL DEFAULT 'Русский',
                tags TEXT NOT NULL DEFAULT '[]',
                page_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX IF NOT EXISTS books_public_idx ON books(status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS books_owner_idx ON books(owner_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                UNIQUE(book_id, position)
            );
            CREATE TABLE IF NOT EXISTS newsletter_subscribers (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS book_ratings (
                id INTEGER PRIMARY KEY,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                UNIQUE(book_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS book_ratings_book_idx ON book_ratings(book_id);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(books)")}
        for name, declaration in (
            ("language", "TEXT NOT NULL DEFAULT 'Русский'"),
            ("tags", "TEXT NOT NULL DEFAULT '[]'"),
            ("page_count", "INTEGER NOT NULL DEFAULT 0"),
        ):
            if name not in columns:
                db.execute(f"ALTER TABLE books ADD COLUMN {name} {declaration}")
        db.execute(
            """
            UPDATE books
            SET page_count = MAX(
                1,
                (COALESCE(
                    (SELECT SUM(length(content)) FROM chapters WHERE chapters.book_id = books.id),
                    0
                ) + 1799) / 1800
            )
            WHERE page_count = 0 AND EXISTS (
                SELECT 1 FROM chapters WHERE chapters.book_id = books.id
            )
            """
        )


def password_digest(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password, encoded):
    try:
        salt_hex, digest_hex = encoded.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return hmac.compare_digest(actual, expected)


def public_user(row):
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
    }


def book_record(db, row, include_chapters=False):
    result = {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "title": row["title"],
        "author": row["author"],
        "genre": row["genre"],
        "age_rating": row["age_rating"],
        "description": row["description"],
        "language": row["language"],
        "tags": json.loads(row["tags"]),
        "page_count": row["page_count"],
        "rating": round(row["rating_avg"], 1) if "rating_avg" in row.keys() else 0,
        "rating_count": row["rating_count"] if "rating_count" in row.keys() else 0,
        "user_rating": row["user_rating"] if "user_rating" in row.keys() else 0,
        "chapter_count": row["chapter_count"] if "chapter_count" in row.keys() else 0,
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if include_chapters:
        chapters = db.execute(
            "SELECT id, position, title, content FROM chapters WHERE book_id = ? ORDER BY position",
            (row["id"],),
        ).fetchall()
        result["chapters"] = [dict(chapter) for chapter in chapters]
        result["chapter_count"] = len(chapters)
    return result


def mongo_book_record(db, book, include_chapters=False, user_id=None):
    ratings = list(db.book_ratings.find({"book_id": book["id"]}, {"_id": 0, "rating": 1, "user_id": 1}))
    count = len(ratings)
    average = round(sum(item["rating"] for item in ratings) / count, 1) if count else 0
    own_rating = next(
        (item["rating"] for item in ratings if item["user_id"] == user_id), 0
    )
    chapters = book.get("chapters", [])
    result = {
        "id": book["id"],
        "owner_id": book["owner_id"],
        "title": book["title"],
        "author": book["author"],
        "genre": book["genre"],
        "age_rating": book["age_rating"],
        "description": book.get("description", ""),
        "language": book.get("language", "Русский"),
        "tags": book.get("tags", []),
        "page_count": book.get("page_count", 0),
        "rating": average,
        "rating_count": count,
        "user_rating": own_rating,
        "chapter_count": len(chapters),
        "status": book["status"],
        "created_at": book["created_at"],
        "updated_at": book["updated_at"],
    }
    if include_chapters:
        result["chapters"] = [
            {key: chapter[key] for key in ("id", "position", "title", "content")}
            for chapter in chapters
        ]
    return result


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class BiblioHandler(BaseHTTPRequestHandler):
    server_version = "Biblio/1.0"

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise APIError(HTTPStatus.BAD_REQUEST, "Некорректный размер запроса.") from exc
        if length < 0 or length > MAX_REQUEST_BYTES:
            raise APIError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Запрос слишком большой.")
        if length == 0:
            raise APIError(HTTPStatus.BAD_REQUEST, "Пустой запрос.")
        try:
            data = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise APIError(HTTPStatus.BAD_REQUEST, "Некорректный JSON.") from exc
        if not isinstance(data, dict):
            raise APIError(HTTPStatus.BAD_REQUEST, "Ожидался JSON-объект.")
        return data

    def check_origin(self):
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.netloc != self.headers.get("Host") or parsed.scheme not in ("http", "https"):
                raise APIError(HTTPStatus.FORBIDDEN, "Запрос с другого сайта запрещён.")

    def cookie_headers(self, token, max_age):
        value = f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
        if self.headers.get("X-Forwarded-Proto") == "https":
            value += "; Secure"
        return [("Set-Cookie", value)]

    def current_user(self, db, required=False):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            cookie = SimpleCookie()
        morsel = cookie.get(SESSION_COOKIE)
        if morsel is None:
            if required:
                raise APIError(HTTPStatus.UNAUTHORIZED, "Войди в аккаунт, чтобы продолжить.")
            return None
        token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
        row = db.execute(
            """
            SELECT users.* FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, int(time.time())),
        ).fetchone()
        if row is None:
            if required:
                raise APIError(HTTPStatus.UNAUTHORIZED, "Сессия истекла. Войди снова.")
            return None
        return row

    def current_user_mongo(self, db, required=False):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            cookie = SimpleCookie()
        morsel = cookie.get(SESSION_COOKIE)
        if morsel is None:
            if required:
                raise APIError(HTTPStatus.UNAUTHORIZED, "Войди в аккаунт, чтобы продолжить.")
            return None
        token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
        session = db.sessions.find_one(
            {"token_hash": token_hash, "expires_at": {"$gt": int(time.time())}}
        )
        user = db.users.find_one({"id": session["user_id"]}) if session else None
        if user is None:
            if required:
                raise APIError(HTTPStatus.UNAUTHORIZED, "Сессия истекла. Войди снова.")
            return None
        return user

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            self.handle_api("GET", path)
        else:
            self.serve_static(path)

    def do_POST(self):
        self.handle_api("POST", urlsplit(self.path).path)

    def do_PUT(self):
        self.handle_api("PUT", urlsplit(self.path).path)

    def do_PATCH(self):
        self.handle_api("PATCH", urlsplit(self.path).path)

    def do_DELETE(self):
        self.handle_api("DELETE", urlsplit(self.path).path)

    def handle_api(self, method, path):
        if not path.startswith("/api/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден."})
            return
        try:
            if method in ("POST", "PUT", "PATCH", "DELETE"):
                self.check_origin()
            if MONGODB_URI:
                db = get_mongo_database()
                result, status, headers = self.dispatch_mongo_api(db, method, path)
            else:
                with connect_db() as db:
                    result, status, headers = self.dispatch_api(db, method, path)
            self.send_json(status, result, headers)
        except APIError as exc:
            self.send_json(exc.status, {"error": exc.message})
        except DuplicateKeyError as exc:
            message = "Этот адрес электронной почты уже зарегистрирован."
            if path == "/api/newsletter":
                message = "Этот email уже подписан на рассылку."
            elif re.fullmatch(r"/api/books", path):
                message = "Не удалось сохранить книгу."
            self.send_json(HTTPStatus.CONFLICT, {"error": message})
        except sqlite3.IntegrityError as exc:
            message = "Этот адрес электронной почты уже зарегистрирован."
            if "books.owner_id" in str(exc):
                message = "Не удалось сохранить книгу."
            elif "newsletter_subscribers.email" in str(exc):
                message = "Этот email уже подписан на рассылку."
            self.send_json(HTTPStatus.CONFLICT, {"error": message})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            print(f"API error on {method} {path}: {exc}")
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Внутренняя ошибка сервера."},
            )

    def create_mongo_session(self, db, user_id):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        expires_at = int(time.time()) + SESSION_SECONDS
        db.sessions.delete_many({"expires_at": {"$lte": int(time.time())}})
        db.sessions.insert_one(
            {"token_hash": token_hash, "user_id": user_id, "expires_at": expires_at}
        )
        return self.cookie_headers(token, SESSION_SECONDS)

    @staticmethod
    def mongo_book_document(user_id, book, book_id=None):
        now = utc_timestamp()
        chapters = [
            {
                "id": position,
                "position": position,
                "title": chapter["title"],
                "content": chapter["content"],
            }
            for position, chapter in enumerate(book["chapters"], start=1)
        ]
        page_total = sum(len(chapter["content"]) for chapter in chapters)
        document = {
            "owner_id": user_id,
            "title": book["title"],
            "author": book["author"],
            "genre": book["genre"],
            "age_rating": book["age_rating"],
            "description": book["description"],
            "language": book["language"],
            "tags": book["tags"],
            "page_count": max(1, (page_total + 1799) // 1800) if page_total else 0,
            "chapters": chapters,
            "status": book["status"],
            "updated_at": now,
        }
        if book_id is not None:
            document["id"] = book_id
            document["created_at"] = now
        return document

    def dispatch_mongo_api(self, db, method, path):
        if method == "GET" and path == "/api/me":
            user = self.current_user_mongo(db)
            return {"user": public_user(user) if user else None}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/stats":
            return {"registered_accounts": db.users.count_documents({})}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/books":
            books = db.books.find({"status": "published"}).sort(
                [("updated_at", DESCENDING), ("id", DESCENDING)]
            )
            return {
                "books": [mongo_book_record(db, book) for book in books]
            }, HTTPStatus.OK, []

        book_match = re.fullmatch(r"/api/books/(\d+)", path)
        if method == "GET" and book_match:
            book = db.books.find_one(
                {"id": int(book_match.group(1)), "status": "published"}
            )
            if book is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Книга не найдена в каталоге.")
            user = self.current_user_mongo(db)
            return {
                "book": mongo_book_record(
                    db, book, include_chapters=True, user_id=user["id"] if user else None
                )
            }, HTTPStatus.OK, []

        rating_match = re.fullmatch(r"/api/books/(\d+)/rating", path)
        if method == "POST" and rating_match:
            user = self.current_user_mongo(db, required=True)
            book_id = int(rating_match.group(1))
            book = db.books.find_one(
                {"id": book_id, "status": "published"}, {"owner_id": 1}
            )
            if book is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Книга не найдена в каталоге.")
            if book["owner_id"] == user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Нельзя оценивать собственную книгу.")
            rating = self.read_json().get("rating")
            if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
                raise APIError(HTTPStatus.BAD_REQUEST, "Оценка должна быть от 1 до 5.")
            db.book_ratings.update_one(
                {"book_id": book_id, "user_id": user["id"]},
                {
                    "$set": {"rating": rating, "created_at": utc_timestamp()},
                    "$setOnInsert": {"book_id": book_id, "user_id": user["id"]},
                },
                upsert=True,
            )
            ratings = list(db.book_ratings.find({"book_id": book_id}, {"rating": 1}))
            average = round(sum(item["rating"] for item in ratings) / len(ratings), 1)
            return {
                "rating": average,
                "rating_count": len(ratings),
                "user_rating": rating,
            }, HTTPStatus.OK, []

        if method == "POST" and path == "/api/newsletter":
            email = self.valid_email(self.read_json().get("email"))
            db.newsletter_subscribers.insert_one(
                {"email": email, "created_at": utc_timestamp()}
            )
            return {"ok": True}, HTTPStatus.CREATED, []

        if method == "POST" and path == "/api/register":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            display_name = self.valid_text(data.get("display_name"), "Имя", 1, 60)
            password = self.valid_password(data.get("password"))
            user = {
                "id": next_mongo_id(db, "users"),
                "email": email,
                "display_name": display_name,
                "password_hash": password_digest(password),
                "created_at": utc_timestamp(),
            }
            db.users.insert_one(user)
            headers = self.create_mongo_session(db, user["id"])
            return {"user": public_user(user)}, HTTPStatus.CREATED, headers

        if method == "POST" and path == "/api/login":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            password = data.get("password")
            if not isinstance(password, str) or not 1 <= len(password) <= 256:
                raise APIError(HTTPStatus.BAD_REQUEST, "Проверь email и пароль.")
            user = db.users.find_one({"email": email})
            if user is None or not verify_password(password, user["password_hash"]):
                raise APIError(HTTPStatus.UNAUTHORIZED, "Неверный email или пароль.")
            headers = self.create_mongo_session(db, user["id"])
            return {"user": public_user(user)}, HTTPStatus.OK, headers

        if method == "POST" and path == "/api/logout":
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get("Cookie", ""))
            except CookieError:
                cookie = SimpleCookie()
            morsel = cookie.get(SESSION_COOKIE)
            if morsel:
                token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
                db.sessions.delete_one({"token_hash": token_hash})
            return {"ok": True}, HTTPStatus.OK, self.cookie_headers("", 0)

        if method == "GET" and path == "/api/my/books":
            user = self.current_user_mongo(db, required=True)
            books = db.books.find({"owner_id": user["id"]}).sort(
                [("updated_at", DESCENDING), ("id", DESCENDING)]
            )
            return {
                "books": [
                    mongo_book_record(db, book, include_chapters=True) for book in books
                ]
            }, HTTPStatus.OK, []

        if method == "POST" and path == "/api/books":
            user = self.current_user_mongo(db, required=True)
            book = self.valid_book(self.read_json())
            book_id = next_mongo_id(db, "books")
            document = self.mongo_book_document(user["id"], book, book_id)
            db.books.insert_one(document)
            return {
                "book": mongo_book_record(db, document, include_chapters=True)
            }, HTTPStatus.CREATED, []

        if book_match and method in ("PUT", "DELETE"):
            user = self.current_user_mongo(db, required=True)
            book_id = int(book_match.group(1))
            selector = {"id": book_id, "owner_id": user["id"]}
            existing = db.books.find_one(selector)
            if existing is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Книга не найдена.")
            if method == "DELETE":
                db.books.delete_one(selector)
                db.book_ratings.delete_many({"book_id": book_id})
                return {"ok": True}, HTTPStatus.OK, []
            book = self.valid_book(self.read_json())
            document = self.mongo_book_document(user["id"], book)
            document["created_at"] = existing["created_at"]
            db.books.update_one(selector, {"$set": document})
            updated = db.books.find_one(selector)
            return {
                "book": mongo_book_record(db, updated, include_chapters=True)
            }, HTTPStatus.OK, []

        if method == "PATCH" and path == "/api/account":
            user = self.current_user_mongo(db, required=True)
            data = self.read_json()
            display_name = self.valid_text(data.get("display_name"), "Имя", 1, 60)
            email = self.valid_email(data.get("email"))
            current_password = data.get("current_password", "")
            email_changed = email != user["email"].lower()
            if email_changed and (
                not isinstance(current_password, str)
                or not verify_password(current_password, user["password_hash"])
            ):
                raise APIError(
                    HTTPStatus.UNAUTHORIZED,
                    "Для смены email введи текущий пароль.",
                )
            db.users.update_one(
                {"id": user["id"]},
                {"$set": {"display_name": display_name, "email": email}},
            )
            updated = db.users.find_one({"id": user["id"]})
            return {"user": public_user(updated)}, HTTPStatus.OK, []

        if method == "POST" and path == "/api/account/password":
            user = self.current_user_mongo(db, required=True)
            data = self.read_json()
            current = data.get("current_password")
            new_password = self.valid_password(data.get("new_password"))
            if not isinstance(current, str) or not verify_password(
                current, user["password_hash"]
            ):
                raise APIError(HTTPStatus.UNAUTHORIZED, "Текущий пароль введён неверно.")
            db.users.update_one(
                {"id": user["id"]},
                {"$set": {"password_hash": password_digest(new_password)}},
            )
            db.sessions.delete_many({"user_id": user["id"]})
            headers = self.create_mongo_session(db, user["id"])
            return {"ok": True}, HTTPStatus.OK, headers

        raise APIError(HTTPStatus.NOT_FOUND, "Маршрут не найден.")

    def dispatch_api(self, db, method, path):
        if method == "GET" and path == "/api/me":
            user = self.current_user(db)
            return {"user": public_user(user) if user else None}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/stats":
            count = db.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
            return {"registered_accounts": count}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/books":
            rows = db.execute(
                """
                SELECT books.*,
                    COALESCE((SELECT AVG(rating) FROM book_ratings WHERE book_id = books.id), 0)
                        AS rating_avg,
                    (SELECT COUNT(*) FROM book_ratings WHERE book_id = books.id) AS rating_count,
                    (SELECT COUNT(*) FROM chapters WHERE chapters.book_id = books.id) AS chapter_count
                FROM books
                WHERE status = 'published'
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
            return {
                "books": [book_record(db, row) for row in rows]
            }, HTTPStatus.OK, []

        book_match = re.fullmatch(r"/api/books/(\d+)", path)
        if method == "GET" and book_match:
            row = db.execute(
                """
                SELECT books.*,
                    COALESCE((SELECT AVG(rating) FROM book_ratings WHERE book_id = books.id), 0)
                        AS rating_avg,
                    (SELECT COUNT(*) FROM book_ratings WHERE book_id = books.id) AS rating_count
                FROM books
                WHERE id = ? AND status = 'published'
                """,
                (int(book_match.group(1)),),
            ).fetchone()
            if row is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Книга не найдена в каталоге.")
            user = self.current_user(db)
            if user:
                own_rating = db.execute(
                    "SELECT rating FROM book_ratings WHERE book_id = ? AND user_id = ?",
                    (row["id"], user["id"]),
                ).fetchone()
                row = dict(row)
                row["user_rating"] = own_rating["rating"] if own_rating else 0
            return {"book": book_record(db, row, include_chapters=True)}, HTTPStatus.OK, []

        rating_match = re.fullmatch(r"/api/books/(\d+)/rating", path)
        if method == "POST" and rating_match:
            user = self.current_user(db, required=True)
            book_id = int(rating_match.group(1))
            book = db.execute(
                "SELECT owner_id FROM books WHERE id = ? AND status = 'published'",
                (book_id,),
            ).fetchone()
            if book is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Книга не найдена в каталоге.")
            if book["owner_id"] == user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Нельзя оценивать собственную книгу.")
            data = self.read_json()
            rating = data.get("rating")
            if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
                raise APIError(HTTPStatus.BAD_REQUEST, "Оценка должна быть от 1 до 5.")
            db.execute(
                """
                INSERT INTO book_ratings (book_id, user_id, rating)
                VALUES (?, ?, ?)
                ON CONFLICT(book_id, user_id) DO UPDATE SET
                    rating = excluded.rating,
                    created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                """,
                (book_id, user["id"], rating),
            )
            result = db.execute(
                "SELECT ROUND(AVG(rating), 1) AS average, COUNT(*) AS count "
                "FROM book_ratings WHERE book_id = ?",
                (book_id,),
            ).fetchone()
            return {
                "rating": result["average"],
                "rating_count": result["count"],
                "user_rating": rating,
            }, HTTPStatus.OK, []

        if method == "POST" and path == "/api/newsletter":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            db.execute("INSERT INTO newsletter_subscribers (email) VALUES (?)", (email,))
            return {"ok": True}, HTTPStatus.CREATED, []

        if method == "POST" and path == "/api/register":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            display_name = self.valid_text(data.get("display_name"), "Имя", 1, 60)
            password = self.valid_password(data.get("password"))
            encoded = password_digest(password)
            cursor = db.execute(
                "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)",
                (email, display_name, encoded),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
            headers = self.create_session(db, user["id"])
            return {"user": public_user(user)}, HTTPStatus.CREATED, headers

        if method == "POST" and path == "/api/login":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            password = data.get("password")
            if not isinstance(password, str) or not 1 <= len(password) <= 256:
                raise APIError(HTTPStatus.BAD_REQUEST, "Проверь email и пароль.")
            user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if user is None or not verify_password(password, user["password_hash"]):
                raise APIError(HTTPStatus.UNAUTHORIZED, "Неверный email или пароль.")
            headers = self.create_session(db, user["id"])
            return {"user": public_user(user)}, HTTPStatus.OK, headers

        if method == "POST" and path == "/api/logout":
            cookie = SimpleCookie()
            cookie.load(self.headers.get("Cookie", ""))
            morsel = cookie.get(SESSION_COOKIE)
            if morsel:
                token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            return {"ok": True}, HTTPStatus.OK, self.cookie_headers("", 0)

        if method == "GET" and path == "/api/my/books":
            user = self.current_user(db, required=True)
            rows = db.execute(
                "SELECT * FROM books WHERE owner_id = ? ORDER BY updated_at DESC, id DESC",
                (user["id"],),
            ).fetchall()
            return {
                "books": [book_record(db, row, include_chapters=True) for row in rows]
            }, HTTPStatus.OK, []

        if method == "POST" and path == "/api/books":
            user = self.current_user(db, required=True)
            book = self.valid_book(self.read_json())
            cursor = db.execute(
                """
                INSERT INTO books (
                    owner_id, title, author, genre, age_rating, description, language, tags, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    book["title"],
                    book["author"],
                    book["genre"],
                    book["age_rating"],
                    book["description"],
                    book["language"],
                    json.dumps(book["tags"], ensure_ascii=False),
                    book["status"],
                ),
            )
            book_id = cursor.lastrowid
            self.save_chapters(db, book_id, book["chapters"])
            row = db.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
            return {"book": book_record(db, row, include_chapters=True)}, HTTPStatus.CREATED, []

        match = re.fullmatch(r"/api/books/(\d+)", path)
        if match and method in ("PUT", "DELETE"):
            user = self.current_user(db, required=True)
            book_id = int(match.group(1))
            row = db.execute(
                "SELECT * FROM books WHERE id = ? AND owner_id = ?",
                (book_id, user["id"]),
            ).fetchone()
            if row is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Книга не найдена.")
            if method == "DELETE":
                db.execute("DELETE FROM books WHERE id = ?", (book_id,))
                return {"ok": True}, HTTPStatus.OK, []
            book = self.valid_book(self.read_json())
            db.execute(
                """
                UPDATE books
                SET title = ?, author = ?, genre = ?, age_rating = ?, description = ?,
                    language = ?, tags = ?, status = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ? AND owner_id = ?
                """,
                (
                    book["title"],
                    book["author"],
                    book["genre"],
                    book["age_rating"],
                    book["description"],
                    book["language"],
                    json.dumps(book["tags"], ensure_ascii=False),
                    book["status"],
                    book_id,
                    user["id"],
                ),
            )
            self.save_chapters(db, book_id, book["chapters"])
            updated = db.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
            return {"book": book_record(db, updated, include_chapters=True)}, HTTPStatus.OK, []

        if method == "PATCH" and path == "/api/account":
            user = self.current_user(db, required=True)
            data = self.read_json()
            display_name = self.valid_text(data.get("display_name"), "Имя", 1, 60)
            email = self.valid_email(data.get("email"))
            current_password = data.get("current_password", "")
            email_changed = email != user["email"].lower()
            if email_changed and (
                not isinstance(current_password, str)
                or not verify_password(current_password, user["password_hash"])
            ):
                raise APIError(
                    HTTPStatus.UNAUTHORIZED,
                    "Для смены email введи текущий пароль.",
                )
            db.execute(
                "UPDATE users SET display_name = ?, email = ? WHERE id = ?",
                (display_name, email, user["id"]),
            )
            updated = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            return {"user": public_user(updated)}, HTTPStatus.OK, []

        if method == "POST" and path == "/api/account/password":
            user = self.current_user(db, required=True)
            data = self.read_json()
            current = data.get("current_password")
            new_password = self.valid_password(data.get("new_password"))
            if not isinstance(current, str) or not verify_password(
                current, user["password_hash"]
            ):
                raise APIError(HTTPStatus.UNAUTHORIZED, "Текущий пароль введён неверно.")
            db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (password_digest(new_password), user["id"]),
            )
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
            headers = self.create_session(db, user["id"])
            return {"ok": True}, HTTPStatus.OK, headers

        raise APIError(HTTPStatus.NOT_FOUND, "Маршрут не найден.")

    def create_session(self, db, user_id):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        expires_at = int(time.time()) + SESSION_SECONDS
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        db.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash, user_id, expires_at),
        )
        return self.cookie_headers(token, SESSION_SECONDS)

    @staticmethod
    def valid_text(value, label, minimum, maximum):
        if not isinstance(value, str):
            raise APIError(HTTPStatus.BAD_REQUEST, f"Заполни поле «{label}».")
        value = value.strip()
        if not minimum <= len(value) <= maximum:
            raise APIError(
                HTTPStatus.BAD_REQUEST,
                f"Поле «{label}» должно содержать от {minimum} до {maximum} символов.",
            )
        return value

    @staticmethod
    def valid_email(value):
        if not isinstance(value, str):
            raise APIError(HTTPStatus.BAD_REQUEST, "Укажи корректный email.")
        email = value.strip().lower()
        if len(email) > 254 or not EMAIL_RE.fullmatch(email):
            raise APIError(HTTPStatus.BAD_REQUEST, "Укажи корректный email.")
        return email

    @staticmethod
    def valid_password(value):
        if not isinstance(value, str) or not 8 <= len(value) <= 256:
            raise APIError(
                HTTPStatus.BAD_REQUEST,
                "Пароль должен содержать от 8 до 256 символов.",
            )
        return value

    def valid_book(self, data):
        title = self.valid_text(data.get("title"), "Название", 1, 160)
        author = self.valid_text(data.get("author"), "Автор", 1, 120)
        genre = self.valid_text(data.get("genre"), "Жанр", 1, 60)
        age_rating = self.valid_text(data.get("age_rating"), "Возрастной рейтинг", 1, 10)
        description = data.get("description", "")
        if not isinstance(description, str) or len(description) > 5000:
            raise APIError(
                HTTPStatus.BAD_REQUEST, "Описание не должно превышать 5000 символов."
            )
        description = description.strip()
        language = self.valid_text(
            data.get("language", "Русский"), "Язык", 1, 40
        )
        tags = data.get("tags", [])
        if isinstance(tags, str):
            tags = tags.split(",")
        if not isinstance(tags, list) or len(tags) > 20:
            raise APIError(HTTPStatus.BAD_REQUEST, "Укажи не более 20 тегов.")
        clean_tags = []
        for tag in tags:
            clean_tag = self.valid_text(tag, "Тег", 1, 30)
            if clean_tag.casefold() not in {item.casefold() for item in clean_tags}:
                clean_tags.append(clean_tag)
        status = data.get("status")
        if status not in ("draft", "published"):
            raise APIError(HTTPStatus.BAD_REQUEST, "Выбери черновик или публикацию.")
        chapters = data.get("chapters", [])
        if not isinstance(chapters, list) or len(chapters) > 100:
            raise APIError(HTTPStatus.BAD_REQUEST, "В книге может быть не более 100 глав.")
        valid_chapters = []
        total_content_length = 0
        for index, chapter in enumerate(chapters):
            if not isinstance(chapter, dict):
                raise APIError(HTTPStatus.BAD_REQUEST, "Проверь список глав.")
            chapter_title = self.valid_text(
                chapter.get("title"), f"Название главы {index + 1}", 1, 160
            )
            content = chapter.get("content", "")
            if not isinstance(content, str) or len(content) > 200_000:
                raise APIError(
                    HTTPStatus.BAD_REQUEST, "Текст главы не должен превышать 200 000 символов."
                )
            total_content_length += len(content)
            if total_content_length > 1_500_000:
                raise APIError(
                    HTTPStatus.BAD_REQUEST, "Общий размер текста глав слишком большой."
                )
            valid_chapters.append({"title": chapter_title, "content": content})
        if status == "published":
            if not any(chapter["content"].strip() for chapter in valid_chapters):
                raise APIError(
                    HTTPStatus.BAD_REQUEST,
                    "Добавь хотя бы одну главу с текстом, чтобы опубликовать книгу.",
                )
            if any(not chapter["content"].strip() for chapter in valid_chapters):
                raise APIError(
                    HTTPStatus.BAD_REQUEST,
                    "Заполни или удали пустые главы перед публикацией.",
                )
        return {
            "title": title,
            "author": author,
            "genre": genre,
            "age_rating": age_rating,
            "description": description,
            "language": language,
            "tags": clean_tags,
            "status": status,
            "chapters": valid_chapters,
        }

    @staticmethod
    def save_chapters(db, book_id, chapters):
        db.execute("DELETE FROM chapters WHERE book_id = ?", (book_id,))
        db.executemany(
            "INSERT INTO chapters (book_id, position, title, content) VALUES (?, ?, ?, ?)",
            [
                (book_id, position, chapter["title"], chapter["content"])
                for position, chapter in enumerate(chapters, start=1)
            ],
        )
        total_characters = sum(len(chapter["content"]) for chapter in chapters)
        pages = (total_characters + 1799) // 1800
        db.execute("UPDATE books SET page_count = ? WHERE id = ?", (pages, book_id))

    def serve_static(self, request_path):
        path = unquote(request_path)
        if path in ("", "/"):
            path = "/index.html"
        candidate = (ROOT / path.lstrip("/")).resolve()
        if not candidate.is_file() and path.rstrip("/") in {
            "/catalog",
            "/authors",
            "/club",
            "/library",
            "/settings",
        }:
            candidate = ROOT / "index.html"
        if not candidate.is_relative_to(ROOT) or not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if any(part.startswith(".") for part in candidate.relative_to(ROOT).parts):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if candidate.suffix not in {".html", ".css", ".js", ".svg"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(candidate.suffix, "application/octet-stream")
        body = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def main():
    initialize_db()
    host = os.environ.get("BIBLIO_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), BiblioHandler)
    print(f"Biblio is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Biblio.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
