import unittest

from bunker_online_rules import human_members, private_cards_for_user, validate_human_lobby_start


class BunkerOnlineRulesTests(unittest.TestCase):
    def test_human_members_excludes_bots_and_invalid_ids(self):
        members = [
            {"user_id": 10, "name": "Host", "role": "host"},
            {"user_id": -1, "name": "Legacy bot", "role": "bot"},
            {"user_id": 11, "name": "Flagged bot", "is_bot": True},
            {"user_id": 0, "name": "Invalid"},
            {"user_id": 10, "name": "Duplicate"},
            None,
        ]
        self.assertEqual([10], [member["user_id"] for member in human_members(members)])

    def test_private_cards_returns_only_current_user_cards(self):
        room = {"private_cards": {
            "10": [{"category": "health", "value": "A"}],
            "11": [{"category": "health", "value": "B"}],
        }}
        cards = private_cards_for_user(room, 10)
        self.assertEqual([{"category": "health", "value": "A"}], cards)
        cards[0]["value"] = "changed"
        self.assertEqual("A", room["private_cards"]["10"][0]["value"])
        self.assertEqual([], private_cards_for_user(room, -1))

    def test_start_requires_two_humans_and_ready_players(self):
        members = [
            {"user_id": 10, "role": "host", "ready": True},
            {"user_id": 11, "role": "player", "ready": True},
            {"user_id": -1, "role": "bot", "is_bot": True, "ready": True},
        ]
        self.assertEqual([10, 11], [
            member["user_id"] for member in validate_human_lobby_start(members, 10)
        ])

    def test_start_rejects_room_with_only_one_real_account(self):
        with self.assertRaisesRegex(ValueError, "два реальных участника"):
            validate_human_lobby_start([
                {"user_id": 10, "role": "host", "ready": True},
                {"user_id": -1, "role": "bot", "is_bot": True, "ready": True},
            ], 10)

    def test_start_rejects_unready_human(self):
        with self.assertRaisesRegex(ValueError, "не все участники"):
            validate_human_lobby_start([
                {"user_id": 10, "role": "host", "ready": True},
                {"user_id": 11, "role": "player", "ready": False},
            ], 10)


if __name__ == "__main__":
    unittest.main()
