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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const currentVersion = require("../version.json");
  const versionParts = currentVersion.version.split(".").map(Number);
  versionParts[2] += 1;
  const nextVersion = versionParts.join(".");
  const nextBuild = currentVersion.build + 1;
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
        version: nextVersion,
        notes: `## ${nextVersion} (2026-08-15)\n\n### Bug Fixes\n\n* prove release preparation`,
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

  assert.deepEqual(version, { version: nextVersion, build: nextBuild, minimumOS: "14.0" });
  assert.match(projectDefinition, new RegExp(`MARKETING_VERSION: "${escapeRegExp(nextVersion)}"`));
  assert.match(projectDefinition, new RegExp(`CURRENT_PROJECT_VERSION: "${nextBuild}"`));
  assert.equal(
    (xcodeProject.match(new RegExp(`MARKETING_VERSION = ${escapeRegExp(nextVersion)};`, "g")) || [])
      .length,
    2
  );
  assert.equal(
    (xcodeProject.match(new RegExp(`CURRENT_PROJECT_VERSION = ${nextBuild};`, "g")) || []).length,
    2
  );
  assert.ok(changelog.startsWith(`${releasePrepare.CHANGELOG_TITLE}\n\n## [${nextVersion}] - `));
  assert.match(changelog, /### Bug Fixes\n\n- prove release preparation/);
  assert.match(changelog, new RegExp(`## \\[${escapeRegExp(currentVersion.version)}\\] - `));
});

test("successful main tests are the only automatic release trigger", () => {
  assert.match(testsWorkflow, /push:\n\s+branches: \[main\]/);
  assert.match(semanticWorkflow, /workflow_run:\n\s+workflows: \["Tests"\]/);
  assert.match(semanticWorkflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(semanticWorkflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(semanticWorkflow, /No Tests workflow run exists/);
  assert.match(semanticWorkflow, /uses: \.\/\.github\/workflows\/release\.yml/);
  assert.match(semanticWorkflow, /tested_sha: \$\{\{ needs\.release\.outputs\.tested_sha \}\}/);
  assert.match(releaseWorkflow, /workflow_call:/);
  assert.doesNotMatch(releaseWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(semanticWorkflow, /\n  push:/);
});

test("stable publication requires main ancestry, a matching draft, and Apple credentials", () => {
  assert.match(releaseWorkflow, /PARENT_SHA.*TESTED_SHA/s);
  assert.match(releaseWorkflow, /Release commit changed files outside the semantic-release allowlist/);
  assert.match(releaseWorkflow, /git merge-base --is-ancestor "\$TAG_SHA" origin\/main/);
  assert.match(releaseWorkflow, /must still be a draft before artifact publication/);
  assert.match(releaseWorkflow, /Draft \$RELEASE_TAG is not visible yet; retrying/);
  assert.match(releaseWorkflow, /APPLE_CERTIFICATE_BASE64/);
  assert.match(releaseWorkflow, /APPLE_API_KEY_BASE64/);
  assert.match(releaseWorkflow, /xcrun notarytool submit/);
  assert.match(releaseWorkflow, /xcrun stapler validate/);
  assert.match(releaseWorkflow, /arch: \[arm64, x86_64\]/);
  assert.match(releaseWorkflow, /needs: \[prepare-release, build-unsigned\]/);
  assert.match(releaseWorkflow, /needs: \[prepare-release, sign-notarize\]/);
  assert.ok(
    releaseWorkflow.indexOf("Build unsigned ${{ matrix.arch }} app") <
      releaseWorkflow.indexOf("Import Developer ID certificate")
  );
  assert.match(releaseWorkflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(releaseWorkflow, /persist-credentials: false/);
  assert.match(releaseWorkflow, /environment: apple-release/);
  assert.match(releaseWorkflow, /name: better-shot-unsigned-/);
  assert.match(releaseWorkflow, /pattern: better-shot-notarized-/);
  assert.doesNotMatch(releaseWorkflow, /security import[\s\S]*?-A/);
  assert.match(releaseWorkflow, /Tag \$RELEASE_TAG moved/);
  assert.match(releaseWorkflow, /Remote release asset set is incomplete or unexpected/);
  assert.match(releaseWorkflow, /revalidate_draft exact/);
  assert.match(releaseWorkflow, /--draft=false/);
});

test("current GitHub Actions and release dependencies receive weekly updates", () => {
  const allWorkflows = fs
    .readdirSync(workflowDirectory)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => fs.readFileSync(path.join(workflowDirectory, file), "utf8"))
    .join("\n");

  const actionReferences = [...allWorkflows.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
  assert.ok(actionReferences.length > 0);
  for (const [, action, reference] of actionReferences) {
    if (action.startsWith("./")) continue;
    assert.match(reference, /^[0-9a-f]{40}$/, `${action} must use an immutable commit SHA`);
  }
  assert.match(allWorkflows, /actions\/checkout@[0-9a-f]{40} # v7/);
  assert.match(allWorkflows, /actions\/setup-node@[0-9a-f]{40} # v7/);
  assert.match(allWorkflows, /actions\/upload-artifact@[0-9a-f]{40} # v7/);
  assert.match(allWorkflows, /actions\/download-artifact@[0-9a-f]{40} # v8/);
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
