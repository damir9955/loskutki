'use client';

/**
 * ГЛОБАЛЬНЫЙ попап «Вызов на поединок!»: когда друг зовёт вас в игру,
 * поверх ЛЮБОГО экрана (главное меню, хаб, офлайн-партия, онлайн-партия)
 * всплывает карточка с портретом зовущего, таймером жизни приглашения
 * (60с) и кнопками «Принять» / «Отклонить».
 *
 * Закрыть «мимо кнопки» нельзя (клик мимо и Esc игнорируются) — решение
 * должно быть явным. Пока приглашение живо, оно висит; истекло или зовущий
 * передумал — карточка исчезает сама.
 *
 * Принятие во время активной онлайн-партии: кнопка честно предупреждает
 * «Прервать и играть» (текущая партия будет покинута — соперник увидит
 * это сразу), офлайн-партия с ботом сохраняется на «Продолжить партию».
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Swords, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Portrait } from './MarketRow';
import { avatarUrl } from '@/lib/avatars';
import { t } from '@/lib/i18n';
import { sound, vibrate } from '@/lib/sound';
import { loadStore } from '@/lib/storage';
import { useToast } from '@/hooks/use-toast';
import { useOnline } from '@/lib/useOnline';
import {
  frErrorKey,
  frInviteAccept,
  frInviteDecline,
  useFriends,
  type InviteInfo,
} from '@/lib/friends';

const INVITE_TTL_MS = 60_000;

export interface ChallengeAcceptedSession {
  playerId: string;
  code: string;
  name: string;
  avatar: string;
}

interface InviteChallengePopupProps {
  /** игрок сейчас в активной онлайн-партии — accepting прервёт её */
  inOnlineGame: boolean;
  /** приглашение принято: страница переключается в новую партию (гость) */
  onAccepted: (s: ChallengeAcceptedSession) => void;
}

export function InviteChallengePopup({ inOnlineGame, onAccepted }: InviteChallengePopupProps) {
  const { toast } = useToast();
  const online = useOnline();
  const fr = useFriends();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // живое (не просроченное) приглашение — показываем самое свежее
  // (нижней границы нет: часы клиента могут отставать от сервера)
  const invite: InviteInfo | null = useMemo(() => {
    const alive = fr.invites.filter((i) => now - (i.at ?? 0) < INVITE_TTL_MS);
    if (alive.length === 0) return null;
    return alive.reduce((a, b) => (a.at >= b.at ? a : b));
  }, [fr.invites, now]);

  // тикаем раз в секунду, пока есть приглашения (таймер на карточке)
  useEffect(() => {
    if (fr.invites.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fr.invites.length]);

  // звук + вибрация при появлении НОВОГО вызова (один раз на приглашение)
  const announced = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!invite) return;
    const key = `${invite.from.uid}:${invite.at}`;
    if (announced.current.has(key)) return;
    announced.current.add(key);
    // набор звуков ограничен: не спамим, если ключей накопилось много
    if (announced.current.size > 40) {
      announced.current = new Set([...announced.current].slice(-20));
    }
    sound.ensure();
    sound.challenge();
    vibrate([140, 70, 140], loadStore().settings.vibration);
  }, [invite]);

  // секунды до конца жизни приглашения (защита от расхождения часов:
  // показываем не больше полного TTL)
  const secLeft = invite
    ? Math.max(0, Math.min(Math.ceil((invite.at + INVITE_TTL_MS - now) / 1000), INVITE_TTL_MS / 1000))
    : 0;

  const doAccept = async () => {
    if (!invite || busy) return;
    setBusy(true);
    sound.ensure();
    sound.tap();
    const uid = invite.from.uid;
    const res = await frInviteAccept(uid);
    setBusy(false);
    if (res.ok && res.code && res.playerId) {
      onAccepted({
        playerId: res.playerId,
        code: res.code,
        name: invite.from.name,
        avatar: invite.from.avatar,
      });
    } else {
      // «gone» — зовущий уже отменил / истекло; прочее — сеть
      toast({ title: t(frErrorKey(res.error ?? '')) });
    }
  };

  const doDecline = () => {
    if (!invite || busy) return;
    sound.tap();
    void frInviteDecline(invite.from.uid);
  };

  if (!online) return null;

  // кольцо таймера (SVG): остаток секунды → доля окружности
  const R = 26;
  const C = 2 * Math.PI * R;
  const frac = Math.max(0, Math.min(1, secLeft / (INVITE_TTL_MS / 1000)));

  return (
    <Dialog open={!!invite}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="grid-cols-[minmax(0,1fr)] w-[min(92vw,400px)] gap-0 overflow-hidden rounded-2xl border-2 border-[#B98A5A]/60 p-0"
      >
        {/* заголовок-плашка */}
        <div className="relative flex items-center justify-center gap-2 border-b-2 border-dashed border-[#B98A5A]/40 bg-[#8AA06F]/15 px-4 py-3">
          <Swords className="h-5 w-5 text-[#4e6437]" />
          <span
            className="font-display text-[21px] uppercase tracking-wide text-[#4e6437]"
            style={{ textShadow: '0 2px 0 rgba(169,133,90,.25)' }}
          >
            {t('fr_challenge_t')}
          </span>
        </div>

        {invite && (
          <div className="flex flex-col items-center gap-1 px-5 pb-5 pt-4">
            {/* портрет + имя */}
            <div className="pop-in flex flex-col items-center gap-2">
              <div className="rounded-full border-2 border-[#B98A5A]/50 p-1 shadow-md">
                <Portrait src={avatarUrl(invite.from.avatar)} size={86} alt={invite.from.name} />
              </div>
              <div className="max-w-full truncate text-center text-[19px] font-extrabold text-foreground">
                {invite.from.name}
              </div>
              <div className="text-center text-[14px] font-bold text-muted-foreground">
                {t('fr_challenge_d', { name: invite.from.name })}
              </div>
            </div>

            {/* таймер-кольцо */}
            <div className="relative mt-2 flex h-[64px] w-[64px] items-center justify-center" aria-label={t('fr_challenge_left')}>
              <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(169,133,90,.22)" strokeWidth="5" />
                <circle
                  cx="32"
                  cy="32"
                  r={R}
                  fill="none"
                  stroke={secLeft <= 10 ? '#C33A2F' : '#8AA06F'}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - frac)}
                  style={{ transition: 'stroke-dashoffset 1s linear, stroke .3s' }}
                />
              </svg>
              <span
                className={`text-[20px] font-extrabold tabular-nums ${secLeft <= 10 ? 'text-[#C33A2F]' : 'text-foreground'}`}
              >
                {secLeft}
              </span>
            </div>

            {/* предупреждение при активной партии */}
            {inOnlineGame && (
              <div className="mt-1 w-full rounded-xl border border-[#C33A2F]/35 bg-[#C33A2F]/10 px-3 py-2 text-center text-[12.5px] font-bold text-[#8f2b23]">
                {t('fr_challenge_break')}
              </div>
            )}

            {/* кнопки решения */}
            <div className="mt-3 flex w-full items-stretch gap-2.5">
              <Button
                size="lg"
                disabled={busy}
                className="btn-wood h-12 flex-1 rounded-xl text-[15.5px] font-extrabold"
                onClick={() => void doAccept()}
              >
                <Swords className="mr-1.5 h-4.5 w-4.5" />
                {inOnlineGame ? t('fr_challenge_go') : t('fr_accept')}
              </Button>
              <button
                type="button"
                disabled={busy}
                onClick={doDecline}
                className="btn-cloth flex h-12 w-[52px] shrink-0 items-center justify-center rounded-xl text-destructive"
                aria-label={t('fr_decline')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
