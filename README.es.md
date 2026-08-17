<div align="center">

# 🚚 dsh-claude-move

**Migra Claude Code, Codex, OpenCode y Hermes a DeepSeek Harness — copia sesiones, memorias, habilidades, instrucciones y comandos de barra como sesiones DSH reanudables, solo-copia y con aprobación.**

*Conserva tu historial de Claude Code al pasarte: una sola instalación, sesiones reanudables, sincronización en vivo con un Claude Code en marcha y un asistente de migración de cuatro fuentes.*

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

## Compatibilidad

| Superficie | Estado |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers fijados a `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (herramientas de host + panel web flotante; solo costuras públicas) |
| Modelo | Cualquiera (las importaciones son deterministas; sin llamadas propias al modelo) |

## Qué obtienes

1. **Auto-descubrimiento** — `claude_scan` localiza la raíz de datos de Claude (`$CLAUDE_CONFIG_DIR`, con fallback a `~/.claude`) e indexa cada proyecto/sesión, memoria, habilidad, `CLAUDE.md` global y `settings.json`, con caché incremental y escaneo paralelo.
2. **Importación de fidelidad total** — `import_claude` convierte las transcripciones en sesiones DSH balanceadas y reanudables, repara las llamadas a herramientas interrumpidas e importa por streaming en trozos las transcripciones mayores que `maxTranscriptBytes`.
3. **Un solo workspace `claudecode`** — cada sesión importada cae en un workspace dedicado (por defecto `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` restaura la agrupación un-workspace-por-proyecto.
4. **Solo-copia e incremental** — nada se mueve, reescribe ni borra en ninguno de los dos lados; re-ejecutar solo añade los turnos nuevos.
5. **Contexto personal, siempre fresco** — las memorias se inyectan como sección de prompt en vivo, las habilidades de Claude se registran como habilidades DSH reales, y el `CLAUDE.md` global + de proyecto se inyecta temprano.
6. **Asistente de migración de cuatro fuentes** — el asistente `/move` más las herramientas `move_detect` / `move_preview` / `move_run` migran Claude Code, Codex, OpenCode y Hermes: las memorias se convierten en secciones gestionadas de `AGENTS.md`, las habilidades en habilidades DSH, los comandos de barra en comandos DSH, y las sesiones en sesiones DSH reanudables — con aprobación e idempotencia (`move.json`).
7. **Panel web y comandos** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset` y un panel de migración flotante con progreso, cancelación, paginación y "abrir sesión".

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"

# o desde npm (versiones publicadas)
dsh plugin --profile web add dsh-claude-move

# 2. reinicia y verifica la fila
dsh --profile web --dump-config | grep -A4 'id: claude-move'
```

Luego, en cualquier sesión DSH, ejecuta un comando:

```sh
/claude-import-all      # escanea → copia cada sesión de Claude → informa
```

No hace falta reiniciar DSH tras importar — refresca la página web abierta una vez y haz clic en cualquier sesión importada para continuar.

## Instalación y desinstalación

- **Canal git** (último `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — ESM puro, sin paso de `prepare` ni `allowBuilds`.
- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-claude-move`.
- **Canal tarball**: `npm pack` en este repo y luego `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`.
- **Desinstalación**: elimina la fila `claude-move` de los bundles del perfil y reinicia `dsh`. Las sesiones importadas permanecen; el plugin solo escribe su caché (`$DSH_HOME/claude-move/`) y la carpeta del workspace `claudecode`, y nunca toca los datos fuente de Claude.

## Configuración

Todo opcional, anulable en cordis.yml.

| Clave | Por defecto | Significado |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` o `~/.claude` | Raíz de datos de Claude |
| `workspaceMode` | `claudecode` | `claudecode` (un workspace dedicado) · `per-project` (un workspace por cwd fuente) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | Carpeta del workspace `claudecode` (la única carpeta que el plugin crea) |
| `scanGit` | `true` | Nivel de sondeo git: `true` (completo) · `'branch'` (cero llamadas git) · `false` |
| `gitTimeoutMs` | `5000` | Timeout del subproceso git |
| `scanConcurrency` | `8` | Límite de escaneo paralelo de proyectos |
| `maxTranscriptBytes` | `67108864` | Umbral de importación por streaming (troceado por encima) |
| `excludeProjects` | `[]` | Subcadenas de slug a omitir |
| `enableMemory` | `true` | Inyecta memorias como sección de prompt en vivo |
| `memoryMaxBytes` | `8192` | Límite de la sección de memoria |
| `memoryScope` | `current-project` | `current-project` · `all` (el proyecto actual primero) |
| `enableSkills` | `true` | Registra habilidades de Claude como habilidades DSH |
| `maxSkills` | `30` | Límite de habilidades |
| `extraSkillDirs` | `[]` | Directorios de habilidades extra |
| `enableInstructions` | `true` | Inyecta `CLAUDE.md` global + de proyecto |
| `resumeMaxChars` | `2048` | Límite de caracteres del resumen de traspaso |
| `resumeMode` | `inject` | `inject` (resumen de traspaso) · `agents` (ctx.agents.resume) |
| `enableWebPanel` | `true` | Registra las rutas del panel `/api/claude-move/*` |
| `importConcurrency` | `4` | Lectura + conversión en paralelo por lote |
| `requireApproval` | `true` | Las escrituras del asistente piden `ctx.approval` (solo allowed-once) |
| `codexHome` | `$CODEX_HOME` o `~/.codex` | Raíz de datos de Codex |
| `opencodeDataHome` | dir de datos XDG de la plataforma/opencode | Raíz de datos de OpenCode |
| `opencodeConfigHome` | dir de config XDG de la plataforma/opencode | Raíz de config de OpenCode |
| `hermesHome` | `$HERMES_HOME` o `~/.hermes` | Raíz de datos de Hermes |
| `skillsDir` | `$DSH_HOME/skills` | Destino de habilidades del asistente |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | Destino de memoria/instrucciones del asistente |
| `moveWorkspaceMode` | `per-source` | Agrupación de workspace para importaciones del asistente: `per-source` · `single` |

## Herramientas y superficies

| Superficie | Tipo | Notas |
|---|---|---|
| `claude_scan` | herramienta | Índice estructurado de proyectos/sesiones/memorias/habilidades/ajustes |
| `import_claude` | herramienta | Importa una sesión, un directorio o `all` (incremental; `force` para copia nueva) |
| `move_detect` / `move_preview` / `move_run` | herramientas | Asistente de cuatro fuentes: escanear, plan por ítem con diffs, ejecutar con aprobación |
| `/claude-import-all` | comando | Escanea → importa todo → informa |
| `/resume-claude` | comando | Continúa una sesión de Claude (latest, id o palabra clave) |
| `/claude-move-reset` | comando | Reinicia la caché del plugin (las sesiones importadas se conservan) |
| `/move` | comando | Asistente de cuatro fuentes de un solo paso |
| Panel web de migración | cliente | Panel flotante con progreso, cancelación, paginación, abrir sesión |

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `filesystem:read` y `filesystem:write`.
- **Lee** `~/.claude` (transcripciones, memorias, habilidades, `CLAUDE.md`, `settings.json`) — estrictamente de solo lectura — y los directorios de proyecto a los que importa.
- **Escribe** logs de sesión DSH mediante el servicio público `sessionPersistence` (solo create + append, nunca borra/reescribe/archiva), registros del workspace-registry, su caché bajo `$DSH_HOME/claude-move/` y la carpeta del workspace `claudecode`.
- **Nunca** modifica archivos fuente de Claude, toca datos de otras aplicaciones ni accede a la red. **No** se leen ni transmiten credenciales.

## Límites de seguridad

- **Los archivos fuente son de solo lectura; los logs DSH son solo-append** (solo `create` + `append`).
- **Las transcripciones externas son entrada no confiable** — nada en ellas se ejecuta; el contenido system/developer/thinking nunca entra en el traspaso de reanudación.
- **Solo servicios públicos** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; sin cambios al motor ni a la UI.
- **Los secretos se informan solo por posición**; los registros `permission`/`permission-mode`/`queue-operation` se cuentan, no se importan.
- **Las escrituras del asistente van con aprobación** — cualquier cosa distinta de `allowed-once` significa cero escrituras.

## Limitaciones conocidas

- Los títulos provienen de `custom-title`/`ai-title`/primer prompt; los registros `summary` de Claude se informan pero no se mapean a nodos de compactación DSH.
- Los bloques `thinking` se conservan como contenido `reasoning`, pero nunca entran en el traspaso de reanudación.
- Las llamadas a herramientas interrumpidas se reparan con un resultado de error sintético (informado como `repaired.synthesized`).
- En hosts sin superficie de streaming `fs.streamText`, las transcripciones mayores que `maxTranscriptBytes` fallan en voz alta en lugar de importar parcialmente.
- En `workspaceMode: 'per-project'`, las sesiones cuyo directorio fuente fue eliminado aún se importan, pero el adjuntado al workspace falla (quedan sin agrupar). El workspace `claudecode` por defecto no depende del directorio fuente.
- El panel web es un panel flotante sin build dirigido por las propias rutas JSON del plugin.

## Desarrollo

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

## Temas

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el pipeline de importación, el asistente de migración de cuatro fuentes, el panel web, la documentación, CI/CD y releases.
- [@OLDnana1](https://github.com/OLDnana1) — análisis de causa raíz de la corrupción de llamadas a herramientas interrumpidas que hacía que las sesiones importadas devolvieran permanentemente HTTP 400 al reanudar.
- [@GooodWei](https://github.com/GooodWei) — identificó que `README.md` (y cualquier `.md` sin descripción) se registraba mal como habilidad, lo que rompía la carga de habilidades de DSH.

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
