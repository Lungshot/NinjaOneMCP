import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface StoredTokens {
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  tenantBaseUrl: string | null;
  scope: string | null;
  clientId: string | null;
}

const FILE_NAME = 'tokens.json';

function resolveDir(): string {
  const override = process.env.NINJA_TOKEN_DIR;
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.ninjaone-mcp');
}

function resolvePath(): string {
  return path.join(resolveDir(), FILE_NAME);
}

export async function load(): Promise<StoredTokens | null> {
  const file = resolvePath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    return {
      refreshToken: parsed.refreshToken ?? null,
      accessToken: parsed.accessToken ?? null,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null,
      tenantBaseUrl: parsed.tenantBaseUrl ?? null,
      scope: parsed.scope ?? null,
      clientId: parsed.clientId ?? null,
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    console.error('[token-store] failed to read token file:', err);
    return null;
  }
}

export async function save(tokens: StoredTokens): Promise<void> {
  const dir = resolveDir();
  const file = resolvePath();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const body = JSON.stringify(tokens, null, 2);
  await fs.writeFile(file, body, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(file, 0o600);
    await fs.chmod(dir, 0o700);
  } catch {
    // Windows filesystems may not honor chmod; best-effort only.
  }
}

export async function clear(): Promise<void> {
  const file = resolvePath();
  try {
    await fs.unlink(file);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') throw err;
  }
}

export function location(): string {
  return resolvePath();
}
