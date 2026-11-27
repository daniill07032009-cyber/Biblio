"""Authenticated multiplayer chess rooms for Biblio.

python-chess is the source of truth for move legality and game status. The API
stores FEN and SAN history and uses compare-and-swap updates to reject stale moves.
"""
import secrets
import re
from datetime import datetime, timezone
from http import HTTPStatus

import chess


START_FEN = chess.STARTING_FEN
ROOM_CODE_RE = re.compile(r"^[A-Z0-9]{6}$")
TIME_CONTROLS = {"3+2": (180000, 2000), "5+0": (300000, 0), "10+0": (600000, 0), "15+10": (900000, 10000)}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _user_name(db, user_id, mongodb_enabled):
    user = db.users.find_one({"id": user_id}, {"display_name": 1}) if mongodb_enabled else db.execute(
        "SELECT display_name FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not user:
        return "Игрок"
    return (user.get("display_name") if mongodb_enabled else user["display_name"]) or "Игрок"


def _get_room(db, code, mongodb_enabled):
    return db.chess_rooms.find_one({"code": code}) if mongodb_enabled else db.execute(
        "SELECT * FROM chess_rooms WHERE code = ?", (code,)
    ).fetchone()


def _room_dict(room, mongodb_enabled):
    if mongodb_enabled:
        return dict(room)
    item = dict(room)
    import json
    item["moves"] = json.loads(item.get("moves_json") or "[]")
    item["clock"] = json.loads(item.get("clock_json") or "{}")
    return item


def _save_room(db, room, mongodb_enabled, expected_fen=None):
    now = _now()
    if mongodb_enabled:
        query = {"code": room["code"]}
        if expected_fen is not None:
            query.update({"fen": expected_fen, "status": "active"})
        values = {key: value for key, value in room.items() if key != "_id"}
        values["updated_at"] = now
        result = db.chess_rooms.update_one(query, {"$set": values})
        if expected_fen is not None and result.modified_count != 1:
            return False
        return True
    import json
    fields = (
        room["name"], room["white_id"], room["white_name"], room.get("black_id"),
        room.get("black_name") or "", room["status"], room["fen"],
        json.dumps(room.get("moves") or [], ensure_ascii=False), room.get("result") or "",
        room.get("draw_offer_by"), room.get("time_control") or "10+0", json.dumps(room.get("clock") or {}, ensure_ascii=False), now, room["code"],
    )
    if expected_fen is None:
        db.execute(
            """UPDATE chess_rooms SET name=?, white_id=?, white_name=?, black_id=?,
               black_name=?, status=?, fen=?, moves_json=?, result=?, draw_offer_by=?, time_control=?, clock_json=?,
               updated_at=? WHERE code=?""", fields,
        )
        return True
    cursor = db.execute(
        """UPDATE chess_rooms SET name=?, white_id=?, white_name=?, black_id=?,
           black_name=?, status=?, fen=?, moves_json=?, result=?, draw_offer_by=?, time_control=?, clock_json=?,
           updated_at=? WHERE code=? AND fen=? AND status='active'""",
        fields[:-1] + (room["code"], expected_fen),
    )
    return cursor.rowcount == 1


def _game_result(board):
    if board.is_checkmate():
        winner = "белые" if board.turn == chess.BLACK else "чёрные"
        return f"Мат. Победили {winner}."
    if board.is_stalemate():
        return "Пат. Ничья."
    if board.is_insufficient_material():
        return "Недостаточно материала. Ничья."
    if board.is_seventyfive_moves():
        return "Правило 75 ходов. Ничья."
    if board.is_fivefold_repetition():
        return "Пятикратное повторение позиции. Ничья."
    return ""


def _public_room(room, user_id):
    board = chess.Board(room["fen"])
    is_white = int(room["white_id"]) == int(user_id)
    is_black = room.get("black_id") is not None and int(room["black_id"]) == int(user_id)
    is_my_turn = room["status"] == "active" and ((board.turn == chess.WHITE and is_white) or (board.turn == chess.BLACK and is_black))
    moves = room.get("moves") or []
    clock = dict(room.get("clock") or {})
    if clock and room["status"] == "active" and clock.get("updated_at"):
        try:
            updated = datetime.fromisoformat(clock["updated_at"].replace("Z", "+00:00"))
            elapsed = max(0, int((datetime.now(timezone.utc) - updated).total_seconds() * 1000))
            active_key = "white_ms" if board.turn == chess.WHITE else "black_ms"
            clock[active_key] = max(0, int(clock.get(active_key, 0)) - elapsed)
        except (TypeError, ValueError):
            pass
    return {
        "code": room["code"],
        "name": room["name"],
        "status": room["status"],
        "fen": room["fen"],
        "moves": moves,
        "white": {"id": room["white_id"], "name": room["white_name"]},
        "black": {"id": room.get("black_id"), "name": room.get("black_name") or ""},
        "turn": "white" if board.turn == chess.WHITE else "black",
        "is_white": is_white,
        "is_black": is_black,
        "is_my_turn": is_my_turn,
        "check": board.is_check(),
        "legal_moves": [move.uci() for move in board.legal_moves] if is_my_turn else [],
        "last_move": moves[-1] if moves else None,
        "result": room.get("result") or "",
        "draw_offer_by": room.get("draw_offer_by"),
        "clock": clock,
        "created_at": room.get("created_at"),
        "updated_at": room.get("updated_at"),
    }


def _error(api_error, status, message):
    raise api_error(status, message)


def dispatch_chess_api(handler, db, method, path, api_error, mongodb_enabled):
    user = handler.current_user_mongo(db, required=True) if mongodb_enabled else handler.current_user(db, required=True)
    if method == "GET" and path == "/api/chess/rooms":
        if mongodb_enabled:
            rooms = list(db.chess_rooms.find({"status": "waiting"}).sort("created_at", -1).limit(50))
        else:
            rooms = [dict(row) for row in db.execute(
                "SELECT * FROM chess_rooms WHERE status='waiting' ORDER BY created_at DESC LIMIT 50"
            ).fetchall()]
        return {"rooms": [{
            "code": room["code"], "name": room["name"],
            "white_name": room["white_name"], "white_id": room["white_id"], "is_owner": int(room["white_id"]) == int(user["id"]), "created_at": room["created_at"],
        } for room in rooms]}, HTTPStatus.OK, []

    if method == "POST" and path == "/api/chess/rooms":
        payload = handler.read_json()
        name = handler.valid_text(payload.get("name") or "Партия в шахматы", "Название комнаты", 1, 80)
        time_control = str(payload.get("time_control") or "10+0")
        if time_control not in TIME_CONTROLS:
            _error(api_error, HTTPStatus.BAD_REQUEST, "Выберите доступный контроль времени.")
        code = secrets.token_hex(3).upper()
        now = _now()
        room = {
            "code": code, "name": name,
            "white_id": user["id"], "white_name": _user_name(db, user["id"], mongodb_enabled),
            "black_id": None, "black_name": "", "status": "waiting",
            "fen": START_FEN, "moves": [], "result": "", "draw_offer_by": None,
            "time_control": time_control, "clock": {},
            "created_at": now, "updated_at": now,
        }
        if mongodb_enabled:
            db.chess_rooms.insert_one(room)
        else:
            db.execute(
                """INSERT INTO chess_rooms
                (code,name,white_id,white_name,black_id,black_name,status,fen,moves_json,result,draw_offer_by,time_control,clock_json,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (code,name,room["white_id"],room["white_name"],None,"","waiting",START_FEN,"[]","",None,time_control,"{}",now,now),
            )
        return {"room": _public_room(room, user["id"])}, HTTPStatus.CREATED, []

    match = re.fullmatch(r"/api/chess/rooms/([A-Z0-9]{6})(?:/(join|move|resign|draw|leave))?", path)
    if not match:
        _error(api_error, HTTPStatus.NOT_FOUND, "Шахматная комната не найдена.")
    code, action = match.groups()
    code = code.upper()
    room_raw = _get_room(db, code, mongodb_enabled)
    if room_raw is None:
        _error(api_error, HTTPStatus.NOT_FOUND, "Комната не найдена.")
    room = _room_dict(room_raw, mongodb_enabled)
    is_white = int(room["white_id"]) == int(user["id"])
    is_black = room.get("black_id") is not None and int(room["black_id"]) == int(user["id"])

    if method == "POST" and action == "join":
        if is_white:
            _error(api_error, HTTPStatus.CONFLICT, "Ты уже создатель этой комнаты.")
        if room["status"] != "waiting" or room.get("black_id") is not None:
            _error(api_error, HTTPStatus.CONFLICT, "В этой комнате уже есть второй игрок.")
        room["black_id"] = user["id"]
        room["black_name"] = _user_name(db, user["id"], mongodb_enabled)
        room["status"] = "active"
        control = TIME_CONTROLS.get(room.get("time_control") or "10+0", TIME_CONTROLS["10+0"])
        room["clock"] = {"white_ms": control[0], "black_ms": control[0], "increment_ms": control[1], "updated_at": _now()}
        if mongodb_enabled:
            result = db.chess_rooms.update_one(
                {"code": code, "status": "waiting", "black_id": None},
                {"$set": {"black_id": user["id"], "black_name": room["black_name"], "status": "active", "clock": room["clock"], "updated_at": _now()}},
            )
            if result.modified_count != 1:
                _error(api_error, HTTPStatus.CONFLICT, "Комнату уже занял другой игрок. Обнови список.")
        else:
            cursor = db.execute(
                "UPDATE chess_rooms SET black_id=?, black_name=?, status='active', clock_json=?, updated_at=? WHERE code=? AND status='waiting' AND black_id IS NULL",
                (user["id"], room["black_name"], __import__("json").dumps(room["clock"]), _now(), code),
            )
            if cursor.rowcount != 1:
                _error(api_error, HTTPStatus.CONFLICT, "Комнату уже занял другой игрок. Обнови список.")
        room = _get_room(db, code, mongodb_enabled)
        room = _room_dict(room, mongodb_enabled)
        return {"room": _public_room(room, user["id"])}, HTTPStatus.OK, []

    if not (is_white or is_black):
        _error(api_error, HTTPStatus.FORBIDDEN, "Эта партия доступна только её двум участникам.")

    if method == "GET" and action is None:
        return {"room": _public_room(room, user["id"])}, HTTPStatus.OK, []

    if method == "POST" and action == "move":
        if room["status"] != "active":
            _error(api_error, HTTPStatus.CONFLICT, "Партия ещё не началась или уже завершена.")
        board = chess.Board(room["fen"])
        expected_color = chess.WHITE if is_white else chess.BLACK
        clock = room.get("clock") or {}
        if clock and clock.get("updated_at"):
            try:
                updated = datetime.fromisoformat(clock["updated_at"].replace("Z", "+00:00"))
                elapsed = max(0, int((datetime.now(timezone.utc) - updated).total_seconds() * 1000))
                active_key = "white_ms" if board.turn == chess.WHITE else "black_ms"
                clock[active_key] = max(0, int(clock.get(active_key, 0)) - elapsed)
                if clock[active_key] <= 0:
                    winner = "чёрные" if board.turn == chess.WHITE else "белые"
                    room["clock"] = clock
                    room["status"] = "finished"
                    room["result"] = f"Время вышло. Победили {winner}."
                    _save_room(db, room, mongodb_enabled)
                    _error(api_error, HTTPStatus.CONFLICT, "Время вышло. Партия завершена.")
            except (TypeError, ValueError):
                pass
        if board.turn != expected_color:
            _error(api_error, HTTPStatus.CONFLICT, "Сейчас ход соперника.")
        payload = handler.read_json()
        uci = str(payload.get("move") or "").strip().lower()
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            _error(api_error, HTTPStatus.BAD_REQUEST, "Ход записан неверно.")
        if move not in board.legal_moves:
            _error(api_error, HTTPStatus.BAD_REQUEST, "Такой ход невозможен по правилам шахмат.")
        san = board.san(move)
        old_fen = room["fen"]
        board.push(move)
        room["fen"] = board.fen()
        if clock:
            mover_key = "white_ms" if is_white else "black_ms"
            clock[mover_key] = int(clock.get(mover_key, 0)) + int(clock.get("increment_ms", 0))
            clock["updated_at"] = _now()
            room["clock"] = clock
        room.setdefault("moves", []).append({
            "uci": uci, "san": san, "by": user["id"],
            "color": "white" if is_white else "black", "created_at": _now(), "fen_after": board.fen(),
        })
        room["result"] = _game_result(board)
        if room["result"]:
            room["status"] = "finished"
        if not _save_room(db, room, mongodb_enabled, expected_fen=old_fen):
            _error(api_error, HTTPStatus.CONFLICT, "Позиция уже обновилась. Доска будет синхронизирована.")
        updated = _get_room(db, code, mongodb_enabled)
        return {"room": _public_room(_room_dict(updated, mongodb_enabled), user["id"])}, HTTPStatus.OK, []

    if method == "POST" and action == "resign":
        if room["status"] != "active":
            _error(api_error, HTTPStatus.CONFLICT, "Сейчас нельзя сдаться.")
        winner = "чёрные" if is_white else "белые"
        room["status"] = "finished"
        room["result"] = f"Сдача. Победили {winner}."
        room["draw_offer_by"] = None
        _save_room(db, room, mongodb_enabled)
        return {"room": _public_room(_room_dict(_get_room(db, code, mongodb_enabled), mongodb_enabled), user["id"])}, HTTPStatus.OK, []

    if method == "POST" and action == "draw":
        if room["status"] != "active":
            _error(api_error, HTTPStatus.CONFLICT, "Предложение ничьей доступно только во время партии.")
        payload = handler.read_json()
        draw_action = str(payload.get("action") or "offer")
        if draw_action == "offer":
            room["draw_offer_by"] = user["id"]
        elif draw_action == "accept":
            if room.get("draw_offer_by") in (None, user["id"]):
                _error(api_error, HTTPStatus.BAD_REQUEST, "Сначала соперник должен предложить ничью.")
            room["status"] = "finished"
            room["result"] = "Ничья по соглашению игроков."
            room["draw_offer_by"] = None
        elif draw_action == "decline":
            if room.get("draw_offer_by") in (None, user["id"]):
                _error(api_error, HTTPStatus.BAD_REQUEST, "Нет предложения соперника для отклонения.")
            room["draw_offer_by"] = None
        elif draw_action == "claim":
            board = chess.Board(room["fen"])
            expected_color = chess.WHITE if is_white else chess.BLACK
            if board.turn != expected_color:
                _error(api_error, HTTPStatus.CONFLICT, "Заявить ничью можно только в свой ход.")
            if not (board.can_claim_fifty_moves() or board.can_claim_threefold_repetition()):
                _error(api_error, HTTPStatus.BAD_REQUEST, "Сейчас правила не позволяют заявить ничью.")
            room["status"] = "finished"
            room["result"] = "Ничья по правилу 50 ходов или троекратного повторения."
            room["draw_offer_by"] = None
        else:
            _error(api_error, HTTPStatus.BAD_REQUEST, "Неизвестное действие с ничьей.")
        _save_room(db, room, mongodb_enabled)
        return {"room": _public_room(_room_dict(_get_room(db, code, mongodb_enabled), mongodb_enabled), user["id"])}, HTTPStatus.OK, []

    if method in {"POST", "DELETE"} and action == "leave":
        if room["status"] == "waiting" and is_white:
            if mongodb_enabled:
                db.chess_rooms.delete_one({"code": code, "white_id": user["id"], "status": "waiting"})
            else:
                db.execute("DELETE FROM chess_rooms WHERE code=? AND white_id=? AND status='waiting'", (code, user["id"]))
            return {"left": True, "deleted": True}, HTTPStatus.OK, []
        if room["status"] == "active":
            winner = "чёрные" if is_white else "белые"
            room["status"] = "finished"
            room["result"] = f"Игрок покинул партию. Победили {winner}."
            _save_room(db, room, mongodb_enabled)
        return {"left": True}, HTTPStatus.OK, []

    _error(api_error, HTTPStatus.METHOD_NOT_ALLOWED, "Метод не поддерживается.")
