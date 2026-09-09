'use client';

/**
 * Клиент онлайн-режима: обёртки над /api/mp/* + сохранение сессии/профиля
 * в localStorage (переживают перезагрузку — можно вернуться в партию).
 */

import type { MpRoomView, NetAction } from './game/types';

export interface MpSession {
  playerId: string;
  code: string;
  name: string;
  avatar: string;
  /** комната открыта для поиска (для плашки на экране ожидания) */
  isPublic?: boolean;
}

export interface MpProfile {
  name: string;
  avatar: string;
}

const SKEY = 'loskutki.mp.session.v1';
const PKEY = 'loskutki.mp.profile.v1';

export function loadSession(): MpSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SKEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as MpSession;
    if (typeof s?.playerId === 'string' && typeof s?.code === 'string' && s.playerId && s.code.length === 6) {
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s: MpSession | null) {
  if (typeof window === 'undefined') return;
  if (s) localStorage.setItem(SKEY, JSON.stringify(s));
  else localStorage.removeItem(SKEY);
}

export function loadProfile(): MpProfile {
  if (typeof window === 'undefined') return { name: '', avatar: 'ann' };
  try {
    const raw = localStorage.getItem(PKEY);
    if (raw) {
      const p = JSON.parse(raw) as MpProfile;
      if (typeof p?.name === 'string' && typeof p?.avatar === 'string') return p;
    }
  } catch {
    /* ignore */
  }
  return { name: '', avatar: 'ann' };
}

export function saveProfile(p: MpProfile) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PKEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

// ===== сетевые вызовы =====

export class MpError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new MpError('net');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new MpError('net');
  }
  const d = data as { ok?: boolean; error?: string };
  if (!d || d.ok !== true) {
    throw new MpError(typeof d?.error === 'string' ? d.error : 'net');
  }
  return d as T;
}

export function mpCreate(input: { name: string; avatar: string; isPublic: boolean }) {
  return post<{ code: string; playerId: string }>('/api/mp/create', input);
}

export function mpJoin(input: { code: string; name: string; avatar: string }) {
  return post<{ code: string; playerId: string }>('/api/mp/join', input);
}

export function mpState(input: { code: string; playerId: string }) {
  return post<{ view: MpRoomView }>('/api/mp/state', input);
}

export function mpMove(input: { code: string; playerId: string; action: NetAction }) {
  return post<{ view: MpRoomView }>('/api/mp/move', input);
}

export function mpControl(input: { code: string; playerId: string; op: 'leave' | 'cancel' | 'rematch' }) {
  return post<{ started?: boolean }>('/api/mp/control', input);
}

export async function mpListRooms(): Promise<Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }>> {
  try {
    const res = await fetch('/api/mp/rooms', { cache: 'no-store' });
    const data = (await res.json()) as { ok?: boolean; rooms?: Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }> };
    if (data?.ok && Array.isArray(data.rooms)) return data.rooms;
  } catch {
    /* offline */
  }
  return [];
}

/** Сообщение об ошибке по коду (ключ i18n) */
export function mpErrorKey(code: string): string {
  switch (code) {
    case 'notfound': return 'mp_notfound';
    case 'full': return 'mp_full';
    case 'started': return 'mp_started';
    case 'notyourturn': return 'mp_notyourturn';
    case 'illegal': return 'mp_illegal';
    case 'badname': return 'mp_bad_name';
    case 'badpayload': return 'mp_illegal';
    case 'gone': return 'mp_gone';
    default: return 'mp_net';
  }
}
