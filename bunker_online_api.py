"""MongoDB-backed multiplayer BunkerOnline API. Human accounts only."""
import secrets
import time
from http import HTTPStatus

from bunker_cards import BUNKER_CARD_POOLS, bunker_random_age
from bunker_online_rules import human_members, private_cards_for_user, validate_human_lobby_start

BUNKER_PRESENCE_WRITE_INTERVAL_SECONDS = 10

BUNKER_SCENARIOS = {
    "classic": ("Классическая катастрофа", "Глобальный кризис разрушил привычную цивилизацию. Ресурсы ограничены, а убежище рассчитано не на всех."),
    "nuclear": ("Ядерная зима", "После обмена ядерными ударами поверхность заражена радиацией, температура падает, а запасы энергии ограничены."),
    "zombie": ("Зомби-апокалипсис", "Заражённые заполонили города. Шум привлекает орды, а укус может стать приговором."),
    "pandemic": ("Смертельная пандемия", "Неизвестный патоген распространяется воздушно-капельным путём. Вакцины почти закончились."),
    "ice": ("Вечная мерзлота", "Климатическая катастрофа заморозила континенты. Без тепла и топлива долго не продержаться."),
    "aliens": ("Вторжение извне", "Неизвестная цивилизация контролирует поверхность. Любой радиосигнал может выдать убежище."),
    "eco": ("Экологический коллапс", "Вода отравлена, почва непригодна для земледелия, а воздух опасен без фильтрации."),
    "volcano": ("Супервулкан", "Пепел закрыл солнце на годы. Урожай погибает, а системы вентиляции забиваются."),
}
BUNKER_DIFFICULTIES = {
    "easy": ("Лёгкая", 0.18), "normal": ("Обычная", 0.32),
    "hard": ("Высокая", 0.50), "extreme": ("Экстремальная", 0.68),
}
BUNKER_EVENTS = [
    ("АВАРИЯ ГЕНЕРАТОРА", "Энергии хватит только на один сектор. Кто сможет восстановить питание?"),
    ("ЗАПАСЫ НА ИСХОДЕ", "Часть продовольствия испорчена. Нужно пересмотреть распределение ресурсов."),
    ("РАДИОСИГНАЛ", "Снаружи поступил слабый сигнал. Возможно, рядом есть другие выжившие."),
    ("УТЕЧКА", "В техническом отсеке обнаружен неизвестный газ. Шлюз временно заблокирован."),
    ("НЕИЗВЕСТНЫЙ ГОСТЬ", "Датчики зафиксировали движение у входа. Кто-то просит открыть шлюз."),
    ("СБОЙ СВЯЗИ", "Внешняя связь нестабильна. Следующее сообщение может стать последним."),
]

def belongs_to_human_id(item, human_ids):
    try:
        return int(item.get("user_id", 0)) in human_ids
    except (AttributeError, TypeError, ValueError):
        return False


def bunker_presence_refresh_due(member, now):
    try:
        last_seen = int(member.get("last_seen", 0) or 0)
    except (TypeError, ValueError):
        last_seen = 0
    return now - last_seen >= BUNKER_PRESENCE_WRITE_INTERVAL_SECONDS

def human_voting(voting, human_ids):
    if not isinstance(voting, dict):
        return voting
    safe = dict(voting)
    votes = {}
    for voter, target in (voting.get("votes") or {}).items():
        try:
            voter_id, target_id = int(voter), int(target)
        except (TypeError, ValueError):
            continue
        if voter_id in human_ids and target_id in human_ids:
            votes[str(voter_id)] = target_id
    safe["votes"] = votes
    safe["tied_targets"] = [
        int(value) for value in voting.get("tied_targets", [])
        if str(value).lstrip("-").isdigit() and int(value) in human_ids
    ]
    return safe


def bunker_public_room(room, user_id):
    members = human_members(room.get("members", []))
    human_ids = {member["user_id"] for member in members}
    def belongs_to_human(item):
        try:
            return int(item.get("user_id", 0)) in human_ids
        except (AttributeError, TypeError, ValueError):
            return False
    players = []
    for item in room.get("players", []):
        if belongs_to_human(item):
            clean = dict(item)
            clean.pop("is_bot", None)
            clean.pop("bot_style", None)
            players.append(clean)
    revealed_cards = []
    for item in room.get("revealed_cards", []):
        if belongs_to_human(item):
            clean = dict(item)
            clean.pop("is_bot", None)
            revealed_cards.append(clean)
    chat = [dict(item) for item in room.get("chat", []) if isinstance(item, dict) and not item.get("is_bot")]
    survivors = [dict(item) for item in room.get("survivors", []) if belongs_to_human(item)]
    return {
        "code": room["code"], "status": room.get("status", "lobby"),
        "host_id": room["host_id"], "max_players": room.get("max_players", 10),
        "members": [{
            "user_id": m["user_id"], "name": m.get("name", "Игрок"),
            "avatar_url": m.get("avatar_url", ""), "role": m.get("role", "player"),
            "ready": bool(m.get("ready")),
            "online": int(time.time()) - int(m.get("last_seen", 0)) < 35,
            
        } for m in members],
        "scenario": room.get("scenario"), "difficulty": room.get("difficulty"),
        "round": room.get("round", 0), "capacity": room.get("capacity"),
        "disaster": room.get("disaster"), "revealed_cards": revealed_cards,
        "chat": chat[-60:], "event": room.get("event"),
        "voting": human_voting(room.get("voting"), human_ids), "result": room.get("result"),
        "players": players, "survivors": survivors,
        
        "finished_at": room.get("finished_at"),
        "my_cards": private_cards_for_user(room, user_id),
        "is_host": int(room["host_id"]) == int(user_id),
        "my_user_id": int(user_id),
        "my_ready": bool(next((m.get("ready") for m in members if int(m["user_id"]) == int(user_id)), False)),
    }

def bunker_make_cards(difficulty):
    bad_probability = BUNKER_DIFFICULTIES[difficulty][1]
    labels = {
        "profession": "Профессия", "age": "Возраст", "health": "Здоровье",
        "hobby": "Хобби", "baggage": "Багаж", "fact": "Особенность",
    }
    cards = []
    for category in ("profession", "age", "health", "hobby", "baggage", "fact"):
        is_bad = secrets.randbelow(10000) < int(bad_probability * 10000)
        if category == "age":
            value = bunker_random_age(negative=is_bad)
            # An anomalous age is always treated as a negative dossier card.
            is_bad = is_bad or value > 120
        else:
            good, bad = BUNKER_CARD_POOLS[category]
            value = secrets.choice(bad if is_bad else good)
        cards.append({
            "category": category,
            "label": labels[category],
            "value": value if category != "age" else f"{value} лет",
            "negative": is_bad,
            "revealed": False,
        })
    return cards

def dispatch_bunker_api(handler, db, method, path, api_error, mongodb_enabled):
    if not mongodb_enabled:
        raise api_error(HTTPStatus.SERVICE_UNAVAILABLE, "Для сетевой игры требуется подключённая база данных Biblio.")
    user = handler.current_user_mongo(db, required=True)
    user_id = int(user["id"])
    name = str(user.get("display_name") or "Игрок")[:60]
    avatar = str(user.get("avatar_url") or "")[:500]
    now = int(time.time())
    parts = path.strip("/").split("/")
    if method == "POST" and path == "/api/bunker/rooms":
        data = handler.read_json()
        try:
            max_players = int(data.get("max_players", 10))
        except (TypeError, ValueError):
            raise api_error(HTTPStatus.BAD_REQUEST, "Некорректное количество игроков.")
        if not 2 <= max_players <= 16:
            raise api_error(HTTPStatus.BAD_REQUEST, "В комнате может быть от 2 до 16 участников.")
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        members = [{"user_id": user_id, "name": name, "avatar_url": avatar, "role": "host",
                    "ready": True, "joined_at": now, "last_seen": now}]
        room = {"code": code, "host_id": user_id, "status": "lobby", "max_players": max_players,
                "members": members,
                "created_at": now, "updated_at": now, "chat": [], "revealed_cards": [],
                "private_cards": {}, "round": 0}
        db.bunker_rooms.insert_one(room)
        return {"room": bunker_public_room(room, user_id)}, HTTPStatus.CREATED, []
    if len(parts) < 4 or parts[:2] != ["api", "bunker"] or parts[2] != "rooms":
        raise api_error(HTTPStatus.NOT_FOUND, "Маршрут игры не найден.")
    code = parts[3].upper()
    room = db.bunker_rooms.find_one({"code": code})
    if room is None:
        raise api_error(HTTPStatus.NOT_FOUND, "Комната не найдена. Проверь код приглашения.")
    for field in ("members", "players", "revealed_cards", "chat", "survivors", "voting", "private_cards"):
        room["_original_" + field] = room.get(field)
    room["members"] = human_members(room.get("members", []))
    human_ids = {m["user_id"] for m in room["members"]}
    room["players"] = [p for p in room.get("players", []) if belongs_to_human_id(p, human_ids)]
    room["revealed_cards"] = [c for c in room.get("revealed_cards", []) if belongs_to_human_id(c, human_ids)]
    room["chat"] = [m for m in room.get("chat", []) if isinstance(m, dict) and not m.get("is_bot")]
    room["survivors"] = [p for p in room.get("survivors", []) if belongs_to_human_id(p, human_ids)]
    room["voting"] = human_voting(room.get("voting"), human_ids)
    room["private_cards"] = {key: value for key, value in (room.get("private_cards") or {}).items() if key in {str(uid) for uid in human_ids}}
    clean_fields = ("members", "players", "revealed_cards", "chat", "survivors", "voting", "private_cards")
    changed_fields = {
        field: room.get(field)
        for field in clean_fields
        if room.get(field) != room.get("_original_" + field)
    }
    if changed_fields:
        db.bunker_rooms.update_one({"_id": room["_id"]}, {"$set": changed_fields})
    member = next((m for m in room.get("members", []) if int(m["user_id"]) == user_id), None)
    action = parts[4] if len(parts) > 4 else ""
    if method == "POST" and action == "join":
        if room.get("status") != "lobby":
            raise api_error(HTTPStatus.CONFLICT, "Партия уже началась. Войти можно только в комнату ожидания.")
        if not member and len(room.get("members", [])) >= int(room.get("max_players", 10)):
            raise api_error(HTTPStatus.CONFLICT, "В комнате больше нет свободных мест.")
        if member:
            db.bunker_rooms.update_one({"code": code, "members.user_id": user_id},
                {"$set": {"members.$.last_seen": now, "updated_at": now}})
        else:
            db.bunker_rooms.update_one({"code": code, "status": "lobby", "members.user_id": {"$ne": user_id},
                "$expr": {"$lt": [{"$size": "$members"}, "$max_players"]}},
                {"$push": {"members": {"user_id": user_id, "name": name, "avatar_url": avatar,
                    "role": "player", "ready": False, "joined_at": now, "last_seen": now}},
                 "$set": {"updated_at": now}})
        room = db.bunker_rooms.find_one({"code": code})
        if not any(int(m["user_id"]) == user_id for m in room.get("members", [])):
            raise api_error(HTTPStatus.CONFLICT, "Не удалось занять место. Обнови комнату и попробуй снова.")
        return {"room": bunker_public_room(room, user_id)}, HTTPStatus.OK, []
    if method == "POST" and action == "leave":
        if int(room["host_id"]) == user_id:
            db.bunker_rooms.delete_one({"code": code, "host_id": user_id})
        else:
            db.bunker_rooms.update_one({"code": code}, {
                "$pull": {
                    "members": {"user_id": user_id},
                    "players": {"user_id": user_id},
                    "revealed_cards": {"user_id": user_id},
                    "survivors": {"user_id": user_id},
                    "voting.tied_targets": user_id,
                },
                "$unset": {
                    f"private_cards.{user_id}": "",
                    f"voting.votes.{user_id}": "",
                },
                "$set": {"updated_at": now},
            })
        return {"left": True}, HTTPStatus.OK, []
    if not member:
        raise api_error(HTTPStatus.FORBIDDEN, "Сначала войди в комнату по приглашению.")
    if method == "GET" and not action:
        if bunker_presence_refresh_due(member, now):
            db.bunker_rooms.update_one({"code": code, "members.user_id": user_id},
                {"$set": {"members.$.last_seen": now}})
        room = db.bunker_rooms.find_one({"code": code})
        return {"room": bunker_public_room(room, user_id)}, HTTPStatus.OK, []
    if method == "POST" and action == "ready":
        data = handler.read_json()
        db.bunker_rooms.update_one({"code": code, "members.user_id": user_id},
            {"$set": {"members.$.ready": bool(data.get("ready")), "members.$.last_seen": now, "updated_at": now}})
        room = db.bunker_rooms.find_one({"code": code})
        return {"room": bunker_public_room(room, user_id)}, HTTPStatus.OK, []
    if method == "POST" and action == "start":
        if room.get("status") != "lobby":
            raise api_error(HTTPStatus.CONFLICT, "Эта комната уже не ожидает начала партии.")
        if int(room["host_id"]) != user_id:
            raise api_error(HTTPStatus.FORBIDDEN, "Только ведущий может начать игру.")
        data = handler.read_json()
        scenario = str(data.get("scenario") or "classic")
        difficulty = str(data.get("difficulty") or "normal")
        if scenario not in BUNKER_SCENARIOS or difficulty not in BUNKER_DIFFICULTIES:
            raise api_error(HTTPStatus.BAD_REQUEST, "Выбери доступный сценарий и сложность.")
        try:
            members = validate_human_lobby_start(room.get("members", []), user_id)
        except ValueError as exc:
            raise api_error(HTTPStatus.CONFLICT, str(exc))
        private_cards = {str(m["user_id"]): bunker_make_cards(difficulty) for m in members}
        public_players = [{"user_id": m["user_id"], "name": m.get("name"), "avatar_url": m.get("avatar_url"),
                           "alive": True, "revealed_count": 0} for m in members]
        title, disaster = BUNKER_SCENARIOS[scenario]
        db.bunker_rooms.update_one({"code": code, "status": "lobby"}, {"$set": {
            "status": "started", "scenario": {"id": scenario, "title": title},
            "difficulty": {"id": difficulty, "title": BUNKER_DIFFICULTIES[difficulty][0],
                           "negative_card_chance": BUNKER_DIFFICULTIES[difficulty][1]},
            "capacity": max(1, (len(members) + 1) // 2), "disaster": disaster,
            "members": members, "private_cards": private_cards, "revealed_cards": [], "players": public_players,
            "round": 1, "started_at": now,
            "chat": [{"name": "Система", "text": "Партия началась. Личные карты доступны только их владельцам.", "system": True, "at": now}],
            "updated_at": now}})
        room = db.bunker_rooms.find_one({"code": code})
        if room.get("status") != "started":
            raise api_error(HTTPStatus.CONFLICT, "Партия уже была запущена.")
        return {"room": bunker_public_room(room, user_id)}, HTTPStatus.OK, []
    if method == "POST" and action == "action":
        data = handler.read_json()
        kind = str(data.get("type") or "")
        if room.get("status") == "finished" and kind not in ("chat",):
            raise api_error(HTTPStatus.CONFLICT, "Партия уже завершена. Можно посмотреть итоги, но нельзя менять ход игры.")
        if kind == "chat":
            message = str(data.get("message") or "").strip()
            if not message or len(message) > 500:
                raise api_error(HTTPStatus.BAD_REQUEST, "Сообщение должно содержать от 1 до 500 символов.")
            db.bunker_rooms.update_one({"code": code}, {"$push": {"chat": {"$each": [
                {"name": name, "text": message, "at": now}], "$slice": -60}}, "$set": {"updated_at": now}})
        elif kind == "reveal":
            category = str(data.get("category") or "")
            if not any(int(p["user_id"]) == user_id and p.get("alive", True) for p in room.get("players", [])):
                raise api_error(HTTPStatus.FORBIDDEN, "Выбывший игрок больше не раскрывает карты.")
            private = (room.get("private_cards") or {}).get(str(user_id), [])
            card = next((x for x in private if x.get("category") == category), None)
            if room.get("status") != "started" or not card:
                raise api_error(HTTPStatus.BAD_REQUEST, "Эта карта недоступна.")
            if any(x.get("user_id") == user_id and x.get("category") == category for x in room.get("revealed_cards", [])):
                raise api_error(HTTPStatus.CONFLICT, "Карта уже раскрыта.")
            revealed = {"user_id": user_id, "name": name, "category": card["category"],
                        "label": card["label"], "value": card["value"], "negative": bool(card["negative"])}
            players = []
            for player_item in room.get("players", []):
                updated_player = dict(player_item)
                if int(updated_player["user_id"]) == user_id:
                    updated_player["revealed_count"] = int(updated_player.get("revealed_count", 0)) + 1
                players.append(updated_player)
            result = db.bunker_rooms.update_one(
                {"code": code, "status": "started",
                 "revealed_cards": {"$not": {"$elemMatch": {"user_id": user_id, "category": category}}}},
                {"$push": {"revealed_cards": revealed},
                 "$set": {"players": players, "updated_at": now}})
            if result.matched_count == 0:
                raise api_error(HTTPStatus.CONFLICT, "Эта карта уже раскрыта.")
        elif kind == "event":
            if int(room["host_id"]) != user_id:
                raise api_error(HTTPStatus.FORBIDDEN, "События запускает ведущий.")
            event = secrets.choice(BUNKER_EVENTS)
            db.bunker_rooms.update_one({"code": code}, {"$set": {"event": {
                "title": event[0], "description": event[1], "at": now}, "updated_at": now},
                "$push": {"chat": {"$each": [{"name": "Система", "text": "Событие: " + event[0] + " — " + event[1], "system": True, "at": now}], "$slice": -60}}})
        elif kind == "vote_start":
            if int(room["host_id"]) != user_id:
                raise api_error(HTTPStatus.FORBIDDEN, "Голосование запускает ведущий.")
            if room.get("status") != "started":
                raise api_error(HTTPStatus.CONFLICT, "Партия уже завершена.")
            alive = [p for p in room.get("players", []) if p.get("alive", True)]
            capacity = int(room.get("capacity", 1))
            if len(alive) <= capacity:
                raise api_error(HTTPStatus.CONFLICT, "Бункер уже укомплектован. Партия завершена.")
            if (room.get("voting") or {}).get("open"):
                raise api_error(HTTPStatus.CONFLICT, "Голосование уже идёт.")
            db.bunker_rooms.update_one({"code": code, "status": "started"}, {"$set": {
                "voting": {"open": True, "votes": {}, "tied_targets": [], "started_at": now}, "updated_at": now}})
        elif kind == "vote":
            voting = room.get("voting") or {}
            if room.get("status") != "started" or not voting.get("open"):
                raise api_error(HTTPStatus.CONFLICT, "Сейчас голосование не проводится.")
            alive_ids = {int(p["user_id"]) for p in room.get("players", []) if p.get("alive", True)}
            if user_id not in alive_ids:
                raise api_error(HTTPStatus.FORBIDDEN, "Выбывшие игроки больше не голосуют.")
            target = int(data.get("target_user_id") or 0)
            if target == user_id or target not in alive_ids:
                raise api_error(HTTPStatus.BAD_REQUEST, "Выбери другого активного участника.")
            tied_targets = [int(value) for value in voting.get("tied_targets", [])]
            if tied_targets and target not in tied_targets:
                raise api_error(HTTPStatus.BAD_REQUEST, "После ничьей можно голосовать только за участников с равным числом голосов.")
            db.bunker_rooms.update_one({"code": code, "voting.open": True},
                {"$set": {f"voting.votes.{user_id}": target, "updated_at": now}})
        elif kind == "tie_break":
            voting = room.get("voting") or {}
            if int(room["host_id"]) != user_id:
                raise api_error(HTTPStatus.FORBIDDEN, "Решающий голос отдаёт ведущий.")
            tied = [int(value) for value in voting.get("tied_targets", [])]
            eliminated = int(data.get("target_user_id") or 0)
            if not voting.get("open") or len(tied) < 2 or eliminated not in tied:
                raise api_error(HTTPStatus.CONFLICT, "Сейчас нет ничьей, требующей решающего голоса.")
            player = next((p for p in room.get("players", []) if int(p["user_id"]) == eliminated and p.get("alive", True)), None)
            if not player:
                raise api_error(HTTPStatus.CONFLICT, "Участник уже выбыл.")
            players = [{**item, "alive": False} if int(item["user_id"]) == eliminated else item for item in room.get("players", [])]
            remaining = [p for p in players if p.get("alive", True)]
            finished = len(remaining) <= int(room.get("capacity", 1))
            if finished:
                final_result = "Бункер укомплектован! Внутри: " + ", ".join(p.get("name", "Игрок") for p in remaining) + f". Выжили {len(remaining)} из {len(players)} игроков."
            else:
                final_result = f"После ничьей ведущий отдал решающий голос против {player['name']}. Осталось мест: {int(room.get('capacity', 1)) - len(remaining)}."
            db.bunker_rooms.update_one({"code": code, "status": "started", "voting.open": True}, {"$set": {
                "status": "finished" if finished else "started", "voting.open": False,
                "players": players, "result": final_result, "survivors": remaining,
                "finished_at": now if finished else None, "updated_at": now}, "$inc": {"round": 1}})
        elif kind == "resolve_vote":
            if int(room["host_id"]) != user_id:
                raise api_error(HTTPStatus.FORBIDDEN, "Итоги голосования подводит ведущий.")
            voting = room.get("voting") or {}
            if room.get("status") != "started" or not voting.get("open"):
                raise api_error(HTTPStatus.CONFLICT, "Голосование не открыто.")
            alive = [p for p in room.get("players", []) if p.get("alive", True)]
            votes = voting.get("votes") or {}
            if len(votes) < len(alive) or any(str(p["user_id"]) not in votes for p in alive):
                raise api_error(HTTPStatus.CONFLICT, "Дождись голосов всех участников, которые ещё в игре.")
            counts = {}
            for target in votes.values():
                counts[str(target)] = counts.get(str(target), 0) + 1
            if not counts:
                raise api_error(HTTPStatus.CONFLICT, "Пока нет голосов.")
            highest = max(counts.values())
            tied = sorted(int(target) for target, count in counts.items() if count == highest)
            if len(tied) > 1:
                db.bunker_rooms.update_one({"code": code, "voting.open": True}, {"$set": {
                    "voting.votes": {}, "voting.tied_targets": tied,
                    "result": "Ничья! Ведущий должен отдать решающий голос между участниками с равным числом голосов.",
                    "updated_at": now}})
            else:
                eliminated = tied[0]
                player = next((p for p in room.get("players", []) if int(p["user_id"]) == eliminated), None)
                if not player:
                    raise api_error(HTTPStatus.CONFLICT, "Участник уже выбыл.")
                players = [
                    {**item, "alive": False} if int(item["user_id"]) == eliminated else item
                    for item in room.get("players", [])
                ]
                remaining = [p for p in players if p.get("alive", True)]
                finished = len(remaining) <= int(room.get("capacity", 1))
                if finished:
                    survivors = ", ".join(p.get("name", "Игрок") for p in remaining)
                    final_result = f"Бункер укомплектован! Внутри: {survivors}. Выжили {len(remaining)} из {len(players)} игроков."
                else:
                    final_result = f"{player['name']} покидает убежище. Голосов: {counts[str(eliminated)]}. Осталось мест: {int(room.get('capacity', 1)) - len(remaining)}."
                db.bunker_rooms.update_one({"code": code, "status": "started", "voting.open": True}, {"$set": {
                    "status": "finished" if finished else "started",
                    "voting.open": False, "players": players,
                    "result": final_result,
                    "survivors": [p for p in remaining],
                    "finished_at": now if finished else None,
                    "updated_at": now}, "$inc": {"round": 1}})
        else:
            raise api_error(HTTPStatus.BAD_REQUEST, "Неизвестное действие.")
        room = db.bunker_rooms.find_one({"code": code})
        return {"room": bunker_public_room(room, user_id)}, HTTPStatus.OK, []
    raise api_error(HTTPStatus.NOT_FOUND, "Маршрут игры не найден.")
