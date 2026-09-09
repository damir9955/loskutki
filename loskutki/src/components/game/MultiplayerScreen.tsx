'use client';

/**
 * Экран онлайн-режима «С другом»:
 *  — профиль (имя + реалистичный портрет),
 *  — создать комнату (приватную по коду или открытую — видна в поиске),
 *  — войти по 6-значному коду,
 *  — список открытых комнат (авто-обновление),
 *  — экран ожидания соперника с крупным кодом.
 * Партия стартует, как только второй игрок входит в комнату.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Check, LogIn, Plus, RefreshCw, Users } from 'lucide-react';
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
  mpState,
  saveProfile,
  type MpSession,
} from '@/lib/net';
import { sound } from '@/lib/sound';
import { useToast } from '@/hooks/use-toast';

const POLL_MS = 1500;
const LIST_MS = 5000;

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
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'ok' | 'fail'>(
    session ? 'checking' : 'idle',
  );
  const playingNotified = useRef(false);

  // ===== валидация сохранённой сессии (возврат после перезагрузки) =====
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    (async () => {
      try {
        const { view } = await mpState({ code: session.code, playerId: session.playerId });
        if (stopped) return;
        setCheckState('ok');
        setWaiting(true);
        if ((view.status === 'playing' || view.status === 'finished') && !playingNotified.current) {
          playingNotified.current = true;
          onPlaying(session);
        }
      } catch {
        if (stopped) return;
        setCheckState('fail');
        toast({ title: t('mp_gone') });
        onSessionChange(null);
        setWaiting(false);
      }
    })();
    return () => {
      stopped = true;
    };
     
  }, [session?.code]);

  // ===== опрос комнаты, пока ждём соперника =====
  useEffect(() => {
    if (!session || !waiting) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        const { view } = await mpState({ code: session.code, playerId: session.playerId });
        if (stop) return;
        if (view.status === 'playing' || view.status === 'finished') {
          if (!playingNotified.current) {
            playingNotified.current = true;
            sound.ensure();
            sound.tap();
            onPlaying(session);
          }
          return;
        }
        if (view.status === 'abandoned') {
          toast({ title: t('mp_gone') });
          onSessionChange(null);
          setWaiting(false);
          return;
        }
      } catch {
        if (stop) return;
        toast({ title: t('mp_gone') });
        onSessionChange(null);
        setWaiting(false);
        return;
      }
      if (!stop) timer = setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
     
  }, [session?.code, waiting]);

  // ===== список открытых комнат (пока не ждём) =====
  useEffect(() => {
    if (waiting) return;
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
  }, [waiting]);

  const setProfileAndSave = useCallback((p: { name?: string; avatar?: string }) => {
    const next = { ...profile, ...p };
    setProfile(next);
    saveProfile(next);
  }, [profile]);

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
      const { code: roomCode, playerId } = await mpCreate({ name, avatar: profile.avatar, isPublic });
      const s: MpSession = { playerId, code: roomCode, name, avatar: profile.avatar, isPublic };
      onSessionChange(s);
      setWaiting(true);
      setCheckState('ok');
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
      const { code: roomCode, playerId } = await mpJoin({ code: code.trim().toUpperCase(), name, avatar: profile.avatar });
      const s: MpSession = { playerId, code: roomCode, name, avatar: profile.avatar };
      onSessionChange(s);
      // вход запускает партию сразу
      onPlaying(s);
    } catch (e) {
      toast({ title: t(mpErrorKey((e as { code?: string })?.code ?? '')) });
    } finally {
      setBusy(false);
    }
  };

  const doJoinRoom = async (roomCode: string) => {
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
      const { code: joined, playerId } = await mpJoin({ code: roomCode, name, avatar: profile.avatar });
      const s: MpSession = { playerId, code: joined, name, avatar: profile.avatar };
      onSessionChange(s);
      onPlaying(s);
    } catch (e) {
      toast({ title: t(mpErrorKey((e as { code?: string })?.code ?? '')) });
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

  // ===== экран ожидания соперника =====
  if (session && waiting) {
    return (
      <div className="mx-auto flex min-h-svh w-full max-w-[520px] flex-col items-center px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),16px)]">
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={() => void doCancel()}
            className="btn-cloth flex h-9 w-9 items-center justify-center rounded-xl"
            aria-label={t('mp_back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="font-display text-[19px] text-foreground">{t('mp_wait_title')}</div>
          <div className="w-9" />
        </div>

        <div className="pop-in stitched-card mt-8 flex w-full flex-col items-center px-5 py-6">
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

  // ===== хаб: профиль + создать + войти по коду + открытые комнаты =====
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[520px] flex-col px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),16px)]">
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
        {openRooms?.map((r) => (
          <div key={r.code} className="stitched-card flex items-center gap-2.5 p-2.5">
            <Portrait src={avatarUrl(r.hostAvatar)} size={40} alt={r.hostName} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-extrabold text-foreground">{r.hostName}</div>
              <div className="text-[12px] font-bold tracking-[0.15em] text-muted-foreground">{r.code}</div>
            </div>
            <Button
              size="sm"
              disabled={busy}
              className="btn-cloth h-10 shrink-0 rounded-xl px-3.5 text-[13.5px] font-extrabold"
              onClick={() => void doJoinRoom(r.code)}
            >
              {t('mp_join_btn')}
            </Button>
          </div>
        ))}
      </div>

      {/* проверка сохранённой сессии */}
      {checkState === 'checking' && (
        <div className="pb-4 text-center text-[12px] font-bold text-muted-foreground">{t('mp_reconnecting')}</div>
      )}
    </div>
  );
}

