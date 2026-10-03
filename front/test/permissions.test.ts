import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, can, isRole, type Action } from '../src/lib/permissions';

const actions = Object.keys(PERMISSIONS) as Action[];

test('a consultant (USER) is offered no action at all', () => {
  for (const action of actions) assert.equal(can('USER', action), false, action);
});

test('an administrator is offered every action', () => {
  for (const action of actions) assert.equal(can('ADMIN', action), true, action);
});

test('an editor works on the data but not on the organisation, the team, the lots or the rules', () => {
  const adminOnly: Action[] = ['lot.create', 'rule.write', 'organization.manage', 'team.manage'];
  for (const action of actions) assert.equal(can('EDITOR', action), !adminOnly.includes(action), action);
});

test('an unknown or missing role is offered nothing', () => {
  for (const role of [null, undefined, '', 'OWNER', 'admin']) for (const action of actions) assert.equal(can(role, action), false, `${role} ${action}`);
  assert.equal(isRole('USER'), true);
  assert.equal(isRole('admin'), false);
});
