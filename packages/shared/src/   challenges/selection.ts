import type { Difficulty } from '../types';

export const DEFAULT_QUOTAS: Record<Difficulty, number> = { easy: 4, medium: 4, hard: 2 };
const ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
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

/** Plan de partida: dificultad creciente y orden determinista según la semilla. */
export function buildMatchPlan<T extends { id: string; difficulty: Difficulty }>(
  pool: readonly T[],
  seed: string | number,
  quotas: Record<Difficulty, number> = DEFAULT_QUOTAS,
): T[] {
  const rng = createRng(typeof seed === 'string' ? seedFromString(seed) : seed);
  const plan: T[] = [];
  for (const difficulty of ORDER) {
    const candidates = shuffle(pool.filter((c) => c.difficulty === difficulty), rng);
    if (candidates.length < quotas[difficulty]) {
      throw new Error(`Faltan desafíos "${difficulty}": hay ${candidates.length}, se piden ${quotas[difficulty]}`);
    }
    plan.push(...candidates.slice(0, quotas[difficulty]));
  }
  return plan;
}
