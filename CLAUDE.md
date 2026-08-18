See @AGENTS.md for upstream conventions.

# Fork development rules

This repo is a PlaybookMediaLLC fork of KartikLabhshetwar/better-shot. The
fork changes only the release pipeline: signing, notarization, and
publication.

1. Keep the fork delta minimal. App code changes belong upstream.
2. The fork owns only the release workflow hardening and
   `.github/workflows/sync-upstream.yml`.
3. Pin every GitHub Action to an immutable commit SHA. The release-safety
   check fails the build otherwise.
4. `.github/workflows/sync-upstream.yml` merges upstream main into the
   `upstream` branch every night and opens a PR against main. Conflicts should
   appear only in release workflow files. Keep the fork's release hardening.
   Take upstream's app changes.
