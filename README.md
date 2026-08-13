# dsh-claude-move

**Claude Code → DeepSeek Harness: full migration + seamless resume.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)

English | [中文](README.zh.md) | [Español](README.es.md) | [Português](README.pt.md) | [हिन्दी](README.hi.md)

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). After installation it automatically discovers everything in your local Claude Code — session transcripts, memories, skills, global instructions, settings, and project state — and moves "history + personal context" into DSH, so you can **continue your Claude Code sessions seamlessly** inside DeepSeek Harness.

> Status: in development (Phase 5/6 — web panel done). Roadmap and design: [PLAN.md](PLAN.md).

## What it does

- **Auto-discovery** — locates the Claude data root (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`), indexes every project/session (title, timestamps, message & tool-call counts), directory & git state (branch, dirty files), memories, skills, global `CLAUDE.md`, and `settings.json`. Incremental caching: re-scans only changed files.
- **History import** — full-fidelity event mapping (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), producing **balanced, resumable DSH sessions** attached to the original project workspace. Idempotent, batch-capable, force re-import, line-numbered malformed reporting.
- **Personal context, always fresh** — memories are injected as a dynamic system-prompt section (re-read every request), Claude skills are registered as real DSH skills, and global + project-level `CLAUDE.md` are injected as an early prompt section (project wins). `settings.json` is translated into DSH configuration suggestions.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Auto-discovery + `claude_scan` tool + incremental cache | ✅ |
| 2 | History import (`import_claude`: mapping, idempotency, batch, force re-import, line-number errors, workspace attach) | ✅ |
| 3 | Personal context (memory injection, Claude skills provider, CLAUDE.md section, settings translation) | ✅ |
| 4 | One-shot commands `/claude-import-all` and `/resume-claude` (handoff summary + safety model) | ✅ |
| 5 | Web UI "Claude migration" panel (`dsh.client`) | ✅ |
| 6 | Release polish: bilingual docs, architecture diagram, packaging, demo | 🚧 |

## Install

```sh
# From GitHub
dsh plugin --profile web add -w github:<owner>/dsh-claude-move

# Local checkout (development)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# From a packed tarball
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

The package is pure ESM with no build step, so Git installs need no `prepare` script or `allowBuilds` entry. See the official [package & install guide](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## Usage

Call the tools in any session with the plugin mounted:

```
claude_scan                          # full scan (incremental cache)
claude_scan { path: "~/.claude/projects/<slug>" }   # partial scan
claude_scan { refresh: true }        # skip cache, rescan everything

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # one session
import_claude { path: "~/.claude/projects" }        # directory (recursive)
import_claude { path: "all" }                       # everything
import_claude { path: "...", force: true }          # archive old import, rebuild as import-<src>-<n>
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
- **Import** maps user/assistant/tool/thinking messages with full fidelity; the result is a balanced, resumable session attached to its workspace by `cwd`. Batch results are per-file (`imported`/`already-imported`/`skipped`/`failed`), malformed lines carry line numbers, suspected secrets are reported by position only (file:line:kind), and permission-class records are counted but never imported.
- **Personal context takes effect automatically** (no import action needed):
  - Memories: all `projects/*/memory/*.md` are injected as a dynamic context section, re-read per request (new memories apply immediately), ordered `feedback > project > reference > user`, capped at 8 KiB by default.
  - Skills: `~/.claude/skills/**/SKILL.md` (plus flat `*.md`) become DSH skills (names normalized to kebab-case, collisions suffixed, max 30); DSH owns catalog injection and the `skill` tool.
  - Instructions: global `~/.claude/CLAUDE.md` plus the current session's `.claude/CLAUDE.md` are injected as an early prompt section (project wins).

## Configuration

All optional, overridable in `cordis.yml`:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # default: $CLAUDE_CONFIG_DIR or ~/.claude
    scanGit: true               # probe git branch & dirty state
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
```

## Uninstall

Remove the `claude-move` row from the profile's bundles and restart `dsh`. Imported sessions stay in DSH's data directory; the plugin only writes its cache (`$DSH_HOME/claude-move/`) and never touches Claude source data.

## Security boundaries

- Source files are strictly read-only; DSH session logs are append-only (`create` + `append` only).
- External transcripts are untrusted input: nothing in them is executed; system/developer/thinking content never enters the resume handoff.
- No changes to the DSH engine, official UI packages, or apiproxy — only public services (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`).
- Suspected secrets are reported by location only (never their content); `permission`/`permission-mode`/`queue-operation` records are counted, not imported.

## Compliance & optimization

- [COMPLIANCE.md](COMPLIANCE.md) — clause-by-clause audit against the official plugin constraints (deepseek-harness repo & docs, [deepseek.com/harness](https://www.deepseek.com/harness/), the [developer docs](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis), and the [Cordis paper](https://github.com/cordiverse/paper)).
- [OPTIMIZATION.md](OPTIMIZATION.md) — measured baselines and ranked optimization candidates (parallel scan/import, gitBranch reuse, streaming import, incremental sync mode…).
- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture diagram and the full data-mapping table.
- [RELEASE.md](RELEASE.md) — release checklist with acceptance evidence.

## Attribution (MIT ecosystem)

- Conversion core vendored from [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Discovery conventions & safety model from [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; its `session_reader.py` has an Apache-2.0 upstream — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Memory/skills injection & frontmatter parsing patterns from [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## Development

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + extended), discovery, import/report, context, settings
```

## Model Experience

- The model-facing surface is the two tools' descriptions/schemas and their outputs: `claude_scan` returns the structured index, `import_claude` returns per-file summaries with positions of warnings. Tool results are themselves logged `tool/result` events, so everything is reconstructable.
- No hidden model-facing text; memory/CLAUDE.md sections are registered on `ctx.systemPrompt` (prompt assembly, rebuildable from the session log).

## Known Limitations

- Titles come from `custom-title`/`ai-title`/first prompt; Claude `summary` records are not used as titles.
- `thinking` blocks are kept in the imported log as `reasoning` content, but never enter the resume handoff.
- Permission-class records are counted, not imported; DSH permission-preset suggestions are generated in reports.
- Transcripts larger than `maxTranscriptBytes` fail loudly instead of partial import (fidelity first); chunked streaming import is on the roadmap.
- Sessions whose source directory was deleted still import, but workspace attach fails (left ungrouped; `workspace.attached: false` in the report).
- Interrupted batch imports can be safely re-run (idempotent, append-only).
- The Web panel is a zero-build floating panel driven by the plugin's own JSON routes; it does not use the shell's internal UI slot system (kept independent of undocumented rc.6 internals).

## Related links

- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [site](https://www.deepseek.com/harness/) · [developer docs](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- Plugin ecosystem: [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## License

MIT — see [LICENSE](LICENSE). Third-party notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
