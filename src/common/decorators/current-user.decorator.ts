import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * Authenticated principal attached to the request by `JwtAuthGuard`.
 */
export interface AuthenticatedUser {
  /** The user id carried in the access token's `sub` claim. */
  userId: string;
  email: string;
}

interface RequestWithUser {
  user?: AuthenticatedUser;
}

const readUser = (context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  if (!request.user) {
    throw new UnauthorizedException('Authentication required');
  }
  return request.user;
};

/** Injects the full authenticated principal, e.g. `{ userId, email }`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => readUser(context),
);

/** Injects only the authenticated user's id — the common case for ownership. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => readUser(context).userId,
);
