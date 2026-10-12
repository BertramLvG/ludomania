'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/auth');

test('usernames: 3-20 letters, numbers, _ or -', () => {
  assert.equal(auth.validateUsername('Anna_1'), null);
  assert.equal(auth.validateUsername('a-b'), null);
  for (const bad of ['ab', 'x'.repeat(21), 'has space', 'æøå', '', null, 42, '<script>']) {
    assert.ok(auth.validateUsername(bad), 'should reject ' + String(bad));
  }
});

test('passwords: at least 8 characters, not absurdly long', () => {
  assert.equal(auth.validatePassword('longenough'), null);
  assert.ok(auth.validatePassword('short'));
  assert.ok(auth.validatePassword('x'.repeat(129)));
  assert.ok(auth.validatePassword(undefined));
});

test('passwords are hashed with a random salt and verified', async () => {
  const h1 = await auth.hashPassword('correct horse');
  const h2 = await auth.hashPassword('correct horse');
  assert.notEqual(h1, h2); // different salts
  assert.ok(!h1.includes('correct horse'));
  assert.equal(await auth.verifyPassword('correct horse', h1), true);
  assert.equal(await auth.verifyPassword('wrong horse', h1), false);
  assert.equal(await auth.verifyPassword('anything', 'garbage'), false);
});

test('session tokens verify, expire and cannot be tampered with', () => {
  const now = 1_000_000;
  const token = auth.signSession(7, 'secret', now);
  assert.equal(auth.verifySession(token, 'secret', now + 1000), 7);
  assert.equal(auth.verifySession(token, 'other secret', now + 1000), null);
  assert.equal(auth.verifySession(token, 'secret', now + 31 * 24 * 60 * 60 * 1000), null);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 1, exp: now + 1e12 })).toString('base64url');
  assert.equal(auth.verifySession(forged + '.' + sig, 'secret', now), null);
  assert.equal(auth.verifySession(payload, 'secret', now), null);
  assert.equal(auth.verifySession(undefined, 'secret', now), null);
});

test('cookies are parsed, and the session cookie is HttpOnly', () => {
  assert.deepEqual(auth.parseCookies('a=1; ludo_session=abc.def; b=x%20y'), { a: '1', ludo_session: 'abc.def', b: 'x y' });
  assert.deepEqual(auth.parseCookies(undefined), {});
  const c = auth.sessionCookie('tok', true);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.doesNotMatch(auth.sessionCookie('tok', false), /Secure/);
});

test('the limiter blocks after too many failures and forgets after the window', () => {
  let t = 0;
  const limiter = auth.createLimiter({ max: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) { assert.equal(limiter.blocked('k'), false); limiter.fail('k'); }
  assert.equal(limiter.blocked('k'), true);
  assert.equal(limiter.blocked('other'), false);
  t = 2000;
  assert.equal(limiter.blocked('k'), false);
  limiter.fail('k'); limiter.reset('k');
  assert.equal(limiter.blocked('k'), false);
});
