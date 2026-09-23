CREATE TYPE "ClubXpSource" AS ENUM ('DAILY_HAND', 'REFERRAL_INVITER', 'REFERRAL_INVITEE', 'ACHIEVEMENT', 'ADMIN_ADJUSTMENT', 'REVERSAL');
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REJECTED');
CREATE TYPE "AchievementRule" AS ENUM ('FIRST_VISIT', 'FIRST_WIN', 'VISITS', 'FINAL_TABLES', 'REFERRALS', 'STREAK', 'DAILY_HAND_CORRECT');

ALTER TABLE "User"
  ADD COLUMN "clubXp" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "referralCode" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "User"
SET "referralCode" = UPPER(SUBSTRING(MD5("id" || RANDOM()::text) FROM 1 FOR 10))
WHERE "referralCode" IS NULL;

CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
CREATE INDEX "User_clubXp_createdAt_idx" ON "User"("clubXp", "createdAt");
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

CREATE TABLE "LoyaltySettings" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "dailyHandXp" INTEGER NOT NULL DEFAULT 10,
  "referralInviterXp" INTEGER NOT NULL DEFAULT 100,
  "referralInviteeXp" INTEGER NOT NULL DEFAULT 50,
  "referralEnabled" BOOLEAN NOT NULL DEFAULT true,
  "dailyHandEnabled" BOOLEAN NOT NULL DEFAULT true,
  "tipsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "streakResetDays" INTEGER NOT NULL DEFAULT 21,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltySettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LoyaltySettings" ("id", "updatedAt") VALUES ('main', CURRENT_TIMESTAMP);

CREATE TABLE "ClubXpTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT,
  "source" "ClubXpSource" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "reversalOfId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubXpTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClubXpTransaction_idempotencyKey_key" ON "ClubXpTransaction"("idempotencyKey");
CREATE UNIQUE INDEX "ClubXpTransaction_reversalOfId_key" ON "ClubXpTransaction"("reversalOfId");
CREATE INDEX "ClubXpTransaction_userId_createdAt_idx" ON "ClubXpTransaction"("userId", "createdAt");
CREATE INDEX "ClubXpTransaction_source_createdAt_idx" ON "ClubXpTransaction"("source", "createdAt");
CREATE INDEX "ClubXpTransaction_createdById_createdAt_idx" ON "ClubXpTransaction"("createdById", "createdAt");

CREATE TABLE "PokerTip" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'Стратегия',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PokerTip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PokerTip_isActive_sortOrder_idx" ON "PokerTip"("isActive", "sortOrder");

CREATE TABLE "PokerHand" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "heroCards" TEXT[] NOT NULL,
  "boardCards" TEXT[] NOT NULL,
  "difficulty" TEXT NOT NULL DEFAULT 'Начальный',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PokerHand_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PokerHand_isActive_sortOrder_idx" ON "PokerHand"("isActive", "sortOrder");

CREATE TABLE "PokerHandOption" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "isCorrect" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PokerHandOption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PokerHandOption_handId_sortOrder_idx" ON "PokerHandOption"("handId", "sortOrder");

CREATE TABLE "DailyHandAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "selectedOptionId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "isCorrect" BOOLEAN NOT NULL,
  "awardedXp" INTEGER NOT NULL DEFAULT 0,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyHandAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyHandAttempt_userId_dayKey_key" ON "DailyHandAttempt"("userId", "dayKey");
CREATE INDEX "DailyHandAttempt_handId_attemptedAt_idx" ON "DailyHandAttempt"("handId", "attemptedAt");

CREATE TABLE "Achievement" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT 'trophy',
  "rule" "AchievementRule" NOT NULL,
  "threshold" INTEGER NOT NULL DEFAULT 1,
  "xpReward" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");
CREATE INDEX "Achievement_isActive_sortOrder_idx" ON "Achievement"("isActive", "sortOrder");

CREATE TABLE "UserAchievement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "achievementId" TEXT NOT NULL,
  "xpAwarded" INTEGER NOT NULL DEFAULT 0,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId", "unlockedAt");

CREATE TABLE "Referral" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "invitedUserId" TEXT NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
  "inviterXp" INTEGER NOT NULL DEFAULT 0,
  "inviteeXp" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "qualifiedAt" TIMESTAMP(3),
  "rewardedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Referral_invitedUserId_key" ON "Referral"("invitedUserId");
CREATE INDEX "Referral_referrerId_status_createdAt_idx" ON "Referral"("referrerId", "status", "createdAt");
CREATE INDEX "Referral_status_createdAt_idx" ON "Referral"("status", "createdAt");

CREATE TABLE "AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsEvent_idempotencyKey_key" ON "AnalyticsEvent"("idempotencyKey");
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");
CREATE INDEX "AnalyticsEvent_userId_createdAt_idx" ON "AnalyticsEvent"("userId", "createdAt");

ALTER TABLE "ClubXpTransaction" ADD CONSTRAINT "ClubXpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClubXpTransaction" ADD CONSTRAINT "ClubXpTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClubXpTransaction" ADD CONSTRAINT "ClubXpTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ClubXpTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PokerHandOption" ADD CONSTRAINT "PokerHandOption_handId_fkey" FOREIGN KEY ("handId") REFERENCES "PokerHand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyHandAttempt" ADD CONSTRAINT "DailyHandAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyHandAttempt" ADD CONSTRAINT "DailyHandAttempt_handId_fkey" FOREIGN KEY ("handId") REFERENCES "PokerHand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyHandAttempt" ADD CONSTRAINT "DailyHandAttempt_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "PokerHandOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PokerTip" ("id", "title", "body", "category", "sortOrder", "updatedAt") VALUES
('tip-position', 'Позиция важнее красоты карт', 'Чем позже вы принимаете решение, тем больше информации уже раскрыли соперники. На баттоне можно разыгрывать заметно шире, чем из ранней позиции.', 'Позиция', 10, CURRENT_TIMESTAMP),
('tip-plan', 'Планируйте следующую улицу', 'Перед ставкой сформулируйте, какие карты тёрна продолжат вашу атаку и что вы сделаете после колла. Ставка без плана часто превращается в дорогую импровизацию.', 'Стратегия', 20, CURRENT_TIMESTAMP),
('tip-size', 'Размер ставки должен иметь цель', 'Ставьте крупнее против диапазона с большим количеством дро и меньше на сухих досках. Одинаковый размер во всех ситуациях упрощает решения соперникам.', 'Сайзинг', 30, CURRENT_TIMESTAMP),
('tip-fold', 'Хороший фолд тоже приносит деньги', 'Не пытайтесь выиграть каждую раздачу. Если линия соперника выглядит слишком сильной, сохранённые фишки ценнее любопытства.', 'Дисциплина', 40, CURRENT_TIMESTAMP),
('tip-observe', 'Смотрите раздачи без вашего участия', 'Отмечайте, кто часто лимпит, кто защищает блайнды и кто способен на большой блеф. Эти наблюдения пригодятся сильнее общей теории.', 'Наблюдение', 50, CURRENT_TIMESTAMP),
('tip-stack', 'Считайте эффективный стек', 'В раздаче важен меньший из двух стеков. Именно он определяет максимально возможный выигрыш и допустимый риск.', 'Математика', 60, CURRENT_TIMESTAMP),
('tip-tilt', 'Пауза — часть стратегии', 'После эмоциональной раздачи сделайте несколько спокойных вдохов и не спешите отыгрываться. Следующее решение не обязано исправлять предыдущее.', 'Психология', 70, CURRENT_TIMESTAMP),
('tip-ranges', 'Думайте диапазонами', 'Не угадывайте одну конкретную руку соперника. Составьте набор рук, с которыми он мог пройти всю линию, и оцените свою руку против этого набора.', 'Диапазоны', 80, CURRENT_TIMESTAMP),
('tip-value', 'Не бойтесь тонкого вэлью', 'Если более слабые руки способны заплатить, ставка может быть прибыльной даже без натса. Проверяйте, что именно хуже вашей руки сделает колл.', 'Вэлью', 90, CURRENT_TIMESTAMP),
('tip-potodds', 'Сравнивайте шансы банка', 'Для колла 100 в банк 300 нужно выигрывать чаще чем в 20% случаев: 100 делится на итоговый банк 500. Сравните это число с шансом усилиться.', 'Математика', 100, CURRENT_TIMESTAMP),
('tip-rest', 'Усталость меняет диапазоны', 'Длинная сессия ухудшает дисциплину незаметно. Если решения становятся автоматическими, короткий перерыв полезнее ещё одного круга.', 'Подготовка', 110, CURRENT_TIMESTAMP),
('tip-notes', 'Записывайте факты, а не ярлыки', 'Заметка «коллировал три улицы со второй парой» полезнее слова «телефон»: она описывает наблюдаемое действие и помогает выбрать линию.', 'Наблюдение', 120, CURRENT_TIMESTAMP);

INSERT INTO "PokerHand" ("id", "title", "scenario", "heroCards", "boardCards", "difficulty", "sortOrder", "updatedAt") VALUES
('hand-001', 'Защита большого блайнда', 'Баттон открывает 2,5 BB, малый блайнд пас. У вас 40 BB и одномастные A♠ 8♠ на большом блайнде. Какое базовое решение лучше?', ARRAY['A♠','8♠'], ARRAY[]::TEXT[], 'Начальный', 10, CURRENT_TIMESTAMP),
('hand-002', 'Вэлью на ривере', 'Вы открыли с K♣ Q♣, получили колл большого блайнда. Доска K♦ 8♠ 3♣ 5♥ 2♠, соперник трижды чекнул. Как сыграть ривер?', ARRAY['K♣','Q♣'], ARRAY['K♦','8♠','3♣','5♥','2♠'], 'Средний', 20, CURRENT_TIMESTAMP),
('hand-003', 'Флеш-дро и шансы банка', 'На тёрне у вас A♥ J♥ на доске K♥ 7♥ 2♣ 4♠. В банке 1 000, соперник ставит 500. Что важнее всего перед коллом?', ARRAY['A♥','J♥'], ARRAY['K♥','7♥','2♣','4♠'], 'Начальный', 30, CURRENT_TIMESTAMP),
('hand-004', 'Сильная рука на опасной доске', 'У вас A♣ A♦. Три игрока увидели флоп J♠ T♠ 9♥, перед вами крупная ставка и рейз. Лучшее базовое действие?', ARRAY['A♣','A♦'], ARRAY['J♠','T♠','9♥'], 'Средний', 40, CURRENT_TIMESTAMP),
('hand-005', 'Позиционный контбет', 'Вы открыли баттон с A♦ 5♦, большой блайнд сделал колл. Флоп K♣ 7♥ 2♠, соперник чекнул. Какой план разумен?', ARRAY['A♦','5♦'], ARRAY['K♣','7♥','2♠'], 'Средний', 50, CURRENT_TIMESTAMP);

INSERT INTO "PokerHandOption" ("id", "handId", "label", "explanation", "isCorrect", "sortOrder") VALUES
('hand-001-a','hand-001','Пас','Рука достаточно сильна и хорошо реализует эквити против широкого диапазона баттона.',false,10),
('hand-001-b','hand-001','Колл','Одномастный туз хорошо защищает большой блайнд и сохраняет более слабые руки соперника.',true,20),
('hand-001-c','hand-001','Олл-ин','При 40 BB это излишне большой риск без необходимости.',false,30),
('hand-002-a','hand-002','Чек','Чек допустим против агрессивного соперника, но часто упускает оплату от более слабого короля и карманных пар.',false,10),
('hand-002-b','hand-002','Небольшая ставка на вэлью','Сухой ран-аут оставляет много более слабых рук, способных заплатить небольшую ставку.',true,20),
('hand-002-c','hand-002','Олл-ин','Слишком крупный размер чаще получит колл только от рук сильнее.',false,30),
('hand-003-a','hand-003','Сосчитать требуемое эквити','Сначала сравните цену колла с вероятностью усилиться и возможными дополнительными выигрышами.',true,10),
('hand-003-b','hand-003','Всегда коллировать натсовое дро','Даже сильное дро может не иметь нужной цены против большого размера.',false,20),
('hand-003-c','hand-003','Всегда пасовать без готовой пары','Дро может иметь достаточно эквити для прибыльного продолжения.',false,30),
('hand-004-a','hand-004','Автоматически идти олл-ин','Оверпара не является натсом: мультипот, связанная доска и рейз резко усиливают диапазоны соперников.',false,10),
('hand-004-b','hand-004','Остановиться и рассмотреть пас','На очень динамичной доске против ставки и рейза дисциплинированный пас часто сохраняет много фишек.',true,20),
('hand-004-c','hand-004','Минимальный ререйз','Маленький ререйз не выбивает дро и привязывает вас к опасному банку.',false,30),
('hand-005-a','hand-005','Небольшой контбет','Сухая доска хорошо подходит диапазону префлоп-агрессора; небольшой размер часто забирает банк недорого.',true,10),
('hand-005-b','hand-005','Олл-ин','Риск несоразмерен банку и выбивает почти все руки хуже.',false,20),
('hand-005-c','hand-005','Всегда чек до вскрытия','Иногда чек полезен, но полный отказ от давления упускает преимущество позиции и диапазона.',false,30);

INSERT INTO "Achievement" ("id", "key", "title", "description", "icon", "rule", "threshold", "xpReward", "sortOrder", "updatedAt") VALUES
('achievement-first-visit','first_visit','Первый шаг','Посетить первый турнир клуба','calendar','FIRST_VISIT',1,25,10,CURRENT_TIMESTAMP),
('achievement-first-win','first_win','Первая победа','Занять первое место в турнире','crown','FIRST_WIN',1,75,20,CURRENT_TIMESTAMP),
('achievement-visits-3','visits_3','В игре','Посетить 3 турнира','spade','VISITS',3,40,30,CURRENT_TIMESTAMP),
('achievement-visits-10','visits_10','Завсегдатай','Посетить 10 турниров','flame','VISITS',10,100,40,CURRENT_TIMESTAMP),
('achievement-final','first_final','Финальный стол','Впервые попасть за финальный стол','trophy','FINAL_TABLES',1,50,50,CURRENT_TIMESTAMP),
('achievement-referral-1','referral_1','Первый приглашённый','Приглашённый друг посетил турнир','users','REFERRALS',1,50,60,CURRENT_TIMESTAMP),
('achievement-referral-5','referral_5','Амбассадор клуба','Пять приглашённых друзей посетили турнир','megaphone','REFERRALS',5,150,70,CURRENT_TIMESTAMP),
('achievement-streak-3','streak_3','Серия из трёх','Посетить три турнира без длинного перерыва','zap','STREAK',3,60,80,CURRENT_TIMESTAMP),
('achievement-quiz-5','quiz_5','Теоретик','Правильно решить пять раздач дня','brain','DAILY_HAND_CORRECT',5,80,90,CURRENT_TIMESTAMP);
