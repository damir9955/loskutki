'use client';

/**
 * Клиент онлайн-режима: обёртки над мультиплеером + сохранение сессии/профиля
 * в localStorage (переживают перезагрузку — можно вернуться в партию).
 *
 * Два транспорта, одинаковые функции:
 *  — WebSocket (Deno Deploy): включён, когда задан NEXT_PUBLIC_WS_URL
 *    (адрес вида wss://имя.deno.dev). Хода соперника приходят мгновенно
 *    push-событиями, поллинга нет.
 *  — HTTP API-роуты /api/mp/* (Vercel): запасной режим без env-переменной
 *    (локальная разработка). Включается автоматически.
 */

import type { MpRoomView, NetAction } from './game/types';
import { getWs, wsEnabled, type OpenRoomInfo } from './ws';

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

/** POST с ретраями ТРАНСПОРТНЫХ сбоев (телефон переключил Wi-Fi↔LTE и т.п.).
 *  Приложные ошибки (notfound/full/…) не ретраятся — они осмысленные.
 *  Применяется только к идемпотентным вызовам (опрос состояния). */
async function postRetry<T>(url: string, body: unknown, attempts = 3): Promise<T> {
  const delays = [400, 900];
  for (let i = 0; ; i++) {
    try {
      return await post<T>(url, body);
    } catch (e) {
      const transient = e instanceof MpError && e.code === 'net';
      if (!transient || i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, delays[Math.min(i, delays.length - 1)]));
    }
  }
}

export async function mpCreate(input: { name: string; avatar: string; isPublic: boolean }): Promise<{ code: string; playerId: string }> {
  if (wsEnabled()) {
    const r = await getWs().request<{ code: string; playerId: string }>('create', input);
    return { code: r.code, playerId: r.playerId };
  }
  return post<{ code: string; playerId: string }>('/api/mp/create', input);
}

export async function mpJoin(input: { code: string; name: string; avatar: string; playerId?: string }): Promise<{ code: string; playerId: string }> {
  if (wsEnabled()) {
    const r = await getWs().request<{ code: string; playerId: string }>('join', input);
    return { code: r.code, playerId: r.playerId };
  }
  return post<{ code: string; playerId: string }>('/api/mp/join', input);
}

export async function mpState(input: { code: string; playerId: string }): Promise<{ view: MpRoomView }> {
  if (wsEnabled()) {
    // запрос состояния = точка переподключения: сервер прикрепляет сокет
    // и дальше пушит изменения мгновенно
    return getWs().request<{ view: MpRoomView }>('state', input);
  }
  // идемпотентный опрос — транспортные сбои гасим ретраями
  return postRetry<{ view: MpRoomView }>('/api/mp/state', input);
}

export async function mpMove(input: { code: string; playerId: string; action: NetAction }): Promise<{ view: MpRoomView }> {
  if (wsEnabled()) {
    return getWs().request<{ view: MpRoomView }>('move', input, 8000);
  }
  return post<{ view: MpRoomView }>('/api/mp/move', input);
}

export async function mpControl(input: { code: string; playerId: string; op: 'leave' | 'cancel' | 'rematch' }): Promise<{ started?: boolean }> {
  if (wsEnabled()) {
    const r = await getWs().request<{ started?: boolean }>('control', input);
    return { started: r.started };
  }
  return post<{ started?: boolean }>('/api/mp/control', input);
}

/** Быстрый матч (автопоиск): пару с другим искателем или первой открытой комнатой */
export async function mpQuick(input: { playerId?: string; name: string; avatar: string }): Promise<{ status: 'matched' | 'waiting'; code?: string; playerId: string }> {
  if (wsEnabled()) {
    const r = await getWs().request<{ status: 'matched' | 'waiting'; code?: string; playerId: string }>('quick', input);
    return { status: r.status, code: r.code, playerId: r.playerId };
  }
  return post<{ status: 'matched' | 'waiting'; code?: string; playerId: string }>('/api/mp/quick', input);
}

/** Отменить автопоиск */
export async function mpQuickCancel(playerId: string): Promise<{ ok?: boolean }> {
  if (wsEnabled()) {
    return getWs().request<Record<string, unknown>>('quick_cancel', { playerId });
  }
  return post<{ ok?: boolean }>('/api/mp/quick', { playerId, op: 'cancel' });
}

export async function mpListRooms(): Promise<OpenRoomInfo[]> {
  if (wsEnabled()) {
    const r = await getWs().request<{ rooms?: OpenRoomInfo[] }>('rooms');
    return Array.isArray(r.rooms) ? r.rooms : [];
  }
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch('/api/mp/rooms', { cache: 'no-store' });
      const data = (await res.json()) as { ok?: boolean; rooms?: OpenRoomInfo[] };
      if (data?.ok && Array.isArray(data.rooms)) return data.rooms;
      return [];
    } catch {
      if (i === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return [];
}

// ===== push-события сокета (WS-режим) =====

/** мгновенные изменения состояния комнаты (ход соперника, реванш, статус) */
export function mpOnView(cb: (view: MpRoomView) => void): () => void {
  return getWs().onView(cb);
}

/** список открытых комнат (сервер рассылает лобби каждые ~3с) */
export function mpOnRooms(cb: (rooms: OpenRoomInfo[]) => void): () => void {
  return getWs().onRooms(cb);
}

/** статус соединения: false — связь потеряна, true — восстановлена */
export function mpOnNet(cb: (connected: boolean) => void): () => void {
  return getWs().onStatus(cb);
}

/** включён ли WS-режим (NEXT_PUBLIC_WS_URL задан) */
export function mpWsEnabled(): boolean {
  return wsEnabled();
}

/** немедленно пересоздать соединение (возврат вкладки на экран) */
export function mpWsReconnect(): void {
  getWs().forceReconnect();
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
    case 'ownroom': return 'mp_own_room';
    case 'conflict': return 'mp_conflict';
    case 'net': return 'mp_net';
    default: return 'mp_net';
  }
}
