import { describe, it, expect } from 'vitest';
import * as publicApi from './index';
import { PUBLIC_CHALLENGES, buildMatchPlan, toPublicChallenge, DEFAULT_QUOTAS } from './index';
import { FULL_CATALOG } from './catalog.server';

describe('catálogo completo (servidor)', () => {
  it('no repite ids de desafío ni de tests', () => {
    const ids = FULL_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of FULL_CATALOG) {
      const tids = c.tests.map((t) => t.id);
      expect(new Set(tids).size).toBe(tids.length);
    }
  });
  it('cada desafío tiene al menos 2 tests visibles y 2 ocultos', () => {
    for (const c of FULL_CATALOG) {
      expect(c.tests.filter((t) => !t.hidden).length).toBeGreaterThanOrEqual(2);
      expect(c.tests.filter((t) => t.hidden).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('visibilidad', () => {
  it('la versión pública no contiene los tests ocultos', () => {
    for (const c of FULL_CATALOG) {
      const pub = toPublicChallenge(c);
      expect('tests' in pub).toBe(false);
      expect(pub.visibleTests).toHaveLength(c.tests.filter((t) => !t.hidden).length);
    }
    const publicJson = JSON.stringify(PUBLIC_CHALLENGES);
    for (const c of FULL_CATALOG) {
      for (const t of c.tests.filter((x) => x.hidden)) {
        expect(publicJson).not.toContain(t.id);
      }
    }
  });
  it('el índice público no expone el catálogo del servidor', () => {
    expect('FULL_CATALOG' in publicApi).toBe(false);
  });
});

describe('buildMatchPlan', () => {
  it('genera 10 desafíos con las cuotas por dificultad', () => {
    const plan = buildMatchPlan(PUBLIC_CHALLENGES, 'partida-1');
    expect(plan).toHaveLength(10);
    for (const d of ['easy', 'medium', 'hard'] as const) {
      expect(plan.filter((c) => c.difficulty === d)).toHaveLength(DEFAULT_QUOTAS[d]);
    }
  });
  it('es determinista con la misma semilla', () => {
    const a = buildMatchPlan(PUBLIC_CHALLENGES, 'abc').map((c) => c.id);
    const b = buildMatchPlan(PUBLIC_CHALLENGES, 'abc').map((c) => c.id);
    expect(a).toEqual(b);
  });
  it('la dificultad nunca baja durante la partida', () => {
    const rank = { easy: 0, medium: 1, hard: 2 };
    const plan = buildMatchPlan(PUBLIC_CHALLENGES, 'xyz');
    for (let i = 1; i < plan.length; i++) {
      expect(rank[plan[i].difficulty]).toBeGreaterThanOrEqual(rank[plan[i - 1].difficulty]);
    }
  });
  it('falla si faltan desafíos', () => {
    expect(() => buildMatchPlan(PUBLIC_CHALLENGES.slice(0, 3), 's')).toThrow();
  });
});
