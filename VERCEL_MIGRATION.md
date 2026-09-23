# Миграция Poker Club: Render → Vercel + Postgres

Проект подготовлен к запуску как один Vercel-проект: Vite-интерфейс и Express API работают под одним доменом, а PostgreSQL подключается через Vercel Marketplace (рекомендуется Neon).

## Что изменено в коде

- `vercel.json` описывает два Vercel Services: `web` (`apps/web`) и `api` (`apps/api`).
- Все backend-маршруты находятся под `/api`, поэтому `VITE_API_URL` в production больше не нужен.
- Express экспортируется как приложение для Vercel; постоянный `app.listen()` оставлен только в `src/server.ts` для локального запуска.
- `setInterval` удалён из production. Повторяющиеся турниры создаются Vercel Cron раз в сутки через `/api/cron/recurring-tournaments`.
- Черновики Telegram-рассылки перенесены из `Map` в PostgreSQL (`BroadcastDraft`).
- Лимит попыток входа перенесён в PostgreSQL (`RateLimitBucket`) и работает между разными serverless-инстансами.
- Telegram webhook больше не перенастраивается при каждом старте функции. Его настройка выполняется отдельно через защищённый endpoint.
- Prisma Client создаётся как singleton на инстанс функции. Для runtime рекомендуется pooled `DATABASE_URL`; для миграций используется `DIRECT_URL` или `DATABASE_URL_UNPOOLED`, если переменная доступна.
- Production-миграции Prisma запускаются во время build API. Preview deployments не мигрируют базу автоматически, если не установить `RUN_MIGRATIONS=true`.

## 1. Создайте Vercel-проект

1. Загрузите этот проект в GitHub/GitLab/Bitbucket.
2. Импортируйте репозиторий в Vercel целиком — Root Directory должен быть корнем репозитория, не `apps/web`.
3. В настройках проекта выберите Framework Preset **Services**.
4. Vercel прочитает корневой `vercel.json` и соберёт `web` и `api` как части одного deployment.

## 2. Подключите PostgreSQL

В Vercel откройте **Storage / Marketplace → Postgres → Neon** и подключите базу к проекту.

Для приложения нужен pooled URL:

```env
DATABASE_URL=postgresql://...-pooler.../dbname?sslmode=require
```

Для миграций желательно иметь прямой URL. Поддерживаются оба названия:

```env
DATABASE_URL_UNPOOLED=postgresql://.../dbname?sslmode=require
# или
DIRECT_URL=postgresql://.../dbname?sslmode=require
```

Если прямого URL нет, production build использует `DATABASE_URL`, но для Prisma Migrate предпочтителен direct/unpooled URL.

## 3. Перенесите существующие данные Render PostgreSQL

Если нужно сохранить текущих пользователей, турниры, очки и историю, сначала сделайте dump старой базы, затем restore в новую Neon-базу.

Пример через стандартные PostgreSQL CLI:

```bash
pg_dump "$OLD_RENDER_DATABASE_URL" --format=custom --no-owner --no-acl --file=poker-club.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$NEW_NEON_DIRECT_URL" poker-club.dump
```

После restore выполните миграции из этой версии проекта:

```bash
cd apps/api
DATABASE_URL="$NEW_NEON_DIRECT_URL" npx prisma migrate deploy
```

Не запускайте `prisma db push --force-reset` и production seed на базе с реальными данными.

## 4. Добавьте секреты Vercel

Минимальный production-набор:

```env
NODE_ENV=production
JWT_SECRET=<случайная длинная строка>
CRON_SECRET=<другая случайная длинная строка>
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_WEBHOOK_SECRET=<случайная строка>
ADMIN_TELEGRAM_IDS=111111111,222222222
CLUB_TIMEZONE=Asia/Yekaterinburg
```

`MINI_APP_URL` можно задать вручную, например `https://your-project.vercel.app`. Если он не указан, backend использует Vercel production URL из системных переменных окружения.

Также перенесите Cloudinary и Google Sheets переменные, если эти функции используются:

```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

В production `VITE_API_URL` не нужен: интерфейс вызывает `/api` на том же домене.

## 5. Первый deploy

После подключения базы и переменных запустите production deployment. API build выполнит:

```text
prisma generate
prisma migrate deploy
TypeScript build
```

Проверьте:

```text
https://ВАШ-ДОМЕН/api/health
```

Ожидается `status: "ok"` и `database: "connected"`.

## 6. Настройте Telegram webhook один раз

После успешного production deployment вызовите защищённый endpoint:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://ВАШ-ДОМЕН/api/internal/telegram/setup
```

Он установит Telegram webhook на:

```text
https://ВАШ-ДОМЕН/api/telegram/webhook
```

и обновит список команд бота.

Повторяйте этот запрос только при смене домена, `TELEGRAM_BOT_TOKEN`, webhook secret или команд бота.

## 7. Cron

В корневом `vercel.json` уже добавлен ежедневный cron:

```text
15 0 * * *
```

Он вызывает `/api/cron/recurring-tournaments`, создаёт турниры вперёд и удаляет просроченные serverless-записи. Для текущей логики ежедневного запуска достаточно, потому что шаблоны генерируют расписание на несколько недель вперёд.

## 8. Preview deployments

По умолчанию preview build не выполняет `prisma migrate deploy`. Это сделано специально, чтобы случайный preview не менял production-схему.

Если для Preview используется отдельная Neon branch/database, добавьте в Preview environment:

```env
RUN_MIGRATIONS=true
```

и подключите к Preview отдельные `DATABASE_URL`/`DATABASE_URL_UNPOOLED`.

## После миграции

Когда production на Vercel проверен:

1. убедитесь, что новые записи появляются в Neon;
2. проверьте Telegram-вход и браузерный вход;
3. проверьте создание/регистрацию турнира;
4. проверьте рассылку администратора, включая переход между сообщениями;
5. только после этого остановите Render Web Service и старую Render PostgreSQL.

Старую БД разумно сохранить несколько дней как резервную копию в read-only/backup состоянии, а не удалять сразу после переключения.
