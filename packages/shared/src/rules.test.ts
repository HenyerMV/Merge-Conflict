import { describe, expect, it } from 'vitest';
import type { PlayerStats } from './types';
import { DEFAULT_CONFIG as C, afterFailedAttempt, applyMatchResult, awardRound, canTransition, matchOutcome, orderSubmissions, pointsForPosition } from './rules';

describe('puntuación y fin de partida', () => {
  it('gana el primero en llegar a 6', () => {
    let s: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 6; i++) s = awardRound(s, 'A');
    expect(matchOutcome({ ...s, B: 3 }, 9, C)).toEqual({ over: true, winnerId: 'A' });
  });
  it('termina antes de la ronda 10 si ya hay 6', () => {
    expect(matchOutcome({ A: 6, B: 2 }, 8, C)).toEqual({ over: true, winnerId: 'A' });
  });
  it('5-5 tras 10 rondas => desempate de muerte súbita', () => {
    expect(matchOutcome({ A: 5, B: 5 }, 10, C)).toEqual({ over: false, tiebreak: true });
  });
  it('desempate configurable a empate', () => {
    expect(matchOutcome({ A: 5, B: 5 }, 10, { ...C, tiebreak: 'draw' })).toEqual({ over: true, winnerId: null });
  });
  it('sigue la partida si quedan rondas', () => {
    expect(matchOutcome({ A: 3, B: 2 }, 5, C)).toEqual({ over: false, tiebreak: false });
  });
});

describe('tres errores', () => {
  it('el tercer fallo pierde la ronda', () => {
    expect(afterFailedAttempt(0, C)).toEqual({ attemptsLeft: 2, roundLost: false });
    expect(afterFailedAttempt(1, C)).toEqual({ attemptsLeft: 1, roundLost: false });
    expect(afterFailedAttempt(2, C)).toEqual({ attemptsLeft: 0, roundLost: true });
  });
});

describe('orden de envíos', () => {
  it('desempata por timestamp y luego por seq', () => {
    const r = orderSubmissions([{ id: 'b', serverReceivedAt: 100, seq: 2 }, { id: 'a', serverReceivedAt: 100, seq: 1 }, { id: 'c', serverReceivedAt: 99, seq: 9 }]);
    expect(r.map(x => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('estadísticas', () => {
  const base: PlayerStats = { wins: 0, currentWinStreak: 0, bestWinStreak: 0, fastestWinSeconds: null };
  it('racha 1-2-3-4 y reinicio con la mejor intacta', () => {
    let s = base;
    for (let i = 0; i < 4; i++) s = applyMatchResult(s, true, 200);
    expect(s.currentWinStreak).toBe(4);
    s = applyMatchResult(s, false);
    expect(s).toMatchObject({ currentWinStreak: 0, bestWinStreak: 4, wins: 4 });
  });
  it('victoria más rápida solo mejora', () => {
    let s = applyMatchResult(base, true, 167);
    s = applyMatchResult(s, true, 151);
    s = applyMatchResult(s, true, 300);
    expect(s.fastestWinSeconds).toBe(151);
  });
});

describe('máquina de estados y Battle Royale', () => {
  it('transiciones válidas e inválidas', () => {
    expect(canTransition('CODING', 'SUBMISSION')).toBe(true);
    expect(canTransition('WAITING', 'CODING')).toBe(false);
  });
  it('puntos 3/2/1/0', () => {
    expect([1, 2, 3, 4].map(p => pointsForPosition(p as 1 | 2 | 3 | 4))).toEqual([3, 2, 1, 0]);
  });
});
