import unittest
from unittest.mock import patch

import dnd_solo


class DndSoloScenarioTests(unittest.TestCase):
    def test_all_scenarios_have_three_playable_scenes(self):
        self.assertGreaterEqual(len(dnd_solo.DND_SOLO_SCENARIOS), 3)
        for scenario_id, scenario in dnd_solo.DND_SOLO_SCENARIOS.items():
            state = dnd_solo.dnd_solo_initial_state(scenario_id)
            self.assertEqual(state["scenario_id"], scenario_id)
            self.assertEqual(len(scenario["scenes"]), 3)
            self.assertEqual(len(state["current_scene"]["choices"]), 3)

    def test_transition_uses_character_modifier_and_advances_story(self):
        state = dnd_solo.dnd_solo_initial_state("ashfall")
        hero = {"wisdom": 18}
        updated = dnd_solo.dnd_solo_transition(state, "inspect", hero, roll=10)
        outcome = updated["last_outcome"]
        self.assertEqual(outcome["modifier"], 4)
        self.assertEqual(outcome["total"], 14)
        self.assertTrue(outcome["success"])
        self.assertEqual(updated["scene_index"], 1)
        self.assertEqual(updated["current_scene"]["title"], "Под часовней")

    def test_natural_one_fails_and_twenty_succeeds(self):
        state = dnd_solo.dnd_solo_initial_state("sunken-crypt")
        hero = {"wisdom": 30}
        with patch("dnd_solo.secrets.randbelow", return_value=0):
            failed = dnd_solo.dnd_solo_transition(state, "search", hero)
        self.assertFalse(failed["last_outcome"]["success"])
        with patch("dnd_solo.secrets.randbelow", return_value=19):
            succeeded = dnd_solo.dnd_solo_transition(state, "search", hero)
        self.assertTrue(succeeded["last_outcome"]["success"])

    def test_invalid_choice_and_completed_adventure_are_rejected(self):
        state = dnd_solo.dnd_solo_initial_state("wild-road")
        with self.assertRaises(ValueError):
            dnd_solo.dnd_solo_transition(state, "not-a-choice", {"wisdom": 10}, roll=10)
        for choice in ("track", "fight", "repair"):
            state = dnd_solo.dnd_solo_transition(state, choice, {"wisdom": 10, "constitution": 10, "strength": 10}, roll=20)
        self.assertTrue(state["completed"])
        with self.assertRaises(ValueError):
            dnd_solo.dnd_solo_transition(state, "track", {"wisdom": 10}, roll=10)


if __name__ == "__main__":
    unittest.main()
