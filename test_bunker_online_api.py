import unittest
from http import HTTPStatus

import mongomock

from bunker_online_api import dispatch_bunker_api


class TestAPIError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class FakeHandler:
    def __init__(self, user, payload=None):
        self.user = user
        self.payload = payload or {}

    def current_user_mongo(self, db, required=False):
        return self.user

    def read_json(self):
        return self.payload


class BunkerOnlineAPITests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient().biblio
        self.host = {"id": 101, "display_name": "Ведущий", "avatar_url": ""}
        self.player = {"id": 202, "display_name": "Игрок", "avatar_url": ""}

    def call_api(self, user, method, path, payload=None):
        handler = FakeHandler(user, payload)
        return dispatch_bunker_api(handler, self.db, method, path, TestAPIError, True)

    def create_two_player_room(self):
        created, status, _ = self.call_api(
            self.host, "POST", "/api/bunker/rooms", {"max_players": 6, "bot_count": 4}
        )
        self.assertEqual(HTTPStatus.CREATED, status)
        code = created["room"]["code"]
        self.assertEqual([101], [m["user_id"] for m in created["room"]["members"]])
        joined, status, _ = self.call_api(
            self.player, "POST", f"/api/bunker/rooms/{code}/join", {}
        )
        self.assertEqual(HTTPStatus.OK, status)
        ready, status, _ = self.call_api(
            self.player, "POST", f"/api/bunker/rooms/{code}/ready", {"ready": True}
        )
        self.assertEqual(HTTPStatus.OK, status)
        self.assertEqual(2, len(ready["room"]["members"]))
        return code

    def test_room_requires_two_real_accounts_and_ignores_bot_request(self):
        created, _, _ = self.call_api(
            self.host, "POST", "/api/bunker/rooms", {"max_players": 4, "bot_count": 3}
        )
        code = created["room"]["code"]
        self.assertEqual(1, len(created["room"]["members"]))
        with self.assertRaises(TestAPIError) as raised:
            self.call_api(
                self.host, "POST", f"/api/bunker/rooms/{code}/start",
                {"scenario": "classic", "difficulty": "normal"},
            )
        self.assertEqual(HTTPStatus.CONFLICT, raised.exception.status)

    def test_private_cards_are_returned_only_to_their_owner(self):
        code = self.create_two_player_room()
        started, status, _ = self.call_api(
            self.host, "POST", f"/api/bunker/rooms/{code}/start",
            {"scenario": "classic", "difficulty": "normal"},
        )
        self.assertEqual(HTTPStatus.OK, status)
        self.assertEqual(6, len(started["room"]["my_cards"]))
        self.assertNotIn("private_cards", started["room"])
        host_cards = self.db.bunker_rooms.find_one({"code": code})["private_cards"]["101"]
        player_room, status, _ = self.call_api(self.player, "GET", f"/api/bunker/rooms/{code}")
        self.assertEqual(HTTPStatus.OK, status)
        player_cards = player_room["room"]["my_cards"]
        self.assertEqual(
            player_cards,
            self.db.bunker_rooms.find_one({"code": code})["private_cards"]["202"],
        )
        self.assertNotEqual(host_cards, player_cards)
        self.assertNotIn("private_cards", player_room["room"])
        self.assertTrue(all("is_bot" not in member for member in player_room["room"]["members"]))
        self.assertTrue(all("is_bot" not in player for player in player_room["room"]["players"]))

    def test_legacy_bot_members_are_hidden_from_existing_rooms(self):
        code = "LEGACY"
        self.db.bunker_rooms.insert_one({
            "code": code, "host_id": 101, "status": "started", "max_players": 4,
            "members": [
                {"user_id": 101, "name": "Ведущий", "role": "host", "ready": True},
                {"user_id": -1, "name": "Старый бот", "role": "bot", "is_bot": True},
            ],
            "players": [
                {"user_id": 101, "name": "Ведущий", "alive": True},
                {"user_id": -1, "name": "Старый бот", "alive": True, "is_bot": True},
            ],
            "revealed_cards": [
                {"user_id": 101, "name": "Ведущий", "category": "age", "value": "30 лет"},
                {"user_id": -1, "name": "Старый бот", "category": "age", "value": "40 лет", "is_bot": True},
            ],
            "chat": [
                {"name": "Ведущий", "text": "Привет"},
                {"name": "Старый бот", "text": "Автоматическое сообщение", "is_bot": True},
            ],
            "voting": {"open": True, "votes": {"101": -1, "-1": 101}, "tied_targets": [-1]},
            "private_cards": {"101": [{"category": "age", "label": "Возраст", "value": "30 лет"}],
                              "-1": [{"category": "age", "label": "Возраст", "value": "40 лет"}]},
            "capacity": 1, "round": 1,
        })
        result, status, _ = self.call_api(self.host, "GET", f"/api/bunker/rooms/{code}")
        self.assertEqual(HTTPStatus.OK, status)
        room = result["room"]
        self.assertEqual([101], [member["user_id"] for member in room["members"]])
        self.assertEqual([101], [player["user_id"] for player in room["players"]])
        self.assertEqual([101], [card["user_id"] for card in room["revealed_cards"]])
        self.assertEqual(["Привет"], [message["text"] for message in room["chat"]])
        self.assertEqual({}, room["voting"]["votes"])
        self.assertEqual([], room["voting"]["tied_targets"])
        self.assertEqual(1, len(room["my_cards"]))
        self.assertNotIn("private_cards", room)

        persisted = self.db.bunker_rooms.find_one({"code": code})
        self.assertEqual([101], [member["user_id"] for member in persisted["members"]])
        self.assertEqual([101], [player["user_id"] for player in persisted["players"]])
        self.assertEqual([101], [card["user_id"] for card in persisted["revealed_cards"]])
        self.assertEqual(["Привет"], [message["text"] for message in persisted["chat"]])
        self.assertEqual({"101"}, set(persisted["private_cards"]))

    def test_revealing_a_card_publishes_only_that_card(self):
        code = self.create_two_player_room()
        self.call_api(
            self.host, "POST", f"/api/bunker/rooms/{code}/start",
            {"scenario": "zombie", "difficulty": "hard"},
        )
        host_cards = self.db.bunker_rooms.find_one({"code": code})["private_cards"]["101"]
        category = host_cards[0]["category"]
        result, status, _ = self.call_api(
            self.host, "POST", f"/api/bunker/rooms/{code}/action",
            {"type": "reveal", "category": category},
        )
        self.assertEqual(HTTPStatus.OK, status)
        self.assertEqual(1, len(result["room"]["revealed_cards"]))
        self.assertEqual(category, result["room"]["revealed_cards"][0]["category"])
        player_result, _, _ = self.call_api(
            self.player, "GET", f"/api/bunker/rooms/{code}"
        )
        self.assertEqual(1, len(player_result["room"]["revealed_cards"]))
        self.assertEqual(6, len(player_result["room"]["my_cards"]))


    def test_join_succeeds_after_legacy_bot_is_purged_from_full_lobby(self):
        code = "BOTFULL"
        self.db.bunker_rooms.insert_one({
            "code": code, "host_id": 101, "status": "lobby", "max_players": 2,
            "members": [
                {"user_id": 101, "name": "Ведущий", "role": "host", "ready": True},
                {"user_id": -1, "name": "Старый бот", "role": "player", "ready": True, "is_bot": True},
            ],
            "players": [], "revealed_cards": [], "chat": [], "private_cards": {},
        })

        joined, status, _ = self.call_api(
            self.player, "POST", f"/api/bunker/rooms/{code}/join", {}
        )

        self.assertEqual(HTTPStatus.OK, status)
        self.assertEqual([101, 202], [m["user_id"] for m in joined["room"]["members"]])
        persisted = self.db.bunker_rooms.find_one({"code": code})
        self.assertEqual([101, 202], [m["user_id"] for m in persisted["members"]])
        self.assertEqual(2, len(persisted["members"]))


if __name__ == "__main__":
    unittest.main()
