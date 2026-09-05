# Files local diff review fixes

User authorized all eleven review findings. Preserve the existing staged changes; only edit the working tree. No staging, commits, pushes or sub-agents.

Use real repository, parser and component regressions before production fixes. Reuse native Git/jsdiff and the existing Markdown and host UI boundaries.

- [x] Canonical Git path spelling, including macOS Unicode and configured case matching.
- [x] Resolve owning repositories inside submodules; never invent empty baselines below gitlinks.
- [x] Isolate unrelated non-UTF-8 status pathnames while preserving rename detection.
- [x] Select complete blocks per source range and include adjacent reference-definition changes.
- [x] Disable historical relative links recursively through deleted inline containers.
- [x] Synchronize command-palette focus handoff with actual Dialog restoration.
- [x] Preserve cross-file fragments and reuse decoded heading/footnote anchor resolution.
- [x] Align image nodes before reporting attribute replacements.
- [x] Use Source for invisible prose whitespace edits.
- [x] Run affected tests/static checks and actual browser interactions; update backend and rendered-diff reports with results and limits.


Completed 2026-09-05. Reports: `.superpowers/sdd/2026-09-05-files-local-diff-peek/{backend-report,rendered-diff-report}.md`.
Regression evidence includes 73 distinct test files / 609 distinct cases, five isolated runs of both Radix restoration orders, scoped lint, host typecheck, architecture/size/density checks and actual Chromium interactions. Full-app Electron E2E was not rerun; the earlier startup timeout remains recorded in the report.
