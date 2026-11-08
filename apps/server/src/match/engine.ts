// Motor de partida 1v1 (autoridad del servidor). NO usa red: recibe mensajes del cliente y emite
// mensajes del servidor mediante `send`. El cliente solo pide; el motor decide puntos, tiempos y ganador.
import {
  DEFAULT_CONFIG,
  afterFailedAttempt,
  awardRound,
  canTransition,
  matchOutcome,
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
  type ValidationResult,
} from '@merge-conflict/shared';

/** Califica un envío (en producción llama al runner). Puede rechazar la promesa: cuenta como sandbox_error. */
export type Judge = (challengeId: string, code: string) => Promise<ValidationResult>;

export interface ChallengeSource {
  forRound(roundNumber: number): Challenge;
}

export interface MatchResult {
  matchId: string;
  winnerId: string | null;
  score: Score;
  totalMs: number;
  endedBy: 'normal' | 'abandoned';
  roundsPlayed: number;
}

export interface MatchEngineOptions {
  matchId: string;
  players: readonly [PlayerRef, PlayerRef];
  source: ChallengeSource;
  judge: Judge;
  send: (playerId: string, msg: ServerMsg) => void;
  onFinished?: (result: MatchResult) => void;
  config?: Partial<MatchConfig>;
  betweenRoundsMs?: number; // pausa entre rondas (por defecto 4000)
  pendingGraceMs?: number; // espera máxima por envíos en validación al vencer la ronda (por defecto 30000)
  maxTiebreakRounds?: number; // rondas extra de muerte súbita antes de declarar empate (por defecto 5)
  maxCodeChars?: number; // por defecto 20000
}

type ErrorCode = Extract<ServerMsg, { t: 'error' }>['code'];
type Timer = ReturnType<typeof setTimeout>;

interface PlayerState {
  ref: PlayerRef;
  ready: boolean;
  connected: boolean;
  attemptsUsed: number;
  validating: boolean;
}

interface Sub {
  seq: number;
  serverReceivedAt: number;
  playerId: string;
  done: boolean;
  correct: boolean;
}

interface RoundState {
  id: string;
  number: number;
  challenge: Challenge;
  startedAt: number;
  deadlineAt: number;
  subs: Sub[];
  deadlinePassed: boolean;
  ended: boolean;
}

const err = (code: ErrorCode, message: string): ServerMsg => ({ t: 'error', code, message });

export class MatchEngine {
  private status: MatchStatus = 'WAITING';
  private readonly cfg: MatchConfig;
  private readonly players = new Map<string, PlayerState>();
  private score: Score = {};
  private roundsPlayed = 0;
  private round: RoundState | null = null;
  private seq = 0;
  private startedAt = 0;
  private finished = false;
  private forfeitedBy: string | null = null;
  private roundTimer: Timer | null = null;
  private nextRoundTimer: Timer | null = null;
  private readonly graceTimers = new Map<string, Timer>();
  private readonly betweenRoundsMs: number;
  private readonly pendingGraceMs: number;
  private readonly maxTiebreakRounds: number;
  private readonly maxCodeChars: number;

  constructor(private readonly opts: MatchEngineOptions) {
    this.cfg = { ...DEFAULT_CONFIG, ...opts.config };
    this.betweenRoundsMs = opts.betweenRoundsMs ?? 4000;
    this.pendingGraceMs = opts.pendingGraceMs ?? 30_000;
    this.maxTiebreakRounds = opts.maxTiebreakRounds ?? 5;
    this.maxCodeChars = opts.maxCodeChars ?? 20_000;

    const [a, b] = opts.players;
    if (a.id === b.id) throw new Error('Los dos jugadores deben ser distintos');
    for (const ref of [a, b]) {
      this.players.set(ref.id, { ref, ready: false, connected: true, attemptsUsed: 0, validating: false });
      this.score[ref.id] = 0;
    }
    this.emit(a.id, { t: 'match.found', matchId: opts.matchId, opponent: b, config: this.cfg });
    this.emit(b.id, { t: 'match.found', matchId: opts.matchId, opponent: a, config: this.cfg });
    this.go('MATCH_FOUND');
  }

  get currentStatus(): MatchStatus {
    return this.status;
  }
  get currentScore(): Score {
    return { ...this.score };
  }
  get isFinished(): boolean {
    return this.finished;
  }

  /** Mensaje de un jugador. Todo lo que no sea una solicitud válida se rechaza con un error. */
  handle(playerId: string, msg: ClientMsg): void {
    const p = this.players.get(playerId);
    if (!p) return this.emit(playerId, err('NOT_IN_MATCH', 'No perteneces a esta partida'));
    if (this.finished) return this.emit(playerId, err('BAD_STATE', 'La partida ya terminó'));

    switch (msg.t) {
      case 'ping':
        return this.emit(playerId, { t: 'pong', clientTime: msg.clientTime, serverNow: Date.now() });

      case 'match.ready': {
        if (msg.matchId !== this.opts.matchId) return this.emit(playerId, err('NOT_IN_MATCH', 'Partida incorrecta'));
        if (this.status !== 'MATCH_FOUND') return this.emit(playerId, err('BAD_STATE', 'La partida ya empezó'));
        p.ready = true;
        if ([...this.players.values()].every((x) => x.ready)) {
          this.go('READY');
          this.startRound();
        }
        return;
      }

      case 'code.submit':
        return this.submit(p, msg);

      case 'match.leave': {
        if (msg.matchId !== this.opts.matchId) return this.emit(playerId, err('NOT_IN_MATCH', 'Partida incorrecta'));
        p.connected = false;
        return this.abandon();
      }

      default:
        return this.emit(playerId, err('BAD_STATE', 'Mensaje no válido durante una partida'));
    }
  }

  /** El socket del jugador se cayó: empieza la gracia de reconexión. */
  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || this.finished || !p.connected) return;
    p.connected = false;
    const other = this.other(playerId);
    this.emit(other.ref.id, { t: 'opponent.disconnected', graceMs: this.cfg.reconnectGraceMs });
    this.graceTimers.set(
      playerId,
      setTimeout(() => this.onGraceExpired(playerId), this.cfg.reconnectGraceMs),
    );
  }

  /** El jugador volvió dentro de la gracia: se le reenvía el estado actual. */
  reconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || this.finished || p.connected || this.forfeitedBy === playerId) return;
    p.connected = true;
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
    this.emit(this.other(playerId).ref.id, { t: 'opponent.reconnected' });
    this.emit(playerId, { t: 'state', status: this.status, serverNow: Date.now() });
    const r = this.round;
    if (r && !r.ended) this.emit(playerId, this.roundStartMsg(r));
  }

  /** Libera temporizadores (cierre del servidor). */
  dispose(): void {
    this.finished = true;
    this.clearTimers();
  }

  // ---------- internos ----------

  private other(playerId: string): PlayerState {
    for (const p of this.players.values()) if (p.ref.id !== playerId) return p;
    throw new Error('Jugador rival no encontrado');
  }

  private emit(playerId: string, msg: ServerMsg): void {
    this.opts.send(playerId, msg);
  }

  private broadcast(msg: ServerMsg): void {
    for (const id of this.players.keys()) this.emit(id, msg);
  }

  private go(to: MatchStatus): void {
    if (!canTransition(this.status, to)) throw new Error(`Transición inválida: ${this.status} -> ${to}`);
    this.status = to;
    this.broadcast({ t: 'state', status: to, serverNow: Date.now() });
  }

  private clearTimers(): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.roundTimer = null;
    this.nextRoundTimer = null;
    this.graceTimers.clear();
  }

  private roundStartMsg(r: RoundState): ServerMsg {
    return {
      t: 'round.start',
      roundId: r.id,
      number: r.number,
      challenge: toPublicChallenge(r.challenge), // nunca viajan los tests ocultos
      serverStartAt: r.startedAt,
      deadlineAt: r.deadlineAt,
    };
  }

  private startRound(): void {
    this.go('ROUND_START');
    if (this.forfeitedBy) return this.abandon(); // alguien abandonó durante la pausa entre rondas

    const number = this.roundsPlayed + 1;
    const now = Date.now();
    if (number === 1) this.startedAt = now;
    const round: RoundState = {
      id: `${this.opts.matchId}-r${number}`,
      number,
      challenge: this.opts.source.forRound(number),
      startedAt: now,
      deadlineAt: now + this.cfg.roundTimeLimitMs,
      subs: [],
      deadlinePassed: false,
      ended: false,
    };
    this.round = round;
    for (const p of this.players.values()) {
      p.attemptsUsed = 0;
      p.validating = false;
    }
    this.broadcast(this.roundStartMsg(round));
    this.go('CODING');
    this.roundTimer = setTimeout(() => this.onDeadline(), this.cfg.roundTimeLimitMs);
  }

  private submit(p: PlayerState, msg: Extract<ClientMsg, { t: 'code.submit' }>): void {
    const id = p.ref.id;
    const round = this.round;
    if (msg.matchId !== this.opts.matchId) return this.emit(id, err('NOT_IN_MATCH', 'Partida incorrecta'));
    if (this.status !== 'CODING' || !round || round.ended) return this.emit(id, err('BAD_STATE', 'No hay una ronda activa'));
    if (msg.roundId !== round.id) return this.emit(id, err('BAD_STATE', 'Ronda incorrecta'));
    if (typeof msg.code !== 'string' || msg.code.length === 0 || msg.code.length > this.maxCodeChars) {
      return this.emit(id, err('BAD_STATE', 'Código vacío o demasiado largo'));
    }
    if (round.deadlinePassed || Date.now() >= round.deadlineAt) return this.emit(id, err('BAD_STATE', 'Se acabó el tiempo de la ronda'));
    if (p.validating) return this.emit(id, err('RATE_LIMITED', 'Espera el resultado de tu envío anterior'));
    if (p.attemptsUsed >= this.cfg.maxAttemptsPerRound) return this.emit(id, err('BAD_STATE', 'No te quedan intentos'));

    const sub: Sub = { seq: ++this.seq, serverReceivedAt: Date.now(), playerId: id, done: false, correct: false };
    round.subs.push(sub);
    p.validating = true;
    this.emit(id, { t: 'submission.validating', attempt: p.attemptsUsed + 1 });
    void this.grade(round, p, sub, msg.code);
  }

  private async grade(round: RoundState, p: PlayerState, sub: Sub, code: string): Promise<void> {
    let result: ValidationResult;
    try {
      result = await this.opts.judge(round.challenge.id, code);
    } catch {
      result = {
        verdict: 'sandbox_error',
        passed: 0,
        total: round.challenge.tests.length,
        executionMs: 0,
        message: 'Error interno al ejecutar tu código. Intenta de nuevo.',
      };
    }
    if (this.finished || round.ended) return; // la ronda terminó mientras se calificaba: se descarta

    p.validating = false;
    sub.done = true;
    const attempt = p.attemptsUsed + 1;
    const msg = (attemptsLeft: number): ServerMsg => ({
      t: 'submission.result',
      attempt,
      verdict: result.verdict,
      passed: result.passed,
      total: result.total,
      attemptsLeft,
      ...(result.message ? { message: result.message } : {}),
    });

    if (result.verdict === 'correct') {
      sub.correct = true;
      this.emit(p.ref.id, msg(this.cfg.maxAttemptsPerRound - p.attemptsUsed));
      return this.resolve(round);
    }
    if (result.verdict === 'sandbox_error') {
      // Falla nuestra, no del jugador: no gasta intento.
      this.emit(p.ref.id, msg(this.cfg.maxAttemptsPerRound - p.attemptsUsed));
      return this.resolve(round);
    }
    const after = afterFailedAttempt(p.attemptsUsed, this.cfg);
    p.attemptsUsed++;
    this.emit(p.ref.id, msg(after.attemptsLeft));
    if (after.roundLost) return this.endRound(round, this.other(p.ref.id).ref.id, 'three_errors');
    this.resolve(round);
  }

  /** Decide si la ronda ya tiene ganador. Gana el envío correcto MÁS TEMPRANO (por hora del servidor y seq),
   *  pero solo cuando todos los envíos anteriores a él ya fueron calificados. */
  private resolve(round: RoundState): void {
    if (round.ended) return;
    for (const s of orderSubmissions(round.subs)) {
      if (!s.done) return; // hay un envío anterior en validación: se espera su veredicto
      if (s.correct) return this.endRound(round, s.playerId, 'solved');
    }
    if (round.deadlinePassed) this.endRound(round, null, 'timeout');
  }

  private onDeadline(): void {
    const round = this.round;
    if (!round || round.ended || this.finished) return;
    round.deadlinePassed = true;
    this.resolve(round);
    if (!round.ended) {
      // Quedan envíos en validación: se espera un poco; si el ejecutor no responde, nadie gana la ronda.
      this.roundTimer = setTimeout(() => {
        if (!round.ended && !this.finished) this.endRound(round, null, 'timeout');
      }, this.pendingGraceMs);
    }
  }

  private endRound(round: RoundState, winnerId: string | null, reason: RoundEndReason): void {
    round.ended = true;
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = null;
    this.roundsPlayed++;
    if (winnerId) this.score = awardRound(this.score, winnerId);
    this.go('ROUND_RESULT');
    this.broadcast({
      t: 'round.end',
      roundId: round.id,
      winnerId,
      reason,
      durationMs: Date.now() - round.startedAt,
      score: { ...this.score },
    });

    const outcome = matchOutcome(this.score, this.roundsPlayed, this.cfg);
    if (outcome.over) return this.finish(outcome.winnerId);
    if (outcome.tiebreak && this.roundsPlayed - this.cfg.totalRounds >= this.maxTiebreakRounds) return this.finish(null);

    this.go('NEXT_ROUND');
    this.nextRoundTimer = setTimeout(() => this.startRound(), this.betweenRoundsMs);
  }

  private finish(winnerId: string | null): void {
    this.go('MATCH_RESULT');
    const totalMs = Date.now() - this.startedAt;
    this.finished = true;
    this.clearTimers();
    this.broadcast({ t: 'match.end', winnerId, score: { ...this.score }, totalMs });
    this.opts.onFinished?.({
      matchId: this.opts.matchId,
      winnerId,
      score: { ...this.score },
      totalMs,
      endedBy: 'normal',
      roundsPlayed: this.roundsPlayed,
    });
    this.go('RETURN_TO_LOBBY');
  }

  private onGraceExpired(playerId: string): void {
    this.graceTimers.delete(playerId);
    const p = this.players.get(playerId);
    if (!p || this.finished || p.connected) return;
    if (canTransition(this.status, 'ABANDONED')) return this.abandon();
    this.forfeitedBy = playerId; // pausa entre rondas: se aplica al empezar la siguiente
  }

  /** Termina por abandono: gana quien siga conectado; si ambos se fueron, empate. */
  private abandon(): void {
    if (this.finished) return;
    const connected = [...this.players.values()].filter((p) => p.connected);
    const winnerId = connected.length === 1 && connected[0] ? connected[0].ref.id : null;
    this.go('ABANDONED');
    const totalMs = this.startedAt > 0 ? Date.now() - this.startedAt : 0;
    this.finished = true;
    this.clearTimers();
    this.broadcast({ t: 'match.end', winnerId, score: { ...this.score }, totalMs });
    this.opts.onFinished?.({
      matchId: this.opts.matchId,
      winnerId,
      score: { ...this.score },
      totalMs,
      endedBy: 'abandoned',
      roundsPlayed: this.roundsPlayed,
    });
    this.go('RETURN_TO_LOBBY');
  }
}
