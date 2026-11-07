// Prueba de humo del sandbox: corre casos buenos y maliciosos contra el desafío "suma-pares".
//   npm run smoke:runner
import { spawnSync } from 'node:child_process';
import type { SubmissionVerdict } from '@merge-conflict/shared';
import { judgeSubmission } from './judgeCode';

const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('Docker no responde. Abre Docker Desktop, espera a "Engine running" y reintenta.');
  process.exit(1);
}

const READ = 'nums = list(map(int, input().split()))\n';
const cases: Array<{ name: string; code: string; expect: SubmissionVerdict }> = [
  { name: 'solución correcta', code: `${READ}print(sum(n for n in nums if n % 2 == 0))\n`, expect: 'correct' },
  { name: 'respuesta incorrecta', code: `${READ}print(sum(nums))\n`, expect: 'wrong_output' },
  { name: 'error de sintaxis', code: 'print(\n', expect: 'syntax_error' },
  { name: 'error en ejecución', code: `${READ}print(1 / 0)\n`, expect: 'runtime_error' },
  { name: 'bucle infinito', code: 'while True:\n    pass\n', expect: 'time_limit' },
  { name: 'bomba de memoria', code: 'x = bytearray(900 * 1024 * 1024)\nprint(len(x))\n', expect: 'memory_limit' },
  { name: 'intento de red', code: 'import socket\ns = socket.socket()\ns.settimeout(2)\ns.connect(("1.1.1.1", 80))\n', expect: 'runtime_error' },
  { name: 'escribir en disco', code: 'open("/hack.txt", "w").write("x")\n', expect: 'runtime_error' },
];

let failed = 0;
for (const c of cases) {
  const r = await judgeSubmission('suma-pares', c.code);
  const ok = r.verdict === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FALLA'}  ${c.name.padEnd(22)} esperado=${c.expect} obtenido=${r.verdict} (${r.passed}/${r.total}, ${r.executionMs} ms)`);
}
console.log(failed === 0 ? '\nSandbox listo.' : `\n${failed} caso(s) no coinciden.`);
process.exit(failed === 0 ? 0 : 1);
