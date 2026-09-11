'use client';

/**
 * Экран онлайн-режима «С другом»:
 *  — профиль (имя + реалистичный портрет),
 *  — БЫСТРАЯ ИГРА: автопоиск — пару с тем, кто тоже ищет, или вход
 *    в первую открытую комнату (сервер решает атомарно),
 *  — создать комнату (приватную по коду или открытую — видна в поиске),
 *  — войти по 6-значному коду,
 *  — список открытых комнат (авто-обновление),
 *  — экран ожидания соперника с крупным кодом.
 * Партия стартует, как только второй игрок входит в комнату.
 *
 * Стабильность: «notfound» от сервера не выкидывает из комнаты мгновенно —
 * сервер мог рестартовать (комнаты поднимаются из снапшота), даём 3 попытки.
 * Стрелка «назад» с экрана ожидания НЕ уничтожает комнату — вернуться можно
 * из списка («ваша комната» → «Вернуться»). Комната отменяется только
 * явной кнопкой «Отмена».
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Check, LogIn, Plus, RefreshCw, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Portrait } from './MarketRow';
import { AVATAR_IDS, avatarUrl } from '@/lib/avatars';
import { t, useDocumentTitle } from '@/lib/i18n';
import {
  loadProfile,
  mpControl,
  mpCreate,
  mpErrorKey,
  mpJoin,
  mpListRooms,
  mpOnRooms,
  mpOnView,
  mpQuick,
  mpQuickCancel,
  mpState,
  mpWsEnabled,
  saveProfile,
  type MpSession,
} from '@/lib/net';
import type { MpRoomView } from '@/lib/game/types';
import { sound } from '@/lib/sound';
import { useToast } from '@/hooks/use-toast';

const POLL_MS = 1500;
const LIST_MS = 5000;
const QUICK_POLL_MS = 2000;
const BACKOFF_MAX_MS = 6000;
/** сколько «notfound» подряд терпим (сервер поднимает комнаты из снапшота) */
const NOTFOUND_RETRIES = 3;

interface OpenRoom {
  code: string;
  hostName: string;
  hostAvatar: string;
  createdAt: number;
}

export interface MultiplayerScreenProps {
  session: MpSession | null;
  onSessionChange: (s: MpSession | null) => void;
  onPlaying: (s: MpSession) => void;
  onExitHome: () => void;
}

export function MultiplayerScreen({ session, onSessionChange, onPlaying, onExitHome }: MultiplayerScreenProps) {
  const { toast } = useToast();
  useDocumentTitle();
  const [profile, setProfile] = useState(() => loadProfile());
  const [isPublic, setIsPublic] = useState(true);
  const [code, setCode] = useState('');
  const [openRooms, setOpenRooms] = useState<OpenRoom[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** ожидание: комната создана, ждём соперника */
  const [waiting, setWaiting] = useState(session !== null);
  const [copied, setCopied] = useState(false);
  /** сетевые сбои: не выкидываем из комнаты, показываем «переподключение» */
  const [reconnecting, setReconnecting] = useState(false);
  /** автопоиск: playerId держим в ref (поиск эфемерный, localStorage не нужен) */
  const [searching, setSearching] = useState(false);
  const [searchSec, setSearchSec] = useState(0);
  const quickIdRef = useRef<string | null>(null);
  const playingNotified = useRef(false);

  // ===== опрос своей комнаты (валидация сессии + ожидание соперника) =====
  // ВАЖНО: вылет из комнаты — только если сервер подтвердил «notfound»
  // 3 раза подряд (комната реально удалена, а не рестарт сервера).
  // Сетевые сбои — переподключение с бэкоффом.
  // WS-режим: изменения приходят мгновенно push-ом (цикл — страховка).
  useEffect(() => {
    if (!session || !waiting) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let backoff = POLL_MS;
    let notfound = 0;

    const handleView = (view: MpRoomView) => {
      if (stop) return;
      if (view.code !== session.code) return;
      if (view.status === 'playing' || view.status === 'finished') {
        notfound = 0;
        setReconnecting(false);
        if (!playingNotified.current) {
          playingNotified.current = true;
          sound.ensure();
          sound.tap();
          onPlaying(session);
        }
        return;
      }
      if (view.status === 'abandoned') {
        setReconnecting(false);
        toast({ title: t('mp_gone') });
        onSessionChange(null);
        setWaiting(false);
        return;
      }
      // status === 'waiting' — ждём дальше
    };

    // мгновенный старт партии: соперник вошёл — сокет пушнет view
    const unsubView = mpWsEnabled() ? mpOnView(handleView) : null;

    const loop = async () => {
      try {
        const { view } = await mpState({ code: session.code, playerId: session.playerId });
        if (stop) return;
        handleView(view);
      } catch (e) {
        if (stop) return;
        const errCode = (e as { code?: string })?.code ?? 'net';
        if (errCode === 'notfound') {
          notfound++;
          if (notfound > NOTFOUND_RETRIES) {
            // комната удалена на сервере — только теперь выходим
            setReconnecting(false);
            toast({ title: t('mp_gone') });
            onSessionChange(null);
            setWaiting(false);
            return;
          }
          // сервер мог рестартовать и поднимает комнаты из снапшота — ждём
          setReconnecting(true);
        } else {
          // временный сетевой сбой — остаёмся в комнате, пробуем снова
          setReconnecting(true);
          backoff = Math.min(Math.round(backoff * 1.7), BACKOFF_MAX_MS);
        }
      }
      if (!stop) timer = setTimeout(loop, backoff);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stop) {
        clearTimeout(timer);
        backoff = POLL_MS;
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      unsubView?.();
      document.removeEventListener('visibilitychange', onVisible);
    };

  }, [session?.code, waiting]);

  // ===== список открытых комнат (пока не ждём и не ищем) =====
  useEffect(() => {
    if (waiting || searching) return;
    if (mpWsEnabled()) {
      // WS-режим: сервер сам рассылает список открытых комнат (~3с)
      const unsub = mpOnRooms((rooms) => setOpenRooms(rooms));
      return unsub;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const rooms = await mpListRooms();
      if (stop) return;
      setOpenRooms(rooms);
      timer = setTimeout(refresh, LIST_MS);
    };
    void refresh();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [waiting, searching]);

  // ===== секундомер автопоиска =====
  useEffect(() => {
    if (!searching) return;
    const id = setInterval(() => setSearchSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [searching]);

  // ===== цикл автопоиска: пару с другим искателем или первой открытой комнатой =====
  useEffect(() => {
    if (!searching) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const name = profile.name.trim();
      if (name.length < 1) {
        setSearching(false);
        toast({ title: t('mp_bad_name') });
        return;
      }
      try {
        const res = await mpQuick({
          playerId: quickIdRef.current ?? undefined,
          name,
          avatar: profile.avatar,
        });
        if (stop) return;
        quickIdRef.current = res.playerId;
        setReconnecting(false);
        if (res.status === 'matched' && res.code) {
          // пару составили — прыгаем в партию
          const s: MpSession = { playerId: res.playerId, code: res.code, name, avatar: profile.avatar };
          quickIdRef.current = null;
          setSearching(false);
          sound.ensure();
          sound.tap();
          toast({ title: t('mp_quick_found') });
          onSessionChange(s);
          onPlaying(s);
          return;
        }
        // still searching
      } catch (e) {
        if (stop) return;
        const errCode = (e as { code?: string })?.code ?? 'net';
        if (errCode === 'badname') {
          setSearching(false);
          toast({ title: t('mp_bad_name') });
          return;
        }
        setReconnecting(true);
      }
      if (!stop) timer = setTimeout(loop, QUICK_POLL_MS);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stop) {
        clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [searching]);

  const stopSearch = useCallback(() => {
    const pid = quickIdRef.current;
    quickIdRef.current = null;
    setSearching(false);
    setReconnecting(false);
    if (pid) void mpQuickCancel(pid).catch(() => { /* сервер мог недосягаем */ });
  }, []);

  const setProfileAndSave = useCallback((p: { name?: string; avatar?: string }) => {
    const next = { ...profile, ...p };
    setProfile(next);
    saveProfile(next);
  }, [profile]);

  const doQuick = () => {
    const name = profile.name.trim();
    if (name.length < 1) {
      toast({ title: t('mp_bad_name') });
      return;
    }
    sound.ensure();
    sound.tap();
    setSearchSec(0);
    setSearching(true);
  };

  const doCreate = async () => {
    if (busy) return;
    const name = profile.name.trim();
    if (name.length < 1) {
      toast({ title: t('mp_bad_name') });
      return;
    }
    setBusy(true);
    sound.ensure();
    sound.tap();
    try {
      // уже есть живая комната? — вторую не создаём, возвращаемся в свою
      if (session) {
        try {
          const { view } = await mpState({ code: session.code, playerId: session.playerId });
          if (view.status === 'playing' || view.status === 'finished') {
            onPlaying(session);
            return;
          }
          toast({ title: t('mp_have_room') });
          setWaiting(true);
          return;
        } catch {
          // сессия мёртвая (комната удалена) — чистим и создаём новую
          onSessionChange(null);
        }
      }
      const { code: roomCode, playerId } = await mpCreate({ name, avatar: profile.avatar, isPublic });
      const s: MpSession = { playerId, code: roomCode, name, avatar: profile.avatar, isPublic };
      onSessionChange(s);
      setWaiting(true);
    } catch (e) {
      toast({ title: t(mpErrorKey((e as { code?: string })?.code ?? '')) });
    } finally {
      setBusy(false);
    }
  };

  const doJoinByCode = async () => {
    if (busy) return;
    const name = profile.name.trim();
    if (name.length < 1) {
      toast({ title: t('mp_bad_name') });
      return;
    }
    if (code.trim().length !== 6) {
      toast({ title: t('mp_bad_code') });
      return;
    }
    setBusy(true);
    sound.ensure();
    sound.tap();
    try {
      const { code: roomCode, playerId } = await mpJoin({
        code: code.trim().toUpperCase(),
        name,
        avatar: profile.avatar,
        playerId: session?.playerId,
      });
      const s: MpSession = { playerId, code: roomCode, name, avatar: profile.avatar };
      onSessionChange(s);
      // вход запускает партию сразу
      onPlaying(s);
    } catch (e) {
      const errCode = (e as { code?: string })?.code ?? '';
      if (errCode === 'ownroom' && session) {
        // это ваша собственная комната — возвращаемся в неё, а не «входим» гостем
        toast({ title: t('mp_own_room') });
        setWaiting(true);
        return;
      }
      toast({ title: t(mpErrorKey(errCode)) });
    } finally {
      setBusy(false);
    }
  };

  const doJoinRoom = async (roomCode: string) => {
    if (busy) return;
    // в собственную комнату «войти» нельзя — только вернуться в неё
    if (session && session.code === roomCode) {
      sound.tap();
      setWaiting(true);
      return;
    }
    const name = profile.name.trim();
    if (name.length < 1) {
      toast({ title: t('mp_bad_name') });
      return;
    }
    setBusy(true);
    sound.ensure();
    sound.tap();
    try {
      const { code: joined, playerId } = await mpJoin({
        code: roomCode,
        name,
        avatar: profile.avatar,
        playerId: session?.playerId,
      });
      const s: MpSession = { playerId, code: joined, name, avatar: profile.avatar };
      onSessionChange(s);
      onPlaying(s);
    } catch (e) {
      const errCode = (e as { code?: string })?.code ?? '';
      if (errCode === 'ownroom' && session) {
        toast({ title: t('mp_own_room') });
        setWaiting(true);
        return;
      }
      toast({ title: t(mpErrorKey(errCode)) });
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!session) return;
    sound.tap();
    try {
      await mpControl({ code: session.code, playerId: session.playerId, op: 'cancel' });
    } catch {
      /* комната могла уже закрыться */
    }
    onSessionChange(null);
    setWaiting(false);
  };

  const copyCode = async () => {
    if (!session) return;
    sound.tap();
    try {
      await navigator.clipboard.writeText(session.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard недоступен */
    }
  };

  // ===== экран автопоиска =====
  if (searching) {
    return (
      <div className="mx-auto flex min-h-svh w-full max-w-[520px] md:max-w-[660px] flex-col items-center px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),16px)]">
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={stopSearch}
            className="btn-cloth flex h-9 w-9 items-center justify-center rounded-xl"
            aria-label={t('mp_back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="font-display text-[19px] text-foreground">{t('mp_quick_title')}</div>
          <div className="w-9" />
        </div>

        <div className="pop-in stitched-card mt-10 flex w-full flex-col items-center px-5 py-8">
          {/* «радар»: пульсирующие кольца + фигурки */}
          <div className="relative flex h-28 w-28 items-center justify-center" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/25" />
            <span className="absolute inline-flex h-4/5 w-4/5 animate-ping rounded-full bg-primary/20" style={{ animationDelay: '0.4s' }} />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#D9A13F]/25">
              <Zap className="h-7 w-7 text-[#A6721F]" fill="#FFD98A" />
            </span>
          </div>
          <div className="mt-5 font-display text-[22px] text-foreground">{t('mp_quick_searching')}</div>
          <div className="mt-1.5 text-[13.5px] font-bold tabular-nums text-muted-foreground">
            {t('mp_quick_elapsed', { n: searchSec })}
          </div>
          {reconnecting && (
            <div className="mt-3 flex items-center gap-1.5 rounded-full bg-[#C33A2F]/12 px-3 py-1.5 text-[11.5px] font-bold text-[#8f2a20]">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {t('mp_reconnect')}
            </div>
          )}
          <div className="mt-4 text-center text-[12.5px] font-semibold text-muted-foreground">
            {t('mp_quick_note')}
          </div>
        </div>

        <div className="flex-1" />
        <button
          type="button"
          onClick={stopSearch}
          className="btn-cloth w-full rounded-2xl py-3 text-[15px] font-extrabold text-destructive"
        >
          {t('mp_quick_cancel')}
        </button>
      </div>
    );
  }

  // ===== экран ожидания соперника =====
  if (session && waiting) {
    return (
      <div className="mx-auto flex min-h-svh w-full max-w-[520px] md:max-w-[660px] flex-col items-center px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),16px)]">
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={() => {
              // назад в хаб БЕЗ отмены: комната живёт, вернуться можно из списка
              sound.tap();
              setWaiting(false);
            }}
            className="btn-cloth flex h-9 w-9 items-center justify-center rounded-xl"
            aria-label={t('mp_back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="font-display text-[19px] text-foreground">{t('mp_wait_title')}</div>
          <div className="w-9" />
        </div>

        <div className="pop-in stitched-card mt-8 flex w-full flex-col items-center px-5 py-6">
          {reconnecting && (
            <div className="mb-3 flex items-center gap-1.5 rounded-full bg-[#C33A2F]/12 px-3 py-1.5 text-[11.5px] font-bold text-[#8f2a20]">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {t('mp_reconnect')}
            </div>
          )}
          <div className="text-[13px] font-extrabold tracking-wide text-muted-foreground uppercase">
            {t('mp_code_ph')}
          </div>
          <div
            className="font-display mt-2 text-[44px] leading-none tracking-[0.18em] text-foreground"
            style={{ textShadow: '0 2px 0 rgba(169,133,90,.25)' }}
          >
            {session.code}
          </div>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="btn-cloth mt-4 flex items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-extrabold"
          >
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            {copied ? t('mp_copied') : t('mp_copy')}
          </button>
          <div className="mt-4 flex items-center gap-1.5 rounded-full bg-[#D9A13F]/15 px-3 py-1.5 text-[12px] font-bold text-[#8A5E13]">
            {session.isPublic !== false ? <Users className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
            {t(session.isPublic !== false ? 'mp_room_public' : 'mp_room_private')}
          </div>
          <div className="mt-4 text-center text-[12.5px] font-semibold text-muted-foreground">
            {t('mp_wait_hint')}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Portrait src={avatarUrl(session.avatar)} size={44} alt={session.name} />
          <div>
            <div className="text-[15px] font-extrabold text-foreground">{session.name}</div>
            <div className="text-[11.5px] font-bold text-muted-foreground">{t('mp_you')}</div>
          </div>
        </div>

        <div className="mt-7 flex items-center gap-2 text-[14px] font-extrabold text-muted-foreground">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          {t('mp_wait_for')}
        </div>

        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void doCancel()}
          className="btn-cloth w-full rounded-2xl py-3 text-[15px] font-extrabold text-destructive"
        >
          {t('mp_cancel')}
        </button>
      </div>
    );
  }

  // ===== хаб: профиль + быстрая игра + создать + войти по коду + открытые комнаты =====
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[520px] md:max-w-[660px] flex-col px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),16px)]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            sound.tap();
            onExitHome();
          }}
          className="btn-cloth flex h-9 w-9 items-center justify-center rounded-xl"
          aria-label={t('mp_back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <div className="font-display text-[21px] text-foreground">{t('mp_title')}</div>
          <div className="text-[11.5px] font-bold text-muted-foreground">{t('mp_desc')}</div>
        </div>
        <div className="w-9" />
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-center text-[12px] font-bold text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
        <span>{t('mp_rules_note')}</span>
      </div>

      {/* Профиль */}
      <div className="stitched-card mt-3 p-3.5">
        <div className="flex items-center gap-3">
          <Portrait src={avatarUrl(profile.avatar)} size={58} alt={t('mp_avatar')} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
              {t('mp_name')}
            </div>
            <input
              value={profile.name}
              onChange={(e) => setProfileAndSave({ name: e.target.value.slice(0, 16) })}
              placeholder={t('mp_name_ph')}
              maxLength={16}
              className="mt-1 w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-[15.5px] font-bold text-foreground outline-none focus:border-primary/60"
            />
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <div className="text-[12.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
            {t('mp_avatar')}
          </div>
          <div className="flex gap-1.5 overflow-x-auto py-0.5">
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  sound.tap();
                  setProfileAndSave({ avatar: id });
                }}
                className={`shrink-0 rounded-full transition-transform ${
                  profile.avatar === id ? 'scale-100 ring-3 ring-[#D9A13F]' : 'scale-90 opacity-75'
                }`}
                aria-label={t('mp_avatar')}
              >
                <Portrait src={avatarUrl(id)} size={38} alt={id} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Быстрая игра — автопоиск */}
      <button
        type="button"
        onClick={doQuick}
        className="mt-3 flex w-full items-center gap-3 rounded-2xl border-2 border-[#8AA06F]/60 bg-[#8AA06F]/12 p-3.5 text-left shadow-[inset_0_2px_0_rgba(255,255,255,.6),0_6px_14px_-8px_rgba(70,100,40,.45)] transition-all hover:-translate-y-0.5 active:translate-y-0"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#8AA06F]/30">
          <Zap className="h-6 w-6 text-[#4e6437]" fill="#cfe0b4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-extrabold text-foreground">{t('mp_quick')}</div>
          <div className="text-[12.5px] font-semibold text-muted-foreground">{t('mp_quick_h')}</div>
        </div>
      </button>

      {/* Создать комнату */}
      <div className="stitched-card mt-3 flex flex-col gap-2.5 p-3.5">
        <Button
          size="lg"
          disabled={busy}
          className="btn-wood h-13 w-full rounded-2xl text-[16.5px] font-extrabold"
          onClick={() => void doCreate()}
        >
          <Plus className="mr-2 h-5 w-5" />
          {t('mp_create')}
        </Button>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14.5px] font-extrabold">{t('mp_public')}</div>
            <div className="text-[11.5px] font-semibold text-muted-foreground">{t('mp_public_h')}</div>
          </div>
          <Switch checked={isPublic} onCheckedChange={(v) => { sound.tap(); setIsPublic(v); }} />
        </div>
      </div>

      {/* Войти по коду */}
      <div className="stitched-card mt-3 flex items-center gap-2 p-3.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          placeholder={t('mp_code_ph')}
          inputMode="text"
          autoCapitalize="characters"
          className="min-w-0 flex-1 rounded-xl border-2 border-border bg-card px-3 py-2.5 text-center text-[20px] font-extrabold tracking-[0.25em] text-foreground uppercase outline-none focus:border-primary/60"
        />
        <Button
          size="lg"
          disabled={busy || code.length !== 6}
          className="btn-wood h-12 shrink-0 rounded-2xl px-4 text-[15px] font-extrabold"
          onClick={() => void doJoinByCode()}
        >
          <LogIn className="mr-1 h-4.5 w-4.5" />
          {t('mp_join_btn')}
        </Button>
      </div>

      {/* Открытые комнаты */}
      <div className="mt-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <div className="text-[13.5px] font-extrabold text-foreground">{t('mp_open_rooms')}</div>
      </div>
      <div className="mt-1.5 space-y-2 pb-6">
        {openRooms === null && (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-[13px] font-bold text-muted-foreground">
            {t('mp_reconnecting')}
          </div>
        )}
        {openRooms !== null && openRooms.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-[13px] font-bold text-muted-foreground">
            {t('mp_none')}
          </div>
        )}
        {openRooms?.map((r) => {
          const mine = session?.code === r.code;
          return (
            <div key={r.code} className="stitched-card flex items-center gap-2.5 p-2.5">
              <Portrait src={avatarUrl(r.hostAvatar)} size={40} alt={r.hostName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[14.5px] font-extrabold text-foreground">{r.hostName}</span>
                  {mine && (
                    <span className="shrink-0 rounded-full bg-[#D9A13F]/20 px-2 py-0.5 text-[10px] font-extrabold text-[#8A5E13]">
                      {t('mp_your_room')}
                    </span>
                  )}
                </div>
                <div className="text-[12px] font-bold tracking-[0.15em] text-muted-foreground">{r.code}</div>
              </div>
              <Button
                size="sm"
                disabled={busy}
                className="btn-cloth h-10 shrink-0 rounded-xl px-3.5 text-[13.5px] font-extrabold"
                onClick={() => void doJoinRoom(r.code)}
              >
                {mine ? t('mp_return') : t('mp_join_btn')}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
