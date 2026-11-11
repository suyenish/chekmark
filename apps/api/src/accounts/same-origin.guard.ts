import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses requests that change something when a browser says they come from
 * another website. Browsers attach the session cookie to such requests in
 * some cases, so without this another site could act for a signed-in reader
 * (delete a book, sign them out). Browsers always send Origin on these
 * requests; tools such as curl send none and carry nobody else's cookie.
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  private readonly appOrigin: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.appOrigin = new URL(config.appUrl).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (READ_ONLY.has(request.method) || !origin || origin === this.appOrigin) return true;
    throw new ForbiddenException('This request came from another site and was refused.');
  }
}
