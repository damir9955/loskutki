'use client';

/**
 * WebSocket-транспорт онлайн-режима «Лоскутки».
 *
 * Подключается к серверу Deno Deploy (адрес — NEXT_PUBLIC_WS_URL, задаётся
 * в настройках Vercel; пусто → игра работает по старым API-роутам Vercel).
 *
 * Стабильность (главные правила):
 *  — запрос/ответ по ref: каждая mp* функция — это {ref, t, ...} и ответ
 *    {ref, ok, ...}; приложение не знает, что под ним сокет;
 *  — авто-reconnect: обрыв (Wi-Fi↔4G, сон сервера) не выкидывает из
 *    партии — переподключение каждые 1–1.5с в фоне, экраны узнают об
 *    этом событиями статуса и подтягивают полное состояние по state;
 *  — watchdog: если от сервера 10с нет ни одного сообщения — клиент сам
 *    шлёт ping (мобильные сети убивают «молчащие» соединения); если и
 *    это не помогло за 25с — соединение пересоздаётся с нуля;
 *  — экономия батареи: когда никто не подписан на события и нет
 *    запросов, сокет закрывается сам (следующий запрос поднимет снова).
 */

import type { MpRoomView } from './game/types';

export interface OpenRoomInfo {
  code: string;
  hostName: string;
  hostAvatar: string;
  createdAt: number;
  /** комната быстрого матча (создана автопоиском) — лобби показывает ⚡ */
  quick?: boolean;
}

interface PendingReq {
  resolve: (m: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ViewListener = (view: MpRoomView) => void;
type RoomsListener = (rooms: OpenRoomInfo[]) => void;
type StatusListener = (connected: boolean) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_JITTER_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;
const WATCHDOG_CHECK_MS = 4_000;
const WATCHDOG_PING_MS = 10_000; // молчание сервера → шлём ping сами
const WATCHDOG_KILL_MS = 25_000; // совсем глухое молчание → пересоздать сокет
const IDLE_CLOSE_MS = 60_000; // нет подписок и запросов → закрыть сокет

/** адрес WS-сервера (пусто — WS-режим выключен, работаем через API-роуты) */
export function wsUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_WS_URL ?? '').trim();
  if (!raw) return '';
  let u = raw.replace(/\/+$/, '');
  if (/^wss:\/\//i.test(u) || /^ws:\/\//i.test(u)) return u;
  if (/^https:\/\//i.test(u)) return 'wss://' + u.slice(8);
  if (/^http:\/\//i.test(u)) return 'ws://' + u.slice(7);
  return 'wss://' + u; // голое имя вида имя.deno.dev
}

/** включён ли WebSocket-режим */
export function wsEnabled(): boolean {
  return wsUrl() !== '';
}

export class WsError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

class WsClient {
  private sock: WebSocket | null = null;
  private connecting: Promise<boolean> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private refSeq = 1;
  private pending = new Map<number, PendingReq>();
  private viewSubs = new Set<ViewListener>();
  private roomsSubs = new Set<RoomsListener>();
  private statusSubs = new Set<StatusListener>();
  private lastMsgAt = 0;
  private closedByIdle = false;

  isOpen(): boolean {
    return this.sock !== null && this.sock.readyState === WebSocket.OPEN;
  }

  /** установить соединение (одно на страницу); true — сокет открыт */
  connect(): Promise<boolean> {
    if (this.isOpen()) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    const url = wsUrl();
    if (!url || typeof window === 'undefined') return Promise.resolve(false);
    this.closedByIdle = false;
    this.connecting = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.connecting = null;
        resolve(ok);
      };
      try {
        const ws = new WebSocket(url);
        this.sock = ws;
        const failTimer = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            try {
              ws.close();
            } catch { /* ignore */ }
            done(false);
          }
        }, 5000);
        ws.onopen = () => {
          clearTimeout(failTimer);
          this.lastMsgAt = Date.now();
          this.startWatchdog();
          this.fireStatus(true);
          done(true);
        };
        ws.onclose = () => {
          clearTimeout(failTimer);
          if (this.sock === ws) this.sock = null;
          this.rejectAllPending('net');
          this.fireStatus(false);
          done(false);
          this.scheduleReconnect();
        };
        ws.onerror = () => { /* onclose вызовется следом */ };
        ws.onmessage = (ev) => {
          this.lastMsgAt = Date.now();
          this.handleMessage(String(ev.data));
        };
      } catch {
        done(false);
        this.scheduleReconnect();
      }
    });
    return this.connecting;
  }

  /** авто-reconnect в фоне (обрыв связи не выкидывает из партии) */
  private scheduleReconnect(): void {
    if (this.closedByIdle || this.retryTimer) return;
    const delay = RECONNECT_BASE_MS + Math.random() * RECONNECT_JITTER_MS;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /** немедленно пересоздать соединение (возврат вкладки на экран) */
  forceReconnect(): void {
    if (this.isOpen()) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.connect();
  }

  private rawSend(obj: Record<string, unknown>): void {
    if (!this.isOpen()) return;
    try {
      this.sock!.send(JSON.stringify(obj));
    } catch { /* сокет умер — onclose всё починит */ }
  }

  /** запрос с ожиданием ответа по ref */
  request<T extends Record<string, unknown>>(t: string, payload: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      void this.connect().then((ok) => {
        if (!ok) {
          reject(new WsError('net'));
          return;
        }
        const ref = this.refSeq++;
        const timer = setTimeout(() => {
          this.pending.delete(ref);
          reject(new WsError('net'));
        }, timeoutMs);
        this.pending.set(ref, {
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m as T);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
          timer,
        });
        this.rawSend({ ref, t, ...payload });
      });
    });
  }

  private handleMessage(raw: string): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
      if (!m || typeof m !== 'object') return;
    } catch {
      return; // мусор игнорируем
    }
    // ответ на запрос
    if (typeof m.ref === 'number' && this.pending.has(m.ref)) {
      const p = this.pending.get(m.ref)!;
      this.pending.delete(m.ref);
      if (m.ok === false) {
        p.reject(new WsError(typeof m.error === 'string' ? m.error : 'net'));
      } else {
        p.resolve(m);
      }
      return;
    }
    // серверные push-события
    const t = typeof m.t === 'string' ? m.t : '';
    if (t === 'view' && m.view) {
      for (const cb of this.viewSubs) {
        try {
          cb(m.view as MpRoomView);
        } catch { /* подписчик ошибся — не роняем транспорт */ }
      }
    } else if (t === 'rooms' && Array.isArray(m.rooms)) {
      const rooms = m.rooms as OpenRoomInfo[];
      for (const cb of this.roomsSubs) {
        try {
          cb(rooms);
        } catch { /* ignore */ }
      }
    } else if (t === 'ping') {
      // heartbeat сервера — отвечаем мгновенно
      this.rawSend({ t: 'pong', id: m.id });
    }
  }

  private rejectAllPending(code: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new WsError(code));
    }
    this.pending.clear();
  }

  private fireStatus(connected: boolean): void {
    for (const cb of this.statusSubs) {
      try {
        cb(connected);
      } catch { /* ignore */ }
    }
  }

  /** watchdog: живость соединения + экономия батареи */
  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      if (!this.isOpen()) {
        return; // reconnect уже расписан
      }
      // сервер молчит — шлём ping сами (мобильные сети душат молчание)
      if (now - this.lastMsgAt > WATCHDOG_PING_MS) {
        void this.request('ping', {}, 3000).catch(() => { /* ответа нет — см. ниже */ });
      }
      // совсем глухое молчание — пересоздаём соединение с нуля
      if (now - this.lastMsgAt > WATCHDOG_KILL_MS) {
        const dead = this.sock;
        try {
          dead?.close();
        } catch { /* ignore */ }
        if (this.sock === dead) this.sock = null;
        this.rejectAllPending('net');
        this.forceReconnect();
        return;
      }
      // никому не нужно соединение — закрываем (батарея мобильных)
      if (
        this.viewSubs.size === 0 &&
        this.roomsSubs.size === 0 &&
        this.statusSubs.size === 0 &&
        this.pending.size === 0 &&
        now - this.lastMsgAt > IDLE_CLOSE_MS
      ) {
        this.closedByIdle = true;
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          this.retryTimer = null;
        }
        const idle = this.sock;
        try {
          idle?.close();
        } catch { /* ignore */ }
        if (this.sock === idle) this.sock = null;
      }
    }, WATCHDOG_CHECK_MS);
  }

  // ===== подписки на push =====

  onView(cb: ViewListener): () => void {
    this.viewSubs.add(cb);
    void this.connect();
    return () => this.viewSubs.delete(cb);
  }

  onRooms(cb: RoomsListener): () => void {
    this.roomsSubs.add(cb);
    void this.connect();
    return () => this.roomsSubs.delete(cb);
  }

  onStatus(cb: StatusListener): () => void {
    this.statusSubs.add(cb);
    if (this.isOpen()) cb(true);
    void this.connect();
    return () => this.statusSubs.delete(cb);
  }
}

let client: WsClient | null = null;

/** синглтон соединения (одно на страницу) */
export function getWs(): WsClient {
  if (!client) client = new WsClient();
  return client;
}
