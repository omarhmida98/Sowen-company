export type AuthUser = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'USER';
  organizationId: string;
};
