# Third-Party Notices

`dsh-claude-migrate` reuses code and design patterns from the following
open-source projects. Every reuse is attributed here and in the source files.

## Nwflower/dsh-chat-import — MIT

- Repository: https://github.com/Nwflower/dsh-chat-import
- License: MIT
- Reused: the JSONL → DSH SessionEvent conversion core (`lib/convert.mjs`,
  vendored and extended in place), the import/attach orchestration pattern
  (`sessionPersistence.create` + `append`, `workspaceRegistry.attachSession`,
  idempotent batch import), and the `test/convert.test.mjs` suite plus its
  synthetic fixtures.

## Demogorgon314/dsh-resume-plugin — MIT

- Repository: https://github.com/Demogorgon314/dsh-resume-plugin
- License: MIT
- Reused: the foreign-session safety model (treat transcripts as untrusted
  inert history; exclude system/developer/reasoning from handoffs; verify
  repository state before continuing; list candidates on ambiguity) and the
  Claude Code discovery conventions (`$CLAUDE_CONFIG_DIR`, `projects/<slug>`
  layout, `ai-title`/`custom-title`).

  Note: upstream's bundled `session_reader.py` is adapted from Grok Build's
  foreign-session reader under Apache-2.0. This project does not copy that
  file; the discovery logic is reimplemented in Node. See
  dsh-resume-plugin's THIRD_PARTY_NOTICES.md and LICENSES/Apache-2.0.txt for
  the upstream attribution chain.

## YYTbit/dsh-plugin-claude-bridge — MIT

- Repository: https://github.com/YYTbit/dsh-plugin-claude-bridge
- License: MIT
- Reused: the zero-migration injection approach for Claude Code memory,
  skills, and CLAUDE.md, the memory type priority order
  (feedback > project > reference > user), and the frontmatter parsing shape
  (`lib/frontmatter.mjs`).
