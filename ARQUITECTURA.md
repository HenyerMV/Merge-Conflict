# MERGE CONFLICT — Arquitectura (Fase 1)

> Principio rector: **el cliente presenta, el servidor decide.**

## Nota de referencia
La estructura de bucle (input → update → render → UI), escenas y scripts secuenciales se estudió como *inspiración conceptual* en
«BYTE: ARCHITECT QUEST — Ecos de la Máquina», de **Aslin Gonzalo Botello Plata**. No se copió código, personajes, textos ni assets;
la implementación e identidad visual de Merge Conflict son originales.

## Decisiones técnicas
| Tema | Decisión | Por qué |
|---|---|---|
| Lenguaje | TypeScript en monorepo (`packages/shared`, `apps/web`, `apps/server`, `apps/runner`) | Contratos y reglas compartidos, sin duplicar lógica |
| Cliente | Vite + TypeScript + Canvas/DOM, escenas (`BootScene`…`ResultScene`) + `dialogueManager` | Modular, PWA sencilla en Vercel |
| Editor | CodeMirror 6 (Python) | Ligero, funciona en móvil |
| Tiempo real | Servidor Node con WebSocket (proceso persistente: Fly.io/Railway) | Vercel serverless no mantiene sockets; el cliente se despliega en Vercel |
| Datos/Auth | Supabase (Postgres, Auth Google, Storage) + RLS | Lo pedido; stats solo escritas por el servidor con service key |
| Ejecutor | Servicio **aislado** (`apps/runner`): contenedor sin red, usuario sin privilegios, CPU/RAM/tiempo/PIDs limitados, FS de solo lectura | Nunca ejecutar código de usuario en el servidor principal |
| Validación | `ast.parse` → ejecución con límites → tests deterministas → veredicto | Sin IA |

## Estructura
```
packages/shared   tipos, protocolo WS, reglas puras + tests   <- esta fase
apps/web          escenas, editor, perfil, PWA                 (Fases 2-4, 9)
apps/server       matchmaking, máquina de estados, autoridad   (Fases 5, 7, 8)
apps/runner       sandbox Python                               (Fase 6)
supabase/         migraciones SQL + políticas RLS              (Fase 4)
```

## Máquina de estados de partida
`WAITING → MATCH_FOUND → READY → ROUND_START → CODING ⇄ SUBMISSION → VALIDATING → ROUND_RESULT → NEXT_ROUND → … → MATCH_RESULT → RETURN_TO_LOBBY`
(`ABANDONED` desde cualquier estado activo). Implementada como tabla en `rules.ts` (`canTransition`).

## Reglas (en `rules.ts`, probadas)
- 10 rondas, gana el primero en llegar a 6; la partida termina en cuanto alguien lo logra.
- 3 intentos por ronda; el 3.er fallo pierde la ronda y da el punto al rival.
- 5-5 tras 10 rondas: muerte súbita (configurable a empate).
- Empate de envíos: menor `serverReceivedAt`, luego menor `seq`. Nunca se usa el reloj del navegador.
- Desconexión: gracia de 15 s; si no vuelve, `ABANDONED` y el rival gana por abandono **sin** contar para «victoria más rápida».
- Battle Royale (futuro): 3/2/1/0 puntos por posición.

## Modelo de datos (Fase 4)
`profiles, matches, match_players, rounds, submissions, achievements, player_achievements, challenges`.
- `submissions.code`: guardar solo el código ganador y el último fallido (menos coste); retención 30 días.
- RLS: el usuario lee lo suyo y edita solo `username, bio, avatar_url`. `wins, streaks, fastest_win_seconds` y logros: sin permiso de escritura desde el cliente.

## Seguridad
- `PublicChallenge` nunca incluye tests ocultos.
- El cliente solo envía `code.submit`; puntos, tiempos y ganador salen del servidor.
- Invitados: `isGuest = true`, sin escritura en `profiles` ni estadísticas.

## Plan por fases
1. Arquitectura + contratos (hecho) · 2. UI/navegación · 3. Tutorial + avatar · 4. Auth/Supabase · 5. Desafíos · 6. Ejecutor Python · 7. Partida 1v1 · 8. Stats/hitos · 9. PWA · 10. Testing/seguridad/despliegue.
