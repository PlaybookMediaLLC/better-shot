module.exports = {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "./.github/semantic-release/prepare.cjs",
    [
      "@semantic-release/git",
      {
        assets: [
          "CHANGELOG.md",
          "version.json",
          "project.yml",
          "BetterShot.xcodeproj/project.pbxproj",
        ],
        message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    [
      "@semantic-release/github",
      {
        draftRelease: true,
        successComment: false,
        failComment: false,
        releasedLabels: false,
      },
    ],
  ],
};
