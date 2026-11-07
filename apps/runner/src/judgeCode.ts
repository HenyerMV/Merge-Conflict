// Califica un envío: corre el código contra TODOS los tests (visibles + ocultos) del desafío.
import {
  classifyRun,
  judgeRuns,
  normalizeOutput,
  type RawRun,
  type ValidationResult,
} from '@merge-conflict/shared';
import { FULL_CATALOG } from '@merge-conflict/shared/src/challenges/catalog.server';
import { runPython } from './docker';

export class UnknownChallengeError extends Error {}

const MAX_CONCURRENT = Math.max(1, Number(process.env.RUNNER_MAX_CONCURRENT ?? 2));
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // el cupo pasa directo al siguiente en la cola
  else active--;
}

export async function judgeSubmission(challengeId: string, code: string): Promise<ValidationResult> {
  const challenge = FULL_CATALOG.find((c) => c.id === challengeId);
  if (!challenge) throw new UnknownChallengeError(challengeId);

  await acquire();
  try {
    const runs: RawRun[] = [];
    for (const test of challenge.tests) {
      const run = await runPython(code, test.input, {
        timeLimitMs: challenge.timeLimitMs,
        memoryLimitMb: challenge.memoryLimitMb,
      });
      runs.push(run);
      // Se detiene en el primer fallo; judgeRuns lo contempla (runs puede ser más corto que tests).
      if (classifyRun(run) !== null) break;
      if (normalizeOutput(run.stdout) !== normalizeOutput(test.expected)) break;
    }
    return judgeRuns(challenge.tests, runs);
  } finally {
    release();
  }
}
