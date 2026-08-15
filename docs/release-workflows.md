# Release workflow

## Automatic releases from main

Every push to `main` runs the **Tests** workflow. It validates release contracts, builds the landing
site, and compiles a universal unsigned Better Shot app for both Apple Silicon and Intel. Only a
successful test run for the current `main` commit can trigger **Semantic Release**.

Semantic Release evaluates Conventional Commits since the latest `v*.*.*` tag:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `BREAKING CHANGE:` or `!` creates a major release.
- `build:`, `chore:`, `ci:`, `docs:`, `refactor:`, `style:`, and `test:` do not release by default.

When a release is required, the workflow updates `version.json`, `project.yml`, the checked-in Xcode
project, and `CHANGELOG.md`. It commits those generated files with `[skip ci]`, creates the matching
tag, and opens a draft GitHub release containing generated notes.

The semantic workflow then calls the reusable **Release** workflow directly. Release requires the
successful test commit to be the exact parent of the generated release commit, permits only the four
generated version and changelog files in that commit, and refuses mismatched versions, moved tags,
public releases, missing drafts, and incomplete Apple secret sets. Apple Silicon and Intel builds run
independently. Each architecture is compiled before Apple credentials are installed, then signed with
the Developer ID certificate, packaged into a signed DMG, submitted to Apple, stapled, and verified.
The draft and exact remote asset set are revalidated immediately before upload and publication.

A failed artifact build leaves the tag and draft intact. Use **Re-run failed jobs** on the original
**Semantic Release** run so the same tested commit, tag, and draft are reused.

## Required repository secrets

The release workflow requires all six values:

- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

Secrets are validated by presence only and are never printed. The certificate is imported into an
ephemeral keychain only after compilation, and all temporary key material is removed after each
architecture build. Third-party actions are pinned to immutable commit SHAs and updated by Dependabot.

## Manual verification

A manual **Semantic Release** dispatch defaults to dry-run mode and does not create a tag or release.
A non-dry run requires a successful push-triggered **Tests** run for the exact current commit.
