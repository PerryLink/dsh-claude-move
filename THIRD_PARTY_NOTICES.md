# Third-Party Notices

`dsh-claude-move` is licensed under the **Apache License 2.0** (see
[LICENSE](LICENSE) and [NOTICE](NOTICE)). It reuses code and design
patterns from the following open-source projects, which remain under
their own licenses. Every reuse is attributed here and in the source files.

## Nwflower/dsh-chat-import — MIT

- Repository: https://github.com/Nwflower/dsh-chat-import
- License: MIT
- Reused: the JSONL → DSH SessionEvent conversion core (`lib/convert.mjs`,
  vendored and extended in place), the import/attach orchestration pattern
  (`sessionPersistence.create` + `append`, `workspaceRegistry.attachSession`,
  idempotent batch import), and the `test/convert.test.mjs` suite plus its
  synthetic fixtures.
- The MIT-licensed portions of `lib/convert.mjs` are retained under MIT;
  the file header records the provenance.

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

## MIT license text (required by the MIT-licensed components above)

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
