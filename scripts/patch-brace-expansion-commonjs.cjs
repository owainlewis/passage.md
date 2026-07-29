const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const expectedVersion = "5.0.8";
const expectedHash =
  "994eb761eca1c861f586ce6ab31bc2e7a6bc020dc4d6636d5e8b778c366d133f";
const marker =
  "// passage.md CommonJS compatibility for legacy minimatch consumers";
const compatibilityPatch = `

${marker}
const passageBraceExpansion = exports.expand;
Object.assign(passageBraceExpansion, exports);
module.exports = passageBraceExpansion;
`;

let entryPath;
try {
  entryPath = require.resolve("brace-expansion");
} catch (error) {
  const omittedDependencies = new Set(
    (process.env.npm_config_omit || "").split(/[,\s]+/).filter(Boolean),
  );
  if (error.code === "MODULE_NOT_FOUND" && omittedDependencies.has("dev")) {
    process.exit(0);
  }
  throw error;
}

const packageRoot = path.resolve(path.dirname(entryPath), "..", "..");
const packageMetadata = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);

if (packageMetadata.version !== expectedVersion) {
  throw new Error(
    `Expected brace-expansion ${expectedVersion}, found ${packageMetadata.version}`,
  );
}

const source = readFileSync(entryPath, "utf8");
if (source.includes(marker)) {
  if (!source.endsWith(compatibilityPatch)) {
    throw new Error(
      "The brace-expansion compatibility patch has unexpected content",
    );
  }
  process.exit(0);
}

const actualHash = createHash("sha256").update(source).digest("hex");
if (actualHash !== expectedHash) {
  throw new Error(
    `Refusing to patch unexpected brace-expansion source: ${actualHash}`,
  );
}

writeFileSync(entryPath, source + compatibilityPatch);
