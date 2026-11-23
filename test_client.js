const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("script.js", "utf8");
const match = source.match(/function persistFavorites\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(match, "persistFavorites must exist");
const functionBody = match[0].replace(/^function persistFavorites\(\)\s*\{/, "").replace(/\n\}$/, "");
assert.doesNotMatch(functionBody, /\bpersistFavorites\s*\(/, "persistFavorites must not call itself");

const savedValues = new Map();
const favoriteIds = new Set(["book-12", "book-34"]);
vm.runInNewContext(match[0] + String.fromCharCode(10) + "persistFavorites();", {
  favoriteIds,
  localStorage: {
    setItem(key, value) {
      savedValues.set(key, value);
    },
  },
});

assert.deepEqual(JSON.parse(savedValues.get("biblio-favorites")), ["book-12", "book-34"]);
assert.ok(savedValues.has("biblio-favorites-updated-at"));
process.stdout.write("Favorite persistence test passed.\n");

const createElementMatch = source.match(/function createElement\(tag, className, text\) \{[\s\S]*?\n\}/);
const heroesMatch = source.match(/async function refreshMyHeroes\(\) \{[\s\S]*?\n\}\n\nasync function initialize\(\)/);
assert.ok(createElementMatch, "createElement must exist for the games UI");
assert.ok(heroesMatch, "refreshMyHeroes must exist");

function fakeElement() {
  return {
    children: [],
    className: "",
    textContent: "",
    hidden: false,
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener() {},
  };
}
const heroesSection = fakeElement();
const heroesList = fakeElement();
const requestedPaths = [];
const heroesContext = {
  currentUser: { id: 7 },
  console,
  document: {
    querySelector(selector) {
      return selector === "#my-heroes-section" ? heroesSection : heroesList;
    },
    createElement: fakeElement,
  },
  api: async (path) => {
    requestedPaths.push(path);
    if (path === "/api/my/games") {
      return {
        games: [
          { id: 101, catalog_game_slug: "dnd" },
          { id: 102, catalog_game_slug: "bunker-online" },
        ],
      };
    }
    if (path === "/api/games/101") {
      return {
        game: {
          title: "Тестовая кампания",
          heroes: [
            { user_id: 7, game_id: 101, name: "Свой герой", race: "Эльф", class_name: "Маг", level: 3, xp: 900, hp: 18, max_hp: 22 },
            { user_id: 8, game_id: 101, name: "Чужой герой", race: "Человек", class_name: "Воин", level: 2, xp: 400, hp: 20, max_hp: 20 },
          ],
        },
      };
    }
    throw new Error("Unexpected API path: " + path);
  },
  openGameRoom() {},
};
vm.runInNewContext(createElementMatch[0] + "\n" + heroesMatch[0].replace(/\n\nasync function initialize\(\)$/, ""), heroesContext);
(async () => {
  await vm.runInNewContext("refreshMyHeroes()", heroesContext);
  assert.equal(heroesSection.hidden, false);
  assert.deepEqual(requestedPaths, ["/api/my/games", "/api/games/101"]);
  assert.equal(heroesList.children.length, 1);
  assert.equal(heroesList.children[0].className, "my-hero-card");
  const renderedText = JSON.stringify(heroesList.children[0], (key, value) => key === "addEventListener" ? undefined : value);
  assert.match(renderedText, /Свой герой/);
  assert.doesNotMatch(renderedText, /Чужой герой/);
  process.stdout.write("Personal heroes UI test passed.\\n");
})().catch((error) => {
  process.stderr.write(String(error.stack || error) + "\\n");
  process.exitCode = 1;
});
