'use client';

/**
 * Онлайн-партия: держит опрос комнаты (~1.5с), применяет состояние от сервера,
 * отправляет ходы через submit, следит за таймером хода (3 мин, сервер
 * автопассит просроченные), реваншами и выходом соперника.
 * Внутри рендерит обычный GameScreen с пропом online.
 *
 * Стабильность связи (главные правила):
 *  — УСТАРЕВШИЕ poll-ответы отбрасываются. Пока ход летел на сервер,
 *    очередной poll мог уже запроситься и вернуться СТАРЫМ состоянием —
 *    такой ответ откатил бы доску назад («мой ход пропал»). Теперь вид
 *    применяется только если его версия не старше уже применённой
 *    (version и gameSeq монотонны от одного сервера).
 *  — «notfound» не выкидывает мгновенно: сервер мог рестартовать и
 *    сейчас поднимет комнаты из снапшота — даём 3 попытки (~5с).
 *  — Сбой связи не стирает сессию: после возврата в хаб игроку снова
 *    предложат вернуться в партию (сессия в localStorage жива, пока
 *    он сам не выйдет осознанно).
 *  — applyView СТАБИЛЕН (рефы вместо стейта в зависимостях) — иначе цикл
 *    опроса перезапускается на каждый рендер и циклов становится много.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameScreen, type OnlineCtx } from './GameScreen';
import type { GameEvent, GameState, MpRoomView, NetAction } from '@/lib/game/types';
import type { MpSession } from '@/lib/net';
import { mpControl, mpErrorKey, mpMove, mpOnNet, mpOnView, mpState, mpWsEnabled, mpWsReconnect } from '@/lib/net';
import { t } from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

const POLL_MS = 1500;
/** без связи опрашиваем реже — не спамим, но и не бросаем партию */
const POLL_LOST_MS = 3000;
/** сколько «notfound» подряд терпим (пара секунд здесь спасает партию:
 *  хранилище — источник правды, «notfound» может прийти лишь по-настоящему) */
const NOTFOUND_RETRIES = 3;
/** WS-режим: окно переподключения — потом предлагаем выйти в лобби
 *  (сессия сохраняется — из хаба можно вернуться в партию) */
const NET_FAIL_MS = 15_000;

export interface OnlineGameScreenProps {
  session: MpSession;
  /** 'user' — осознанный выход (сессия очищается); 'error' — сбой: сессия
   *  сохраняется, из хаба можно вернуться в партию */
  onExit: (reason: 'user' | 'error') => void;
  onOpenRules: () => void;
}

export function OnlineGameScreen({ session, onExit, onOpenRules }: OnlineGameScreenProps) {
  const { toast } = useToast();
  const [game, setGame] = useState<GameState | null>(null);
  const [gameSeq, setGameSeq] = useState(0);
  const [online, setOnline] = useState<OnlineCtx | null>(null);
  const [abandoned, setAbandoned] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  /** для «возврата в комнату» пока не пришёл первый poll */
  const [connecting, setConnecting] = useState(true);
  /** нет связи с сервером — показываем плашку переподключения */
  const [netLost, setNetLost] = useState(false);
  /** WS-режим: окно переподключения истекло (15с) — предлагаем выход */
  const [netFail, setNetFail] = useState(false);
  /** зеркало netLost для цикла опроса (интервал при потере связи) */
  const netLostRef = useRef(false);

  const seenVersion = useRef(-1);
  const seenGameSeq = useRef(-1);
  const lastTimeoutToast = useRef<number | null>(null);
  const rematchNotified = useRef(false);
  const submitting = useRef(false);
  const notfoundStreak = useRef(0);
  /** последние события чужого хода (и их номер) — уходят в online-контекст */
  const remoteRef = useRef<{ events: GameEvent[] | null; id: number }>({ events: null, id: 0 });
  const applyViewRef = useRef<(view: MpRoomView, opts: { fromSubmit: boolean }) => void>(() => {});

  // ===== отправка хода на сервер =====
  const submit = useCallback(
    async (action: NetAction): Promise<
      { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string }
    > => {
      if (submitting.current) return { ok: false, error: 'busy' };
      submitting.current = true;
      try {
        const { view: v2 } = await mpMove({ code: session.code, playerId: session.playerId, action });
        notfoundStreak.current = 0;
        applyViewRef.current(v2, { fromSubmit: true });
        if (v2.state && v2.events && v2.eventsVersion === v2.version) {
          return { ok: true, state: v2.state, events: v2.events };
        }
        return { ok: true, state: v2.state!, events: [] };
      } catch (e) {
        return { ok: false, error: (e as { code?: string })?.code ?? 'net' };
      } finally {
        submitting.current = false;
      }
    },
    [session.code, session.playerId],
  );

  // ===== применение вида комнаты (стабильная функция) =====
  const applyView = useCallback(
    (view: MpRoomView, opts: { fromSubmit: boolean }) => {
      if (view.status === 'abandoned') {
        setAbandoned(true);
        setConnecting(false);
        return;
      }
      if (view.status === 'waiting') {
        // партию ещё не начали/перезапустили — ждём следующего poll
        return;
      }
      setConnecting(false);

      // УСТАРЕВШИЙ ответ (гонка poll vs ход): версия старше уже применённой —
      // пропускаем состояние и события, но онлайн-мету (на связи/нет) обновляем
      const stale =
        view.gameSeq < seenGameSeq.current ||
        (view.gameSeq === seenGameSeq.current && view.version < seenVersion.current);

      if (!stale) {
        // новая партия (реванш) — перемонтируем GameScreen
        if (view.gameSeq !== seenGameSeq.current) {
          seenGameSeq.current = view.gameSeq;
          remoteRef.current = { events: null, id: 0 };
          setGameSeq(view.gameSeq);
          setRematchWaiting(false);
          rematchNotified.current = false;
        }
        const isNew = view.version > seenVersion.current;
        if (view.version > seenVersion.current) seenVersion.current = view.version;

        if (view.state) setGame(view.state);

        // события ходов: свои приходят из submit (там и проигрываются),
        // чужие — poll'ом: показываем через remoteEvents один раз
        if (!opts.fromSubmit && isNew && view.events && view.events.length > 0 && view.eventsVersion === view.version) {
          remoteRef.current = { events: view.events, id: remoteRef.current.id + 1 };
        }

        // тост про просроченный ход (по версии — один раз)
        if (
          view.timedOutVersion !== null &&
          view.timedOutSeat !== null &&
          view.timedOutVersion !== lastTimeoutToast.current
        ) {
          lastTimeoutToast.current = view.timedOutVersion;
          if (view.timedOutSeat === 0) {
            toast({ title: t('mp_timeout_you_t'), description: t('mp_timeout_you_d') });
          } else {
            toast({ title: t('mp_timeout_foe_t'), description: t('mp_timeout_foe_d') });
          }
        }

        // реванш: соперник нажал — мягко напомнить один раз
        if (view.status === 'finished' && view.rematchFoe && !view.rematchMe && !rematchNotified.current) {
          rematchNotified.current = true;
          toast({ title: t('mp_rematch_asked') });
        }
        if (view.status === 'finished') {
          setRematchWaiting(view.rematchMe);
        }
      }

      const offset = view.serverNow - Date.now();
      setOnline({
        roomCode: view.code,
        opponent: {
          name: view.foe?.name ?? '',
          avatar: view.foe?.avatar ?? 'ann',
          connected: view.foe?.connected ?? false,
          left: view.foe?.left ?? false,
        },
        turnDeadline: view.turnDeadline,
        turnPaused: view.turnPaused,
        clockOffset: offset,
        submit,
        remoteEvents: remoteRef.current.events,
        remoteEventsId: remoteRef.current.id,
      });
    },
    [toast, submit],
  );

  useEffect(() => {
    applyViewRef.current = applyView;
  }, [applyView]);

  // ===== связь с сервером: WS (мгновенные push) или поллинг =====
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failTimer: ReturnType<typeof setTimeout> | null = null;

    // запрос состояния = заодно «переподключение»: в WS-режиме сервер
    // прикрепляет сокет к комнате и дальше пушит изменения мгновенно
    const fetchState = async () => {
      if (cancelled) return;
      try {
        const { view } = await mpState({ code: session.code, playerId: session.playerId });
        if (cancelled) return;
        notfoundStreak.current = 0;
        applyViewRef.current(view, { fromSubmit: false });
      } catch (e) {
        if (cancelled) return;
        const code = (e as { code?: string })?.code ?? 'net';
        if (code === 'notfound') {
          notfoundStreak.current++;
          if (notfoundStreak.current > NOTFOUND_RETRIES) {
            // комната действительно исчезла — уходим, но сессию НЕ стираем:
            // вдруг это наш сетевой сбой — из хаба можно попробовать вернуться
            toast({ title: t('mp_gone') });
            onExit('error');
            return;
          }
          // сервер мог рестартовать и поднимает комнаты — даём паузу и повтор
          timer = setTimeout(() => void fetchState(), 1500);
        }
        // прочие сетевые ошибки — молча: их показывает статус-событие сокета
      }
    };

    if (mpWsEnabled()) {
      // ===== WS-режим: поллинга нет, ходы соперника приходят мгновенно =====
      const unsubView = mpOnView((view) => {
        if (!cancelled) applyViewRef.current(view, { fromSubmit: false });
      });
      const unsubNet = mpOnNet((connected) => {
        if (cancelled) return;
        if (connected) {
          setNetLost(false);
          setNetFail(false);
          if (failTimer) {
            clearTimeout(failTimer);
            failTimer = null;
          }
          // подтягиваем пропущенное одним запросом
          void fetchState();
        } else {
          setNetLost(true);
          if (!failTimer) {
            failTimer = setTimeout(() => {
              if (!cancelled) setNetFail(true);
            }, NET_FAIL_MS);
          }
        }
      });
      void fetchState();
      const onVisible = () => {
        if (document.visibilityState === 'visible' && !cancelled) {
          // вкладка вернулась: сокет мог «уснуть» — поднимаем и синхронизируемся
          mpWsReconnect();
          void fetchState();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        if (failTimer) clearTimeout(failTimer);
        unsubView();
        unsubNet();
        document.removeEventListener('visibilitychange', onVisible);
      };
    }

    // ===== HTTP-режим (без NEXT_PUBLIC_WS_URL): поллинг как раньше =====
    const poll = async () => {
      if (cancelled) return;
      try {
        const { view } = await mpState({ code: session.code, playerId: session.playerId });
        if (cancelled) return;
        notfoundStreak.current = 0;
        if (netLostRef.current) {
          netLostRef.current = false;
          setNetLost(false);
        }
        applyViewRef.current(view, { fromSubmit: false });
      } catch (e) {
        if (cancelled) return;
        const code = (e as { code?: string })?.code ?? 'net';
        if (code === 'notfound') {
          notfoundStreak.current++;
          if (notfoundStreak.current > NOTFOUND_RETRIES) {
            // комната действительно исчезла — уходим, но сессию НЕ стираем:
            // вдруг это наш сетевой сбой — из хаба можно попробовать вернуться
            toast({ title: t('mp_gone') });
            onExit('error');
            return;
          }
          // ждём: хранилище могло мигнуть
        } else {
          netLostRef.current = true;
          setNetLost(true);
          // сетевая ошибка — попробуем ещё раз (реже)
        }
      }
      if (!cancelled) {
        const next = netLostRef.current ? POLL_LOST_MS : POLL_MS;
        timer = setTimeout(poll, next);
      }
    };
    void poll();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        if (timer) clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (failTimer) clearTimeout(failTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };

  }, [session.code, session.playerId, onExit]);

  // ===== выход из партии =====
  const doLeave = useCallback(
    (confirmFirst: boolean) => {
      if (confirmFirst && !window.confirm(t('mp_leave_confirm'))) return;
      void mpControl({ code: session.code, playerId: session.playerId, op: 'leave' }).catch(() => {
        /* комната могла закрыться */
      });
      sound.tap();
      onExit('user');
    },
    [session.code, session.playerId, onExit],
  );

  // ===== реванш =====
  const doRematch = useCallback(async () => {
    sound.tap();
    try {
      const res = await mpControl({ code: session.code, playerId: session.playerId, op: 'rematch' });
      if (!res.started) {
        setRematchWaiting(true);
        toast({ title: t('mp_rematch_wait') });
      }
    } catch (e) {
      toast({ title: t(mpErrorKey((e as { code?: string })?.code ?? '')) });
    }
  }, [session.code, session.playerId, toast]);

  // ===== провал переподключения: выходим в лобби, сессию храним =====
  const netFailExit = useCallback(() => {
    sound.tap();
    onExit('error');
  }, [onExit]);

  // ===== соперник покинул партию =====
  if (abandoned) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2118]/70 p-4 backdrop-blur-sm">
        <div className="pop-in stitched-card w-full max-w-sm p-5 text-center">
          <div className="font-display text-[26px] text-destructive">{t('mp_foe_left_t')}</div>
          <div className="mt-1.5 text-[14px] font-bold text-muted-foreground">{t('mp_foe_left_d')}</div>
          <Button
            size="lg"
            className="btn-wood mt-5 h-13 w-full rounded-2xl text-[16px] font-extrabold"
            onClick={() => onExit('user')}
          >
            {t('mp_back')}
          </Button>
        </div>
      </div>
    );
  }

  if (connecting || !game || !online) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="flex items-center gap-2 text-[15px] font-extrabold text-muted-foreground">
          <span className="relative flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-primary" />
          </span>
          {t('mp_reconnecting')}
        </div>
      </div>
    );
  }

  return (
    <>
      {netLost && !netFail && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),10px)] z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full bg-[#C33A2F]/92 px-4 py-2 shadow-xl">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <span className="text-[12.5px] font-extrabold text-white">{t('mp_net_lost')}</span>
          </div>
        </div>
      )}
      {netFail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2118]/70 p-4 backdrop-blur-sm">
          <div className="pop-in stitched-card w-full max-w-sm p-5 text-center">
            <div className="font-display text-[26px] text-destructive">{t('mp_net_fail_t')}</div>
            <div className="mt-1.5 text-[14px] font-bold text-muted-foreground">{t('mp_net_fail_d')}</div>
            <Button
              size="lg"
              className="btn-wood mt-5 h-13 w-full rounded-2xl text-[16px] font-extrabold"
              onClick={netFailExit}
            >
              {t('mp_back')}
            </Button>
          </div>
        </div>
      )}
      <GameScreen
        key={`online-${gameSeq}`}
        state={game}
        onState={setGame}
        onExit={() => doLeave(true)}
        onRematch={() => void doRematch()}
        onOpenRules={onOpenRules}
        online={online}
      />
      {/* ожидание согласия на реванш поверх финального экрана */}
      {rematchWaiting && game.phase === 'gameover' && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full bg-card/95 px-4 py-2.5 shadow-xl">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
            </span>
            <span className="text-[13.5px] font-extrabold text-foreground">{t('mp_rematch_wait')}</span>
          </div>
        </div>
      )}
    </>
  );
}
