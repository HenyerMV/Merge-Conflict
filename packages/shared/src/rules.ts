// Reglas puras y deterministas del juego. Sin I/O: se prueban sin red y las usa SOLO el servidor
// para decidir (el cliente puede importarlas únicamente para mostrar).
import type { MatchConfig, MatchStatus, PlayerStats, Submission } from './types';

export const DEFAULT_CONFIG: MatchConfig = {
  totalRounds: 10,
  pointsToWin: 6,
  maxAttemptsPerRound: 3,
  tiebreak: 'sudden_death',
  reconnectGraceMs: 15_000,
  roundTimeLimitMs: 180_000
};

export type Score = Record<string, number>;

// ---------- máquina de estados de la partida ----------
const TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  WAITING: ['MATCH_FOUND'],
  MATCH_FOUND: ['READY', 'ABANDONED'],
  READY: ['ROUND_START', 'ABANDONED'],
  ROUND_START: ['CODING', 'ABANDONED'],
  CODING: ['SUBMISSION', 'ROUND_RESULT', 'ABANDONED'], // ROUND_RESULT: tiempo agotado o rival cae
  SUBMISSION: ['VALIDATING'],
  VALIDATING: ['CODING', 'ROUND_RESULT', 'ABANDONED'], // CODING: error con intentos restantes
  ROUND_RESULT: ['NEXT_ROUND', 'MATCH_RESULT'],
  NEXT_ROUND: ['ROUND_START'],
  MATCH_RESULT: ['RETURN_TO_LOBBY'],
  RETURN_TO_LOBBY: [],
  ABANDONED: ['RETURN_TO_LOBBY']
};
export const canTransition = (from: MatchStatus, to: MatchStatus): boolean => TRANSITIONS[from].includes(to);

// ---------- puntuación 1v1 ----------
export function awardRound(score: Score, winnerId: string): Score {
  return { ...score, [winnerId]: (score[winnerId] ?? 0) + 1 };
}

export function leader(score: Score, cfg: MatchConfig): string | null {
  const w = Object.entries(score).find(([, p]) => p >= cfg.pointsToWin);
  return w ? w[0] : null;
}

/** Ronda 1-based jugada hasta ahora: determina si toca desempate. */
export function matchOutcome(score: Score, roundsPlayed: number, cfg: MatchConfig):
  | { over: false; tiebreak: boolean }
  | { over: true; winnerId: string | null } {
  const w = leader(score, cfg);
  if (w) return { over: true, winnerId: w };
  if (roundsPlayed < cfg.totalRounds) return { over: false, tiebreak: false };
  // 10 rondas jugadas y nadie llegó a 6 => 5-5
  return cfg.tiebreak === 'sudden_death' ? { over: false, tiebreak: true } : { over: true, winnerId: null };
}

// ---------- intentos ----------
export function afterFailedAttempt(attemptsUsed: number, cfg: MatchConfig): { attemptsLeft: number; roundLost: boolean } {
  const used = attemptsUsed + 1;
  return { attemptsLeft: Math.max(0, cfg.maxAttemptsPerRound - used), roundLost: used >= cfg.maxAttemptsPerRound };
}

// ---------- orden de envíos (empates de milisegundos) ----------
/** Regla determinista: primero el menor timestamp del servidor; si empatan, el menor seq. */
export function orderSubmissions<T extends Pick<Submission, 'serverReceivedAt' | 'seq'>>(subs: T[]): T[] {
  return [...subs].sort((a, b) => a.serverReceivedAt - b.serverReceivedAt || a.seq - b.seq);
}

// ---------- estadísticas ----------
export function applyMatchResult(prev: PlayerStats, won: boolean, winSeconds?: number): PlayerStats {
  if (!won) return { ...prev, currentWinStreak: 0 };
  const streak = prev.currentWinStreak + 1;
  const fastest = winSeconds == null ? prev.fastestWinSeconds
    : prev.fastestWinSeconds == null ? winSeconds : Math.min(prev.fastestWinSeconds, winSeconds);
  return { wins: prev.wins + 1, currentWinStreak: streak, bestWinStreak: Math.max(prev.bestWinStreak, streak), fastestWinSeconds: fastest };
}

// ---------- Battle Royale (futuro, regla exacta) ----------
export const BR_POINTS = [3, 2, 1, 0] as const; // 1.º..4.º
export const pointsForPosition = (position: 1 | 2 | 3 | 4): number => BR_POINTS[position - 1]!;
