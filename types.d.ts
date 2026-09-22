// SPDX-License-Identifier: Apache-2.0
// types.d.ts — host seam declarations for the published JavaScript package.
//
// This package ships plain ESM (`index.mjs` + `lib/`), so it has no generated
// types of its own. What it does need is the one *merge-extensible* host seam
// it contributes to: `MessageSourceMap`.
//
// Host 0.1.7-alpha.1 removed the catch-all `{ kind: 'plugin', plugin }` message
// source. `MessageSourceMap` (packages/llm/llm/src/message.ts) now holds only
// `user | model | tool | 'system-prompt'`, and every producer declares its own
// `kind` in its own module — the host's own `tool-jobs` plugin is the reference
// (packages/jobs/tool-jobs/src/index.ts):
//
//   declare module '@deepseek-ai/dsh-llm' {
//     interface MessageSourceMap { 'tool-jobs': { kind: 'tool-jobs' } & ContextFormed }
//   }
//
// Two independent host checks enforce this, so no cast can bypass it:
//   1. the type layer above, and
//   2. durable-row admission — `assertV4MessageSources` /
//      `assertV4SourceRowAdmission` in
//      packages/session/session-format-v3-to-v4/src/message-sources.ts refuse
//      `kind === 'plugin'` outright.
//
// `ContextFormed` is left unrefined on purpose: the injected payload is a
// full-length resume handoff (up to `resumeMaxChars`, default 2048), not the
// bounded one-line account a `notice` summarizes, so the plugin passes no
// `form` — exactly the `{ form?: never }` member the host union permits.

import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-claude-move': { kind: 'dsh-claude-move' } & ContextFormed
  }
}

export {}
