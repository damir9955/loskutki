'use client';

/**
 * Друзья: клиентский стор поверх WS-событий сервера.
 *
 * Идентичность: у каждого игрока есть постоянный uid (8 знаков, хранится
 * в профиле localStorage, генерируется один раз) — он же публичный
 * «ID для друзей». Сервер узнаёт его по сообщению hello (отправляется
 * при каждом подключении/переподключении сокета) и дальше пушит сюда
 * события: fr_req (заявка), fr_ok (теперь друзья), fr_gone (удалили),
 * fr_msg (сообщение чата), fr_invite / fr_invite_gone (приглашение в игру).
 *
 * Пока есть подписчики (компонент с useFriends) и игрок онлайн — сокет
 * держится открытым: приглашения и сообщения приходят даже в главном меню.
 * В HTTP-фолбэк-режиме (без WS) раздел недоступен — стор сообщает об этом.
 */

import { useSyncExternalStore } from 'react';
import {
  formatFriendCode,
  loadProfile,
  mpOnFriends,
  mpOnNet,
  mpWsEnabled,
  normalizeFriendCode,
  setProfileListener,
  type MpProfile,
} from './net';
import { getWs, wsEnabled } from './ws';
import type { MpRoomView } from './game/types';

export interface FriendInfo {
  uid: string;
  name: string;
  avatar: string;
  online: boolean;
  unread: number;
}

export interface FriendRequestInfo {
  from: { uid: string; name: string; avatar: string };
  at: number;
}

export interface InviteInfo {
  from: { uid: string; name: string; avatar: string };
  code: string;
  at: number;
}

export interface ChatMsg {
  id: string;
  from: string;
  text: string;
  at: number;
}

export interface FriendsState {
  /** hello прошёл — снапшот с сервера получен */
  ready: boolean;
  /** доступен ли раздел (нужен WS-режим) */
  available: boolean;
  /** сервер хранит друзей в базе (Deno KV): false — данные живут
   *  только до перезапуска сервера (клиент показывает предупреждение) */
  persist: boolean;
  /** мой ID для друзей (отформатированный XXXX-XXXX) */
  code: string;
  friends: FriendInfo[];
  requests: FriendRequestInfo[];
  /** мои исходящие заявки — «ожидает подтверждения» */
  outgoing: string[];
  invites: InviteInfo[];
  /** открытый чат (uid друга) */
  chatWith: string | null;
  chat: ChatMsg[];
}

/** события для тостов/индикации (подписка на уровне приложения) */
export type FriendsUiEvent =
  | { kind: 'req'; from: string; name: string }
  | { kind: 'ok'; name: string }
  | { kind: 'gone'; name: string }
  | { kind: 'msg'; from: string; name: string; text: string }
  | { kind: 'invite'; from: string; name: string }
  | { kind: 'invite_gone'; from: string; name: string };

const INVITE_TTL_MS = 60_000;

const EMPTY: FriendsState = {
  ready: false,
  available: false,
  persist: true,
  code: '',
  friends: [],
  requests: [],
  outgoing: [],
  invites: [],
  chatWith: null,
  chat: [],
};

let state: FriendsState = EMPTY;
const listeners = new Set<() => void>();
const uiListeners = new Set<(e: FriendsUiEvent) => void>();

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch { /* ignore */ }
  }
}

function notifyUi(e: FriendsUiEvent): void {
  for (const l of uiListeners) {
    try {
      l(e);
    } catch { /* ignore */ }
  }
}

export function subscribeFriends(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getFriendsSnapshot(): FriendsState {
  return state;
}

export function getFriendsServerSnapshot(): FriendsState {
  return EMPTY;
}

/** подписка на события друзей (тосты/индикация) на уровне приложения */
export function onFriendsUiEvent(cb: (e: FriendsUiEvent) => void): () => void {
  uiListeners.add(cb);
  return () => {
    uiListeners.delete(cb);
  };
}

export function useFriends(): FriendsState {
  return useSyncExternalStore(subscribeFriends, getFriendsSnapshot, getFriendsServerSnapshot);
}

// ===== снапшот и события сервера =====

interface FrSnapshotWire {
  code?: string;
  friends?: FriendInfo[];
  requests?: FriendRequestInfo[];
  outgoing?: Array<{ uid: string; at: number }>;
  invites?: InviteInfo[];
}

function applySnapshot(s: FrSnapshotWire | undefined): void {
  if (!s) return;
  const now = Date.now();
  const invites = (s.invites ?? []).filter((i) => now - (i.at ?? 0) < INVITE_TTL_MS);
  state = {
    ...state,
    ready: true,
    code: typeof s.code === 'string' && s.code ? formatFriendCode(s.code) : state.code,
    friends: s.friends ?? [],
    requests: s.requests ?? [],
    outgoing: (s.outgoing ?? []).map((o) => o.uid),
    invites,
    // чат остаётся, если друг ещё в списке
    chatWith: state.chatWith && (s.friends ?? []).some((f) => f.uid === state.chatWith) ? state.chatWith : null,
    chat: state.chatWith && (s.friends ?? []).some((f) => f.uid === state.chatWith) ? state.chat : [],
  };
  emit();
}

function handleServerEvent(m: Record<string, unknown>): void {
  const t = typeof m.t === 'string' ? m.t : '';
  if (t === 'fr_req') {
    const req = m.req as FriendRequestInfo | undefined;
    if (req?.from?.uid) {
      state = { ...state, requests: [req, ...state.requests.filter((r) => r.from.uid !== req.from.uid)] };
      emit();
      notifyUi({ kind: 'req', from: req.from.uid, name: req.from.name });
      void frSync(); // освежить исходящие (встречная заявка могла стать дружбой)
    }
  } else if (t === 'fr_ok') {
    const user = m.user as { uid: string; name: string } | undefined;
    if (user?.uid) notifyUi({ kind: 'ok', name: user.name });
    void frSync();
  } else if (t === 'fr_gone') {
    const uid = typeof m.uid === 'string' ? m.uid : '';
    const name = state.friends.find((f) => f.uid === uid)?.name ?? '';
    if (uid) {
      state = {
        ...state,
        friends: state.friends.filter((f) => f.uid !== uid),
        chatWith: state.chatWith === uid ? null : state.chatWith,
        chat: state.chatWith === uid ? [] : state.chat,
      };
      emit();
      notifyUi({ kind: 'gone', name });
    }
  } else if (t === 'fr_msg') {
    const from = typeof m.from === 'string' ? m.from : '';
    const msg = m.msg as ChatMsg | undefined;
    if (from && msg?.id) {
      const friend = state.friends.find((f) => f.uid === from);
      if (state.chatWith === from) {
        // чат открыт — просто дописываем и считаем прочитанным
        state = { ...state, chat: [...state.chat.filter((x) => x.id !== msg.id), msg] };
        emit();
        void getWs().request('fr_read', { uid: from }).catch(() => { /* offline — потом */ });
      } else if (friend) {
        state = {
          ...state,
          friends: state.friends.map((f) => (f.uid === from ? { ...f, unread: f.unread + 1 } : f)),
        };
        emit();
      }
      notifyUi({ kind: 'msg', from, name: friend?.name ?? '', text: msg.text ?? '' });
    }
  } else if (t === 'fr_invite') {
    const inv = m.invite as InviteInfo | undefined;
    if (inv?.from?.uid && inv.code) {
      state = { ...state, invites: [inv, ...state.invites.filter((i) => i.from.uid !== inv.from.uid)] };
      emit();
      notifyUi({ kind: 'invite', from: inv.from.uid, name: inv.from.name });
    }
  } else if (t === 'fr_invite_gone') {
    const from = typeof m.from === 'string' ? m.from : '';
    if (from) {
      const name = state.friends.find((f) => f.uid === from)?.name ?? '';
      state = { ...state, invites: state.invites.filter((i) => i.from.uid !== from) };
      emit();
      notifyUi({ kind: 'invite_gone', from, name });
    }
  }
}

// ===== boot: hello при подключении + переподключениях =====

let booted = false;
let helloTimer: ReturnType<typeof setTimeout> | null = null;

async function sendHello(profile: MpProfile): Promise<void> {
  if (!wsEnabled()) return;
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire; persist?: boolean }>('hello', {
      uid: profile.uid,
      name: profile.name,
      avatar: profile.avatar,
    });
    applySnapshot(r.snapshot);
    // persist=false — на сервере не подключена база: друзья живут только
    // до перезапуска изолята (предупреждение в разделе друзей)
    if (typeof r.persist === 'boolean' && r.persist !== state.persist) {
      state = { ...state, persist: r.persist };
      emit();
    }
  } catch {
    // сеть моргнула — onStatus переподключит и повторит hello
  }
}

/** инициализация раздела друзей (вызывается один раз на уровне страницы) */
export function frBoot(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  state = { ...state, available: mpWsEnabled(), code: formatFriendCode(loadProfile().uid) };
  emit();
  if (!mpWsEnabled()) return;

  // события сервера → стор
  mpOnFriends(handleServerEvent);

  // (пере)подключение сокета → повторный hello (сервер привязывает uid)
  mpOnNet((connected) => {
    if (!connected) {
      state = { ...state, ready: false };
      emit();
      return;
    }
    if (helloTimer) clearTimeout(helloTimer);
    helloTimer = setTimeout(() => void sendHello(loadProfile()), 150);
  });

  // сокет мог уже быть открыт (быстрее, чем onStatus)
  if (helloTimer) clearTimeout(helloTimer);
  helloTimer = setTimeout(() => void sendHello(loadProfile()), 60);

  // профиль поправили (имя/аватар) — перерегистрироваться
  setProfileListener((p) => {
    if (helloTimer) clearTimeout(helloTimer);
    helloTimer = setTimeout(() => void sendHello(p), 200);
  });
}

// ===== действия (все — запросы к WS-серверу) =====

export function frErrorKey(code: string): string {
  switch (code) {
    case 'badcode': return 'fr_bad_code';
    case 'self': return 'fr_self';
    case 'already': return 'fr_already';
    case 'toomany': return 'fr_toomany';
    case 'gone': return 'fr_room_gone';
    case 'notfriends': return 'fr_not_friends';
    case 'inroom': return 'fr_inroom';
    default: return 'mp_net';
  }
}

/** добавить друга по ID (или по uid — из матча) */
export async function frAdd(code: string): Promise<{ ok: boolean; accepted?: boolean; error?: string }> {
  const uid = normalizeFriendCode(code);
  if (!uid) return { ok: false, error: 'badcode' };
  try {
    const r = await getWs().request<{ accepted?: boolean; snapshot?: FrSnapshotWire }>('fr_add', { code: uid });
    applySnapshot(r.snapshot);
    return { ok: true, accepted: r.accepted === true };
  } catch (e) {
    return { ok: false, error: (e as { code?: string })?.code ?? 'net' };
  }
}

export async function frAccept(uid: string): Promise<boolean> {
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire }>('fr_accept', { uid });
    applySnapshot(r.snapshot);
    return true;
  } catch {
    return false;
  }
}

export async function frDecline(uid: string): Promise<void> {
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire }>('fr_decline', { uid });
    applySnapshot(r.snapshot);
  } catch { /* сеть — не критично */ }
}

export async function frRemove(uid: string): Promise<void> {
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire }>('fr_remove', { uid });
    applySnapshot(r.snapshot);
  } catch { /* сеть — не критично */ }
}

/** отправить сообщение в чат */
export async function frSendMsg(to: string, text: string): Promise<boolean> {
  const clean = text.trim().slice(0, 300);
  if (!clean) return false;
  try {
    const r = await getWs().request<{ msg?: ChatMsg }>('fr_msg', { to, text: clean });
    const msg = r.msg as ChatMsg | undefined;
    if (msg?.id) {
      state = { ...state, chat: [...state.chat.filter((x) => x.id !== msg.id), msg] };
      emit();
    }
    return true;
  } catch {
    return false;
  }
}

/** открыть чат с другом (история + отметить прочитанным) */
export async function frOpenChat(uid: string): Promise<void> {
  state = { ...state, chatWith: uid, chat: [] };
  emit();
  try {
    const r = await getWs().request<{ msgs?: ChatMsg[] }>('fr_chat', { uid });
    if (state.chatWith === uid) {
      state = { ...state, chat: r.msgs ?? [] };
      // непрочитанное погашено
      state = { ...state, friends: state.friends.map((f) => (f.uid === uid ? { ...f, unread: 0 } : f)) };
      emit();
    }
  } catch { /* сеть — история подтянется позже */ }
}

export function frCloseChat(): void {
  state = { ...state, chatWith: null, chat: [] };
  emit();
}

/** позвать друга на битву: сервер создаёт/переиспользует комнату и
 *  доставляет другу приглашение; ответ — сессия хоста для экрана ожидания */
export async function frInvite(
  to: string,
): Promise<{ ok: boolean; code?: string; playerId?: string; error?: string }> {
  try {
    const r = await getWs().request<{ code?: string; playerId?: string }>('fr_invite', { to });
    return { ok: true, code: r.code, playerId: r.playerId };
  } catch (e) {
    return { ok: false, error: (e as { code?: string })?.code ?? 'net' };
  }
}

/** принять приглашение: сервер сажает в комнату — получаем сессию */
export async function frInviteAccept(
  from: string,
): Promise<{ ok: boolean; code?: string; playerId?: string; error?: string }> {
  const p = loadProfile();
  try {
    const r = await getWs().request<{ code?: string; playerId?: string }>('fr_invite_accept', {
      uid: from,
      name: p.name,
      avatar: p.avatar,
    });
    state = { ...state, invites: state.invites.filter((i) => i.from.uid !== from) };
    emit();
    return { ok: true, code: r.code, playerId: r.playerId };
  } catch (e) {
    state = { ...state, invites: state.invites.filter((i) => i.from.uid !== from) };
    emit();
    return { ok: false, error: (e as { code?: string })?.code ?? 'net' };
  }
}

export async function frInviteDecline(from: string): Promise<void> {
  state = { ...state, invites: state.invites.filter((i) => i.from.uid !== from) };
  emit();
  try {
    await getWs().request('fr_invite_decline', { uid: from });
  } catch { /* сеть — приглашение протухнет само */ }
}

/** освежить снапшот (присутствие/непрочитанное) — например, раз в 8с,
 *  пока открыт диалог друзей */
export async function frSync(): Promise<void> {
  if (!wsEnabled()) return;
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire; persist?: boolean }>('fr_sync', {});
    applySnapshot(r.snapshot);
    if (typeof r.persist === 'boolean' && r.persist !== state.persist) {
      state = { ...state, persist: r.persist };
      emit();
    }
  } catch { /* сеть — не критично */ }
}

/** локальная встряска состояния при записи партии против друга */
export function frTouchStats(uid: string): void {
  // статистика живёт в storage.ts (friendStats); стору друзей достаточно
  // лёгкого сигнала, чтобы список перерисовался с новыми цифрами
  if (state.friends.some((f) => f.uid === uid)) emit();
}

/** внутреннее: тип вида комнаты (переиспользуется страницей при переходе) */
export type { MpRoomView };
