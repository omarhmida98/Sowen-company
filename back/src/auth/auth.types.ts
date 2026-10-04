export type AuthUser = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'USER';
  organizationId: string;
  // the server-side session the request belongs to
  sid?: string;
};
// What the JWTs carry. `ver` is the user's token version when the token was issued, `sid` the server-side session
// and, in a refresh token only, `rid` the identifier of that refresh token inside the session.
export type TokenPayload = AuthUser & { ver?: number; rid?: string };
