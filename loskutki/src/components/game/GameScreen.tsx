'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronsRight,
  Check,
  FlipHorizontal,
  Lightbulb,
  Pause,
  RotateCw,
  X,
} from 'lucide-react';
import {
  BOT_PERSONAS,
  LEATHER_ID,
  PATCHES,
  TIME_END,
  type BotLevel,
} from '@/lib/game/constants';
import {
  advanceAction,
  advancePreview,
  availablePatches,
  buyAndPlace,
  checkBuy,
  currentPending,
  mustAdvance,
  placeLeather,
} from '@/lib/game/engine';
import { isLegalPlacement, mirroredOrientation, rotatedOrientation, orientationsFor } from '@/lib/game/placement';
import { decideBotAction, decideLeatherCell, suggestPlacement, suggestForHuman } from '@/lib/game/bot';
import { dailyNumber } from '@/lib/game/rng';
import type { GameEvent, GameState } from '@/lib/game/types';
import {
  achDesc,
  achTitle,
  patchName,
  personaDifficulty,
  personaInitial,
  personaName,
  personaQuips,
  t,
  useDocumentTitle,
  useLang,
} from '@/lib/i18n';
import { QuiltBoard, MiniQuilt } from './QuiltBoard';
import { TimeTrack, type TrackPopup } from './TimeTrack';
import {
  BadgePill,
  BigStat,
  BoardFillIcon,
  BotAvatar,
  ClockIcon,
  CoinIcon,
  GlyphDirect,
  HourglassIcon,
  IncomeIcon,
  LeatherPatchIcon,
  MarketCard,
  PatchDetailPopup,
  Portrait,
  UpcomingRibbon,
} from './MarketRow';
import { EndScreen } from './EndScreen';
import { sound, vibrate } from '@/lib/sound';
import { loadStore, recordGame, saveStore, todayKey, type GameSummary } from '@/lib/storage';
import { avatarUrl } from '@/lib/avatars';
import type { NetAction } from '@/lib/game/types';
import { useToast } from '@/hooks/use-toast';
import { useIsBigPortrait, useIsTablet } from '@/hooks/use-is-tablet';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Быстрый режим для тестов: ?fast=1 — бот и анимации не тормозят */
const FAST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast');
const BOT_DELAY = () => (FAST ? 90 : 560 + Math.random() * 800);

export interface GameScreenProps {
  state: GameState;
  onState: (s: GameState) => void;
  onExit: () => void;
  onRematch: () => void;
  onOpenRules: () => void;
  /** онлайн-партия: ходы уходят на сервер, состояние приходит оттуда же */
  online?: OnlineCtx;
}

/** Контекст онлайн-партии (состояние уже «повёрнуто» — я всегда игрок 0) */
export interface OnlineCtx {
  roomCode: string;
  /** номер партии в комнате (растёт после каждого реванша) — защита
   * от повторной записи статистики при перезагрузке страницы финала */
  gameSeq: number;
  opponent: { name: string; avatar: string; connected: boolean; left: boolean };
  /** дедлайн хода по часам сервера (epoch ms) */
  turnDeadline: number | null;
  /** таймер приостановлен: владелец хода не на связи (телефон в кармане) */
  turnPaused: boolean;
  /** serverNow − Date.now() на момент последнего poll — поправка часов */
  clockOffset: number;
  /** ход уже летит на сервер: кнопки блокируются, чтобы второй тап
   * не получил отказ (гонка «двойной тап = ход не принят») */
  busy: boolean;
  submit: (action: NetAction) => Promise<
    { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string }
  >;
  /** события чужого хода (пришли poll'ом) — проиграть один раз */
  remoteEvents: GameEvent[] | null;
  remoteEventsId: number;
}

export function GameScreen({ state, onState, onExit, onRematch, onOpenRules, online }: GameScreenProps) {
  const { toast } = useToast();
  const lang = useLang();
  // заголовок вкладки — на языке интерфейса («Лоскутки» / «Patchwork»)
  useDocumentTitle();
  const [placing, setPlacing] = useState<{ marketIndex: 0 | 1 | 2; patchId: number; orientation: number; r: number; c: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [popups, setPopups] = useState<TrackPopup[]>([]);
  const [flash, setFlash] = useState<{ player: number; pieceId: number; r?: number; c?: number } | null>(null);
  const [quip, setQuip] = useState<string | null>(null);
  const [showBotBoard, setShowBotBoard] = useState(false);
  const [endedShown, setEndedShown] = useState(false);
  const [hintOn, setHintOn] = useState(() => loadStore().settings.hints);
  /** разовая подсказка: лампочка включается нажатием и гаснет, как только
   *  подсказка использована (выбрана карточка / шаг вперёд / переставлен призрак).
   *  Показов не ограничено — просто жмите лампочку снова */
  const [showHint, setShowHint] = useState(false);
  const [botTick, setBotTick] = useState(0);
  /** «чип» перетаскивания лоскутка с карточки (следует за пальцем вне полотна) */
  const [dragChip, setDragChip] = useState<{ x: number; y: number; patchId: number; marketIndex: 0 | 1 | 2 } | null>(null);
  /** лоскуток из ленты «дальше в пути» — открыта карточка с данными */
  const [ribbonDetail, setRibbonDetail] = useState<number | null>(null);

  const botRunning = useRef(false);
  const recorded = useRef(false);
  const popupId = useRef(1);
  const settings = useRef(loadStore().settings);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** контейнер полотна — для пересчёта координат пальца в клетки */
  const boardHostRef = useRef<HTMLDivElement>(null);

  const me = state.players[0];
  const bot = state.players[1];
  const persona = BOT_PERSONAS[state.botLevel];
  /** онлайн: соперник — живой человек из комнаты (имя/аватар из повёрнутого состояния) */
  const isOnline = state.mode === 'online' && !!online;
  const foeName = isOnline && online ? online.opponent.name : personaName(lang, state.botLevel);
  const foeAvatar = isOnline && online ? avatarUrl(online.opponent.avatar) : null;
  const foeSub = isOnline && online
    ? (online.opponent.left ? t('mp_offline') : online.opponent.connected ? t('mp_online') : t('mp_offline'))
    : personaDifficulty(lang, state.botLevel);
  const foeInitial = isOnline ? (foeName.trim()[0] ?? '?').toUpperCase() : personaInitial(lang, state.botLevel);
  const botQuips = personaQuips(lang, state.botLevel);
  const myTurn = state.phase === 'action' && state.activePlayer === 0;
  const leatherHuman = state.phase === 'placing' && currentPending(state)?.player === 0;
  const leatherBot = state.phase === 'placing' && currentPending(state)?.player === 1;
  const placingNow = !!placing;
  const dragActive = !!dragChip;

  const market = useMemo(() => availablePatches(state), [state]);
  const advPreview = useMemo(() => advancePreview(state, 0), [state]);
  const forcedAdvance = useMemo(() => mustAdvance(state), [state]);
  const checks = useMemo(
    () => market.map((m) => ({ m, check: checkBuy(state, m.marketIndex) })),
    [state, market],
  );
  const advanceTo = Math.min(TIME_END, bot.time + 1);

  // сохранение партии (только офлайн-режимы — онлайн живёт на сервере)
  useEffect(() => {
    if (state.phase !== 'gameover' && state.mode !== 'online') {
      const store = loadStore();
      store.currentGame = state;
      saveStore(store);
    }
  }, [state]);

  const addPopup = useCallback((pos: number, text: string, kind: TrackPopup['kind']) => {
    const id = popupId.current++;
    setPopups((p) => [...p, { id, pos, text, kind }]);
    setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 1700);
  }, []);

  /** Проигрывание событий: звуки, всплывашки, паузы */
  const playback = useCallback(
    async (events: GameEvent[], movesHuman: boolean) => {
      for (const e of events) {
        if (e.type === 'buttons') {
          const d = e.delta ?? 0;
          if (d > 0) {
            sound.income();
            vibrate(12, settings.current.vibration);
            addPopup(e.to ?? 0, `+${d}`, e.reason === 'advance' ? 'buttons' : 'income');
            await sleep(FAST ? 40 : 260);
          } else if (d < 0 && !movesHuman) {
            sound.buy();
            await sleep(FAST ? 20 : 160);
          }
        } else if (e.type === 'landing') {
          // посадка на клетку соперника: пуговка сверху — ход продолжается без
          // бонусов (просто понятное объяснение, почему ход снова у этого игрока)
          vibrate(12, settings.current.vibration);
          toast({
            title: e.player === 0 ? t('g_landing_you') : t('g_landing_bot', { name: foeName }),
            description: e.player === 0 ? t('g_landing_you_d') : t('g_landing_bot_d'),
          });
          await sleep(FAST ? 60 : 340);
        } else if (e.type === 'place') {
          sound.place();
          vibrate([14, 50, 14], settings.current.vibration);
          if (e.player !== undefined) {
            setFlash({ player: e.player, pieceId: e.pieceId ?? -1, r: e.pos?.r, c: e.pos?.c });
          }
          await sleep(FAST ? 60 : 460);
          setFlash(null);
        } else if (e.type === 'leather') {
          sound.leather();
          if (e.player === 0) {
            toast({
              title: (
                <span className="flex items-center gap-1.5">
                  <LeatherPatchIcon size={18} />
                  {t('g_leather_t')}
                </span>
              ),
              description: t('g_leather_d'),
            });
          }
          await sleep(FAST ? 20 : 200);
        } else if (e.type === 'tile7x7') {
          sound.tile();
          toast({
            title: t('g_tile_t'),
            description:
              e.player === 0 ? t('g_tile_you_d') : t('g_tile_bot_d', { name: foeName }),
          });
          vibrate([30, 60, 30, 60, 60], settings.current.vibration);
          await sleep(FAST ? 60 : 500);
        } else {
          await sleep(FAST ? 10 : 140);
        }
      }
    },
    [addPopup, foeName, lang, toast],
  );

  /** Применить результат действия + анимации */
  const applyResult = useCallback(
    async (res: { state: GameState; events: GameEvent[] }, movesHuman = false) => {
      onState(res.state);
      stateRef.current = res.state;
      await playback(res.events, movesHuman);
    },
    [onState, playback],
  );

  // ===== ХОД БОТА (цикл — бот может действовать несколько раз подряд) =====
  // в онлайн-партии соперник — живой человек: его ходы приходят с сервера
  useEffect(() => {
    if (isOnline) return;
    if (botRunning.current) return;
    const s0 = stateRef.current;
    const needsBot =
      (s0.phase === 'action' && s0.activePlayer === 1) ||
      (s0.phase === 'placing' && currentPending(s0)?.player === 1);
    if (!needsBot) return;

    botRunning.current = true;
    setBusy(true);
    (async () => {
      try {
        sound.ensure();
        let guard = 0;
        while (guard++ < 12) {
          const s = stateRef.current;
          // кожаный лоскуток бота
          if (s.phase === 'placing' && currentPending(s)?.player === 1) {
            await sleep(FAST ? 120 : 650 + Math.random() * 450);
            const cell = decideLeatherCell(s, 1);
            const board = s.players[1].board;
            const fallback = board.findIndex((v) => v === -1);
            const r = cell ? cell.r : Math.floor(fallback / 9);
            const c = cell ? cell.c : fallback % 9;
            await applyResult(placeLeather(s, r, c));
            continue;
          }
          // действие бота
          if (s.phase === 'action' && s.activePlayer === 1) {
            await sleep(BOT_DELAY());
            if (Math.random() < 0.3) setQuip(botQuips[Math.floor(Math.random() * botQuips.length)]);
            const decision = decideBotAction(s);
            if (decision.action === 'advance') {
              sound.advance();
              await applyResult(advanceAction(s));
            } else {
              sound.buy();
              await applyResult(buyAndPlace(s, decision.marketIndex!, decision.placement!));
            }
            const after = stateRef.current;
            const still =
              (after.phase === 'action' && after.activePlayer === 1) ||
              (after.phase === 'placing' && currentPending(after)?.player === 1);
            if (still) continue;
          }
          break;
        }
      } finally {
        botRunning.current = false;
        setBusy(false);
        // повторная проверка на случай гонки эффектов
        const s = stateRef.current;
        if (
          (s.phase === 'action' && s.activePlayer === 1) ||
          (s.phase === 'placing' && currentPending(s)?.player === 1)
        ) {
          setTimeout(() => setBotTick((t) => t + 1), 30);
        }
      }
    })();
  }, [state, applyResult, persona, botTick]);

  // ===== КОНЕЦ ПАРТИИ: СТАТИСТИКА + ФИНАЛЬНЫЙ ЭКРАН =====
  // Работает и в онлайне: когда сервер довёл партию до gameover, вид приходит
  // обоим игрокам (push/ответ на ход), но раньше без этого эффекта финал
  // просто «висел» в игровой вёрстке — экран результатов не показывался ни у
  // кого. Онлайн-вид повёрнут ко мне (я всегда игрок 0), поэтому
  // winner===0 = моя победа, и записи статистики корректны у обеих сторон.
  // Перезагрузка страницы финишированной комнаты НЕ должна записывать партию
  // повторно — маркер «код#gameSeq» в localStorage (одна запись на партию).
  useEffect(() => {
    if (state.phase === 'gameover' && !recorded.current && state.result) {
      recorded.current = true;
      let alreadyRecorded = false;
      if (state.mode === 'online' && online) {
        const KEY = 'loskutki.mp.recorded.v1';
        const marker = JSON.stringify(`${online.roomCode}#${online.gameSeq}`);
        try {
          if (localStorage.getItem(KEY) === marker) alreadyRecorded = true;
          else localStorage.setItem(KEY, marker);
        } catch { /* localStorage недоступен — пишем как раньше */ }
      }
      if (!alreadyRecorded) {
        const r = state.result;
        const store = loadStore();
        const summary: GameSummary = {
          won: r.winner === 0,
          score: r.scores[0].total,
          botLevel: state.botLevel,
          coverage: state.players[0].covered,
          leatherPlaced: state.players[0].board.filter((v) => v === LEATHER_ID).length,
          tile7x7: state.players[0].tile7x7,
          finalButtons: state.players[0].buttons,
          mode: state.mode,
          dailyKey: state.mode === 'daily' ? todayKey() : undefined,
        };
        const { store: next, unlocked } = recordGame(store, summary);
        // офлайн-партию из localStorage убираем; онлайн живёт на сервере
        if (state.mode !== 'online') next.currentGame = null;
        saveStore(next);
        for (const a of unlocked) {
          toast({ title: t('g_ach', { icon: a.icon, title: achTitle(lang, a.id) }), description: achDesc(lang, a.id) });
        }
      }
      setTimeout(() => setEndedShown(true), FAST ? 200 : 900);
    }
  }, [state, toast, lang, online]);

  // ===== ДЕЙСТВИЯ ЧЕЛОВЕКА =====
  const selectPatch = useCallback(
    (marketIndex: 0 | 1 | 2) => {
      const item = market.find((m) => m.marketIndex === marketIndex);
      if (!item) return;
      const check = checks.find((x) => x.m.marketIndex === marketIndex)?.check;
      if (!check?.allowed) {
        sound.error();
        vibrate(60, settings.current.vibration);
        return;
      }
      sound.ensure();
      sound.tap();
      // Позиция НЕ подставляется автоматически — это работа подсказки.
      // Без лампочки призрак появляется в центре полотна, и игрок сразу тащит
      // его пальцем на нужное место; с (разовой) подсказкой — на рекомендуемом месте.
      const sug = showHint ? suggestPlacement(state, 0, item.patchId) : null;
      const orients = orientationsFor(item.patchId);
      const o = sug?.orientation ?? 0;
      const or = orients[o];
      setPlacing({
        marketIndex,
        patchId: item.patchId,
        orientation: o,
        r: sug ? sug.r : Math.floor((9 - or.h) / 2),
        c: sug ? sug.c : Math.floor((9 - or.w) / 2),
      });
      // подсказка разовая: сработала при выборе карточки — гасим до следующего
      // нажатия лампочки
      if (showHint) setShowHint(false);
    },
    [market, checks, state, showHint],
  );

  const confirmPlacement = useCallback(async () => {
    if (!placing) return;
    if (online?.busy) return; // ход уже в полёте — второй тап игнорируем молча
    if (!isLegalPlacement(me.board, placing.patchId, placing)) {
      sound.error();
      vibrate(70, settings.current.vibration);
      return;
    }
    // онлайн: размещение проверяет и применяет сервер
    if (online) {
      const res = await online.submit({
        type: 'buy',
        marketIndex: placing.marketIndex,
        orientation: placing.orientation,
        r: placing.r,
        c: placing.c,
      });
      if (!res.ok) {
        // 'busy' — не ошибка: наш же первый ход ещё обрабатывается.
        // Прочие отказы клиент уже пробовал повторить сам (OnlineGameScreen);
        // сюда доходит только реальная невозможность хода
        if (res.error !== 'busy') {
          sound.error();
          vibrate(70, settings.current.vibration);
          toast({ title: t('mp_move_rejected') });
        }
        return;
      }
      setPlacing(null);
      sound.buy();
      await applyResult(res, true);
      return;
    }
    const res = buyAndPlace(state, placing.marketIndex, {
      orientation: placing.orientation,
      r: placing.r,
      c: placing.c,
    });
    setPlacing(null);
    sound.buy();
    await applyResult(res, true);
  }, [placing, me.board, state, applyResult, online, toast]);

  const doAdvance = useCallback(async () => {
    if (!myTurn) return;
    if (online?.busy) return; // ход уже в полёте
    sound.ensure();
    sound.advance();
    setPlacing(null);
    // подсказка разовая — любое действие игрока её гасит
    setShowHint(false);
    if (online) {
      const res = await online.submit({ type: 'advance' });
      if (!res.ok) {
        if (res.error !== 'busy') {
          sound.error();
          toast({ title: t('mp_move_rejected') });
        }
        return;
      }
      await applyResult(res, true);
      return;
    }
    await applyResult(advanceAction(state), true);
  }, [myTurn, state, applyResult, online, toast]);

  const placeLeatherHuman = useCallback(
    async (r: number, c: number) => {
      if (me.board[r * 9 + c] !== -1) {
        sound.error();
        return;
      }
      if (online?.busy) return;
      if (online) {
        const res = await online.submit({ type: 'leather', r, c });
        if (!res.ok) {
          if (res.error !== 'busy') sound.error();
          return;
        }
        await applyResult(res, true);
        return;
      }
      await applyResult(placeLeather(state, r, c), true);
    },
    [me.board, state, applyResult, online],
  );

  // ===== ОНЛАЙН: события чужого хода (пришли poll'ом) — проиграть один раз =====
  const remotePlayed = useRef(0);
  useEffect(() => {
    if (!online) return;
    if (online.remoteEventsId <= remotePlayed.current) return;
    remotePlayed.current = online.remoteEventsId;
    if (online.remoteEvents && online.remoteEvents.length > 0) {
      void playback(online.remoteEvents, false);
    }
  }, [online]);

  const ghostLegal = useMemo(
    () => (placing ? isLegalPlacement(me.board, placing.patchId, placing) : false),
    [placing, me.board],
  );

  // подсказка (кнопка-лампочка) — разовая: активна до первого использования
  const hint = useMemo(() => {
    if (!showHint || !myTurn) return null;
    return suggestForHuman(state);
  }, [showHint, myTurn, state]);

  /** текст подсказки — что именно советуем сделать */
  const hintText = (() => {
    if (!hint) return null;
    if (hint.action === 'buy' && hint.marketIndex !== undefined) {
      const item = market.find((x) => x.marketIndex === hint.marketIndex);
      if (!item) return null;
      const p = PATCHES[item.patchId];
      const maxR = Math.max(...p.cells.map((c) => c[0])) + 1;
      const maxC = Math.max(...p.cells.map((c) => c[1])) + 1;
      return t('g_hint_buy', {
        name: patchName(lang, item.patchId),
        cost: p.cost,
        w: maxC,
        h: maxR,
        inc: p.income > 0 ? t('g_hint_buy_inc', { n: p.income }) : '',
      });
    }
    return t('g_hint_adv', {
      n: advPreview.buttonGain,
      leath: advPreview.leathers > 0 ? t('g_hint_adv_leath') : '',
    });
  })();

  const quiltPlacing = placing
    ? { patchId: placing.patchId, orientation: placing.orientation, r: placing.r, c: placing.c }
    : null;

  const emptyHighlight = useMemo(() => {
    if (!leatherHuman) return null;
    const s = new Set<number>();
    me.board.forEach((v, i) => {
      if (v === -1) s.add(i);
    });
    return s;
  }, [leatherHuman, me.board]);

  const upcoming = useMemo(() => {
    const n = state.circle.length;
    const out: number[] = [];
    // ВСЕ лоскутки дальше в пути — после доступных у токена
    for (let i = market.length; i < n; i++) {
      out.push(state.circle[(state.tokenIndex + 1 + i) % n]);
    }
    return out;
  }, [state, market]);

  const turnBanner = (() => {
    if (state.phase === 'gameover') return t('g_over');
    if (leatherHuman) return t('g_leather_turn');
    if (placingNow) return t('g_place');
    if (busy && state.activePlayer === 1) return t('g_bot_turn', { name: foeName });
    if (myTurn) return t('g_your_turn');
    if (state.activePlayer === 1) return t('g_bot_turn', { name: foeName });
    return '';
  })();
  const mySideNow = myTurn || placingNow || leatherHuman;

  // ===== ПРЯМОЕ ПЕРЕТАСКИВАНИЕ С КАРТОЧКИ НА ПОЛЕ =====
  /** координаты пальца → клетка полотна (с учётом letterbox) */
  const cellFromClient = useCallback((clientX: number, clientY: number) => {
    const host = boardHostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const side = Math.min(rect.width, rect.height);
    const offX = (rect.width - side) / 2;
    const offY = (rect.height - side) / 2;
    const scale = 9 / side;
    const c = Math.floor((clientX - rect.left - offX) * scale);
    const r = Math.floor((clientY - rect.top - offY) * scale);
    if (r < 0 || r > 8 || c < 0 || c > 8) return null;
    return { r, c };
  }, []);

  /** нажатие на карточку: тап — выбрать, потянуть — перетащить прямо на полотно */
  const cardPointerDown = useCallback(
    (e: React.PointerEvent, marketIndex: 0 | 1 | 2, patchId: number) => {
      if (!myTurn || busy || placingNow || leatherHuman) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const check = checks.find((x) => x.m.marketIndex === marketIndex)?.check;
      const startX = e.clientX;
      const startY = e.clientY;
      // фигурка переносится КАК ЕСТЬ — в той ориентации, в какой лежит в ряду
      // (поворот и отражение — только осознанными кнопками игрока)
      const orientation = 0;
      let moved = false;
      let ghostSet = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      };
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 12) return;
        if (!moved) {
          moved = true;
          sound.ensure();
        }
        const cell = cellFromClient(ev.clientX, ev.clientY);
        if (cell && check?.allowed) {
          const o = orientationsFor(patchId)[orientation];
          const r = Math.max(0, Math.min(9 - o.h, cell.r - Math.floor((o.h - 1) / 2)));
          const c = Math.max(0, Math.min(9 - o.w, cell.c - Math.floor((o.w - 1) / 2)));
          // перетащили карточку на полотно — разовая подсказка использована
          if (!ghostSet) setShowHint(false);
          setPlacing({ marketIndex, patchId, orientation, r, c });
          ghostSet = true;
          setDragChip(null);
        } else {
          if (ghostSet) {
            setPlacing(null);
            ghostSet = false;
          }
          setDragChip({ x: ev.clientX, y: ev.clientY, patchId, marketIndex });
        }
      };
      const up = (ev: PointerEvent) => {
        cleanup();
        setDragChip(null);
        if (!moved) return; // простой тап — карточка сама вызовет onSelect
        const cell = cellFromClient(ev.clientX, ev.clientY);
        if (cell && ghostSet) {
          sound.tap();
          vibrate(10, settings.current.vibration);
        } else if (ghostSet) {
          setPlacing(null);
        } else if (!check?.allowed) {
          sound.error();
          vibrate(50, settings.current.vibration);
        }
      };
      const cancel = () => {
        cleanup();
        setDragChip(null);
        if (ghostSet) setPlacing(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [myTurn, busy, placingNow, leatherHuman, checks, state, cellFromClient],
  );

  /** позиция плавающей панели действий (привязана к фигуре на полотне, не выходит за экран) */
  const toolbarPos = useMemo(() => {
    if (!placing) return null;
    const o = orientationsFor(placing.patchId)[placing.orientation];
    const cxPct = ((placing.c + o.w / 2) / 9) * 100;
    const bottomPct = ((placing.r + o.h) / 9) * 100;
    const topPct = (placing.r / 9) * 100;
    const below = bottomPct < 62;
    return {
      // панель ~304px: центр клампим так, чтобы она всегда была целиком на полотне
      left: `clamp(158px, ${cxPct}%, calc(100% - 158px))`,
      top: below ? `calc(${bottomPct}% + 10px)` : `calc(${topPct}% - 64px)`,
    };
  }, [placing]);

  const tablet = useIsTablet();
  /** большой портретный экран (планшет вертикально): телефонная вёрстка,
  * но колонка шире и все элементы крупнее — экран используется по-максимуму */
  const bigPort = useIsBigPortrait();
  /** любой «большой» экран — крупная лента «дальше в пути» и пр. */
  const big = tablet || bigPort;
  /** аватар соперника: побольше на каждом размере экрана, чтобы круглое фото
   *  заполняло свою рамку, а не «плавало» в ней (было 32 везде) */
  const foeIconSize = tablet ? 46 : bigPort ? 40 : 36;
  /** онлайн: ход в полёте — блокируем ввод, чтобы второй тап не дал отказ */
  const onlineBusy = online?.busy ?? false;

  // ===== блоки интерфейса (компонуются по-разному для телефона и планшета) =====
  const headerNode = (
        <div className="flex items-center justify-between py-0.5">
          <button
            type="button"
            onClick={() => {
              sound.tap();
              onExit();
            }}
            className={`btn-cloth flex items-center justify-center rounded-xl ${bigPort ? 'h-10 w-10' : 'h-8 w-8'}`}
            aria-label={t('g_exit')}
          >
            <ArrowLeft className={bigPort ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]'} />
          </button>
          <div className="min-w-[130px] text-center leading-tight">
            <div className={`font-display text-foreground ${bigPort ? 'text-[20px]' : 'text-[17px]'}`}>{t('app_title')}</div>
            {/* индикатор хода — компакт, в подзаголовке (не занимает отдельную строку) */}
            <div
              key={turnBanner}
              className={`banner-in flex items-center justify-center gap-1.5 font-extrabold tracking-wide ${
                bigPort ? 'text-[12.5px]' : 'text-[10.5px]'
              } ${
                mySideNow ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              {mySideNow ? (
                <HourglassIcon size={bigPort ? 14 : 12} className="shrink-0" />
              ) : (
                <ClockIcon size={bigPort ? 14 : 12} className="shrink-0 opacity-70" />
              )}
              <span className="truncate">{turnBanner || (state.mode === 'daily' ? t('daily_mode', { n: dailyNumber(new Date()) }) : state.mode === 'online' ? t('mp_mode') : t('duel_mode'))}</span>
              {isOnline && online?.turnDeadline != null && (
                <TurnTimer
                  deadline={online.turnDeadline}
                  offset={online.clockOffset}
                  mine={mySideNow}
                  paused={online.turnPaused}
                />
              )}
            </div>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                sound.tap();
                // Разовая подсказка: одно нажатие — один совет (лимита нет, жмите
                // сколько нужно). Если лоскуток уже размещается — сразу переставляем
                // призрак на рекомендуемое место; иначе совет показывается до
                // первого использования и гаснет.
                if (placing) {
                  const sug = suggestPlacement(state, 0, placing.patchId);
                  if (sug) {
                    setPlacing((p) => (p ? { ...p, orientation: sug.orientation, r: sug.r, c: sug.c } : p));
                  }
                  setShowHint(false);
                  return;
                }
                if (!myTurn) return;
                setShowHint((v) => !v);
              }}
              className={`btn-cloth flex items-center justify-center rounded-xl ${
                bigPort ? 'h-10 w-10' : 'h-8 w-8'
              } ${
                showHint ? 'bg-[#FFF7E0] ring-2 ring-[#D9A13F]' : ''
              }`}
              aria-label={t('g_hint')}
            >
              <Lightbulb className={bigPort ? 'h-5 w-5' : 'h-4 w-4'} fill={showHint ? '#FFD98A' : 'none'} />
            </button>
            <button
              type="button"
              onClick={() => {
                sound.tap();
                onOpenRules();
              }}
              className={`btn-cloth flex items-center justify-center rounded-xl ${bigPort ? 'h-10 w-10' : 'h-8 w-8'}`}
              aria-label={t('g_rules')}
            >
              <BookOpen className={bigPort ? 'h-5 w-5' : 'h-4 w-4'} />
            </button>
          </div>
        </div>

  );

  const opponentNode = (
        <div
          className={`stitched-card fabric-lattice flex items-center gap-1 px-1.5 py-0 ${
            // планшет (ландшафт): карточка заполняет всю высоту полосы с дорожкой —
            // иначе вокруг маленькой карточки соперника оставались пустые поля
            tablet ? 'self-stretch' : ''
          }`}
        >
          <div className="flex shrink-0 items-center justify-center rounded-xl border-2 border-[#A9855A]/60 bg-[#F4EAD2] p-[2px] shadow-[inset_0_1px_3px_rgba(122,82,48,.25)]">
            {foeAvatar ? (
              <Portrait src={foeAvatar} size={foeIconSize} thinking={state.activePlayer === 1 && state.phase !== 'gameover'} alt={foeName} />
            ) : (
              <BotAvatar level={state.botLevel} size={foeIconSize} thinking={busy && state.activePlayer === 1} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-extrabold text-foreground">{foeName}</div>
            <div className={`truncate text-[9px] font-bold ${isOnline && online && online.opponent.connected && !online.opponent.left ? 'text-primary' : 'text-muted-foreground'}`}>{foeSub}</div>
          </div>
          <div className="flex items-center gap-0.5">
            <EnemyTile icon={<CoinIcon size={14} />} value={bot.buttons} title={t('g_rival_buttons')} />
            <EnemyTile icon={<IncomeIcon size={14} />} value={`+${bot.income}`} title={t('g_rival_income')} />
            <EnemyTile
              icon={<ClockIcon size={14} />}
              value={
                <>
                  {bot.time}
                  <span className="text-[8px] font-bold text-muted-foreground">/53</span>
                </>
              }
              title={t('g_rival_time', { t: bot.time })}
            />
            {bot.tile7x7 && (
              <div className="pop-in flex h-8 w-7 items-center justify-center text-[13px]" title={t('g_tile7x7')}>
                🏅
              </div>
            )}
          </div>
          <Sheet open={showBotBoard} onOpenChange={setShowBotBoard}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="btn-cloth flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl"
                aria-label={t('g_view_rival')}
              >
                <BoardFillIcon size={17} covered={bot.covered} />
                <span className="text-[8.5px] font-extrabold leading-none text-foreground/80">{bot.covered}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(92vw,380px)] overflow-y-auto nice-scroll">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 font-display text-[20px]">
                  {foeAvatar ? <Portrait src={foeAvatar} size={foeIconSize} alt={foeName} /> : <BotAvatar level={state.botLevel} size={foeIconSize} />} {foeName}
                </SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6">
                <MiniQuilt board={bot.board} className="w-full rounded-xl border-2 border-border" />
                <div className="mt-3 flex justify-center gap-2">
                  <BigStat icon={<CoinIcon size={22} />} value={bot.buttons} label={t('g_buttons')} />
                  <BigStat icon={<IncomeIcon size={22} />} value={bot.income} label={t('g_income')} />
                </div>
                {quip && (
                  <div className="mt-3 rounded-xl bg-muted px-3 py-2 text-center text-[13px] font-semibold italic text-muted-foreground">
                    «{quip}»
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>

  );

  const trackNode = (
        <div className={tablet ? 'w-[min(44vw,420px)] shrink-0' : 'mt-1'}>
          <TimeTrack
            positions={[me.time, bot.time]}
            activePlayer={state.activePlayer}
            onTop={state.topToken ?? state.activePlayer}
            labels={[t('pin_me'), foeInitial]}
            leatherClaimed={state.leatherClaimed}
            popups={popups}
            advanceHint={myTurn ? { player: 0, from: me.time, to: advanceTo } : null}
          />
        </div>

  );

  const statsNode = (
        <div className={tablet ? 'grid shrink-0 grid-cols-2 gap-1' : `mt-1 flex items-center justify-center ${bigPort ? 'gap-2' : 'gap-1'}`}>
          <BigStat icon={<CoinIcon size={bigPort ? 21 : 17} />} value={me.buttons} label={t('g_buttons')} accent title={t('g_my_buttons')} big={bigPort} />
          <BigStat icon={<IncomeIcon size={bigPort ? 20 : 16} />} value={`+${me.income}`} label={t('g_income')} title={t('g_my_income')} big={bigPort} />
          <BigStat icon={<ClockIcon size={bigPort ? 20 : 16} />} value={me.time} label={t('g_of53')} title={t('g_my_time', { t: me.time })} big={bigPort} />
          <BigStat
            icon={<BoardFillIcon size={bigPort ? 20 : 16} covered={me.covered} />}
            value={me.covered}
            label={t('g_cells')}
            title={t('g_my_cells', { n: me.covered })}
            big={bigPort}
          />
          {me.tile7x7 && (
            <div className={`pop-in flex items-center justify-center rounded-xl bg-[#D9A13F]/25 text-[15px] ${bigPort ? 'h-[42px] w-10 text-[18px]' : 'h-[34px] w-8'}`} title={t('g_tile7x7')}>
              🏅
            </div>
          )}
        </div>

  );

  const boardNode = (
        <div className={tablet ? 'flex min-h-0 min-w-0 flex-1 items-center justify-center' : 'mt-1 flex min-h-0 flex-1 items-center justify-center'}>
          <div ref={boardHostRef} className={tablet ? 'relative aspect-square max-h-full w-full' : `relative aspect-square max-h-full w-full ${bigPort ? 'max-w-none' : 'max-w-[520px]'}`}>
            <QuiltBoard
              board={me.board}
              interactive={(placingNow || leatherHuman) && !busy && !onlineBusy && !dragActive}
              placing={quiltPlacing}
              onPlace={(r, c) => {
                if (leatherHuman) void placeLeatherHuman(r, c);
                else if (placing) setPlacing((p) => (p ? { ...p, r, c } : p));
              }}
              highlightCells={emptyHighlight}
              flashPiece={
                flash?.player === 0 ? { pieceId: flash.pieceId, r: flash.r, c: flash.c } : null
              }
              showPlacementGrid={placingNow && hintOn}
              ghostBadges={
                placing ? { cost: PATCHES[placing.patchId].cost, time: PATCHES[placing.patchId].time } : null
              }
              className="h-full w-full"
            />
            {leatherHuman && (
              <div className="pointer-events-none absolute -top-1 left-1/2 z-10 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 whitespace-nowrap rounded-full bg-[#7A5230] px-3 py-1 text-[12px] font-bold text-[#F2E6CD] shadow-lg">
                <LeatherPatchIcon size={14} />
                {t('g_leather_tip')}
              </div>
            )}

            {/* Подсказка: понятная плашка с текстом совета */}
            {hint && hintText && (
              <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 flex w-max max-w-[96%] -translate-x-1/2 flex-col items-center">
                <div className="flex items-center gap-2 rounded-2xl border-2 border-[#D9A13F] bg-[#FFF7E0] px-3 py-1.5 shadow-xl">
                  <Lightbulb className="h-5 w-5 shrink-0 text-[#A6721F]" fill="#FFD98A" />
                  <span className="text-[13px] leading-snug font-extrabold text-[#6E4E0B]">{hintText}</span>
                </div>
                <div className="h-0 w-0 border-x-[9px] border-t-[10px] border-x-transparent border-t-[#D9A13F]" />
              </div>
            )}

            {/* Плавающая панель действий — прикреплена к фигуре */}
            {placingNow && placing && toolbarPos && (
              <div
                className="pop-in absolute z-30 -translate-x-1/2"
                style={{ left: toolbarPos.left, top: toolbarPos.top }}
              >
                <div className="flex items-center gap-1.5 rounded-2xl border-2 border-border bg-card/95 p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      sound.tap();
                      setPlacing(null);
                    }}
                    className="btn-cloth flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    aria-label={t('g_cancel')}
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sound.tap();
                      vibrate(8, settings.current.vibration);
                      setPlacing((p) => {
                        if (!p) return p;
                        const o = rotatedOrientation(p.patchId, p.orientation);
                        const orient = orientationsFor(p.patchId)[o];
                        return {
                          ...p,
                          orientation: o,
                          r: Math.min(p.r, 9 - orient.h),
                          c: Math.min(p.c, 9 - orient.w),
                        };
                      });
                    }}
                    className="btn-cloth flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    aria-label={t('g_rotate')}
                  >
                    <RotateCw className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sound.tap();
                      vibrate(8, settings.current.vibration);
                      setPlacing((p) => {
                        if (!p) return p;
                        const o = mirroredOrientation(p.patchId, p.orientation);
                        const orient = orientationsFor(p.patchId)[o];
                        return {
                          ...p,
                          orientation: o,
                          r: Math.min(p.r, 9 - orient.h),
                          c: Math.min(p.c, 9 - orient.w),
                        };
                      });
                    }}
                    className="btn-cloth flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    aria-label={t('g_flip')}
                  >
                    <FlipHorizontal className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmPlacement()}
                    disabled={!ghostLegal || onlineBusy}
                    className="btn-wood flex h-11 items-center gap-1.5 rounded-full px-5 text-[15.5px] font-extrabold"
                    aria-label={t('g_sew_aria')}
                  >
                    <Check className="h-5 w-5" />
                    {t('g_sew')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

  );

  const marketNode = (
        <div className={tablet ? 'flex min-h-0 w-full flex-1 flex-col' : 'mt-2'}>
          <div
            className={`${tablet ? 'flex min-h-0 flex-1 flex-col gap-2' : `-ml-1.5 flex ${bigPort ? 'gap-2.5' : 'gap-1.5'}`} transition-opacity ${
              placingNow && !dragActive ? 'pointer-events-none opacity-40' : 'opacity-100'
            }`}
          >
            {checks.map(({ m, check }) => (
              <div
                key={m.marketIndex}
                className={tablet ? 'flex min-h-0 flex-1' : 'min-w-0 flex-1'}
                onPointerDown={(e) => cardPointerDown(e, m.marketIndex, m.patchId)}
              >
                <MarketCard
                  patchId={m.patchId}
                  buttons={me.buttons}
                  placeable={check.placeable}
                  tall={tablet}
                  big={bigPort}
                  selected={
                    hint && hint.action === 'buy' && hint.marketIndex === m.marketIndex
                      ? true
                      : placing?.marketIndex === m.marketIndex
                  }
                  disabled={!myTurn || busy || onlineBusy}
                  onSelect={() => selectPatch(m.marketIndex)}
                />
              </div>
            ))}
          </div>
          {/* Лента «дальше в пути»: все оставшиеся лоскутки круга, тап — карточка с данными */}
          <div className={tablet ? 'mt-1 shrink-0' : 'mt-1'}>
            <UpcomingRibbon
              upcoming={upcoming}
              big={big}
              onSelect={(id) => {
                sound.tap();
                setRibbonDetail(id);
              }}
            />
          </div>
        </div>

  );

  const advanceNode = (
        <button
          type="button"
          onClick={doAdvance}
          disabled={!myTurn || busy || onlineBusy}
          className={`btn-wood mt-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 ${
            bigPort ? 'h-14' : 'h-12'
          } ${
            forcedAdvance && myTurn ? 'animate-pulse ring-3 ring-[#FFD98A]' : ''
          } ${hint && hint.action === 'advance' ? 'ring-4 ring-[#D9A13F]' : ''}`}
          aria-label={t('g_advance_aria', { from: me.time, to: advanceTo, n: advPreview.buttonGain })}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronsRight className={`shrink-0 ${bigPort ? 'h-6 w-6' : 'h-5 w-5'}`} />
            <span className={`shrink-0 font-extrabold ${bigPort ? 'text-[16.5px]' : 'text-[14.5px]'}`}>{t('g_advance')}</span>
            {/* числа и значок времени — в заметной тёмной плашке, не сливаются с кнопкой */}
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#3F2A14]/35 px-2 py-1 shadow-[inset_0_1px_2px_rgba(0,0,0,.25)]">
              <span className={`tabular-nums leading-none font-extrabold ${bigPort ? 'text-[15.5px]' : 'text-[14px]'}`}>{me.time}</span>
              <ArrowRight className={`shrink-0 ${bigPort ? 'h-5 w-5' : 'h-4.5 w-4.5'}`} strokeWidth={3.4} />
              <span className={`tabular-nums leading-none font-extrabold ${bigPort ? 'text-[15.5px]' : 'text-[14px]'}`}>{advanceTo}</span>
              <ClockIcon size={bigPort ? 16 : 14} />
            </span>
          </span>
          <span className={`flex shrink-0 items-center gap-1 font-extrabold ${bigPort ? 'text-[16.5px]' : 'text-[15px]'}`}>
            <span className="tabular-nums">+{advPreview.buttonGain}</span>
            <CoinIcon size={bigPort ? 19 : 17} />
            {advPreview.leathers > 0 && (
              <span
                className="ml-1 flex items-center gap-0.5 rounded-full bg-[#7A5230]/70 px-1.5 py-0.5"
                title={advPreview.leathers > 1 ? t('g_leather_n', { n: advPreview.leathers }) : t('g_leather_1')}
              >
                <LeatherPatchIcon size={13} />
                {advPreview.leathers > 1 && (
                  <span className="text-[10px] leading-none font-bold text-[#F2E6CD]">×{advPreview.leathers}</span>
                )}
              </span>
            )}
          </span>
        </button>
  );

  return (
    <div
      className={
        tablet
          ? 'mx-auto flex h-svh w-full max-w-[1600px] select-none flex-col overflow-hidden px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-[max(env(safe-area-inset-top),6px)]'
          : `mx-auto flex h-svh w-full select-none flex-col overflow-hidden ${
              bigPort
                ? 'max-w-[min(96vw,760px)] px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-[max(env(safe-area-inset-top),8px)]'
                : 'max-w-[560px] px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-[max(env(safe-area-inset-top),4px)]'
            }`
      }
    >
      {tablet ? (
        <div className="flex min-h-0 w-full flex-1 flex-col">
          {headerNode}
          {/* компактная информационная полоса: дорожка времени + мои показатели + соперник
              (дорожка и соперник — «по минимуму», главную площадь занимает полотно) */}
          <div className="mt-1 flex min-h-0 shrink-0 items-center gap-2 overflow-hidden">
            {trackNode}
            {statsNode}
            <div className={`flex min-h-0 min-w-0 flex-1 items-center overflow-hidden ${tablet ? 'self-stretch' : ''}`}>
              {opponentNode}
            </div>
          </div>
          {/* главная зона: полотно занимает максимум места, справа — рынок и шаг вперёд.
              Колонка рынка ТЕКУЧАЯ (26% ширины, 280–420px): на широких планшетах
              карточки и лента крупнеют вместе с экраном, а не «висят» мелкими
              при пустых полях по бокам */}
          <div className="mt-1 flex min-h-0 flex-1 gap-2">
            {boardNode}
            <aside className="flex w-[clamp(300px,30vw,440px)] shrink-0 flex-col gap-2 overflow-hidden pb-0.5">
              {marketNode}
              {advanceNode}
            </aside>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 w-full flex-col">
          {headerNode}
          {opponentNode}
          {trackNode}
          {statsNode}
          {boardNode}
          {marketNode}
          {advanceNode}
        </div>
      )}

      {/* Карточка лоскутка из ленты «дальше в пути» */}
      {ribbonDetail !== null && (
        <PatchDetailPopup patchId={ribbonDetail} onClose={() => setRibbonDetail(null)} />
      )}

      {/* Чип перетаскивания — следует за пальцем вне полотна */}
      {dragChip && (
        <div
          className="pointer-events-none fixed z-50 select-none"
          style={{ left: dragChip.x, top: dragChip.y, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative">
            <div className="flex h-[70px] w-[70px] items-center justify-center rounded-2xl border-2 border-[#A9855A]/50 bg-card/90 shadow-xl">
              <DragGlyph patchId={dragChip.patchId} />
            </div>
            <div className="absolute -top-1 -right-1 flex flex-col items-end gap-1">
              <BadgePill icon={<CoinIcon size={12} />} value={PATCHES[dragChip.patchId].cost} />
              <BadgePill icon={<ClockIcon size={12} />} value={PATCHES[dragChip.patchId].time} />
            </div>
          </div>
        </div>
      )}

      {/* Финал */}
      {state.phase === 'gameover' && endedShown && (
        <EndScreen
          state={state}
          opponent={isOnline && online ? { name: online.opponent.name, avatar: avatarUrl(online.opponent.avatar) } : undefined}
          onRematch={() => {
            sound.tap();
            onRematch();
          }}
          onHome={() => {
            sound.tap();
            onExit();
          }}
        />
      )}
    </div>
  );
}


/** Компактная вертикальная плитка показателя соперницы */
function EnemyTile({ icon, value, title }: { icon: React.ReactNode; value: React.ReactNode; title: string }) {
  return (
    <div
      className="flex min-w-[30px] flex-col items-center gap-0.5 rounded-lg border border-border bg-card/85 px-1 py-0.5"
      title={title}
    >
      <span className="flex h-[15px] items-center justify-center">{icon}</span>
      <span className="flex h-[13px] items-center text-[12px] leading-none font-extrabold text-foreground">{value}</span>
    </div>
  );
}

/** Таймер хода (онлайн): mm:ss; краснеет и пульсирует на последних 30 секундах.
 *  Приостановлен (владелец хода пропал) — иконка паузы вместо отсчёта. */
function TurnTimer({
  deadline,
  offset,
  mine,
  paused,
}: {
  deadline: number;
  offset: number;
  mine: boolean;
  paused: boolean;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(id);
  }, []);
  if (paused) {
    return (
      <span
        className="ml-0.5 flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-extrabold leading-none text-muted-foreground"
        title={t('mp_timer_paused')}
      >
        <Pause className="h-2.5 w-2.5" strokeWidth={3.2} />
      </span>
    );
  }
  const left = Math.max(0, deadline - (Date.now() + offset));
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  const urgent = left < 30_000;
  return (
    <span
      className={`ml-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-extrabold leading-none tabular-nums ${
        urgent
          ? 'animate-pulse bg-destructive/15 text-destructive'
          : mine
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-muted-foreground'
      }`}
      title={t('mp_timer_title')}
    >
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  );
}

/** Мини-глиф лоскутка для чипа перетаскивания */
function DragGlyph({ patchId }: { patchId: number }) {
  const patch = PATCHES[patchId];
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  const maxDim = Math.max(maxR, maxC);
  const size = Math.min(56, 15 + maxDim * 9);
  // запас под обводку контура, чтобы фигурку не подрезало по краям svg
  const vbPad = 0.05;
  return (
    <svg width={size} height={size} viewBox={`${-vbPad} ${-vbPad} ${maxDim + vbPad * 2} ${maxDim + vbPad * 2}`} aria-hidden>
      <g transform={`translate(${(maxDim - maxC) / 2} ${(maxDim - maxR) / 2})`}>
        <GlyphDirect patchId={patchId} />
      </g>
    </svg>
  );
}
