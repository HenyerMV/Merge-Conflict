import type { SubmissionVerdict, TestCase, ValidationResult } from './types';

/** Resultado crudo de ejecutar el código del jugador con UN test (lo produce el runner). */
export interface RawRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  oomKilled: boolean;
  durationMs: number;
  sandboxFailed?: boolean; // falló el propio sandbox, no el código del jugador
}

export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

type FailureVerdict = Exclude<SubmissionVerdict, 'correct' | 'wrong_output'>;

/** Devuelve el veredicto de fallo de ejecución, o null si el programa terminó bien. */
export function classifyRun(run: RawRun): FailureVerdict | null {
  if (run.sandboxFailed) return 'sandbox_error';
  if (run.timedOut) return 'time_limit';
  if (run.oomKilled) return 'memory_limit';
  if (run.exitCode === 0) return null;
  if (run.exitCode === null) return 'sandbox_error';
  if (/(SyntaxError|IndentationError|TabError)/.test(run.stderr)) return 'syntax_error';
  if (/MemoryError/.test(run.stderr)) return 'memory_limit';
  return 'runtime_error';
}

function lastErrorLine(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, 200);
}

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const FIXED_MESSAGES: Record<'time_limit' | 'memory_limit' | 'sandbox_error', string> = {
  time_limit: 'Tu código tardó demasiado.',
  memory_limit: 'Tu código usó demasiada memoria.',
  sandbox_error: 'Error interno al ejecutar tu código. Intenta de nuevo.',
};

/**
 * Decide el veredicto final. `runs[i]` corresponde a `tests[i]`; el runner puede
 * detenerse en el primer fallo, por lo que `runs` puede ser más corto que `tests`.
 * El mensaje nunca revela entradas ni salidas esperadas de tests ocultos.
 */
export function judgeRuns(tests: readonly TestCase[], runs: readonly RawRun[]): ValidationResult {
  const total = tests.length;
  const executionMs = runs.reduce((sum, r) => sum + r.durationMs, 0);
  let passed = 0;

  for (let i = 0; i < runs.length; i++) {
    const test = tests[i];
    const run = runs[i];
    if (!test || !run) {
      return { verdict: 'sandbox_error', passed, total, executionMs, message: FIXED_MESSAGES.sandbox_error };
    }
    const failure = classifyRun(run);

    if (failure) {
      let message: string | undefined;
      if (failure === 'syntax_error' || failure === 'runtime_error') {
        message = lastErrorLine(run.stderr) || undefined;
      } else {
        message = FIXED_MESSAGES[failure];
      }
      return { verdict: failure, passed, total, executionMs, message };
    }

    if (normalizeOutput(run.stdout) === normalizeOutput(test.expected)) {
      passed++;
      continue;
    }

    const message = test.hidden
      ? `Falló un test oculto (${passed} de ${total} pasaron).`
      : `Falló un test visible. Esperado: ${clip(test.expected)} | Obtenido: ${clip(normalizeOutput(run.stdout))}`;
    return { verdict: 'wrong_output', passed, total, executionMs, message };
  }

  if (runs.length < total) {
    return { verdict: 'sandbox_error', passed, total, executionMs, message: FIXED_MESSAGES.sandbox_error };
  }
  return { verdict: 'correct', passed, total, executionMs };
}
