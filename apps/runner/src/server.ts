// Servidor HTTP del ejecutor. Lo llama SOLO tu servidor de partidas (nunca el navegador).
//   POST /judge   { challengeId, code }  ->  ValidationResult
//   GET  /health                         ->  { ok: true }
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { judgeSubmission, UnknownChallengeError } from './judgeCode';

const TOKEN = (process.env.RUNNER_TOKEN ?? '').trim();
const HOST = (process.env.RUNNER_HOST ?? '127.0.0.1').trim();
const PORT = Number(process.env.PORT ?? process.env.RUNNER_PORT ?? 8787);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CODE_CHARS = 20_000;

if (!TOKEN) {
  console.error('Falta RUNNER_TOKEN. Ejemplo (cmd):  set RUNNER_TOKEN=un-secreto-largo');
  process.exit(1);
}

function tokenOk(header: string | undefined): boolean {
  const a = Buffer.from((header ?? '').trim());
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });

    if (req.method === 'POST' && req.url === '/judge') {
      const header = req.headers['x-runner-token'];
      if (!tokenOk(Array.isArray(header) ? header[0] : header)) return send(res, 401, { error: 'unauthorized' });

      const raw = await readBody(req);
      if (raw === null) return send(res, 413, { error: 'body_too_large' });

      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'bad_json' });
      }
      const { challengeId, code } = (data ?? {}) as { challengeId?: unknown; code?: unknown };
      if (typeof challengeId !== 'string' || typeof code !== 'string') return send(res, 400, { error: 'bad_request' });
      if (code.length > MAX_CODE_CHARS) return send(res, 413, { error: 'code_too_long' });

      try {
        return send(res, 200, await judgeSubmission(challengeId, code));
      } catch (err) {
        if (err instanceof UnknownChallengeError) return send(res, 404, { error: 'unknown_challenge' });
        throw err;
      }
    }

    send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error('[runner] error interno:', err); // el detalle queda en el log, no en la respuesta
    send(res, 500, { error: 'runner_error' });
  }
});

server.listen(PORT, HOST, () => console.log(`[runner] escuchando en http://${HOST}:${PORT}`));
