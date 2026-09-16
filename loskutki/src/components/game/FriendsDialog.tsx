'use client';

/**
 * Друзья: ID для добавления, заявки (принять/отклонить), приглашения
 * в игру (согласиться → сразу в партию), список друзей с онлайн-статусом,
 * личным счётом и чатом. Небольшая круглая кнопка с бейджем живёт в
 * главном меню (и в хабе «С другом») — здесь сам раздел.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  MessageCircle,
  Send,
  Swords,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Portrait } from './MarketRow';
import { avatarUrl } from '@/lib/avatars';
import { t, useLang } from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { useToast } from '@/hooks/use-toast';
import { useOnline } from '@/lib/useOnline';
import {
  frAccept,
  frAdd,
  frCloseChat,
  frDecline,
  frErrorKey,
  frInvite,
  frInviteAccept,
  frInviteDecline,
  frOpenChat,
  frRemove,
  frSendMsg,
  frSync,
  useFriends,
  type InviteInfo,
} from '@/lib/friends';
import { loadStore, type FriendFoeStat } from '@/lib/storage';
import { loadProfile, normalizeFriendCode } from '@/lib/net';
import { ConfirmDialog } from './ConfirmDialog';
import { Smartphone } from 'lucide-react';

const INVITE_TTL_MS = 60_000;

export interface FriendsDialogJoin {
  playerId: string;
  code: string;
  name: string;
  avatar: string;
  /** комната приватная (создана приглашением) — для метки на экране ожидания */
  isPublic?: boolean;
}

interface FriendsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** переход в комнату: role=host — мы позвали и ждём; guest — нас позвали,
   *  мы вошли и партия стартуется сразу */
  onJoinRoom?: (s: FriendsDialogJoin, role: 'host' | 'guest') => void;
}

export function FriendsDialog({ open, onOpenChange, onJoinRoom }: FriendsDialogProps) {
  const { toast } = useToast();
  const lang = useLang();
  const online = useOnline();
  const fr = useFriends();
  const [addCode, setAddCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatText, setChatText] = useState('');
  const [now, setNow] = useState(Date.now());
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  /** подтверждение удаления друга — в стиле игры (не браузерный confirm) */
  const [removeAsk, setRemoveAsk] = useState<{ uid: string; name: string } | null>(null);

  // пока открыт — освежаем присутствие/непрочитанное раз в 8с
  useEffect(() => {
    if (!open) return;
    void frSync();
    const id = setInterval(() => {
      void frSync();
      setNow(Date.now());
    }, 8000);
    return () => clearInterval(id);
  }, [open]);

  // обратный отсчёт приглашений
  useEffect(() => {
    if (!open || fr.invites.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, fr.invites.length]);

  // чат открыт — прокрутка вниз на новое сообщение
  useEffect(() => {
    if (fr.chatWith) chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [fr.chat, fr.chatWith]);

  const stats = loadStore().friendStats;

  const copyCode = async () => {
    const raw = fr.code.replace('-', '');
    try {
      await navigator.clipboard.writeText(raw);
      sound.tap();
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard недоступен */ }
  };

  const doAdd = async () => {
    if (busy) return;
    const uid = normalizeFriendCode(addCode);
    if (!uid) {
      toast({ title: t('fr_bad_code') });
      return;
    }
    setBusy(true);
    sound.tap();
    const res = await frAdd(uid);
    setBusy(false);
    if (res.ok) {
      setAddCode('');
      if (res.accepted) {
        toast({ title: t('fr_now_friends'), description: t('fr_now_friends_d') });
      } else {
        toast({ title: t('fr_sent'), description: t('fr_sent_d') });
      }
    } else {
      toast({ title: t(frErrorKey(res.error ?? '')) });
    }
  };

  const doAccept = async (uid: string) => {
    sound.tap();
    if (await frAccept(uid)) {
      toast({ title: t('fr_now_friends'), description: t('fr_now_friends_d') });
    }
  };

  const doInvite = async (uid: string) => {
    if (busy) return;
    setBusy(true);
    sound.ensure();
    sound.tap();
    const res = await frInvite(uid);
    setBusy(false);
    if (res.ok && res.code && res.playerId) {
      const p = loadProfile();
      toast({ title: t('fr_invite_sent'), description: t('fr_invite_sent_d') });
      onOpenChange(false);
      onJoinRoom?.(
        {
          playerId: res.playerId,
          code: res.code,
          name: p.name,
          avatar: p.avatar,
          isPublic: false,
        },
        'host',
      );
    } else {
      toast({ title: t(frErrorKey(res.error ?? '')) });
    }
  };

  const doAcceptInvite = async (inv: InviteInfo) => {
    if (busy) return;
    setBusy(true);
    sound.ensure();
    sound.tap();
    const res = await frInviteAccept(inv.from.uid);
    setBusy(false);
    if (res.ok && res.code && res.playerId) {
      onOpenChange(false);
      onJoinRoom?.(
        {
          playerId: res.playerId,
          code: res.code,
          name: inv.from.name,
          avatar: inv.from.avatar,
        },
        'guest',
      );
    } else {
      toast({ title: t(frErrorKey(res.error ?? '')) });
    }
  };

  const doRemove = (uid: string, name: string) => {
    sound.tap();
    setRemoveAsk({ uid, name });
  };

  const sendMsg = async () => {
    const text = chatText.trim();
    if (!text || !fr.chatWith) return;
    setChatText('');
    const ok = await frSendMsg(fr.chatWith, text);
    if (!ok) toast({ title: t('mp_net') });
  };

  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  const fmtTime = (at: number) =>
    new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  // ===== вид ЧАТА =====
  const chatPeer = fr.chatWith ? fr.friends.find((f) => f.uid === fr.chatWith) : null;
  if (open && fr.chatWith && chatPeer) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) frCloseChat(); onOpenChange(v); }}>
        <DialogContent
          aria-describedby={undefined}
          className="grid-cols-[minmax(0,1fr)] flex h-[min(88svh,640px)] w-[min(94vw,440px)] flex-col p-0"
        >
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="flex items-center gap-2.5 font-display text-[20px]">
              <button
                type="button"
                onClick={() => { sound.tap(); frCloseChat(); }}
                className="btn-cloth flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                aria-label={t('mp_back')}
              >
                <ArrowLeft className="h-4.5 w-4.5" />
              </button>
              <Portrait src={avatarUrl(chatPeer.avatar)} size={34} alt={chatPeer.name} />
              <span className="min-w-0 flex-1 truncate">{chatPeer.name}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  chatPeer.online ? 'bg-[#8AA06F]/20 text-[#4e6437]' : 'bg-muted text-muted-foreground'
                }`}
              >
                {chatPeer.online ? t('fr_online') : t('fr_offline')}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="nice-scroll flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {fr.chat.length === 0 && (
              <div className="mt-6 text-center text-[13px] font-semibold text-muted-foreground">
                {t('fr_chat')}: {chatPeer.name}
              </div>
            )}
            {fr.chat.map((m) => {
              const mine = m.from !== chatPeer.uid;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-2 text-[14px] font-semibold shadow-sm ${
                      mine
                        ? 'rounded-br-md border border-[#5B7E9E]/40 bg-[#5B7E9E]/15 text-foreground'
                        : 'rounded-bl-md border border-border bg-card text-foreground'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    <div className="mt-0.5 text-right text-[9.5px] font-bold text-muted-foreground/80">
                      {fmtTime(m.at)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-border px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value.slice(0, 300))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendMsg();
              }}
              placeholder={t('fr_chat_ph')}
              maxLength={300}
              className="min-w-0 flex-1 rounded-xl border-2 border-border bg-card px-3 py-2.5 text-[15px] font-semibold text-foreground outline-none focus:border-primary/60"
            />
            <Button
              size="lg"
              disabled={!chatText.trim()}
              className="btn-wood h-11 w-11 shrink-0 rounded-xl p-0"
              onClick={() => void sendMsg()}
              aria-label={t('fr_send')}
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ===== основной вид =====
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="nice-scroll grid-cols-[minmax(0,1fr)] max-h-[88svh] w-[min(94vw,440px)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[22px]">
            <UserPlus className="h-5 w-5 text-primary" />
            {t('fr_title')}
          </DialogTitle>
        </DialogHeader>

        {!fr.available || !online ? (
          <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-center">
            <div className="text-[15px] font-extrabold text-foreground">{t('fr_unavailable_t')}</div>
            <div className="mt-1 text-[12.5px] font-semibold text-muted-foreground">{t('fr_unavailable_d')}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* сервер без базы: друзья и переписка живут в карманной копии
                на устройстве и восстанавливаются на сервере автоматически */}
            {fr.ready && !fr.persist && (
              <div className="flex items-start gap-2.5 rounded-xl border-2 border-[#4C7A3F]/40 bg-[#4C7A3F]/8 p-3">
                <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[#3F6A34]" />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-extrabold text-foreground">{t('fr_persist_t')}</div>
                  <div className="mt-0.5 text-[11.5px] font-semibold text-muted-foreground">{t('fr_persist_d')}</div>
                </div>
              </div>
            )}
            {/* Мой ID + добавить по ID */}
            <div className="stitched-card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                    {t('fr_my_code')}
                  </div>
                  <div
                    className="font-display mt-0.5 text-[24px] leading-none tracking-[0.14em] text-foreground"
                    style={{ textShadow: '0 2px 0 rgba(169,133,90,.25)' }}
                  >
                    {fr.code || '----−----'}
                  </div>
                  <div className="mt-1 text-[11.5px] font-semibold text-muted-foreground">{t('fr_my_code_h')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="btn-cloth flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  aria-label={t('mp_copy')}
                >
                  {copied ? <Check className="h-4.5 w-4.5 text-primary" /> : <Copy className="h-4.5 w-4.5" />}
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={addCode}
                  onChange={(e) => {
                    // автотире: ввод «5KT3Z999» сам превращается в «5KT3-Z999»
                    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
                    setAddCode(raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doAdd();
                  }}
                  placeholder={t('fr_add_ph')}
                  inputMode="text"
                  autoCapitalize="characters"
                  className="min-w-0 flex-1 rounded-xl border-2 border-border bg-card px-3 py-2.5 text-center text-[17px] font-extrabold tracking-[0.18em] text-foreground uppercase outline-none focus:border-primary/60"
                />
                <Button
                  size="lg"
                  disabled={busy || addCode.replace('-', '').length < 8}
                  className="btn-wood h-11 shrink-0 rounded-xl px-3.5 text-[13.5px] font-extrabold"
                  onClick={() => void doAdd()}
                >
                  <UserPlus className="mr-1 h-4 w-4" />
                  {t('fr_add_btn')}
                </Button>
              </div>
            </div>

            {/* Приглашения в игру */}
            {fr.invites.length > 0 && (
              <div className="space-y-2">
                <div className="text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">
                  {t('fr_invites')}
                </div>
                {fr.invites.map((inv) => {
                  const left = Math.max(0, Math.ceil((inv.at + INVITE_TTL_MS - now) / 1000));
                  return (
                    <div
                      key={`${inv.from.uid}-${inv.at}`}
                      className="pop-in stitched-card flex items-center gap-2.5 border-[#8AA06F]/50 bg-[#8AA06F]/10 p-2.5"
                    >
                      <Portrait src={avatarUrl(inv.from.avatar)} size={40} alt={inv.from.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-extrabold text-foreground">
                          {inv.from.name}
                        </div>
                        <div className="flex items-center gap-1 text-[11.5px] font-bold text-[#4e6437]">
                          <Zap className="h-3 w-3" fill="#cfe0b4" />
                          {t('fr_invite_d')} · {left}с
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={busy}
                        className="btn-wood h-9 shrink-0 rounded-xl px-3 text-[13px] font-extrabold"
                        onClick={() => void doAcceptInvite(inv)}
                      >
                        {t('fr_play')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => { sound.tap(); void frInviteDecline(inv.from.uid); }}
                        className="btn-cloth flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-destructive"
                        aria-label={t('fr_decline')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Заявки в друзья */}
            {fr.requests.length > 0 && (
              <div className="space-y-2">
                <div className="text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">
                  {t('fr_requests')}
                </div>
                {fr.requests.map((req) => (
                  <div key={req.from.uid} className="pop-in stitched-card flex items-center gap-2.5 p-2.5">
                    <Portrait src={avatarUrl(req.from.avatar)} size={40} alt={req.from.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-extrabold text-foreground">{req.from.name}</div>
                      <div className="text-[11.5px] font-bold text-muted-foreground">
                        {formatFriendCodeShort(req.from.uid)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="btn-wood h-9 shrink-0 rounded-xl px-3 text-[13px] font-extrabold"
                      onClick={() => void doAccept(req.from.uid)}
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {t('fr_accept')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { sound.tap(); void frDecline(req.from.uid); }}
                      className="btn-cloth flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-destructive"
                      aria-label={t('fr_decline')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Список друзей */}
            <div className="space-y-2">
              <div className="text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">
                {t('fr_friends')}
              </div>
              {fr.friends.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-[13px] font-bold text-muted-foreground">
                  {t('fr_friends_empty')}
                </div>
              )}
              {fr.friends.map((f) => {
                const st: FriendFoeStat | undefined = stats[f.uid];
                return (
                  <div key={f.uid} className="stitched-card flex items-center gap-2.5 p-2.5">
                    <div className="relative shrink-0">
                      <Portrait src={avatarUrl(f.avatar)} size={44} alt={f.name} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
                          f.online ? 'bg-[#7BA05B]' : 'bg-muted-foreground/40'
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14.5px] font-extrabold text-foreground">{f.name}</span>
                        {f.unread > 0 && (
                          <span className="pop-in flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-[#C33A2F] px-1 text-[10px] font-extrabold text-white">
                            {f.unread}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] font-bold text-muted-foreground">
                        {f.online ? t('fr_online') : t('fr_offline')}
                        {st && st.games > 0
                          ? ` · ${t('fr_vs', { g: st.games, w: st.wins })}`
                          : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { sound.tap(); void frOpenChat(f.uid); }}
                      className="btn-cloth relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      aria-label={t('fr_chat')}
                    >
                      <MessageCircle className="h-4.5 w-4.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void doInvite(f.uid)}
                      className="btn-cloth flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#A6721F]"
                      aria-label={t('fr_invite_game')}
                    >
                      <Swords className="h-4.5 w-4.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => doRemove(f.uid, f.name)}
                      className="btn-cloth flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground/70"
                      aria-label={t('fr_remove')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              {/* мои исходящие заявки */}
              {fr.outgoing.length > 0 && (
                <div className="rounded-xl bg-muted/40 px-3 py-2 text-[11.5px] font-bold text-muted-foreground">
                  {t('fr_outgoing')} · {fr.outgoing.length}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
      {/* подтверждение удаления — в стиле игры */}
      <ConfirmDialog
        open={removeAsk !== null}
        title={t('fr_remove_confirm', { name: removeAsk?.name ?? '' })}
        confirmText={t('fr_remove_yes')}
        cancelText={t('c_cancel')}
        trash
        onConfirm={() => {
          if (removeAsk) void frRemove(removeAsk.uid);
          setRemoveAsk(null);
        }}
        onCancel={() => setRemoveAsk(null)}
      />
    </Dialog>
  );
}

function formatFriendCodeShort(uid: string): string {
  return uid.length === 8 ? `${uid.slice(0, 4)}-${uid.slice(4)}` : uid;
}
