import { Prisma, TournamentRegistrationStatus, UserRole } from '@prisma/client';
import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import { adminTelegramIds, env, telegramWebhookSecret } from './config.js';
import { prisma } from './db.js';
import { writeAudit } from './services/audit.js';
import {
  browserLoginCodeExpiresAt,
  createBrowserLoginCode,
  formatBrowserLoginCode,
  hashBrowserLoginCode
} from './services/browserAccess.js';
import {
  ADMIN_BUTTONS,
  PLAYER_BUTTONS,
  createRetryableInitializer,
  displayName,
  hasAdminAccess,
  miniAppLaunchUrl,
  miniAppUrl,
  normalizePhoneNumber,
  registrationLabel
} from './botHelpers.js';

export const bot = env.TELEGRAM_BOT_TOKEN ? new Bot(env.TELEGRAM_BOT_TOKEN) : null;
let cachedBotUsername: string | null | undefined;
const initializeBotInstance = bot ? createRetryableInitializer(() => bot.init()) : null;

type BotSender = { id: number; first_name: string; last_name?: string; username?: string };
type BroadcastAudience = 'all' | 'active' | 'tournament';
type BroadcastDraft = {
  audience: BroadcastAudience;
  stage: 'text' | 'preview' | 'sending';
  text?: string;
  chatId: number;
  promptMessageId: number;
  expiresAt: number;
};

const BROADCAST_DRAFT_TTL = 30 * 60 * 1000;

function appUrl(path = '/', params: Record<string, string | number | undefined> = {}) {
  return miniAppUrl(env.MINI_APP_URL, path, params);
}

function playerAppUrl(view?: 'games' | 'profile' | 'rating' | 'privileges') {
  return miniAppLaunchUrl(env.MINI_APP_URL, view);
}

function miniAppUrlWithReferral(rawMatch: string | undefined) {
  const code = rawMatch?.trim().replace(/^ref[_-]?/i, '').toUpperCase();
  return appUrl('/', code && /^[A-Z0-9]{6,20}$/.test(code) ? { ref: code } : {});
}

function isAdminTelegramId(telegramId: number | string) {
  return hasAdminAccess(telegramId, adminTelegramIds);
}

async function ensureBotUser(sender: BotSender) {
  const telegramId = String(sender.id);
  const role = isAdminTelegramId(telegramId) ? UserRole.ADMIN : UserRole.PLAYER;
  return prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: {
      firstName: sender.first_name,
      lastName: sender.last_name,
      username: sender.username,
      role,
      lastSeenAt: new Date()
    },
    create: {
      telegramId: BigInt(telegramId),
      firstName: sender.first_name,
      lastName: sender.last_name,
      username: sender.username,
      role
    }
  });
}

function playerKeyboard() {
  return new Keyboard()
    .webApp(PLAYER_BUTTONS.openClub, playerAppUrl()).row()
    .webApp(PLAYER_BUTTONS.tournaments, playerAppUrl('games')).text(PLAYER_BUTTONS.profile).row()
    .text(PLAYER_BUTTONS.rating).text(PLAYER_BUTTONS.help).row()
    .requestContact(PLAYER_BUTTONS.phone)
    .resized().persistent().placeholder('Выберите раздел');
}

function adminKeyboard() {
  return new Keyboard()
    .text(ADMIN_BUTTONS.panel).row()
    .text(ADMIN_BUTTONS.tournaments).text(ADMIN_BUTTONS.checkin).row()
    .text(ADMIN_BUTTONS.seating).text(ADMIN_BUTTONS.players).row()
    .text(ADMIN_BUTTONS.results).text(ADMIN_BUTTONS.broadcast).row()
    .text(ADMIN_BUTTONS.audit).text(ADMIN_BUTTONS.settings)
    .resized().persistent().placeholder('Управление Poker Club');
}

function roleKeyboard(role: UserRole) {
  return role === UserRole.ADMIN ? adminKeyboard() : playerKeyboard();
}

function adminMainInlineKeyboard() {
  return new InlineKeyboard()
    .text('🎟 Турниры', 'admin:tournaments').text('✅ Чек-ин', 'admin:checkin').row()
    .text('🪑 Рассадка', 'admin:seating').text('👥 Игроки', 'admin:players').row()
    .text('📊 Результаты', 'admin:results').text('🧾 Аудит', 'admin:audit').row()
    .text('🔔 Рассылка', 'admin:broadcast').text('⚙️ Настройки', 'admin:settings').row()
    .webApp('🎛 Открыть полную админ-панель', appUrl('/admin'));
}

function backKeyboard(extra?: { label: string; url: string }) {
  const keyboard = new InlineKeyboard();
  if (extra) keyboard.webApp(extra.label, extra.url).row();
  return keyboard.text('← Назад', 'admin:main');
}

async function requireAdminContext(ctx: Context) {
  if (!ctx.from) return null;
  const user = await ensureBotUser(ctx.from);
  if (!isAdminTelegramId(ctx.from.id)) {
    await ctx.reply('⛔ У вас нет прав для этого действия. Меню обновлено.', { reply_markup: playerKeyboard() });
    return null;
  }
  return user;
}

async function safeEdit(ctx: Context, text: string, replyMarkup: InlineKeyboard) {
  try {
    await ctx.editMessageText(text, { reply_markup: replyMarkup });
  } catch (error) {
    const description = error instanceof Error ? error.message : '';
    if (description.includes('message is not modified')) return;
    await ctx.reply(text, { reply_markup: replyMarkup });
  }
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: env.CLUB_TIMEZONE
  }).format(date);
}

async function sendPhoneRequest(ctx: Context) {
  await ctx.reply('Нажмите кнопку ниже, чтобы добровольно передать организаторам ваш номер из Telegram.', {
    reply_markup: new Keyboard().requestContact(PLAYER_BUTTONS.phone).resized().oneTime()
  });
}

async function sendBrowserLoginCode(ctx: Context) {
  if (!ctx.from) return;
  const user = await ensureBotUser(ctx.from);
  const code = createBrowserLoginCode();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.browserLoginCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.browserLoginCode.create({ data: { userId: user.id, codeHash: hashBrowserLoginCode(code), expiresAt: browserLoginCodeExpiresAt(now) } });
  });
  const loginUrl = appUrl('/browser-login');
  await ctx.reply(`🔐 Код для входа в браузере:\n\n${formatBrowserLoginCode(code)}\n\nНа компьютере откройте страницу входа и введите код. Он действует 10 минут и только один раз.`, {
    reply_markup: new InlineKeyboard().url('Открыть страницу входа', loginUrl)
  });
}

async function sendPlayerTournaments(ctx: Context) {
  const countWhere = { status: { in: [TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.PLAYED] } };
  const [active, upcoming] = await Promise.all([
    prisma.tournament.findFirst({
      where: { status: 'ACTIVE' }, orderBy: { startsAt: 'desc' },
      include: { _count: { select: { registrations: { where: countWhere } } } }
    }),
    prisma.tournament.findFirst({
      where: { status: 'UPCOMING', startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' },
      include: { _count: { select: { registrations: { where: countWhere } } } }
    })
  ]);
  const items = [active, upcoming].filter((item, index, all) => item && all.findIndex((candidate) => candidate?.id === item.id) === index);
  if (!items.length) {
    await ctx.reply('🏆 Активных и ближайших турниров пока нет.', {
      reply_markup: new InlineKeyboard().webApp('Открыть все турниры', playerAppUrl('games'))
    });
    return;
  }
  const text = items.map((item) => {
    const participants = item!._count.registrations;
    const status = item!.status === 'ACTIVE' ? '🔴 Идёт сейчас' : '🟢 Ближайший';
    const registration = registrationLabel({ ...item!, participantCount: participants });
    return `${status}\n${item!.title}\n📅 ${formatDate(item!.startsAt)}\n👥 ${participants}/${item!.capacity}\n🎟 ${registration}`;
  }).join('\n\n');
  await ctx.reply(text, { reply_markup: new InlineKeyboard().webApp('🏆 Открыть турниры', playerAppUrl('games')) });
}

async function sendPlayerProfile(ctx: Context) {
  if (!ctx.from) return;
  const user = await ensureBotUser(ctx.from);
  const [gamesPlayed, usersAhead] = await Promise.all([
    prisma.tournamentResult.count({ where: { userId: user.id } }),
    prisma.user.count({ where: { points: { gt: user.points } } })
  ]);
  const phone = user.phoneNumber ? `сохранён ${user.phoneNumber.slice(0, 4)}••••${user.phoneNumber.slice(-2)}` : 'не указан — используйте кнопку внизу';
  await ctx.reply(`👤 ${displayName(user)}\n\n🎯 Rating PTS: ${user.points.toLocaleString('ru-RU')}\n🏆 Сыграно турниров: ${gamesPlayed}\n📊 Позиция в рейтинге: #${usersAhead + 1}\n📱 Телефон: ${phone}`, {
    reply_markup: new InlineKeyboard().webApp('Открыть полный профиль', playerAppUrl('profile'))
  });
}

async function sendPlayerRating(ctx: Context) {
  if (!ctx.from) return;
  const user = await ensureBotUser(ctx.from);
  const [usersAhead, totalUsers] = await Promise.all([
    prisma.user.count({ where: { points: { gt: user.points } } }),
    prisma.user.count()
  ]);
  await ctx.reply(`📊 Ваша позиция: #${usersAhead + 1} из ${totalUsers}\n🎯 Баланс: ${user.points.toLocaleString('ru-RU')} Rating PTS`, {
    reply_markup: new InlineKeyboard().webApp('Открыть полный рейтинг', playerAppUrl('rating'))
  });
}

async function sendHelp(ctx: Context) {
  const contact = env.ADMIN_CONTACT?.trim() || 'напишите администратору клуба';
  await ctx.reply(`🆘 Как пользоваться ботом\n\n• Турниры — ближайшие игры и регистрация.\n• Профиль — очки, история и награды.\n• Рейтинг — ваше место в сезоне.\n• /login — одноразовый код для входа с компьютера.\n\nКонтакт: ${contact}`);
}

async function showAdminMain(ctx: Context, edit = false) {
  const text = '🎛 Панель управления\n\nВыберите раздел. Простые действия остаются в чате, сложные откроются в Mini App.';
  if (edit) await safeEdit(ctx, text, adminMainInlineKeyboard());
  else await ctx.reply(text, { reply_markup: adminMainInlineKeyboard() });
}

async function adminTournamentScreen(ctx: Context, edit: boolean) {
  const [active, next] = await Promise.all([
    prisma.tournament.findFirst({ where: { status: 'ACTIVE' }, orderBy: { startsAt: 'desc' } }),
    prisma.tournament.findFirst({ where: { status: 'UPCOMING' }, orderBy: { startsAt: 'asc' } })
  ]);
  const lines = ['🎟 Турниры'];
  if (active) lines.push(`\n🔴 Активен: ${active.title}\n${formatDate(active.startsAt)}`);
  if (next) lines.push(`\n🟢 Ближайший: ${next.title}\n${formatDate(next.startsAt)}`);
  if (!active && !next) lines.push('\nАктивных и запланированных турниров нет.');
  const keyboard = backKeyboard({ label: 'Открыть управление турнирами', url: appUrl('/admin', { section: 'tournaments' }) });
  if (edit) await safeEdit(ctx, lines.join(''), keyboard); else await ctx.reply(lines.join(''), { reply_markup: keyboard });
}

const adminScreens = {
  'admin:checkin': {
    text: '✅ Чек-ин\n\nОтмечайте игрока только после фактической выдачи фишек. Подтверждённый чек-ин необратим и записывается в аудит.',
    label: 'Открыть чек-ин', params: { section: 'overview' }
  },
  'admin:seating': { text: '🪑 Рассадка\n\nСтолы, места, ручные пересадки и публикация доступны в Mini App.', label: 'Открыть рассадку', params: { section: 'seating' } },
  'admin:players': { text: '👥 Игроки\n\nПоиск, карточки, контакты, теги и операции с балансом.', label: 'Открыть игроков', params: { section: 'players' } },
  'admin:results': { text: '📊 Результаты\n\nВвод мест, предпросмотр очков и пакетное начисление остаются в полной админ-панели.', label: 'Открыть результаты', params: { section: 'tournaments', intent: 'results' } },
  'admin:audit': { text: '🧾 Аудит\n\nНеизменяемая история административных действий с фильтрами.', label: 'Открыть аудит', params: { section: 'audit' } },
  'admin:settings': { text: '⚙️ Настройки\n\nСезоны, оформление, цвет интерфейса, теги и шаблоны причин.', label: 'Открыть настройки', params: { section: 'settings' } }
} as const;

async function showAdminScreen(ctx: Context, action: keyof typeof adminScreens, edit: boolean) {
  const screen = adminScreens[action];
  const keyboard = backKeyboard({ label: screen.label, url: appUrl('/admin', screen.params) });
  if (edit) await safeEdit(ctx, screen.text, keyboard); else await ctx.reply(screen.text, { reply_markup: keyboard });
}

function broadcastAudienceKeyboard() {
  return new InlineKeyboard()
    .text('👥 Все игроки', 'admin:broadcast:audience:all').row()
    .text('🟢 Активные за 30 дней', 'admin:broadcast:audience:active').row()
    .text('🎟 Участники ближайших турниров', 'admin:broadcast:audience:tournament').row()
    .text('← Назад', 'admin:main');
}

async function deleteBroadcastDraft(telegramId: number) {
  await prisma.broadcastDraft.deleteMany({ where: { telegramId: BigInt(telegramId) } });
}

async function saveBroadcastDraft(telegramId: number, draft: BroadcastDraft) {
  const data = {
    audience: draft.audience,
    stage: draft.stage,
    text: draft.text,
    chatId: BigInt(draft.chatId),
    promptMessageId: BigInt(draft.promptMessageId),
    expiresAt: new Date(draft.expiresAt)
  };
  await prisma.broadcastDraft.upsert({
    where: { telegramId: BigInt(telegramId) },
    create: { telegramId: BigInt(telegramId), ...data },
    update: data
  });
}

async function getBroadcastDraft(telegramId: number): Promise<BroadcastDraft | null> {
  const stored = await prisma.broadcastDraft.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!stored || stored.expiresAt.getTime() < Date.now()) {
    if (stored) await deleteBroadcastDraft(telegramId);
    return null;
  }
  if (!['all', 'active', 'tournament'].includes(stored.audience)) {
    await deleteBroadcastDraft(telegramId);
    return null;
  }
  if (!['text', 'preview', 'sending'].includes(stored.stage)) {
    await deleteBroadcastDraft(telegramId);
    return null;
  }
  return {
    audience: stored.audience as BroadcastAudience,
    stage: stored.stage as BroadcastDraft['stage'],
    text: stored.text ?? undefined,
    chatId: Number(stored.chatId),
    promptMessageId: Number(stored.promptMessageId),
    expiresAt: stored.expiresAt.getTime()
  };
}

const audienceLabels: Record<BroadcastAudience, string> = {
  all: 'все игроки', active: 'активные за 30 дней', tournament: 'участники ближайших турниров'
};

async function broadcastRecipients(audience: BroadcastAudience) {
  const where: Prisma.UserWhereInput = audience === 'active'
    ? { lastSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
    : audience === 'tournament'
      ? { registrations: { some: { status: { in: [TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.WAITLISTED, TournamentRegistrationStatus.CHECKED_IN] }, tournament: { status: { in: ['UPCOMING', 'ACTIVE'] } } } } }
      : {};
  return prisma.user.findMany({ where: { AND: [where, { telegramId: { not: null } }] }, select: { id: true, telegramId: true } });
}

async function performBroadcast(ctx: Context, draft: BroadcastDraft, actorId: string) {
  if (!bot || !draft.text) return;
  const recipients = await broadcastRecipients(draft.audience);
  let sentCount = 0;
  let failedCount = 0;
  for (const recipient of recipients) {
    try {
      if (!recipient.telegramId) continue;
      await bot.api.sendMessage(recipient.telegramId.toString(), draft.text, {
        reply_markup: new InlineKeyboard().webApp('🎮 Открыть Poker Club', appUrl('/'))
      });
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }
  await writeAudit(prisma, {
    actorId,
    action: 'BROADCAST_SENT',
    entityType: 'TelegramBroadcast',
    summary: `Рассылка «${audienceLabels[draft.audience]}»: ${sentCount} доставлено, ${failedCount} ошибок`,
    after: { audience: draft.audience, recipients: recipients.length, sentCount, failedCount, textLength: draft.text.length }
  });
  await safeEdit(ctx, `✅ Рассылка завершена\n\nАудитория: ${audienceLabels[draft.audience]}\nДоставлено: ${sentCount}\nОшибок: ${failedCount}`, new InlineKeyboard().text('← В панель', 'admin:main'));
}

if (bot) {
  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    await deleteBroadcastDraft(ctx.from.id);
    const referralMatch = typeof ctx.match === 'string' ? ctx.match : undefined;
    if (referralMatch === 'phone') return sendPhoneRequest(ctx);
    if (referralMatch === 'browser_login') return sendBrowserLoginCode(ctx);
    const user = await ensureBotUser(ctx.from);
    await ctx.reply(
      `Добро пожаловать в Poker Club, ${ctx.from.first_name}!\n\n${user.role === UserRole.ADMIN ? 'Вам доступно меню управления.' : 'Здесь находятся игры, рейтинг сезона и ваши результаты.'}`,
      { reply_markup: roleKeyboard(user.role) }
    );
    if (user.role === UserRole.ADMIN) await showAdminMain(ctx);
    else if (referralMatch) {
      await ctx.reply('Персональное приглашение готово. Откройте клуб, чтобы завершить регистрацию.', {
        reply_markup: new InlineKeyboard().webApp('🎮 Открыть Poker Club', miniAppUrlWithReferral(referralMatch))
      });
    }
  });

  bot.command('app', async (ctx) => {
    await ctx.reply('Открыть приложение:', { reply_markup: new InlineKeyboard().webApp('Poker Club', appUrl('/')) });
  });
  bot.command('phone', sendPhoneRequest);
  bot.command('login', sendBrowserLoginCode);

  bot.hears(PLAYER_BUTTONS.tournaments, sendPlayerTournaments);
  bot.hears(PLAYER_BUTTONS.profile, sendPlayerProfile);
  bot.hears(PLAYER_BUTTONS.rating, sendPlayerRating);
  bot.hears(PLAYER_BUTTONS.help, sendHelp);

  bot.hears(ADMIN_BUTTONS.panel, async (ctx) => { if (ctx.from) await deleteBroadcastDraft(ctx.from.id); if (await requireAdminContext(ctx)) await showAdminMain(ctx); });
  bot.hears(ADMIN_BUTTONS.tournaments, async (ctx) => { if (ctx.from) await deleteBroadcastDraft(ctx.from.id); if (await requireAdminContext(ctx)) await adminTournamentScreen(ctx, false); });
  for (const [button, action] of [
    [ADMIN_BUTTONS.checkin, 'admin:checkin'], [ADMIN_BUTTONS.seating, 'admin:seating'], [ADMIN_BUTTONS.players, 'admin:players'],
    [ADMIN_BUTTONS.results, 'admin:results'], [ADMIN_BUTTONS.audit, 'admin:audit'], [ADMIN_BUTTONS.settings, 'admin:settings']
  ] as const) {
    bot.hears(button, async (ctx) => { if (ctx.from) await deleteBroadcastDraft(ctx.from.id); if (await requireAdminContext(ctx)) await showAdminScreen(ctx, action, false); });
  }
  bot.hears(ADMIN_BUTTONS.broadcast, async (ctx) => {
    if (ctx.from) await deleteBroadcastDraft(ctx.from.id);
    if (!await requireAdminContext(ctx)) return;
    await ctx.reply('🔔 Новая рассылка\n\n1. Выберите аудиторию.\n2. Отправьте текст.\n3. Проверьте предпросмотр и подтвердите.', { reply_markup: broadcastAudienceKeyboard() });
  });

  bot.on('message:contact', async (ctx) => {
    const sender = ctx.from;
    const contact = ctx.message.contact;
    if (!sender || contact.user_id === undefined || String(contact.user_id) !== String(sender.id)) {
      await ctx.reply('Можно сохранить только ваш собственный контакт, отправленный кнопкой бота.');
      return;
    }
    const phoneNumber = normalizePhoneNumber(contact.phone_number);
    if (!phoneNumber) {
      await ctx.reply('Telegram передал номер в неизвестном формате. Попробуйте ещё раз позже.');
      return;
    }
    const user = await ensureBotUser(sender);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { phoneNumber, phoneSharedAt: new Date() } });
        await writeAudit(tx, {
          actorId: user.id, action: 'PHONE_SHARED', entityType: 'User', entityId: user.id,
          summary: `${user.firstName} добровольно передал номер телефона`, metadata: { source: 'telegram_contact' }
        });
      });
      await ctx.reply('✅ Номер сохранён в вашем существующем профиле. Повторная отправка обновит его.', { reply_markup: roleKeyboard(user.role) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await ctx.reply('Этот номер уже связан с другим аккаунтом клуба. Напишите администратору.', { reply_markup: roleKeyboard(user.role) });
        return;
      }
      console.error('Failed to save Telegram contact', error);
      await ctx.reply('Не удалось сохранить номер из-за ошибки базы. Повторите позже или напишите администратору.', { reply_markup: roleKeyboard(user.role) });
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const action = ctx.callbackQuery.data;
    if (!action.startsWith('admin:')) return;
    const user = await requireAdminContext(ctx);
    if (!user) return;
    if (!action.startsWith('admin:broadcast')) await deleteBroadcastDraft(ctx.from.id);
    try {
      if (action === 'admin:main') {
        await deleteBroadcastDraft(ctx.from.id);
        await showAdminMain(ctx, true);
      } else if (action === 'admin:tournaments') {
        await adminTournamentScreen(ctx, true);
      } else if (action in adminScreens) {
        await showAdminScreen(ctx, action as keyof typeof adminScreens, true);
      } else if (action === 'admin:broadcast') {
        await deleteBroadcastDraft(ctx.from.id);
        await safeEdit(ctx, '🔔 Новая рассылка\n\nВыберите аудиторию. Отправка не начнётся без отдельного подтверждения.', broadcastAudienceKeyboard());
      } else if (action.startsWith('admin:broadcast:audience:')) {
        const audience = action.slice('admin:broadcast:audience:'.length) as BroadcastAudience;
        if (!['all', 'active', 'tournament'].includes(audience)) throw new Error('Неизвестная аудитория');
        const message = ctx.callbackQuery.message;
        if (!message) throw new Error('Это меню устарело');
        await saveBroadcastDraft(ctx.from.id, { audience, stage: 'text', chatId: message.chat.id, promptMessageId: message.message_id, expiresAt: Date.now() + BROADCAST_DRAFT_TTL });
        await safeEdit(ctx, `🔔 Аудитория: ${audienceLabels[audience]}\n\nТеперь отправьте боту текст рассылки одним сообщением.\n\nЛимит: 3500 символов. Затем бот покажет предпросмотр.`, new InlineKeyboard().text('Отменить', 'admin:broadcast:cancel').row().text('← К выбору аудитории', 'admin:broadcast'));
      } else if (action === 'admin:broadcast:cancel') {
        await deleteBroadcastDraft(ctx.from.id);
        await safeEdit(ctx, 'Рассылка отменена. Сообщения не отправлялись.', new InlineKeyboard().text('← В панель', 'admin:main'));
      } else if (action === 'admin:broadcast:send') {
        const draft = await getBroadcastDraft(ctx.from.id);
        if (!draft || draft.stage !== 'preview' || !draft.text) {
          await ctx.reply('Черновик рассылки устарел. Начните заново из панели.');
          return;
        }
        draft.stage = 'sending';
        await deleteBroadcastDraft(ctx.from.id);
        await safeEdit(ctx, '🔔 Рассылка выполняется…', new InlineKeyboard());
        await performBroadcast(ctx, draft, user.id);
      }
    } catch (error) {
      console.error('Telegram callback error', error);
      await ctx.reply('Не удалось выполнить действие. Меню могло устареть — откройте панель ещё раз.', { reply_markup: new InlineKeyboard().text('🎛 Открыть панель', 'admin:main') });
    }
  });

  bot.on('message:text', async (ctx) => {
    const draft = await getBroadcastDraft(ctx.from.id);
    if (!draft || draft.stage !== 'text') return;
    const user = await requireAdminContext(ctx);
    if (!user) { await deleteBroadcastDraft(ctx.from.id); return; }
    const text = ctx.message.text.trim();
    if (!text || text.length > 3500) {
      await ctx.reply('Текст должен содержать от 1 до 3500 символов. Отправьте исправленный текст.');
      return;
    }
    draft.text = text;
    draft.stage = 'preview';
    draft.expiresAt = Date.now() + BROADCAST_DRAFT_TTL;
    await saveBroadcastDraft(ctx.from.id, draft);
    const preview = `👁 Предпросмотр рассылки\n\nАудитория: ${audienceLabels[draft.audience]}\n\n———\n${text}\n———\n\nПроверьте текст. Отправка начнётся только после подтверждения.`;
    const keyboard = new InlineKeyboard()
      .text('✅ Подтвердить и отправить', 'admin:broadcast:send').row()
      .text('← Изменить', 'admin:broadcast').text('❌ Отменить', 'admin:broadcast:cancel');
    try {
      await ctx.api.editMessageText(draft.chatId, draft.promptMessageId, preview, { reply_markup: keyboard });
    } catch {
      await ctx.reply(preview, { reply_markup: keyboard });
    }
  });

  bot.catch((error) => console.error('Telegram bot error', error.error));
}

export async function getBotUsername() {
  if (cachedBotUsername !== undefined) return cachedBotUsername;
  if (!bot) return (cachedBotUsername = null);
  try {
    const me = await bot.api.getMe();
    cachedBotUsername = me.username;
  } catch {
    cachedBotUsername = null;
  }
  return cachedBotUsername;
}

export async function initializeBot() {
  await initializeBotInstance?.();
}

export async function configureWebhook() {
  const publicUrl = env.PUBLIC_API_URL ?? env.MINI_APP_URL;
  if (!bot || !publicUrl) return;
  await initializeBot();
  await bot.api.setWebhook(`${publicUrl.replace(/\/$/, '')}/api/telegram/webhook`, {
    secret_token: telegramWebhookSecret,
    allowed_updates: ['message', 'callback_query']
  });
  await bot.api.setMyCommands([
    { command: 'start', description: 'Обновить меню Poker Club' },
    { command: 'app', description: 'Открыть Poker Club' },
    { command: 'login', description: 'Получить код для входа в браузере' },
    { command: 'phone', description: 'Передать номер организаторам' }
  ]);
}

export async function notifyAboutTournament(tournamentId: string) {
  if (!bot) throw new Error('TELEGRAM_BOT_TOKEN не настроен');
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw new Error('Турнир не найден');
  const users = await prisma.user.findMany({ where: { telegramId: { not: null } }, select: { telegramId: true } });
  const date = formatDate(tournament.startsAt);
  const keyboard = new InlineKeyboard().webApp('Открыть турниры', playerAppUrl('games'));
  let sentCount = 0;
  let failedCount = 0;
  for (const user of users) {
    try {
      if (!user.telegramId) continue;
      await bot.api.sendMessage(user.telegramId.toString(), `♠️ Напоминание: «${tournament.title}» состоится ${date}.`, { reply_markup: keyboard });
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }
  await prisma.notificationLog.create({ data: { tournamentId, sentCount, failedCount } });
  return { sentCount, failedCount };
}

export async function notifyUser(telegramId: bigint | string | null, text: string) {
  if (!telegramId) return { sent: false, reason: 'NO_TELEGRAM_ACCOUNT' as const };
  if (!bot) return { sent: false, reason: 'BOT_DISABLED' as const };
  try {
    await bot.api.sendMessage(telegramId.toString(), text, { reply_markup: new InlineKeyboard().webApp('Открыть Poker Club', appUrl('/')) });
    return { sent: true, reason: null };
  } catch {
    return { sent: false, reason: 'DELIVERY_FAILED' as const };
  }
}

export function pointsNotification(amount: number, balanceAfter: number, reason: string) {
  const action = amount > 0 ? 'Начислено' : 'Списано';
  return `♠️ ${action} ${Math.abs(amount).toLocaleString('ru-RU')} PTS.\nПричина: ${reason}.\nНовый баланс: ${balanceAfter.toLocaleString('ru-RU')} PTS.`;
}

export function registrationNotification(title: string, startsAt: Date, status: 'REGISTERED' | 'WAITLISTED' | 'PROMOTED' | 'CANCELLED') {
  const date = formatDate(startsAt);
  const lines = {
    REGISTERED: `Вы записаны на турнир «${title}»`,
    WAITLISTED: `Основной список «${title}» заполнен. Вы добавлены в лист ожидания`,
    PROMOTED: `Освободилось место — вы переведены в основной список турнира «${title}»`,
    CANCELLED: `Ваша запись на турнир «${title}» отменена`
  } as const;
  return `♠️ ${lines[status]}.\nНачало: ${date}.`;
}
