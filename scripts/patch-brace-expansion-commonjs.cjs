const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const expectedVersion = "5.0.9";
const expectedHash =
  "8d1ea713e1dd03f52783bbceea9d85815a3587134d1936ea16257dea83884f15";
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
