/**
 * Реалистичные портреты (фото-стилизация) — общие для клиента и сервера.
 * Файлы лежат в public/avatars/*.jpg.
 */

import type { BotLevel } from './game/constants';

export const BOT_AVATARS: Record<BotLevel, string> = {
  glasha: 'glasha',
  fedor: 'fedor',
  elza: 'elza',
};

/** Идентификаторы портретов для онлайн-игроков (включая ботовых персонажей) */
export const AVATAR_IDS = ['ann', 'boris', 'vera', 'grig', 'glasha', 'fedor', 'elza'] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export function avatarUrl(id: string): string {
  const base = (AVATAR_IDS as readonly string[]).includes(id) ? id : 'ann';
  return `/avatars/${base}.jpg`;
}

/** Портрет бота по уровню */
export function botAvatarUrl(level: BotLevel): string {
  return avatarUrl(BOT_AVATARS[level]);
}
