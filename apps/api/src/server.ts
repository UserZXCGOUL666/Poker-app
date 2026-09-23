import app from './app.js';
import { env } from './config.js';
import { initializeBot } from './bot.js';
import { prisma } from './db.js';
import { generateRecurringTournaments } from './services/recurringTournaments.js';

const server = app.listen(env.PORT, async () => {
  console.log(`Poker Club API запущен локально на порту ${env.PORT}`);
  try { await initializeBot(); } catch (error) { console.error('Не удалось инициализировать Telegram bot', error); }
  try { await generateRecurringTournaments(); } catch (error) { console.error('Не удалось создать повторяющиеся турниры', error); }
});

async function shutdown() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
