import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import type { JsonStore } from './store.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'lab_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie?.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return raw?.slice(name.length + 1);
}

function hashSession(token: string) { return createHash('sha256').update(token).digest('hex'); }

async function passwordHash(password: string, salt: string): Promise<string> {
  return (await scrypt(password, salt, 64) as Buffer).toString('hex');
}

export async function createAccount(store: JsonStore, email: string, password: string) {
  const user = { id: randomUUID(), email: email.trim().toLowerCase(), salt: randomBytes(16).toString('hex'), passwordHash: '', createdAt: new Date().toISOString() };
  user.passwordHash = await passwordHash(password, user.salt);
  await store.write((d) => {
    if (d.users.some((u) => u.email === user.email)) throw new Error('EMAIL_TAKEN');
    d.users.push(user);
  });
  return { id: user.id, email: user.email };
}

export async function verifyCredentials(store: JsonStore, email: string, password: string) {
  const user = store.read((d) => d.users.find((u) => u.email === email.trim().toLowerCase()));
  // Comparable computation even for missing users (limits easy account enumeration).
  const salt = user?.salt ?? '00000000000000000000000000000000';
  const actual = Buffer.from(await passwordHash(password, salt), 'hex');
  const expected = Buffer.from(user?.passwordHash ?? '00'.repeat(64), 'hex');
  return timingSafeEqual(actual, expected) && user ? { id: user.id, email: user.email } : null;
}

export async function startSession(store: JsonStore, userId: string, res: Response) {
  const token = randomBytes(32).toString('hex');
  await store.write((d) => {
    d.sessions = d.sessions.filter((s) => s.expiresAt > Date.now());
    d.sessions.push({ tokenHash: hashSession(token), userId, expiresAt: Date.now() + SESSION_TTL_MS });
  });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: false, maxAge: SESSION_TTL_MS, path: '/' });
}

export function currentUser(store: JsonStore, req: Request) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = hashSession(token);
  return store.read((d) => {
    const session = d.sessions.find((s) => s.tokenHash === hash && s.expiresAt > Date.now());
    const user = d.users.find((u) => u.id === session?.userId);
    return user ? { id: user.id, email: user.email } : null;
  });
}

export async function endSession(store: JsonStore, req: Request, res: Response) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) await store.write((d) => { d.sessions = d.sessions.filter((s) => s.tokenHash !== hashSession(token)); });
  res.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'strict' });
}
