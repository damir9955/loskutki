'use client';

/**
 * Локализация игры: русский (по умолчанию) и английский.
 * Язык хранится в настройках (settings.lang) и переключается в «Настройках».
 * t() всегда читает актуальный язык из стораджа — вызовы в обработчиках/тостах
 * не требуют хука; useLang() лишь перев fork пере-рендер при смене языка.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { getStoreServerSnapshot, getStoreSnapshot, subscribeStore } from './storage';
import { BOT_PERSONAS, LEATHER_ID, PATCHES, type BotLevel } from './game/constants';
import type { LogEntry } from './game/types';

export type Lang = 'ru' | 'en';

// ===== Текущий язык =====

export function langNow(): Lang {
  const s = getStoreSnapshot().settings.lang;
  return s === 'en' ? 'en' : 'ru';
}

/** Хук: подписка на смену языка (перерисовка компонента). */
export function useLang(): Lang {
  const store = useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreServerSnapshot);
  return store.settings.lang === 'en' ? 'en' : 'ru';
}

/** Хук: заголовок вкладки браузера следует за языком интерфейса. */
export function useDocumentTitle() {
  const lang = useLang();
  useEffect(() => {
    document.title = `${DICT.app_title[lang === 'en' ? 1 : 0]} — ${DICT.app_subtitle[lang === 'en' ? 1 : 0]}`;
  }, [lang]);
}

/** Подстановка параметров вида {name} в шаблон (undefined — оставляем как есть). */
function fill(tpl: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return tpl;
  let s = tpl;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

// ===== Словарь [ru, en] =====

const DICT: Record<string, [string, string]> = {
  // — общее —
  app_title: ['Лоскутки', 'Patchwork'],
  app_subtitle: ['пэчворк-дуэль на скорость иголки', 'a quilting duel at needle speed'],
  duel_mode: ['пэчворк-дуэль', 'patchwork duel'],
  daily_mode: ['игра дня №{n}', 'daily game #{n}'],
  win: ['победа', 'win'],
  loss: ['поражение', 'loss'],

  // — дом —
  home_resume: ['Продолжить партию', 'Resume game'],
  home_resume_vs: ['против {name} · ход {n}', 'vs {name} · turn {n}'],
  home_play: ['Играть', 'Play'],
  home_daily: ['Игра дня №{n}', 'Daily game #{n}'],
  home_daily_played: ['сыграно: {res} ({score})', 'played: {res} ({score})'],
  home_daily_desc: ['у всех одинаковая раскладка · соперник: {name}', 'same layout for everyone · rival: {name}'],
  home_rules: ['Правила', 'Rules'],
  home_stats: ['Статистика', 'Stats'],
  home_settings: ['Настройки', 'Settings'],
  home_daily_done_t: ['Сегодня вы уже шили 🧶', 'You already played today 🧶'],
  home_daily_done_d: ['Итог: {res} ({score}). Новая игра дня — завтра!', 'Result: {res} ({score}). New daily — tomorrow!'],
  pick_title: ['Выберите соперника', 'Choose your rival'],
  pick_wins: ['побед: {w} из {g} ({p}%)', 'wins: {w} of {g} ({p}%)'],

  // — онлайн с другом —
  mp_title: ['С другом', 'With a friend'],
  mp_desc: ['комната по коду или открытый поиск', 'room by code or open search'],
  mp_name: ['Ваше имя', 'Your name'],
  mp_name_ph: ['Как вас звать?', 'What should we call you?'],
  mp_avatar: ['Портрет', 'Portrait'],
  mp_create: ['Создать комнату', 'Create room'],
  mp_public: ['Открытая для всех', 'Open to everyone'],
  mp_public_h: ['комнату увидят в поиске и можно войти без кода', 'the room appears in search and can be joined without a code'],
  mp_join: ['Войти по коду', 'Join by code'],
  mp_code_ph: ['КОД', 'CODE'],
  mp_open_rooms: ['Открытые комнаты', 'Open rooms'],
  mp_none: ['Пока нет открытых комнат — создайте свою', 'No open rooms yet — create your own'],
  mp_join_btn: ['Войти', 'Join'],
  mp_wait_title: ['Комната готова', 'Room is ready'],
  mp_wait_hint: ['Передайте код другу — он введёт его здесь, на экране «С другом»', 'Share the code with a friend — they enter it here on the "With a friend" screen'],
  mp_copy: ['Скопировать код', 'Copy code'],
  mp_copied: ['Код скопирован', 'Code copied'],
  mp_wait_for: ['Ждём соперника…', 'Waiting for an opponent…'],
  mp_cancel: ['Отменить и выйти', 'Cancel and leave'],
  mp_room_public: ['открытая · видна в поиске', 'open · listed in search'],
  mp_room_private: ['приватная · только по коду', 'private · code only'],
  mp_mode: ['онлайн-дуэль', 'online duel'],
  mp_online: ['на связи', 'connected'],
  mp_offline: ['нет связи', 'offline'],
  mp_bad_name: ['Введите имя (1–16 символов)', 'Enter a name (1–16 characters)'],
  mp_bad_code: ['Код комнаты — 6 символов', 'Room code is 6 characters'],
  mp_notfound: ['Комната не найдена', 'Room not found'],
  mp_full: ['В комнате уже двое', 'Room is already full'],
  mp_started: ['Партия уже началась', 'Game already started'],
  mp_gone: ['Комната закрыта', 'Room is closed'],
  mp_net: ['Нет связи с сервером', 'Connection problem'],
  mp_conflict: ['Не получилось сохранить ход — попробуйте ещё раз', 'Could not save the move — please try again'],
  mp_leave_confirm: ['Покинуть партию? Соперник увидит, что вы ушли.', 'Leave the game? Your opponent will see you left.'],
  mp_left_t: ['Вы покинули партию', 'You left the game'],
  mp_foe_left_t: ['Соперник покинул партию', 'Opponent left the game'],
  mp_foe_left_d: ['Комната закрыта', 'The room is closed'],
  mp_notyourturn: ['Сейчас ход соперника', 'It is your opponent\u2019s turn'],
  mp_illegal: ['Такой ход невозможен', 'That move is not possible'],
  mp_move_rejected: ['Ход не принят — попробуйте ещё раз', 'Move rejected — try again'],
  mp_timeout_you_t: ['Время вышло', 'Time is up'],
  mp_timeout_you_d: ['Вы автоматически шагнули вперёд', 'You automatically stepped forward'],
  mp_timeout_foe_t: ['Время соперника вышло', 'Opponent ran out of time'],
  mp_timeout_foe_d: ['Соперник автоматически шагнул вперёд', 'The opponent automatically stepped forward'],
  mp_timer_title: ['на ответ до 3 минут', 'up to 3 minutes to answer'],
  mp_rematch_wait: ['Ждём согласия соперника…', 'Waiting for the opponent to agree…'],
  mp_rematch_asked: ['Соперник хочет реванш!', 'The opponent wants a rematch!'],
  mp_back: ['Назад', 'Back'],
  mp_wins: ['Побед в комнате: {a} : {b}', 'Wins in this room: {a} : {b}'],
  mp_reconnecting: ['Проверяем комнату…', 'Checking the room…'],
  mp_reconnect: ['Переподключаемся…', 'Reconnecting…'],
  mp_net_lost: ['Соединение потеряно, переподключаемся…', 'Connection lost, reconnecting…'],
  mp_net_fail_t: ['Не удалось восстановить соединение', 'Could not restore the connection'],
  mp_net_fail_d: [
    'Партия не потеряна: когда связь вернётся, из лобби можно вернуться в неё.',
    'The game is not lost: once the connection is back, you can return to it from the lobby.',
  ],
  mp_own_room: ['Это ваша комната — вернитесь в неё и ждите соперника', 'This is your own room — return to it and wait for your opponent'],
  mp_have_room: ['У вас уже есть комната — ждём в ней', 'You already have a room — waiting in it'],
  mp_your_room: ['ваша', 'yours'],
  mp_return: ['Вернуться', 'Return'],
  mp_you: ['Вы', 'You'],
  mp_rules_note: ['На ответ даётся до 3 минут — иначе ход шагает вперёд сам.', 'You get up to 3 minutes per move — otherwise it steps forward automatically.'],
  mp_quick: ['Быстрая игра', 'Quick match'],
  mp_quick_h: ['автопоиск: соперник из очереди или первая открытая комната', 'auto-search: an opponent from the queue or the first open room'],
  mp_quick_title: ['Быстрая игра', 'Quick match'],
  mp_quick_searching: ['Ищем соперника…', 'Looking for an opponent…'],
  mp_quick_elapsed: ['Ищем {n} с…', 'Searching for {n}s…'],
  mp_quick_note: ['Соединяем с тем, кто тоже ищет, — или с первой открытой комнатой', 'We pair you with another searcher — or the first open room'],
  mp_quick_found: ['Соперник найден!', 'Opponent found!'],
  mp_quick_cancel: ['Отменить поиск', 'Cancel search'],
  mp_timer_paused: ['таймер на паузе — соперник не на связи', 'timer paused — the opponent is offline'],

  // — статистика —
  stats_title: ['Статистика', 'Statistics'],
  stats_games: ['партий', 'games'],
  stats_wr: ['побед', 'wins'],
  stats_best: ['лучший счёт', 'best score'],
  stats_streak: ['серия побед', 'win streak'],
  stats_avg_cov: ['ср. покрытие', 'avg. coverage'],
  stats_max_cov: ['макс. покрытие', 'max coverage'],
  stats_wins_total: ['всего побед', 'total wins'],
  stats_leather: ['макс. кожаных', 'max leather'],
  stats_ach: ['Достижения', 'Achievements'],
  stats_daily: ['Игры дня', 'Daily games'],
  ach_locked: ['Ещё не открыто', 'Not unlocked yet'],
  ach_unlocked_at: ['Открыто: {d}', 'Unlocked: {d}'],

  // — настройки —
  set_title: ['Настройки', 'Settings'],
  set_sound: ['Звук', 'Sound'],
  set_sound_h: ['стежки, пуговицы, победы', 'stitches, buttons, victories'],
  set_vibro: ['Вибрация', 'Vibration'],
  set_vibro_h: ['отклик на пришивание', 'feedback when sewing'],
  set_grid: ['Сетка мест', 'Placement grid'],
  set_grid_h: ['подсветка допустимых позиций при размещении', 'highlight valid spots while placing'],
  set_lang: ['Язык', 'Language'],
  set_lang_h: ['язык игры / game language', 'game language / язык игры'],
  set_reset: ['Сбросить прогресс', 'Reset progress'],
  set_reset_confirm: [
    'Стереть всю статистику, достижения и сохранённую партию?',
    'Erase all stats, achievements and the saved game?',
  ],
  set_reset_done: ['Прогресс сброшен', 'Progress reset'],
  set_reset_done_h: ['Чистый лист — новая ткань!', 'Clean slate — fresh fabric!'],

  // — игровой экран: баннер и статсы —
  g_your_turn: ['ваш ход', 'your turn'],
  g_bot_turn: ['ход: {name}', 'turn: {name}'],
  g_place: ['разместите лоскуток', 'place the patch'],
  g_leather_turn: ['кожаный лоскуток: тап по клетке', 'leather patch: tap a cell'],
  g_over: ['партия завершена', 'game over'],
  g_buttons: ['пуговицы', 'buttons'],
  g_income: ['доход', 'income'],
  g_of53: ['из 53', 'of 53'],
  g_cells: ['клеток', 'cells'],
  g_rival_buttons: ['Пуговицы соперника', "Rival's buttons"],
  g_rival_income: ['Доход соперника', "Rival's income"],
  g_rival_time: ['Время соперника: {t} из 53', "Rival's time: {t} of 53"],
  g_my_buttons: ['Ваши пуговицы', 'Your buttons'],
  g_my_income: ['Ваш доход с лоскутков', 'Your patch income'],
  g_my_time: ['Ваше время: {t} из 53', 'Your time: {t} of 53'],
  g_my_cells: ['Заполнено клеток: {n} из 81', 'Covered cells: {n} of 81'],
  g_board_aria: ['Ваше лоскутное полотно', 'Your quilt board'],
  g_empty: ['пусто', 'empty'],
  g_view_rival: ['Посмотреть полотно соперника', "View rival's quilt"],
  g_view_rival_short: ['Полотно', 'Quilt'],
  g_tile7x7: ['Спецплитка 7×7', '7×7 special tile'],

  // — тосты и подсказки —
  g_landing_you: ['Вы на клетке соперника!', "You're on the rival's cell!"],
  g_landing_bot: ['{name} — на вашей клетке', '{name} is on your cell'],
  g_landing_you_d: [
    'Ваша пуговка ложится сверху — и вы ходите ещё раз.',
    'Your button goes on top — and you move again.',
  ],
  g_landing_bot_d: [
    'Пуговка соперника сверху — его ход продолжается.',
    "The rival's button is on top — their turn continues.",
  ],
  g_leather_t: ['Кожаный лоскуток!', 'Leather patch!'],
  g_leather_d: ['Пройдена спецклетка — поставьте его на полотно.', 'Special cell passed — place it on your quilt.'],
  g_tile_t: ['🏅 Золотая нашивка 7×7!', '🏅 Golden 7×7 badge!'],
  g_tile_you_d: ['Вы заполнили квадрат 7×7: +7 очков.', 'You completed a 7×7 square: +7 points.'],
  g_tile_bot_d: ['{name} собирает квадрат 7×7: +7 очков.', '{name} completes a 7×7 square: +7 points.'],
  g_hint_buy: ['Совет: возьмите «{name}» — {cost} пуговиц, размер {w}×{h}{inc}', 'Tip: take "{name}" — {cost} buttons, size {w}×{h}{inc}'],
  g_hint_buy_inc: [', доход +{n}', ', income +{n}'],
  g_hint_adv: ['Совет: шагните вперёд — получите +{n} пуговиц{leath}', 'Tip: step forward — gain +{n} buttons{leath}'],
  g_hint_adv_leath: [' и кожаный лоскуток', ' and a leather patch'],
  g_ach: ['{icon} Достижение: «{title}»', '{icon} Achievement: "{title}"'],

  // — кнопки/ария —
  g_exit: ['Выйти в меню', 'Exit to menu'],
  g_hint: ['Подсказка', 'Hint'],
  g_rules: ['Правила', 'Rules'],
  g_cancel: ['Отменить покупку', 'Cancel purchase'],
  g_rotate: ['Повернуть', 'Rotate'],
  g_flip: ['Отразить', 'Mirror'],
  g_sew: ['Пришить', 'Sew'],
  g_sew_aria: ['Пришить лоскуток', 'Sew the patch'],
  g_advance: ['Шагнуть вперёд', 'Step forward'],
  g_advance_aria: ['Шагнуть вперёд с {from} на {to}: получить {n} пуговиц', 'Advance from {from} to {to}: gain {n} buttons'],
  g_leather_n: ['{n} кожаных лоскутка на пути', '{n} leather patches on the path'],
  g_leather_1: ['кожаный лоскуток на пути', 'a leather patch on the path'],
  g_leather_tip: ['тапните по свободной клетке', 'tap a free cell'],
  g_chronicle: ['Хроника партии', 'Game log'],
  g_ribbon: ['дальше в пути', 'coming up'],
  g_ribbon_n: ['{n} шт', '{n} pcs'],

  // — карточки рынка —
  m_buy_aria: [
    'Купить «{name}» ({w}×{h}): {cost} пуговиц, {time} ходов, доход {inc}',
    'Buy "{name}" ({w}×{h}): {cost} buttons, {time} moves, income {inc}',
  ],
  m_size: ['Размер лоскутка: {w}×{h}', 'Patch size: {w}×{h}'],
  m_cost: ['Цена: {n} пуговиц', 'Price: {n} buttons'],
  m_time: ['Время: {n} ходов', 'Time: {n} moves'],
  m_inc_yes: ['Доход: +{n} пуговица(ок) на каждом значке дохода', 'Income: +{n} button(s) at every income marker'],
  m_inc_no: ['Дохода нет — пуговиц за значки дохода не даёт', 'No income — yields no buttons at income markers'],
  m_not_fit: ['не помещается', "doesn't fit"],
  m_no_buttons: ['мало пуговиц', 'not enough buttons'],
  m_d_price: ['цена', 'price'],
  m_d_time: ['время', 'time'],
  m_d_size: ['размер', 'size'],
  m_d_income: ['доход', 'income'],
  m_d_ok: ['Понятно', 'Got it'],
  m_d_aria: ['Лоскуток «{name}»', 'Patch "{name}"'],
  m_ribbon_aria: ['{name}, {w}×{h}: {cost} пуговиц, {time} времени', '{name}, {w}×{h}: {cost} buttons, {time} time'],

  // — дорожка времени —
  t_start: ['СТАРТ', 'START'],
  t_finish: ['ФИНИШ', 'FINISH'],
  t_aria: ['Дорожка времени', 'Time track'],
  pin_me: ['Я', 'ME'],

  // — финал —
  e_win: ['Победа!', 'Victory!'],
  e_tie: ['Ничья', 'Draw'],
  e_lose: ['Поражение', 'Defeat'],
  e_win_big: ['Безупречный шов — сопернику не за чем угнаться!', "A flawless seam — the rival can't keep up!"],
  e_win_small: ['Ваше полотно сшито лучше!', 'Your quilt is sewn better!'],
  e_tie_sub: ['Стёжка в стёжку', 'Stitch for stitch'],
  e_lose_sub: ['Не в этот раз — стёжка не сошлась', 'Not this time — the stitches did not align'],
  e_you: ['Вы', 'You'],
  e_total: ['Итог: ', 'Final: '],
  e_rematch: ['Реванш', 'Rematch'],
  e_home: ['В меню', 'To menu'],
  e_buttons: ['Пуговицы', 'Buttons'],
  e_tile: ['Плитка 7×7', '7×7 tile'],
  e_empty_cells: ['Пустые клетки ({n})', 'Empty cells ({n})'],
  e_my_score: ['Ваш счёт', 'Your score'],
  e_score: ['Счёт', 'Score'],
  e_covered: ['закрыто {n}/81', 'covered {n}/81'],

  // — хроника (структурированные коды) —
  log_start_you: ['Партия началась. Первым шьёте вы.', 'The game begins. You sew first.'],
  log_start_foe: ['Партия началась. Первым шьёт соперник.', 'The game begins. The rival sews first.'],
  log_income_you: ['Вы получили доход: +{n} пуговиц.', 'You received income: +{n} buttons.'],
  log_income_foe: ['Соперник получил доход: +{n} пуговиц.', 'The rival received income: +{n} buttons.'],
  log_advance_you: ['Вы продвинулись вперёд за пуговицами.', 'You moved ahead for buttons.'],
  log_advance_foe: ['Соперник продвинулся вперёд за пуговицами.', 'The rival moved ahead for buttons.'],
  log_buy_you: ['Вы сшили «{name}» (−{cost} пуговиц, время +{time}).', 'You sewed "{name}" (−{cost} buttons, time +{time}).'],
  log_buy_foe: ['Соперник сшил «{name}» (−{cost} пуговиц, время +{time}).', 'The rival sewed "{name}" (−{cost} buttons, time +{time}).'],
  log_landAdv_you: ['Вы догнали соперника точно на его пуговке.', 'You caught up with the rival exactly on their button.'],
  log_landAdv_foe: ['Соперник догнал вас точно на вашей пуговке.', 'The rival caught up with you exactly on your button.'],
  log_landBuy_you: [
    'Вы встали точно на пуговку соперника — ходите ещё раз.',
    'You landed exactly on the rival’s button — you go again.',
  ],
  log_landBuy_foe: [
    'Соперник встал точно на вашу пуговку — и ходит ещё раз.',
    'The rival landed exactly on your button — and goes again.',
  ],
  log_tile_you: ['Вы получили спецплитку 7×7: +{n} очков!', 'You earned the 7×7 special tile: +{n} points!'],
  log_tile_foe: ['Соперник получил спецплитку 7×7: +{n} очков!', 'The rival earned the 7×7 special tile: +{n} points!'],
  log_leatherSewn: ['Кожаный лоскуток зашит.', 'Leather patch sewn in.'],
  log_leatherDiscard: ['Кожаный лоскуток пропал — полотно заполнено.', 'Leather patch lost — the quilt is full.'],
};

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = langNow();
  const row = DICT[key];
  return fill(row ? row[lang === 'en' ? 1 : 0] : key, params);
}

// ===== Имена лоскутков =====

const PATCH_EN: Record<number, string> = {
  0: 'Strip', 1: 'Ribbon', 2: 'Sash', 3: 'Shawl', 4: 'Square', 5: 'Check',
  6: 'Boot', 7: 'Wings', 8: 'Zipper', 9: 'Slipper', 10: 'Horseshoe', 11: 'Bridge',
  12: 'Slingshot', 13: 'Hatchet', 14: 'Key', 15: 'Hairpin', 16: 'Cross', 17: 'Corner',
  18: 'Step', 19: 'Ladder', 20: 'Flag', 21: 'X', 22: 'Anchor', 23: 'Caterpillar',
  24: 'Hammer', 25: 'Scrap', 26: 'Hook', 27: 'Wave', 28: 'Zigzag', 29: 'Stream',
  30: 'Collar', 31: 'Dragonfly', 32: 'Braid',
};

export function patchName(lang: Lang, id: number): string {
  if (id === LEATHER_ID) return lang === 'en' ? 'Leather' : 'Кожаный';
  const def = PATCHES[id];
  if (!def) return '';
  return lang === 'en' ? PATCH_EN[id] ?? def.name : def.name;
}

// ===== Персоны ботов =====

const PERSONA_EN: Record<BotLevel, { name: string; title: string; difficulty: string; quips: string[] }> = {
  glasha: {
    name: 'Auntie Glasha',
    title: 'Absent-minded needlewoman',
    difficulty: 'Easy',
    quips: [
      'Oh, what a lovely little scrap!',
      'I can barely see a thing without my glasses…',
      'Fabrics were kinder in the old days.',
      'A cup of tea would be nice right now…',
      'What a curious little shape — I\u2019ll take it!',
    ],
  },
  fedor: {
    name: 'Master Fyodor',
    title: 'A calm tailor',
    difficulty: 'Medium',
    quips: [
      'Hmm, let\u2019s eyeball it…',
      'A good seam never tolerates rushing.',
      'An order is an order.',
      'Chalk it first — then cut.',
      'That stitch won\u2019t lie flat…',
    ],
  },
  elza: {
    name: 'Couturier Elza',
    title: 'Elegant and ruthless',
    difficulty: 'Hard',
    quips: [
      'This will be a masterpiece.',
      'The fabrics whisper their secrets to me.',
      'Not bad… for an amateur.',
      'Every stitch is a calculation.',
      'Couture forgives no holes.',
    ],
  },
};

export function personaName(lang: Lang, level: BotLevel): string {
  return lang === 'en' ? PERSONA_EN[level].name : PERSONA_RU[level].name;
}
export function personaTitle(lang: Lang, level: BotLevel): string {
  return lang === 'en' ? PERSONA_EN[level].title : PERSONA_RU[level].title;
}
export function personaDifficulty(lang: Lang, level: BotLevel): string {
  return lang === 'en' ? PERSONA_EN[level].difficulty : PERSONA_RU[level].difficulty;
}
export function personaQuips(lang: Lang, level: BotLevel): string[] {
  return lang === 'en' ? PERSONA_EN[level].quips : PERSONA_RU[level].quips;
}
/** Буква на пуговке соперника (инициал имени). */
export function personaInitial(lang: Lang, level: BotLevel): string {
  const n = personaName(lang, level);
  const last = n.split(' ').pop() ?? n;
  return last[0].toUpperCase();
}

const PERSONA_RU = BOT_PERSONAS;

// ===== Достижения =====

const ACH: Record<string, [string, string, string, string]> = {
  // id: [title ru, title en, desc ru, desc en]
  'first-win': ['Первая победа', 'First victory', 'Выиграть первую партию', 'Win your first game'],
  'games-5': ['Ученик', 'Apprentice', 'Сыграть 5 партий', 'Play 5 games'],
  'games-25': ['Мастер', 'Master', 'Сыграть 25 партий', 'Play 25 games'],
  tile7x7: ['Золотая нашивка', 'Golden badge', 'Получить спецплитку 7×7', 'Earn the 7×7 special tile'],
  'full-quilt': ['Полное полотно', 'Full quilt', 'Закрыть 78+ из 81 клетки', 'Cover 78+ of 81 cells'],
  'big-score': ['Идеальный шов', 'Perfect seam', 'Выиграть со счётом 30+', 'Win with a score of 30+'],
  rich: ['Магнат пуговиц', 'Button tycoon', 'Завершить партию с 20+ пуговицами', 'Finish a game with 20+ buttons'],
  'beat-elza': ['Скорняк', 'Overmatched', 'Победить Кутюрье Эльзу', 'Beat Couturier Elza'],
  'streak-3': ['Хет-трик', 'Hat-trick', 'Три победы подряд', 'Three wins in a row'],
  'daily-win': ['Идеальный день', 'Perfect day', 'Победить в Игре дня', 'Win the Daily game'],
  'leather-5': ['Кожаная классика', 'Leather classic', 'Зашить все 5 кожаных лоскутков за партию', 'Sew all 5 leather patches in one game'],
  'wins-10': ['Дуэлянт', 'Duelist', 'Выиграть 10 партий', 'Win 10 games'],
};

export function achTitle(lang: Lang, id: string): string {
  const a = ACH[id];
  return a ? a[lang === 'en' ? 1 : 0] : id;
}
export function achDesc(lang: Lang, id: string): string {
  const a = ACH[id];
  return a ? a[lang === 'en' ? 3 : 2] : '';
}

// ===== Хроника: рендер структурированной записи =====

export function logLine(lang: Lang, e: LogEntry): string {
  // старый формат (сейвы до локализации) — как есть
  if (!e.code) return e.text ?? '';
  const d = e.data ?? {};
  // нейтральные фразы — без суффикса игрока
  if (e.code === 'leatherSewn' || e.code === 'leatherDiscard') return t(`log_${e.code}`);
  // «start» зависит от того, кто первым шьёт, а не от владельца записи
  const who = e.code === 'start' ? (d.first === 0 ? 'you' : 'foe') : e.player === 0 ? 'you' : 'foe';
  return t(`log_${e.code}_${who}`, {
    ...d,
    name: 'patchId' in d ? patchName(lang, Number(d.patchId)) : d.name,
  });
}
