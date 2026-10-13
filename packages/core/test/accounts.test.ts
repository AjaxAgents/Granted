// @ts-nocheck
// Account, project-code and permission rules.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as A from '../src/accounts';

const good = { first: 'Dana', last: 'Ruiz', phone: '(214) 555-0141', email: 'dana@northfield.example', password: 'Delivery2026', company: 'North Field Electrical', declaredAjax: 'no' };

test('A01 password rules: 8+ chars, upper, lower, number', () => {
  assert.equal(A.isValidPassword('Delivery2026'), true);
  assert.equal(A.isValidPassword('delivery2026'), false); // no upper
  assert.equal(A.isValidPassword('DELIVERY2026'), false); // no lower
  assert.equal(A.isValidPassword('Deliveryyy'), false);   // no number
  assert.equal(A.isValidPassword('Dlv2026'), false);      // 7 chars
  assert.deepEqual(A.passwordChecks('Ab1').map((c) => c.ok), [false, true, true, true]);
});
test('A02 Ajax membership comes from the email domain only', () => {
  assert.equal(A.isAjaxEmail('Jack.Lund@AjaxBuilding.com '), true);
  assert.equal(A.isAjaxEmail('x@ajaxbuilding.com.evil.example'), false);
  assert.equal(A.isAjaxEmail('x@notajaxbuilding.com'), false);
  assert.equal(A.isAjaxEmail('ajaxbuilding.com@gmail.com'), false);
});
test('A03 a complete non-Ajax sign-up is valid', () => {
  const r = A.validateSignUp(good);
  assert.equal(r.ok, true); assert.equal(r.isAjax, false); assert.equal(r.ajaxNote, '');
});
test('A04 saying Yes with a non-Ajax email needs confirmation and stays non-Ajax', () => {
  const r = A.validateSignUp(Object.assign({}, good, { declaredAjax: 'yes' }));
  assert.equal(r.ok, false); assert.match(r.ajaxNote, /non-Ajax/); assert.equal(r.isAjax, false);
  const r2 = A.validateSignUp(Object.assign({}, good, { declaredAjax: 'yes', ajaxNoteConfirmed: true }));
  assert.equal(r2.ok, true); assert.equal(r2.isAjax, false);
});
test('A05 saying No with an Ajax email needs confirmation and becomes Ajax', () => {
  const r = A.validateSignUp(Object.assign({}, good, { email: 'pat@ajaxbuilding.com', ajaxNoteConfirmed: true }));
  assert.equal(r.ok, true); assert.equal(r.isAjax, true); assert.match(r.ajaxNote, /Ajax Building Company account/);
});
test('A06 missing fields are each reported', () => {
  const r = A.validateSignUp({ declaredAjax: '' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['company', 'declaredAjax', 'email', 'first', 'last', 'password', 'phone']);
});
test('A07 admin code works only for Ajax emails and never says why it failed', () => {
  assert.equal(A.classifyProjectCode({ code: 'x', email: 'a@ajaxbuilding.com', adminCodeMatches: true }).kind, 'admin');
  const outsider = A.classifyProjectCode({ code: 'x', email: 'a@gmail.com', adminCodeMatches: true });
  const typo = A.classifyProjectCode({ code: 'x', email: 'a@gmail.com', adminCodeMatches: false, projectExists: false });
  assert.equal(outsider.kind, 'invalid'); assert.equal(outsider.message, typo.message);
});
test('A08 real project codes become join requests; blank is allowed', () => {
  assert.equal(A.classifyProjectCode({ code: 'dc2-7hkq', email: 'a@b.com', projectExists: true }).kind, 'join');
  assert.equal(A.classifyProjectCode({ code: '  ', email: 'a@b.com' }).kind, 'none');
});
test('A09 project codes are unique, readable and prefixed from the name', () => {
  let i = 0; const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]; const rand = () => seq[i++ % seq.length];
  const a = A.newProjectCode('DFW2 Data Center 2', [], rand);
  assert.match(a, /^DDC2-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/);
  const b = A.newProjectCode('DFW2 Data Center 2', [a], rand);
  assert.notEqual(a, b);
  assert.equal(A.normalizeProjectCode(' ddc2-aaaa '), 'DDC2-AAAA');
});
test('A10 permissions: each role sees only its part', () => {
  assert.equal(A.can('contractor', 'delivery.request'), true);
  assert.equal(A.can('contractor', 'gate.scan'), false);
  assert.equal(A.can('access', 'gate.scan'), true);
  assert.equal(A.can('access', 'delivery.request'), false);
  assert.equal(A.can('admin', 'team.remove'), true);
  assert.equal(A.can('contractor', 'team.invite'), false);
});
test('A11 five failed sign-ins lock the account for 15 minutes', () => {
  const now = new Date(2026, 9, 13, 12, 0);
  const f = (min) => new Date(now.getTime() - min * 60000).toISOString();
  assert.equal(A.lockState([f(1), f(2), f(3), f(4)], now).locked, false);
  const s = A.lockState([f(1), f(2), f(3), f(4), f(10)], now);
  assert.equal(s.locked, true); assert.equal(s.minutesLeft, 5);
  assert.equal(A.lockState([f(16), f(17), f(18), f(19), f(20)], now).locked, false);
});
test('A12 phone numbers normalise to 214-555-0141', () => {
  assert.equal(A.formatPhone('(214) 555 0141'), '214-555-0141');
  assert.equal(A.isValidPhone('1-214-555-0141'), true);
  assert.equal(A.isValidPhone('555-0141'), false);
});
