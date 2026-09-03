<div align="center">

# 🚚 dsh-claude-move
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-claude-move` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

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

- Direcionado a `dsh 0.1.2-alpha.5` (perfil web); dependências peer exigem `>=0.1.0-rc.8 <0.2.0`. Node `^22.19 || >=24`.
0.1.2-alpha.5 (adaptado em 2026-09-02): o envelope de sessão mantém seu campo ignorable apenas para compatibilidade de leitura de logs armazenados - o Session.append ainda não consegue estampá-lo, então o comportamento da porta não muda.
- Última verificação contra uma instalação nova de tarball: varredura real, importação em lote real (reimportação idempotente), anexo ao workspace e artefatos de persistência confirmados; macOS/Linux cobertos pela matriz de CI.

### Matriz de compatibilidade (somente costuras públicas)

| Superfície | Uso | Fallback quando ausente |
|---|---|---|
| Serviços de host (`tools` / `sessionPersistence` / `workspaceRegistry` / `commands` / `systemPrompt` / `skills` / `webServer`) | obrigatório onde listado | serviços opcionais registram reativamente; `fs` ausente falha em voz alta |
| `sessionPersistence.listSnapshots` / `readFrom` / `fs` com capacidade `streamText` / `ctx.jobs` / `ctx.agents.resume` | detectado por recurso | `list()` / leitura de arquivo inteiro com rejeição em voz alta / mapa de jobs próprio / injeção de handoff |
| Serviços de shell do cliente (`sessions.refresh/open`, `workspaces.refresh`) | detectado por recurso ao aplicar o painel | recarga completa da página |
| Capacidades de plataforma mais novas nunca são requisitos rígidos — o plugin continua inicializável no rc.8. | | |

## O que você recebe

1. **Auto-descoberta** — `claude_scan` localiza a raiz de dados do Claude (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`) e indexa cada projeto/sessão, memória, habilidade, `CLAUDE.md` global e `settings.json`, com cache incremental e varredura paralela (`scanConcurrency`).
2. **Importação de fidelidade total** — `import_claude` converte transcrições em sessões DSH balanceadas e retomáveis (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), repara chamadas de ferramenta interrompidas e importa por streaming em blocos transcrições maiores que `maxTranscriptBytes`.
3. **Um único workspace `claudecode`** — cada sessão importada cai em um workspace dedicado (padrão `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` restaura o agrupamento de um workspace por projeto.
4. **Somente-cópia e incremental** — nada é movido, reescrito ou excluído em nenhum dos lados; reexecutar apenas anexa os turnos novos (`force: true` salva uma cópia completa extra sob um novo id).
5. **Contexto pessoal, sempre atualizado** — memórias injetadas como uma seção de prompt em tempo real, habilidades do Claude registradas como habilidades DSH reais (globais + de projeto), e o `CLAUDE.md` global + de projeto injetado cedo.
6. **Assistente de migração de quatro fontes** — `/move` mais `move_detect` / `move_preview` / `move_run` migram Claude Code, Codex, OpenCode e Hermes, com aprovação e idempotência (`move.json`).
7. **Painel web e comandos** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset`, `/claude-export` e um painel de migração flutuante.
8. **Exportação bidirecional** — `claude_export` (ou `/claude-export <sessionId>`) grava uma sessão DSH de volta como transcript JSONL retomável do Claude Code (turnos `user`/`assistant`/`tool`, pareamento `thinking` + `tool_use`/`tool_result`, mapeamento `cwd` de melhor esforço), para que o histórico possa sair do DSH novamente.

## Assistente de migração de quatro fontes

```text
/move              # assistente de um só passo: detectar → pré-visualizar → executar → relatar (as quatro fontes)
move_detect        # varre Claude Code / Codex / OpenCode / Hermes
move_preview       # plano por item: new | unchanged | changed | conflict (com diff) | unsupported
move_run           # executa atrás da porta de aprovação; resolução de conflitos:
                   #   skip | overwrite | rename | merge  (padrão skip — nunca adivinha)
```

- **Fontes** — Claude Code (`~/.claude`), Codex (`~/.codex`), OpenCode (raízes de dados + config), Hermes (raízes de skills/memória); cada fonte tem seu próprio parser + mapper.
- **Mapeamento** — memórias/instruções → seções gerenciadas somente-anexáveis no `AGENTS.md` global do DSH (uma seção marcada por item); skills → skills DSH reais (pacotes `SKILL.md` copiados tal e qual, outros formatos convertidos); comandos de barra → comandos DSH registrados (reconstruídos a partir de `move.json` após reiniciar); sessões → sessões DSH retomáveis (os mesmos importadores da fase 1).
- **Idempotente** — cada plano aplicado é registrado em `$DSH_HOME/claude-move/move.json` (`digest` / `targetDigest` / `appliedAt`); reexecuções pulam itens inalterados e `force` os reaplica.
- **Com aprovação** — uma execução que escreveria algo pergunta primeiro a `ctx.approval`; qualquer coisa diferente de `allowed-once` significa zero escritas.

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
/claude-import-all      # varre → copia cada sessão do Claude → relata
```

Não é preciso reiniciar o DSH após importar — atualize a página web aberta uma vez e clique em qualquer sessão importada para continuar.

## Instalar e desinstalar

- **Canal git** (último `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — ESM puro, sem etapa de `prepare` nem `allowBuilds`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-claude-move`.
- **Canal tarball**: `npm pack` neste repo e depois `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`.
- **Desinstalar**: remova a linha `claude-move` dos bundles do perfil e reinicie o `dsh`. As sessões importadas permanecem no diretório de dados do DSH; o plugin só grava seu cache (`$DSH_HOME/claude-move/`) e a pasta do workspace `claudecode`, e nunca toca nos dados fonte do Claude.

## O que é migrado

```
~/.claude (somente leitura)
 ├─ projects/*/*.jsonl  ──→  sessões DSH retomáveis, agrupadas em um workspace "claudecode" (padrão)
 ├─ projects/*/memory/  ──→  seção de memória do system-prompt em tempo real (relida por requisição)
 ├─ skills/**           ──→  skills DSH reais
 └─ CLAUDE.md + settings ──→  seção de prompt inicial + sugestões de configuração (nunca auto-aplicadas)
```

| No Claude Code | Chega ao DSH como |
|---|---|
| Transcrições de sessão (`projects/*/*.jsonl`) | Sessões DSH balanceadas e retomáveis — mapeamento de fidelidade total de `user`/`assistant`/`tool`/`thinking` com reparo de chamadas de ferramenta interrompidas — agrupadas em um workspace **`claudecode`** ou uma por projeto |
| Arquivos de memória (`projects/*/memory/*.md`) | Uma seção de contexto do system-prompt em tempo real, relida a cada requisição (`feedback > project > reference > user`) |
| Skills (`~/.claude/skills/**`) | Skills DSH reais (nomes kebab-case, sufixos de colisão, máximo 30 por padrão; `README.md`/`MEMORY.md` e arquivos sem descrição são pulados) |
| `CLAUDE.md` (global + por projeto) | Uma seção de prompt inicial; o arquivo do projeto vence |
| `settings.json` | Sugestões de configuração DSH com uma lista explícita de chaves não mapeáveis |
| Estado do projeto (diretório, branch git e contagem de sujeira) | Mostrado no índice de varredura, nos selos do painel web e no handoff de `/resume-claude` |

## Uso

Chame as ferramentas em qualquer sessão com o plugin montado:

```
claude_scan                          # varredura completa (cache incremental)
claude_scan { path: "~/.claude/projects/<slug>" }   # varredura parcial
claude_scan { refresh: true }        # pula o cache, revê tudo
claude_scan { projectsLimit: 10, sessionsLimit: 5, fields: "brief" }  # reduz a saída

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # uma sessão
import_claude { path: "~/.claude/projects" }        # diretório (recursivo)
import_claude { path: "all" }                       # tudo
# Reexecute a qualquer momento: arquivos inalterados são pulados, transcrições crescidas anexam apenas os turnos novos.
# Arquivos acima de maxTranscriptBytes são importados por streaming em blocos (sem teto de memória).
import_claude { path: "...", force: true }          # cópia completa nova (cópia anterior mantida)

claude_export { sessionId: "<dsh-session-id>" }     # grava uma sessão DSH de volta para JSONL do Claude
claude_export { sessionId: "...", path: "~/.claude/projects/<slug>/<id>.jsonl" }  # destino explícito
```

Comandos (acionados pelo usuário, sem turno do modelo):

```
/claude-import-all                # um só passo: varre → importa tudo → relata → injeta na sessão atual
/resume-claude latest             # continua a sessão do Claude mais recente
/resume-claude <sessionId>        # por id de sessão fonte ou id import-<src>
/resume-claude <keyword>          # corresponde a títulos; múltiplas correspondências são listadas, nunca adivinhadas
/claude-move-reset                # reinicia o cache do plugin (marcadores + mapa de importação); sessões importadas são mantidas
/claude-export <sessionId> [path] # exporta uma sessão DSH para um transcript JSONL retomável do Claude
```

Painel web: um painel de migração flutuante com a árvore de projetos/sessões, selos de status (não importado / importado / importado-com-turnos-novos / fonte ausente / diretório ausente / git sujo), filtro por palavra-chave, renderização paginada, "Importar e continuar" + "Abrir sessão" + "Atualizar lista de sessões" por sessão, importação em lote com barra de progresso em tempo real e cancelar, e um botão de reinício de cache. Os textos seguem o idioma do navegador (zh/en). Servido pelas rotas JSON `/api/claude-move/*` próprias do plugin na costura pública `ctx.webServer`.

## Depois de importar

**Você não precisa reiniciar o DSH.** As importações chegam de forma durável pelo serviço público `sessionPersistence` no momento em que são concluídas:

- As listas do lado do servidor (RPCs `session.list` / `workspace.list`, a CLI, qualquer novo carregamento de página) mostram as sessões importadas sob o workspace **`claudecode`** imediatamente.
- O painel atualiza sozinho a lista de sessões da página já aberta e oferece um botão **Abrir sessão** por sessão importada.
- As sessões importadas podem ser abertas, lidas e retomadas de imediato — `/resume-claude`, ou clique na sessão na lista. Reexecutar a importação a qualquer momento sincroniza apenas os turnos novos nas mesmas sessões.

## Configuração

Tudo opcional, anulável no cordis.yml.

| Chave | Padrão | Significado |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` ou `~/.claude` | Raiz de dados do Claude |
| `workspaceMode` | `claudecode` | `claudecode` (um workspace dedicado) · `per-project` (um workspace por cwd fonte) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | A pasta do workspace `claudecode` (a única pasta que o plugin cria) |
| `scanGit` | `true` | Nível de sondagem do git: `true` (completo) · `'branch'` (zero chamadas git) · `false` |
| `gitTimeoutMs` | `5000` | Timeout do subprocesso git |
| `scanConcurrency` | `8` | Limite de varredura paralela de projetos |
| `maxTranscriptBytes` | `67108864` | Limiar de importação por streaming (em blocos acima) |
| `excludeProjects` | `[]` | Substrings de slug a pular |
| `enableMemory` | `true` | Injeta memórias como seção de prompt em tempo real |
| `memoryMaxBytes` | `8192` | Limite da seção de memória |
| `memoryScope` | `current-project` | `current-project` · `all` (projeto atual primeiro) |
| `enableSkills` | `true` | Registra habilidades do Claude como habilidades DSH |
| `maxSkills` | `30` | Limite de quantidade de habilidades |
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
| `skillsDir` | `$DSH_HOME/skills` | Destino de skills do assistente |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | Destino de memória/instruções do assistente |
| `moveWorkspaceMode` | `per-source` | Agrupamento de workspace para importações do assistente: `per-source` · `single` |
| `enableExport` | `true` | Registra a ferramenta `claude_export` e o comando `/claude-export` |
| `exportDir` | `$DSH_HOME/claude-export` | Pasta de exportação padrão (um `path` explícito sempre vence) |

## Ferramentas e superfícies

| Superfície | Tipo | Notas |
|---|---|---|
| `claude_scan` | ferramenta | Índice estruturado de projetos/sessões/memórias/habilidades/ajustes |
| `import_claude` | ferramenta | Importa uma sessão, um diretório ou `all` (incremental; `force` para cópia nova) |
| `claude_export` | ferramenta | Exporta uma sessão DSH para um transcript JSONL retomável do Claude Code |
| `move_detect` / `move_preview` / `move_run` | ferramentas | Assistente de quatro fontes: varrer, plano por item com diffs, executar após aprovação |
| `/claude-import-all` | comando | Varre → importa tudo → relata |
| `/resume-claude` | comando | Continua uma sessão do Claude (latest, id ou palavra-chave) |
| `/claude-move-reset` | comando | Reinicia o cache do plugin (sessões importadas mantidas) |
| `/claude-export` | comando | Exporta uma sessão DSH para um transcript JSONL retomável do Claude |
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
- **Segredos relatados apenas por posição** (file:line:kind); registros `permission`/`permission-mode`/`queue-operation` são contados, não importados.
- **Escritas do assistente com aprovação** — qualquer coisa diferente de `allowed-once` significa zero escritas.

## Limitações conhecidas

- Títulos vêm de `custom-title`/`ai-title`/primeiro prompt; registros `summary` do Claude são relatados mas não mapeados para nós de compactação DSH (sintetizar uma transação de compactação válida fabricaria seu intervalo de seq e sua mensagem de checkpoint).
- Blocos `thinking` são mantidos como conteúdo `reasoning`, mas nunca entram no handoff de retomada.
- Chamadas de ferramenta interrompidas são reparadas com um resultado de erro sintético (nunca descartadas), relatado como `repaired.synthesized`.
- Registros da classe de permissões são contados, não importados; sugestões de permissões predefinidas DSH são geradas nos relatórios.
- Em hosts sem uma superfície de streaming `fs.streamText`, transcrições maiores que `maxTranscriptBytes` falham em voz alta em vez de importar parcialmente.
- Em `workspaceMode: 'per-project'`, sessões cujo diretório fonte foi excluído ainda importam, mas o anexo ao workspace falha (ficam desagrupadas; `workspace.attached: false` mais um `reason`). O workspace `claudecode` padrão não depende do diretório fonte.
- Se uma transcrição foi truncada ou reiniciada no lugar (menos turnos que a importação registrada), a reimportação a pula e relata `sourceShrunk`; use `force: true` para uma cópia completa nova.
- O painel web é um painel flutuante sem build dirigido pelas próprias rotas JSON do plugin; ele não usa o sistema de slots de UI interno do shell.

## Experiência do modelo

- A superfície visível ao modelo são as descrições/esquemas das duas ferramentas e suas saídas: `claude_scan` retorna o índice estruturado, `import_claude` retorna resumos por arquivo com posições dos avisos. Os resultados das ferramentas são eles próprios registrados como eventos `tool/result`, de modo que tudo é reconstruível.
- Nenhum texto oculto visível ao modelo; as seções de memória/`CLAUDE.md` são registradas em `ctx.systemPrompt` (montagem de prompt, reconstruível a partir do log de sessão).

## Solução de problemas

- Linha sem efeito: `dsh --profile <p> --dump-config` deve imprimir `# == dsh-claude-move`; reexecute `dsh plugin --profile <p> add ...`.
- A web inicializa mas trava em silêncio: perfis novos inicializados por `dsh plugin add` contêm apenas `dsh-base` — adicione `@deepseek-ai/dsh-web-app` a `dsh.profile.bundles`. Instalar no perfil `web` existente não precisa de nada.
- Rotas do painel 404: elas são servidas apenas quando `enableWebPanel: true` e um servidor web está composto; verifique o log de inicialização em busca de fibers FAILED.
- A importação falha com "transcript 过大": aumente `maxTranscriptBytes` ou importe esse arquivo individualmente.
- A importação teve sucesso, mas a barra lateral não mostra nenhuma sessão nova: a página já estava aberta — clique uma vez no botão de atualizar do painel (ou recarregue a página). Nunca é preciso reiniciar o DSH.
- Logs: falhas de inicialização são impressas no console do `dsh`; o plugin registra erros com prefixo `[claude-move]` para problemas de workspace/mapa de importação.

## Atribuição (componentes de código aberto)

Este projeto está licenciado sob a Apache License 2.0; os seguintes componentes licenciados sob MIT mantêm suas próprias licenças (texto completo em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- Núcleo de conversão vendored de [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Convenções de descoberta e modelo de segurança de [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT).
- Padrões de injeção de memória/skills e análise de frontmatter de [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## Desenvolvimento

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@>=0.1.0-rc.8, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

A CI executa a suíte completa no Node 22 em Linux/macOS/Windows via GitHub Actions ([test.yml](.github/workflows/test.yml)).

## Tópicos

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o pipeline de importação, o assistente de migração de quatro fontes, o painel web, a documentação, CI/CD e releases.
- [@OLDnana1](https://github.com/OLDnana1) — análise de causa raiz da corrupção de chamadas de ferramenta interrompidas que fazia as sessões importadas retornarem permanentemente HTTP 400 ao retomar.
- [@GooodWei](https://github.com/GooodWei) — identificou que `README.md` (e qualquer `.md` sem descrição) era registrado incorretamente como habilidade, o que quebrava o carregamento de habilidades do DSH.

## Família de Plugins DSH PerryLink

Este projeto é um dos [33 plugins de DeepSeek Harness](https://github.com/PerryLink) mantidos por [PerryLink](https://github.com/PerryLink). Se este ajuda você, os outros provavelmente também:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | Auto-revisão de segundo modelo na cadeia de aprovação, com falha fechada por padrão | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Agentes filhos em segundo plano duráveis com barra lateral de UI web, mensagens e interrupção | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Governança de custos para DeepSeek Harness: orçamentos, carbono e latência em um painel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Equivalente ao /rewind do Claude Code: instantâneos, bifurcações de sessão, restauração de uso único | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Controle de desktop nativo multiplataforma para DeepSeek Harness — Windows primeiro. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Histórico de entrada estilo terminal para o compositor web: setas, busca Ctrl+R | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Verificações de qualidade de datasets e verificação de citações (a ponte numérica opcional consumida aqui) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Defesa contra injeção de prompt, jailbreak e vazamento de segredos para DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Guardião de disciplina de engenharia: sabatina de requisitos, portões de teste, revisão adversária | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Roteamento unificado de geração de imagens estáticas para DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Diagnóstico de desempenho só de leitura para DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Relatórios de pesquisa deterministas para fundos mútuos públicos chineses | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | Integração de PR/issues do GitHub para o DSH, cada escrita controlada por aprovação | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Orquestração de pesquisa setorial que sela as suas entregas através do `ctx.researchReport.assemble` deste plugin | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Base de conhecimento documental local para DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Integração de modelos locais (Ollama) para DeepSeek Harness. | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | Diagnósticos, formatação, autocompletar, ações de código e renomeação LSP sobre servidores de linguagem | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | Middleware de mascaramento de PII: anonimiza no limite do modelo, restaura na camada de exibição | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Painel de tempo de execução MCP somente leitura: comando /mcp + aba Settings com status, ferramentas e erros | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Memória entre sessões controlada por aprovação: costura ctx.memory + SQLite + ferramenta de memória | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | Exportador de observabilidade OpenTelemetry e Langfuse para DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Troca de estilo em tempo de execução equivalente ao outputStyles do Claude Code | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Regras de permissão declarativas allow/deny/ask estilo Claude Code com auditoria | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Base de conhecimento de desenvolvimento de plugins como habilidade de agente sob demanda | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Motor de relatórios de pesquisa verificáveis com evidência endereçada por conteúdo | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Pontuação de qualidade multidimensional para plugins de DeepSeek Harness. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Fixe sessões na barra lateral web com ordenação durável | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Sincronização de sessões entre dispositivos para DeepSeek Harness — um espelho git dedicado do seu armazenamento de sessões. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Pacote de habilidades de auditoria de segurança: varredura de segredos, revisão de dependências e cadeia de suprimentos | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Loop de sessão com voz para DeepSeek Harness: fale e ouça a resposta. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Test drives isolados de instalação e smoke para plugins de DeepSeek Harness. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Tradução de parâmetros entre fornecedores e reparo determinístico de JSON para DeepSeek Harness. | |

### Instalar a partir do mercado do DSH Desktop

Todos os plugins PerryLink podem ser explorados no mercado integrado do DSH Desktop: **Market → Sources → add source → colar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecionar**. A instalação continua passando pela verificação de identidade npm do mercado e pela sua confirmação.

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
