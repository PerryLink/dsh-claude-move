# dsh-claude-move

**Keep your Claude Code history when you move to DeepSeek Harness.** One install copies every Claude session, memory, skill and `CLAUDE.md` into DSH as resumable sessions — organized into one workspace per Claude project.

`Copy-only` · `Seamlessly resumable` · `Per-project workspaces` · `Live sync with Claude Code`

[![Test](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml/badge.svg)](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml)
[![Node ^22.19 || >=24](https://img.shields.io/static/v1?label=node&message=%5E22.19%20%7C%7C%20%3E%3D24&color=2f7d4f)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Topic: dsh](https://img.shields.io/badge/topic-dsh-3fb950)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/PerryLink/dsh-claude-move/issues)

![dsh-claude-move social card](assets/social-card.png)

English | [中文](README.zh.md) | [Español](README.es.md) | [Português](README.pt.md) | [हिन्दी](README.hi.md)

> Developer preview (0.1.0). Roadmap and design: [PLAN.md](PLAN.md) · change history: [CHANGELOG.md](CHANGELOG.md).

## ✨ Features

- 🔍 **Auto-discovery** — locates the Claude data root (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`) and indexes every project/session (title, timestamps, message & tool-call counts), directory & git state, memories, skills, global `CLAUDE.md` and `settings.json` — with incremental caching that re-reads only changed files.
- 📥 **Full-fidelity history import** — balanced, resumable DSH sessions (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), one workspace per Claude project, malformed lines reported with line numbers.
- 🔁 **Copy-only & incremental** — nothing on either side is moved, rewritten, or deleted. Re-running the import appends only the new turns to the same DSH session; `force: true` saves an extra full copy under a new id.
- 🧠 **Personal context, always fresh** — memories injected as a live prompt section, Claude skills registered as real DSH skills, global + project `CLAUDE.md` injected early.
- ⚡ **Live sync with a running Claude Code** — keep using Claude Code side by side; each re-run brings only what changed.
- 🖥 **Web panel & one-shot commands** — `/claude-import-all`, `/resume-claude`, and a floating migration panel with progress.
- 🛡 **Safety first** — source files strictly read-only, DSH logs append-only, secrets reported by position only, permission-class records counted but never imported.

## 🚀 Quick start

```sh
# 1. Install
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move
```

2. In any DSH session, run one command:

```
/claude-import-all      # scan → copy every Claude session → report
```

3. Refresh the already-open Web page once (the panel has a 「刷新会话列表」 button) and click any imported session to continue. **No DSH restart is needed** — see [After importing](#-after-importing).

Prefer fine-grained control?

```
claude_scan                                     # structured index of all projects/sessions
import_claude { path: "~/.claude/projects" }    # one project directory (recursive)
import_claude { path: "all" }                   # everything
```

## 🗂 What gets migrated

```
~/.claude (read-only)
 ├─ projects/*/*.jsonl  ──→  resumable DSH sessions, one workspace per project (cwd)
 ├─ projects/*/memory/  ──→  live system-prompt memory section (re-read per request)
 ├─ skills/**           ──→  real DSH skills
 └─ CLAUDE.md + settings ──→  early prompt section + config suggestions (never auto-applied)
```

| In Claude Code | Lands in DSH as |
| --- | --- |
| Session transcripts (`projects/*/*.jsonl`) | Balanced, resumable DSH sessions — full-fidelity `user`/`assistant`/`tool`/`thinking` mapping — grouped into one workspace per project (`cwd`) |
| Memory files (`projects/*/memory/*.md`) | A live system-prompt context section, re-read on every request (`feedback > project > reference > user`) |
| Skills (`~/.claude/skills/**`) | Real DSH skills (kebab-case names, collision suffixes, max 30 by default) |
| `CLAUDE.md` (global + per-project) | An early prompt section; the project file wins |
| `settings.json` | DSH configuration suggestions with an explicit unmappable-keys list |
| Project state (directory, git branch & dirty count) | Shown in the scan index and the Web panel badges |

## 📦 Install

```sh
# From GitHub
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move

# Local checkout (development)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# From a packed tarball
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

The package is pure ESM with no build step, so Git installs need no `prepare` script or `allowBuilds` entry. See the official [package & install guide](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## 🛠 Usage

Call the tools in any session with the plugin mounted:

```
claude_scan                          # full scan (incremental cache)
claude_scan { path: "~/.claude/projects/<slug>" }   # partial scan
claude_scan { refresh: true }        # skip cache, rescan everything

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # one session
import_claude { path: "~/.claude/projects" }        # directory (recursive)
import_claude { path: "all" }                       # everything
# Re-run any time: unchanged files are skipped, grown transcripts append only the new turns.
import_claude { path: "...", force: true }          # fresh full copy as import-<src>-<n> (previous copy kept)
```

Commands (user-triggered, no model turn):

```
/claude-import-all                # one-shot: scan → import everything → report → inject into the current session
/resume-claude latest             # continue the most recent Claude session
/resume-claude <sessionId>        # by source session id or import-<src> id
/resume-claude <keyword>          # match titles; multiple matches are listed, never guessed
```

Web panel: a floating **🐳 Claude 迁移** button (bottom-right) opens the migration panel — project/session tree with status badges (not imported / imported / source missing / directory missing / git dirty), keyword filter, per-session "Import & continue" + "Refresh session list", batch import with a live progress bar. Served through the plugin's own `/api/claude-move/*` JSON routes registered on the public `ctx.webServer` seam.

- **Scan** returns a structured JSON index: projects (slug/cwd/directory existence/git branch & dirty count), sessions (title/timestamps/message & tool-call counts/malformed lines), memories, skills, global CLAUDE.md and settings.json; each session carries `import.status` (`none`/`imported`/`source-missing`). `settingsSuggestions` holds the DSH translation of settings.json plus the unmappable keys (see [Compliance](COMPLIANCE.md)).
- **Import** maps user/assistant/tool/thinking messages with full fidelity; the result is a balanced, resumable session attached to its workspace by `cwd`. Batch results are per-file (`imported`/`appended`/`already-imported`/`skipped`/`failed`), malformed lines carry line numbers, suspected secrets are reported by position only (file:line:kind), and permission-class records are counted but never imported. Importing never deletes or rewrites anything: existing DSH sessions are untouched, previously imported copies are kept, and Claude's source files are never written to.
- **Personal context takes effect automatically** (no import action needed):
  - Memories: all `projects/*/memory/*.md` are injected as a dynamic context section, re-read per request (new memories apply immediately), ordered `feedback > project > reference > user`, capped at 8 KiB by default.
  - Skills: `~/.claude/skills/**/SKILL.md` (plus flat `*.md`) become DSH skills (names normalized to kebab-case, collisions suffixed, max 30); DSH owns catalog injection and the `skill` tool.
  - Instructions: global `~/.claude/CLAUDE.md` plus the current session's `.claude/CLAUDE.md` are injected as an early prompt section (project wins).

## ✅ After importing

**You do not need to restart DSH.** Imports land durably through the public `sessionPersistence` service the moment they complete:

- The server-side lists (`session.list` / `workspace.list` RPCs, the CLI, any new page load) show the imported sessions and their per-project workspaces immediately.
- One exception: an **already-open Web page** needs one session-list refresh before the new session rows appear. Imports write cold sessions directly through the persistence service, so they do not emit the live `host/session-added` frame; workspace groups, however, do update live (`host/workspace-changed`). Click the panel's 「刷新会话列表」 button (or reload the page) — no server restart involved.
- Imported sessions can be opened, read, and resumed right away — `/resume-claude`, or click the session in the list after that refresh. Re-running the import at any time syncs only the new turns into the same sessions.

## ⚙️ Configuration

All optional, overridable in `cordis.yml`:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # default: $CLAUDE_CONFIG_DIR or ~/.claude
    scanGit: true               # probe git branch & dirty state
    gitTimeoutMs: 5000          # git subprocess timeout
    maxTranscriptBytes: 67108864
    excludeProjects: []         # slug substrings to skip, e.g. ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # handoff summary char cap
    enableWebPanel: true      # register the /api/claude-move/* panel routes
    importConcurrency: 4      # parallel read+convert per batch (persisting stays sequential)
```

## 🗑 Uninstall

Remove the `claude-move` row from the profile's bundles and restart `dsh`. Imported sessions stay in DSH's data directory; the plugin only writes its cache (`$DSH_HOME/claude-move/`) and never touches Claude source data.

## 🧭 Compatibility

- Targets `dsh 0.1.0-rc.6` (web profile); peer dependencies pinned to `0.1.0-rc.6`. Node `^22.19 || >=24`.
- Last verified **2026-08-13** on Windows (Node 22) against `@deepseek-ai/dsh@0.1.0-rc.6`: fresh tarball install, real scan (40 projects / 2387 sessions), real batch import 13/13 with idempotent re-import 13/13, workspace attach and persistence artifacts confirmed. macOS/Linux pending.
- Verified **2026-08-14** against the current `deepseek-harness` checkout (web profile, JSONL+zstd session backend, real workspace registry) in an isolated home: full web boot with the plugin mounted, scan + import-all through the panel routes, per-`cwd` workspace creation with sessions attached, incremental append to an existing imported session (contiguous seq, loads cleanly), restart-safe re-import, and untouched pre-existing DSH sessions throughout. No session is ever archived, deleted, or rewritten.

## 🔐 Permissions & data

- **Reads** `~/.claude` (transcripts, memories, skills, CLAUDE.md, settings.json) — strictly read-only — and the project directories it imports into (workspace attach).
- **Writes** DSH session logs via the public `sessionPersistence` service — create + append only, never deletes, rewrites, or archives existing sessions — workspace-registry records, and its own cache under `$DSH_HOME/claude-move/` (scan bookmarks + import map).
- **Never** modifies Claude source files, touches other applications' data, or accesses the network.
- **No credentials** are read or transmitted; suspected secrets in transcripts are reported by position only.

## 🛡 Security boundaries

- Source files are strictly read-only; DSH session logs are append-only (`create` + `append` only).
- External transcripts are untrusted input: nothing in them is executed; system/developer/thinking content never enters the resume handoff.
- No changes to the DSH engine, official UI packages, or apiproxy — only public services (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`).
- Suspected secrets are reported by location only (never their content); `permission`/`permission-mode`/`queue-operation` records are counted, not imported.

## 🩺 Troubleshooting

- Row not effective: `dsh --profile <p> --dump-config` should print `# == dsh-claude-move`; re-run `dsh plugin --profile <p> add -w ...`.
- Web boots but hangs silently: new profiles initialized by `dsh plugin add` contain only `dsh-base` — add `@deepseek-ai/dsh-web-app` to `dsh.profile.bundles`. Installing into the existing `web` profile needs nothing.
- Panel routes 404: they are served only when `enableWebPanel: true` and a web server is composed; check the boot log for FAILED fibers.
- Import fails with "transcript 过大": raise `maxTranscriptBytes` or import that file individually.
- Import succeeded but the sidebar shows no new session: the page was already open — click the panel's 「刷新会话列表」 (or reload the page) once. No DSH restart is ever needed.
- Logs: boot failures print to the `dsh` console; the plugin logs `[claude-move]`-prefixed errors for workspace/import-map issues.

## 📚 Docs

- [PLAN.md](PLAN.md) — research conclusions and the implementation plan.
- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture diagram and the full data-mapping table.
- [COMPLIANCE.md](COMPLIANCE.md) — clause-by-clause audit against the official plugin constraints (deepseek-harness repo & docs, [deepseek.com/harness](https://www.deepseek.com/harness/), the [developer docs](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis), and the [Cordis paper](https://github.com/cordiverse/paper)).
- [OPTIMIZATION.md](OPTIMIZATION.md) — measured baselines and ranked optimization candidates.
- [RELEASE.md](RELEASE.md) — release checklist with acceptance evidence.
- [CHANGELOG.md](CHANGELOG.md) — what changed per version.

## 🙏 Attribution (open-source components)

This project is licensed under the Apache License 2.0; the following MIT-licensed components retain their own licenses (full text in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- Conversion core vendored from [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Discovery conventions & safety model from [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; its `session_reader.py` has an Apache-2.0 upstream — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Memory/skills injection & frontmatter parsing patterns from [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## 🧑‍💻 Development

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + extended), discovery, import/report, context, settings
```

CI runs the full suite on Node 22 via GitHub Actions ([test.yml](.github/workflows/test.yml)).

## 🧠 Model Experience

- The model-facing surface is the two tools' descriptions/schemas and their outputs: `claude_scan` returns the structured index, `import_claude` returns per-file summaries with positions of warnings. Tool results are themselves logged `tool/result` events, so everything is reconstructable.
- No hidden model-facing text; memory/CLAUDE.md sections are registered on `ctx.systemPrompt` (prompt assembly, rebuildable from the session log).

## ⚠️ Known Limitations

- Titles come from `custom-title`/`ai-title`/first prompt; Claude `summary` records are not used as titles.
- `thinking` blocks are kept in the imported log as `reasoning` content, but never enter the resume handoff.
- Permission-class records are counted, not imported; DSH permission-preset suggestions are generated in reports.
- Transcripts larger than `maxTranscriptBytes` fail loudly instead of partial import (fidelity first); chunked streaming import is on the roadmap.
- Sessions whose source directory was deleted still import, but workspace attach fails (left ungrouped; `workspace.attached: false` plus a `reason` in the report).
- Interrupted batch imports can be safely re-run (idempotent, append-only): finished files are skipped, grown files append only the new turns.
- If a transcript was truncated or reset in place (fewer turns than the recorded import), re-import skips it and reports `sourceShrunk`; use `force: true` for a fresh full copy.
- The Web panel is a zero-build floating panel driven by the plugin's own JSON routes; it does not use the shell's internal UI slot system (kept independent of undocumented rc.6 internals).

## 🤝 Contributing & feedback

Issues and pull requests are welcome — please use the provided templates ([bug report](.github/ISSUE_TEMPLATE/bug-report.yml), [feature request](.github/ISSUE_TEMPLATE/feature-request.yml)). Questions and discussion live in the repo's GitHub Discussions. Report security issues privately via GitHub Security Advisories (repo Settings → Security).

## 🔗 Related links

- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [site](https://www.deepseek.com/harness/) · [developer docs](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- Plugin ecosystem: [`dsh` topic](https://github.com/topics/dsh) · [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party notices (including the MIT text for the MIT-licensed components) in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
