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
 * Карманная копия (v3.6.0): список друзей, заявки и переписка дублируются
 * в localStorage устройства. Если сервер работает без базы (D1/KV) и
 * «забыл» всё после простоя — копия возвращается ему командой fr_restore
 * при hello, а до ответа сервера список друзей уже виден из копии.
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
  /** сервер хранит друзей в базе (D1/KV): false — без базы, данные
   *  восстанавливаются с устройств игроков (карманная копия + fr_restore) */
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

// ===== карманная копия (localStorage) — друзья/чаты живут на устройстве =====
// Сервер без базы «спит» и просыпается с чистой памятью: эта копия —
// источник восстановления (команда fr_restore при hello, если сервер
// ответил persist=false). С базой (D1/KV) копия остаётся мгновенным
// офлайн-кэшем: список друзей виден ещё до ответа сервера.

const POCKET_KEY = 'loskutki.friends.v1';
const POCKET_CHAT_CAP = 80; // как на сервере (CHAT_CAP)
const POCKET_FRIEND_CAP = 50; // как на сервере (MAX_FRIENDS)
const POCKET_RESTORE_MS = 30_000; // fr_restore не чаще раза в 30с

interface PocketData {
  v: 1;
  friends: FriendInfo[];
  requests: FriendRequestInfo[];
  outgoing: Array<{ uid: string; at: number }>;
  chats: Record<string, ChatMsg[]>;
  read: Record<string, number>;
  savedAt: number;
}

let pocket: PocketData = { v: 1, friends: [], requests: [], outgoing: [], chats: {}, read: {}, savedAt: 0 };
let lastRestoreAt = 0;

function pocketSanitizeMsgs(raw: unknown): ChatMsg[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMsg[] = [];
  for (const r of raw) {
    const m = r as ChatMsg;
    if (typeof m?.id !== 'string' || m.id.length > 48) continue;
    if (typeof m?.from !== 'string' || !m.from) continue;
    if (typeof m?.text !== 'string' || !m.text) continue;
    out.push({ id: m.id, from: m.from, text: m.text.slice(0, 300), at: typeof m.at === 'number' ? m.at : 0 });
  }
  return out.slice(-POCKET_CHAT_CAP);
}

function pocketLoad(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(POCKET_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<PocketData>;
    if (p?.v !== 1) return;
    const chats: Record<string, ChatMsg[]> = {};
    const rawChats = p.chats && typeof p.chats === 'object' ? p.chats : {};
    let peers = 0;
    for (const [uid, msgs] of Object.entries(rawChats)) {
      if (peers >= POCKET_FRIEND_CAP) break;
      if (!/^[A-Z0-9]{8}$/i.test(uid)) continue;
      chats[uid] = pocketSanitizeMsgs(msgs);
      peers++;
    }
    const read: Record<string, number> = {};
    const rawRead = p.read && typeof p.read === 'object' ? p.read : {};
    for (const [uid, at] of Object.entries(rawRead)) {
      if (/^[A-Z0-9]{8}$/i.test(uid) && typeof at === 'number') read[uid] = at;
    }
    pocket = {
      v: 1,
      friends: Array.isArray(p.friends)
        ? p.friends.filter((f) => f && typeof f.uid === 'string').slice(0, POCKET_FRIEND_CAP)
        : [],
      requests: Array.isArray(p.requests)
        ? p.requests.filter((r) => r?.from?.uid).slice(0, 20)
        : [],
      outgoing: Array.isArray(p.outgoing)
        ? p.outgoing.filter((o) => typeof o?.uid === 'string').slice(0, 20)
        : [],
      chats,
      read,
      savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
    };
  } catch { /* битый JSON — начинаем с пустой копии */ }
}

function pocketSave(): void {
  if (typeof window === 'undefined') return;
  try {
    pocket.savedAt = Date.now();
    localStorage.setItem(POCKET_KEY, JSON.stringify(pocket));
  } catch { /* переполнение хранилища — не критично */ }
}

/** дописать сообщение в карманную копию переписки */
function pocketPushChat(uid: string, msg: ChatMsg): void {
  const list = pocket.chats[uid] ?? [];
  if (list.some((m) => m.id === msg.id)) return;
  pocket.chats[uid] = [...list, msg].slice(-POCKET_CHAT_CAP);
  pocketSave();
}

// ===== снапшот и события сервера =====

interface FrSnapshotWire {
  code?: string;
  friends?: FriendInfo[];
  requests?: FriendRequestInfo[];
  outgoing?: Array<{ uid: string; at: number }>;
  invites?: InviteInfo[];
}

/** применить снапшот сервера. persistKnown=true — на сервере база
 *  (D1/KV), снапшот — полный авторитет. Иначе (память) ПУСТОЙ снапшот
 *  может означать «сервер проспал и всё забыл» — карманную копию не
 *  затираем: её вернём серверу командой fr_restore при hello. */
function applySnapshot(s: FrSnapshotWire | undefined, persistKnown?: boolean): void {
  if (!s) return;
  const now = Date.now();
  const invites = (s.invites ?? []).filter((i) => now - (i.at ?? 0) < INVITE_TTL_MS);
  const wireFriends = s.friends ?? [];
  const wireRequests = s.requests ?? [];
  const wireOutgoing = (s.outgoing ?? []).map((o) => ({
    uid: String(o.uid ?? ''),
    at: typeof o.at === 'number' ? o.at : now,
  }));
  const authoritative = persistKnown === true;
  // защита кармана: пустота от сервера без базы — не повод стирать копию
  const keepFriends = !authoritative && wireFriends.length === 0 && pocket.friends.length > 0;
  const keepRequests = !authoritative && wireRequests.length === 0 && pocket.requests.length > 0;
  const keepOutgoing = !authoritative && wireOutgoing.length === 0 && pocket.outgoing.length > 0;
  const friends = keepFriends ? state.friends : wireFriends;
  // заявка к уже-другу — точно устарела (дружба состоялась)
  const friendUids = new Set(friends.map((f) => f.uid));
  if (!keepFriends) pocket.friends = wireFriends.slice(0, POCKET_FRIEND_CAP);
  if (!keepRequests) pocket.requests = wireRequests.slice(0, 20);
  else pocket.requests = pocket.requests.filter((r) => !friendUids.has(r.from.uid));
  if (!keepOutgoing) pocket.outgoing = wireOutgoing.slice(0, 20);
  else pocket.outgoing = pocket.outgoing.filter((o) => !friendUids.has(o.uid));
  pocketSave();
  state = {
    ...state,
    ready: true,
    code: typeof s.code === 'string' && s.code ? formatFriendCode(s.code) : state.code,
    friends,
    requests: (keepRequests ? state.requests : wireRequests).filter((r) => !friendUids.has(r.from.uid)),
    outgoing: (keepOutgoing ? state.outgoing : wireOutgoing.map((o) => o.uid)).filter((uid) => !friendUids.has(uid)),
    invites,
    // чат остаётся, если друг ещё в списке
    chatWith: state.chatWith && friends.some((f) => f.uid === state.chatWith) ? state.chatWith : null,
    chat: state.chatWith && friends.some((f) => f.uid === state.chatWith) ? state.chat : [],
  };
  emit();
}

/** убрать друга везде (список, чат, карман) — при удалении из друзей */
function pruneFriend(uid: string): void {
  pocket.friends = pocket.friends.filter((f) => f.uid !== uid);
  delete pocket.chats[uid];
  delete pocket.read[uid];
  pocketSave();
  state = {
    ...state,
    friends: state.friends.filter((f) => f.uid !== uid),
    chatWith: state.chatWith === uid ? null : state.chatWith,
    chat: state.chatWith === uid ? [] : state.chat,
  };
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
      pruneFriend(uid);
      emit();
      notifyUi({ kind: 'gone', name });
    }
  } else if (t === 'fr_msg') {
    const from = typeof m.from === 'string' ? m.from : '';
    const msg = m.msg as ChatMsg | undefined;
    if (from && msg?.id) {
      pocketPushChat(from, msg); // карманная копия переписки
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
    applySnapshot(r.snapshot, r.persist !== false);
    // persist=false — сервер без базы: друзья восстановятся на нём из
    // карманных копий устройств (ниже) — предупреждение не нужно
    if (typeof r.persist === 'boolean' && r.persist !== state.persist) {
      state = { ...state, persist: r.persist };
      emit();
    }
    // сервер без базы: вернуть ему карманную копию — он наполнит память
    if (r.persist === false) void sendRestore();
  } catch {
    // сеть моргнула — onStatus переподключит и повторит hello
  }
}

/** вернуть серверу (без базы) карманную копию: друзья/заявки/чаты/
 *  «прочитано». Ответ — канонический снапшот после слияния. */
async function sendRestore(): Promise<void> {
  if (!wsEnabled()) return;
  const now = Date.now();
  if (now - lastRestoreAt < POCKET_RESTORE_MS) return;
  const hasData =
    pocket.friends.length > 0 ||
    pocket.requests.length > 0 ||
    pocket.outgoing.length > 0 ||
    Object.keys(pocket.chats).length > 0 ||
    Object.keys(pocket.read).length > 0;
  if (!hasData) return;
  lastRestoreAt = now;
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire; restored?: number }>('fr_restore', {
      friends: pocket.friends.map(({ uid, name, avatar }) => ({ uid, name, avatar })),
      requests: pocket.requests.slice(0, 20),
      outgoing: pocket.outgoing.slice(0, 20),
      chats: pocket.chats,
      read: pocket.read,
    });
    applySnapshot(r.snapshot, false);
  } catch {
    // сеть моргнула — при следующем подключении повторится с hello
    lastRestoreAt = 0;
  }
}

/** инициализация раздела друзей (вызывается один раз на уровне страницы) */
export function frBoot(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  pocketLoad();
  state = {
    ...state,
    available: mpWsEnabled(),
    code: formatFriendCode(loadProfile().uid),
    // карманная копия: список/заявки видны сразу, даже до ответа сервера
    friends: pocket.friends,
    requests: pocket.requests,
    outgoing: pocket.outgoing.map((o) => o.uid),
  };
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
  pocket.requests = pocket.requests.filter((r) => r.from.uid !== uid);
  pocketSave();
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire }>('fr_accept', { uid });
    applySnapshot(r.snapshot);
    return true;
  } catch {
    return false;
  }
}

export async function frDecline(uid: string): Promise<void> {
  pocket.requests = pocket.requests.filter((r) => r.from.uid !== uid);
  pocketSave();
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire }>('fr_decline', { uid });
    applySnapshot(r.snapshot);
  } catch { /* сеть — не критично */ }
}

export async function frRemove(uid: string): Promise<void> {
  try {
    const r = await getWs().request<{ snapshot?: FrSnapshotWire }>('fr_remove', { uid });
    pruneFriend(uid);
    applySnapshot(r.snapshot);
  } catch {
    pruneFriend(uid);
  }
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
      pocketPushChat(to, msg); // карманная копия переписки
      emit();
    }
    return true;
  } catch {
    return false;
  }
}

/** открыть чат с другом (история из кармана сразу + слияние с сервером) */
export async function frOpenChat(uid: string): Promise<void> {
  const local = pocket.chats[uid] ?? [];
  state = { ...state, chatWith: uid, chat: local };
  pocket.read[uid] = Date.now();
  pocketSave();
  emit();
  try {
    const r = await getWs().request<{ msgs?: ChatMsg[] }>('fr_chat', { uid });
    if (state.chatWith === uid) {
      // слияние истории сервера и кармана: по id, по времени
      const byId = new Map<string, ChatMsg>();
      for (const m of [...local, ...(r.msgs ?? [])]) byId.set(m.id, m);
      const merged = [...byId.values()].sort((a, b) => a.at - b.at).slice(-POCKET_CHAT_CAP);
      pocket.chats[uid] = merged;
      pocketSave();
      state = { ...state, chat: merged };
      // непрочитанное погашено
      state = { ...state, friends: state.friends.map((f) => (f.uid === uid ? { ...f, unread: 0 } : f)) };
      emit();
    }
  } catch { /* сеть/«не друзья» (сервер без базы ещё не восстановился) —
              локальная история уже показана, сервер догонит после fr_restore */ }
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
    applySnapshot(r.snapshot, r.persist !== false);
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
