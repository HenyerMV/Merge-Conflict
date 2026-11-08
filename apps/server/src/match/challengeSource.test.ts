import { describe, expect, it } from 'vitest';
import { FULL_CATALOG } from '@merge-conflict/shared/src/challenges/catalog.server';
import { makeChallengeSource } from './challengeSource';

describe('makeChallengeSource', () => {
  it('con la misma semilla entrega siempre los mismos desafíos, en dificultad creciente', () => {
    const rank = { easy: 0, medium: 1, hard: 2 };
    const a = makeChallengeSource(FULL_CATALOG, 'partida-1');
    const b = makeChallengeSource(FULL_CATALOG, 'partida-1');
    const ids = Array.from({ length: 10 }, (_, i) => a.forRound(i + 1).id);
    expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => b.forRound(i + 1).id));
    expect(new Set(ids).size).toBe(10);
    for (let n = 2; n <= 10; n++) {
      expect(rank[a.forRound(n).difficulty]).toBeGreaterThanOrEqual(rank[a.forRound(n - 1).difficulty]);
    }
  });

  it('la muerte súbita siempre devuelve un desafío (repite difíciles si no hay sobrantes)', () => {
    const s = makeChallengeSource(FULL_CATALOG, 'x');
    for (let n = 11; n <= 20; n++) expect(s.forRound(n).difficulty).toBe('hard');
  });
});
