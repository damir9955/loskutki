'use client';

import { useEffect, useState } from 'react';
import type { BotLevel } from '@/lib/game/constants';
import type { GameState } from '@/lib/game/types';
import { createGame } from '@/lib/game/engine';
import { GameScreen } from '@/components/game/GameScreen';
import { HomeScreen } from '@/components/game/HomeScreen';
import { MultiplayerScreen } from '@/components/game/MultiplayerScreen';
import { OnlineGameScreen } from '@/components/game/OnlineGameScreen';
import RulesDialog from '@/components/game/RulesDialog';
import { sound } from '@/lib/sound';
import { loadStore, saveStore, todaySeedValue } from '@/lib/storage';
import { loadSession, saveSession, type MpSession } from '@/lib/net';

export default function Page() {
  const [game, setGame] = useState<GameState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  // онлайн-режим: сессия сохраняется → после перезагрузки возвращаемся в комнату
  const [session, setSession] = useState<MpSession | null>(() => loadSession());
  const [mpOpen, setMpOpen] = useState(() => loadSession() !== null);
  const [mpPlaying, setMpPlaying] = useState(false);

  // синхронизация настроек звука при загрузке
  useEffect(() => {
    sound.enabled = loadStore().settings.sound;
  }, []);

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

  const updateSession = (s: MpSession | null) => {
    setSession(s);
    saveSession(s);
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
          onSessionChange={updateSession}
          onPlaying={(s) => {
            updateSession(s);
            setMpPlaying(true);
          }}
          onExitHome={() => {
            setMpOpen(false);
          }}
        />
      ) : (
        <HomeScreen
          onStart={startCasual}
          onDaily={startDaily}
          onResume={(s) => setGame(s)}
          onOpenRules={() => setRulesOpen(true)}
          onOnline={() => {
            sound.ensure();
            sound.tap();
            setMpOpen(true);
          }}
        />
      )}
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
    </main>
  );
}
