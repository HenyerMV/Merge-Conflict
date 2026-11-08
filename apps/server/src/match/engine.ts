// Motor de partida 1v1: la fuente de verdad del servidor.
// Recibe SOLICITUDES de los clientes (ClientMsg), decide con las reglas de @merge-conflict/shared
// y emite mensajes oficiales (ServerMsg). No hace I/O propio: el juez (ejecutor), el envío de
// mensajes y el reloj de espera llegan por opciones, así que se prueba sin red.
import {
  DEFAULT_CONFIG,
  afterFailedAttempt,
  awardRound,
  canTransition,
  leader,
  orderSubmissions,
  toPublicChallenge,
  type Challenge,
  type ClientMsg,
  type MatchConfig,
  type MatchStatus,
  type PlayerRef,
  type RoundEndReason,
  type Score,
  type ServerMsg,
  type Submission,
  type ValidationResult,
} from '@merge-conflict/shared';

/** Califica un envío. Recibe el id del desafío (el servidor conoce sus tests completos). */
export type Judge = (challengeId: string, code: string) => Promise<ValidationResult>;

export interface ChallengeSource {
  /** Desafío de la ronda (1-based). Ambos jugadores reciben siempre el mismo. */
  forRound(roundNumber: number): Challenge;
}

export interface MatchResult {
  matchId: string;
  winnerId: string | null; // null = empate
  score: Score;
  endedBy: 'normal' | 'abandoned';
  roundsPlayed: number; // rondas completadas
  totalMs: number;
}

export interface MatchEngineOptions {
  matchId: string;
  players: [PlayerRef, PlayerRef];
  source: ChallengeSource;
  judge: Judge;
  send: (to: string, msg: ServerMsg) => void;
  onFinished: (result: MatchResult) => void;
  config?: Partial<MatchConfig>;
  /** Pausa entre rondas. */
  betweenRoundsMs?: number;
  /** Rondas extra de muerte súbita antes de declarar empate. */
  maxTiebreakRounds?: number;
  /** Espera máxima por el ejecutor una vez vencido el tiempo de la ronda. */
  judgeWaitMs?: number;
}

export const MAX_CODE_LENGTH = 20_000;

type Timer = ReturnType<typeof setTimeout>;

interface TrackedSubmission extends Submission {
  result?: ValidationResult;
}

interface Round {
  id: string;
  number: number;
  challenge: Challenge;
  startedAt: number;
  deadlineAt: number;
  startMsg: Extract<ServerMsg, { t: 'round.start' }>;
  subs: TrackedSubmission[];
  failed: Map<string, number>; // intentos fallidos por jugador (los errores del ejecutor no cuentan)
  ended: boolean;
  deadlineHit: boolean;
  deadlineTimer: Timer | null;
  waitTimer: Timer | null;
}

const EXECUTOR_FAILURE: ValidationResult = {
  verdict: 'sandbox_error',
  passed: 0,
  total: 0,
  executionMs: 0,
  message: 'Error interno del ejecutor. Tu intento no se descontó.',
};

export class MatchEngine {
  private readonly cfg: MatchConfig;
  private readonly ids: [string, string];
  private readonly betweenRoundsMs: number;
  private readonly maxTiebreakRounds: number;
  private readonly judgeWaitMs: number;
  private readonly createdAt = Date.now();

  private status: MatchStatus = 'WAITING';
  private score: Score;
  private roundsPlayed = 0;
  private finished = false;
  private seq = 0;
  private round: Round | null = null;
  private lastRoundEnd: Extract<ServerMsg, { t: 'round.end' }> | null = null;
  private readonly ready = new Set<string>();
  /** Jugadores desconectados ahora. Valor null = la gracia ya venció. */
  private readonly disconnected = new Map<string, Timer | null>();
  /** Abandono que no se puede aplicar en el estado actual (pausa entre rondas). */
  private pendingAbandon: { leaver: string; deliberate: boolean } | null = null;
  private nextRoundTimer: Timer | null = null;

  constructor(private readonly opts: MatchEngineOptions) {
    this.cfg = { ...DEFAULT_CONFIG, ...opts.config };
    this.ids = [opts.players[0].id, opts.players[1].id];
    this.betweenRoundsMs = opts.betweenRoundsMs ?? 3_000;
    this.maxTiebreakRounds = opts.maxTiebreakRounds ?? 3;
    this.judgeWaitMs = opts.judgeWaitMs ?? 30_000;
    this.score = { [this.ids[0]]: 0, [this.ids[1]]: 0 };

    this.transition('MATCH_FOUND');
    for (const p of opts.players) {
      const opponent = opts.players[0].id === p.id ? opts.players[1] : opts.players[0];
      this.send(p.id, { t: 'match.found', matchId: opts.matchId, opponent, config: this.cfg });
    }
  }

  // ---------- consulta ----------
  get currentStatus(): MatchStatus { return this.status; }
  get currentScore(): Score { return { ...this.score }; }
  get isFinished(): boolean { return this.finished; }

  // ---------- entrada ----------
  handle(playerId: string, msg: ClientMsg): void {
    if (!this.ids.includes(playerId)) {
      this.error(playerId, 'NOT_IN_MATCH', 'No perteneces a esta partida.');
      return;
    }
    switch (msg.t) {
      case 'ping':
        this.send(playerId, { t: 'pong', clientTime: msg.clientTime, serverNow: Date.now() });
        return;
      case 'match.ready':
        this.onReady(playerId, msg.matchId);
        return;
      case 'code.submit':
        this.onSubmit(playerId, msg);
        return;
      case 'match.leave':
        this.onLeave(playerId, msg.matchId);
        return;
      default:
        this.error(playerId, 'BAD_STATE', 'Mensaje no válido durante una partida.');
    }
  }

  /** La conexión del jugador cayó: empieza la gracia de reconexión. */
  disconnect(playerId: string): void {
    if (this.finished || !this.ids.includes(playerId) || this.disconnected.has(playerId)) return;
    const timer = setTimeout(() => this.onGraceExpired(playerId), this.cfg.reconnectGraceMs);
    this.disconnected.set(playerId, timer);
    this.send(this.otherOf(playerId), { t: 'opponent.disconnected', graceMs: this.cfg.reconnectGraceMs });
  }

  /** El jugador volvió dentro de la gracia: se le reenvía el estado actual. */
  reconnect(playerId: string): void {
    if (this.finished || !this.disconnected.has(playerId)) return;
    const timer = this.disconnected.get(playerId);
    if (timer === null) return; // la gracia ya venció: el abandono es firme
    if (timer) clearTimeout(timer);
    this.disconnected.delete(playerId);
    this.send(this.otherOf(playerId), { t: 'opponent.reconnected' });
    this.resync(playerId);
  }

  /** Libera timers (p. ej. si el servidor cierra la partida por fuera). */
  dispose(): void {
    this.clearAllTimers();
  }

  // ---------- manejadores ----------
  private onReady(playerId: string, matchId: string): void {
    if (matchId !== this.opts.matchId) return this.error(playerId, 'NOT_IN_MATCH', 'Partida desconocida.');
    if (this.status !== 'MATCH_FOUND') return this.error(playerId, 'BAD_STATE', 'La partida ya empezó.');
    this.ready.add(playerId);
    if (this.ready.size === 2) {
      this.transition('READY');
      this.startRound();
    }
  }

  private onLeave(playerId: string, matchId: string): void {
    if (matchId !== this.opts.matchId) return this.error(playerId, 'NOT_IN_MATCH', 'Partida desconocida.');
    if (this.finished) return;
    this.requestAbandon(playerId, true);
  }

  private onSubmit(playerId: string, msg: Extract<ClientMsg, { t: 'code.submit' }>): void {
    if (msg.matchId !== this.opts.matchId) return this.error(playerId, 'NOT_IN_MATCH', 'Partida desconocida.');
    const round = this.round;
    const open = this.status === 'CODING' || this.status === 'VALIDATING';
    if (this.finished || !round || round.ended || !open) {
      return this.error(playerId, 'BAD_STATE', 'No hay una ronda abierta para enviar código.');
    }
    if (msg.roundId !== round.id) return this.error(playerId, 'BAD_STATE', 'Esa ronda no está activa.');
    if (round.deadlineHit) return this.error(playerId, 'BAD_STATE', 'El tiempo de la ronda terminó.');
    if (msg.code.length === 0 || msg.code.length > MAX_CODE_LENGTH) {
      return this.error(playerId, 'BAD_STATE', `El código debe tener entre 1 y ${MAX_CODE_LENGTH} caracteres.`);
    }
    if (this.hasPending(round, playerId)) {
      return this.error(playerId, 'RATE_LIMITED', 'Espera el resultado de tu envío anterior.');
    }
    if (round.subs.some((s) => s.playerId === playerId && s.result?.verdict === 'correct')) {
      return this.error(playerId, 'BAD_STATE', 'Ya resolviste esta ronda.');
    }

    const attempt = (round.failed.get(playerId) ?? 0) + 1;
    const sub: TrackedSubmission = {
      roundId: round.id,
      playerId,
      attempt,
      code: msg.code,
      serverReceivedAt: Date.now(),
      seq: ++this.seq,
    };
    round.subs.push(sub);
    if (this.status === 'CODING') {
      this.transition('SUBMISSION');
      this.transition('VALIDATING');
    }
    this.send(playerId, { t: 'submission.validating', attempt });
    this.runJudge(round, sub);
  }

  // ---------- juez ----------
  private runJudge(round: Round, sub: TrackedSubmission): void {
    let pending: Promise<ValidationResult>;
    try {
      pending = this.opts.judge(round.challenge.id, sub.code);
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      (result) => this.onVerdict(round, sub, result),
      () => this.onVerdict(round, sub, EXECUTOR_FAILURE), // caída del ejecutor: no gasta intentos
    );
  }

  private onVerdict(round: Round, sub: TrackedSubmission, result: ValidationResult): void {
    // Resultado tardío (ronda cerrada o partida terminada): se descarta.
    if (this.finished || round.ended || this.round !== round) return;
    sub.result = result;

    const used = round.failed.get(sub.playerId) ?? 0;
    let attemptsLeft: number;
    if (result.verdict === 'correct' || result.verdict === 'sandbox_error') {
      attemptsLeft = this.cfg.maxAttemptsPerRound - used;
    } else {
      attemptsLeft = afterFailedAttempt(used, this.cfg).attemptsLeft;
      round.failed.set(sub.playerId, used + 1);
    }
    const msg: Extract<ServerMsg, { t: 'submission.result' }> = {
      t: 'submission.result',
      attempt: sub.attempt,
      verdict: result.verdict,
      passed: result.passed,
      total: result.total,
      attemptsLeft,
    };
    if (result.message !== undefined) msg.message = result.message;
    this.send(sub.playerId, msg);

    this.evaluate(round);
    if (!round.ended && this.status === 'VALIDATING' && !this.anyPending(round)) {
      this.transition('CODING');
    }
  }

  /** Decide si la ronda ya tiene desenlace con la información disponible. */
  private evaluate(round: Round): void {
    if (round.ended) return;
    // 1) Gana el envío correcto más temprano; si uno anterior sigue en calificación, hay que esperarlo.
    for (const s of orderSubmissions(round.subs)) {
      if (!s.result) break;
      if (s.result.verdict === 'correct') return this.endRound(round, s.playerId, 'solved');
    }
    // 2) Tres intentos fallidos: pierde la ronda.
    for (const id of this.ids) {
      if ((round.failed.get(id) ?? 0) >= this.cfg.maxAttemptsPerRound) {
        return this.endRound(round, this.otherOf(id), 'three_errors');
      }
    }
    // 3) Tiempo agotado y nada pendiente.
    if (round.deadlineHit && !this.anyPending(round)) this.endRound(round, null, 'timeout');
  }

  // ---------- rondas ----------
  private startRound(): void {
    this.transition('ROUND_START');
    if (this.pendingAbandon) {
      const { leaver, deliberate } = this.pendingAbandon;
      this.pendingAbandon = null;
      this.abandon(this.abandonWinner(leaver, deliberate));
      return;
    }

    const number = this.roundsPlayed + 1;
    const challenge = this.opts.source.forRound(number);
    const startedAt = Date.now();
    const deadlineAt = startedAt + this.cfg.roundTimeLimitMs;
    const round: Round = {
      id: `${this.opts.matchId}-r${number}`,
      number,
      challenge,
      startedAt,
      deadlineAt,
      startMsg: {
        t: 'round.start',
        roundId: `${this.opts.matchId}-r${number}`,
        number,
        challenge: toPublicChallenge(challenge),
        serverStartAt: startedAt,
        deadlineAt,
      },
      subs: [],
      failed: new Map(),
      ended: false,
      deadlineHit: false,
      deadlineTimer: null,
      waitTimer: null,
    };
    this.round = round;
    round.deadlineTimer = setTimeout(() => this.onDeadline(round), this.cfg.roundTimeLimitMs);
    this.broadcast(round.startMsg);
    this.transition('CODING');
  }

  private onDeadline(round: Round): void {
    if (round.ended || this.finished) return;
    round.deadlineHit = true;
    this.evaluate(round);
    // Un envío recibido a tiempo sigue contando, pero con espera máxima por el ejecutor.
    if (!round.ended) {
      round.waitTimer = setTimeout(() => this.endRound(round, null, 'timeout'), this.judgeWaitMs);
    }
  }

  private endRound(round: Round, winnerId: string | null, reason: RoundEndReason): void {
    if (round.ended) return;
    round.ended = true;
    this.clearRoundTimers(round);
    this.transition('ROUND_RESULT');
    if (winnerId) this.score = awardRound(this.score, winnerId);
    this.roundsPlayed++;

    const end: Extract<ServerMsg, { t: 'round.end' }> = {
      t: 'round.end',
      roundId: round.id,
      winnerId,
      reason,
      durationMs: Date.now() - round.startedAt,
      score: { ...this.score },
    };
    this.lastRoundEnd = end;
    this.broadcast(end);

    const outcome = this.decide(winnerId);
    if (outcome.over) {
      this.finishNormal(outcome.winnerId);
      return;
    }
    this.transition('NEXT_ROUND');
    this.nextRoundTimer = setTimeout(() => {
      this.nextRoundTimer = null;
      if (!this.finished) this.startRound();
    }, this.betweenRoundsMs);
  }

  /** Fin de partida tras una ronda: 6 puntos, o resolución tras las 10 rondas (muerte súbita / empate). */
  private decide(lastWinner: string | null): { over: false } | { over: true; winnerId: string | null } {
    const w = leader(this.score, this.cfg);
    if (w) return { over: true, winnerId: w };
    if (this.roundsPlayed < this.cfg.totalRounds) return { over: false };

    const [a, b] = this.ids;
    const sa = this.score[a] ?? 0;
    const sb = this.score[b] ?? 0;
    if (this.roundsPlayed === this.cfg.totalRounds) {
      if (sa !== sb) return { over: true, winnerId: sa > sb ? a : b }; // p. ej. rondas sin ganador
      if (this.cfg.tiebreak === 'draw') return { over: true, winnerId: null };
      return { over: false }; // muerte súbita
    }
    // Muerte súbita: gana quien suma el siguiente punto.
    if (lastWinner) return { over: true, winnerId: lastWinner };
    if (this.roundsPlayed - this.cfg.totalRounds >= this.maxTiebreakRounds) return { over: true, winnerId: null };
    return { over: false };
  }

  // ---------- fin de partida ----------
  private finishNormal(winnerId: string | null): void {
    this.transition('MATCH_RESULT');
    this.broadcast({ t: 'match.end', winnerId, score: { ...this.score }, totalMs: Date.now() - this.createdAt });
    this.transition('RETURN_TO_LOBBY');
    this.finalize(winnerId, 'normal');
  }

  private abandon(winnerId: string | null): void {
    if (this.finished) return;
    this.clearAllTimers();
    this.transition('ABANDONED');
    this.broadcast({ t: 'match.end', winnerId, score: { ...this.score }, totalMs: Date.now() - this.createdAt });
    this.transition('RETURN_TO_LOBBY');
    this.finalize(winnerId, 'abandoned');
  }

  private finalize(winnerId: string | null, endedBy: MatchResult['endedBy']): void {
    this.finished = true;
    this.clearAllTimers();
    this.opts.onFinished({
      matchId: this.opts.matchId,
      winnerId,
      score: { ...this.score },
      endedBy,
      roundsPlayed: this.roundsPlayed,
      totalMs: Date.now() - this.createdAt,
    });
  }

  // ---------- abandono / desconexión ----------
  private onGraceExpired(playerId: string): void {
    if (this.finished) return;
    this.disconnected.set(playerId, null);
    this.requestAbandon(playerId, false);
  }

  /** Aplica el abandono ya, o lo deja pendiente si la máquina de estados no lo permite (pausa entre rondas). */
  private requestAbandon(leaver: string, deliberate: boolean): void {
    if (canTransition(this.status, 'ABANDONED')) {
      this.abandon(this.abandonWinner(leaver, deliberate));
    } else if (!this.pendingAbandon) {
      this.pendingAbandon = { leaver, deliberate };
    }
  }

  /** Irse a propósito da la victoria al rival; si la gracia vence con ambos caídos, es empate. */
  private abandonWinner(leaver: string, deliberate: boolean): string | null {
    const other = this.otherOf(leaver);
    if (!deliberate && this.disconnected.has(other)) return null;
    return other;
  }

  private resync(playerId: string): void {
    const now = Date.now();
    this.send(playerId, { t: 'state', status: this.status, serverNow: now });
    if (this.status === 'MATCH_FOUND') {
      const opponent = this.opts.players.find((p) => p.id !== playerId);
      if (opponent) this.send(playerId, { t: 'match.found', matchId: this.opts.matchId, opponent, config: this.cfg });
      return;
    }
    const round = this.round;
    if (round && !round.ended && (this.status === 'CODING' || this.status === 'VALIDATING')) {
      this.send(playerId, round.startMsg);
      const mine = round.subs.find((s) => s.playerId === playerId && !s.result);
      if (mine) this.send(playerId, { t: 'submission.validating', attempt: mine.attempt });
    } else if (this.lastRoundEnd) {
      this.send(playerId, this.lastRoundEnd);
    }
  }

  // ---------- utilidades ----------
  private hasPending(round: Round, playerId: string): boolean {
    return round.subs.some((s) => s.playerId === playerId && !s.result);
  }

  private anyPending(round: Round): boolean {
    return round.subs.some((s) => !s.result);
  }

  private otherOf(id: string): string {
    return id === this.ids[0] ? this.ids[1] : this.ids[0];
  }

  private transition(to: MatchStatus): void {
    if (!canTransition(this.status, to)) {
      throw new Error(`Transición inválida: ${this.status} -> ${to}`);
    }
    this.status = to;
    this.broadcast({ t: 'state', status: to, serverNow: Date.now() });
  }

  private clearRoundTimers(round: Round): void {
    if (round.deadlineTimer) clearTimeout(round.deadlineTimer);
    if (round.waitTimer) clearTimeout(round.waitTimer);
    round.deadlineTimer = null;
    round.waitTimer = null;
  }

  private clearAllTimers(): void {
    if (this.round) this.clearRoundTimers(this.round);
    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    this.nextRoundTimer = null;
    for (const t of this.disconnected.values()) if (t) clearTimeout(t);
  }

  private send(to: string, msg: ServerMsg): void {
    this.opts.send(to, msg);
  }

  private broadcast(msg: ServerMsg): void {
    for (const id of this.ids) this.send(id, msg);
  }

  private error(to: string, code: Extract<ServerMsg, { t: 'error' }>['code'], message: string): void {
    this.send(to, { t: 'error', code, message });
  }
}
