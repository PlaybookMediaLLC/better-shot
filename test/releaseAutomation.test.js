const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const workflowDirectory = path.join(root, ".github/workflows");
const testsWorkflow = fs.readFileSync(path.join(workflowDirectory, "tests.yml"), "utf8");
const semanticWorkflow = fs.readFileSync(
  path.join(workflowDirectory, "semantic-release.yml"),
  "utf8"
);
const releaseWorkflow = fs.readFileSync(path.join(workflowDirectory, "release.yml"), "utf8");
const dependabotConfig = fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8");
const releaseConfig = require("../.github/semantic-release/release.config.cjs");
const releaseTooling = require("../.github/semantic-release/package.json");
const releasePrepare = require("../.github/semantic-release/prepare.cjs");

function pluginOptions(name) {
  const entry = releaseConfig.plugins.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name
  );
  return Array.isArray(entry) ? entry[1] : undefined;
}

test("semantic-release maps Conventional Commits into draft releases", () => {
  assert.deepEqual(releaseConfig.branches, ["main"]);
  assert.equal(releaseConfig.tagFormat, "v${version}");
  assert.ok(releaseConfig.plugins.includes("@semantic-release/commit-analyzer"));
  assert.ok(releaseConfig.plugins.includes("@semantic-release/release-notes-generator"));
  assert.ok(releaseConfig.plugins.includes("./.github/semantic-release/prepare.cjs"));
  assert.equal(pluginOptions("@semantic-release/github").draftRelease, true);
  assert.deepEqual(pluginOptions("@semantic-release/git").assets, [
    "CHANGELOG.md",
    "version.json",
    "project.yml",
    "BetterShot.xcodeproj/project.pbxproj",
  ]);
  assert.match(pluginOptions("@semantic-release/git").message, /\[skip ci\]/);
});

test("release preparation synchronizes every version source and changelog", async () => {
  const fixture = await fsPromises.mkdtemp(path.join(os.tmpdir(), "better-shot-release-"));
  const files = [
    "CHANGELOG.md",
    "version.json",
    "project.yml",
    "BetterShot.xcodeproj/project.pbxproj",
  ];

  for (const file of files) {
    const destination = path.join(fixture, file);
    await fsPromises.mkdir(path.dirname(destination), { recursive: true });
    await fsPromises.copyFile(path.join(root, file), destination);
  }

  await releasePrepare.prepare(
    {},
    {
      cwd: fixture,
      logger: { log() {} },
      nextRelease: {
        version: "0.3.8",
        notes: "## 0.3.8 (2026-08-15)\n\n### Bug Fixes\n\n* prove release preparation",
      },
    }
  );

  const version = JSON.parse(await fsPromises.readFile(path.join(fixture, "version.json"), "utf8"));
  const projectDefinition = await fsPromises.readFile(path.join(fixture, "project.yml"), "utf8");
  const xcodeProject = await fsPromises.readFile(
    path.join(fixture, "BetterShot.xcodeproj/project.pbxproj"),
    "utf8"
  );
  const changelog = await fsPromises.readFile(path.join(fixture, "CHANGELOG.md"), "utf8");

  assert.deepEqual(version, { version: "0.3.8", build: 11, minimumOS: "14.0" });
  assert.match(projectDefinition, /MARKETING_VERSION: "0\.3\.8"/);
  assert.match(projectDefinition, /CURRENT_PROJECT_VERSION: "11"/);
  assert.equal((xcodeProject.match(/MARKETING_VERSION = 0\.3\.8;/g) || []).length, 2);
  assert.equal((xcodeProject.match(/CURRENT_PROJECT_VERSION = 11;/g) || []).length, 2);
  assert.ok(changelog.startsWith(`${releasePrepare.CHANGELOG_TITLE}\n\n## [0.3.8] - `));
  assert.match(changelog, /### Bug Fixes\n\n- prove release preparation/);
  assert.match(changelog, /## \[0\.3\.7\] - 2026-06-07/);
});

test("successful main tests are the only automatic release trigger", () => {
  assert.match(testsWorkflow, /push:\n\s+branches: \[main\]/);
  assert.match(semanticWorkflow, /workflow_run:\n\s+workflows: \["Tests"\]/);
  assert.match(semanticWorkflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(semanticWorkflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(semanticWorkflow, /No Tests workflow run exists/);
  assert.match(semanticWorkflow, /gh workflow run release\.yml/);
  assert.match(semanticWorkflow, /-f reuse_semantic_release=true/);
  assert.doesNotMatch(semanticWorkflow, /\n  push:/);
});

test("stable publication requires main ancestry, a matching draft, and Apple credentials", () => {
  assert.match(releaseWorkflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(releaseWorkflow, /must still be a draft before artifact publication/);
  assert.match(releaseWorkflow, /APPLE_CERTIFICATE_BASE64/);
  assert.match(releaseWorkflow, /APPLE_API_KEY_BASE64/);
  assert.match(releaseWorkflow, /xcrun notarytool submit/);
  assert.match(releaseWorkflow, /xcrun stapler validate/);
  assert.match(releaseWorkflow, /arch: \[arm64, x86_64\]/);
  assert.match(releaseWorkflow, /needs: \[prepare-release, build-macos\]/);
  assert.match(releaseWorkflow, /--draft=false/);
});

test("current GitHub Actions and release dependencies receive weekly updates", () => {
  const allWorkflows = fs
    .readdirSync(workflowDirectory)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => fs.readFileSync(path.join(workflowDirectory, file), "utf8"))
    .join("\n");

  assert.doesNotMatch(allWorkflows, /actions\/(?:checkout|setup-node)@v4/);
  assert.match(allWorkflows, /actions\/checkout@v7/);
  assert.match(allWorkflows, /actions\/setup-node@v7/);
  assert.match(allWorkflows, /actions\/upload-artifact@v7/);
  assert.match(allWorkflows, /actions\/download-artifact@v8/);
  assert.match(dependabotConfig, /directory: "\/\.github\/semantic-release"/);
  assert.match(dependabotConfig, /package-ecosystem: "github-actions"/);
  assert.equal((dependabotConfig.match(/interval: "weekly"/g) || []).length, 3);
  assert.match(releaseTooling.dependencies["semantic-release"], /^\d+\.\d+\.\d+$/);
  assert.match(releaseTooling.engines.node, /24/);
});

test("the app and landing site consume PlaybookMediaLLC releases", () => {
  const updater = fs.readFileSync(path.join(root, "Sources/Services/AppUpdater.swift"), "utf8");
  const downloads = fs.readFileSync(path.join(root, "bettershot-landing/lib/downloads.ts"), "utf8");
  assert.match(updater, /private let owner = "PlaybookMediaLLC"/);
  assert.match(downloads, /const REPO = "PlaybookMediaLLC\/better-shot"/);
});
