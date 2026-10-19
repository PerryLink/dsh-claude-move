<div align="center">

# 🚚 dsh-claude-move
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-claude-move` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**Migre Claude Code, Codex, OpenCode e Hermes para o DeepSeek Harness — copie sessões, memórias, habilidades, instruções e comandos de barra como sessões DSH retomáveis, somente-cópia e com aprovação.**

*Mantenha seu histórico do Claude Code ao migrar: uma única instalação, sessões retomáveis, sincronização em tempo real com um Claude Code em execução e um assistente de migração de quatro fontes.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-claude-move)
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

![Diagrama de fluxo de dsh-claude-move: chamada → plugin → resultado.](docs/assets/dsh-claude-move-flow.svg)

*Visão geral do fluxo: chamada → plugin → resultado. Os exemplos abaixo usam a superfície real de comandos.*


## Compatibilidade

- Direcionado a `dsh 0.1.6-alpha.2` (perfil web, formato de sessão V3); dependências peer exigem `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0`. Verificado em 2026-09-18 (portão de tipos checkJs + 287 asserções, 38 suítes). O botão «abrir sessão» do painel agora é renderizado desabilitado com um título explicativo quando o host não expõe `sessions.open()`, em vez de desaparecer. Node `^22.19 || >=24`.
`0.1.2-rc.1` (adaptado em 2026-09-04): o envelope de sessão mantém seu campo ignorable apenas para compatibilidade de leitura de logs armazenados - o Session.append ainda não consegue estampá-lo, então o comportamento da porta não muda.
- A 0.4.0 inclui um shim de linha de base dupla para `sessionPersistence` em tempo de execução, detectado pela forma da API (nunca pela versão): funcionam tanto a API legada (`create`/`append`/`readFrom`, `list()` retornando cabeçalhos) quanto a costura de handle (`create` retornando um `SessionHandle`, `list()`/`stat()` retornando snapshots). A costura de handle já está publicada na linha alpha (`@deepseek-ai/dsh-session-persistence` / `-jsonl` `0.1.5-rc.2`), então o fluxo de compatibilidade a cobre. No caminho handle, todo append é seguido de `flush()` (barreira de durabilidade) e um `close()` pareado (propriedade de escritor único); os cabeçalhos são carimbados com a versão de formato atual do backend e um `isSeeded` explícito; fontes de modelo de assistente ausentes caem para o provider; e desde 0.4.5 os eventos `assistant/message` sintetizados carregam `stream: []` quando a versão de formato do backend é >= 2 — o `Session.fromRestore` do V3 exige `Array.isArray(data.stream)`, então sem isso o log era escrito e lido, mas não podia ser retomado. A limpeza da varredura de importação se recusa a executar quando o `header.id` de um elemento listado não pode ser resolvido, então `imports.json` nunca é esvaziado silenciosamente.
- Última verificação contra uma instalação nova de tarball: varredura real, importação em lote real (reimportação idempotente), anexo ao workspace e artefatos de persistência confirmados; macOS/Linux cobertos pela matriz de CI. Os logs importados usam o formato de sessão V3 e `dsh <= 0.1.2-rc.1` não consegue lê-los (a atualização é unidirecional; a alternativa é reimportar do transcript de origem).

### Matriz de compatibilidade (somente costuras públicas)

| Superfície | Uso | Fallback quando ausente |
|---|---|---|
| Serviços de host (`tools` / `sessionPersistence` / `workspaceRegistry` / `commands` / `systemPrompt` / `skills` / `webServer`) | obrigatório onde listado | serviços opcionais registram reativamente; `fs` ausente falha em voz alta |
| `sessionPersistence` linha de base dupla: legada `listSnapshots` / `readFrom` / `append` versus handle `open` / `stat` / `list()` de snapshots | detectado por recurso em tempo de execução (forma da API, nunca versão) | a guarda de resolução de `header.id` aborta a varredura em voz alta em vez de esvaziar `imports.json` silenciosamente |
| `fs` com capacidade `streamText` / `ctx.jobs` / `ctx.agents.resume` | detectado por recurso | leitura de arquivo inteiro com rejeição em voz alta / mapa de jobs próprio / injeção de handoff |
| Serviços de shell do cliente (`sessions.refresh/open`, `workspaces.refresh`) | detectado por recurso ao aplicar o painel | recarga completa da página |
| Capacidades de plataforma mais novas nunca são requisitos rígidos — o plugin continua inicializável na linha mais antiga suportada (`0.1.2-rc.1`). | | |

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

### Exemplos

São os pontos de entrada reais; instale e chame um.

#### Exemplo detalhado

**Comando**

~~~sh
import_claude
~~~

**Entrada**

~~~json
{ "path": "test/fixtures/simple.jsonl" }
~~~

**Saída**

~~~text
已导入 1 轮对话（2 条消息、0 次工具调用）→ 会话 import-sess-simple-001。
~~~

*Observado em `README.md:138 (Usage); test/fixtures/simple.jsonl:1-2; index.mjs:1708 (renderImport)`*

#### Exemplos breves

- `import_claude`
- `claude_export`

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
npm install   # peer deps: @deepseek-ai/dsh-tools@>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

A CI executa a suíte completa no Node 22 em Linux/macOS/Windows via GitHub Actions ([test.yml](.github/workflows/test.yml)).

## Tópicos

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o pipeline de importação, o assistente de migração de quatro fontes, o painel web, a documentação, CI/CD e releases.
- [@OLDnana1](https://github.com/OLDnana1) — análise de causa raiz da corrupção de chamadas de ferramenta interrompidas que fazia as sessões importadas retornarem permanentemente HTTP 400 ao retomar.
- [@GooodWei](https://github.com/GooodWei) — identificou que `README.md` (e qualquer `.md` sem descrição) era registrado incorretamente como habilidade, o que quebrava o carregamento de habilidades do DSH.

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors

## PerryLink DSH Plugin Family

Este projeto faz parte da família de plugins do DeepSeek Harness da [PerryLink](https://github.com/PerryLink). O registro fica recolhido abaixo para que cada README mantenha uma primeira tela curta; expanda para ver cada linha e seu status.

<details>
<summary>Expandir todos os plugins</summary>

| Plugin | Status |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** |  |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** |  |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** |  |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 RETIRADO — ver o README do repositório |

</details>
