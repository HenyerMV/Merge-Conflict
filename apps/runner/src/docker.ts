// Ejecuta UNA corrida de código Python del jugador dentro de un contenedor Docker desechable.
// Seguridad: sin red, sin escritura en disco, memoria/CPU/procesos limitados, sin privilegios.
// El código y la entrada viajan por stdin (sin carpetas montadas: más rápido y sin rutas de Windows).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { RawRun } from '@merge-conflict/shared';

const IMAGE = (process.env.RUNNER_IMAGE ?? 'python:3.12-slim').trim();
const DEBUG = (process.env.RUNNER_DEBUG ?? '') !== '';
const MAX_OUTPUT_BYTES = 64 * 1024;
const SIGXCPU_EXIT = 152; // 128 + 24: el proceso superó su límite de CPU (lo impone RLIMIT_CPU)
// --init (tini) evita que el programa del jugador sea el PID 1: el kernel ignora las señales sin manejador en el PID 1.

export interface RunLimits {
  timeLimitMs: number;
  memoryLimitMb: number;
}

interface ContainerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnFailed: boolean;
  elapsedMs: number;
}

function capped(current: string, chunk: Buffer): string {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  return (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT_BYTES);
}

/** Programa que corre DENTRO del contenedor: fija el límite de CPU, lee {code,input} por stdin y ejecuta el código. */
function wrapper(cpuSeconds: number): string {
  return [
    'import sys,io,json,resource',
    `resource.setrlimit(resource.RLIMIT_CPU,(${cpuSeconds},${cpuSeconds + 1}))`,
    'd=json.loads(sys.stdin.buffer.read())',
    "sys.stdin=io.TextIOWrapper(io.BytesIO(d['input'].encode()),encoding='utf-8')",
    "exec(compile(d['code'],'main.py','exec'),{'__name__':'__main__'})",
  ].join(';');
}

function runContainer(pyArgs: string[], stdin: string, memoryMb: number, deadlineMs: number): Promise<ContainerResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const name = `mc-${randomUUID()}`;
    const mem = `${memoryMb}m`;
    const args = [
      'run', '--rm', '-i', '--init', '--name', name,
      '--network', 'none',
      '--memory', mem, '--memory-swap', mem,
      '--cpus', '1',
      '--pids-limit', '64',
      '--read-only', '--tmpfs', '/tmp:size=16m,noexec',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--user', '65534:65534',
      '-e', 'PYTHONDONTWRITEBYTECODE=1',
      '-e', 'PYTHONUNBUFFERED=1',
      IMAGE, 'python', ...pyArgs,
    ];

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;

    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, spawnFailed, elapsedMs: Date.now() - started });
    };

    // Red de seguridad por tiempo real (p. ej. un programa que duerme en vez de calcular).
    const timer = setTimeout(() => {
      timedOut = true;
      spawn('docker', ['kill', name], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, deadlineMs);

    child.stdout.on('data', (d: Buffer) => { stdout = capped(stdout, d); });
    child.stderr.on('data', (d: Buffer) => { stderr = capped(stderr, d); });
    child.on('error', (err) => {
      spawnFailed = true;
      stderr = String(err.message);
      finish(null);
    });
    child.on('close', (exitCode) => finish(exitCode));

    child.stdin.on('error', () => {}); // el programa puede cerrar stdin sin leerlo
    child.stdin.end(stdin);
  });
}

// Lo que tarda en arrancar un contenedor vacío en ESTA máquina (en Windows ronda 2 s; en Linux, 0,3 s).
// No cuenta contra el tiempo del jugador; se mide una vez y se reutiliza.
let startupPromise: Promise<number> | null = null;
function startupMs(): Promise<number> {
  const fixed = Number(process.env.RUNNER_STARTUP_MS ?? '');
  if (fixed > 0) return Promise.resolve(fixed);
  startupPromise ??= (async () => {
    // El primer arranque suele ser "en frío" y mucho más lento: se mide 3 veces y se toma el mínimo.
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const r = await runContainer(['-I', '-c', 'pass'], '', 64, 60_000);
      if (!r.spawnFailed && r.exitCode === 0) best = Math.min(best, r.elapsedMs);
    }
    const ms = Number.isFinite(best) ? Math.max(300, best) : 2000;
    if (DEBUG) console.error(`[runner] arranque del contenedor medido: ${ms} ms${Number.isFinite(best) ? '' : ' (falló, uso 2000)'}`);
    return ms;
  })();
  return startupPromise;
}

export async function runPython(code: string, input: string, limits: RunLimits): Promise<RawRun> {
  const startup = await startupMs();
  const cpuSeconds = Math.max(1, Math.ceil(limits.timeLimitMs / 1000));
  const deadline = limits.timeLimitMs + Math.ceil(startup * 1.5) + 1500;

  const r = await runContainer(['-I', '-c', wrapper(cpuSeconds)], JSON.stringify({ code, input }), limits.memoryLimitMb, deadline);

  const cpuKilled = r.exitCode === SIGXCPU_EXIT;
  const dockerFailed = r.spawnFailed || r.exitCode === 125 || r.exitCode === 126 || r.exitCode === 127; // falló `docker run`, no el jugador
  const run: RawRun = {
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    timedOut: r.timedOut || cpuKilled,
    // 137 = SIGKILL; si no lo causó nuestro tiempo límite, fue el límite de memoria.
    oomKilled: r.exitCode === 137 && !r.timedOut,
    durationMs: Math.max(0, r.elapsedMs - startup),
    ...(dockerFailed ? { sandboxFailed: true } : {}),
  };

  if (DEBUG) {
    const tail = r.stderr.trim().split('\n').slice(-1)[0] ?? '';
    console.error(`[runner] exit=${r.exitCode} total=${r.elapsedMs}ms timedOut=${run.timedOut} stderr="${tail.slice(0, 120)}"`);
  }
  return run;
}
