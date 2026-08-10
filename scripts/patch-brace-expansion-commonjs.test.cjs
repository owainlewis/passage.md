const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

const legacyConsumers = [
  "@eslint/config-array",
  "@eslint/eslintrc",
  "eslint",
  "eslint-plugin-import",
  "eslint-plugin-jsx-a11y",
  "eslint-plugin-react",
];
const patchedBraceExpansionPath = require.resolve("brace-expansion");

for (const consumer of legacyConsumers) {
  const consumerRequire = createRequire(require.resolve(consumer));
  const minimatch = consumerRequire("minimatch");

  assert.equal(
    consumerRequire.resolve("brace-expansion"),
    patchedBraceExpansionPath,
    `${consumer} must resolve the patched brace-expansion package`,
  );
  assert.equal(
    typeof minimatch,
    "function",
    `${consumer} must retain minimatch 3's callable CommonJS export`,
  );
  assert.equal(typeof minimatch.Minimatch, "function");
  assert.equal(typeof minimatch.makeRe, "function");
  assert.equal(minimatch("document.md", "*.md"), true);
}

const modernRequire = createRequire(
  require.resolve("@typescript-eslint/typescript-estree"),
);
const modernMinimatch = modernRequire("minimatch");
assert.equal(typeof modernMinimatch.minimatch, "function");
assert.equal(modernMinimatch.minimatch("document.md", "*.md"), true);

const braceExpansion = require("brace-expansion");
assert.equal(typeof braceExpansion, "function");
assert.equal(typeof braceExpansion.expand, "function");
assert.deepEqual(braceExpansion("file-{a,b}.md"), [
  "file-a.md",
  "file-b.md",
]);

Promise.all([
  import("@eslint/config-array"),
  import("@eslint/eslintrc"),
  import("brace-expansion").then((module) => {
    assert.equal(typeof module.expand, "function");
  }),
])
  .then(() => {
    console.log(
      `Verified brace-expansion compatibility for ${legacyConsumers.length + 1} ESLint consumers`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
