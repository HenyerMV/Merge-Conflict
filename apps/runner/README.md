# apps/runner — ejecutor de código Python (Fase 6)

Califica un envío ejecutando el código del jugador en un contenedor Docker desechable
(`python:3.12-slim`): sin red, disco de solo lectura, memoria/CPU/procesos limitados, sin privilegios.

## Uso local (Windows, cmd)

    docker pull python:3.12-slim
    npm install
    npm run smoke:runner                      # prueba el sandbox con 8 casos (buenos y maliciosos)
    set RUNNER_TOKEN=un-secreto-largo
    npm run runner                            # http://127.0.0.1:8787

## API (solo la llama el servidor de partidas, nunca el navegador)

    POST /judge   header x-runner-token: <RUNNER_TOKEN>
                  { "challengeId": "suma-pares", "code": "..." }
                  -> { verdict, passed, total, executionMs, message? }
    GET  /health  -> { ok: true }

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| RUNNER_TOKEN | (obligatoria) | secreto compartido con el servidor de partidas |
| RUNNER_HOST / PORT | 127.0.0.1 / 8787 | dónde escucha |
| RUNNER_IMAGE | python:3.12-slim | imagen del sandbox |
| RUNNER_MAX_CONCURRENT | 2 | envíos calificándose a la vez |
| RUNNER_STARTUP_MS | (se mide solo) | arranque del contenedor; no cuenta contra el tiempo del jugador |
| RUNNER_DEBUG | (vacío) | si tiene valor, imprime cada corrida (exit, ms, último error) |
