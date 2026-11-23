const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("script.js", "utf8");
const match = source.match(/function persistFavorites\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(match, "persistFavorites must exist");
const functionBody = match[0].replace(/^function persistFavorites\(\)\s*\{/, "").replace(/\n\}$/, "");
assert.doesNotMatch(functionBody, /\bpersistFavorites\s*\(/, "persistFavorites must not call itself");

let savedKey = "";
let savedValue = "";
const favoriteIds = new Set(["book-12", "book-34"]);
vm.runInNewContext(match[0] + "\npersistFavorites();", {
  favoriteIds,
  localStorage: {
    setItem(key, value) {
      savedKey = key;
      savedValue = value;
    },
  },
});

assert.equal(savedKey, "biblio-favorites");
assert.deepEqual(JSON.parse(savedValue), ["book-12", "book-34"]);
process.stdout.write("Favorite persistence test passed.\n");
