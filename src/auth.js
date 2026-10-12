'use strict';

const crypto = require('node:crypto');

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'ludo_session';

function validateUsername(name) {
  if (typeof name !== 'string' || !USERNAME_RE.test(name)) {
    return 'Username must be 3-20 characters: letters, numbers, _ or -';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return 'Password must be at least ' + MIN_PASSWORD + ' characters';
  if (password.length > MAX_PASSWORD) return 'Password is too long';
  return null;
}

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
});

// Stored as "salt:hash" (both hex). A fresh random salt per password.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return salt.toString('hex') + ':' + key.toString('hex');
}

async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = String(stored || '').split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Stateless session token: base64url(payload).signature, signed with the server secret.
function signSession(userId, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

// Returns the user id from a valid, unexpired token; otherwise null.
function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > now ? uid : null;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return cookies;
}

function sessionCookie(token, secure) {
  return COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + SESSION_MS / 1000 + (secure ? '; Secure' : '');
}

const clearCookie = (secure) => COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + (secure ? '; Secure' : '');

// Counts failed attempts per key (e.g. IP + username) so passwords cannot be guessed quickly.
function createLimiter({ max = 8, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();
  const recent = (key) => (hits.get(key) || []).filter((t) => now() - t < windowMs);
  return {
    blocked: (key) => recent(key).length >= max,
    fail: (key) => { hits.set(key, [...recent(key), now()]); },
    reset: (key) => { hits.delete(key); },
  };
}

module.exports = {
  COOKIE_NAME, validateUsername, validatePassword, hashPassword, verifyPassword,
  signSession, verifySession, parseCookies, sessionCookie, clearCookie, createLimiter,
};
