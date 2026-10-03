// What each role may do in the interface. It mirrors the @Roles() rules of the API, which stay authoritative:
// this table only decides which buttons are shown, so that a user is not offered an action the API will refuse.

export type Role = 'ADMIN' | 'EDITOR' | 'USER';

const WRITERS: Role[] = ['ADMIN', 'EDITOR'];
const ADMIN: Role[] = ['ADMIN'];

export const PERMISSIONS = {
  'project.write': WRITERS,       // create or edit a project, add a lot to it
  'observation.write': WRITERS,   // create, edit, review, change status, assign
  'report.write': WRITERS,        // import, re-analyse, materialise
  'email.send': WRITERS,          // send, remind, save drafts
  'company.write': WRITERS,
  'document.write': WRITERS,      // upload, delete
  'evidence.write': WRITERS,      // upload, validate, refuse
  'portal.manage': WRITERS,       // company portal links
  'reminder.scan': WRITERS,
  'digest.send': WRITERS,
  'precontrol.run': WRITERS,
  'lot.create': ADMIN,
  'rule.write': ADMIN,
  'organization.manage': ADMIN,
  'team.manage': ADMIN,
} as const satisfies Record<string, Role[]>;

export type Action = keyof typeof PERMISSIONS;

// An unknown role (session not loaded yet) may do nothing.
export function can(role: string | null | undefined, action: Action): boolean {
  return (PERMISSIONS[action] as Role[]).includes(role as Role);
}

export const isRole = (v: unknown): v is Role => v === 'ADMIN' || v === 'EDITOR' || v === 'USER';
