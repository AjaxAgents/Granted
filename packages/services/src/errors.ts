/** An expected failure with a message that is safe to show to the person. */
export class GrantedError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 423 | 429,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'GrantedError';
  }
}

export const bad = (message: string, fields?: Record<string, string>) => new GrantedError(400, 'invalid', message, fields);
export const unauthenticated = (message = 'Sign in to continue.') => new GrantedError(401, 'unauthenticated', message);
export const forbidden = (message = 'You don’t have access to do that on this project.') => new GrantedError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new GrantedError(404, 'not_found', message);
export const conflict = (message: string) => new GrantedError(409, 'conflict', message);
export const locked = (message: string) => new GrantedError(423, 'locked', message);
export const tooMany = (message = 'Too many attempts. Wait a few minutes and try again.') => new GrantedError(429, 'rate_limited', message);
