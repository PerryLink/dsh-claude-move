<div align="center">

# 🚚 dsh-claude-move
- **1024 store channel**: `npm i -g dsh1024` once, then `dsh1024 plugin --profile web add dsh-claude-move` (counts toward the [deepseek1024.com](https://deepseek1024.com) install ranking).
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-claude-move)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-claude-move/badge)](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-claude-move)

**Migrate Claude Code, Codex, OpenCode and Hermes into DeepSeek Harness — copy sessions, memories, skills, instructions and slash commands as resumable DSH sessions, copy-only and approval-gated.**

*Keep your Claude Code history when you move: one install, resumable sessions, live sync with a running Claude Code, and a four-source migration wizard.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-claude-move.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-top-rated.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-claude-move/test.yml?branch=master&label=CI)](https://github.com/PerryLink/dsh-claude-move/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-claude-move?label=version)](https://github.com/PerryLink/dsh-claude-move/releases)
[![npm version](https://img.shields.io/npm/v/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)
[![npm downloads](https://img.shields.io/npm/dm/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-claude-move
```


</div>

---

![Terminal demo of dsh-claude-move](docs/assets/dsh-claude-move-hero.png)

![Animated terminal demo of dsh-claude-move](docs/assets/dsh-claude-move-demo.gif)

## Install & uninstall

- **git channel** (latest `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — pure ESM, no `prepare` or `allowBuilds` step.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-claude-move`.
- **tarball channel**: `npm pack` in this repo, then `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`.
- **uninstall**: remove the `claude-move` row from the profile's bundles and restart `dsh`. Imported sessions stay in DSH's data directory; the plugin only writes its cache (`$DSH_HOME/claude-move/`) and the `claudecode` workspace folder, and never touches Claude source data.

## Compatibility

- Targets `dsh 0.1.6-alpha.2` (web profile, session format V3); peer dependencies and `engines.dsh` admit the six-clause band through `>=0.2.1-0 <0.3.0`; the 0.2.1 line is statically compatible (no runtime verification recorded). Verified 2026-09-18 (checkJs type gate + 287 assertions, 38 suites). The panel's "open session" button now renders disabled with an explanatory title when the host exposes no `sessions.open()`, instead of disappearing. Node `^22.19 || >=24`.
`0.1.2-rc.1` (adapted 2026-09-04): the session envelope keeps its ignorable field for stored-log read compatibility only - Session.append still cannot stamp it, so audit-gate behavior is unchanged.
- 0.4.0 ships a dual-baseline `sessionPersistence` runtime shim, feature-detected by API shape (never by version): the legacy API (`create`/`append`/`readFrom`, `list()` returning headers) and the handle seam (`create` returning a `SessionHandle`, `list()`/`stat()` returning snapshots) both work. The handle seam is published on the alpha line (`@deepseek-ai/dsh-session-persistence` / `-jsonl` `0.1.5-rc.2`), so the compat workflow covers it. On the handle path every append is followed by `flush()` (durability barrier) and a paired `close()` (single-writer ownership); headers are stamped with the backend's current format version plus an explicit `isSeeded`; missing assistant model sources fall back to the provider; and since 0.4.5 synthesized `assistant/message` events carry `stream: []` when the backend format version is >= 2 — V3's `Session.fromRestore` asserts `Array.isArray(data.stream)`, so without it a log was written and readable but could not be resumed. Import-scan cleanup refuses to run when a listed element's `header.id` cannot be resolved, so `imports.json` is never silently cleared.
- Last verified against a fresh tarball install: real scan, real batch import (idempotent re-import), workspace attach and persistence artifacts confirmed; macOS/Linux covered by the CI matrix. Imported logs use session format V3 and cannot be read by `dsh <= 0.1.2-rc.1` (upgrading is one-way; re-import from the source transcript is the fallback).

### Compatibility matrix (public seams only)

| Surface | Used | Fallback when absent |
|---|---|---|
| Host services (`tools` / `sessionPersistence` / `workspaceRegistry` / `commands` / `systemPrompt` / `skills` / `webServer`) | required where listed | optional services register reactively; missing `fs` fails loud |
| `sessionPersistence` dual baseline: legacy `listSnapshots` / `readFrom` / `append` vs handle `open` / `stat` / snapshot `list()` | feature-detected at runtime (API shape, never version) | the `header.id` resolution guard aborts the scan loudly instead of silently clearing `imports.json` |
| `streamText`-capable `fs` / `ctx.jobs` / `ctx.agents.resume` | feature-detected | whole-file read with loud rejection / own job map / handoff inject |
| Client shell services (`sessions.refresh/open`, `workspaces.refresh`) | feature-detected at panel apply | full-page reload |
| Newer platform capabilities are never hard requirements — the plugin stays bootable on the oldest supported line (`0.1.2-rc.1`). | | |

## What you get

1. **Auto-discovery** — `claude_scan` locates the Claude data root (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`) and indexes every project/session, memory, skill, global `CLAUDE.md` and `settings.json`, with incremental caching and parallel scanning (`scanConcurrency`).
2. **Full-fidelity import** — `import_claude` turns transcripts into balanced, resumable DSH sessions (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), repairs interrupted tool calls, and stream-imports transcripts larger than `maxTranscriptBytes` in chunks.
3. **One `claudecode` workspace** — every imported session lands in a dedicated workspace (default `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` restores one-workspace-per-project grouping.
4. **Copy-only & incremental** — nothing on either side is moved, rewritten, or deleted; re-running appends only the new turns (`force: true` saves an extra full copy under a new id).
5. **Personal context, always fresh** — memories injected as a live prompt section, Claude skills registered as real DSH skills (global + project-level), global + project `CLAUDE.md` injected early.
6. **Four-source migration wizard** — `/move` plus `move_detect` / `move_preview` / `move_run` migrate Claude Code, Codex, OpenCode and Hermes, approval-gated and idempotent (`move.json`).
7. **Web panel & commands** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset`, `/claude-export`, and a floating migration panel.
8. **Bidirectional export** — `claude_export` (or `/claude-export <sessionId>`) writes a DSH session back out as a resumable Claude Code JSONL transcript (`user`/`assistant`/`tool` turns, `thinking` + `tool_use`/`tool_result` pairing, best-effort `cwd` mapping), so history can leave DSH again.

## Four-source migration wizard

```text
/move              # one-shot wizard: detect → preview → execute → report (all four sources)
move_detect        # scan Claude Code / Codex / OpenCode / Hermes
move_preview       # per-item plan: new | unchanged | changed | conflict (with diff) | unsupported
move_run           # execute behind the approval gate; conflict resolution:
                   #   skip | overwrite | rename | merge  (default skip — never guesses)
```

- **Sources** — Claude Code (`~/.claude`), Codex (`~/.codex`), OpenCode (data + config roots), Hermes (skills/memory roots); each source has its own parser + mapper.
- **Mapping** — memories/instructions → append-only managed sections in the DSH global `AGENTS.md` (one marked section per item); skills → real DSH skills (`SKILL.md` bundles copied verbatim, other formats converted); slash commands → registered DSH commands (rebuilt from `move.json` after a restart); sessions → resumable DSH sessions (the same importers as phase 1).
- **Idempotent** — every applied plan is recorded in `$DSH_HOME/claude-move/move.json` (`digest` / `targetDigest` / `appliedAt`); re-runs skip unchanged items and `force` re-applies them.
- **Approval-gated** — a run that would write anything asks `ctx.approval` first; anything but `allowed-once` means zero writes.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"

# or from npm (published releases)
dsh plugin --profile web add dsh-claude-move

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: claude-move'
```

Then, in any DSH session, run one command:

```sh
/claude-import-all      # scan → copy every Claude session → report
```

No DSH restart is needed after importing — refresh the open Web page once and click any imported session to continue.

## What gets migrated

```
~/.claude (read-only)
 ├─ projects/*/*.jsonl  ──→  resumable DSH sessions, grouped in one "claudecode" workspace (default)
 ├─ projects/*/memory/  ──→  live system-prompt memory section (re-read per request)
 ├─ skills/**           ──→  real DSH skills
 └─ CLAUDE.md + settings ──→  early prompt section + config suggestions (never auto-applied)
```

| In Claude Code | Lands in DSH as |
|---|---|
| Session transcripts (`projects/*/*.jsonl`) | Balanced, resumable DSH sessions — full-fidelity `user`/`assistant`/`tool`/`thinking` mapping with interrupted-tool-call repair — grouped into one **`claudecode`** workspace or one per project |
| Memory files (`projects/*/memory/*.md`) | A live system-prompt context section, re-read on every request (`feedback > project > reference > user`) |
| Skills (`~/.claude/skills/**`) | Real DSH skills (kebab-case names, collision suffixes, max 30 by default; `README.md`/`MEMORY.md` and files without a description are skipped) |
| `CLAUDE.md` (global + per-project) | An early prompt section; the project file wins |
| `settings.json` | DSH configuration suggestions with an explicit unmappable-keys list |
| Project state (directory, git branch & dirty count) | Shown in the scan index, the Web panel badges, and the `/resume-claude` handoff |

## Usage

Call the tools in any session with the plugin mounted:

```
claude_scan                          # full scan (incremental cache)
claude_scan { path: "~/.claude/projects/<slug>" }   # partial scan
claude_scan { refresh: true }        # skip cache, rescan everything
claude_scan { projectsLimit: 10, sessionsLimit: 5, fields: "brief" }  # trim output

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # one session
import_claude { path: "~/.claude/projects" }        # directory (recursive)
import_claude { path: "all" }                       # everything
# Re-run any time: unchanged files are skipped, grown transcripts append only the new turns.
# Files over maxTranscriptBytes are stream-imported in chunks (no memory ceiling).
import_claude { path: "...", force: true }          # fresh full copy (previous copy kept)

claude_export { sessionId: "<dsh-session-id>" }     # write a DSH session back to Claude JSONL
claude_export { sessionId: "...", path: "~/.claude/projects/<slug>/<id>.jsonl" }  # explicit target
```

Commands (user-triggered, no model turn):

```
/claude-import-all                # one-shot: scan → import everything → report → inject into the current session
/resume-claude latest             # continue the most recent Claude session
/resume-claude <sessionId>        # by source session id or import-<src> id
/resume-claude <keyword>          # match titles; multiple matches are listed, never guessed
/claude-move-reset                # reset the plugin cache (bookmarks + import map); imported sessions are kept
/claude-export <sessionId> [path] # export a DSH session to a resumable Claude JSONL transcript
```

Web panel: a floating migration panel with the project/session tree, status badges (not imported / imported / imported-with-new-turns / source missing / directory missing / git dirty), keyword filter, paged rendering, per-session "Import & continue" + "Open session" + "Refresh session list", batch import with a live progress bar and cancel, and a cache-reset button. Texts follow the browser language (zh/en). Served through the plugin's own `/api/claude-move/*` JSON routes on the public `ctx.webServer` seam.

## After importing

**You do not need to restart DSH.** Imports land durably through the public `sessionPersistence` service the moment they complete:

- The server-side lists (`session.list` / `workspace.list` RPCs, the CLI, any new page load) show the imported sessions under the **`claudecode` workspace** immediately.
- The panel refreshes the already-open page's session list itself and offers an **Open session** button per imported session.
- Imported sessions can be opened, read, and resumed right away — `/resume-claude`, or click the session in the list. Re-running the import at any time syncs only the new turns into the same sessions.

## Configuration

All optional, overridable in cordis.yml.

| Key | Default | Meaning |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` or `~/.claude` | Claude data root |
| `workspaceMode` | `claudecode` | `claudecode` (one dedicated workspace) · `per-project` (one workspace per source cwd) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | The `claudecode` workspace folder (the only folder the plugin ever creates) |
| `scanGit` | `true` | Git probe level: `true` (full) · `'branch'` (zero git calls) · `false` |
| `gitTimeoutMs` | `5000` | Git subprocess timeout |
| `scanConcurrency` | `8` | Parallel project scan cap |
| `maxTranscriptBytes` | `67108864` | Stream-import threshold (chunked above) |
| `excludeProjects` | `[]` | Slug substrings to skip |
| `enableMemory` | `true` | Inject memories as a live prompt section |
| `memoryMaxBytes` | `8192` | Memory section cap |
| `memoryScope` | `current-project` | `current-project` · `all` (current first) |
| `enableSkills` | `true` | Register Claude skills as DSH skills |
| `maxSkills` | `30` | Skill count cap |
| `extraSkillDirs` | `[]` | Extra skill directories |
| `enableInstructions` | `true` | Inject global + project `CLAUDE.md` |
| `resumeMaxChars` | `2048` | Handoff summary char cap |
| `resumeMode` | `inject` | `inject` (handoff summary) · `agents` (ctx.agents.resume) |
| `enableWebPanel` | `true` | Register the `/api/claude-move/*` panel routes |
| `importConcurrency` | `4` | Parallel read+convert per batch |
| `requireApproval` | `true` | Wizard writes ask `ctx.approval` (allowed-once only) |
| `codexHome` | `$CODEX_HOME` or `~/.codex` | Codex data root |
| `opencodeDataHome` | platform XDG data dir/opencode | OpenCode data root |
| `opencodeConfigHome` | platform XDG config dir/opencode | OpenCode config root |
| `hermesHome` | `$HERMES_HOME` or `~/.hermes` | Hermes data root |
| `skillsDir` | `$DSH_HOME/skills` | Wizard skill target |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | Wizard memory/instruction target |
| `moveWorkspaceMode` | `per-source` | `per-source` · `single` workspace grouping for wizard imports |
| `enableExport` | `true` | Register the `claude_export` tool and `/claude-export` command |
| `exportDir` | `$DSH_HOME/claude-export` | Default export folder (explicit `path` always wins) |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `claude_scan` | tool | Structured index of projects/sessions/memories/skills/settings |
| `import_claude` | tool | Import one session, a directory, or `all` (incremental, `force` for a fresh copy) |
| `claude_export` | tool | Export a DSH session to a resumable Claude Code JSONL transcript |
| `move_detect` / `move_preview` / `move_run` | tools | Four-source wizard: scan, per-item plan with diffs, execute behind approval |
| `/claude-import-all` | command | Scan → import everything → report |
| `/resume-claude` | command | Continue a Claude session (latest, id, or keyword) |
| `/claude-move-reset` | command | Reset the plugin cache (imported sessions kept) |
| `/claude-export` | command | Export a DSH session to a resumable Claude JSONL transcript |
| `/move` | command | One-shot four-source wizard |
| Web migration panel | client | Floating panel with progress, cancel, paging, open session |

## Permissions & data

- **Permissions**: the workshop manifest declares `filesystem:read` and `filesystem:write`.
- **Reads** `~/.claude` (transcripts, memories, skills, `CLAUDE.md`, `settings.json`) — strictly read-only — and the project directories it imports into.
- **Writes** DSH session logs via the public `sessionPersistence` service (create + append only, never delete/rewrite/archive), workspace-registry records, its cache under `$DSH_HOME/claude-move/`, the `claudecode` workspace folder, and exported `.jsonl` files under `$DSH_HOME/claude-export/` (or an explicit target path).
- **Never** modifies Claude source files, touches other applications' data, or accesses the network. **No credentials** are read or transmitted.

## Security boundaries

- **Source files are read-only; DSH logs are append-only** (`create` + `append` only).
- **External transcripts are untrusted input** — nothing in them is executed; system/developer/thinking content never enters the resume handoff.
- **Public services only** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; no engine or UI changes.
- **Secrets reported by position only** (file:line:kind); `permission`/`permission-mode`/`queue-operation` records are counted, not imported.
- **Wizard writes are approval-gated** — anything but `allowed-once` means zero writes.

## Known limitations

- Titles come from `custom-title`/`ai-title`/first prompt; Claude `summary` records are reported but not mapped to DSH compaction nodes (synthesizing a valid compaction transaction would fabricate its seq range and checkpoint message).
- `thinking` blocks are kept as `reasoning` content but never enter the resume handoff.
- Interrupted tool calls are repaired with a synthetic error result (never dropped), reported as `repaired.synthesized`.
- Permission-class records are counted, not imported; DSH permission-preset suggestions are generated in reports.
- On hosts without a streaming `fs.streamText` surface, transcripts larger than `maxTranscriptBytes` fail loudly instead of partial import.
- In `workspaceMode: 'per-project'`, sessions whose source directory was deleted still import, but workspace attach fails (left ungrouped; `workspace.attached: false` plus a `reason`). The default `claudecode` workspace does not depend on the source directory.
- If a transcript was truncated or reset in place (fewer turns than the recorded import), re-import skips it and reports `sourceShrunk`; use `force: true` for a fresh full copy.
- The Web panel is a zero-build floating panel driven by the plugin's own JSON routes; it does not use the shell's internal UI slot system.

## Model Experience

- The model-facing surface is the tools' descriptions/schemas and their outputs: `claude_scan` returns the structured index, `import_claude` returns per-file summaries with positions of warnings, and `claude_export` returns the export summary (target path + turn/message/tool counts). Tool results are themselves logged `tool/result` events, so everything is reconstructable.
- No hidden model-facing text; memory/`CLAUDE.md` sections are registered on `ctx.systemPrompt` (prompt assembly, rebuildable from the session log).

## Troubleshooting

- Row not effective: `dsh --profile <p> --dump-config` should print `# == dsh-claude-move`; re-run `dsh plugin --profile <p> add ...`.
- Web boots but hangs silently: new profiles initialized by `dsh plugin add` contain only `dsh-base` — add `@deepseek-ai/dsh-web-app` to `dsh.profile.bundles`. Installing into the existing `web` profile needs nothing.
- Panel routes 404: they are served only when `enableWebPanel: true` and a web server is composed; check the boot log for FAILED fibers.
- Import fails with "transcript 过大": raise `maxTranscriptBytes` or import that file individually.
- Import succeeded but the sidebar shows no new session: the page was already open — click the panel's refresh button (or reload the page) once. No DSH restart is ever needed.
- Logs: boot failures print to the `dsh` console; the plugin logs `[claude-move]`-prefixed errors for workspace/import-map issues.

## Attribution (open-source components)

This project is licensed under the Apache License 2.0; the following MIT-licensed components retain their own licenses (full text in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- Conversion core vendored from [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Discovery conventions & safety model from [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT).
- Memory/skills injection & frontmatter parsing patterns from [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## Development

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

CI runs the full suite on Node 22 across Linux/macOS/Windows via GitHub Actions ([test.yml](.github/workflows/test.yml)).

## Topics

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the import pipeline, the four-source migration wizard, the Web panel, docs, CI/CD and releases.
- [@OLDnana1](https://github.com/OLDnana1) — root-cause analysis of the interrupted tool-call corruption that made imported sessions permanently return HTTP 400 on resume.
- [@GooodWei](https://github.com/GooodWei) — identified `README.md` (and any description-less `.md`) being misregistered as a skill, which broke DSH's skill load.

## PerryLink DSH Plugin Family

This project is one of the **87 actively maintained** DeepSeek Harness plugins from [PerryLink](https://github.com/PerryLink). The family roster is **95** plugins in total — **5 frozen**, **3 retired** — and stays collapsed below so every README keeps a short first screen. Expand it to see every row, with the reason in the Status column.

<details>
<summary>Expand all 95 plugins</summary>

| Plugin | One-liner | Status |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRED — see the repo README |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 FROZEN — see the repo README |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 FROZEN — see the repo README |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 FROZEN — see the repo README |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 FROZEN — see the repo README |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 FROZEN — see the repo README |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRED — see the repo README |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRED — see the repo README |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

### Install from the DSH Desktop Market

All PerryLink plugins are browsable in the built-in DSH Desktop Market: **Market → Sources → add source → paste** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ select it**. Installation still goes through the Market's npm-identity verification and your confirmation.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
