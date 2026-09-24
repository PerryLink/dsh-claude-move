<div align="center">

# 🚚 dsh-claude-move
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-claude-move` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).

**Migra Claude Code, Codex, OpenCode y Hermes a DeepSeek Harness — copia sesiones, memorias, habilidades, instrucciones y comandos de barra como sesiones DSH reanudables, solo-copia y con aprobación.**

*Conserva tu historial de Claude Code al cambiarte: una sola instalación, sesiones reanudables, sincronización en vivo con un Claude Code en marcha y un asistente de migración de cuatro fuentes.*

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
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-claude-move?metric=downloads&lang=es)](https://dshfind.com/es/plugins/PerryLink/dsh-claude-move?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

---


<!-- star-cta -->
## ⭐ 如果它帮到了你

Este plugin forma parte de la [familia de plugins DSH](https://github.com/PerryLink) (más de 40, todos Apache-2.0). Si te resulta útil, **dale una estrella**: no desbloquea nada, pero ayuda a que la siguiente persona lo encuentre antes.

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.
## Compatibilidad

- Dirigido a `dsh 0.1.7-rc.1` (perfil web, formato de sesión V4 en la línea actual); las dependencias peer requieren `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`. Verificado el 2026-09-24 (puerta de tipos checkJs + 291 aserciones, 38 suites). Los logs importados vuelven a satisfacer la frontera de restauración actual: `tool/result` se escribe como mensaje de rol tool de primera clase de V4, y el traspaso de reanudación lleva un kind de origen propio del productor (`dsh-claude-move`), porque 0.1.7-alpha.1 retiró el origen comodín `{ kind: 'plugin', plugin }` tanto en la capa de tipos como en la admisión de filas durables. El botón «abrir sesión» del panel se renderiza deshabilitado con un título explicativo cuando el host no expone `sessions.open()`. Node `^22.19 || >=24`.
`0.1.2-rc.1` (adaptado el 2026-09-04): el sobre de sesión conserva su campo ignorable solo para compatibilidad de lectura de logs almacenados - Session.append aún no puede estamparlo, por lo que el comportamiento de la puerta no cambia.
- 0.4.0 incluye un shim de doble línea base para `sessionPersistence` en tiempo de ejecución, detectado por la forma de la API (nunca por versión): funcionan tanto la API heredada (`create`/`append`/`readFrom`, `list()` devolviendo cabeceras) como la costura de handle (`create` devolviendo un `SessionHandle`, `list()`/`stat()` devolviendo instantáneas). La costura de handle ya está publicada en la línea alpha (`@deepseek-ai/dsh-session-persistence` / `-jsonl` `0.1.5-rc.2`), así que el workflow de compatibilidad la cubre. En la ruta handle, cada append va seguido de `flush()` (barrera de durabilidad) y un `close()` emparejado (propiedad de escritor único); las cabeceras se sellan con la versión de formato actual del backend y un `isSeeded` explícito; las fuentes de modelo de asistente ausentes caen al provider. Ambas rutas de escritura toman su forma de la versión de formato que el propio backend declara: los eventos `assistant/message` sintetizados llevan `stream: []` desde el formato 2 (la frontera de restauración exige `Array.isArray(data.stream)`, así que sin él el log se escribía y se leía pero no se podía reanudar), y `tool/result` es un mensaje de rol tool de primera clase de V4 desde el formato 4, pero el envoltorio `tool-result` de v3 por debajo: nunca se escribe un log con una forma que su propio backend rechazaría. La limpieza del escaneo de importación se niega a ejecutarse cuando el `header.id` de un elemento listado no se puede resolver, por lo que `imports.json` nunca se vacía en silencio.
- Última verificación con una instalación nueva desde tarball: escaneo real, importación por lotes real (reimportación idempotente), adjuntado al workspace y artefactos de persistencia confirmados; macOS/Linux cubiertos por la matriz de CI. Los logs importados usan el formato de sesión actual del backend (V4 en `0.1.7-alpha.1`, V3 en la línea `0.1.6`, v0 en `<= 0.1.2-rc.1`) y `dsh <= 0.1.2-rc.1` no puede leerlos (la actualización es unidireccional; la alternativa es reimportar desde el transcript de origen). La exportación vuelve a leer cada una de esas formas.

### Matriz de compatibilidad (solo costuras públicas)

| Superficie | Uso | Respaldo cuando falta |
|---|---|---|
| Servicios de host (`tools` / `sessionPersistence` / `workspaceRegistry` / `commands` / `systemPrompt` / `skills` / `webServer`) | obligatorio donde se indica | los servicios opcionales se registran reactivamente; la falta de `fs` falla en voz alta |
| `sessionPersistence` doble línea base: heredada `listSnapshots` / `readFrom` / `append` frente a handle `open` / `stat` / `list()` de instantáneas | detectado por característica en tiempo de ejecución (forma de API, nunca versión) | la guarda de resolución de `header.id` aborta el escaneo en voz alta en vez de vaciar `imports.json` en silencio |
| `fs` con capacidad `streamText` / `ctx.jobs` / `ctx.agents.resume` | detectado por característica | lectura de archivo completo con rechazo en voz alta / mapa de jobs propio / inyección de traspaso |
| Servicios de shell del cliente (`sessions.refresh/open`, `workspaces.refresh`) | detectado por característica al aplicar el panel | recarga completa de la página |
| Las capacidades de plataforma más nuevas nunca son requisitos estrictos — el plugin sigue arrancando en la línea más antigua soportada (`0.1.2-rc.1`). | | |

## Qué obtienes

1. **Auto-descubrimiento** — `claude_scan` localiza la raíz de datos de Claude (`$CLAUDE_CONFIG_DIR`, con fallback a `~/.claude`) e indexa cada proyecto/sesión, memoria, habilidad, `CLAUDE.md` global y `settings.json`, con caché incremental y escaneo paralelo (`scanConcurrency`).
2. **Importación con fidelidad total** — `import_claude` convierte las transcripciones en sesiones DSH balanceadas y reanudables (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), repara llamadas a herramientas interrumpidas e importa por streaming en trozos las transcripciones mayores que `maxTranscriptBytes`.
3. **Un solo workspace `claudecode`** — cada sesión importada cae en un workspace dedicado (por defecto `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` restaura la agrupación de un workspace por proyecto.
4. **Solo-copia e incremental** — nada se mueve, reescribe ni elimina en ninguno de los dos lados; reejecutar solo añade los turnos nuevos (`force: true` guarda una copia completa adicional con un id nuevo).
5. **Contexto personal, siempre fresco** — las memorias se inyectan como una sección de prompt en vivo, las habilidades de Claude se registran como habilidades DSH reales (globales + a nivel de proyecto), y el `CLAUDE.md` global + de proyecto se inyecta temprano.
6. **Asistente de migración de cuatro fuentes** — `/move` más `move_detect` / `move_preview` / `move_run` migran Claude Code, Codex, OpenCode y Hermes, con aprobación e idempotencia (`move.json`).
7. **Panel web y comandos** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset`, `/claude-export` y un panel de migración flotante.
8. **Exportación bidireccional** — `claude_export` (o `/claude-export <sessionId>`) vuelve a escribir una sesión DSH como transcript JSONL reanudable de Claude Code (turnos `user`/`assistant`/`tool`, emparejamiento `thinking` + `tool_use`/`tool_result`, mapeo `cwd` de mejor esfuerzo), para que el historial pueda salir de DSH de nuevo.

## Asistente de migración de cuatro fuentes

```text
/move              # asistente de un solo paso: detectar → previsualizar → ejecutar → informar (las cuatro fuentes)
move_detect        # escanea Claude Code / Codex / OpenCode / Hermes
move_preview       # plan por ítem: new | unchanged | changed | conflict (con diff) | unsupported
move_run           # ejecuta tras la puerta de aprobación; resolución de conflictos:
                   #   skip | overwrite | rename | merge  (por defecto skip — nunca adivina)
```

- **Fuentes** — Claude Code (`~/.claude`), Codex (`~/.codex`), OpenCode (raíces de datos + config), Hermes (raíces de skills/memoria); cada fuente tiene su propio parser + mapper.
- **Mapeo** — memorias/instrucciones → secciones gestionadas solo-anexables en el `AGENTS.md` global de DSH (una sección marcada por ítem); skills → skills DSH reales (los paquetes `SKILL.md` se copian tal cual, otros formatos se convierten); comandos de barra → comandos DSH registrados (reconstruidos desde `move.json` tras un reinicio); sesiones → sesiones DSH reanudables (los mismos importadores que la fase 1).
- **Idempotente** — cada plan aplicado se registra en `$DSH_HOME/claude-move/move.json` (`digest` / `targetDigest` / `appliedAt`); las reejecuciones omiten los ítems sin cambios y `force` los vuelve a aplicar.
- **Con aprobación** — una ejecución que escribiría algo pregunta primero a `ctx.approval`; cualquier cosa distinta de `allowed-once` significa cero escrituras.

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

No es necesario reiniciar DSH después de importar — refresca la página web abierta una vez y haz clic en cualquier sesión importada para continuar.

## Instalación y desinstalación

- **Canal git** (último `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — ESM puro, sin paso de `prepare` ni `allowBuilds`.
- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-claude-move`.
- **Canal tarball**: `npm pack` en este repo y luego `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`.
- **Desinstalación**: elimina la fila `claude-move` de los bundles del perfil y reinicia `dsh`. Las sesiones importadas permanecen en el directorio de datos de DSH; el plugin solo escribe su caché (`$DSH_HOME/claude-move/`) y la carpeta del workspace `claudecode`, y nunca toca los datos fuente de Claude.

## Qué se migra

```
~/.claude (solo lectura)
 ├─ projects/*/*.jsonl  ──→  sesiones DSH reanudables, agrupadas en un workspace "claudecode" (por defecto)
 ├─ projects/*/memory/  ──→  sección de memoria del system-prompt en vivo (se relee por petición)
 ├─ skills/**           ──→  skills DSH reales
 └─ CLAUDE.md + settings ──→  sección de prompt temprana + sugerencias de configuración (nunca se auto-aplican)
```

| En Claude Code | Llega a DSH como |
|---|---|
| Transcripciones de sesión (`projects/*/*.jsonl`) | Sesiones DSH balanceadas y reanudables — mapeo con fidelidad total de `user`/`assistant`/`tool`/`thinking` con reparación de llamadas a herramientas interrumpidas — agrupadas en un workspace **`claudecode`** o una por proyecto |
| Archivos de memoria (`projects/*/memory/*.md`) | Una sección de contexto del system-prompt en vivo, releída en cada petición (`feedback > project > reference > user`) |
| Skills (`~/.claude/skills/**`) | Skills DSH reales (nombres kebab-case, sufijos de colisión, máximo 30 por defecto; `README.md`/`MEMORY.md` y archivos sin descripción se omiten) |
| `CLAUDE.md` (global + por proyecto) | Una sección de prompt temprana; gana el archivo del proyecto |
| `settings.json` | Sugerencias de configuración DSH con una lista explícita de claves no mapeables |
| Estado del proyecto (directorio, rama git y conteo de cambios) | Se muestra en el índice de escaneo, las insignias del panel web y el traspaso de `/resume-claude` |

## Uso

Llama a las herramientas en cualquier sesión con el plugin montado:

```
claude_scan                          # escaneo completo (caché incremental)
claude_scan { path: "~/.claude/projects/<slug>" }   # escaneo parcial
claude_scan { refresh: true }        # omite la caché, reescanea todo
claude_scan { projectsLimit: 10, sessionsLimit: 5, fields: "brief" }  # recorta la salida

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # una sesión
import_claude { path: "~/.claude/projects" }        # directorio (recursivo)
import_claude { path: "all" }                       # todo
# Reejecuta en cualquier momento: los archivos sin cambios se omiten, las transcripciones crecidas solo añaden los turnos nuevos.
# Los archivos mayores que maxTranscriptBytes se importan por streaming en trozos (sin techo de memoria).
import_claude { path: "...", force: true }          # copia completa nueva (se conserva la copia anterior)

claude_export { sessionId: "<dsh-session-id>" }     # escribe una sesión DSH de vuelta a JSONL de Claude
claude_export { sessionId: "...", path: "~/.claude/projects/<slug>/<id>.jsonl" }  # destino explícito
```

Comandos (activados por el usuario, sin turno del modelo):

```
/claude-import-all                # un solo paso: escanear → importar todo → informar → inyectar en la sesión actual
/resume-claude latest             # continúa la sesión de Claude más reciente
/resume-claude <sessionId>        # por id de sesión fuente o id import-<src>
/resume-claude <keyword>          # coincide con títulos; varias coincidencias se listan, nunca se adivina
/claude-move-reset                # reinicia la caché del plugin (marcadores + mapa de importación); las sesiones importadas se conservan
/claude-export <sessionId> [path] # exporta una sesión DSH a un transcript JSONL reanudable de Claude
```

Panel web: un panel de migración flotante con el árbol de proyectos/sesiones, insignias de estado (no importado / importado / importado-con-turnos-nuevos / fuente ausente / directorio ausente / git sucio), filtro por palabra clave, renderizado paginado, "Importar y continuar" + "Abrir sesión" + "Refrescar lista de sesiones" por sesión, importación por lotes con barra de progreso en vivo y cancelar, y un botón de reinicio de caché. Los textos siguen el idioma del navegador (zh/en). Servido a través de las rutas JSON `/api/claude-move/*` propias del plugin en la costura pública `ctx.webServer`.

## Después de importar

**No necesitas reiniciar DSH.** Las importaciones aterrizan de forma duradera a través del servicio público `sessionPersistence` en el momento en que se completan:

- Las listas del lado del servidor (RPCs `session.list` / `workspace.list`, la CLI, cualquier carga de página nueva) muestran las sesiones importadas bajo el workspace **`claudecode`** de inmediato.
- El panel refresca por sí mismo la lista de sesiones de la página ya abierta y ofrece un botón **Abrir sesión** por cada sesión importada.
- Las sesiones importadas pueden abrirse, leerse y reanudarse de inmediato — `/resume-claude`, o haz clic en la sesión de la lista. Reejecutar la importación en cualquier momento sincroniza solo los turnos nuevos en las mismas sesiones.

## Configuración

Todo opcional, anulable en cordis.yml.

| Clave | Por defecto | Significado |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` o `~/.claude` | Raíz de datos de Claude |
| `workspaceMode` | `claudecode` | `claudecode` (un workspace dedicado) · `per-project` (un workspace por cwd fuente) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | La carpeta del workspace `claudecode` (la única carpeta que el plugin crea) |
| `scanGit` | `true` | Nivel de sondeo de git: `true` (completo) · `'branch'` (cero llamadas a git) · `false` |
| `gitTimeoutMs` | `5000` | Timeout del subproceso de git |
| `scanConcurrency` | `8` | Límite de escaneo paralelo de proyectos |
| `maxTranscriptBytes` | `67108864` | Umbral de importación por streaming (troceado por encima) |
| `excludeProjects` | `[]` | Subcadenas de slug a omitir |
| `enableMemory` | `true` | Inyecta memorias como una sección de prompt en vivo |
| `memoryMaxBytes` | `8192` | Límite de la sección de memoria |
| `memoryScope` | `current-project` | `current-project` · `all` (el proyecto actual primero) |
| `enableSkills` | `true` | Registra habilidades de Claude como habilidades DSH |
| `maxSkills` | `30` | Límite de cantidad de habilidades |
| `extraSkillDirs` | `[]` | Directorios de habilidades adicionales |
| `enableInstructions` | `true` | Inyecta `CLAUDE.md` global + de proyecto |
| `resumeMaxChars` | `2048` | Límite de caracteres del resumen de traspaso |
| `resumeMode` | `inject` | `inject` (resumen de traspaso) · `agents` (ctx.agents.resume) |
| `enableWebPanel` | `true` | Registra las rutas del panel `/api/claude-move/*` |
| `importConcurrency` | `4` | Lectura + conversión en paralelo por lote |
| `requireApproval` | `true` | Las escrituras del asistente preguntan `ctx.approval` (solo allowed-once) |
| `codexHome` | `$CODEX_HOME` o `~/.codex` | Raíz de datos de Codex |
| `opencodeDataHome` | dir de datos XDG de la plataforma/opencode | Raíz de datos de OpenCode |
| `opencodeConfigHome` | dir de config XDG de la plataforma/opencode | Raíz de config de OpenCode |
| `hermesHome` | `$HERMES_HOME` o `~/.hermes` | Raíz de datos de Hermes |
| `skillsDir` | `$DSH_HOME/skills` | Destino de habilidades del asistente |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | Destino de memoria/instrucciones del asistente |
| `moveWorkspaceMode` | `per-source` | Agrupación de workspace para importaciones del asistente: `per-source` · `single` |
| `enableExport` | `true` | Registra la herramienta `claude_export` y el comando `/claude-export` |
| `exportDir` | `$DSH_HOME/claude-export` | Carpeta de exportación por defecto (un `path` explícito siempre gana) |

## Herramientas y superficies

| Superficie | Tipo | Notas |
|---|---|---|
| `claude_scan` | herramienta | Índice estructurado de proyectos/sesiones/memorias/habilidades/ajustes |
| `import_claude` | herramienta | Importa una sesión, un directorio o `all` (incremental; `force` para una copia nueva) |
| `claude_export` | herramienta | Exporta una sesión DSH a un transcript JSONL reanudable de Claude Code |
| `move_detect` / `move_preview` / `move_run` | herramientas | Asistente de cuatro fuentes: escanear, plan por ítem con diffs, ejecutar tras la aprobación |
| `/claude-import-all` | comando | Escanea → importa todo → informa |
| `/resume-claude` | comando | Continúa una sesión de Claude (latest, id o palabra clave) |
| `/claude-move-reset` | comando | Reinicia la caché del plugin (las sesiones importadas se conservan) |
| `/claude-export` | comando | Exporta una sesión DSH a un transcript JSONL reanudable de Claude |
| `/move` | comando | Asistente de cuatro fuentes de un solo paso |
| Panel web de migración | cliente | Panel flotante con progreso, cancelación, paginación, abrir sesión |

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `filesystem:read` y `filesystem:write`.
- **Lee** `~/.claude` (transcripciones, memorias, habilidades, `CLAUDE.md`, `settings.json`) — estrictamente de solo lectura — y los directorios de proyecto a los que importa.
- **Escribe** logs de sesión DSH a través del servicio público `sessionPersistence` (solo create + append, nunca elimina/reescribe/archiva), registros del workspace-registry, su caché bajo `$DSH_HOME/claude-move/` y la carpeta del workspace `claudecode`.
- **Nunca** modifica archivos fuente de Claude, toca datos de otras aplicaciones ni accede a la red. **No** se leen ni transmiten credenciales.

## Límites de seguridad

- **Los archivos fuente son de solo lectura; los logs DSH son solo-append** (solo `create` + `append`).
- **Las transcripciones externas son entrada no confiable** — nada en ellas se ejecuta; el contenido system/developer/thinking nunca entra en el traspaso de reanudación.
- **Solo servicios públicos** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; sin cambios en el motor ni en la UI.
- **Los secretos se informan solo por posición** (file:line:kind); los registros `permission`/`permission-mode`/`queue-operation` se cuentan, no se importan.
- **Las escrituras del asistente van con aprobación** — cualquier cosa distinta de `allowed-once` significa cero escrituras.

## Limitaciones conocidas

- Los títulos provienen de `custom-title`/`ai-title`/primer prompt; los registros `summary` de Claude se informan pero no se mapean a nodos de compactación DSH (sintetizar una transacción de compactación válida fabricaría su rango de seq y su mensaje de checkpoint).
- Los bloques `thinking` se conservan como contenido `reasoning`, pero nunca entran en el traspaso de reanudación.
- Las llamadas a herramientas interrumpidas se reparan con un resultado de error sintético (nunca se descartan), informado como `repaired.synthesized`.
- Los registros de clase de permisos se cuentan, no se importan; las sugerencias de permisos predefinidos DSH se generan en los informes.
- En hosts sin una superficie de streaming `fs.streamText`, las transcripciones mayores que `maxTranscriptBytes` fallan en voz alta en lugar de importar parcialmente.
- En `workspaceMode: 'per-project'`, las sesiones cuyo directorio fuente fue eliminado aún se importan, pero el adjuntado al workspace falla (quedan sin agrupar; `workspace.attached: false` más un `reason`). El workspace `claudecode` por defecto no depende del directorio fuente.
- Si una transcripción fue truncada o reiniciada en el lugar (menos turnos que la importación registrada), la reimportación la omite e informa `sourceShrunk`; usa `force: true` para una copia completa nueva.
- El panel web es un panel flotante sin build dirigido por las propias rutas JSON del plugin; no usa el sistema de slots de UI interno del shell.

## Experiencia del modelo

- La superficie visible para el modelo son las descripciones/esquemas de las dos herramientas y sus salidas: `claude_scan` devuelve el índice estructurado, `import_claude` devuelve resúmenes por archivo con posiciones de las advertencias. Los resultados de las herramientas se registran a su vez como eventos `tool/result`, de modo que todo es reconstruible.
- No hay texto oculto visible para el modelo; las secciones de memoria/`CLAUDE.md` se registran en `ctx.systemPrompt` (ensamblado de prompt, reconstruible desde el log de sesión).

## Solución de problemas

- Fila sin efecto: `dsh --profile <p> --dump-config` debería imprimir `# == dsh-claude-move`; vuelve a ejecutar `dsh plugin --profile <p> add ...`.
- La web arranca pero se cuelga en silencio: los perfiles nuevos inicializados por `dsh plugin add` contienen solo `dsh-base` — añade `@deepseek-ai/dsh-web-app` a `dsh.profile.bundles`. Instalar en el perfil `web` existente no necesita nada.
- Rutas del panel 404: se sirven solo cuando `enableWebPanel: true` y hay un servidor web compuesto; revisa el log de arranque en busca de fibers FAILED.
- La importación falla con "transcript 过大": sube `maxTranscriptBytes` o importa ese archivo individualmente.
- La importación tuvo éxito pero la barra lateral no muestra ninguna sesión nueva: la página ya estaba abierta — haz clic una vez en el botón de refrescar del panel (o recarga la página). Nunca es necesario reiniciar DSH.
- Logs: los fallos de arranque se imprimen en la consola de `dsh`; el plugin registra errores con prefijo `[claude-move]` para problemas de workspace/mapa de importación.

## Atribución (componentes de código abierto)

Este proyecto está licenciado bajo la Apache License 2.0; los siguientes componentes con licencia MIT conservan sus propias licencias (texto completo en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- Núcleo de conversión vendored de [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Convenciones de descubrimiento y modelo de seguridad de [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT).
- Patrones de inyección de memoria/skills y análisis de frontmatter de [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## Desarrollo

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

CI ejecuta la suite completa en Node 22 en Linux/macOS/Windows a través de GitHub Actions ([test.yml](.github/workflows/test.yml)).

## Temas

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el pipeline de importación, el asistente de migración de cuatro fuentes, el panel web, la documentación, CI/CD y releases.
- [@OLDnana1](https://github.com/OLDnana1) — análisis de causa raíz de la corrupción de llamadas a herramientas interrumpidas que hacía que las sesiones importadas devolvieran permanentemente HTTP 400 al reanudar.
- [@GooodWei](https://github.com/GooodWei) — identificó que `README.md` (y cualquier `.md` sin descripción) se registraba mal como habilidad, lo que rompía la carga de habilidades de DSH.

### Instalar desde el mercado de DSH Desktop

Todos los plugins de PerryLink pueden explorarse en el mercado integrado de DSH Desktop: **Market → Sources → add source → pegar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ seleccionarlo**. La instalación sigue pasando por la verificación de identidad npm del mercado y tu confirmación.

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors


## PerryLink DSH Plugin Family

This project is one of the **45 DeepSeek Harness plugins** maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |
| **[dsh-plugin-upgrade-015](https://github.com/PerryLink/dsh-plugin-upgrade-015)** | Merged `0.1.3-alpha.1` → `0.1.5-rc.1` upgrade corridor card plus a zero-dependency seam scanner | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools | |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |
