// Elige los desafíos de una partida: los 10 del plan (dificultad creciente, orden según la semilla)
// y, si hay muerte súbita, desafíos extra. Los dos jugadores reciben siempre lo mismo.
import { buildMatchPlan, createRng, seedFromString, type Challenge } from '@merge-conflict/shared';
import type { ChallengeSource } from './engine';

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i] as T;
    const b = copy[j] as T;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

export function makeChallengeSource(pool: readonly Challenge[], seed: string): ChallengeSource {
  const plan = buildMatchPlan(pool, seed);
  const used = new Set(plan.map((c) => c.id));
  const unused = shuffled(pool.filter((c) => !used.has(c.id)), seedFromString(`${seed}:extra`));
  // Si el catálogo no tiene sobrantes, la muerte súbita repite los desafíos difíciles del plan.
  const extras = unused.length > 0 ? unused : plan.filter((c) => c.difficulty === 'hard');
  const fallback = extras.length > 0 ? extras : plan;

  return {
    forRound(roundNumber: number): Challenge {
      const fromPlan = plan[roundNumber - 1];
      if (fromPlan) return fromPlan;
      const extra = fallback[(roundNumber - plan.length - 1) % fallback.length];
      if (!extra) throw new Error('No hay desafíos disponibles');
      return extra;
    },
  };
}
