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
import urllib.request
import urllib.error
from contextlib import contextmanager
from http.cookies import CookieError
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

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
GMAIL_SCRIPT_URL = os.environ.get("GMAIL_SCRIPT_URL", "").strip()
GMAIL_SCRIPT_SECRET = os.environ.get("GMAIL_SCRIPT_SECRET", "").strip()
EMAIL_CODE_TTL = 600
EMAIL_CODE_MAX_ATTEMPTS = 5
GAME_CATALOG_SEED = (
    {
        "slug": "dnd",
        "title": "Dungeons & Dragons",
        "description": (
            "Dungeons & Dragons — настольная ролевая игра, в которой участники вместе "
            "рассказывают историю о приключениях в фэнтезийном мире. Каждый игрок "
            "создаёт героя: выбирает происхождение, класс, способности и собственный "
            "путь, а ведущий описывает мир, играет за его обитателей и задаёт события "
            "кампании. Решения героев определяют, куда повернёт история, а исход "
            "рискованных действий часто решается броском двадцатигранного кубика и "
            "характеристиками персонажа. Партия может быть исследованием древних "
            "руин, дипломатией, расследованием или сражением — правила помогают "
            "сделать приключение общим, но главное в D&D — воображение, выбор и "
            "истории, которые игроки создают вместе."
        ),
        "cover_symbol": "D20",
        "cover_theme": "fantasy",
    },
    {
        "slug": "bunker-online",
        "title": "BunkerOnline",
        "description": (
            "Социальная игра о выживании после глобальной катастрофы. Создавай сценарий, "
            "раскрывай досье участников, обсуждай кризисы, запускай события и голосуй "
            "за тех, кто покинет убежище. Включает таймер, локальный чат, достижения "
            "и несколько режимов сложности. Текущая версия сохраняет сессию в браузере."
        ),
        "cover_symbol": "☢",
        "cover_theme": "bunker",
    },
)
GAME_CATALOG_PRESENCE_SECONDS = 45

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
        db.pending_email_verifications.create_index([("email", ASCENDING)], unique=True)
        db.pending_email_verifications.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
        db.newsletter_subscribers.create_index([("email", ASCENDING)], unique=True)
        db.games.create_index([("id", ASCENDING)], unique=True)
        db.games.create_index([("access", ASCENDING), ("updated_at", DESCENDING), ("id", DESCENDING)])
        db.games.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING), ("id", DESCENDING)])
        db.game_participants.create_index([("game_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
        db.book_ratings.create_index(
            [("book_id", ASCENDING), ("user_id", ASCENDING)], unique=True
        )
        db.game_catalog.create_index([("slug", ASCENDING)], unique=True)
        db.game_catalog_ratings.create_index(
            [("game_slug", ASCENDING), ("user_id", ASCENDING)], unique=True
        )
        db.game_catalog_presence.create_index(
            [("game_slug", ASCENDING), ("viewer_token", ASCENDING)], unique=True
        )
        db.game_catalog_presence.create_index([("expires_at", ASCENDING)])
        for game in GAME_CATALOG_SEED:
            db.game_catalog.update_one(
                {"slug": game["slug"]},
                {
                    "$set": {"description": game["description"]},
                    "$setOnInsert": {
                        key: value for key, value in game.items() if key != "description"
                    },
                },
                upsert=True,
            )
        db.games.update_many(
            {"catalog_game_slug": {"$exists": False}},
            {"$set": {"catalog_game_slug": "dnd"}},
        )
        for collection in ("users", "books", "games", "game_participants", "game_characters", "game_sessions", "xp_history"):
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
            CREATE TABLE IF NOT EXISTS pending_email_verifications (
                email TEXT PRIMARY KEY COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
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
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY,
                owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                room_name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                access TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'private', 'invite_only')),
                join_code TEXT NOT NULL DEFAULT '',
                combat_state TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS game_participants (
                id INTEGER PRIMARY KEY,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('gm', 'owner', 'player')),
                status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'removed')),
                joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                UNIQUE(game_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS game_catalog (
                slug TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                cover_symbol TEXT NOT NULL,
                cover_theme TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS game_catalog_ratings (
                id INTEGER PRIMARY KEY,
                game_slug TEXT NOT NULL REFERENCES game_catalog(slug) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                UNIQUE(game_slug, user_id)
            );
            CREATE TABLE IF NOT EXISTS game_catalog_presence (
                game_slug TEXT NOT NULL REFERENCES game_catalog(slug) ON DELETE CASCADE,
                viewer_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                PRIMARY KEY(game_slug, viewer_token)
            );
            CREATE TABLE IF NOT EXISTS game_characters (
                id INTEGER PRIMARY KEY,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                class_name TEXT NOT NULL DEFAULT '',
                archetype TEXT NOT NULL DEFAULT '',
                race TEXT NOT NULL DEFAULT '',
                level INTEGER NOT NULL DEFAULT 1,
                xp INTEGER NOT NULL DEFAULT 0,
                strength INTEGER NOT NULL DEFAULT 10,
                dexterity INTEGER NOT NULL DEFAULT 10,
                constitution INTEGER NOT NULL DEFAULT 10,
                intelligence INTEGER NOT NULL DEFAULT 10,
                wisdom INTEGER NOT NULL DEFAULT 10,
                charisma INTEGER NOT NULL DEFAULT 10,
                hp INTEGER NOT NULL DEFAULT 10,
                max_hp INTEGER NOT NULL DEFAULT 10,
                armor_class INTEGER NOT NULL DEFAULT 10,
                inventory TEXT NOT NULL DEFAULT '[]',
                spells TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                UNIQUE(game_id, user_id),
                UNIQUE(game_id, name)
            );
            CREATE TABLE IF NOT EXISTS game_sessions (
                id INTEGER PRIMARY KEY,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT '',
                xp_awarded INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS xp_history (
                id INTEGER PRIMARY KEY,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                amount INTEGER NOT NULL DEFAULT 0,
                reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX IF NOT EXISTS book_ratings_book_user_idx
            ON book_ratings(book_id, user_id);
            CREATE INDEX IF NOT EXISTS game_catalog_ratings_game_user_idx
            ON game_catalog_ratings(game_slug, user_id);
            CREATE INDEX IF NOT EXISTS game_catalog_presence_expires_idx
            ON game_catalog_presence(expires_at);
            CREATE INDEX IF NOT EXISTS books_status_updated_idx
            ON books(status, updated_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS books_owner_updated_idx
            ON books(owner_id, updated_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS chapters_book_position_idx
            ON chapters(book_id, position);
            CREATE INDEX IF NOT EXISTS games_access_updated_idx
            ON games(access, updated_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS game_participants_game_user_idx
            ON game_participants(game_id, user_id);
            CREATE INDEX IF NOT EXISTS game_characters_game_user_idx
            ON game_characters(game_id, user_id);
            CREATE INDEX IF NOT EXISTS game_sessions_game_idx
            ON game_sessions(game_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS xp_history_game_user_idx
            ON xp_history(game_id, user_id, created_at DESC);
            """
        )
        db.executemany(
            """
            INSERT INTO game_catalog
                (slug, title, description, cover_symbol, cover_theme)
            VALUES (:slug, :title, :description, :cover_symbol, :cover_theme)
            ON CONFLICT(slug) DO UPDATE SET description = excluded.description
            """,
            GAME_CATALOG_SEED,
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
        for name in ("bio", "avatar_url"):
            if name not in columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(books)")}
        for name, declaration in (
            ("language", "TEXT NOT NULL DEFAULT 'Русский'"),
            ("tags", "TEXT NOT NULL DEFAULT '[]'"),
            ("page_count", "INTEGER NOT NULL DEFAULT 0"),
        ):
            if name not in columns:
                db.execute(f"ALTER TABLE books ADD COLUMN {name} {declaration}")
        game_columns = {row["name"] for row in db.execute("PRAGMA table_info(games)")}
        if "catalog_game_slug" not in game_columns:
            db.execute("ALTER TABLE games ADD COLUMN catalog_game_slug TEXT REFERENCES game_catalog(slug)")
        character_columns = {row["name"] for row in db.execute("PRAGMA table_info(game_characters)")}
        for name in (
            "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
        ):
            if name not in character_columns:
                db.execute(f"ALTER TABLE game_characters ADD COLUMN {name} INTEGER NOT NULL DEFAULT 10")
        for name in ("hp", "max_hp", "armor_class"):
            if name not in character_columns:
                db.execute(f"ALTER TABLE game_characters ADD COLUMN {name} INTEGER NOT NULL DEFAULT 10")
        for name in ("inventory", "spells"):
            if name not in character_columns:
                db.execute(f"ALTER TABLE game_characters ADD COLUMN {name} TEXT NOT NULL DEFAULT '[]'")
        for name in ("spell_slots_max", "spell_slots"):
            if name not in character_columns:
                db.execute(f"ALTER TABLE game_characters ADD COLUMN {name} TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0]'")
        game_columns = {row["name"] for row in db.execute("PRAGMA table_info(games)").fetchall()}
        if "combat_state" not in game_columns:
            db.execute("ALTER TABLE games ADD COLUMN combat_state TEXT NOT NULL DEFAULT '{}'")
        db.execute(
            "UPDATE games SET catalog_game_slug = 'dnd' WHERE catalog_game_slug IS NULL"
        )
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


def email_code_hash(email, code):
    secret = (
        os.environ.get("EMAIL_CODE_SECRET")
        or GMAIL_SCRIPT_SECRET
        or "biblio-email-verification-local-only"
    )
    message = (email.lower() + ":" + code).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def email_verification_enabled():
    value = os.environ.get("BIBLIO_EMAIL_VERIFICATION", "").strip().lower()
    return bool(GMAIL_SCRIPT_URL and GMAIL_SCRIPT_SECRET) or value in {"1", "true", "yes", "on"}


def send_verification_email(email, display_name, code):
    if not email_verification_enabled():
        return None
    if not GMAIL_SCRIPT_URL or not GMAIL_SCRIPT_SECRET:
        raise APIError(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Отправка писем не настроена: добавь GMAIL_SCRIPT_URL и GMAIL_SCRIPT_SECRET в Render.",
        )

    safe_name = (
        display_name.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    text_body = (
        f"Привет, {display_name}!\n\n"
        "Спасибо за регистрацию в Biblio. "
        f"Твой код подтверждения: {code}\n\n"
        "Код действует 10 минут. Если ты не регистрировался(-ась), "
        "проигнорируй это письмо.\n\nС теплом, команда Biblio"
    )
    html_body = (
        '<div style="max-width:520px;margin:24px auto;padding:36px;background:#fff;border:1px solid #e5e1d7;color:#29352c;font-family:Arial,sans-serif">'
        '<div style="font-size:13px;letter-spacing:4px;color:#6b806d;font-weight:bold">BIBLIO</div>'
        '<h1 style="font-family:Georgia,serif;font-weight:normal">Добро пожаловать!</h1>'
        f'<p>Привет, {safe_name}! Спасибо, что присоединился(-ась) к Biblio.</p>'
        '<p>Чтобы подтвердить адрес электронной почты, введи этот код:</p>'
        f'<div style="margin:26px 0;padding:20px;background:#f1f3ed;text-align:center;font-size:34px;letter-spacing:9px;font-weight:bold">{code}</div>'
        '<p>Код действует <b>10 минут</b>. Если ты не создавал(-а) аккаунт, проигнорируй письмо.</p>'
        '<p style="color:#788078;font-size:12px">С теплом, команда Biblio</p></div>'
    )
    payload = {
        "secret": GMAIL_SCRIPT_SECRET,
        "to": email,
        "name": display_name,
        "subject": "Подтверждение регистрации в Biblio",
        "text": text_body,
        "html": html_body,
    }
    request = urllib.request.Request(
        GMAIL_SCRIPT_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
        if not isinstance(result, dict) or not result.get("accepted"):
            raise ValueError("Mail relay did not confirm acceptance")
        return {"accepted": True}
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError) as error:
        print(f"Google Apps Script mail relay error: {type(error).__name__}", flush=True)
        raise APIError(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Не удалось отправить письмо через Gmail. Проверь настройки почтового сервиса и попробуй позже.",
        )

def public_user(row):
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "bio": row.get("bio", "") if isinstance(row, dict) else (row["bio"] if "bio" in row.keys() else ""),
        "avatar_url": row.get("avatar_url", "") if isinstance(row, dict) else (row["avatar_url"] if "avatar_url" in row.keys() else ""),
    }


def normalize_game_access(value):
    access = str(value or "public").strip().lower()
    if access in {"public", "open"}:
        return "public"
    if access in {"private", "restricted"}:
        return "private"
    if access in {"invite_only", "invite-only", "invite only", "closed"}:
        return "invite_only"
    return "public"


def normalize_game_owner_name(value):
    return " ".join(str(value or "").split()).casefold()


def calculate_character_level(xp):
    xp_total = max(0, int(xp or 0))
    return max(1, 1 + (xp_total // 100))


DND_CHARACTER_RACES = ["Человек","Эльф","Высший эльф","Лесной эльф","Дроу","Полуэльф","Дварф","Холмовой дварф","Горный дварф","Дуэргар","Халфлинг","Легконогий халфлинг","Коренастый халфлинг","Гном","Лесной гном","Скальный гном","Глубинный гном","Полуорк","Орк","Тифлинг","Аасимар","Драконорождённый","Гитъянки","Гитцерай","Табакси","Кенку","Ааракокра","Генази воздуха","Генази воды","Генази земли","Генази огня","Голиаф","Фирболг","Сатир","Кентавр","Минотавр","Леонин","Тритон","Локсодон","Ведалкен","Симик-гибрид","Калаштар","Перевёртыш","Шифтер","Варфорджед","Черепаха-тортл","Грунг","Харенгон","Аулин","Фея","Плазмоид","Автогном","Возрождённый","Дампир","Хексблад","Астральный эльф","Арлинг","Хобгоблин","Багбир","Кобольд","Гоблин","Юань-ти","Ящеролюд","Тэнгу","Огненный генази","Морской эльф","Эладрин","Морской полуэльф","Крылатый тифлинг","Сумеречный эльф"]

CHARACTER_STAT_RANGES = {
    "strength": (1, 30, 10),
    "dexterity": (1, 30, 10),
    "constitution": (1, 30, 10),
    "intelligence": (1, 30, 10),
    "wisdom": (1, 30, 10),
    "charisma": (1, 30, 10),
    "hp": (0, 999, 10),
    "max_hp": (1, 999, 10),
    "armor_class": (0, 99, 10),
}


def generate_random_character_stats():
    """Generate six D&D-style ability scores (4d6, drop the lowest) once per hero."""
    abilities = {}
    for field in ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"):
        dice = sorted((secrets.randbelow(6) + 1 for _ in range(4)), reverse=True)
        abilities[field] = sum(dice[:3])
    constitution_modifier = (abilities["constitution"] - 10) // 2
    hit_points = max(1, 10 + constitution_modifier)
    return {**abilities, "hp": hit_points, "max_hp": hit_points, "armor_class": 10}


def validate_dnd_race(value):
    race = " ".join(str(value or "").split())
    if race not in DND_CHARACTER_RACES:
        raise APIError(HTTPStatus.BAD_REQUEST, "Выбери одну из 70 доступных рас.")
    return race


def game_character_stats(payload, existing=None):
    stats = {}
    existing = existing or {}
    for field, (minimum, maximum, default) in CHARACTER_STAT_RANGES.items():
        value = payload.get(field, existing.get(field, default))
        if isinstance(value, bool):
            raise APIError(HTTPStatus.BAD_REQUEST, f"Параметр {field} должен быть целым числом.")
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise APIError(HTTPStatus.BAD_REQUEST, f"Параметр {field} должен быть целым числом.")
        if not minimum <= value <= maximum:
            raise APIError(HTTPStatus.BAD_REQUEST, f"Параметр {field} должен быть от {minimum} до {maximum}.")
        stats[field] = value
    if stats["hp"] > stats["max_hp"]:
        raise APIError(HTTPStatus.BAD_REQUEST, "Текущее здоровье не может быть выше максимального.")
    return stats


def game_record_row(game, user_id=None):
    name = (game.get("name") or game.get("title") or game.get("room_name") or "Новая комната").strip() or "Новая комната"
    title = (game.get("title") or game.get("name") or game.get("room_name") or name).strip() or name
    room_name = (game.get("room_name") or game.get("name") or game.get("title") or name).strip() or name
    result = {
        "id": game["id"],
        "owner_id": game.get("owner_id"),
        "name": name,
        "title": title,
        "room_name": room_name,
        "catalog_game_slug": game.get("catalog_game_slug", ""),
        "description": game.get("description", ""),
        "access": normalize_game_access(game.get("access", "public")),
        "join_code": game.get("join_code", "") or "",
        "created_at": game.get("created_at", utc_timestamp()),
        "updated_at": game.get("updated_at", utc_timestamp()),
    }
    if user_id is not None:
        result["is_member"] = bool(game.get("is_member") or False)
        result["is_owner"] = bool(game.get("is_owner") or False)
    result["member_count"] = int(game.get("member_count", 0) or 0)
    result["hero_count"] = int(game.get("hero_count", 0) or 0)
    result["participants"] = game.get("participants", []) or []
    result["heroes"] = game.get("heroes", []) or []
    result["sessions"] = game.get("sessions", []) or []
    result["combat"] = game.get("combat") or game.get("combat_state") or None
    return result


def game_catalog_record(game, rating=0, rating_count=0, active_viewers=0, user_rating=0):
    return {
        "slug": game["slug"],
        "title": game["title"],
        "description": game["description"],
        "cover_symbol": game["cover_symbol"],
        "cover_theme": game["cover_theme"],
        "rating": round(float(rating or 0), 1),
        "rating_count": int(rating_count or 0),
        "active_viewers": int(active_viewers or 0),
        "user_rating": int(user_rating or 0),
    }


def game_combat_transition(action, payload, heroes, existing=None):
    existing = existing or {}

    def record_event(state, message):
        events = list(state.get("events") or [])
        events.append({"message": message, "created_at": utc_timestamp()})
        state["events"] = events[-50:]
        state["updated_at"] = utc_timestamp()
        return state

    if action == "start":
        monsters = payload.get("monsters", [])
        if not isinstance(monsters, list) or len(monsters) > 12:
            raise APIError(HTTPStatus.BAD_REQUEST, "Можно добавить не более 12 противников.")
        combatants = []
        for hero in heroes:
            dexterity = int(hero.get("dexterity", 10) or 10)
            combatants.append({
                "id": f"hero-{hero['user_id']}", "name": hero.get("name") or "Герой",
                "kind": "hero", "user_id": hero["user_id"],
                "initiative": secrets.randbelow(20) + 1 + (dexterity - 10) // 2,
                "hp": int(hero.get("hp", 10) or 0), "max_hp": int(hero.get("max_hp", 10) or 10),
                "armor_class": int(hero.get("armor_class", 10) or 10),
            })
        for index, raw in enumerate(monsters):
            if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > 100:
                raise APIError(HTTPStatus.BAD_REQUEST, "Строка противника должна содержать от 1 до 100 символов.")
            parts = [part.strip() for part in raw.split("|")]
            if len(parts) > 4 or not parts[0]:
                raise APIError(HTTPStatus.BAD_REQUEST, "Формат противника: Имя | инициатива | HP.")
            name = parts[0]
            initiative = None
            if len(parts) > 1 and parts[1]:
                try:
                    initiative = int(parts[1])
                except ValueError:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Инициатива противника должна быть целым числом.")
                if not -20 <= initiative <= 40:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Инициатива должна быть от -20 до 40.")
            hp = max_hp = None
            if len(parts) > 2 and parts[2]:
                hp_match = re.fullmatch(r"(\d{1,5})(?:\s*/\s*(\d{1,5}))?", parts[2])
                if not hp_match:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Здоровье укажи числом или в формате 7/10.")
                hp = int(hp_match.group(1))
                max_hp = int(hp_match.group(2) or hp)
                if not 1 <= hp <= max_hp <= 10000:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Здоровье должно быть от 1 до 10000, текущее HP не выше максимального.")
            armor_class = 10
            if len(parts) > 3 and parts[3]:
                try:
                    armor_class = int(parts[3])
                except ValueError:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Класс брони противника должен быть целым числом.")
                if not 1 <= armor_class <= 30:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Класс брони должен быть от 1 до 30.")
            combatants.append({
                "id": f"monster-{index}-{secrets.token_hex(3)}", "name": name,
                "kind": "monster", "initiative": initiative if initiative is not None else secrets.randbelow(20) + 1,
                "hp": hp, "max_hp": max_hp, "armor_class": armor_class,
            })
        if not combatants:
            raise APIError(HTTPStatus.BAD_REQUEST, "Нужен хотя бы один герой или противник для начала боя.")
        combatants.sort(key=lambda item: (-item["initiative"], item["name"].casefold()))
        state = {"active": True, "round": 1, "current_index": 0, "combatants": combatants, "events": []}
        return record_event(state, "Бой начался. Инициатива определена.")
    if action == "next":
        if not existing.get("active") or not existing.get("combatants"):
            raise APIError(HTTPStatus.CONFLICT, "Сейчас нет активного боя.")
        combatants = existing["combatants"]
        index = int(existing.get("current_index", 0)) + 1
        round_number = int(existing.get("round", 1))
        if index >= len(combatants):
            index = 0
            round_number += 1
        state = {**existing, "round": round_number, "current_index": index}
        return record_event(state, f"Раунд {round_number}: ходит {combatants[index]['name']}.")
    if action in ("damage", "heal"):
        if not existing.get("active"):
            raise APIError(HTTPStatus.CONFLICT, "Сейчас нет активного боя.")
        target_id = str(payload.get("target_id") or "")
        try:
            amount = int(payload.get("amount", 0))
        except (TypeError, ValueError):
            amount = 0
        if not 1 <= amount <= 1000:
            raise APIError(HTTPStatus.BAD_REQUEST, "Значение должно быть от 1 до 1000.")
        combatants = [dict(item) for item in existing.get("combatants", [])]
        target = next((item for item in combatants if item.get("id") == target_id), None)
        if target is None:
            raise APIError(HTTPStatus.NOT_FOUND, "Участник боя не найден.")
        if target.get("hp") is None or target.get("max_hp") is None:
            raise APIError(HTTPStatus.CONFLICT, "Для этого участника не задано здоровье.")
        before = int(target["hp"])
        after = max(0, before - amount) if action == "damage" else min(int(target["max_hp"]), before + amount)
        target["hp"] = after
        state = {**existing, "combatants": combatants}
        delta = abs(after - before)
        verb = "получил урон" if action == "damage" else "восстановил здоровье"
        suffix = " · без сознания" if target["kind"] == "hero" and after == 0 else ""
        return record_event(state, f"{target['name']} {verb}: {delta} HP ({after}/{target['max_hp']}){suffix}.")
    if action == "attack":
        if not existing.get("active"):
            raise APIError(HTTPStatus.CONFLICT, "Сейчас нет активного боя.")
        fighters = [dict(item) for item in existing.get("combatants", [])]
        attacker_id = str(payload.get("attacker_id") or "")
        target_id = str(payload.get("target_id") or "")
        attacker = next((item for item in fighters if item.get("id") == attacker_id), None)
        target = next((item for item in fighters if item.get("id") == target_id), None)
        if attacker is None or target is None or attacker_id == target_id:
            raise APIError(HTTPStatus.BAD_REQUEST, "Выбери разных участников для атаки.")
        try:
            bonus = int(payload.get("attack_bonus", 0))
            damage = int(payload.get("damage", 0))
        except (TypeError, ValueError):
            raise APIError(HTTPStatus.BAD_REQUEST, "Бонус атаки и урон должны быть целыми числами.")
        if not -20 <= bonus <= 30 or not 1 <= damage <= 1000:
            raise APIError(HTTPStatus.BAD_REQUEST, "Бонус атаки должен быть от -20 до 30, урон — от 1 до 1000.")
        roll = secrets.randbelow(20) + 1
        total = roll + bonus
        armor_class = int(target.get("armor_class", 10) or 10)
        hit = roll == 20 or (roll != 1 and total >= armor_class)
        if hit and target.get("hp") is not None:
            applied_damage = damage * (2 if roll == 20 else 1)
            before = int(target["hp"])
            target["hp"] = max(0, before - applied_damage)
            actual_damage = before - target["hp"]
        else:
            actual_damage = 0
        state = {**existing, "combatants": fighters}
        result = "критическое попадание" if roll == 20 else ("попадание" if hit else "промах")
        suffix = f", урон {actual_damage} HP ({target['hp']}/{target['max_hp']})" if hit and target.get("hp") is not None else ""
        return record_event(state, f"{attacker['name']} атакует {target['name']}: d20={roll} + {bonus} = {total} против КБ {armor_class} — {result}{suffix}.")
    if action == "end":
        return None
    raise APIError(HTTPStatus.BAD_REQUEST, "Неизвестное действие боя.")

def game_character_loadout(payload, existing=None):
    existing = existing or {}
    result = {}
    for field in ("inventory", "spells"):
        value = payload.get(field, existing.get(field, []))
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (TypeError, ValueError):
                value = [line.strip() for line in value.splitlines() if line.strip()]
        if not isinstance(value, list) or len(value) > 40:
            raise APIError(HTTPStatus.BAD_REQUEST, "Список предметов и заклинаний должен содержать не более 40 записей.")
        cleaned = []
        for item in value:
            if not isinstance(item, str):
                raise APIError(HTTPStatus.BAD_REQUEST, "Каждая запись должна быть текстом.")
            item = item.strip()
            if not item or len(item) > 100:
                raise APIError(HTTPStatus.BAD_REQUEST, "Название записи должно содержать от 1 до 100 символов.")
            if item not in cleaned:
                cleaned.append(item)
        result[field] = cleaned
    return result



def game_character_spell_slots(payload, existing=None):
    existing = existing or {}
    result = {}
    for field in ("spell_slots_max", "spell_slots"):
        value = payload.get(field, existing.get(field, [0] * 9))
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (TypeError, ValueError):
                value = [part.strip() for part in value.split(",")]
        if not isinstance(value, list) or len(value) != 9:
            raise APIError(HTTPStatus.BAD_REQUEST, "Для ячеек заклинаний нужны 9 значений — уровни с 1-го по 9-й.")
        cleaned = []
        for item in value:
            try:
                number = int(item)
            except (TypeError, ValueError):
                raise APIError(HTTPStatus.BAD_REQUEST, "Количество ячеек должно быть целым числом.")
            if not 0 <= number <= 20:
                raise APIError(HTTPStatus.BAD_REQUEST, "Количество ячеек каждого уровня должно быть от 0 до 20.")
            cleaned.append(number)
        result[field] = cleaned
    if any(result["spell_slots"][i] > result["spell_slots_max"][i] for i in range(9)):
        raise APIError(HTTPStatus.BAD_REQUEST, "Оставшихся ячеек не может быть больше максимума.")
    return result


def game_character_cast(payload, character):
    spell_name = " ".join(str(payload.get("spell") or "").split())
    try:
        level = int(payload.get("level", 0))
    except (TypeError, ValueError):
        level = -1
    if not spell_name or len(spell_name) > 100 or not 0 <= level <= 9:
        raise APIError(HTTPStatus.BAD_REQUEST, "Укажи заклинание и его уровень от 0 до 9.")
    known_spells = game_character_loadout({}, character)["spells"]
    if spell_name.casefold() not in {spell.casefold() for spell in known_spells}:
        raise APIError(HTTPStatus.FORBIDDEN, "Это заклинание не записано в листе персонажа.")
    if spell_name.casefold() in {"лечение ран", "cure wounds", "лечебное слово", "healing word"} and level < 1:
        raise APIError(HTTPStatus.BAD_REQUEST, "Это заклинание требует ячейку как минимум 1-го уровня.")
    slots = game_character_spell_slots({}, character)
    if level > 0:
        index = level - 1
        if slots["spell_slots"][index] < 1:
            raise APIError(HTTPStatus.CONFLICT, f"Нет свободных ячеек {level}-го уровня.")
        slots["spell_slots"][index] -= 1

    # Resolve only known, server-allowlisted effects; never trust client effect data.
    healing_dice = {
        "лечение ран": 8, "cure wounds": 8,
        "лечебное слово": 4, "healing word": 4,
    }
    result = {"spell": spell_name, "level": level, **slots}
    die = healing_dice.get(spell_name.casefold())
    if die:
        try:
            current_hp = int(character.get("hp", 0) or 0)
            max_hp = int(character.get("max_hp", 0) or 0)
        except (TypeError, ValueError):
            current_hp, max_hp = 0, 0
        if max_hp < 1 or current_hp < 0 or current_hp > max_hp:
            raise APIError(HTTPStatus.CONFLICT, "У персонажа некорректно настроено здоровье.")
        dice_count = level
        healing = sum(secrets.randbelow(die) + 1 for _ in range(dice_count))
        actual = min(max_hp, current_hp + healing) - current_hp
        result.update({"effect": "healing", "healing": actual, "hp": current_hp + actual, "max_hp": max_hp})
    return result


def game_character_record(row):
    xp = int(row.get("xp", 0) or 0)
    loadout = game_character_loadout({}, row)
    spell_slots = game_character_spell_slots({}, row)
    return {
        "id": row["id"],
        "game_id": row["game_id"],
        "user_id": row["user_id"],
        "name": row.get("name", ""),
        "class_name": row.get("class_name") or row.get("archetype") or row.get("hero_class", ""),
        "archetype": row.get("archetype") or row.get("class_name") or row.get("hero_class", ""),
        "race": row.get("race", ""),
        "level": int(row.get("level", calculate_character_level(xp)) or calculate_character_level(xp)),
        "xp": xp,
        **game_character_stats({}, row),
        **loadout,
        **spell_slots,
        "created_at": row.get("created_at", utc_timestamp()),
        "updated_at": row.get("updated_at", utc_timestamp()),
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


def mongo_book_record(
    db, book, include_chapters=False, user_id=None, rating_stats=None
):
    if rating_stats is None:
        ratings = list(
            db.book_ratings.find(
                {"book_id": book["id"]},
                {"_id": 0, "rating": 1, "user_id": 1},
            )
        )
        count = len(ratings)
        average = (
            round(sum(item["rating"] for item in ratings) / count, 1)
            if count
            else 0
        )
        own_rating = next(
            (item["rating"] for item in ratings if item["user_id"] == user_id), 0
        )
    else:
        count = rating_stats.get("rating_count", 0)
        average = rating_stats.get("rating", 0)
        own_rating = 0
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
        "chapter_count": book.get("chapter_count", len(chapters)),
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

    def send_json(self, status, payload, extra_headers=None, cache_control="no-store"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
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

    def read_json_or_empty(self):
        if self.headers.get("Content-Length") in (None, "0"):
            return {}
        try:
            return self.read_json()
        except APIError as exc:
            if exc.status == HTTPStatus.BAD_REQUEST and self.headers.get("Content-Length") in (None, "0"):
                return {}
            raise

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
        if path == "/health":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
        elif path.startswith("/api/"):
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
        parsed_query = parse_qs(urlsplit(self.path).query)
        if not path.startswith("/api/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден."})
            return
        try:
            if method in ("POST", "PUT", "PATCH", "DELETE"):
                self.check_origin()
            if MONGODB_URI:
                db = get_mongo_database()
                result, status, headers = self.dispatch_mongo_api(db, method, path, parsed_query)
            else:
                with connect_db() as db:
                    result, status, headers = self.dispatch_api(db, method, path, parsed_query)
            cache_control = (
                "public, max-age=20, stale-while-revalidate=60"
                if method == "GET" and path == "/api/books"
                else "no-store"
            )
            self.send_json(status, result, headers, cache_control=cache_control)
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

    def dispatch_mongo_api(self, db, method, path, query=None):
        query = query or {}
        if method == "GET" and path == "/api/me":
            user = self.current_user_mongo(db)
            return {"user": public_user(user) if user else None}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/stats":
            return {"registered_accounts": db.users.count_documents({})}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/books":
            try:
                page = max(1, int((query.get("page") or ["1"])[0]))
                limit = min(50, max(1, int((query.get("limit") or ["50"])[0])))
            except (TypeError, ValueError):
                return {"error": "Некорректные параметры пагинации"}, HTTPStatus.BAD_REQUEST, []
            skip = (page - 1) * limit
            search = (query.get("q") or [""])[0].strip()[:120]
            genre = (query.get("genre") or [""])[0].strip()[:60]
            genres = [value.strip()[:60] for value in (query.get("genres") or [""])[0].split(",") if value.strip()][:20]
            sort_by = (query.get("sort") or ["popular"])[0].strip()
            sort_fields = {
                "popular": [("rating", DESCENDING), ("rating_count", DESCENDING), ("updated_at", DESCENDING), ("id", DESCENDING)],
                "rating": [("rating", DESCENDING), ("rating_count", DESCENDING), ("id", DESCENDING)],
                "newest": [("created_at", DESCENDING), ("id", DESCENDING)],
                "title": [("title", ASCENDING), ("id", ASCENDING)],
            }
            sort_spec = sort_fields.get(sort_by, sort_fields["popular"])
            match = {"status": "published"}
            if genres:
                match["genre"] = {"$in": genres}
            elif genre and genre != "Все":
                match["genre"] = genre
            if search:
                pattern = re.escape(search)
                match["$or"] = [
                    {"title": {"$regex": pattern, "$options": "i"}},
                    {"author": {"$regex": pattern, "$options": "i"}},
                    {"description": {"$regex": pattern, "$options": "i"}},
                    {"tags": {"$regex": pattern, "$options": "i"}},
                ]
            total = db.books.count_documents(match)
            books = list(
                db.books.aggregate(
                    [
                        {"$match": match},
                        {
                            "$lookup": {
                                "from": "book_ratings",
                                "localField": "id",
                                "foreignField": "book_id",
                                "as": "_catalog_ratings",
                            }
                        },
                        {
                            "$set": {
                                "rating": {"$ifNull": [{"$avg": "$_catalog_ratings.rating"}, 0]},
                                "rating_count": {"$size": "$_catalog_ratings"},
                            }
                        },
                        {"$sort": dict(sort_spec)},
                        {"$skip": skip},
                        {"$limit": limit},
                        {
                            "$set": {
                                "chapter_count": {"$size": {"$ifNull": ["$chapters", []]}},
                            }
                        },
                    ]
                )
            )
            rating_stats = {}
            book_ids = [book["id"] for book in books]
            if book_ids:
                for item in db.book_ratings.aggregate(
                    [
                        {"$match": {"book_id": {"$in": book_ids}}},
                        {
                            "$group": {
                                "_id": "$book_id",
                                "rating": {"$avg": "$rating"},
                                "rating_count": {"$sum": 1},
                            }
                        },
                    ]
                ):
                    rating_stats[item["_id"]] = {
                        "rating": round(item["rating"], 1),
                        "rating_count": item["rating_count"],
                    }
            return {
                "books": [
                    mongo_book_record(
                        db, book, rating_stats=rating_stats.get(book["id"], {})
                    )
                    for book in books
                ],
                "page": page,
                "limit": limit,
                "total": total,
                "pages": max(1, (total + limit - 1) // limit),
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
            rating_summary = next(
                db.book_ratings.aggregate(
                    [
                        {"$match": {"book_id": book_id}},
                        {
                            "$group": {
                                "_id": None,
                                "rating": {"$avg": "$rating"},
                                "rating_count": {"$sum": 1},
                            }
                        },
                    ]
                ),
                {"rating": rating, "rating_count": 1},
            )
            return {
                "rating": round(rating_summary["rating"], 1),
                "rating_count": rating_summary["rating_count"],
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
            if db.users.find_one({"email": email}, {"_id": 1}):
                raise APIError(HTTPStatus.CONFLICT, "Аккаунт с такой почтой уже существует.")
            if not email_verification_enabled():
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
            pending = db.pending_email_verifications.find_one({"email": email})
            if pending and int(time.time()) - pending.get("created_at", 0) < 60:
                raise APIError(HTTPStatus.TOO_MANY_REQUESTS, "Подожди минуту перед повторной отправкой кода.")
            code = f"{secrets.randbelow(1_000_000):06d}"
            code_hash = email_code_hash(email, code)
            db.pending_email_verifications.replace_one({"email": email}, {
                "email": email, "display_name": display_name, "password_hash": password_digest(password),
                "code_hash": code_hash, "expires_at": int(time.time()) + EMAIL_CODE_TTL,
                "attempts": 0, "created_at": int(time.time()),
            }, upsert=True)
            try:
                send_verification_email(email, display_name, code)
            except Exception:
                db.pending_email_verifications.delete_one({"email": email, "code_hash": code_hash})
                raise
            return {"verification_required": True, "email": email}, HTTPStatus.ACCEPTED, []

        if method == "POST" and path == "/api/verify-email":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            code = data.get("code")
            if not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
                raise APIError(HTTPStatus.BAD_REQUEST, "Введи шестизначный код из письма.")
            pending = db.pending_email_verifications.find_one({"email": email})
            if not pending or pending["expires_at"] < int(time.time()):
                db.pending_email_verifications.delete_one({"email": email})
                raise APIError(HTTPStatus.GONE, "Код истёк. Начни регистрацию заново.")
            if pending.get("attempts", 0) >= EMAIL_CODE_MAX_ATTEMPTS:
                db.pending_email_verifications.delete_one({"email": email})
                raise APIError(HTTPStatus.TOO_MANY_REQUESTS, "Слишком много попыток. Начни регистрацию заново.")
            if not hmac.compare_digest(pending["code_hash"], email_code_hash(email, code)):
                db.pending_email_verifications.update_one({"email": email}, {"$inc": {"attempts": 1}})
                raise APIError(HTTPStatus.UNAUTHORIZED, "Неверный код подтверждения.")
            user = {"id": next_mongo_id(db, "users"), "email": email, "display_name": pending["display_name"],
                    "password_hash": pending["password_hash"], "created_at": utc_timestamp()}
            db.users.insert_one(user)
            db.pending_email_verifications.delete_one({"email": email})
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
            bio = self.valid_text(data.get("bio", ""), "О себе", 0, 300)
            avatar_url = data.get("avatar_url", user.get("avatar_url", ""))
            if not isinstance(avatar_url, str) or len(avatar_url) > 800000:
                raise APIError(HTTPStatus.BAD_REQUEST, "Изображение слишком большое. Максимум 550 КБ.")
            if avatar_url and not re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}", avatar_url):
                raise APIError(HTTPStatus.BAD_REQUEST, "Поддерживаются только PNG, JPG и WebP.")
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
                {"$set": {"display_name": display_name, "email": email, "bio": bio, "avatar_url": avatar_url}},
            )
            updated = db.users.find_one({"id": user["id"]})
            return {"user": public_user(updated)}, HTTPStatus.OK, []

        if method == "DELETE" and path == "/api/account":
            user = self.current_user_mongo(db, required=True)
            data = self.read_json()
            current_password = data.get("current_password")
            if not isinstance(current_password, str) or not verify_password(current_password, user["password_hash"]):
                raise APIError(HTTPStatus.UNAUTHORIZED, "Текущий пароль введён неверно.")
            owned_book_ids = [book["id"] for book in db.books.find({"owner_id": user["id"]}, {"id": 1})]
            if owned_book_ids:
                db.book_ratings.delete_many({"book_id": {"$in": owned_book_ids}})
            db.book_ratings.delete_many({"user_id": user["id"]})
            db.books.delete_many({"owner_id": user["id"]})
            db.sessions.delete_many({"user_id": user["id"]})
            db.users.delete_one({"id": user["id"]})
            expired_cookie = self.cookie_headers("", 0)
            return {"ok": True}, HTTPStatus.OK, expired_cookie

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

        catalog_match = re.fullmatch(
            r"/api/catalog/games(?:/([a-z0-9-]+))?(?:/(rating|presence))?", path
        )
        if catalog_match and method == "GET" and not catalog_match.group(1) and catalog_match.group(2) is None:
            user = self.current_user_mongo(db)
            now = int(time.time())
            db.game_catalog_presence.delete_many({"expires_at": {"$lte": now}})
            games = list(db.game_catalog.find().sort("title", ASCENDING))
            games.sort(key=lambda game: (game["slug"] != "dnd", game["title"].casefold()))
            game_ids = [game["slug"] for game in games]
            rating_stats = {}
            if game_ids:
                rating_stats = {
                    item["_id"]: item
                    for item in db.game_catalog_ratings.aggregate(
                        [
                            {"$match": {"game_slug": {"$in": game_ids}}},
                            {
                                "$group": {
                                    "_id": "$game_slug",
                                    "rating": {"$avg": "$rating"},
                                    "rating_count": {"$sum": 1},
                                }
                            },
                        ]
                    )
                }
            presence_stats = {
                item["_id"]: item["count"]
                for item in db.game_catalog_presence.aggregate(
                    [
                        {"$match": {"game_slug": {"$in": game_ids}, "expires_at": {"$gt": now}}},
                        {"$group": {"_id": "$game_slug", "count": {"$sum": 1}}},
                    ]
                )
            } if game_ids else {}
            return {
                "games": [
                    game_catalog_record(
                        game,
                        rating=rating_stats.get(game["slug"], {}).get("rating", 0),
                        rating_count=rating_stats.get(game["slug"], {}).get("rating_count", 0),
                        active_viewers=presence_stats.get(game["slug"], 0),
                        user_rating=(
                            (db.game_catalog_ratings.find_one(
                                {"game_slug": game["slug"], "user_id": user["id"]},
                                {"rating": 1},
                            ) or {}).get("rating", 0)
                            if user else 0
                        ),
                    )
                    for game in games
                ]
            }, HTTPStatus.OK, []

        if catalog_match and method == "GET" and catalog_match.group(1) and catalog_match.group(2) is None:
            slug = catalog_match.group(1)
            game = db.game_catalog.find_one({"slug": slug})
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Игра не найдена в каталоге.")
            user = self.current_user_mongo(db)
            now = int(time.time())
            db.game_catalog_presence.delete_many({"expires_at": {"$lte": now}})
            rating_stats = next(
                db.game_catalog_ratings.aggregate(
                    [
                        {"$match": {"game_slug": slug}},
                        {
                            "$group": {
                                "_id": None,
                                "rating": {"$avg": "$rating"},
                                "rating_count": {"$sum": 1},
                            }
                        },
                    ]
                ),
                {},
            )
            own_rating = db.game_catalog_ratings.find_one(
                {"game_slug": slug, "user_id": user["id"]}, {"rating": 1}
            ) if user else None
            rooms = []
            for room in db.games.find(
                {"catalog_game_slug": slug, "access": "public"}
            ).sort([("updated_at", DESCENDING), ("id", DESCENDING)]):
                rooms.append(game_record_row({
                    **room,
                    "member_count": db.game_participants.count_documents({"game_id": room["id"]}),
                    "hero_count": db.game_characters.count_documents({"game_id": room["id"]}),
                    "is_member": bool(user and db.game_participants.find_one(
                        {"game_id": room["id"], "user_id": user["id"]}
                    )),
                    "is_owner": bool(user and room["owner_id"] == user["id"]),
                }, user_id=user["id"] if user else None))
            private_rooms = []
            if user:
                for room in db.games.find({
                    "catalog_game_slug": slug,
                    "access": {"$in": ["private", "invite_only"]},
                    "owner_id": user["id"],
                }).sort([("updated_at", DESCENDING), ("id", DESCENDING)]):
                    private_rooms.append(game_record_row({
                        **room,
                        "member_count": db.game_participants.count_documents({"game_id": room["id"]}),
                        "hero_count": db.game_characters.count_documents({"game_id": room["id"]}),
                        "is_member": True,
                        "is_owner": True,
                    }, user_id=user["id"]))
            return {
                "game": game_catalog_record(
                    game,
                    rating=rating_stats.get("rating", 0),
                    rating_count=rating_stats.get("rating_count", 0),
                    active_viewers=db.game_catalog_presence.count_documents(
                        {"game_slug": slug, "expires_at": {"$gt": now}}
                    ),
                    user_rating=(own_rating or {}).get("rating", 0),
                ),
                "rooms": rooms,
                "private_rooms": private_rooms,
            }, HTTPStatus.OK, []

        if catalog_match and method == "POST" and catalog_match.group(1):
            slug, action = catalog_match.groups()
            game = db.game_catalog.find_one({"slug": slug})
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Игра не найдена в каталоге.")
            data = self.read_json()
            if action == "rating":
                user = self.current_user_mongo(db, required=True)
                rating = data.get("rating")
                if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Оценка должна быть от 1 до 5.")
                db.game_catalog_ratings.update_one(
                    {"game_slug": slug, "user_id": user["id"]},
                    {
                        "$set": {"rating": rating, "created_at": utc_timestamp()},
                        "$setOnInsert": {"game_slug": slug, "user_id": user["id"]},
                    },
                    upsert=True,
                )
                summary = next(
                    db.game_catalog_ratings.aggregate(
                        [
                            {"$match": {"game_slug": slug}},
                            {
                                "$group": {
                                    "_id": None,
                                    "rating": {"$avg": "$rating"},
                                    "rating_count": {"$sum": 1},
                                }
                            },
                        ]
                    ),
                    {},
                )
                return {
                    "rating": round(summary.get("rating", 0), 1),
                    "rating_count": summary.get("rating_count", 0),
                    "user_rating": rating,
                }, HTTPStatus.OK, []
            if action == "presence":
                viewer_token = data.get("viewer_token")
                if not isinstance(viewer_token, str) or not re.fullmatch(
                    r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}",
                    viewer_token,
                    re.IGNORECASE,
                ):
                    raise APIError(HTTPStatus.BAD_REQUEST, "Не удалось подтвердить присутствие.")
                now = int(time.time())
                db.game_catalog_presence.delete_many({"expires_at": {"$lte": now}})
                db.game_catalog_presence.update_one(
                    {"game_slug": slug, "viewer_token": viewer_token},
                    {
                        "$set": {"expires_at": now + GAME_CATALOG_PRESENCE_SECONDS},
                        "$setOnInsert": {"game_slug": slug, "viewer_token": viewer_token},
                    },
                    upsert=True,
                )
                return {
                    "active_viewers": db.game_catalog_presence.count_documents(
                        {"game_slug": slug, "expires_at": {"$gt": now}}
                    )
                }, HTTPStatus.OK, []

        if method == "POST" and path == "/api/games/enter":
            user = self.current_user_mongo(db, required=True)
            payload = self.read_json()
            code = str(payload.get("code") or "").strip().upper()
            owner_name = self.valid_text(payload.get("owner_name"), "Ник владельца", 1, 60)
            owner_name_key = normalize_game_owner_name(owner_name)
            matches = []
            candidates = db.games.find({
                "access": {"$in": ["private", "invite_only"]},
                "join_code": code,
            })
            for candidate in candidates:
                owner = db.users.find_one({"id": candidate["owner_id"]}, {"display_name": 1})
                if owner and normalize_game_owner_name(owner.get("display_name")) == owner_name_key:
                    matches.append(candidate)
            if len(matches) != 1:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната с таким кодом и ником владельца не найдена.")
            game = matches[0]
            if not db.game_participants.find_one({"game_id": game["id"], "user_id": user["id"]}):
                db.game_participants.insert_one({
                    "id": next_mongo_id(db, "game_participants"),
                    "game_id": game["id"],
                    "user_id": user["id"],
                    "role": "player",
                    "status": "active",
                    "joined_at": utc_timestamp(),
                })
            return {
                "game_id": game["id"],
                "catalog_game_slug": game.get("catalog_game_slug", ""),
            }, HTTPStatus.OK, []

        if method == "GET" and path == "/api/games":
            user = self.current_user_mongo(db)
            result = []
            for game in db.games.find({"access": "public"}).sort([("updated_at", DESCENDING), ("id", DESCENDING)]):
                member_count = db.game_participants.count_documents({"game_id": game["id"]})
                hero_count = db.game_characters.count_documents({"game_id": game["id"]})
                is_owner = user is not None and game["owner_id"] == user["id"]
                is_member = user is not None and bool(db.game_participants.find_one({"game_id": game["id"], "user_id": user["id"]}))
                result.append(game_record_row({
                    "id": game["id"],
                    "owner_id": game["owner_id"],
                    "name": game.get("name") or game.get("title") or game.get("room_name") or "Новая комната",
                    "title": game.get("title") or game.get("name") or game.get("room_name") or "Новая комната",
                    "room_name": game.get("room_name") or game.get("name") or game.get("title") or "Новая комната",
                    "description": game.get("description", ""),
                    "access": game.get("access", "public"),
                    "join_code": game.get("join_code", ""),
                    "combat": game.get("combat_state") or None,
                    "created_at": game.get("created_at", utc_timestamp()),
                    "updated_at": game.get("updated_at", utc_timestamp()),
                    "member_count": member_count,
                    "hero_count": hero_count,
                    "is_member": is_member,
                    "is_owner": is_owner,
                }, user_id=user["id"] if user else None))
            return {"games": result}, HTTPStatus.OK, []

        game_match = re.fullmatch(r"/api/games/(\d+)", path)
        if method == "DELETE" and game_match:
            user = self.current_user_mongo(db, required=True)
            game_id = int(game_match.group(1))
            game = db.games.find_one({"id": game_id})
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            if game["owner_id"] != user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Удалить комнату может только её создатель.")
            for collection in ("game_participants", "game_characters", "game_sessions", "xp_history"):
                db[collection].delete_many({"game_id": game_id})
            db.games.delete_one({"id": game_id})
            return {"ok": True}, HTTPStatus.OK, []

        if method == "GET" and game_match:
            game_id = int(game_match.group(1))
            game = db.games.find_one({"id": game_id})
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            user = self.current_user_mongo(db)
            is_owner = user is not None and game["owner_id"] == user["id"]
            is_member = user is not None and bool(
                db.game_participants.find_one({"game_id": game_id, "user_id": user["id"]})
            )
            if game["access"] != "public" and (user is None or not is_owner and not is_member):
                raise APIError(HTTPStatus.FORBIDDEN, "У тебя нет доступа к этой комнате.")
            members = list(db.game_participants.find({"game_id": game_id}).sort([("joined_at", DESCENDING), ("id", DESCENDING)]))
            characters = list(db.game_characters.find({"game_id": game_id}).sort([("level", DESCENDING), ("xp", DESCENDING), ("name", ASCENDING)]))
            sessions = list(db.game_sessions.find({"game_id": game_id}).sort([("created_at", DESCENDING), ("id", DESCENDING)]))
            return {
                "game": game_record_row({
                    "id": game["id"],
                    "owner_id": game["owner_id"],
                    "name": game.get("name") or game.get("title") or game.get("room_name") or "Новая комната",
                    "title": game.get("title") or game.get("name") or game.get("room_name") or "Новая комната",
                    "room_name": game.get("room_name") or game.get("name") or game.get("title") or "Новая комната",
                    "catalog_game_slug": game.get("catalog_game_slug", ""),
                    "description": game.get("description", ""),
                    "access": game.get("access", "public"),
                    "join_code": game.get("join_code", ""),
                    "combat_state": game.get("combat_state") or {},
                    "created_at": game.get("created_at", utc_timestamp()),
                    "updated_at": game.get("updated_at", utc_timestamp()),
                    "member_count": len(members),
                    "hero_count": len(characters),
                    "is_member": is_member,
                    "is_owner": is_owner,
                    "participants": [{
                        "id": member.get("id"),
                        "game_id": member.get("game_id"),
                        "user_id": member.get("user_id"),
                        "role": member.get("role", "player"),
                        "status": member.get("status", "active"),
                        "joined_at": member.get("joined_at"),
                    } for member in members],
                    "heroes": [game_character_record(character) for character in characters],
                    "sessions": [{
                        "id": session["id"],
                        "game_id": session["game_id"],
                        "user_id": session.get("user_id"),
                        "title": session.get("title", ""),
                        "xp_awarded": session.get("xp_awarded", 0),
                        "notes": session.get("notes", ""),
                        "created_at": session.get("created_at"),
                    } for session in sessions],
                }, user_id=user["id"] if user else None),
                "members": [{
                    "id": member.get("id"),
                    "game_id": member.get("game_id"),
                    "user_id": member.get("user_id"),
                    "role": member.get("role", "player"),
                    "status": member.get("status", "active"),
                    "joined_at": member.get("joined_at"),
                } for member in members],
                "heroes": [game_character_record(character) for character in characters],
                "sessions": [{
                    "id": session["id"],
                    "game_id": session["game_id"],
                    "user_id": session.get("user_id"),
                    "title": session.get("title", ""),
                    "xp_awarded": session.get("xp_awarded", 0),
                    "notes": session.get("notes", ""),
                    "created_at": session.get("created_at"),
                } for session in sessions],
            }, HTTPStatus.OK, []

        if method == "GET" and path == "/api/my/games":
            user = self.current_user_mongo(db, required=True)
            member_game_ids = [entry["game_id"] for entry in db.game_participants.find({"user_id": user["id"]}, {"game_id": 1})]
            games = list(db.games.find({"$or": [{"owner_id": user["id"]}, {"id": {"$in": member_game_ids}}]}).sort([("updated_at", DESCENDING), ("id", DESCENDING)]))
            return {"games": [
                game_record_row({
                    "id": game["id"],
                    "owner_id": game["owner_id"],
                    "name": game.get("name") or game.get("title") or game.get("room_name") or "Новая комната",
                    "title": game.get("title") or game.get("name") or game.get("room_name") or "Новая комната",
                    "room_name": game.get("room_name") or game.get("name") or game.get("title") or "Новая комната",
                    "catalog_game_slug": game.get("catalog_game_slug", ""),
                    "description": game.get("description", ""),
                    "access": game.get("access", "public"),
                    "join_code": game.get("join_code", ""),
                    "created_at": game.get("created_at", utc_timestamp()),
                    "updated_at": game.get("updated_at", utc_timestamp()),
                    "member_count": db.game_participants.count_documents({"game_id": game["id"]}),
                    "hero_count": db.game_characters.count_documents({"game_id": game["id"]}),
                    "is_member": True,
                    "is_owner": game["owner_id"] == user["id"],
                }, user_id=user["id"]) for game in games
            ]}, HTTPStatus.OK, []

        if method == "POST" and path == "/api/games":
            user = self.current_user_mongo(db, required=True)
            data = self.read_json()
            name = self.valid_text(data.get("name") or data.get("title") or data.get("room_name"), "Название комнаты", 1, 80)
            description = self.valid_text(data.get("description", ""), "Описание", 0, 500)
            access = normalize_game_access(data.get("access", "public"))
            join_code = str(data.get("join_code") or "").strip().upper()
            catalog_game_slug = data.get("catalog_game_slug")
            if catalog_game_slug is not None:
                if not isinstance(catalog_game_slug, str) or db.game_catalog.find_one(
                    {"slug": catalog_game_slug}, {"slug": 1}
                ) is None:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Игра не найдена в каталоге.")
            if access in {"private", "invite_only"} and not join_code:
                join_code = f"{secrets.token_hex(4).upper()}"
            game_id = next_mongo_id(db, "games")
            game = {
                "id": game_id,
                "owner_id": user["id"],
                "name": name,
                "title": name,
                "room_name": name,
                "description": description,
                "access": access,
                "join_code": join_code,
                "catalog_game_slug": catalog_game_slug,
                "created_at": utc_timestamp(),
                "updated_at": utc_timestamp(),
            }
            db.games.insert_one(game)
            db.game_participants.insert_one({
                "id": next_mongo_id(db, "game_participants"),
                "game_id": game_id,
                "user_id": user["id"],
                "role": "owner",
                "status": "active",
                "joined_at": utc_timestamp(),
            })
            return {"game": game_record_row(game, user_id=user["id"])}, HTTPStatus.CREATED, []

        character_match = re.fullmatch(r"/api/games/(\d+)/characters/(\d+)", path)
        if method == "PATCH" and character_match:
            user = self.current_user_mongo(db, required=True)
            game_id, target_user_id = map(int, character_match.groups())
            game = db.games.find_one({"id": game_id})
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            if game["owner_id"] != user["id"] and target_user_id != user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Изменять лист героя может сам игрок или ведущий.")
            character = db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id})
            if character is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Герой участника не найден.")
            payload = self.read_json()
            if game["owner_id"] != user["id"] and set(payload) - {"inventory", "spells"}:
                raise APIError(HTTPStatus.FORBIDDEN, "Игрок может менять только свой инвентарь и список заклинаний.")
            stats = game_character_stats(payload, character)
            loadout = game_character_loadout(payload, character)
            spell_slots = game_character_spell_slots(payload, character)
            db.game_characters.update_one(
                {"game_id": game_id, "user_id": target_user_id},
                {"$set": {**stats, **loadout, **spell_slots, "updated_at": utc_timestamp()}},
            )
            updated_character = db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id})
            return {"character": game_character_record(updated_character)}, HTTPStatus.OK, []

        spell_action_match = re.fullmatch(r"/api/games/(\d+)/characters/(\d+)/(cast|rest)", path)
        if method == "POST" and spell_action_match:
            user = self.current_user_mongo(db, required=True)
            game_id, target_user_id = map(int, spell_action_match.groups()[:2])
            action = spell_action_match.group(3)
            game = db.games.find_one({"id": game_id})
            character = db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id})
            if game is None or character is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната или персонаж не найдены.")
            if action == "cast":
                if game["owner_id"] != user["id"] and target_user_id != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Использовать заклинания может сам игрок или ведущий.")
                result = game_character_cast(self.read_json(), character)
                db.game_characters.update_one({"game_id": game_id, "user_id": target_user_id}, {"$set": {"spell_slots": result["spell_slots"], **({"hp": result["hp"]} if "hp" in result else {}), "updated_at": utc_timestamp()}})
                updated = db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id})
                return {"character": game_character_record(updated), "cast": {key: result[key] for key in ("spell", "level", "effect", "healing", "hp", "max_hp") if key in result}}, HTTPStatus.OK, []
            if game["owner_id"] != user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Восстановить ячейки после продолжительного отдыха может только ведущий.")
            slots = game_character_spell_slots({}, character)
            slots["spell_slots"] = list(slots["spell_slots_max"])
            db.game_characters.update_one({"game_id": game_id, "user_id": target_user_id}, {"$set": {**slots, "updated_at": utc_timestamp()}})
            updated = db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id})
            return {"character": game_character_record(updated), "restored": True}, HTTPStatus.OK, []

        spell_action_match = re.fullmatch(r"/api/games/(\d+)/characters/(\d+)/(cast|rest)", path)
        if method == "POST" and spell_action_match:
            user = self.current_user(db, required=True)
            game_id, target_user_id = map(int, spell_action_match.groups()[:2])
            action = spell_action_match.group(3)
            game = db.execute("SELECT owner_id FROM games WHERE id = ?", (game_id,)).fetchone()
            character = db.execute("SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?", (game_id, target_user_id)).fetchone()
            if game is None or character is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната или персонаж не найдены.")
            character = dict(character)
            if action == "cast":
                if game["owner_id"] != user["id"] and target_user_id != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Использовать заклинания может сам игрок или ведущий.")
                result = game_character_cast(self.read_json(), character)
                if "hp" in result:
                    db.execute("UPDATE game_characters SET spell_slots = ?, hp = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE game_id = ? AND user_id = ?", (json.dumps(result["spell_slots"]), result["hp"], game_id, target_user_id))
                else:
                    db.execute("UPDATE game_characters SET spell_slots = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE game_id = ? AND user_id = ?", (json.dumps(result["spell_slots"]), game_id, target_user_id))
                updated = db.execute("SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?", (game_id, target_user_id)).fetchone()
                return {"character": game_character_record(dict(updated)), "cast": {key: result[key] for key in ("spell", "level", "effect", "healing", "hp", "max_hp") if key in result}}, HTTPStatus.OK, []
            if game["owner_id"] != user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Восстановить ячейки после продолжительного отдыха может только ведущий.")
            slots = game_character_spell_slots({}, character)
            slots["spell_slots"] = list(slots["spell_slots_max"])
            db.execute("UPDATE game_characters SET spell_slots_max = ?, spell_slots = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE game_id = ? AND user_id = ?", (json.dumps(slots["spell_slots_max"]), json.dumps(slots["spell_slots"]), game_id, target_user_id))
            updated = db.execute("SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?", (game_id, target_user_id)).fetchone()
            return {"character": game_character_record(dict(updated)), "restored": True}, HTTPStatus.OK, []

        game_action_match = re.fullmatch(r"/api/games/(\d+)/(join|leave|characters|heroes|sessions|xp|join-code|combat)", path)
        if method in {"POST", "DELETE"} and game_action_match:
            user = self.current_user_mongo(db, required=True)
            game_id = int(game_action_match.group(1))
            game = db.games.find_one({"id": game_id})
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            if game_action_match.group(2) == "combat":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Управлять боем может только ведущий.")
                payload = self.read_json()
                combat = game_combat_transition(str(payload.get("action") or ""), payload, list(db.game_characters.find({"game_id": game_id})), game.get("combat_state"))
                if combat and payload.get("action") in ("damage", "heal", "attack"):
                    for fighter in combat.get("combatants", []):
                        if fighter.get("kind") == "hero" and fighter.get("hp") is not None:
                            db.game_characters.update_one(
                                {"game_id": game_id, "user_id": fighter["user_id"]},
                                {"$set": {"hp": fighter["hp"], "updated_at": utc_timestamp()}},
                            )
                db.games.update_one({"id": game_id}, {"$set": {"combat_state": combat or {}, "updated_at": utc_timestamp()}})
                return {"combat": combat}, HTTPStatus.OK, []
            if game_action_match.group(2) == "join-code":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Только владелец комнаты может менять код доступа.")
                payload = self.read_json()
                requested = str(payload.get("join_code") or payload.get("code") or "").strip().upper()
                access = normalize_game_access(game.get("access", "public"))
                if access == "public":
                    new_code = ""
                elif requested:
                    if not re.fullmatch(r"[A-Z0-9-]{4,32}", requested):
                        raise APIError(HTTPStatus.BAD_REQUEST, "Код доступа должен содержать 4–32 символа из латиницы, цифр и тире.")
                    new_code = requested
                else:
                    new_code = f"{secrets.token_hex(4).upper()}-{game_id}"
                db.games.update_one({"id": game_id}, {"$set": {"join_code": new_code, "updated_at": utc_timestamp()}})
                refreshed = db.games.find_one({"id": game_id})
                return {"game": game_record_row(refreshed, user_id=user["id"])}, HTTPStatus.OK, []
            if game_action_match.group(2) == "join":
                if game["owner_id"] != user["id"] and not db.game_characters.find_one({"game_id": game_id, "user_id": user["id"]}):
                    raise APIError(HTTPStatus.FORBIDDEN, "Сначала создай и сохрани персонажа, затем вступай в комнату.")
                if db.game_participants.find_one({"game_id": game_id, "user_id": user["id"]}):
                    return {"ok": True, "joined": True}, HTTPStatus.OK, []
                if game["access"] in {"private", "invite_only"}:
                    payload = self.read_json()
                    code = str(payload.get("join_code") or "").strip().upper()
                    owner_name = self.valid_text(payload.get("owner_name"), "Ник владельца", 1, 60)
                    owner = db.users.find_one({"id": game["owner_id"]}, {"display_name": 1})
                    if (
                        code != str(game.get("join_code", "")).strip().upper()
                        or owner is None
                        or normalize_game_owner_name(owner.get("display_name"))
                        != normalize_game_owner_name(owner_name)
                    ):
                        raise APIError(HTTPStatus.FORBIDDEN, "Код приглашения не подходит.")
                db.game_participants.insert_one({
                    "id": next_mongo_id(db, "game_participants"),
                    "game_id": game_id,
                    "user_id": user["id"],
                    "role": "player",
                    "status": "active",
                    "joined_at": utc_timestamp(),
                })
                return {"ok": True, "joined": True}, HTTPStatus.OK, []
            if game_action_match.group(2) == "leave":
                db.game_participants.delete_one({"game_id": game_id, "user_id": user["id"]})
                return {"ok": True}, HTTPStatus.OK, []
            if game_action_match.group(2) in {"characters", "heroes"}:
                if game["owner_id"] == user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Ведущий не создаёт персонажа в своей комнате.")
                payload = self.read_json()
                name = self.valid_text(payload.get("name") or payload.get("hero_name"), "Имя героя", 1, 80)
                race = validate_dnd_race(payload.get("race"))
                existing = db.game_characters.find_one({"game_id": game_id, "user_id": user["id"]})
                if existing:
                    db.game_characters.update_one(
                        {"game_id": game_id, "user_id": user["id"]},
                        {"$set": {"name": name, "race": race, "updated_at": utc_timestamp()}},
                    )
                    character = db.game_characters.find_one({"game_id": game_id, "user_id": user["id"]})
                else:
                    character = {
                        "id": next_mongo_id(db, "game_characters"),
                        "game_id": game_id,
                        "user_id": user["id"],
                        "name": name,
                        "class_name": "",
                        "archetype": "",
                        "race": race,
                        "level": 1,
                        "xp": 0,
                        **generate_random_character_stats(),
                        "created_at": utc_timestamp(),
                        "updated_at": utc_timestamp(),
                    }
                    db.game_characters.insert_one(character)
                return {"character": game_character_record(character)}, HTTPStatus.CREATED, []
            if game_action_match.group(2) == "sessions":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Только ведущий может вести сессию.")
                payload = self.read_json()
                title = self.valid_text(payload.get("title") or "Сессия", "Название сессии", 1, 120)
                xp_awarded = int(payload.get("xp_awarded", 0) or 0)
                target_user_id = payload.get("user_id")
                if target_user_id is not None:
                    target_user_id = int(target_user_id)
                note = self.valid_text(payload.get("notes", ""), "Заметки", 0, 500)
                session_id = next_mongo_id(db, "game_sessions")
                session = {
                    "id": session_id,
                    "game_id": game_id,
                    "host_user_id": user["id"],
                    "user_id": target_user_id if target_user_id is not None else user["id"],
                    "title": title,
                    "xp_awarded": xp_awarded,
                    "notes": note,
                    "created_at": utc_timestamp(),
                }
                db.game_sessions.insert_one(session)
                if xp_awarded > 0 and target_user_id is not None:
                    db.game_characters.update_one({"game_id": game_id, "user_id": target_user_id}, {"$inc": {"xp": xp_awarded}, "$set": {"level": calculate_character_level((db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id}) or {}).get("xp", 0) + xp_awarded), "updated_at": utc_timestamp()}})
                    db.xp_history.insert_one({
                        "id": next_mongo_id(db, "xp_history"),
                        "game_id": game_id,
                        "user_id": target_user_id,
                        "amount": xp_awarded,
                        "reason": title,
                        "created_at": utc_timestamp(),
                    })
                session_response = {key: value for key, value in session.items() if key != "_id"}
                return {"session": session_response}, HTTPStatus.CREATED, []
            if game_action_match.group(2) == "xp":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Только ведущий может выдавать XP.")
                payload = self.read_json()
                target_user_id = int(payload.get("user_id"))
                amount = max(0, int(payload.get("amount", 0) or 0))
                reason = self.valid_text(payload.get("reason", "Награда"), "Причина", 0, 200)
                update = db.game_characters.find_one({"game_id": game_id, "user_id": target_user_id})
                if update is None:
                    raise APIError(HTTPStatus.NOT_FOUND, "Герой участника не найден.")
                new_xp = int(update.get("xp", 0)) + amount
                db.game_characters.update_one({"game_id": game_id, "user_id": target_user_id}, {"$set": {"xp": new_xp, "level": calculate_character_level(new_xp), "updated_at": utc_timestamp()}})
                db.xp_history.insert_one({
                    "id": next_mongo_id(db, "xp_history"),
                    "game_id": game_id,
                    "user_id": target_user_id,
                    "amount": amount,
                    "reason": reason,
                    "created_at": utc_timestamp(),
                })
                return {"ok": True, "xp": new_xp}, HTTPStatus.OK, []

        raise APIError(HTTPStatus.NOT_FOUND, "Маршрут не найден.")

    def dispatch_api(self, db, method, path, query=None):
        query = query or {}
        if method == "GET" and path == "/api/me":
            user = self.current_user(db)
            return {"user": public_user(user) if user else None}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/stats":
            count = db.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
            return {"registered_accounts": count}, HTTPStatus.OK, []

        if method == "GET" and path == "/api/books":
            try:
                page = max(1, int((query.get("page") or ["1"])[0]))
                limit = min(50, max(1, int((query.get("limit") or ["50"])[0])))
            except (TypeError, ValueError):
                return {"error": "Некорректные параметры пагинации"}, HTTPStatus.BAD_REQUEST, []
            search = (query.get("q") or [""])[0].strip()[:120]
            genre = (query.get("genre") or [""])[0].strip()[:60]
            genres = [value.strip()[:60] for value in (query.get("genres") or [""])[0].split(",") if value.strip()][:20]
            sort_by = (query.get("sort") or ["popular"])[0].strip()
            sort_sql = {
                "popular": "rating_avg DESC, rating_count DESC, books.updated_at DESC, books.id DESC",
                "rating": "rating_avg DESC, rating_count DESC, books.id DESC",
                "newest": "books.created_at DESC, books.id DESC",
                "title": "books.title COLLATE NOCASE ASC, books.id ASC",
            }.get(sort_by, "rating_avg DESC, rating_count DESC, books.updated_at DESC, books.id DESC")
            conditions = ["books.status = 'published'"]
            params = []
            if genres:
                placeholders = ",".join("?" for _ in genres)
                conditions.append(f"books.genre IN ({placeholders})")
                params.extend(genres)
            elif genre and genre != "Все":
                conditions.append("books.genre = ?")
                params.append(genre)
            if search:
                conditions.append("(books.title LIKE ? OR books.author LIKE ? OR books.description LIKE ? OR books.tags LIKE ?)")
                pattern = f"%{search}%"
                params.extend([pattern, pattern, pattern, pattern])
            where_sql = " AND ".join(conditions)
            total = db.execute(f"SELECT COUNT(*) AS total FROM books WHERE {where_sql}", params).fetchone()["total"]
            offset = (page - 1) * limit
            rows = db.execute(
                """
                WITH rating_stats AS (
                    SELECT book_id, AVG(rating) AS rating_avg, COUNT(*) AS rating_count
                    FROM book_ratings
                    GROUP BY book_id
                ),
                chapter_stats AS (
                    SELECT book_id, COUNT(*) AS chapter_count
                    FROM chapters
                    GROUP BY book_id
                )
                SELECT books.*,
                    COALESCE(rating_stats.rating_avg, 0) AS rating_avg,
                    COALESCE(rating_stats.rating_count, 0) AS rating_count,
                    COALESCE(chapter_stats.chapter_count, 0) AS chapter_count
                FROM books
                LEFT JOIN rating_stats ON rating_stats.book_id = books.id
                LEFT JOIN chapter_stats ON chapter_stats.book_id = books.id
                WHERE {where_sql}
                ORDER BY {sort_sql}
                LIMIT ? OFFSET ?
                """.format(where_sql=where_sql, sort_sql=sort_sql),
                (*params, limit, offset),
            ).fetchall()
            return {
                "books": [book_record(db, row) for row in rows],
                "page": page,
                "limit": limit,
                "total": total,
                "pages": max(1, (total + limit - 1) // limit),
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
            if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                raise APIError(HTTPStatus.CONFLICT, "Аккаунт с такой почтой уже существует.")
            if not email_verification_enabled():
                cursor = db.execute(
                    "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)",
                    (email, display_name, password_digest(password)),
                )
                user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
                headers = self.create_session(db, user["id"])
                return {"user": public_user(user)}, HTTPStatus.CREATED, headers
            pending = db.execute("SELECT created_at FROM pending_email_verifications WHERE email = ?", (email,)).fetchone()
            if pending and int(time.time()) - pending["created_at"] < 60:
                raise APIError(HTTPStatus.TOO_MANY_REQUESTS, "Подожди минуту перед повторной отправкой кода.")
            code = f"{secrets.randbelow(1_000_000):06d}"
            db.execute(
                "INSERT OR REPLACE INTO pending_email_verifications "
                "(email, display_name, password_hash, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
                (email, display_name, password_digest(password), email_code_hash(email, code),
                 int(time.time()) + EMAIL_CODE_TTL, int(time.time())),
            )
            send_verification_email(email, display_name, code)
            return {"verification_required": True, "email": email}, HTTPStatus.ACCEPTED, []

        if method == "POST" and path == "/api/verify-email":
            data = self.read_json()
            email = self.valid_email(data.get("email"))
            code = data.get("code")
            if not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
                raise APIError(HTTPStatus.BAD_REQUEST, "Введи шестизначный код из письма.")
            pending = db.execute("SELECT * FROM pending_email_verifications WHERE email = ?", (email,)).fetchone()
            if not pending or pending["expires_at"] < int(time.time()):
                db.execute("DELETE FROM pending_email_verifications WHERE email = ?", (email,))
                raise APIError(HTTPStatus.GONE, "Код истёк. Начни регистрацию заново.")
            if pending["attempts"] >= EMAIL_CODE_MAX_ATTEMPTS:
                db.execute("DELETE FROM pending_email_verifications WHERE email = ?", (email,))
                raise APIError(HTTPStatus.TOO_MANY_REQUESTS, "Слишком много попыток. Начни регистрацию заново.")
            if not hmac.compare_digest(pending["code_hash"], email_code_hash(email, code)):
                db.execute("UPDATE pending_email_verifications SET attempts = attempts + 1 WHERE email = ?", (email,))
                raise APIError(HTTPStatus.UNAUTHORIZED, "Неверный код подтверждения.")
            cursor = db.execute(
                "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)",
                (email, pending["display_name"], pending["password_hash"]),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
            db.execute("DELETE FROM pending_email_verifications WHERE email = ?", (email,))
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
            bio = self.valid_text(data.get("bio", ""), "О себе", 0, 300)
            avatar_url = data.get("avatar_url", user["avatar_url"] if "avatar_url" in user.keys() else "")
            if not isinstance(avatar_url, str) or len(avatar_url) > 800000:
                raise APIError(HTTPStatus.BAD_REQUEST, "Изображение слишком большое. Максимум 550 КБ.")
            if avatar_url and not re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}", avatar_url):
                raise APIError(HTTPStatus.BAD_REQUEST, "Поддерживаются только PNG, JPG и WebP.")
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
                "UPDATE users SET display_name = ?, email = ?, bio = ?, avatar_url = ? WHERE id = ?",
                (display_name, email, bio, avatar_url, user["id"]),
            )
            updated = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            return {"user": public_user(updated)}, HTTPStatus.OK, []

        if method == "DELETE" and path == "/api/account":
            user = self.current_user(db, required=True)
            data = self.read_json()
            current_password = data.get("current_password")
            if not isinstance(current_password, str) or not verify_password(current_password, user["password_hash"]):
                raise APIError(HTTPStatus.UNAUTHORIZED, "Текущий пароль введён неверно.")
            db.execute("DELETE FROM users WHERE id = ?", (user["id"],))
            expired_cookie = self.cookie_headers("", 0)
            return {"ok": True}, HTTPStatus.OK, expired_cookie

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

        catalog_match = re.fullmatch(
            r"/api/catalog/games(?:/([a-z0-9-]+))?(?:/(rating|presence))?", path
        )
        if catalog_match and method == "GET" and not catalog_match.group(1) and catalog_match.group(2) is None:
            user = self.current_user(db)
            now = int(time.time())
            db.execute("DELETE FROM game_catalog_presence WHERE expires_at <= ?", (now,))
            games = db.execute(
                """
                SELECT game_catalog.*,
                    COALESCE(rating_stats.rating, 0) AS rating,
                    COALESCE(rating_stats.rating_count, 0) AS rating_count,
                    (SELECT COUNT(*) FROM game_catalog_presence
                     WHERE game_slug = game_catalog.slug AND expires_at > ?) AS active_viewers,
                    (SELECT rating FROM game_catalog_ratings
                     WHERE game_slug = game_catalog.slug AND user_id = ?) AS user_rating
                FROM game_catalog
                LEFT JOIN (
                    SELECT game_slug, AVG(rating) AS rating, COUNT(*) AS rating_count
                    FROM game_catalog_ratings GROUP BY game_slug
                ) AS rating_stats ON rating_stats.game_slug = game_catalog.slug
                ORDER BY CASE WHEN slug = 'dnd' THEN 0 ELSE 1 END, title COLLATE NOCASE
                """,
                (now, user["id"] if user else None),
            ).fetchall()
            return {
                "games": [
                    game_catalog_record(
                        dict(game),
                        rating=game["rating"],
                        rating_count=game["rating_count"],
                        active_viewers=game["active_viewers"],
                        user_rating=game["user_rating"],
                    )
                    for game in games
                ]
            }, HTTPStatus.OK, []

        if catalog_match and method == "GET" and catalog_match.group(1) and catalog_match.group(2) is None:
            slug = catalog_match.group(1)
            user = self.current_user(db)
            now = int(time.time())
            db.execute("DELETE FROM game_catalog_presence WHERE expires_at <= ?", (now,))
            game = db.execute(
                """
                SELECT game_catalog.*,
                    COALESCE((SELECT AVG(rating) FROM game_catalog_ratings
                              WHERE game_slug = game_catalog.slug), 0) AS rating,
                    (SELECT COUNT(*) FROM game_catalog_ratings
                     WHERE game_slug = game_catalog.slug) AS rating_count,
                    (SELECT COUNT(*) FROM game_catalog_presence
                     WHERE game_slug = game_catalog.slug AND expires_at > ?) AS active_viewers,
                    (SELECT rating FROM game_catalog_ratings
                     WHERE game_slug = game_catalog.slug AND user_id = ?) AS user_rating
                FROM game_catalog WHERE slug = ?
                """,
                (now, user["id"] if user else None, slug),
            ).fetchone()
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Игра не найдена в каталоге.")
            rooms = db.execute(
                """
                SELECT games.*,
                    (SELECT COUNT(*) FROM game_participants WHERE game_id = games.id) AS member_count,
                    (SELECT COUNT(*) FROM game_characters WHERE game_id = games.id) AS hero_count,
                    EXISTS(SELECT 1 FROM game_participants
                           WHERE game_id = games.id AND user_id = ?) AS is_member,
                    (games.owner_id = ?) AS is_owner
                FROM games
                WHERE games.catalog_game_slug = ?
                    AND games.access = 'public'
                ORDER BY games.updated_at DESC, games.id DESC
                """,
                (
                    user["id"] if user else -1,
                    user["id"] if user else -1,
                    slug,
                ),
            ).fetchall()
            private_rooms = db.execute(
                """
                SELECT games.*,
                    (SELECT COUNT(*) FROM game_participants WHERE game_id = games.id) AS member_count,
                    (SELECT COUNT(*) FROM game_characters WHERE game_id = games.id) AS hero_count,
                    1 AS is_member,
                    1 AS is_owner
                FROM games
                WHERE games.catalog_game_slug = ?
                    AND games.access IN ('private', 'invite_only')
                    AND games.owner_id = ?
                ORDER BY games.updated_at DESC, games.id DESC
                """,
                (slug, user["id"] if user else -1),
            ).fetchall() if user else []
            return {
                "game": game_catalog_record(
                    dict(game),
                    rating=game["rating"],
                    rating_count=game["rating_count"],
                    active_viewers=game["active_viewers"],
                    user_rating=game["user_rating"],
                ),
                "rooms": [
                    game_record_row(dict(room), user_id=user["id"] if user else None)
                    for room in rooms
                ],
                "private_rooms": [
                    game_record_row(dict(room), user_id=user["id"])
                    for room in private_rooms
                ],
            }, HTTPStatus.OK, []

        if catalog_match and method == "POST" and catalog_match.group(1):
            slug, action = catalog_match.groups()
            game = db.execute("SELECT slug FROM game_catalog WHERE slug = ?", (slug,)).fetchone()
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Игра не найдена в каталоге.")
            data = self.read_json()
            if action == "rating":
                user = self.current_user(db, required=True)
                rating = data.get("rating")
                if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Оценка должна быть от 1 до 5.")
                db.execute(
                    """
                    INSERT INTO game_catalog_ratings (game_slug, user_id, rating)
                    VALUES (?, ?, ?)
                    ON CONFLICT(game_slug, user_id) DO UPDATE SET
                        rating = excluded.rating,
                        created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    """,
                    (slug, user["id"], rating),
                )
                summary = db.execute(
                    "SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS rating_count "
                    "FROM game_catalog_ratings WHERE game_slug = ?",
                    (slug,),
                ).fetchone()
                return {
                    "rating": summary["rating"],
                    "rating_count": summary["rating_count"],
                    "user_rating": rating,
                }, HTTPStatus.OK, []
            if action == "presence":
                viewer_token = data.get("viewer_token")
                if not isinstance(viewer_token, str) or not re.fullmatch(
                    r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}",
                    viewer_token,
                    re.IGNORECASE,
                ):
                    raise APIError(HTTPStatus.BAD_REQUEST, "Не удалось подтвердить присутствие.")
                now = int(time.time())
                db.execute("DELETE FROM game_catalog_presence WHERE expires_at <= ?", (now,))
                db.execute(
                    """
                    INSERT INTO game_catalog_presence (game_slug, viewer_token, expires_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(game_slug, viewer_token) DO UPDATE SET expires_at = excluded.expires_at
                    """,
                    (slug, viewer_token, now + GAME_CATALOG_PRESENCE_SECONDS),
                )
                count = db.execute(
                    "SELECT COUNT(*) AS total FROM game_catalog_presence "
                    "WHERE game_slug = ? AND expires_at > ?",
                    (slug, now),
                ).fetchone()["total"]
                return {"active_viewers": count}, HTTPStatus.OK, []

        if method == "POST" and path == "/api/games/enter":
            user = self.current_user(db, required=True)
            payload = self.read_json()
            code = str(payload.get("code") or "").strip().upper()
            owner_name = self.valid_text(payload.get("owner_name"), "Ник владельца", 1, 60)
            owner_name_key = normalize_game_owner_name(owner_name)
            matches = db.execute(
                """
                SELECT games.*, users.display_name AS owner_name
                FROM games
                JOIN users ON users.id = games.owner_id
                WHERE games.access IN ('private', 'invite_only')
                    AND games.join_code = ?
                """,
                (code,),
            ).fetchall()
            matches = [
                game for game in matches
                if normalize_game_owner_name(game["owner_name"]) == owner_name_key
            ]
            if len(matches) != 1:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната с таким кодом и ником владельца не найдена.")
            game = matches[0]
            db.execute(
                """
                INSERT INTO game_participants (game_id, user_id, role, status, joined_at)
                VALUES (?, ?, 'player', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                ON CONFLICT(game_id, user_id) DO NOTHING
                """,
                (game["id"], user["id"]),
            )
            return {
                "game_id": game["id"],
                "catalog_game_slug": game["catalog_game_slug"] or "",
            }, HTTPStatus.OK, []

        if method == "GET" and path == "/api/games":
            user = self.current_user(db)
            visible_games = db.execute(
                "SELECT * FROM games WHERE access = 'public' ORDER BY updated_at DESC, id DESC"
            ).fetchall()
            result = []
            for game in visible_games:
                member_count = db.execute(
                    "SELECT COUNT(*) AS total FROM game_participants WHERE game_id = ?",
                    (game["id"],),
                ).fetchone()["total"]
                hero_count = db.execute(
                    "SELECT COUNT(*) AS total FROM game_characters WHERE game_id = ?",
                    (game["id"],),
                ).fetchone()["total"]
                is_owner = user is not None and game["owner_id"] == user["id"]
                is_member = user is not None and bool(
                    db.execute(
                        "SELECT 1 FROM game_participants WHERE game_id = ? AND user_id = ?",
                        (game["id"], user["id"]),
                    ).fetchone()
                )
                result.append(game_record_row({
                    "id": game["id"],
                    "owner_id": game["owner_id"],
                    "name": game["name"],
                    "title": game["title"] or game["name"],
                    "room_name": game["room_name"] or game["name"],
                    "catalog_game_slug": game["catalog_game_slug"],
                    "description": game["description"],
                    "access": game["access"],
                    "join_code": game["join_code"],
                    "combat": json.loads(game["combat_state"] or "{}") or None,
                    "created_at": game["created_at"],
                    "updated_at": game["updated_at"],
                    "member_count": member_count,
                    "hero_count": hero_count,
                    "is_member": is_member,
                    "is_owner": is_owner,
                }, user_id=user["id"] if user else None))
            return {"games": result}, HTTPStatus.OK, []

        game_match = re.fullmatch(r"/api/games/(\d+)", path)
        if method == "DELETE" and game_match:
            user = self.current_user(db, required=True)
            game_id = int(game_match.group(1))
            game = db.execute("SELECT owner_id FROM games WHERE id = ?", (game_id,)).fetchone()
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            if game["owner_id"] != user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Удалить комнату может только её создатель.")
            db.execute("DELETE FROM games WHERE id = ?", (game_id,))
            return {"ok": True}, HTTPStatus.OK, []

        if method == "GET" and game_match:
            user = self.current_user(db)
            game_id = int(game_match.group(1))
            game = db.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            is_owner = user is not None and game["owner_id"] == user["id"]
            is_member = user is not None and bool(db.execute(
                "SELECT 1 FROM game_participants WHERE game_id = ? AND user_id = ?",
                (game_id, user["id"]),
            ).fetchone())
            if game["access"] != "public" and (
                user is None
                or (not is_owner and not is_member)
            ):
                raise APIError(HTTPStatus.FORBIDDEN, "У тебя нет доступа к этой комнате.")
            members = db.execute(
                "SELECT * FROM game_participants WHERE game_id = ? ORDER BY joined_at DESC, id DESC",
                (game_id,),
            ).fetchall()
            characters = db.execute(
                "SELECT * FROM game_characters WHERE game_id = ? ORDER BY level DESC, xp DESC, name ASC",
                (game_id,),
            ).fetchall()
            sessions = db.execute(
                "SELECT * FROM game_sessions WHERE game_id = ? ORDER BY created_at DESC, id DESC",
                (game_id,),
            ).fetchall()
            game_payload = game_record_row({
                "id": game["id"],
                "owner_id": game["owner_id"],
                "name": game["name"],
                "title": game["title"] or game["name"],
                "room_name": game["room_name"] or game["name"],
                "catalog_game_slug": game["catalog_game_slug"],
                "description": game["description"],
                "access": game["access"],
                "join_code": game["join_code"],
                "created_at": game["created_at"],
                "updated_at": game["updated_at"],
                "member_count": len(members),
                "hero_count": len(characters),
                "is_member": is_member,
                "is_owner": is_owner,
                "participants": [{
                    "id": member["id"],
                    "game_id": member["game_id"],
                    "user_id": member["user_id"],
                    "role": member["role"],
                    "status": member["status"],
                    "joined_at": member["joined_at"],
                } for member in members],
                "heroes": [game_character_record(dict(character)) for character in characters],
                "sessions": [{
                    "id": session["id"],
                    "game_id": session["game_id"],
                    "user_id": session["user_id"],
                    "title": session["title"],
                    "xp_awarded": session["xp_awarded"],
                    "notes": session["notes"],
                    "created_at": session["created_at"],
                } for session in sessions],
            }, user_id=user["id"] if user else None)
            return {
                "game": game_payload,
                "members": [{
                    "id": member["id"],
                    "game_id": member["game_id"],
                    "user_id": member["user_id"],
                    "role": member["role"],
                    "status": member["status"],
                    "joined_at": member["joined_at"],
                } for member in members],
                "heroes": [game_character_record(dict(character)) for character in characters],
                "sessions": [{
                    "id": session["id"],
                    "game_id": session["game_id"],
                    "user_id": session["user_id"],
                    "title": session["title"],
                    "xp_awarded": session["xp_awarded"],
                    "notes": session["notes"],
                    "created_at": session["created_at"],
                } for session in sessions],
            }, HTTPStatus.OK, []

        if method == "GET" and path == "/api/my/games":
            user = self.current_user(db, required=True)
            games = db.execute(
                "SELECT * FROM games WHERE owner_id = ? OR id IN (SELECT game_id FROM game_participants WHERE user_id = ?) ORDER BY updated_at DESC, id DESC",
                (user["id"], user["id"]),
            ).fetchall()
            return {"games": [game_record_row({
                "id": game["id"],
                "owner_id": game["owner_id"],
                "name": game["name"],
                "title": game["title"] or game["name"],
                "room_name": game["room_name"] or game["name"],
                "catalog_game_slug": game["catalog_game_slug"],
                "description": game["description"],
                "access": game["access"],
                "join_code": game["join_code"],
                "created_at": game["created_at"],
                "updated_at": game["updated_at"],
                "member_count": db.execute("SELECT COUNT(*) AS total FROM game_participants WHERE game_id = ?", (game["id"],)).fetchone()["total"],
                "hero_count": db.execute("SELECT COUNT(*) AS total FROM game_characters WHERE game_id = ?", (game["id"],)).fetchone()["total"],
                "is_member": True,
                "is_owner": game["owner_id"] == user["id"],
            }, user_id=user["id"]) for game in games]}, HTTPStatus.OK, []

        if method == "POST" and path == "/api/games":
            user = self.current_user(db, required=True)
            data = self.read_json()
            name = self.valid_text(data.get("name") or data.get("title") or data.get("room_name"), "Название комнаты", 1, 80)
            description = self.valid_text(data.get("description", ""), "Описание", 0, 500)
            access = normalize_game_access(data.get("access", "public"))
            join_code = str(data.get("join_code") or "").strip().upper()
            catalog_game_slug = data.get("catalog_game_slug")
            if catalog_game_slug is not None:
                if not isinstance(catalog_game_slug, str) or db.execute(
                    "SELECT 1 FROM game_catalog WHERE slug = ?", (catalog_game_slug,)
                ).fetchone() is None:
                    raise APIError(HTTPStatus.BAD_REQUEST, "Игра не найдена в каталоге.")
            if access in {"private", "invite_only"} and not join_code:
                join_code = secrets.token_hex(4).upper()
            cursor = db.execute(
                "INSERT INTO games (owner_id, name, title, room_name, description, access, join_code, catalog_game_slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (user["id"], name, name, name, description, access, join_code, catalog_game_slug),
            )
            game_id = cursor.lastrowid
            db.execute(
                "INSERT INTO game_participants (game_id, user_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                (game_id, user["id"]),
            )
            game = db.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            return {"game": game_record_row({
                "id": game["id"],
                "owner_id": game["owner_id"],
                "name": game["name"],
                "title": game["title"] or game["name"],
                "room_name": game["room_name"] or game["name"],
                "catalog_game_slug": game["catalog_game_slug"],
                "description": game["description"],
                "access": game["access"],
                "join_code": game["join_code"],
                "created_at": game["created_at"],
                "updated_at": game["updated_at"],
                "member_count": 1,
                "hero_count": 0,
                "is_member": True,
                "is_owner": True,
            }, user_id=user["id"])}, HTTPStatus.CREATED, []

        character_match = re.fullmatch(r"/api/games/(\d+)/characters/(\d+)", path)
        if method == "PATCH" and character_match:
            user = self.current_user(db, required=True)
            game_id, target_user_id = map(int, character_match.groups())
            game = db.execute("SELECT owner_id FROM games WHERE id = ?", (game_id,)).fetchone()
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            if game["owner_id"] != user["id"] and target_user_id != user["id"]:
                raise APIError(HTTPStatus.FORBIDDEN, "Изменять лист героя может сам игрок или ведущий.")
            character = db.execute(
                "SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?",
                (game_id, target_user_id),
            ).fetchone()
            if character is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Герой участника не найден.")
            payload = self.read_json()
            if game["owner_id"] != user["id"] and set(payload) - {"inventory", "spells"}:
                raise APIError(HTTPStatus.FORBIDDEN, "Игрок может менять только свой инвентарь и список заклинаний.")
            stats = game_character_stats(payload, dict(character))
            loadout = game_character_loadout(payload, dict(character))
            spell_slots = game_character_spell_slots(payload, dict(character))
            db.execute(
                """
                UPDATE game_characters
                SET strength = ?, dexterity = ?, constitution = ?, intelligence = ?,
                    wisdom = ?, charisma = ?, hp = ?, max_hp = ?, armor_class = ?,
                    inventory = ?, spells = ?, spell_slots_max = ?, spell_slots = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE game_id = ? AND user_id = ?
                """,
                (*stats.values(), json.dumps(loadout["inventory"], ensure_ascii=False),
                 json.dumps(loadout["spells"], ensure_ascii=False),
                 json.dumps(spell_slots["spell_slots_max"]), json.dumps(spell_slots["spell_slots"]), game_id, target_user_id),
            )
            updated_character = db.execute(
                "SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?",
                (game_id, target_user_id),
            ).fetchone()
            return {"character": game_character_record(dict(updated_character))}, HTTPStatus.OK, []

        game_action_match = re.fullmatch(r"/api/games/(\d+)/(join|leave|characters|heroes|sessions|xp|join-code|combat)", path)
        if method in {"POST", "DELETE"} and game_action_match:
            user = self.current_user(db, required=True)
            game = db.execute("SELECT * FROM games WHERE id = ?", (int(game_action_match.group(1)),)).fetchone()
            if game is None:
                raise APIError(HTTPStatus.NOT_FOUND, "Комната не найдена.")
            game_id = game["id"]
            action = game_action_match.group(2)
            if action == "combat":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Управлять боем может только ведущий.")
                payload = self.read_json()
                heroes = [dict(row) for row in db.execute("SELECT * FROM game_characters WHERE game_id = ?", (game_id,)).fetchall()]
                existing_combat = json.loads(game["combat_state"] or "{}")
                combat = game_combat_transition(str(payload.get("action") or ""), payload, heroes, existing_combat)
                if combat and payload.get("action") in ("damage", "heal"):
                    for fighter in combat.get("combatants", []):
                        if fighter.get("kind") == "hero" and fighter.get("hp") is not None:
                            db.execute(
                                "UPDATE game_characters SET hp = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE game_id = ? AND user_id = ?",
                                (fighter["hp"], game_id, fighter["user_id"]),
                            )
                db.execute(
                    "UPDATE games SET combat_state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                    (json.dumps(combat or {}, ensure_ascii=False), game_id),
                )
                return {"combat": combat}, HTTPStatus.OK, []
            if action == "join-code":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Только владелец комнаты может менять код доступа.")
                payload = self.read_json()
                requested = str(payload.get("join_code") or payload.get("code") or "").strip().upper()
                access = normalize_game_access(game["access"])
                if access == "public":
                    new_code = ""
                elif requested:
                    if not re.fullmatch(r"[A-Z0-9-]{4,32}", requested):
                        raise APIError(HTTPStatus.BAD_REQUEST, "Код доступа должен содержать 4–32 символа из латиницы, цифр и тире.")
                    new_code = requested
                else:
                    new_code = f"{secrets.token_hex(4).upper()}-{game_id}"
                db.execute(
                    "UPDATE games SET join_code = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                    (new_code, game_id),
                )
                refreshed = db.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
                return {"game": game_record_row({
                    "id": refreshed["id"],
                    "owner_id": refreshed["owner_id"],
                    "name": refreshed["name"],
                    "title": refreshed["title"] or refreshed["name"],
                    "room_name": refreshed["room_name"] or refreshed["name"],
                    "description": refreshed["description"],
                    "access": refreshed["access"],
                    "join_code": refreshed["join_code"],
                    "created_at": refreshed["created_at"],
                    "updated_at": refreshed["updated_at"],
                    "member_count": db.execute("SELECT COUNT(*) AS count FROM game_participants WHERE game_id = ?", (game_id,)).fetchone()["count"],
                    "hero_count": db.execute("SELECT COUNT(*) AS count FROM game_characters WHERE game_id = ?", (game_id,)).fetchone()["count"],
                    "is_member": True,
                    "is_owner": True,
                }, user_id=user["id"])}, HTTPStatus.OK, []
            if action == "join":
                if game["owner_id"] != user["id"] and db.execute(
                    "SELECT 1 FROM game_characters WHERE game_id = ? AND user_id = ?",
                    (game_id, user["id"]),
                ).fetchone() is None:
                    raise APIError(HTTPStatus.FORBIDDEN, "Сначала создай и сохрани персонажа, затем вступай в комнату.")
                existing = db.execute(
                    "SELECT 1 FROM game_participants WHERE game_id = ? AND user_id = ?",
                    (game_id, user["id"]),
                ).fetchone()
                if existing is not None:
                    return {"ok": True, "joined": True}, HTTPStatus.OK, []
                if game["access"] in {"private", "invite_only"}:
                    payload = self.read_json()
                    supplied = str(payload.get("code") or payload.get("join_code") or "").strip().upper()
                    required = str(game["join_code"] or "").strip().upper()
                    owner_name = self.valid_text(payload.get("owner_name"), "Ник владельца", 1, 60)
                    owner = db.execute(
                        "SELECT display_name FROM users WHERE id = ?",
                        (game["owner_id"],),
                    ).fetchone()
                    if (
                        not required
                        or supplied != required
                        or owner is None
                        or normalize_game_owner_name(owner["display_name"])
                        != normalize_game_owner_name(owner_name)
                    ):
                        raise APIError(HTTPStatus.FORBIDDEN, "Неверный код доступа к комнате.")
                db.execute(
                    "INSERT INTO game_participants (game_id, user_id, role, status, joined_at) VALUES (?, ?, 'player', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                    (game_id, user["id"]),
                )
                return {"ok": True, "joined": True}, HTTPStatus.OK, []
            if action == "leave":
                if game["owner_id"] == user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Владелец комнаты не может её покинуть.")
                db.execute(
                    "DELETE FROM game_participants WHERE game_id = ? AND user_id = ?",
                    (game_id, user["id"]),
                )
                db.execute("DELETE FROM game_characters WHERE game_id = ? AND user_id = ?", (game_id, user["id"]))
                return {"ok": True}, HTTPStatus.OK, []
            if action in {"characters", "heroes"}:
                if game["owner_id"] == user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Ведущий не создаёт персонажа в своей комнате.")
                payload = self.read_json()
                name = self.valid_text(payload.get("name") or payload.get("hero_name"), "Имя героя", 1, 80)
                race = validate_dnd_race(payload.get("race"))
                existing = db.execute(
                    "SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?",
                    (game_id, user["id"]),
                ).fetchone()
                if existing is None:
                    stats = generate_random_character_stats()
                    cursor = db.execute(
                        """
                        INSERT INTO game_characters (
                            game_id, user_id, name, class_name, archetype, race, level, xp,
                            strength, dexterity, constitution, intelligence, wisdom, charisma,
                            hp, max_hp, armor_class, created_at, updated_at
                        ) VALUES (?, ?, ?, '', '', ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                        """,
                        (game_id, user["id"], name, race, *stats.values()),
                    )
                    character = db.execute("SELECT * FROM game_characters WHERE id = ?", (cursor.lastrowid,)).fetchone()
                else:
                    db.execute(
                        "UPDATE game_characters SET name = ?, race = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                        (name, race, existing["id"]),
                    )
                    character = db.execute("SELECT * FROM game_characters WHERE id = ?", (existing["id"],)).fetchone()
                return {"character": game_character_record(dict(character))}, HTTPStatus.CREATED, []
            if action == "sessions":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Только ведущий может вести сессию.")
                payload = self.read_json()
                title = self.valid_text(payload.get("title") or "Сессия", "Название сессии", 1, 120)
                xp_awarded = int(payload.get("xp_awarded", 0) or 0)
                target_user_id = payload.get("user_id")
                if target_user_id is not None:
                    target_user_id = int(target_user_id)
                else:
                    target_user_id = user["id"]
                note = self.valid_text(payload.get("notes", ""), "Заметки", 0, 500)
                participant = db.execute(
                    "SELECT 1 FROM game_participants WHERE game_id = ? AND user_id = ?",
                    (game_id, target_user_id),
                ).fetchone()
                if participant is None and game["owner_id"] != target_user_id:
                    raise APIError(HTTPStatus.NOT_FOUND, "Участник комнаты не найден.")
                cursor = db.execute(
                    "INSERT INTO game_sessions (game_id, host_user_id, user_id, title, xp_awarded, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                    (game_id, user["id"], target_user_id, title, xp_awarded, note),
                )
                session_id = cursor.lastrowid
                if xp_awarded > 0:
                    character = db.execute(
                        "SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?",
                        (game_id, target_user_id),
                    ).fetchone()
                    if character is None:
                        raise APIError(HTTPStatus.NOT_FOUND, "Герой участника не найден.")
                    new_xp = int(character["xp"]) + xp_awarded
                    db.execute(
                        "UPDATE game_characters SET xp = ?, level = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                        (new_xp, calculate_character_level(new_xp), character["id"]),
                    )
                    db.execute(
                        "INSERT INTO xp_history (game_id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                        (game_id, target_user_id, xp_awarded, title),
                    )
                session = db.execute("SELECT * FROM game_sessions WHERE id = ?", (session_id,)).fetchone()
                return {"session": {
                    "id": session["id"],
                    "game_id": session["game_id"],
                    "user_id": session["user_id"],
                    "title": session["title"],
                    "xp_awarded": session["xp_awarded"],
                    "notes": session["notes"],
                    "created_at": session["created_at"],
                }}, HTTPStatus.CREATED, []
            if action == "xp":
                if game["owner_id"] != user["id"]:
                    raise APIError(HTTPStatus.FORBIDDEN, "Только ведущий может выдавать XP.")
                payload = self.read_json()
                target_user_id = int(payload.get("user_id"))
                amount = max(0, int(payload.get("amount", 0) or 0))
                reason = self.valid_text(payload.get("reason", "Награда"), "Причина", 0, 200)
                character = db.execute(
                    "SELECT * FROM game_characters WHERE game_id = ? AND user_id = ?",
                    (game_id, target_user_id),
                ).fetchone()
                if character is None:
                    raise APIError(HTTPStatus.NOT_FOUND, "Герой участника не найден.")
                new_xp = int(character["xp"]) + amount
                db.execute(
                    "UPDATE game_characters SET xp = ?, level = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                    (new_xp, calculate_character_level(new_xp), character["id"]),
                )
                db.execute(
                    "INSERT INTO xp_history (game_id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                    (game_id, target_user_id, amount, reason),
                )
                return {"ok": True, "xp": new_xp}, HTTPStatus.OK, []

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
        if not candidate.is_file() and (
            path.rstrip("/") in {
                "/catalog",
                "/authors",
                "/club",
                "/games",
                "/library",
                "/settings",
            }
            or re.fullmatch(r"/games/[a-z0-9-]+(?:/play)?/?", path)
        ):
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
        request_query = urlsplit(request_path).query
        is_versioned_asset = candidate.suffix in {".css", ".js", ".svg"} and bool(
            re.search(r"(?:^|&)v=[A-Za-z0-9._-]+(?:&|$)", request_query)
        )
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Cache-Control",
            "public, max-age=31536000, immutable" if is_versioned_asset else "no-cache",
        )
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
