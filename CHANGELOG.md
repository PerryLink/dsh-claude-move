# CHANGELOG

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-08-14

### Changed

- License: the project is now licensed under the **Apache License 2.0** (previously MIT). `LICENSE` replaced, a `NOTICE` file added, SPDX identifiers added to shipped sources, and `THIRD_PARTY_NOTICES.md` now carries the full MIT text required by the vendored MIT components (which keep their own licenses).
- Copy-only force re-import: `force: true` now saves a fresh full copy under `import-<src>-<n>` and keeps the previous copy untouched. Imported sessions are never archived, deleted, rewritten, or hidden.
- Incremental sync: re-importing a transcript that grew since the last import appends only the new turns to the same DSH session (contiguous seq); a transcript modified within an already-imported turn is reported as `changedInPlace` and left untouched; a truncated source reports `sourceShrunk`.
- Workspace mirroring: one workspace per Claude project directory (`cwd`), with every imported session attached to its own project's workspace; attach failures now carry a `reason`.
- Import reporting: batch results include an `appended` counter; panel and `/claude-import-all` state explicitly that no DSH restart is needed (refresh the open Web page once instead).

### Added

- Auto-discovery of the Claude data root with streaming scan, incremental cache, project/session/git/memory/skill index, and the `claude_scan` tool.
- Full-fidelity history import (`import_claude`): balanced, resumable DSH sessions, per-`cwd` workspace attach, batch import, line-numbered malformed-line reporting, secret position-only warnings, permission-record accounting.
- Personal context: live memory injection, Claude skills provider, global + project `CLAUDE.md` prompt section, `settings.json` translation suggestions.
- User commands `/claude-import-all` and `/resume-claude` (handoff summary with the resume-plugin safety model).
- Web migration panel (`dsh.client`) with `/api/claude-move/*` JSON routes.
- Tool contract hardening: `claude_scan` / `import_claude` honor `exec.signal` (scan aborts per line/project; batch import aborts between files and before each persist) and throw `signal.reason` on abort.
- `importConcurrency` config (default 4): batch import reads + converts files concurrently, then persists in deterministic filename order (id suffix avoidance and the import map stay order-dependent and serial).
- `gitTimeoutMs` config (default 5000): the git subprocess timeout is no longer hardcoded.
- GitHub Actions CI running the full test suite on Node 22 (100/100, green).
- Issue templates (bug report, feature request), a social preview card (`assets/social-card.png`), and a GitHub Release for `v0.1.0`.
- GitHub-style README polish in all five languages: highlight pills, feature grid, quick start, data-flow diagram, emoji sections, and `dsh` / `dsh-plugin` topic badges.
- Documentation: five-language README, PLAN, ARCHITECTURE, COMPLIANCE, OPTIMIZATION, RELEASE, THIRD_PARTY_NOTICES.
