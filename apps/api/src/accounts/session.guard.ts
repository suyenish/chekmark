import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CookieOptions, Request } from 'express';
import type { AppConfig } from '../config/config.js';
import { AuthService, type SignedInUser } from './auth.service.js';

export const SESSION_COOKIE = 'session';

export const sessionCookieOptions = (config: AppConfig): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.nodeEnv === 'production',
  path: '/',
});

type RequestWithUser = Request & { user?: SignedInUser };

/** Reads one cookie from the Cookie header without a parsing library. */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return null; // not a value this app ever set
    }
  }
  return null;
}

/** Allows the request only with a live session, and attaches the signed-in user. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE);
    const user = sessionId ? await this.auth.findSessionUser(sessionId) : null;
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}

/** The user that SessionGuard attached. Use only on routes behind SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SignedInUser => context.switchToHttp().getRequest<RequestWithUser>().user!,
);
