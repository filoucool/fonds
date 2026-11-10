import type { FastifyRequest } from 'fastify';
import type { AccessTokenScope } from '@repo-archive/shared';
import type { AuthService, SessionContext } from '../services/auth';

export const SESSION_COOKIE = 'archiver_session';

export interface RequestAuth {
  kind: 'anonymous' | 'session' | 'token';
  userId: string | null;
  username: string | null;
  session: SessionContext | null;
  tokenScopes: AccessTokenScope[];
}

export function readBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function resolveRequestAuth(request: FastifyRequest, auth: AuthService): RequestAuth {
  const bearer = readBearer(request);
  if (bearer?.startsWith('ra_')) {
    const resolved = auth.resolveAccessToken(bearer);
    if (resolved) {
      return { kind: 'token', userId: resolved.userId, username: null, session: null, tokenScopes: resolved.scopes };
    }
  }
  const sessionToken = readSessionCookie(request) ?? (bearer && !bearer.startsWith('ra_') ? bearer : null);
  if (sessionToken) {
    const session = auth.sessionFromToken(sessionToken);
    if (session) {
      return { kind: 'session', userId: session.user.id, username: session.user.username, session, tokenScopes: [] };
    }
  }
  return { kind: 'anonymous', userId: null, username: null, session: null, tokenScopes: [] };
}
