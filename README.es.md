# dsh-claude-move

**Claude Code → DeepSeek Harness: migración completa + reanudación sin interrupciones.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)

[English](README.md) | [中文](README.zh.md) | Español | [Português](README.pt.md) | [हिन्दी](README.hi.md)

Un plugin para [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Tras instalarlo, descubre automáticamente todo lo que hay en tu Claude Code local — transcripciones de sesiones, memorias, habilidades (skills), instrucciones globales, configuración y estado del proyecto — y traslada «historial + contexto personal» a DSH, para que puedas **continuar tus sesiones de Claude Code sin interrupciones** dentro de DeepSeek Harness.

> Estado: en desarrollo (Fase 4/6 — comandos implementados). Hoja de ruta y diseño: [PLAN.md](PLAN.md).

## Qué hace

- **Descubrimiento automático**: localiza la raíz de datos de Claude (`$CLAUDE_CONFIG_DIR`, por defecto `~/.claude`), indexa cada proyecto/sesión (título, marcas de tiempo, recuento de mensajes y llamadas a herramientas), el estado del directorio y de git (rama, archivos modificados), las memorias, las habilidades, el `CLAUDE.md` global y el `settings.json`. Caché incremental: solo se releen los archivos modificados.
- **Importación de historial**: mapeo de eventos con fidelidad total (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), generando **sesiones DSH equilibradas y reanudables**, vinculadas al espacio de trabajo original. Idempotente, por lotes, reimportación forzada, informe de líneas malformadas con número de línea.
- **Contexto personal siempre actualizado**: las memorias se inyectan como una sección dinámica del prompt del sistema (se releen en cada petición), las habilidades de Claude se registran como habilidades reales de DSH, y el `CLAUDE.md` global y el del proyecto se inyectan como una sección temprana (el proyecto tiene prioridad). El `settings.json` se traduce en sugerencias de configuración de DSH.

## Hoja de ruta

| Fase | Alcance | Estado |
| --- | --- | --- |
| 1 | Descubrimiento automático + herramienta `claude_scan` + caché incremental | ✅ |
| 2 | Importación de historial (`import_claude`: mapeo, idempotencia, lotes, reimportación forzada, errores con número de línea, vinculación al espacio de trabajo) | ✅ |
| 3 | Contexto personal (inyección de memorias, proveedor de habilidades de Claude, sección CLAUDE.md, traducción de settings) | ✅ |
| 4 | Comandos de un paso `/claude-import-all` y `/resume-claude` (resumen de traspaso + modelo de seguridad) | ✅ |
| 5 | Panel web «migración de Claude» (`dsh.client`) | 🚧 |
| 6 | Pulido para publicación: documentación bilingüe, diagrama de arquitectura, empaquetado, demo | 🚧 |

## Instalación

```sh
# Desde GitHub
dsh plugin --profile web add -w github:<owner>/dsh-claude-move

# Copia local (desarrollo)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# Desde un tarball empaquetado
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

El paquete es ESM puro y no tiene paso de compilación, así que la instalación desde Git no necesita script `prepare` ni la lista `allowBuilds`. Consulta la [guía oficial de empaquetado e instalación](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## Uso

Invoca las herramientas en cualquier sesión con el plugin montado:

```
claude_scan                          # escaneo completo (caché incremental)
claude_scan { path: "~/.claude/projects/<slug>" }   # escaneo parcial
claude_scan { refresh: true }        # ignora la caché y vuelve a escanear todo

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # una sesión
import_claude { path: "~/.claude/projects" }        # directorio (recursivo)
import_claude { path: "all" }                       # todo
import_claude { path: "...", force: true }          # archiva la importación anterior y reconstruye como import-<src>-<n>
```

Comandos (los dispara el usuario, sin turno del modelo):

```
/claude-import-all                # un paso: escanear → importar → informe → inyectar en la sesión actual
/resume-claude latest             # continuar la sesión de Claude más reciente
/resume-claude <sessionId>        # por id de sesión de origen o id import-<src>
/resume-claude <palabra clave>    # coincide con títulos; varias coincidencias se listan, nunca se adivina
```

- **Escaneo**: devuelve un índice JSON estructurado: proyectos (slug/cwd/existencia del directorio/rama de git y archivos modificados), sesiones (título/marcas de tiempo/recuentos/líneas malformadas), memorias, habilidades, CLAUDE.md global y settings.json; cada sesión lleva `import.status` (`none`/`imported`/`source-missing`). `settingsSuggestions` contiene la traducción a DSH del settings.json y las claves no mapeables (ver [COMPLIANCE.md](COMPLIANCE.md)).
- **Importación**: mapea mensajes user/assistant/tool/thinking con fidelidad total; el resultado es una sesión equilibrada y reanudable, vinculada a su espacio de trabajo por `cwd`. Los lotes se resumen archivo por archivo (`imported`/`already-imported`/`skipped`/`failed`), las líneas malformadas llevan número de línea, los posibles secretos se informan solo por posición (archivo:línea:tipo) y los registros de permisos se cuentan pero nunca se importan.
- **El contexto personal se aplica automáticamente** (sin acción de importación):
  - Memorias: todos los `projects/*/memory/*.md` se inyectan como sección dinámica, se releen en cada petición (las memorias nuevas surten efecto al instante), orden `feedback > project > reference > user`, límite de 8 KiB por defecto.
  - Habilidades: `~/.claude/skills/**/SKILL.md` (más archivos planos `*.md`) se convierten en habilidades de DSH (nombres normalizados a kebab-case, colisiones con sufijo, máximo 30); DSH se encarga del catálogo y de la herramienta `skill`.
  - Instrucciones: el `~/.claude/CLAUDE.md` global más el `.claude/CLAUDE.md` de la sesión actual se inyectan como una sección temprana (el proyecto gana).

## Configuración

Todo opcional y reemplazable en `cordis.yml`:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # por defecto: $CLAUDE_CONFIG_DIR o ~/.claude
    scanGit: true               # sondear rama de git y estado de cambios
    maxTranscriptBytes: 67108864
    excludeProjects: []         # subcadenas de slug a omitir, p. ej. ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # límite de caracteres del resumen
```

## Desinstalación

Elimina la fila `claude-move` de los bundles del perfil y reinicia `dsh`. Las sesiones importadas permanecen en el directorio de datos de DSH; el plugin solo escribe su caché (`$DSH_HOME/claude-move/`) y nunca toca los datos de origen de Claude.

## Límites de seguridad

- Los archivos de origen son estrictamente de solo lectura; los registros de sesión de DSH son solo de adición (`create` + `append` únicamente).
- Las transcripciones externas son entrada no confiable: nada de su contenido se ejecuta; el contenido system/developer/thinking nunca entra en el resumen de traspaso.
- Sin cambios al motor de DSH, a los paquetes oficiales de UI ni a apiproxy — solo servicios públicos (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`).
- Los posibles secretos se informan solo por ubicación (nunca su contenido); los registros `permission`/`permission-mode`/`queue-operation` se cuentan, no se importan.

## Cumplimiento y optimización

- [COMPLIANCE.md](COMPLIANCE.md) — auditoría cláusula por cláusula frente a las restricciones oficiales de plugins (repositorio y docs de deepseek-harness, [deepseek.com/harness](https://www.deepseek.com/harness/), [documentación para desarrolladores](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis) y el [artículo de Cordis](https://github.com/cordiverse/paper)).
- [OPTIMIZATION.md](OPTIMIZATION.md) — líneas base medidas y candidatos de optimización priorizados (escaneo/importación en paralelo, reutilización de gitBranch, importación por streaming, modo de sincronización incremental…).

## Atribución (ecosistema MIT)

- Núcleo de conversión vendored desde [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Convenciones de descubrimiento y modelo de seguridad de [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; su `session_reader.py` tiene un origen Apache-2.0 — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Patrones de inyección de memoria/habilidades y análisis de frontmatter de [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## Desarrollo

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + extendido), discovery, import/report, context, settings
```

## Experiencia del modelo

- La superficie visible para el modelo son las descripciones/esquemas de las dos herramientas y sus salidas: `claude_scan` devuelve el índice estructurado, `import_claude` devuelve resúmenes por archivo con las posiciones de los avisos. Los resultados de herramientas son eventos `tool/result` registrados, así que todo es reconstruible.
- No hay texto oculto para el modelo; las secciones de memory/CLAUDE.md se registran en `ctx.systemPrompt` (ensamblado del prompt, reconstruible desde el registro de sesión).

## Limitaciones conocidas

- Los títulos provienen de `custom-title`/`ai-title`/primer mensaje; los registros `summary` de Claude no se usan como título.
- Los bloques `thinking` se conservan en el registro importado como contenido `reasoning`, pero nunca entran en el resumen de traspaso.
- Los registros de permisos se cuentan, no se importan; las sugerencias de permisos de DSH se generan en los informes.
- Las transcripciones mayores que `maxTranscriptBytes` fallan con aviso en lugar de importarse parcialmente (fidelidad primero); la importación por streaming en bloques está en la hoja de ruta.
- Las sesiones cuyo directorio de origen se eliminó se importan igualmente, pero la vinculación al espacio de trabajo falla (quedan sin agrupar; `workspace.attached: false` en el informe).
- Las importaciones por lotes interrumpidas se pueden reejecutar con seguridad (idempotentes, solo adición).
- El panel web aún no está implementado (Fase 5).

## Enlaces relacionados

- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [sitio](https://www.deepseek.com/harness/) · [docs para desarrolladores](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- Ecosistema de plugins: [topic `dsh-plugin`](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## Licencia

MIT — ver [LICENSE](LICENSE). Avisos de terceros en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
