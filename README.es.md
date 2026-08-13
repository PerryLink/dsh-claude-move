# dsh-claude-move

**Conserva tu historial de Claude Code al pasarte a DeepSeek Harness.** Una sola instalación copia cada sesión, memoria, habilidad y `CLAUDE.md` de Claude a DSH como sesiones reanudables — organizadas en un espacio de trabajo por proyecto de Claude.

`Solo copia` · `Reanudación sin interrupciones` · `Workspaces por proyecto` · `Sincronización en vivo con Claude Code`

[![Test](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml/badge.svg)](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml)
[![Node ^22.19 || >=24](https://img.shields.io/static/v1?label=node&message=%5E22.19%20%7C%7C%20%3E%3D24&color=2f7d4f)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Topic: dsh](https://img.shields.io/badge/topic-dsh-3fb950)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/PerryLink/dsh-claude-move/issues)

![Tarjeta social de dsh-claude-move](assets/social-card.png)

[English](README.md) | [中文](README.zh.md) | Español | [Português](README.pt.md) | [हिन्दी](README.hi.md)

> Vista previa de desarrollo (0.1.0). Hoja de ruta y diseño: [PLAN.md](PLAN.md) · historial de cambios: [CHANGELOG.md](CHANGELOG.md).

## ✨ Características

- 🔍 **Descubrimiento automático** — localiza la raíz de datos de Claude (`$CLAUDE_CONFIG_DIR`, por defecto `~/.claude`) e indexa cada proyecto/sesión (título, marcas de tiempo, recuentos), estado de directorio y git, memorias, habilidades, `CLAUDE.md` global y `settings.json` — con caché incremental que solo relee archivos modificados.
- 📥 **Importación de historial con fidelidad total** — sesiones DSH equilibradas y reanudables (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), un espacio de trabajo por proyecto de Claude, líneas malformadas con número de línea.
- 🔁 **Solo copia e incremental** — nada se mueve, reescribe ni elimina en ningún lado. Reejecutar la importación solo añade los turnos nuevos a la misma sesión DSH; `force: true` guarda una copia completa adicional con un id nuevo.
- 🧠 **Contexto personal siempre actualizado** — memorias inyectadas como sección en vivo, habilidades de Claude como habilidades reales de DSH, `CLAUDE.md` global + de proyecto inyectado temprano.
- ⚡ **Sincronización en vivo con Claude Code** — sigue usando Claude Code en paralelo; cada reejecución trae solo lo que cambió.
- 🖥 **Panel web y comandos de un paso** — `/claude-import-all`, `/resume-claude` y un panel de migración flotante con progreso.
- 🛡 **Seguridad primero** — archivos fuente estrictamente de solo lectura, logs de DSH append-only, secretos informados solo por posición, registros de permisos contados pero nunca importados.

## 🚀 Inicio rápido

```sh
# 1. Instalar
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move
```

2. En cualquier sesión de DSH, ejecuta un comando:

```
/claude-import-all      # escanear → copiar todas las sesiones de Claude → informe
```

3. Refresca una vez la página web ya abierta (el panel tiene el botón «Refrescar lista de sesiones») y pulsa cualquier sesión importada para continuar. **No hace falta reiniciar DSH** — ver [Después de importar](#después-de-importar).

¿Prefieres control fino?

```
claude_scan                                     # índice estructurado de todos los proyectos/sesiones
import_claude { path: "~/.claude/projects" }    # un directorio de proyecto (recursivo)
import_claude { path: "all" }                   # todo
```

## 🗂 Qué se migra

```
~/.claude (solo lectura)
 ├─ projects/*/*.jsonl  ──→  sesiones DSH reanudables, un workspace por proyecto (cwd)
 ├─ projects/*/memory/  ──→  sección de memoria en vivo del prompt del sistema (releída por petición)
 ├─ skills/**           ──→  habilidades reales de DSH
 └─ CLAUDE.md + settings ──→  sección temprana del prompt + sugerencias de configuración (nunca auto-aplicadas)
```

| En Claude Code | Aterriza en DSH como |
| --- | --- |
| Transcripciones de sesión (`projects/*/*.jsonl`) | Sesiones DSH equilibradas y reanudables — mapeo fiel de `user`/`assistant`/`tool`/`thinking` — agrupadas en un espacio de trabajo por proyecto (`cwd`) |
| Archivos de memoria (`projects/*/memory/*.md`) | Una sección de contexto del prompt del sistema en vivo, releída en cada petición (`feedback > project > reference > user`) |
| Habilidades (`~/.claude/skills/**`) | Habilidades reales de DSH (nombres kebab-case, colisiones con sufijo, máximo 30 por defecto) |
| `CLAUDE.md` (global + por proyecto) | Una sección temprana del prompt; el archivo del proyecto gana |
| `settings.json` | Sugerencias de configuración de DSH con lista explícita de claves no mapeables |
| Estado del proyecto (directorio, rama de git y archivos modificados) | Visible en el índice de escaneo y en las insignias del panel web |

## 📦 Instalación

```sh
# Desde GitHub
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move

# Copia local (desarrollo)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# Desde un tarball empaquetado
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

El paquete es ESM puro y no tiene paso de compilación, así que la instalación desde Git no necesita script `prepare` ni la lista `allowBuilds`. Consulta la [guía oficial de empaquetado e instalación](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## 🛠 Uso

Invoca las herramientas en cualquier sesión con el plugin montado:

```
claude_scan                          # escaneo completo (caché incremental)
claude_scan { path: "~/.claude/projects/<slug>" }   # escaneo parcial
claude_scan { refresh: true }        # ignora la caché y vuelve a escanear todo

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # una sesión
import_claude { path: "~/.claude/projects" }        # directorio (recursivo)
import_claude { path: "all" }                       # todo
# Puedes volver a ejecutarlo cuando quieras: los archivos sin cambios se omiten y las transcripciones que crecieron solo añaden los turnos nuevos.
import_claude { path: "...", force: true }          # copia completa nueva como import-<src>-<n> (la copia anterior se conserva)
```

Comandos (disparados por el usuario, sin turno del modelo):

```
/claude-import-all                # un paso: escanear → importar todo → informe → inyectar en la sesión actual
/resume-claude latest             # continuar la sesión de Claude más reciente
/resume-claude <sessionId>        # por id de sesión de origen o id import-<src>
/resume-claude <palabra clave>    # busca títulos; los múltiples resultados se listan, nunca se adivinan
```

Panel web: el botón flotante **🐳 Claude 迁移** (abajo a la derecha) abre el panel — árbol de proyectos/sesiones con insignias de estado (sin importar / importado / origen faltante / directorio inexistente / git sucio), filtro por palabra clave, «Importar y continuar» por sesión + «Refrescar lista de sesiones», e importación por lotes con barra de progreso. Usa las rutas JSON `/api/claude-move/*` propias del plugin, registradas en el seam público `ctx.webServer`.

- **Escaneo**: devuelve un índice JSON estructurado: proyectos (slug/cwd/existencia del directorio/rama de git y archivos modificados), sesiones (título/marcas de tiempo/recuentos/líneas malformadas), memorias, habilidades, CLAUDE.md global y settings.json; cada sesión lleva `import.status` (`none`/`imported`/`source-missing`). `settingsSuggestions` contiene la traducción a DSH del settings.json y las claves no mapeables (ver [COMPLIANCE.md](COMPLIANCE.md)).
- **Importación**: mapea mensajes user/assistant/tool/thinking con fidelidad total; el resultado es una sesión equilibrada y reanudable, vinculada a su espacio de trabajo por `cwd`. Los lotes se resumen archivo por archivo (`imported`/`appended`/`already-imported`/`skipped`/`failed`), las líneas malformadas llevan número de línea, los posibles secretos se informan solo por posición (archivo:línea:tipo) y los registros de permisos se cuentan pero nunca se importan. Importar nunca borra ni reescribe nada: las sesiones existentes de DSH quedan intactas, las copias importadas anteriormente se conservan y los archivos fuente de Claude nunca se escriben.
- **El contexto personal se aplica automáticamente** (sin acción de importación):
  - Memorias: todos los `projects/*/memory/*.md` se inyectan como sección dinámica, se releen en cada petición (las memorias nuevas surten efecto al instante), orden `feedback > project > reference > user`, límite de 8 KiB por defecto.
  - Habilidades: `~/.claude/skills/**/SKILL.md` (más archivos planos `*.md`) se convierten en habilidades de DSH (nombres normalizados a kebab-case, colisiones con sufijo, máximo 30); DSH se encarga del catálogo y de la herramienta `skill`.
  - Instrucciones: el `~/.claude/CLAUDE.md` global más el `.claude/CLAUDE.md` de la sesión actual se inyectan como una sección temprana (el proyecto gana).

## ✅ Después de importar

**No hace falta reiniciar DSH.** Las importaciones se guardan de forma duradera a través del servicio público `sessionPersistence` en cuanto terminan:

- Las listas del servidor (`session.list` / `workspace.list`, la CLI o cualquier página recién abierta) muestran de inmediato las sesiones importadas y sus espacios de trabajo por proyecto.
- Única excepción: una **página web ya abierta** necesita un refresco de la lista de sesiones para dibujar las nuevas filas — las importaciones escriben sesiones frías directamente en el servicio de persistencia, así que no emiten el frame en vivo `host/session-added`; los grupos de espacios de trabajo sí se actualizan en vivo (`host/workspace-changed`). Pulsa «Refrescar lista de sesiones» del panel (o recarga la página), sin reiniciar el servidor.
- Las sesiones importadas pueden abrirse, leerse y reanudarse al momento — `/resume-claude`, o pulsa la sesión en la lista tras ese refresco. Reejecutar la importación en cualquier momento solo añade los turnos nuevos a las mismas sesiones.

## ⚙️ Configuración

Todo opcional y reemplazable en `cordis.yml`:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # por defecto: $CLAUDE_CONFIG_DIR o ~/.claude
    scanGit: true               # sondear rama de git y estado de cambios
    gitTimeoutMs: 5000          # tiempo límite del subproceso git
    maxTranscriptBytes: 67108864
    excludeProjects: []         # subcadenas de slug a omitir, p. ej. ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # límite de caracteres del resumen de traspaso
    enableWebPanel: true      # registrar las rutas del panel /api/claude-move/*
    importConcurrency: 4      # concurrencia de lectura+conversión por lote (el guardado sigue secuencial)
```

## 🗑 Desinstalación

Quita la fila `claude-move` de los bundles del perfil y reinicia `dsh`. Las sesiones importadas permanecen en el directorio de datos de DSH; el plugin solo escribe su caché (`$DSH_HOME/claude-move/`) y nunca toca los datos fuente de Claude.

## 🧭 Compatibilidad

- Objetivo: `dsh 0.1.0-rc.6` (perfil web); dependencias peer fijadas a `0.1.0-rc.6`. Node `^22.19 || >=24`.
- Última verificación **2026-08-13** en Windows (Node 22) contra `@deepseek-ai/dsh@0.1.0-rc.6`: instalación desde cero del tarball, escaneo real (40 proyectos / 2387 sesiones), importación real por lotes 13/13 con reimportación idempotente 13/13, vínculo al espacio de trabajo y artefactos de persistencia confirmados. macOS/Linux pendientes.
- Verificado **2026-08-14** contra el checkout actual de `deepseek-harness` (perfil web, backend de sesiones JSONL+zstd, registro de espacios de trabajo real) en un home aislado: arranque web completo con el plugin montado, escaneo + importación total por las rutas del panel, creación de espacios de trabajo por `cwd` con sesiones vinculadas, anexo incremental a una sesión importada existente (seq contiguo, carga limpia), reimportación segura tras reinicio y sesiones DSH preexistentes intactas durante todo el proceso. Ninguna sesión se archiva, borra o reescribe jamás.

## 🔐 Permisos y datos

- **Lee** `~/.claude` (transcripciones, memorias, habilidades, CLAUDE.md, settings.json) — estrictamente solo lectura — y los directorios de proyecto a los que importa (vínculo al espacio de trabajo).
- **Escribe** los registros de sesión de DSH mediante el servicio público `sessionPersistence` — solo create + append, nunca borra, reescribe ni archiva sesiones existentes — registros del registro de espacios de trabajo, y su propia caché bajo `$DSH_HOME/claude-move/` (marcadores de escaneo + mapa de importación).
- **Nunca** modifica los archivos fuente de Claude, toca datos de otras aplicaciones ni accede a la red.
- **Ninguna credencial** se lee ni transmite; los posibles secretos en las transcripciones se informan solo por posición.

## 🛡 Límites de seguridad

- Los archivos fuente son estrictamente de solo lectura; los registros de sesión de DSH son append-only (solo `create` + `append`).
- Las transcripciones externas son entrada no confiable: nada de ellas se ejecuta; el contenido system/developer/thinking nunca entra en el resumen de traspaso.
- Sin cambios al motor de DSH, paquetes oficiales de UI ni apiproxy — solo servicios públicos (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`).
- Los posibles secretos se informan solo por ubicación (nunca su contenido); los registros `permission`/`permission-mode`/`queue-operation` se cuentan, no se importan.

## 🩺 Solución de problemas

- Fila sin efecto: `dsh --profile <p> --dump-config` debe imprimir `# == dsh-claude-move`; vuelve a ejecutar `dsh plugin --profile <p> add -w ...`.
- La web arranca pero se cuelga en silencio: los perfiles nuevos que inicializa `dsh plugin add` solo contienen `dsh-base` — añade `@deepseek-ai/dsh-web-app` a `dsh.profile.bundles`. Instalar en el perfil `web` existente no necesita nada.
- Rutas del panel 404: solo se sirven cuando `enableWebPanel: true` y hay un servidor web compuesto; revisa el registro de arranque por fibras FAILED.
- La importación falla con "transcript 过大": sube `maxTranscriptBytes` o importa ese archivo individualmente.
- La importación tuvo éxito pero la barra lateral no muestra la sesión nueva: la página ya estaba abierta — pulsa «Refrescar lista de sesiones» del panel (o recarga la página) una vez. Nunca hace falta reiniciar DSH.
- Registros: los fallos de arranque se imprimen en la consola de `dsh`; el plugin registra errores con el prefijo `[claude-move]` para problemas de espacios de trabajo/mapa de importación.

## 📚 Documentación

- [PLAN.md](PLAN.md) — conclusiones de investigación y plan de implementación.
- [ARCHITECTURE.md](ARCHITECTURE.md) — diagrama de arquitectura y tabla completa de mapeo de datos.
- [COMPLIANCE.md](COMPLIANCE.md) — auditoría cláusula por cláusula frente a las restricciones oficiales de plugins (repo y docs de deepseek-harness, [deepseek.com/harness](https://www.deepseek.com/harness/), la [documentación de desarrollo](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis) y el [paper de Cordis](https://github.com/cordiverse/paper)).
- [OPTIMIZATION.md](OPTIMIZATION.md) — líneas base medidas y candidatos de optimización ordenados.
- [RELEASE.md](RELEASE.md) — lista de verificación de release con evidencia de aceptación.
- [CHANGELOG.md](CHANGELOG.md) — qué cambió en cada versión.

## 🙏 Atribución (componentes open source)

Este proyecto está licenciado bajo la Apache License 2.0; los siguientes componentes bajo MIT conservan sus propias licencias (texto completo en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- Núcleo de conversión vendored de [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT).
- Convenciones de descubrimiento y modelo de seguridad de [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; su `session_reader.py` tiene un origen Apache-2.0 — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Patrones de inyección de memory/skills y análisis de frontmatter de [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT).

## 🧑‍💻 Desarrollo

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + extendido), discovery, import/report, context, settings
```

CI ejecuta la suite completa en Node 22 vía GitHub Actions ([test.yml](.github/workflows/test.yml)).

## 🧠 Model Experience

- La superficie visible al modelo son las descripciones/esquemas de las dos herramientas y sus salidas: `claude_scan` devuelve el índice estructurado, `import_claude` devuelve resúmenes por archivo con posiciones de avisos. Los resultados de las herramientas son a su vez eventos `tool/result` registrados, así que todo es reconstruible.
- No hay texto oculto visible al modelo; las secciones memory/CLAUDE.md están registradas en `ctx.systemPrompt` (ensamblado del prompt, reconstruible desde el registro de sesión).

## ⚠️ Limitaciones conocidas

- Los títulos vienen de `custom-title`/`ai-title`/primer prompt; los registros `summary` de Claude no se usan como títulos.
- Los bloques `thinking` se conservan en el registro importado como contenido `reasoning`, pero nunca entran en el resumen de traspaso.
- Los registros de permisos se cuentan, no se importan; las sugerencias de presets de permisos de DSH se generan en los informes.
- Las transcripciones mayores que `maxTranscriptBytes` fallan en voz alta en vez de importarse parcialmente (fidelidad primero); la importación por streaming en fragmentos está en la hoja de ruta.
- Las sesiones cuyo directorio de origen se eliminó aún se importan, pero el vínculo al espacio de trabajo falla (quedan sin agrupar; `workspace.attached: false` más un `reason` en el informe).
- Las importaciones por lotes interrumpidas pueden reejecutarse con seguridad (idempotente, append-only): los archivos terminados se omiten y los que crecieron solo añaden los turnos nuevos.
- Si una transcripción fue truncada o reiniciada en su lugar (menos turnos que la importación registrada), la reimportación la omite e informa `sourceShrunk`; usa `force: true` para una copia completa nueva.
- El panel web es un panel flotante sin build impulsado por las rutas JSON propias del plugin; no usa el sistema interno de slots de UI del shell (se mantiene independiente de los internals no documentados de rc.6).

## 🤝 Contribuir y dar feedback

Issues y pull requests son bienvenidos — usa las plantillas provistas ([reporte de bug](.github/ISSUE_TEMPLATE/bug-report.yml), [solicitud de función](.github/ISSUE_TEMPLATE/feature-request.yml)). Las preguntas y discusiones viven en las GitHub Discussions del repo. Reporta problemas de seguridad de forma privada mediante GitHub Security Advisories (repo Settings → Security).

## 🔗 Enlaces relacionados

- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [sitio](https://www.deepseek.com/harness/) · [documentación de desarrollo](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- Ecosistema de plugins: [topic `dsh`](https://github.com/topics/dsh) · [topic `dsh-plugin`](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## 📄 Licencia

Apache License 2.0 — ver [LICENSE](LICENSE) y [NOTICE](NOTICE). Avisos de terceros (incluido el texto MIT de los componentes MIT) en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
