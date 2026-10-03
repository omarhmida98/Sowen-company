export type AuthUser = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'USER';
  organizationId: string;
};
// What the JWTs carry. `ver` is the user's token version when the token was issued.
export type TokenPayload = AuthUser & { ver?: number };
