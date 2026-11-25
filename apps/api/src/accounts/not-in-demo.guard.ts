import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { SignedInUser } from './auth.service.js';

/** Refuses the request for a demo account. Runs after SessionGuard, and before an upload is read. */
@Injectable()
export class NotInDemoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<Request & { user?: SignedInUser }>();
    if (user?.demo) throw new ForbiddenException('This is switched off in the demo. You can try everything with the sample pages.');
    return true;
  }
}
