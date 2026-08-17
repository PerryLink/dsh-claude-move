<div align="center">

# 🚚 dsh-claude-move

**Migrate Claude Code, Codex, OpenCode and Hermes into DeepSeek Harness — copy sessions, memories, skills, instructions and slash commands as resumable DSH sessions, copy-only and approval-gated.**

*Keep your Claude Code history when you move: one install, resumable sessions, live sync with a running Claude Code, and a four-source migration wizard.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-claude-move/test.yml?branch=master&label=CI)](https://github.com/PerryLink/dsh-claude-move/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-claude-move?label=version)](https://github.com/PerryLink/dsh-claude-move/releases)
[![npm version](https://img.shields.io/npm/v/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)
[![npm downloads](https://img.shields.io/npm/dm/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers pinned to `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | All (host tools + floating Web panel; public seams only) |
| Model | Any (imports are deterministic; no model calls of its own) |

## What you get

1. **Auto-discovery** — `claude_scan` locates the Claude data root (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`) and indexes every project/session, memory, skill, global `CLAUDE.md` and `settings.json`, with incremental caching and parallel scanning.
2. **Full-fidelity import** — `import_claude` turns transcripts into balanced, resumable DSH sessions, repairs interrupted tool calls, and stream-imports transcripts larger than `maxTranscriptBytes` in chunks.
3. **One `claudecode` workspace** — every imported session lands in a dedicated workspace (default `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` restores one-workspace-per-project grouping.
4. **Copy-only & incremental** — nothing on either side is moved, rewritten, or deleted; re-running appends only the new turns.
5. **Personal context, always fresh** — memories injected as a live prompt section, Claude skills registered as real DSH skills, global + project `CLAUDE.md` injected early.
6. **Four-source migration wizard** — the `/move` wizard plus `move_detect` / `move_preview` / `move_run` tools migrate Claude Code, Codex, OpenCode and Hermes: memories become managed `AGENTS.md` sections, skills become DSH skills, slash commands become DSH commands, sessions become resumable DSH sessions — approval-gated and idempotent (`move.json`).
7. **Web panel & commands** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset`, and a floating migration panel with progress, cancel, paging, and "open session".

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

## Install & uninstall

- **git channel** (latest `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — pure ESM, no `prepare` or `allowBuilds` step.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-claude-move`.
- **tarball channel**: `npm pack` in this repo, then `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`.
- **uninstall**: remove the `claude-move` row from the profile's bundles and restart `dsh`. Imported sessions stay; the plugin only writes its cache (`$DSH_HOME/claude-move/`) and the `claudecode` workspace folder, and never touches Claude source data.

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

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `claude_scan` | tool | Structured index of projects/sessions/memories/skills/settings |
| `import_claude` | tool | Import one session, a directory, or `all` (incremental, `force` for a fresh copy) |
| `move_detect` / `move_preview` / `move_run` | tools | Four-source wizard: scan, per-item plan with diffs, execute behind approval |
| `/claude-import-all` | command | Scan → import everything → report |
| `/resume-claude` | command | Continue a Claude session (latest, id, or keyword) |
| `/claude-move-reset` | command | Reset the plugin cache (imported sessions kept) |
| `/move` | command | One-shot four-source wizard |
| Web migration panel | client | Floating panel with progress, cancel, paging, open session |

## Permissions & data

- **Permissions**: the workshop manifest declares `filesystem:read` and `filesystem:write`.
- **Reads** `~/.claude` (transcripts, memories, skills, `CLAUDE.md`, `settings.json`) — strictly read-only — and the project directories it imports into.
- **Writes** DSH session logs via the public `sessionPersistence` service (create + append only, never delete/rewrite/archive), workspace-registry records, its cache under `$DSH_HOME/claude-move/`, and the `claudecode` workspace folder.
- **Never** modifies Claude source files, touches other applications' data, or accesses the network. **No credentials** are read or transmitted.

## Security boundaries

- **Source files are read-only; DSH logs are append-only** (`create` + `append` only).
- **External transcripts are untrusted input** — nothing in them is executed; system/developer/thinking content never enters the resume handoff.
- **Public services only** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; no engine or UI changes.
- **Secrets reported by position only**; `permission`/`permission-mode`/`queue-operation` records are counted, not imported.
- **Wizard writes are approval-gated** — anything but `allowed-once` means zero writes.

## Known limitations

- Titles come from `custom-title`/`ai-title`/first prompt; Claude `summary` records are reported but not mapped to DSH compaction nodes.
- `thinking` blocks are kept as `reasoning` content but never enter the resume handoff.
- Interrupted tool calls are repaired with a synthetic error result (reported as `repaired.synthesized`).
- On hosts without a streaming `fs.streamText` surface, transcripts larger than `maxTranscriptBytes` fail loudly instead of partial import.
- In `workspaceMode: 'per-project'`, sessions whose source directory was deleted still import but workspace attach fails (left ungrouped). The default `claudecode` workspace does not depend on the source directory.
- The Web panel is a zero-build floating panel driven by the plugin's own JSON routes.

## Development

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

## Topics

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the import pipeline, the four-source migration wizard, the Web panel, docs, CI/CD and releases.
- [@OLDnana1](https://github.com/OLDnana1) — root-cause analysis of the interrupted tool-call corruption that made imported sessions permanently return HTTP 400 on resume.
- [@GooodWei](https://github.com/GooodWei) — identified `README.md` (and any description-less `.md`) being misregistered as a skill, which broke DSH's skill load.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
