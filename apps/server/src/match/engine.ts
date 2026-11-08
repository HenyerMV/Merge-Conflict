import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canTransition, type Challenge, type PlayerRef, type ServerMsg, type ValidationResult } from '@merge-conflict/shared';
import { MatchEngine, type Judge, type MatchEngineOptions, type MatchResult } from './engine';

const A: PlayerRef = { id: 'A', isGuest: false, displayName: 'Ana' };
const B: PlayerRef = { id: 'B', isGuest: false, displayName: 'Beto' };

function mkChallenge(id: string): Challenge {
  return {
    id, language: 'python', difficulty: 'easy', title: id, description: 'd', starterCode: '',
    tests: [
      { id: `${id}-v1`, input: '1', expected: '2', hidden: false },
      { id: `${id}-h1`, input: 'SECRET-INPUT', expected: 'SECRET-OUTPUT', hidden: true },
    ],
    constraints: [], timeLimitMs: 2000, memoryLimitMb: 128,
  };
}

const ok: ValidationResult = { verdict: 'correct', passed: 2, total: 2, executionMs: 5 };
const wrong: ValidationResult = { verdict: 'wrong_output', passed: 0, total: 2, executionMs: 5, message: 'Falló un test visible.' };
const sbx: ValidationResult = { verdict: 'sandbox_error', passed: 0, total: 2, executionMs: 0, message: 'Error interno.' };

// Códigos de prueba: OK / BAD / SBX responden al instante, BOOM rechaza, cualquier otro queda "en espera" hasta release().
function makeJudge() {
  const held = new Map<string, (r: ValidationResult) => void>();
  const judge: Judge = (_id, code) => {
    if (code === 'OK') return Promise.resolve(ok);
    if (code === 'BAD') return Promise.resolve(wrong);
    if (code === 'SBX') return Promise.resolve(sbx);
    if (code === 'BOOM') return Promise.reject(new Error('runner caído'));
    return new Promise<ValidationResult>((resolve) => held.set(code, resolve));
  };
  return { judge, release: (code: string, r: ValidationResult) => held.get(code)?.(r) };
}

type Sent = { to: string; msg: ServerMsg };

function setup(over: Partial<MatchEngineOptions> = {}) {
  const sent: Sent[] = [];
  const finished: MatchResult[] = [];
  const j = makeJudge();
  const engine = new MatchEngine({
    matchId: 'm1',
    players: [A, B],
    source: { forRound: (n) => mkChallenge(`c${n}`) },
    judge: j.judge,
    send: (to, msg) => sent.push({ to, msg }),
    onFinished: (r) => finished.push(r),
    betweenRoundsMs: 1000,
    ...over,
  });
  const msgs = <T extends ServerMsg['t']>(to: string, t: T) =>
    sent.filter((s) => s.to === to && s.msg.t === t).map((s) => s.msg as Extract<ServerMsg, { t: T }>);
  const roundId = () => {
    const starts = msgs('A', 'round.start');
    const last = starts[starts.length - 1];
    if (!last) throw new Error('no hay round.start');
    return last.roundId;
  };
  return {
    engine, sent, finished, release: j.release, msgs, roundId,
    start: () => {
      engine.handle('A', { t: 'match.ready', matchId: 'm1' });
      engine.handle('B', { t: 'match.ready', matchId: 'm1' });
    },
    submit: (who: string, code: string) => engine.handle(who, { t: 'code.submit', matchId: 'm1', roundId: roundId(), code }),
    errors: (to: string) => msgs(to, 'error').map((e) => e.code),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('inicio de partida', () => {
  it('anuncia la partida y arranca la ronda 1 cuando ambos están listos', () => {
    const t = setup();
    expect(t.msgs('A', 'match.found')[0]?.opponent.id).toBe('B');
    expect(t.msgs('B', 'match.found')[0]?.opponent.id).toBe('A');
    t.engine.handle('A', { t: 'match.ready', matchId: 'm1' });
    expect(t.msgs('A', 'round.start')).toHaveLength(0);
    t.engine.handle('B', { t: 'match.ready', matchId: 'm1' });
    expect(t.engine.currentStatus).toBe('CODING');
    const r = t.msgs('A', 'round.start')[0]!;
    expect(r.number).toBe(1);
    expect(r.deadlineAt - r.serverStartAt).toBe(180_000);
    expect(t.msgs('B', 'round.start')[0]?.challenge.id).toBe('c1');
  });

  it('nunca envía tests ocultos al cliente', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'OK');
    await flush();
    const all = JSON.stringify(t.sent);
    expect(all).not.toContain('SECRET-INPUT');
    expect(all).not.toContain('SECRET-OUTPUT');
    expect(all).not.toContain('-h1');
  });

  it('todos los cambios de estado respetan la máquina de estados', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'OK');
    await flush();
    await advance(1000);
    t.engine.handle('B', { t: 'match.leave', matchId: 'm1' });
    const states = t.msgs('A', 'state').map((s) => s.status);
    let prev: (typeof states)[number] = 'WAITING';
    for (const s of states) {
      expect(canTransition(prev, s), `${prev} -> ${s}`).toBe(true);
      prev = s;
    }
    expect(states[states.length - 1]).toBe('RETURN_TO_LOBBY');
  });
});

describe('rondas', () => {
  it('el primer envío correcto gana la ronda y suma 1 punto', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'OK');
    expect(t.msgs('A', 'submission.validating')[0]?.attempt).toBe(1);
    await flush();
    expect(t.msgs('A', 'submission.result')[0]).toMatchObject({ verdict: 'correct', attemptsLeft: 3 });
    const end = t.msgs('B', 'round.end')[0]!;
    expect(end).toMatchObject({ winnerId: 'A', reason: 'solved', score: { A: 1, B: 0 } });
    await advance(1000);
    expect(t.msgs('A', 'round.start')[1]?.number).toBe(2);
  });

  it('tres intentos fallidos pierden la ronda y el rival suma el punto', async () => {
    const t = setup();
    t.start();
    for (let i = 0; i < 3; i++) {
      t.submit('A', 'BAD');
      await flush();
    }
    expect(t.msgs('A', 'submission.result').map((r) => r.attemptsLeft)).toEqual([2, 1, 0]);
    expect(t.msgs('A', 'round.end')[0]).toMatchObject({ winnerId: 'B', reason: 'three_errors', score: { A: 0, B: 1 } });
  });

  it('un error del ejecutor (sandbox_error o caída) no gasta intentos', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'SBX');
    await flush();
    t.submit('A', 'BOOM');
    await flush();
    t.submit('A', 'BAD');
    await flush();
    const r = t.msgs('A', 'submission.result');
    expect(r.map((x) => x.verdict)).toEqual(['sandbox_error', 'sandbox_error', 'wrong_output']);
    expect(r.map((x) => x.attemptsLeft)).toEqual([3, 3, 2]);
    expect(t.msgs('A', 'round.end')).toHaveLength(0);
  });

  it('si ambos aciertan, gana el envío más temprano aunque se califique después', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'HOLD:A');
    await advance(5);
    t.submit('B', 'HOLD:B');
    t.release('HOLD:B', ok);
    await flush();
    expect(t.msgs('A', 'round.end')).toHaveLength(0); // falta el veredicto de A, que envió antes
    t.release('HOLD:A', ok);
    await flush();
    expect(t.msgs('A', 'round.end')[0]).toMatchObject({ winnerId: 'A', reason: 'solved' });
  });

  it('si el envío más temprano falla, gana el siguiente que acertó', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'HOLD:A');
    await advance(5);
    t.submit('B', 'HOLD:B');
    t.release('HOLD:B', ok);
    await flush();
    t.release('HOLD:A', wrong);
    await flush();
    expect(t.msgs('A', 'round.end')[0]).toMatchObject({ winnerId: 'B', reason: 'solved' });
  });

  it('no permite un segundo envío mientras el anterior se califica', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'HOLD:A');
    t.submit('A', 'OK');
    expect(t.errors('A')).toEqual(['RATE_LIMITED']);
    t.release('HOLD:A', wrong);
    await flush();
    t.submit('A', 'BAD');
    expect(t.errors('A')).toEqual(['RATE_LIMITED']); // el segundo envío válido no genera error
  });

  it('sin envíos, la ronda termina por tiempo sin ganador', async () => {
    const t = setup();
    t.start();
    await advance(180_000);
    expect(t.msgs('A', 'round.end')[0]).toMatchObject({ winnerId: null, reason: 'timeout', score: { A: 0, B: 0 } });
    await advance(1000);
    expect(t.msgs('A', 'round.start')[1]?.number).toBe(2);
  });

  it('un envío que llegó a tiempo pero se califica después del límite sigue contando', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'HOLD:A');
    await advance(180_000);
    expect(t.msgs('A', 'round.end')).toHaveLength(0);
    t.release('HOLD:A', ok);
    await flush();
    expect(t.msgs('A', 'round.end')[0]).toMatchObject({ winnerId: 'A', reason: 'solved' });
  });

  it('si el ejecutor no responde, la ronda termina sin ganador tras la espera máxima', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'HOLD:A');
    await advance(180_000 + 30_000);
    expect(t.msgs('A', 'round.end')[0]).toMatchObject({ winnerId: null, reason: 'timeout' });
    t.release('HOLD:A', ok); // llega tarde: se descarta
    await flush();
    expect(t.msgs('A', 'round.end')).toHaveLength(1);
    expect(t.msgs('A', 'submission.result')).toHaveLength(0);
  });
});

describe('fin de partida', () => {
  async function winRound(t: ReturnType<typeof setup>, who: string) {
    t.submit(who, 'OK');
    await flush();
    await advance(1000);
  }

  it('termina en cuanto alguien llega a 6 puntos', async () => {
    const t = setup();
    t.start();
    for (let i = 0; i < 6; i++) await winRound(t, 'A');
    expect(t.msgs('B', 'match.end')[0]).toMatchObject({ winnerId: 'A', score: { A: 6, B: 0 } });
    expect(t.finished[0]).toMatchObject({ winnerId: 'A', endedBy: 'normal', roundsPlayed: 6 });
    expect(t.engine.isFinished).toBe(true);
    expect(t.msgs('A', 'round.start')).toHaveLength(6); // no hay ronda 7
  });

  it('5-5 tras 10 rondas va a muerte súbita y la gana quien suma el siguiente punto', async () => {
    const t = setup();
    t.start();
    for (let i = 1; i <= 10; i++) await winRound(t, i % 2 === 1 ? 'A' : 'B');
    expect(t.engine.currentScore).toEqual({ A: 5, B: 5 });
    expect(t.finished).toHaveLength(0);
    expect(t.msgs('A', 'round.start')[10]?.number).toBe(11);
    await winRound(t, 'A');
    expect(t.finished[0]).toMatchObject({ winnerId: 'A', endedBy: 'normal', roundsPlayed: 11 });
  });

  it('si la muerte súbita no se resuelve tras varias rondas, termina en empate', async () => {
    const t = setup({ maxTiebreakRounds: 2 });
    t.start();
    for (let i = 1; i <= 10; i++) await winRound(t, i % 2 === 1 ? 'A' : 'B');
    await advance(180_000); // ronda 11 sin ganador
    await advance(1000);
    await advance(180_000); // ronda 12 sin ganador
    expect(t.finished[0]).toMatchObject({ winnerId: null, endedBy: 'normal', roundsPlayed: 12 });
  });

  it('rechaza envíos cuando la partida terminó', async () => {
    const t = setup();
    t.start();
    for (let i = 0; i < 6; i++) await winRound(t, 'A');
    t.engine.handle('B', { t: 'code.submit', matchId: 'm1', roundId: 'm1-r6', code: 'OK' });
    expect(t.errors('B')).toEqual(['BAD_STATE']);
  });
});

describe('solicitudes inválidas', () => {
  it('rechaza mensajes fuera de lugar', async () => {
    const t = setup();
    // antes de que ambos estén listos
    t.engine.handle('A', { t: 'code.submit', matchId: 'm1', roundId: 'm1-r1', code: 'OK' });
    t.start();
    t.engine.handle('A', { t: 'code.submit', matchId: 'otra', roundId: t.roundId(), code: 'OK' });
    t.engine.handle('A', { t: 'code.submit', matchId: 'm1', roundId: 'm1-r9', code: 'OK' });
    t.engine.handle('A', { t: 'code.submit', matchId: 'm1', roundId: t.roundId(), code: '' });
    t.engine.handle('A', { t: 'code.submit', matchId: 'm1', roundId: t.roundId(), code: 'x'.repeat(20_001) });
    t.engine.handle('A', { t: 'match.ready', matchId: 'm1' }); // la partida ya empezó
    t.engine.handle('A', { t: 'queue.leave' });
    t.engine.handle('Z', { t: 'ping', clientTime: 1 }); // desconocido
    expect(t.errors('A')).toEqual(['BAD_STATE', 'NOT_IN_MATCH', 'BAD_STATE', 'BAD_STATE', 'BAD_STATE', 'BAD_STATE', 'BAD_STATE']);
    expect(t.errors('Z')).toEqual(['NOT_IN_MATCH']);
    expect(t.msgs('A', 'submission.validating')).toHaveLength(0);
  });

  it('no acepta envíos entre rondas', async () => {
    const t = setup();
    t.start();
    t.submit('A', 'OK');
    await flush();
    t.engine.handle('B', { t: 'code.submit', matchId: 'm1', roundId: 'm1-r1', code: 'OK' });
    expect(t.errors('B')).toEqual(['BAD_STATE']);
  });

  it('responde ping con la hora del servidor', () => {
    const t = setup();
    t.engine.handle('A', { t: 'ping', clientTime: 123 });
    expect(t.msgs('A', 'pong')[0]).toEqual({ t: 'pong', clientTime: 123, serverNow: 1_000_000 });
  });
});

describe('desconexión y abandono', () => {
  it('si no vuelve en 15 s pierde por abandono', async () => {
    const t = setup();
    t.start();
    t.engine.disconnect('A');
    expect(t.msgs('B', 'opponent.disconnected')[0]?.graceMs).toBe(15_000);
    await advance(15_000);
    expect(t.msgs('B', 'match.end')[0]?.winnerId).toBe('B');
    expect(t.finished[0]).toMatchObject({ winnerId: 'B', endedBy: 'abandoned' });
  });

  it('si vuelve dentro de la gracia, la partida sigue y recibe el estado actual', async () => {
    const t = setup();
    t.start();
    t.engine.disconnect('A');
    await advance(10_000);
    t.engine.reconnect('A');
    expect(t.msgs('B', 'opponent.reconnected')).toHaveLength(1);
    expect(t.msgs('A', 'round.start')).toHaveLength(2); // el reenvío del estado de la ronda
    await advance(20_000);
    expect(t.finished).toHaveLength(0);
    expect(t.engine.currentStatus).toBe('CODING');
  });

  it('si se desconectan los dos, el resultado es empate', async () => {
    const t = setup();
    t.start();
    t.engine.disconnect('A');
    await advance(5_000);
    t.engine.disconnect('B');
    await advance(10_000);
    expect(t.finished[0]).toMatchObject({ winnerId: null, endedBy: 'abandoned' });
  });

  it('irse a propósito (match.leave) da la victoria al rival', () => {
    const t = setup();
    t.start();
    t.engine.handle('B', { t: 'match.leave', matchId: 'm1' });
    expect(t.finished[0]).toMatchObject({ winnerId: 'A', endedBy: 'abandoned' });
  });

  it('el abandono durante la pausa entre rondas se aplica al empezar la siguiente', async () => {
    const t = setup({ betweenRoundsMs: 20_000 });
    t.start();
    t.submit('A', 'OK');
    await flush();
    t.engine.disconnect('B');
    await advance(15_000); // vence la gracia en plena pausa
    expect(t.finished).toHaveLength(0);
    await advance(5_000);
    expect(t.finished[0]).toMatchObject({ winnerId: 'A', endedBy: 'abandoned', roundsPlayed: 1 });
  });
});
