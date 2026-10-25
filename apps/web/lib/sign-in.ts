'use client';
// Sign-in helpers shared by the login, register and settings pages: where to go after signing in, the method used
// last on this device (to put it first), the plan chosen on the pricing page (kept through sign-up), and passkeys.
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { QueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import type { Me } from './session';

export type Method = 'email' | 'password' | 'phone' | 'passkey' | 'google' | 'apple' | 'microsoft' | 'facebook';
export interface AuthOptions { password: boolean; emailCode: boolean; sms: boolean; passkey: boolean; providers: ('google' | 'apple' | 'microsoft' | 'facebook')[] }

const LAST = 'mf-last-sign-in';
const PLAN = 'mf-intended-plan';

export function lastMethod(): Method | null {
  try {
    return (localStorage.getItem(LAST) as Method | null) ?? null;
  } catch {
    return null;
  }
}
export function rememberMethod(m: Method) {
  try {
    localStorage.setItem(LAST, m);
  } catch {
    /* private browsing: nothing to remember */
  }
}

/** The plan and billing period picked on the pricing page, kept for a day while the visitor signs up. */
export interface IntendedPlan { plan: 'starter' | 'club' | 'studio'; billing: 'monthly' | 'yearly'; at: number }
export function rememberPlan(plan: string | null, billing: string | null) {
  if (!plan || !/^(starter|club|studio)$/.test(plan)) return;
  try {
    localStorage.setItem(PLAN, JSON.stringify({ plan, billing: billing === 'yearly' ? 'yearly' : 'monthly', at: Date.now() }));
  } catch {
    /* ignore */
  }
}
export function intendedPlan(): IntendedPlan | null {
  try {
    const v = JSON.parse(localStorage.getItem(PLAN) ?? 'null') as IntendedPlan | null;
    return v && Date.now() - v.at < 86_400_000 ? v : null;
  } catch {
    return null;
  }
}
export function forgetPlan() {
  try {
    localStorage.removeItem(PLAN);
  } catch {
    /* ignore */
  }
}

/** After any successful sign-in: the page asked for, else the right home for this account. */
export async function finishSignIn(router: { replace: (href: string) => void }, qc: QueryClient, next: string | null, method: Method) {
  rememberMethod(method);
  const me = await get<Me>('me');
  qc.setQueryData(['me'], me);
  if (next && next.startsWith('/') && !next.startsWith('//')) router.replace(next);
  else if (!me.organisations.length) router.replace(me.staff ? '/staff' : '/onboarding');
  else if (me.role === 'scorer') router.replace('/score');
  else router.replace('/app');
}

export const passkeysSupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

/** Sign in with a passkey on this device (or a phone nearby). Resolves when the session is set. */
export async function signInWithPasskey() {
  const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkey/generate-authenticate-options');
  const response = await startAuthentication({ optionsJSON });
  await api('/api/auth/passkey/verify-authentication', { method: 'POST', json: { response } });
}

/** Register a passkey for the signed-in account. */
export async function addPasskey(name: string) {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkey/generate-register-options');
  const response = await startRegistration({ optionsJSON });
  await api('/api/auth/passkey/verify-registration', { method: 'POST', json: { response, name } });
}

/** A cancelled or timed-out passkey prompt is not an error worth showing. */
export const passkeyCancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** Mobile numbers in international form: "+61 412 345 678" → "+61412345678"; null when it cannot be one. */
export function toE164(raw: string): string | null {
  const t = raw.trim().replace(/[\s().-]/g, '');
  const n = t.startsWith('00') ? `+${t.slice(2)}` : t;
  return /^\+[1-9]\d{6,14}$/.test(n) ? n : null;
}
