// Protocolo cliente <-> servidor (tiempo real). Los mensajes del cliente son SOLICITUDES;
// los del servidor son la verdad oficial.
import type { MatchConfig, MatchStatus, PlayerRef, PublicChallenge, RoundEndReason, SubmissionVerdict } from './types';

export type ClientMsg =
  | { t: 'queue.join'; mode: 'duel_1v1'; language: 'python' }
  | { t: 'queue.leave' }
  | { t: 'match.ready'; matchId: string }
  | { t: 'code.submit'; matchId: string; roundId: string; code: string } // sin puntos, sin tiempos, sin ganador
  | { t: 'match.leave'; matchId: string }
  | { t: 'ping'; clientTime: number };

export type ServerMsg =
  | { t: 'queue.waiting' }
  | { t: 'match.found'; matchId: string; opponent: PlayerRef; config: MatchConfig }
  | { t: 'round.start'; roundId: string; number: number; challenge: PublicChallenge; serverStartAt: number; deadlineAt: number }
  | { t: 'submission.validating'; attempt: number }
  | { t: 'submission.result'; attempt: number; verdict: SubmissionVerdict; passed: number; total: number; attemptsLeft: number; message?: string }
  | { t: 'round.end'; roundId: string; winnerId: string | null; reason: RoundEndReason; durationMs: number; score: Record<string, number> }
  | { t: 'match.end'; winnerId: string | null; score: Record<string, number>; totalMs: number }
  | { t: 'opponent.disconnected'; graceMs: number }
  | { t: 'opponent.reconnected' }
  | { t: 'state'; status: MatchStatus; serverNow: number }
  | { t: 'error'; code: 'NOT_IN_MATCH' | 'BAD_STATE' | 'RATE_LIMITED' | 'SERVER_ERROR'; message: string }
  | { t: 'pong'; clientTime: number; serverNow: number };
