# CHANGELOG

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.2.0] - 2026-08-15

### Added

- Chunked streaming import for transcripts over `maxTranscriptBytes` (`fs.streamText` + a streaming converter): first import creates on the first batch, grown sources append from the stored length, `force` saves a new copy; per-line secret scanning keeps working; hosts without a streaming surface keep the loud rejection (C3).
- Parallel project scanning (`scanConcurrency`, default 8) with unchanged determinism; `gitBranch` reuse and a three-level `scanGit` (`true` / `'branch'` / `false`) that skips `rev-parse` when the transcript already carries the branch (C1/C2).
- `claude_scan` output trimming (`projectsLimit` / `sessionsLimit` / `fields: 'brief'`) and a `removedBookmarks` count for deleted source files (C4/C5).
- Memory injection scoping (`memoryScope`): current-project-only by default (all projects fall back when the cwd has no project), `all` puts the current project first (B3).
- Project-level Claude skills (`<cwd>/.claude/skills`) exposed per `options.cwd`, with `path`/`metadata` candidates and `signal` support (B2).
- `/claude-move-reset` command + panel button + `POST /api/claude-move/reset` route: resets only the plugin cache files, imported sessions are kept (D5).
- Panel import jobs: `DELETE /api/claude-move/job` cancellation (panel cancel button), optional `ctx.jobs` registration for official kill/UI surfaces, and Origin/Host checks (403 for cross-origin) on state-changing routes (B5/D4/D6).
- Panel now opens imported sessions in place via the shell's `sessions.open`, refreshes the session list via `sessions.refresh`/`workspaces.refresh` (feature-detected, falls back to reload), shows "imported · new turns" badges, pages large indexes, and ships zh/en texts (B1/D4/D3).
- `resumeMode` config: `'agents'` resumes through `ctx.agents.resume` and falls back to the handoff inject (D2).
- `/resume-claude` exact-id fast path via the imports map + index bookmarks, and a single read of the transcript for import + handoff (A6).
- Tool/command descriptions are now bilingual (English primary + Chinese) (D3).
- **Dedicated `claudecode` workspace (default, E2)**: `workspaceMode: 'claudecode'` groups every imported session into one "claudecode" workspace rooted at `claudecodeDir` (default `$DSH_HOME/claudecode`; the only intentional write the plugin ever makes is `mkdir` there). `workspaceMode: 'per-project'` keeps the previous one-workspace-per-project behavior. The source project cwd is preserved in `imports.json` (`sourceCwd`) and recovered at prompt-assembly time (`sourceCwdSync`) so current-project memory and project `CLAUDE.md` keep resolving; `/resume-claude` handoffs state the original project directory explicitly.
- **Interrupted tool-call repair (issue #1)**: every declared `tool_use` now gets exactly one `tool/result` — real results are deduplicated (first wins), interrupted calls get one synthetic error result, orphan results are dropped. Counters (`repaired.synthesized/duplicateResults/orphanResults`) surface in import reports, handoffs, and the schema; `validateSessionEvents` self-checks the balance so imported sessions never end up with the permanent 400 "tool_call_ids did not have response messages" failure.
- **Skill-candidate hardening (issue #1)**: `README.md`/`MEMORY.md` are never registered as skills; skill files without a non-empty `name`/`description` are skipped (DSH hard-requires a description and otherwise fails the whole skill load). Frontmatter scalars are now unquoted before validation.
- **Safety tripwire test** (`test/safety.test.mjs`): the shipped sources are statically audited — no `rm`/`unlink`/`truncate`/`writeFileSync`/`archiveSession` anywhere except the two named cache files in `resetCacheFiles`, `recursive: true` only with `mkdir`/`readdir`/`importDirectory`, and the client panel only ever requests `/api/claude-move/*`.

### Changed

- The panel starts collapsed (floating button only) and shows an explicit "panel routes disabled" state when `enableWebPanel: false` (A1/A2).
- `imports.json` writes are serialized through an atomic write (temp + rename) and per-source in-flight locks; concurrent imports of the same file reuse the first result (A4).
- Re-import recovers half-created sessions (created but empty log) by appending to the same id instead of minting a suffix copy (A5).
- Import status annotation prefers `listSnapshots` and lazily cleans up import-map entries whose DSH session was deleted, reporting the count (B4).
- Claude `summary` records are reported in results and the handoff (not synthesized into compaction nodes — documented in OPTIMIZATION.md) (D1).
- Removed `"private": true` so `npm publish` works as documented (A3).

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
