'use client';

import { useEffect, useRef, useState } from 'react';
import { XCircle } from 'lucide-react';
import type { BotLevel } from '@/lib/game/constants';
import type { GameState } from '@/lib/game/types';
import { createGame } from '@/lib/game/engine';
import { GameScreen } from '@/components/game/GameScreen';
import { HomeScreen } from '@/components/game/HomeScreen';
import { InviteChallengePopup, type ChallengeAcceptedSession } from '@/components/game/InviteChallengePopup';
import { MultiplayerScreen } from '@/components/game/MultiplayerScreen';
import { OnlineGameScreen } from '@/components/game/OnlineGameScreen';
import RulesDialog from '@/components/game/RulesDialog';
import { BootGate } from '@/components/game/BootGate';
import { Portrait } from '@/components/game/MarketRow';
import { avatarUrl } from '@/lib/avatars';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { sound, vibrate } from '@/lib/sound';
import { loadStore, saveStore, todaySeedValue } from '@/lib/storage';
import { loadSession, mpControl, saveSession, type MpSession } from '@/lib/net';
import { frBoot, onFriendsUiEvent } from '@/lib/friends';
import { t } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useOnline } from '@/lib/useOnline';

export default function Page() {
  const { toast } = useToast();
  const online = useOnline();
  const [game, setGame] = useState<GameState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  // онлайн-режим: сессия сохраняется → после перезагрузки возвращаемся в комнату
  const [session, setSession] = useState<MpSession | null>(() => loadSession());
  const [mpOpen, setMpOpen] = useState(() => loadSession() !== null);
  const [mpPlaying, setMpPlaying] = useState(false);
  /** «Быстрая игра» из главного меню: хаб открывается и сразу ищет пару */
  const [autoQuick, setAutoQuick] = useState(false);
  /** зеркало mpPlaying для колбэков друзей (тост «отклонил приглашение»
   *  должен отличать «уже играем» от «ещё ждём») без перестройки подписки */
  const mpPlayingRef = useRef(mpPlaying);
  useEffect(() => {
    mpPlayingRef.current = mpPlaying;
  }, [mpPlaying]);
  /** зеркало session: колбэк «друг отказался» закрывает ждущую комнату —
   *  нужен свежий объект без перестройки подписки */
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  /** v3.7.0: друг отказался от вызова — крупное уведомление поверх всего */
  const [declined, setDeclined] = useState<{ name: string; avatar: string } | null>(null);
  /** свежий отказ (uid + время): чтобы старый тост fr_invite_gone не дублировал */
  const recentDeclineRef = useRef<{ uid: string; at: number } | null>(null);

  // синхронизация настроек звука при загрузке
  useEffect(() => {
    sound.enabled = loadStore().settings.sound;
  }, []);

  // ДРУЗЬЯ: регистрируем постоянный ID на сервере (hello) — после этого
  // приглашения и сообщения приходят push-ом в любой точке приложения
  useEffect(() => {
    frBoot();
  }, []);

  const updateSession = (s: MpSession | null) => {
    setSession(s);
    saveSession(s);
  };

  // тосты о событиях друзей (заявка/сообщение/приглашение/принятие)
  useEffect(() => {
    return onFriendsUiEvent((e) => {
      if (!online) return;
      switch (e.kind) {
        case 'req':
          toast({ title: t('fr_new_req'), description: t('fr_new_req_d', { name: e.name }) });
          break;
        case 'ok':
          toast({ title: t('fr_now_friends'), description: t('fr_now_friends_d') });
          break;
        case 'gone':
          if (e.name) toast({ title: t('fr_removed_you', { name: e.name }) });
          break;
        case 'msg':
          toast({ title: t('fr_new_msg', { name: e.name }), description: e.text.slice(0, 80) });
          break;
        case 'invite':
          // вызов на поединок показывает глобальный попап (InviteChallengePopup)
          break;
        case 'invite_gone': {
          // это видит ЗОВУЩИЙ: приглашение больше не ждёт ответа.
          // Только для СТАРЫХ серверов (без события fr_invite_declined):
          // даём секунду — если друг ПРИНЯЛ, партия стартует (mpPlaying),
          // и тост не нужен; свежий отказ уже показан крупным попапом.
          const rd = recentDeclineRef.current;
          if (rd && rd.uid === e.from && Date.now() - rd.at < 6000) break;
          const name = e.name;
          if (name) {
            setTimeout(() => {
              if (!mpPlayingRef.current) {
                toast({ title: t('fr_invite_declined', { name }) });
              }
            }, 1200);
          }
          break;
        }
        case 'invite_declined': {
          // v3.7.0: друг ОТКАЗАЛСЯ — сервер уже закрыл ждущую комнату.
          // Зовущему показываем КРУПНОЕ уведомление и выходим из ожидания.
          recentDeclineRef.current = { uid: e.from, at: Date.now() };
          if (mpPlayingRef.current) break; // уже играем другую партию — не мешаем
          if (sessionRef.current) updateSession(null);
          sound.ensure();
          sound.error();
          vibrate([120, 60, 120], loadStore().settings.vibration);
          setDeclined({ name: e.name, avatar: e.avatar });
          break;
        }
      }
    });
  }, [toast, online]);

  const startCasual = (level: BotLevel) => {
    const seed = (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
    const first = Math.random() < 0.5 ? 0 : 1;
    setGame(createGame({ seed, mode: 'casual', botLevel: level, firstPlayer: first }));
    setGameKey((k) => k + 1);
  };

  const startDaily = () => {
    const seed = todaySeedValue();
    // детерминированный первый игрок по seed
    const first = seed % 2 === 0 ? 0 : 1;
    setGame(createGame({ seed, mode: 'daily', botLevel: 'fedor', firstPlayer: first }));
    setGameKey((k) => k + 1);
  };

  const rematch = () => {
    if (!game) return;
    const seed = (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
    const first = Math.random() < 0.5 ? 0 : 1;
    setGame(
      createGame({ seed, mode: game.mode, botLevel: game.botLevel, firstPlayer: first }),
    );
    setGameKey((k) => k + 1);
  };

  const exitToHome = () => {
    // сохранить текущую партию при выходе (если не завершена)
    if (game && game.phase !== 'gameover' && game.mode !== 'online') {
      const store = loadStore();
      store.currentGame = game;
      saveStore(store);
    }
    setGame(null);
  };

  /** вход в комнату из главного меню: баннер «ждёт игру» или приглашение
   *  друга (guest — партия стартуется сразу; host — экран ожидания) */
  const joinRoomFromMenu = (s: MpSession, role: 'host' | 'guest') => {
    updateSession(s);
    setAutoQuick(false);
    setMpOpen(true);
    if (role === 'guest') setMpPlaying(true);
  };

  /** вызов от друга принят в глобальном попапе: корректно покидаем
   *  текущую комнату/партию и входим в комнату друга (гость — сразу в бой) */
  const handleChallengeAccepted = (s: ChallengeAcceptedSession) => {
    // 1) были в комнате (партия или ожидание) — сообщаем серверу об уходе:
    //    соперник сразу увидит «покинул партию», ждущая комната исчезнет из лобби
    if (session) {
      void mpControl({ code: session.code, playerId: session.playerId, op: 'leave' }).catch(() => {
        /* комната могла уже закрыться */
      });
    }
    // 2) незаконченную офлайн-партию прибираем на «Продолжить партию»
    if (game && game.phase !== 'gameover' && game.mode !== 'online') {
      const store = loadStore();
      store.currentGame = game;
      saveStore(store);
    }
    // 3) входим в комнату друга — партия стартуется сразу
    setGame(null);
    updateSession(s);
    setAutoQuick(false);
    setMpOpen(true);
    setMpPlaying(true);
  };

  const exitOnline = (reason: 'user' | 'error') => {
    if (reason === 'user') {
      // осознанный выход — сессию чистим, назад не вернуть
      updateSession(null);
    }
    // сбой связи — сессию СОХРАНЯЕМ: в хабе предложим вернуться в партию
    setMpPlaying(false);
    // возвращаемся в хаб «С другом» — оттуда сразу можно создать/войти в комнату
    setMpOpen(true);
  };

  return (
    <BootGate>
      <main className="linen-bg min-h-svh">
        {game ? (
        <GameScreen
          key={gameKey}
          state={game}
          onState={setGame}
          onExit={exitToHome}
          onRematch={rematch}
          onOpenRules={() => {
            sound.tap();
            setRulesOpen(true);
          }}
        />
      ) : session && mpPlaying ? (
        <OnlineGameScreen
          key={`mp-${session.code}-${session.playerId}`}
          session={session}
          onExit={exitOnline}
          onOpenRules={() => {
            sound.tap();
            setRulesOpen(true);
          }}
        />
      ) : mpOpen || session ? (
        <MultiplayerScreen
          session={session}
          autoQuick={autoQuick}
          onAutoQuickDone={() => setAutoQuick(false)}
          onSessionChange={updateSession}
          onPlaying={(s) => {
            updateSession(s);
            setMpPlaying(true);
          }}
          onExitHome={() => {
            setMpOpen(false);
            setAutoQuick(false);
          }}
        />
      ) : (
        <HomeScreen
          session={session}
          onJoinRoom={joinRoomFromMenu}
          onStart={startCasual}
          onDaily={startDaily}
          onResume={(s) => setGame(s)}
          onOpenRules={() => setRulesOpen(true)}
          onOnline={() => {
            sound.ensure();
            sound.tap();
            setAutoQuick(false);
            setMpOpen(true);
          }}
          onQuickOnline={() => {
            setAutoQuick(true);
            setMpOpen(true);
          }}
        />
      )}
        <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
        {/* глобальный вызов на поединок: попап поверх любого экрана,
            включая активную партию */}
        <InviteChallengePopup
          inOnlineGame={!!session && mpPlaying}
          onAccepted={handleChallengeAccepted}
        />
        {/* v3.7.0: друг ОТКАЗАЛСЯ от вызова — крупное уведомление.
            Сервер уже закрыл комнату зовущего; здесь просто сообщаем */}
        <Dialog open={!!declined}>
          <DialogContent
            aria-describedby={undefined}
            showCloseButton={false}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            className="grid-cols-[minmax(0,1fr)] w-[min(92vw,400px)] gap-0 overflow-hidden rounded-2xl border-2 border-[#C33A2F]/50 p-0"
          >
            <div className="flex flex-col items-center gap-1 px-5 pb-5 pt-6">
              <XCircle className="pop-in h-16 w-16 text-[#C33A2F]" strokeWidth={2.2} />
              {declined && (
                <>
                  <div className="pop-in mt-2 rounded-full border-2 border-[#B98A5A]/50 p-1 shadow-md">
                    <Portrait src={avatarUrl(declined.avatar)} size={78} alt={declined.name} />
                  </div>
                  <div
                    className="font-display mt-3 text-center text-[27px] leading-tight font-black uppercase tracking-wide text-[#C33A2F]"
                    style={{ textShadow: '0 2px 0 rgba(0,0,0,.18)' }}
                  >
                    {t('fr_declined_t')}
                  </div>
                  <div className="mt-1 max-w-full text-center text-[16.5px] font-extrabold text-foreground">
                    {t('fr_declined_d', { name: declined.name })}
                  </div>
                  <div className="mt-1 text-center text-[13px] font-bold text-muted-foreground">
                    {t('fr_declined_room')}
                  </div>
                </>
              )}
              <Button
                size="lg"
                className="btn-wood mt-4 h-12 w-full rounded-xl text-[16px] font-extrabold"
                onClick={() => {
                  sound.tap();
                  setDeclined(null);
                }}
              >
                {t('fr_declined_ok')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </BootGate>
  );
}
