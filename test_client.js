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
