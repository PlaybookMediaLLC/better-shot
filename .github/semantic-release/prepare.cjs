const fs = require("node:fs/promises");
const path = require("node:path");

const CHANGELOG_TITLE = `# Changelog

All notable changes to Better Shot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]`;

function replaceAllExact(content, pattern, replacement, expectedCount, label) {
  const matches = content.match(pattern) || [];
  if (matches.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} ${label} entries, found ${matches.length}`);
  }
  return content.replace(pattern, replacement);
}

function releaseNotesBody(notes) {
  return notes
    .trim()
    .replace(/^##[^\n]*\n+/, "")
    .trim();
}

exports.prepare = async (_pluginConfig, context) => {
  const { cwd, logger, nextRelease } = context;
  const versionPath = path.join(cwd, "version.json");
  const projectDefinitionPath = path.join(cwd, "project.yml");
  const xcodeProjectPath = path.join(cwd, "BetterShot.xcodeproj/project.pbxproj");
  const changelogPath = path.join(cwd, "CHANGELOG.md");

  const versionDocument = JSON.parse(await fs.readFile(versionPath, "utf8"));
  const currentBuild = Number(versionDocument.build);
  if (!Number.isSafeInteger(currentBuild) || currentBuild < 1) {
    throw new Error(`Invalid build number in version.json: ${versionDocument.build}`);
  }

  const nextBuild = currentBuild + 1;
  versionDocument.version = nextRelease.version;
  versionDocument.build = nextBuild;
  await fs.writeFile(versionPath, `${JSON.stringify(versionDocument, null, 2)}\n`);

  let projectDefinition = await fs.readFile(projectDefinitionPath, "utf8");
  projectDefinition = replaceAllExact(
    projectDefinition,
    /MARKETING_VERSION: "[^"]+"/g,
    `MARKETING_VERSION: "${nextRelease.version}"`,
    1,
    "project.yml marketing version"
  );
  projectDefinition = replaceAllExact(
    projectDefinition,
    /CURRENT_PROJECT_VERSION: "\d+"/g,
    `CURRENT_PROJECT_VERSION: "${nextBuild}"`,
    1,
    "project.yml build number"
  );
  await fs.writeFile(projectDefinitionPath, projectDefinition);

  let xcodeProject = await fs.readFile(xcodeProjectPath, "utf8");
  xcodeProject = replaceAllExact(
    xcodeProject,
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${nextRelease.version};`,
    2,
    "Xcode marketing version"
  );
  xcodeProject = replaceAllExact(
    xcodeProject,
    /CURRENT_PROJECT_VERSION = \d+;/g,
    `CURRENT_PROJECT_VERSION = ${nextBuild};`,
    2,
    "Xcode build number"
  );
  await fs.writeFile(xcodeProjectPath, xcodeProject);

  const currentChangelog = (await fs.readFile(changelogPath, "utf8")).trim();
  if (!currentChangelog.startsWith(CHANGELOG_TITLE)) {
    throw new Error("CHANGELOG.md must begin with the canonical title and [Unreleased] section");
  }

  const priorEntries = currentChangelog.slice(CHANGELOG_TITLE.length).trim();
  const notes = releaseNotesBody(nextRelease.notes || "");
  const releaseDate = new Date().toISOString().slice(0, 10);
  const nextEntry = `## [${nextRelease.version}] - ${releaseDate}${notes ? `\n\n${notes}` : ""}`;
  const changelog = `${CHANGELOG_TITLE}\n\n${nextEntry}${priorEntries ? `\n\n${priorEntries}` : ""}\n`;
  await fs.writeFile(changelogPath, changelog);

  logger.log(
    "Updated Better Shot to version %s (build %d) and refreshed CHANGELOG.md",
    nextRelease.version,
    nextBuild
  );
};

exports.CHANGELOG_TITLE = CHANGELOG_TITLE;
