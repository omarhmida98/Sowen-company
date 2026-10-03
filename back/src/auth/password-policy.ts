// Password rules, shared by registration, password change and invitation / reset links. Pure, unit-tested.

export const PASSWORD_MIN_LENGTH = 10;
// bcrypt only reads the first 72 bytes: a longer password would be silently truncated.
export const PASSWORD_MAX_BYTES = 72;

const COMMON = ['password', 'motdepasse', 'azertyuiop', 'qwertyuiop', '1234567890', '0123456789', 'sowen', 'admin', 'bienvenue', 'welcome', 'changeme'];
const plain = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Returns what is wrong with the password, in French, or null when it is acceptable.
export function passwordProblem(password: unknown, context: { email?: string | null } = {}): string | null {
  if (typeof password !== 'string' || !password) return 'Le mot de passe est obligatoire.';
  if ([...password].length < PASSWORD_MIN_LENGTH) return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'Le mot de passe est trop long (72 caractères au maximum).';
  if (!/\p{L}/u.test(password)) return 'Le mot de passe doit contenir au moins une lettre.';
  if (!/[^\p{L}\s]/u.test(password)) return 'Le mot de passe doit contenir au moins un chiffre ou un symbole.';
  const p = plain(password);
  // The same character or a too-common word padded with digits ("password2026") is refused.
  if (new Set(p).size < 5) return 'Le mot de passe est trop simple.';
  if (COMMON.some(word => p.replace(/[^a-z]/g, '') === word || p === word)) return 'Ce mot de passe est trop courant.';
  const local = plain(String(context.email || '').split('@')[0]);
  if (local.length >= 4 && p.includes(local)) return 'Le mot de passe ne doit pas contenir votre adresse email.';
  return null;
}
