"""Security and participant rules for Biblio's human-only BunkerOnline.

These pure helpers are intentionally independent from the HTTP handler and MongoDB,
so the room API can use and test them without side effects.
"""

from copy import deepcopy


def human_members(members):
    """Return unique, real Biblio account members; reject bot/invalid identities."""
    result = []
    seen = set()
    for member in members or []:
        if not isinstance(member, dict):
            continue
        if member.get("is_bot") or str(member.get("role", "")).lower() == "bot":
            continue
        try:
            user_id = int(member.get("user_id", 0))
        except (TypeError, ValueError):
            continue
        if user_id <= 0 or user_id in seen:
            continue
        seen.add(user_id)
        clean = dict(member)
        clean["user_id"] = user_id
        clean.pop("is_bot", None)
        clean.pop("bot_style", None)
        clean.pop("bot_next_action_at", None)
        result.append(clean)
    return result


def private_cards_for_user(room, user_id):
    """Return only the requesting account's cards, never the room's full card map."""
    try:
        account_id = int(user_id)
    except (TypeError, ValueError):
        return []
    if account_id <= 0 or not isinstance(room, dict):
        return []
    private_cards = room.get("private_cards")
    if not isinstance(private_cards, dict):
        return []
    cards = private_cards.get(str(account_id), [])
    if not isinstance(cards, list):
        return []
    return deepcopy([card for card in cards if isinstance(card, dict)])


def validate_human_lobby_start(members, host_id):
    """Require at least two real accounts and readiness from every non-host."""
    humans = human_members(members)
    try:
        host = int(host_id)
    except (TypeError, ValueError):
        raise ValueError("Ведущий не найден.")
    if not any(member["user_id"] == host for member in humans):
        raise ValueError("Ведущий должен находиться в комнате.")
    if len(humans) < 2:
        raise ValueError("Нужно минимум два реальных участника.")
    if any(not member.get("ready") for member in humans if member["user_id"] != host):
        raise ValueError("Не все участники подтвердили готовность.")
    return humans
