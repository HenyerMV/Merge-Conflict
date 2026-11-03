# MERGE CONFLICT

Videojuego web competitivo de programación en tiempo real: dos jugadores resuelven el mismo desafío corto de Python y gana quien envíe primero una solución correcta.

> Principio rector: **el cliente presenta, el servidor decide.**

## Estado
- Fase 1: contratos y reglas puras (`packages/shared`) con tests.
- Fase 2: interfaz y navegación (`apps/web`).
- Fase 3: tutorial con avatar guía y demo.
- Fase 4: cuentas, perfiles y Supabase (`supabase/migrations`).

Arquitectura completa en [ARQUITECTURA.md](ARQUITECTURA.md).

## Ejecutar en local
```
npm install
npm test
npm run typecheck
npm run typecheck:web
npm run dev:web
```

## Variables de entorno
Copia `apps/web/.env.example` como `apps/web/.env.local` y rellena:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (clave *anon public*; nunca la `service_role`)

## Base de datos
Ejecuta `supabase/migrations/0001_profiles.sql` en el SQL Editor de Supabase.
