"""Deterministic solo-D&D scenarios with an automated narrator.

The solo mode uses authored branching encounters and real d20 checks. It does not
call an external LLM, so outcomes are reproducible from the persisted game state.
"""
import secrets

DND_SOLO_SCENARIOS = {
    "ashfall": {
        "title": "Пепел над Вальдхеймом",
        "summary": "Деревня у Чёрного леса скрывает источник странного пепла.",
        "scenes": [
            {
                "title": "Ворота под пепельным дождём",
                "text": "На закате ты достигаешь Вальдхейма. Из труб не идёт дым, ворота распахнуты, а на дороге видны свежие следы, ведущие к колодцу.",
                "choices": [
                    {"id": "inspect", "label": "Осмотреть следы и колодец", "ability": "wisdom", "dc": 12,
                     "success": "Ты находишь отпечаток сапога с гербом местной стражи и замечаешь, что пепел падает из-под земли.",
                     "failure": "Следы обрываются у колодца. Из темноты доносится металлический скрежет."},
                    {"id": "call", "label": "Громко позвать жителей", "ability": "charisma", "dc": 13,
                     "success": "Из окна отвечает староста. Он впускает тебя и шепчет: ночью кто-то уходит к старой часовне.",
                     "failure": "Ответа нет. Зато на крыше мелькает силуэт и исчезает за дымоходом."},
                    {"id": "sneak", "label": "Незаметно пробраться внутрь", "ability": "dexterity", "dc": 12,
                     "success": "Ты проходишь за повозкой и видишь, как стражник тайком открывает люк у колодца.",
                     "failure": "Доска под ногой трещит. Где-то рядом звенит тревожный колокольчик."},
                ],
            },
            {
                "title": "Под часовней",
                "text": "След приводит тебя к часовне. Под алтарём обнаруживается лестница в старый туннель. Воздух пахнет золой и мокрым камнем.",
                "choices": [
                    {"id": "runes", "label": "Расшифровать руны на стене", "ability": "intelligence", "dc": 14,
                     "success": "Руны предупреждают о печати, удерживающей огненного духа. Ты узнаёшь безопасную последовательность знаков.",
                     "failure": "Руны вспыхивают и обжигают ладонь. Печать начинает трескаться."},
                    {"id": "brace", "label": "Укрепить осыпающийся проход", "ability": "strength", "dc": 13,
                     "success": "Ты закрепляешь балки и находишь тайник с противогазом и старым ключом.",
                     "failure": "Камни осыпаются. Приходится отступить, потеряв часть припасов."},
                    {"id": "listen", "label": "Прислушаться к голосам за дверью", "ability": "wisdom", "dc": 13,
                     "success": "Ты слышишь спор культистов и узнаёшь, что печать можно восстановить без боя.",
                     "failure": "Голоса затихают. Дверь медленно начинает открываться с другой стороны."},
                ],
            },
            {
                "title": "Сердце подземелья",
                "text": "В глубине туннеля горит чёрное пламя. Над ним висит расколотая печать, а из огня доносится голос, обещающий исполнить любое желание.",
                "choices": [
                    {"id": "seal", "label": "Восстановить печать", "ability": "intelligence", "dc": 15,
                     "success": "Знаки вспыхивают ровным светом. Пламя втягивается в камень, а пепел над Вальдхеймом прекращается.",
                     "failure": "Печать отвечает вспышкой. Ты удерживаешь проход, но дух вырывается наружу — деревню ждёт тяжёлая ночь."},
                    {"id": "resist", "label": "Сразиться с огненным духом", "ability": "constitution", "dc": 15,
                     "success": "Ты выдерживаешь жар и разбиваешь источник пламени. Дух исчезает, оставив после себя раскалённый осколок.",
                     "failure": "Огонь отбрасывает тебя к стене. Ты выживаешь, но дух уходит в лес."},
                    {"id": "bargain", "label": "Попытаться заключить сделку", "ability": "charisma", "dc": 16,
                     "success": "Ты находишь условие, которое связывает духа древней клятвой. Он покидает деревню, не тронув жителей.",
                     "failure": "Дух принимает слова за согласие и оставляет на твоей руке пепельную метку."},
                ],
            },
        ],
    },
    "sunken-crypt": {
        "title": "Крипта забытого короля",
        "summary": "Под руинами крепости просыпается древняя гробница.",
        "scenes": [
            {
                "title": "Руины крепости",
                "text": "Среди мокрых камней ты находишь дверь с тремя пустыми гнёздами. Изнутри доносится тихий стук, будто кто-то просит выпустить его.",
                "choices": [
                    {"id": "search", "label": "Обыскать руины", "ability": "wisdom", "dc": 12, "success": "В траве лежит бронзовый медальон — первый ключ к двери.", "failure": "Ты находишь только сломанное оружие и тревожные следы."},
                    {"id": "force", "label": "Попытаться открыть дверь силой", "ability": "strength", "dc": 15, "success": "Каменная створка поддаётся, открывая короткий путь вниз.", "failure": "Механизм срабатывает: из стен вылетают ржавые стрелы."},
                    {"id": "study", "label": "Изучить надпись над входом", "ability": "intelligence", "dc": 13, "success": "Надпись рассказывает о трёх клятвах короля и порядке ключей.", "failure": "Слова стёрты временем, но дверь отвечает глухим ударом."},
                ],
            },
            {
                "title": "Зал трёх клятв",
                "text": "В крипте стоят три статуи. Каждая держит чашу, а на полу начертано предупреждение: «Не всякая кровь принадлежит живым».",
                "choices": [
                    {"id": "decode", "label": "Разгадать загадку чаш", "ability": "intelligence", "dc": 14, "success": "Ты выбираешь правильный символ и открываешь потайную нишу с лечебным эликсиром.", "failure": "Статуи поворачивают головы. Каменный страж пробуждается."},
                    {"id": "pray", "label": "Обратиться к древним богам", "ability": "charisma", "dc": 13, "success": "Тёплый свет гасит проклятие одной из чаш.", "failure": "Ответа нет, а холод в зале становится почти невыносимым."},
                    {"id": "trap", "label": "Проверить пол на ловушки", "ability": "dexterity", "dc": 13, "success": "Ты замечаешь нажимные плиты и обходишь опасный участок.", "failure": "Ловушка срабатывает, но ты успеваешь укрыться за колонной."},
                ],
            },
            {
                "title": "Трон без короля",
                "text": "На троне сидит пустая броня. Внутри шлема мерцает синее пламя — хранитель предлагает испытание вместо битвы.",
                "choices": [
                    {"id": "duel", "label": "Принять испытание клинком", "ability": "strength", "dc": 15, "success": "Ты побеждаешь хранителя и получаешь королевскую печать.", "failure": "Клинок выбит из рук. Хранитель позволяет тебе уйти, но оставляет гробницу закрытой."},
                    {"id": "truth", "label": "Рассказать правду о внешнем мире", "ability": "charisma", "dc": 15, "success": "Хранитель понимает, что его королевства больше нет, и добровольно отдаёт печать.", "failure": "Он не верит тебе и возвращается на трон."},
                    {"id": "ward", "label": "Найти способ снять проклятие", "ability": "wisdom", "dc": 14, "success": "Ты находишь последнюю клятву и освобождаешь дух хранителя.", "failure": "Проклятие вспыхивает, и выход начинает медленно закрываться."},
                ],
            },
        ],
    },
    "wild-road": {
        "title": "Последний караван",
        "summary": "Каравану нужно пересечь опасную пустошь до наступления бури.",
        "scenes": [
            {
                "title": "Пыльная дорога",
                "text": "Ты сопровождаешь караван через пустошь. Впереди расходятся две дороги: одна проходит через каньон, другая — мимо заброшенной башни.",
                "choices": [
                    {"id": "track", "label": "Найти безопасный маршрут", "ability": "wisdom", "dc": 12, "success": "Ты находишь следы старого дозора и выбираешь путь без зыбучих песков.", "failure": "Песок скрывает ориентиры, и караван теряет время."},
                    {"id": "lead", "label": "Убедить караван идти через башню", "ability": "charisma", "dc": 13, "success": "Путники соглашаются. В башне можно укрыться от надвигающейся бури.", "failure": "Купцы спорят, и часть повозок отстаёт."},
                    {"id": "scout", "label": "Разведать каньон в одиночку", "ability": "dexterity", "dc": 13, "success": "Ты замечаешь засаду до того, как караван входит в ущелье.", "failure": "Разбойники замечают тебя первыми."},
                ],
            },
            {
                "title": "Засада у обрыва",
                "text": "Из-за камней выходят вооружённые всадники. Их предводитель требует отдать груз и одного проводника.",
                "choices": [
                    {"id": "fight", "label": "Встать на защиту каравана", "ability": "constitution", "dc": 14, "success": "Ты удерживаешь линию и заставляешь нападающих отступить.", "failure": "Всадники прорываются к повозкам и похищают часть припасов."},
                    {"id": "negotiate", "label": "Попробовать договориться", "ability": "charisma", "dc": 14, "success": "Ты выясняешь, что разбойники защищают свою землю, и находишь компромисс.", "failure": "Переговоры срываются, начинается короткая схватка."},
                    {"id": "ambush", "label": "Обойти врагов по склону", "ability": "dexterity", "dc": 15, "success": "Ты заходишь с фланга и освобождаешь дорогу.", "failure": "Камни осыпаются под ногами, выдавая твоё положение."},
                ],
            },
            {
                "title": "Буря над перевалом",
                "text": "Небо темнеет. Караван достиг перевала, но впереди рушится мост. До бури остаются считаные минуты.",
                "choices": [
                    {"id": "repair", "label": "Укрепить мост подручными средствами", "ability": "strength", "dc": 15, "success": "Мост выдерживает. Караван проходит перевал до первых порывов бури.", "failure": "Часть настила рушится, и каравану приходится искать обход."},
                    {"id": "magic", "label": "Использовать магию, чтобы расчистить путь", "ability": "intelligence", "dc": 15, "success": "Заклинание удерживает камни и открывает безопасный проход.", "failure": "Магия рассеивается в песчаном вихре."},
                    {"id": "guide", "label": "Вывести людей по узкой тропе", "ability": "wisdom", "dc": 14, "success": "Ты находишь старую тропу и выводишь всех к убежищу.", "failure": "Караван спасается, но теряет повозку и часть груза."},
                ],
            },
        ],
    },
}


def dnd_solo_initial_state(scenario_id):
    scenario = DND_SOLO_SCENARIOS.get(str(scenario_id or ""))
    if not scenario:
        raise ValueError("Выбранный сценарий не найден.")
    first = scenario["scenes"][0]
    return {
        "scenario_id": str(scenario_id),
        "scene_index": 0,
        "completed": False,
        "history": [],
        "current_scene": {"title": first["title"], "text": first["text"], "choices": [
            {"id": item["id"], "label": item["label"]} for item in first["choices"]
        ]},
        "last_outcome": None,
    }


def dnd_solo_transition(state, choice_id, hero, roll=None):
    if not isinstance(state, dict) or state.get("completed"):
        raise ValueError("Приключение уже завершено.")
    scenario = DND_SOLO_SCENARIOS.get(str(state.get("scenario_id") or ""))
    if not scenario:
        raise ValueError("Сценарий не найден.")
    index = int(state.get("scene_index", 0))
    if not 0 <= index < len(scenario["scenes"]):
        raise ValueError("Эта глава уже завершена.")
    scene = scenario["scenes"][index]
    choice = next((item for item in scene["choices"] if item["id"] == choice_id), None)
    if choice is None:
        raise ValueError("Такого действия нет в этой сцене.")
    ability = choice["ability"]
    score = max(1, min(30, int(hero.get(ability, 10))))
    modifier = (score - 10) // 2
    die = int(roll) if roll is not None else secrets.randbelow(20) + 1
    if not 1 <= die <= 20:
        raise ValueError("Результат d20 должен быть от 1 до 20.")
    total = die + modifier
    success = die == 20 or (die != 1 and total >= int(choice["dc"]))
    outcome = {
        "scene": scene["title"],
        "choice": choice["label"],
        "ability": ability,
        "dc": int(choice["dc"]),
        "roll": die,
        "modifier": modifier,
        "total": total,
        "success": success,
        "narration": choice["success"] if success else choice["failure"],
    }
    history = list(state.get("history") or [])
    history.append(outcome)
    next_index = index + 1
    completed = next_index >= len(scenario["scenes"])
    next_scene = None
    if not completed:
        next_data = scenario["scenes"][next_index]
        next_scene = {
            "title": next_data["title"],
            "text": next_data["text"],
            "choices": [{"id": item["id"], "label": item["label"]} for item in next_data["choices"]],
        }
    return {
        "scenario_id": state["scenario_id"],
        "scene_index": next_index,
        "completed": completed,
        "history": history,
        "current_scene": next_scene,
        "last_outcome": outcome,
    }
