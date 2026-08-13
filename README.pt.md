# dsh-claude-move

**Mantenha seu histórico do Claude Code ao migrar para o DeepSeek Harness.** Uma única instalação copia cada sessão, memória, habilidade e `CLAUDE.md` do Claude para o DSH como sessões retomáveis — organizadas em um workspace por projeto do Claude.

`Somente cópia` · `Retomada sem interrupções` · `Workspaces por projeto` · `Sincronização ao vivo com o Claude Code`

[![Test](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml/badge.svg)](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml)
[![Node ^22.19 || >=24](https://img.shields.io/static/v1?label=node&message=%5E22.19%20%7C%7C%20%3E%3D24&color=2f7d4f)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Topic: dsh](https://img.shields.io/badge/topic-dsh-3fb950)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/PerryLink/dsh-claude-move/issues)

![Cartão social do dsh-claude-move](assets/social-card.png)

[English](README.md) | [中文](README.zh.md) | [Español](README.es.md) | Português | [हिन्दी](README.hi.md)

> Prévia de desenvolvimento (0.1.0). Roteiro e design: [PLAN.md](PLAN.md) · histórico de mudanças: [CHANGELOG.md](CHANGELOG.md).

## ✨ Recursos

- 🔍 **Descoberta automática** — localiza a raiz de dados do Claude (`$CLAUDE_CONFIG_DIR`, padrão `~/.claude`) e indexa cada projeto/sessão (título, marcas de tempo, contagens), estado do diretório e do git, memórias, habilidades, `CLAUDE.md` global e `settings.json` — com cache incremental que só relê arquivos alterados.
- 📥 **Importação de histórico com fidelidade total** — sessões DSH equilibradas e retomáveis (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), um workspace por projeto do Claude, linhas malformadas com número de linha.
- 🔁 **Somente cópia e incremental** — nada é movido, reescrito ou excluído em nenhum lado. Reexecutar a importação apenas anexa os novos turnos à mesma sessão DSH; `force: true` salva uma cópia completa adicional com um novo id.
- 🧠 **Contexto pessoal sempre atualizado** — memórias injetadas como seção ao vivo, habilidades do Claude como habilidades reais do DSH, `CLAUDE.md` global + de projeto injetado cedo.
- ⚡ **Sincronização ao vivo com o Claude Code** — continue usando o Claude Code em paralelo; cada reexecução traz apenas o que mudou.
- 🖥 **Painel web e comandos de um passo** — `/claude-import-all`, `/resume-claude` e um painel de migração flutuante com progresso.
- 🛡 **Segurança em primeiro lugar** — arquivos fonte estritamente somente leitura, logs do DSH append-only, segredos informados apenas por posição, registros de permissão contados mas nunca importados.

## 🚀 Início rápido

```sh
# 1. Instalar
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move
```

2. Em qualquer sessão do DSH, rode um comando:

```
/claude-import-all      # varrer → copiar todas as sessões do Claude → relatório
```

3. Atualize uma vez a página web já aberta (o painel tem o botão «Atualizar lista de sessões») e clique em qualquer sessão importada para continuar. **Não é preciso reiniciar o DSH** — veja [Depois de importar](#depois-de-importar).

Prefere controle fino?

```
claude_scan                                     # índice estruturado de todos os projetos/sessões
import_claude { path: "~/.claude/projects" }    # um diretório de projeto (recursivo)
import_claude { path: "all" }                   # tudo
```

## 🗂 O que é migrado

```
~/.claude (somente leitura)
 ├─ projects/*/*.jsonl  ──→  sessões DSH retomáveis, um workspace por projeto (cwd)
 ├─ projects/*/memory/  ──→  seção de memória ao vivo do prompt do sistema (relida por requisição)
 ├─ skills/**           ──→  habilidades reais do DSH
 └─ CLAUDE.md + settings ──→  seção inicial do prompt + sugestões de configuração (nunca auto-aplicadas)
```

| No Claude Code | Aterrissa no DSH como |
| --- | --- |
| Transcrições de sessão (`projects/*/*.jsonl`) | Sessões DSH equilibradas e retomáveis — mapeamento fiel de `user`/`assistant`/`tool`/`thinking` — agrupadas em um workspace por projeto (`cwd`) |
| Arquivos de memória (`projects/*/memory/*.md`) | Uma seção de contexto do prompt do sistema ao vivo, relida a cada requisição (`feedback > project > reference > user`) |
| Habilidades (`~/.claude/skills/**`) | Habilidades reais do DSH (nomes kebab-case, colisões com sufixo, máximo 30 por padrão) |
| `CLAUDE.md` (global + por projeto) | Uma seção inicial do prompt; o arquivo do projeto vence |
| `settings.json` | Sugestões de configuração do DSH com lista explícita de chaves não mapeáveis |
| Estado do projeto (diretório, branch do git e arquivos modificados) | Visível no índice de varredura e nos selos do painel web |

## 📦 Instalação

```sh
# Do GitHub
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move

# Cópia local (desenvolvimento)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# De um tarball empacotado
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

O pacote é ESM puro, sem etapa de build, então a instalação via Git dispensa o script `prepare` e a lista `allowBuilds`. Consulte o [guia oficial de empacotamento e instalação](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## 🛠 Uso

Chame as ferramentas em qualquer sessão com o plugin montado:

```
claude_scan                          # varredura completa (cache incremental)
claude_scan { path: "~/.claude/projects/<slug>" }   # varredura parcial
claude_scan { refresh: true }        # ignora o cache e varre tudo de novo

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # uma sessão
import_claude { path: "~/.claude/projects" }        # diretório (recursivo)
import_claude { path: "all" }                       # tudo
# Pode rodar de novo quando quiser: arquivos sem mudanças são pulados e transcrições que cresceram anexam apenas os novos turnos.
import_claude { path: "...", force: true }          # nova cópia completa como import-<src>-<n> (a cópia anterior é mantida)
```

Comandos (disparados pelo usuário, sem turno do modelo):

```
/claude-import-all                # um passo: varrer → importar tudo → relatório → injetar na sessão atual
/resume-claude latest             # continuar a sessão do Claude mais recente
/resume-claude <sessionId>        # pelo id de sessão de origem ou id import-<src>
/resume-claude <palavra-chave>    # busca títulos; múltiplos resultados são listados, nunca adivinhados
```

Painel web: o botão flutuante **🐳 Claude 迁移** (canto inferior direito) abre o painel — árvore de projetos/sessões com selos de estado (não importado / importado / origem ausente / diretório inexistente / git sujo), filtro por palavra-chave, «Importar e continuar» por sessão + «Atualizar lista de sessões», e importação em lote com barra de progresso. Usa as rotas JSON `/api/claude-move/*` do próprio plugin, registradas no seam público `ctx.webServer`.

- **Varredura**: retorna um índice JSON estruturado: projetos (slug/cwd/existência do diretório/branch do git e arquivos modificados), sessões (título/marcas de tempo/contagens/linhas malformadas), memórias, habilidades, CLAUDE.md global e settings.json; cada sessão carrega `import.status` (`none`/`imported`/`source-missing`). `settingsSuggestions` contém a tradução do settings.json para o DSH e as chaves não mapeáveis (ver [COMPLIANCE.md](COMPLIANCE.md)).
- **Importação**: mapeia mensagens user/assistant/tool/thinking com fidelidade total; o resultado é uma sessão equilibrada e retomável, vinculada ao workspace pelo `cwd`. Lotes são resumidos arquivo por arquivo (`imported`/`appended`/`already-imported`/`skipped`/`failed`), linhas malformadas carregam número de linha, segredos suspeitos são informados apenas por posição (arquivo:linha:tipo) e registros de permissão são contados, nunca importados. Importar nunca apaga nem reescreve nada: sessões existentes do DSH ficam intactas, cópias importadas anteriormente são mantidas e os arquivos fonte do Claude nunca são gravados.
- **O contexto pessoal entra em vigor automaticamente** (sem ação de importação):
  - Memórias: todos os `projects/*/memory/*.md` são injetados como seção dinâmica, relidos a cada requisição (memórias novas valem na hora), ordenados `feedback > project > reference > user`, limite de 8 KiB por padrão.
  - Habilidades: `~/.claude/skills/**/SKILL.md` (mais arquivos planos `*.md`) viram habilidades do DSH (nomes normalizados para kebab-case, colisões com sufixo, máximo 30); o DSH cuida do catálogo e da ferramenta `skill`.
  - Instruções: o `~/.claude/CLAUDE.md` global mais o `.claude/CLAUDE.md` da sessão atual são injetados como uma seção inicial (o projeto vence).

## ✅ Depois de importar

**Não é preciso reiniciar o DSH.** As importações são gravadas de forma durável pelo serviço público `sessionPersistence` assim que terminam:

- As listas do servidor (`session.list` / `workspace.list`, a CLI ou qualquer página recém-aberta) mostram imediatamente as sessões importadas e seus workspaces por projeto.
- Única exceção: uma **página web já aberta** precisa de uma atualização da lista de sessões para exibir as novas linhas — as importações gravam sessões frias direto no serviço de persistência, então não emitem o frame ao vivo `host/session-added`; os grupos de workspaces, porém, atualizam ao vivo (`host/workspace-changed`). Clique em «Atualizar lista de sessões» do painel (ou recarregue a página), sem reiniciar o servidor.
- As sessões importadas podem ser abertas, lidas e retomadas na hora — `/resume-claude`, ou clique na sessão da lista após essa atualização. Reexecutar a importação a qualquer momento apenas anexa os novos turnos às mesmas sessões.

## ⚙️ Configuração

Tudo opcional e substituível no `cordis.yml`:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # padrão: $CLAUDE_CONFIG_DIR ou ~/.claude
    scanGit: true               # sondar branch do git e estado de mudanças
    gitTimeoutMs: 5000          # tempo limite do subprocesso git
    maxTranscriptBytes: 67108864
    excludeProjects: []         # substrings de slug a ignorar, ex. ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # limite de caracteres do resumo de transição
    enableWebPanel: true      # registrar as rotas do painel /api/claude-move/*
    importConcurrency: 4      # concorrência de leitura+conversão por lote (o salvamento segue sequencial)
```

## 🗑 Desinstalação

Remova a linha `claude-move` dos bundles do perfil e reinicie o `dsh`. As sessões importadas permanecem no diretório de dados do DSH; o plugin apenas escreve seu cache (`$DSH_HOME/claude-move/`) e nunca toca os dados fonte do Claude.

## 🧭 Compatibilidade

- Alvo: `dsh 0.1.0-rc.6` (perfil web); dependências peer fixadas em `0.1.0-rc.6`. Node `^22.19 || >=24`.
- Última verificação **2026-08-13** no Windows (Node 22) contra `@deepseek-ai/dsh@0.1.0-rc.6`: instalação do zero via tarball, varredura real (40 projetos / 2387 sessões), importação real em lote 13/13 com reimportação idempotente 13/13, vínculo ao workspace e artefatos de persistência confirmados. macOS/Linux pendentes.
- Verificado **2026-08-14** contra o checkout atual do `deepseek-harness` (perfil web, backend de sessões JSONL+zstd, registro de workspaces real) em um home isolado: boot web completo com o plugin montado, varredura + importação total pelas rotas do painel, criação de workspaces por `cwd` com sessões vinculadas, anexo incremental a uma sessão importada existente (seq contíguo, carrega limpo), reimportação segura após reinício e sessões DSH preexistentes intactas o tempo todo. Nenhuma sessão é jamais arquivada, apagada ou reescrita.

## 🔐 Permissões e dados

- **Lê** `~/.claude` (transcrições, memórias, habilidades, CLAUDE.md, settings.json) — estritamente somente leitura — e os diretórios de projeto para os quais importa (vínculo ao workspace).
- **Escreve** os logs de sessão do DSH pelo serviço público `sessionPersistence` — apenas create + append, nunca apaga, reescreve ou arquiva sessões existentes — registros do registro de workspaces, e seu próprio cache em `$DSH_HOME/claude-move/` (marcadores de varredura + mapa de importação).
- **Nunca** modifica os arquivos fonte do Claude, toca dados de outros aplicativos nem acessa a rede.
- **Nenhuma credencial** é lida ou transmitida; segredos suspeitos nas transcrições são informados apenas por posição.

## 🛡 Limites de segurança

- Arquivos fonte são estritamente somente leitura; logs de sessão do DSH são append-only (apenas `create` + `append`).
- Transcrições externas são entrada não confiável: nada nelas é executado; conteúdo system/developer/thinking nunca entra no resumo de transição.
- Sem mudanças no motor do DSH, pacotes oficiais de UI ou apiproxy — apenas serviços públicos (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`).
- Segredos suspeitos são informados apenas por localização (nunca seu conteúdo); registros `permission`/`permission-mode`/`queue-operation` são contados, não importados.

## 🩺 Solução de problemas

- Linha sem efeito: `dsh --profile <p> --dump-config` deve imprimir `# == dsh-claude-move`; execute `dsh plugin --profile <p> add -w ...` novamente.
- A web inicia mas trava em silêncio: perfis novos inicializados por `dsh plugin add` contêm apenas `dsh-base` — adicione `@deepseek-ai/dsh-web-app` em `dsh.profile.bundles`. Instalar no perfil `web` existente não precisa de nada.
- Rotas do painel 404: só são servidas quando `enableWebPanel: true` e um servidor web está composto; verifique o log de boot por fibras FAILED.
- A importação falha com "transcript 过大": aumente `maxTranscriptBytes` ou importe esse arquivo individualmente.
- A importação teve sucesso mas a barra lateral não mostra a nova sessão: a página já estava aberta — clique uma vez em «Atualizar lista de sessões» do painel (ou recarregue a página). Nunca é preciso reiniciar o DSH.
- Logs: falhas de boot são impressas no console do `dsh`; o plugin registra erros com o prefixo `[claude-move]` para problemas de workspace/mapa de importação.

## 📚 Documentação

- [PLAN.md](PLAN.md) — conclusões da pesquisa e plano de implementação.
- [ARCHITECTURE.md](ARCHITECTURE.md) — diagrama de arquitetura e tabela completa de mapeamento de dados.
- [COMPLIANCE.md](COMPLIANCE.md) — auditoria cláusula por cláusula frente às restrições oficiais de plugins (repo e docs do deepseek-harness, [deepseek.com/harness](https://www.deepseek.com/harness/), a [documentação de desenvolvimento](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis) e o [paper do Cordis](https://github.com/cordiverse/paper)).
- [OPTIMIZATION.md](OPTIMIZATION.md) — linhas de base medidas e candidatos de otimização ordenados.
- [RELEASE.md](RELEASE.md) — checklist de release com evidência de aceitação.
- [CHANGELOG.md](CHANGELOG.md) — o que mudou em cada versão.

## 🙏 Atribuição (componentes open source)

Este projeto está licenciado sob a Apache License 2.0; os seguintes componentes sob MIT conservam suas próprias licenças (texto completo em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- Núcleo de conversão vendored de [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Convenções de descoberta e modelo de segurança de [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; seu `session_reader.py` tem origem Apache-2.0 — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Padrões de injeção de memory/skills e análise de frontmatter de [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## 🧑‍💻 Desenvolvimento

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + estendido), discovery, import/report, context, settings
```

O CI roda a suíte completa no Node 22 via GitHub Actions ([test.yml](.github/workflows/test.yml)).

## 🧠 Model Experience

- A superfície visível ao modelo são as descrições/esquemas das duas ferramentas e suas saídas: `claude_scan` devolve o índice estruturado, `import_claude` devolve resumos por arquivo com posições de avisos. Os resultados das ferramentas são eles próprios eventos `tool/result` registrados, então tudo é reconstruível.
- Nenhum texto oculto visível ao modelo; as seções memory/CLAUDE.md ficam registradas em `ctx.systemPrompt` (montagem do prompt, reconstruível a partir do log de sessão).

## ⚠️ Limitações conhecidas

- Títulos vêm de `custom-title`/`ai-title`/primeiro prompt; registros `summary` do Claude não são usados como títulos.
- Blocos `thinking` são mantidos no log importado como conteúdo `reasoning`, mas nunca entram no resumo de transição.
- Registros de permissão são contados, não importados; sugestões de presets de permissão do DSH são geradas nos relatórios.
- Transcrições maiores que `maxTranscriptBytes` falham em voz alta em vez de importação parcial (fidelidade primeiro); importação por streaming em blocos está no roteiro.
- Sessões cujo diretório de origem foi excluído ainda importam, mas o vínculo ao workspace falha (ficam sem grupo; `workspace.attached: false` mais um `reason` no relatório).
- Importações em lote interrompidas podem ser reexecutadas com segurança (idempotente, append-only): arquivos concluídos são pulados e os que cresceram anexam apenas os novos turnos.
- Se uma transcrição foi truncada ou reiniciada no lugar (menos turnos que a importação registrada), a reimportação a pula e reporta `sourceShrunk`; use `force: true` para uma cópia completa nova.
- O painel web é um painel flutuante sem build, dirigido pelas rotas JSON do próprio plugin; não usa o sistema interno de slots de UI do shell (mantido independente dos internals não documentados do rc.6).

## 🤝 Contribuir e dar feedback

Issues e pull requests são bem-vindos — use os modelos fornecidos ([relato de bug](.github/ISSUE_TEMPLATE/bug-report.yml), [solicitação de recurso](.github/ISSUE_TEMPLATE/feature-request.yml)). Perguntas e discussões ficam nas GitHub Discussions do repo. Reporte problemas de segurança em particular via GitHub Security Advisories (repo Settings → Security).

## 🔗 Links relacionados

- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [site](https://www.deepseek.com/harness/) · [documentação de desenvolvimento](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- Ecossistema de plugins: [tópico `dsh`](https://github.com/topics/dsh) · [tópico `dsh-plugin`](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## 📄 Licença

Apache License 2.0 — ver [LICENSE](LICENSE) e [NOTICE](NOTICE). Avisos de terceiros (incluindo o texto MIT dos componentes MIT) em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
