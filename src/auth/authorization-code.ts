import * as crypto from 'crypto';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkcePair(): PkcePair {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

export function createState(): string {
  return base64UrlEncode(crypto.randomBytes(16));
}

export interface AuthorizeUrlParams {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const search = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${params.baseUrl.replace(/\/+$/, '')}/ws/oauth/authorize?${search.toString()}`;
}

export interface ExchangeCodeParams {
  baseUrl: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}

export async function exchangeCode(p: ExchangeCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.codeVerifier,
  });
  if (p.clientSecret) body.append('client_secret', p.clientSecret);
  return postToken(p.baseUrl, body);
}

export interface RefreshParams {
  baseUrl: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export async function refresh(p: RefreshParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
  });
  if (p.clientSecret) body.append('client_secret', p.clientSecret);
  if (p.scope) body.append('scope', p.scope);
  return postToken(p.baseUrl, body);
}

async function postToken(baseUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const url = `${baseUrl.replace(/\/+$/, '')}/ws/oauth/token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OAuth token request failed: ${response.status} ${response.statusText} - ${text}`);
  }
  return (await response.json()) as TokenResponse;
}

export function parseRedirectUrl(url: string): { code: string | null; state: string | null; error: string | null } {
  try {
    const parsed = new URL(url);
    return {
      code: parsed.searchParams.get('code'),
      state: parsed.searchParams.get('state'),
      error: parsed.searchParams.get('error'),
    };
  } catch {
    return { code: null, state: null, error: 'invalid_url' };
  }
}
