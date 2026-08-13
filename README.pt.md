# dsh-claude-move

**Claude Code → DeepSeek Harness: migração completa + retomada sem emendas.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)

[English](README.md) | [中文](README.zh.md) | [Español](README.es.md) | Português | [हिन्दी](README.hi.md)

Um plugin para o [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Após a instalação, ele descobre automaticamente tudo no seu Claude Code local — transcrições de sessões, memórias, habilidades (skills), instruções globais, configurações e o estado do projeto — e move «histórico + contexto pessoal» para o DSH, para que você possa **continuar suas sessões do Claude Code sem interrupções** dentro do DeepSeek Harness.

> Status: em desenvolvimento (Fase 5/6 — painel web implementado). Roteiro e design: [PLAN.md](PLAN.md).

## O que ele faz

- **Descoberta automática**: localiza a raiz de dados do Claude (`$CLAUDE_CONFIG_DIR`, padrão `~/.claude`), indexa cada projeto/sessão (título, marcas de tempo, contagem de mensagens e chamadas de ferramentas), o estado do diretório e do git (branch, arquivos modificados), memórias, habilidades, o `CLAUDE.md` global e o `settings.json`. Cache incremental: apenas arquivos alterados são relidos.
- **Importação de histórico**: mapeamento fiel de eventos (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), produzindo **sessões DSH equilibradas e retomáveis**, vinculadas ao workspace original. Idempotente, em lote, reimportação forçada e relato de linhas malformadas com número de linha.
- **Contexto pessoal sempre atualizado**: as memórias são injetadas como uma seção dinâmica do prompt do sistema (relidas a cada requisição), as habilidades do Claude viram habilidades reais do DSH, e o `CLAUDE.md` global e o do projeto são injetados como uma seção inicial (o projeto tem prioridade). O `settings.json` é traduzido em sugestões de configuração do DSH.

## Roteiro

| Fase | Escopo | Status |
| --- | --- | --- |
| 1 | Descoberta automática + ferramenta `claude_scan` + cache incremental | ✅ |
| 2 | Importação de histórico (`import_claude`: mapeamento, idempotência, lote, reimportação forçada, erros com número de linha, vínculo ao workspace) | ✅ |
| 3 | Contexto pessoal (injeção de memórias, provedor de habilidades do Claude, seção CLAUDE.md, tradução de settings) | ✅ |
| 4 | Comandos de um passo `/claude-import-all` e `/resume-claude` (resumo de transição + modelo de segurança) | ✅ |
| 5 | Painel web «migração do Claude» (`dsh.client`) | ✅ |
| 6 | Polimento para publicação: documentação bilíngue, diagrama de arquitetura, empacotamento, demonstração | 🚧 |

## Instalação

```sh
# Do GitHub
dsh plugin --profile web add -w github:<owner>/dsh-claude-move

# Cópia local (desenvolvimento)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# De um tarball empacotado
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

O pacote é ESM puro, sem etapa de build, então a instalação via Git dispensa o script `prepare` e a lista `allowBuilds`. Consulte o [guia oficial de empacotamento e instalação](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## Uso

Chame as ferramentas em qualquer sessão com o plugin montado:

```
claude_scan                          # varredura completa (cache incremental)
claude_scan { path: "~/.claude/projects/<slug>" }   # varredura parcial
claude_scan { refresh: true }        # ignora o cache e varre tudo de novo

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # uma sessão
import_claude { path: "~/.claude/projects" }        # diretório (recursivo)
import_claude { path: "all" }                       # tudo
import_claude { path: "...", force: true }          # arquiva a importação anterior e reconstrói como import-<src>-<n>
```

Comandos (disparados pelo usuário, sem turno do modelo):

```
/claude-import-all                # um passo: varrer → importar → relatório → injetar na sessão atual
/resume-claude latest             # continuar a sessão Claude mais recente
/resume-claude <sessionId>        # pelo id da sessão de origem ou id import-<src>
/resume-claude <palavra-chave>    # busca por título; várias correspondências são listadas, nunca adivinhadas
```

Painel web: o botão flutuante **🐳 Claude 迁移** (canto inferior direito) abre o painel — árvore de projetos/sessões com selos de estado (não importado / importado / origem ausente / diretório inexistente / git sujo), filtro por palavra-chave, «Importar e continuar» por sessão + «Atualizar lista de sessões», e importação em lote com barra de progresso. Usa as rotas JSON `/api/claude-move/*` do próprio plugin, registradas no seam público `ctx.webServer`.

- **Varredura**: retorna um índice JSON estruturado: projetos (slug/cwd/existência do diretório/branch do git e arquivos modificados), sessões (título/marcas de tempo/contagens/linhas malformadas), memórias, habilidades, CLAUDE.md global e settings.json; cada sessão carrega `import.status` (`none`/`imported`/`source-missing`). `settingsSuggestions` contém a tradução do settings.json para o DSH e as chaves não mapeáveis (ver [COMPLIANCE.md](COMPLIANCE.md)).
- **Importação**: mapeia mensagens user/assistant/tool/thinking com fidelidade total; o resultado é uma sessão equilibrada e retomável, vinculada ao workspace pelo `cwd`. Lotes são resumidos arquivo por arquivo (`imported`/`already-imported`/`skipped`/`failed`), linhas malformadas carregam número de linha, segredos suspeitos são informados apenas por posição (arquivo:linha:tipo) e registros de permissão são contados, nunca importados.
- **O contexto pessoal entra em vigor automaticamente** (sem ação de importação):
  - Memórias: todos os `projects/*/memory/*.md` são injetados como seção dinâmica, relidos a cada requisição (memórias novas valem na hora), ordenados `feedback > project > reference > user`, limite de 8 KiB por padrão.
  - Habilidades: `~/.claude/skills/**/SKILL.md` (mais arquivos planos `*.md`) viram habilidades do DSH (nomes normalizados para kebab-case, colisões com sufixo, máximo 30); o DSH cuida do catálogo e da ferramenta `skill`.
  - Instruções: o `~/.claude/CLAUDE.md` global mais o `.claude/CLAUDE.md` da sessão atual são injetados como uma seção inicial (o projeto vence).

## Configuração

Tudo opcional e substituível no `cordis.yml`:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # padrão: $CLAUDE_CONFIG_DIR ou ~/.claude
    scanGit: true               # sondar branch do git e estado de alterações
    maxTranscriptBytes: 67108864
    excludeProjects: []         # substrings de slug a ignorar, ex. ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # limite de caracteres do resumo
    enableWebPanel: true      # registrar as rotas /api/claude-move/*
```

## Desinstalação

Remova a linha `claude-move` dos bundles do perfil e reinicie o `dsh`. As sessões importadas permanecem no diretório de dados do DSH; o plugin só grava o próprio cache (`$DSH_HOME/claude-move/`) e nunca toca nos dados de origem do Claude.

## Limites de segurança

- Arquivos de origem são estritamente somente leitura; os registros de sessão do DSH são somente anexação (apenas `create` + `append`).
- Transcrições externas são entrada não confiável: nada nelas é executado; conteúdo system/developer/thinking nunca entra no resumo de transição.
- Nenhuma mudança no motor do DSH, nos pacotes oficiais de UI nem no apiproxy — apenas serviços públicos (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`).
- Segredos suspeitos são informados apenas por localização (nunca o conteúdo); registros `permission`/`permission-mode`/`queue-operation` são contados, não importados.

## Conformidade e otimização

- [COMPLIANCE.md](COMPLIANCE.md) — auditoria cláusula a cláusula contra as restrições oficiais de plugins (repositório e docs do deepseek-harness, [deepseek.com/harness](https://www.deepseek.com/harness/), [documentação para desenvolvedores](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis) e o [artigo do Cordis](https://github.com/cordiverse/paper)).
- [OPTIMIZATION.md](OPTIMIZATION.md) — linhas de base medidas e candidatos de otimização priorizados (varredura/importação em paralelo, reutilização do gitBranch, importação por streaming, modo de sincronização incremental…).
- [ARCHITECTURE.md](ARCHITECTURE.md) — diagrama de arquitetura e tabela completa de mapeamento de dados.
- [RELEASE.md](RELEASE.md) — lista de verificação de publicação com evidências de aceitação.

## Atribuição (ecossistema MIT)

- Núcleo de conversão vendored de [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Convenções de descoberta e modelo de segurança de [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; o `session_reader.py` dele tem origem Apache-2.0 — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Padrões de injeção de memória/habilidades e análise de frontmatter de [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## Desenvolvimento

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + estendido), discovery, import/report, context, settings
```

## Experiência do modelo

- A superfície visível ao modelo são as descrições/esquemas das duas ferramentas e suas saídas: `claude_scan` retorna o índice estruturado, `import_claude` retorna resumos por arquivo com as posições dos avisos. Resultados de ferramentas são eventos `tool/result` registrados, então tudo é reconstruível.
- Não há texto oculto para o modelo; as seções de memory/CLAUDE.md são registradas em `ctx.systemPrompt` (montagem do prompt, reconstruível a partir do registro da sessão).

## Limitações conhecidas

- Títulos vêm de `custom-title`/`ai-title`/primeira mensagem; registros `summary` do Claude não são usados como título.
- Blocos `thinking` são mantidos no registro importado como conteúdo `reasoning`, mas nunca entram no resumo de transição.
- Registros de permissão são contados, não importados; sugestões de permissão do DSH são geradas nos relatórios.
- Transcrições maiores que `maxTranscriptBytes` falham com aviso em vez de importação parcial (fidelidade primeiro); a importação por streaming em blocos está no roteiro.
- Sessões cujo diretório de origem foi removido ainda são importadas, mas o vínculo ao workspace falha (ficam desagrupadas; `workspace.attached: false` no relatório).
- Importações em lote interrompidas podem ser reexecutadas com segurança (idempotentes, somente anexação).
- O painel web é um painel flutuante sem compilação que usa as rotas JSON do próprio plugin; não usa o sistema interno de slots da shell (independente dos internals não documentados do rc.6).

## Links relacionados

- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [site](https://www.deepseek.com/harness/) · [docs para desenvolvedores](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- Ecossistema de plugins: [tópico `dsh-plugin`](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## Licença

MIT — ver [LICENSE](LICENSE). Avisos de terceiros em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
