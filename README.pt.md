<div align="center">

# 🚚 dsh-claude-move

**Migre Claude Code, Codex, OpenCode e Hermes para o DeepSeek Harness — copie sessões, memórias, habilidades, instruções e comandos de barra como sessões DSH retomáveis, somente-cópia e com aprovação.**

*Mantenha seu histórico do Claude Code ao migrar: uma única instalação, sessões retomáveis, sincronização em tempo real com um Claude Code em execução e um assistente de migração de quatro fontes.*

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

## Compatibilidade

| Superfície | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers fixados em `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (ferramentas de host + painel web flutuante; somente costuras públicas) |
| Modelo | Qualquer (as importações são determinísticas; sem chamadas próprias ao modelo) |

## O que você recebe

1. **Auto-descoberta** — `claude_scan` localiza a raiz de dados do Claude (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`) e indexa cada projeto/sessão, memória, habilidade, `CLAUDE.md` global e `settings.json`, com cache incremental e varredura paralela.
2. **Importação de fidelidade total** — `import_claude` converte transcrições em sessões DSH balanceadas e retomáveis, repara chamadas de ferramenta interrompidas e importa por streaming em blocos transcrições maiores que `maxTranscriptBytes`.
3. **Um único workspace `claudecode`** — cada sessão importada cai em um workspace dedicado (padrão `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` restaura o agrupamento um-workspace-por-projeto.
4. **Somente-cópia e incremental** — nada é movido, reescrito ou excluído em nenhum dos lados; re-executar apenas anexa os turnos novos.
5. **Contexto pessoal, sempre atualizado** — memórias injetadas como seção de prompt em tempo real, habilidades do Claude registradas como habilidades DSH reais, e o `CLAUDE.md` global + de projeto injetado cedo.
6. **Assistente de migração de quatro fontes** — o assistente `/move` mais as ferramentas `move_detect` / `move_preview` / `move_run` migram Claude Code, Codex, OpenCode e Hermes: memórias viram seções gerenciadas de `AGENTS.md`, habilidades viram habilidades DSH, comandos de barra viram comandos DSH, e sessões viram sessões DSH retomáveis — com aprovação e idempotência (`move.json`).
7. **Painel web e comandos** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset` e um painel de migração flutuante com progresso, cancelamento, paginação e "abrir sessão".

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-claude-move

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A4 'id: claude-move'
```

Depois, em qualquer sessão DSH, execute um comando:

```sh
/claude-import-all      # escaneia → copia cada sessão do Claude → relata
```

Não é preciso reiniciar o DSH após importar — atualize a página web aberta uma vez e clique em qualquer sessão importada para continuar.

## Instalar e desinstalar

- **Canal git** (último `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — ESM puro, sem etapa de `prepare` nem `allowBuilds`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-claude-move`.
- **Canal tarball**: `npm pack` neste repo e depois `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`.
- **Desinstalar**: remova a linha `claude-move` dos bundles do perfil e reinicie o `dsh`. As sessões importadas permanecem; o plugin só grava seu cache (`$DSH_HOME/claude-move/`) e a pasta do workspace `claudecode`, e nunca toca nos dados fonte do Claude.

## Configuração

Tudo opcional, anulável no cordis.yml.

| Chave | Padrão | Significado |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` ou `~/.claude` | Raiz de dados do Claude |
| `workspaceMode` | `claudecode` | `claudecode` (um workspace dedicado) · `per-project` (um workspace por cwd fonte) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | Pasta do workspace `claudecode` (a única pasta que o plugin cria) |
| `scanGit` | `true` | Nível de sondagem git: `true` (completo) · `'branch'` (zero chamadas git) · `false` |
| `gitTimeoutMs` | `5000` | Timeout do subprocesso git |
| `scanConcurrency` | `8` | Limite de varredura paralela de projetos |
| `maxTranscriptBytes` | `67108864` | Limiar de importação por streaming (em blocos acima) |
| `excludeProjects` | `[]` | Substrings de slug a pular |
| `enableMemory` | `true` | Injeta memórias como seção de prompt em tempo real |
| `memoryMaxBytes` | `8192` | Limite da seção de memória |
| `memoryScope` | `current-project` | `current-project` · `all` (projeto atual primeiro) |
| `enableSkills` | `true` | Registra habilidades do Claude como habilidades DSH |
| `maxSkills` | `30` | Limite de habilidades |
| `extraSkillDirs` | `[]` | Diretórios de habilidades extras |
| `enableInstructions` | `true` | Injeta `CLAUDE.md` global + de projeto |
| `resumeMaxChars` | `2048` | Limite de caracteres do resumo de handoff |
| `resumeMode` | `inject` | `inject` (resumo de handoff) · `agents` (ctx.agents.resume) |
| `enableWebPanel` | `true` | Registra as rotas do painel `/api/claude-move/*` |
| `importConcurrency` | `4` | Leitura + conversão em paralelo por lote |
| `requireApproval` | `true` | Escritas do assistente pedem `ctx.approval` (somente allowed-once) |
| `codexHome` | `$CODEX_HOME` ou `~/.codex` | Raiz de dados do Codex |
| `opencodeDataHome` | dir de dados XDG da plataforma/opencode | Raiz de dados do OpenCode |
| `opencodeConfigHome` | dir de config XDG da plataforma/opencode | Raiz de config do OpenCode |
| `hermesHome` | `$HERMES_HOME` ou `~/.hermes` | Raiz de dados do Hermes |
| `skillsDir` | `$DSH_HOME/skills` | Destino de habilidades do assistente |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | Destino de memória/instruções do assistente |
| `moveWorkspaceMode` | `per-source` | Agrupamento de workspace para importações do assistente: `per-source` · `single` |

## Ferramentas e superfícies

| Superfície | Tipo | Notas |
|---|---|---|
| `claude_scan` | ferramenta | Índice estruturado de projetos/sessões/memórias/habilidades/ajustes |
| `import_claude` | ferramenta | Importa uma sessão, um diretório ou `all` (incremental; `force` para cópia nova) |
| `move_detect` / `move_preview` / `move_run` | ferramentas | Assistente de quatro fontes: escanear, plano por item com diffs, executar com aprovação |
| `/claude-import-all` | comando | Escaneia → importa tudo → relata |
| `/resume-claude` | comando | Continua uma sessão do Claude (latest, id ou palavra-chave) |
| `/claude-move-reset` | comando | Reinicia o cache do plugin (sessões importadas mantidas) |
| `/move` | comando | Assistente de quatro fontes de um só passo |
| Painel web de migração | cliente | Painel flutuante com progresso, cancelamento, paginação, abrir sessão |

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `filesystem:read` e `filesystem:write`.
- **Lê** `~/.claude` (transcrições, memórias, habilidades, `CLAUDE.md`, `settings.json`) — estritamente somente leitura — e os diretórios de projeto para os quais importa.
- **Grava** logs de sessão DSH via o serviço público `sessionPersistence` (somente create + append, nunca exclui/reescreve/arquiva), registros do workspace-registry, seu cache sob `$DSH_HOME/claude-move/` e a pasta do workspace `claudecode`.
- **Nunca** modifica arquivos fonte do Claude, toca dados de outros aplicativos nem acessa a rede. **Nenhuma** credencial é lida ou transmitida.

## Limites de segurança

- **Arquivos fonte são somente leitura; logs DSH são somente-append** (somente `create` + `append`).
- **Transcrições externas são entrada não confiável** — nada nelas é executado; conteúdo system/developer/thinking nunca entra no handoff de retomada.
- **Somente serviços públicos** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; sem mudanças no motor ou na UI.
- **Segredos relatados apenas por posição**; registros `permission`/`permission-mode`/`queue-operation` são contados, não importados.
- **Escritas do assistente com aprovação** — qualquer coisa diferente de `allowed-once` significa zero escritas.

## Limitações conhecidas

- Títulos vêm de `custom-title`/`ai-title`/primeiro prompt; registros `summary` do Claude são relatados mas não mapeados para nós de compactação DSH.
- Blocos `thinking` são mantidos como conteúdo `reasoning`, mas nunca entram no handoff de retomada.
- Chamadas de ferramenta interrompidas são reparadas com um resultado de erro sintético (relatado como `repaired.synthesized`).
- Em hosts sem superfície de streaming `fs.streamText`, transcrições maiores que `maxTranscriptBytes` falham em voz alta em vez de importar parcialmente.
- Em `workspaceMode: 'per-project'`, sessões cujo diretório fonte foi excluído ainda importam, mas o anexo ao workspace falha (ficam desagrupadas). O workspace `claudecode` padrão não depende do diretório fonte.
- O painel web é um painel flutuante sem build dirigido pelas próprias rotas JSON do plugin.

## Desenvolvimento

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

## Tópicos

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o pipeline de importação, o assistente de migração de quatro fontes, o painel web, a documentação, CI/CD e releases.
- [@OLDnana1](https://github.com/OLDnana1) — análise de causa raiz da corrupção de chamadas de ferramenta interrompidas que fazia as sessões importadas retornarem permanentemente HTTP 400 ao retomar.
- [@GooodWei](https://github.com/GooodWei) — identificou que `README.md` (e qualquer `.md` sem descrição) era registrado incorretamente como habilidade, o que quebrava o carregamento de habilidades do DSH.

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
