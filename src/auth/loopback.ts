import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { spawn } from 'child_process';
import { URL } from 'url';

export interface LoopbackResult {
  code: string;
  state: string;
}

export interface LoopbackOptions {
  redirectUri: string;
  expectedState: string;
  timeoutMs?: number;
}

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>NinjaOne MCP</title></head><body style="font-family:sans-serif;padding:2rem"><h2>Login complete</h2><p>You can close this tab and return to the MCP client.</p></body></html>`;
const ERROR_HTML = (msg: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>NinjaOne MCP</title></head><body style="font-family:sans-serif;padding:2rem"><h2>Login failed</h2><p>${msg}</p></body></html>`;

export async function waitForCallback(opts: LoopbackOptions): Promise<LoopbackResult> {
  const parsedRedirect = new URL(opts.redirectUri);
  const host = parsedRedirect.hostname || '127.0.0.1';
  const port = parsedRedirect.port ? Number(parsedRedirect.port) : 8765;
  const pathname = parsedRedirect.pathname || '/callback';
  const timeout = opts.timeoutMs ?? 120_000;

  return new Promise<LoopbackResult>((resolve, reject) => {
    let settled = false;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const reqUrl = new URL(req.url, `http://${host}:${port}`);
        if (reqUrl.pathname !== pathname) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');
        if (error) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(ERROR_HTML(`OAuth error: ${error}`));
          finish(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!code || !state) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(ERROR_HTML('Missing code/state in callback.'));
          finish(new Error('Missing code/state in callback'));
          return;
        }
        if (state !== opts.expectedState) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(ERROR_HTML('State mismatch — possible CSRF.'));
          finish(new Error('State mismatch'));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(SUCCESS_HTML);
        finish(null, { code, state });
      } catch (err) {
        finish(err as Error);
      }
    });

    const timer = setTimeout(() => {
      finish(new Error(`Loopback callback timed out after ${timeout}ms`));
    }, timeout);

    function finish(err: Error | null, result?: LoopbackResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (err || !result) reject(err ?? new Error('unknown loopback failure'));
      else resolve(result);
    }

    server.on('error', (err: Error) => finish(err));
    server.listen(port, host);
  });
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Best effort. Caller will still display the URL.
  }
}
