import { describe, it, expect } from 'vitest';
import { judgeRuns, classifyRun, normalizeOutput, type RawRun } from './judge';
import type { TestCase } from './types';

const ok = (stdout: string): RawRun => ({
  exitCode: 0, stdout, stderr: '', timedOut: false, oomKilled: false, durationMs: 10,
});
const tests: TestCase[] = [
  { id: 't1', input: '1', expected: '2', hidden: false },
  { id: 't2', input: '5', expected: '10', hidden: true },
];

describe('normalizeOutput', () => {
  it('ignora saltos finales, \\r\\n y espacios al final de línea', () => {
    expect(normalizeOutput('a  \r\nb\n\n')).toBe('a\nb');
  });
});

describe('classifyRun', () => {
  it('detecta cada tipo de fallo', () => {
    const base = ok('');
    expect(classifyRun({ ...base, timedOut: true, exitCode: null })).toBe('time_limit');
    expect(classifyRun({ ...base, oomKilled: true, exitCode: 137 })).toBe('memory_limit');
    expect(classifyRun({ ...base, exitCode: 1, stderr: 'SyntaxError: invalid syntax' })).toBe('syntax_error');
    expect(classifyRun({ ...base, exitCode: 1, stderr: 'ZeroDivisionError: x' })).toBe('runtime_error');
    expect(classifyRun({ ...base, sandboxFailed: true, exitCode: null })).toBe('sandbox_error');
    expect(classifyRun(base)).toBeNull();
  });
});

describe('judgeRuns', () => {
  it('correct si todos pasan', () => {
    const r = judgeRuns(tests, [ok('2\n'), ok('10')]);
    expect(r).toMatchObject({ verdict: 'correct', passed: 2, total: 2 });
  });
  it('wrong_output en test visible muestra esperado y obtenido', () => {
    const r = judgeRuns(tests, [ok('3')]);
    expect(r.verdict).toBe('wrong_output');
    expect(r.message).toContain('Esperado: 2');
  });
  it('wrong_output en test oculto NO revela la salida esperada', () => {
    const r = judgeRuns(tests, [ok('2'), ok('99')]);
    expect(r.verdict).toBe('wrong_output');
    expect(r.passed).toBe(1);
    expect(r.message).not.toContain('10');
    expect(r.message).toContain('oculto');
  });
  it('runtime_error muestra solo la última línea del error', () => {
    const run: RawRun = {
      ...ok(''), exitCode: 1,
      stderr: 'Traceback (most recent call last):\n  File "x.py", line 1\nValueError: boom\n',
    };
    expect(judgeRuns(tests, [run]).message).toBe('ValueError: boom');
  });
  it('sandbox_error si el runner no completó los tests y nadie falló', () => {
    expect(judgeRuns(tests, [ok('2')]).verdict).toBe('sandbox_error');
  });
});
