import {
  Award, BarChart3, CalendarCheck, Camera, CheckCircle2, ChevronRight, CircleHelp, Coins, Copy, Crown, Edit3, Flame, Gift, History,
  LockKeyhole, Medal, Phone, Save, Send, ShieldCheck, Spade, Target, Trash2, Trophy, UserPlus, Users, X, Zap
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ErrorState, Loading } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { api, post } from '../lib/api';
import { points, tournamentDate } from '../lib/format';
import type { ClubXpTransaction, PointTransaction, ReferralInfo, Tournament, User } from '../types';

type ProfileTab = 'overview' | 'history' | 'rewards' | 'friends';
const profileTabs: ProfileTab[] = ['overview', 'history', 'rewards', 'friends'];

function profileTabFromQuery(value: string | null): ProfileTab {
  return profileTabs.includes(value as ProfileTab) ? value as ProfileTab : 'overview';
}
type Profile = User & {
  rank: number;
  createdAt: string;
  referralCode: string | null;
  results: { id: string; place: number; points: number; isFinalTable: boolean; tournament: Tournament }[];
  pointTransactions: PointTransaction[];
  clubXpTransactions: ClubXpTransaction[];
  achievements: { id: string; unlockedAt: string; xpAwarded: number; achievement: { id: string; key: string; title: string; description: string; icon: string; xpReward: number } }[];
  achievementCatalog: AchievementCatalogItem[];
  registrations: { id: string; status: string; tournament: Tournament }[];
  referralsSent: ReferralInfo['referrals'];
  hasPhoneNumber: boolean;
  phoneNumberMasked: string | null;
  phoneSharedAt: string | null;
  stats: { gamesPlayed: number; wins: number; finalTables: number; finalTableRate: number; bestPlace: number | null; currentStreak: number; bestStreak: number };
};

type AchievementRule = 'FIRST_VISIT' | 'FIRST_WIN' | 'VISITS' | 'FINAL_TABLES' | 'REFERRALS' | 'STREAK' | 'DAILY_HAND_CORRECT';
type AchievementCatalogItem = {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  rule: AchievementRule;
  threshold: number;
  xpReward: number;
  progress: number;
  isUnlocked: boolean;
  isSecret: boolean;
  unlockedAt: string | null;
  xpAwarded: number | null;
};

type ProfileDetail = {
  eyebrow: string;
  title: string;
  value: string;
  description: string;
  facts: { label: string; value: string }[];
  actionTab?: ProfileTab;
  actionLabel?: string;
};

const achievementCondition: Record<AchievementRule, (threshold: number) => string> = {
  FIRST_VISIT: () => 'Посетить первый турнир клуба',
  FIRST_WIN: () => 'Занять первое место в турнире',
  VISITS: (threshold) => `Посетить ${threshold} турниров`,
  FINAL_TABLES: (threshold) => `Попасть за финальный стол ${threshold} раз`,
  REFERRALS: (threshold) => `Пригласить ${threshold} друзей, которые посетят турнир`,
  STREAK: (threshold) => `Посетить ${threshold} турниров подряд без длинного перерыва`,
  DAILY_HAND_CORRECT: (threshold) => `Правильно решить ${threshold} задачек дня`
};

function achievementIcon(icon: string, locked = false) {
  if (locked) return <LockKeyhole />;
  if (icon === 'crown') return <Crown />;
  if (icon === 'flame') return <Flame />;
  if (icon === 'zap') return <Zap />;
  if (icon === 'spade') return <Spade />;
  if (icon === 'trophy') return <Trophy />;
  return <Award />;
}

const xpSourceLabel: Record<ClubXpTransaction['source'], string> = {
  DAILY_HAND: 'Раздача дня', REFERRAL_INVITER: 'Приглашение друга', REFERRAL_INVITEE: 'Первое посещение',
  ACHIEVEMENT: 'Достижение', ADMIN_ADJUSTMENT: 'Администратор', REVERSAL: 'Отмена операции'
};

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать фотографию'));
    reader.readAsDataURL(file);
  });
}

function decodeImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Изображение повреждено или не поддерживается'));
    image.src = source;
  });
}

async function prepareProfilePhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются JPG, PNG и WebP');
  if (file.size > 8 * 1024 * 1024) throw new Error('Исходный файл должен быть не больше 8 МБ');
  const image = await decodeImage(await readFile(file));
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.floor((image.naturalWidth - side) / 2);
  const sourceY = Math.floor((image.naturalHeight - side) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог обработать фотографию');
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 512, 512);
  let quality = 0.86;
  let result = canvas.toDataURL('image/webp', quality);
  if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/jpeg', quality);
  while (result.length > 430_000 && quality > 0.52) {
    quality -= 0.08;
    result = canvas.toDataURL(result.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', quality);
  }
  if (result.length > 470_000) throw new Error('Не удалось достаточно уменьшить фотографию. Выберите другое изображение.');
  return result;
}

export function ProfilePage() {
  const { refresh } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<ProfileTab>(() => profileTabFromQuery(searchParams.get('tab')));
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [phoneFallbackUrl, setPhoneFallbackUrl] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<ProfileDetail | null>(null);
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementCatalogItem | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { api<Profile>('/profile').then((value) => setProfile(normalizeProfile(value))).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => { setTab(profileTabFromQuery(searchParams.get('tab'))); }, [searchParams]);
  useEffect(() => {
    if (tab === 'friends' && !referral) api<ReferralInfo>('/loyalty/referral').then(setReferral).catch((e: Error) => setShareMessage(e.message));
  }, [tab, referral]);
  if (error) return <ErrorState message={error} />;
  if (!profile) return <Loading />;

  async function getPhoneFallbackUrl() {
    try {
      const config = await api<{ botUsername: string | null }>('/auth/browser/config');
      const url = config.botUsername ? `https://t.me/${config.botUsername}?start=phone` : null;
      setPhoneFallbackUrl(url);
      return url;
    } catch { return null; }
  }

  async function waitForSavedPhone() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const next = normalizeProfile(await api<Profile>('/profile'));
        setProfile(next);
        if (next.hasPhoneNumber) { setPhoneMessage('Номер сохранён и виден только администраторам клуба.'); setPhoneFallbackUrl(null); return; }
      } catch { /* Следующая проверка повторит запрос. */ }
    }
    await getPhoneFallbackUrl();
    setPhoneMessage('Telegram подтвердил отправку, но номер ещё не появился. Откройте бота и нажмите кнопку передачи номера — это резервный надёжный способ.');
  }

  async function requestPhone() {
    const telegram = window.Telegram?.WebApp;
    setPhoneMessage(null); setPhoneFallbackUrl(null);
    if (!telegram?.requestContact) {
      await getPhoneFallbackUrl();
      setPhoneMessage('Передать номер можно в личном чате с ботом.');
      return;
    }
    telegram.requestContact((shared) => {
      if (!shared) { setPhoneMessage('Номер не был передан. Вы сможете сделать это позже.'); return; }
      setPhoneMessage('Контакт отправлен. Проверяем сохранение…');
      void waitForSavedPhone();
    });
  }

  async function shareReferral() {
    if (!referral) return;
    const url = referral.shareLink ?? referral.fallbackMiniAppUrl;
    const text = `Присоединяйся к Poker Club. После первого посещения мы оба получим Club XP: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Poker Club', text, url });
      else { await navigator.clipboard.writeText(text); setShareMessage('Приглашение скопировано'); }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      try { await navigator.clipboard.writeText(text); setShareMessage('Приглашение скопировано'); }
      catch { setShareMessage('Не удалось открыть отправку. Скопируйте ссылку вручную.'); }
    }
  }

  function selectTab(nextTab: ProfileTab) {
    setTab(nextTab);
    setSearchParams(nextTab === 'overview' ? {} : { tab: nextTab }, { replace: true });
  }

  function openEditor() {
    setNickname(profile?.nickname ?? profile?.username ?? '');
    setPhotoPreview(profile?.photoUrl ?? null);
    setPhotoChanged(false);
    setProfileMessage(null);
    setEditing(true);
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setProfileMessage(null);
    try {
      setPhotoPreview(await prepareProfilePhoto(file));
      setPhotoChanged(true);
    } catch (cause) {
      setProfileMessage(cause instanceof Error ? cause.message : 'Не удалось обработать фотографию');
    }
  }

  async function saveProfile() {
    if (!profile) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const body: { nickname: string | null; photoData?: string | null } = { nickname: nickname.trim() || null };
      if (photoChanged) body.photoData = photoPreview;
      const updated = await post<User>('/profile', body, 'PATCH');
      setProfile({ ...profile, ...updated });
      await refresh();
      setEditing(false);
      setProfileMessage('Профиль обновлён');
    } catch (cause) {
      setProfileMessage(cause instanceof Error ? cause.message : 'Не удалось обновить профиль');
    } finally {
      setProfileSaving(false);
    }
  }

  function openMetric(kind: 'rank' | 'rating' | 'xp' | 'games' | 'wins' | 'finals' | 'best' | 'streak') {
    if (!profile) return;
    const recentGames = profile.results.slice(0, 3).map((result) => ({
      label: result.tournament.title,
      value: `#${result.place} · ${tournamentDate(result.tournament.startsAt).full}`
    }));
    const details: Record<typeof kind, ProfileDetail> = {
      rank: {
        eyebrow: 'РЕЙТИНГ СЕЗОНА', title: 'Позиция среди игроков', value: `#${profile.rank}`,
        description: 'Место рассчитывается по текущему балансу Rating PTS. Чем больше очков, тем выше позиция в сезонной таблице.',
        facts: [{ label: 'Rating PTS', value: points(profile.points) }, { label: 'Игроков выше', value: String(Math.max(0, profile.rank - 1)) }]
      },
      rating: {
        eyebrow: 'СПОРТИВНЫЙ РЕЙТИНГ', title: 'Rating PTS', value: points(profile.points),
        description: 'Очки рейтинга начисляются за результаты турниров и определяют ваше место в сезоне.',
        facts: profile.pointTransactions.slice(0, 3).map((entry) => ({ label: entry.reason, value: `${entry.amount > 0 ? '+' : ''}${points(entry.amount)}` })),
        actionTab: 'history', actionLabel: 'Открыть историю Rating PTS'
      },
      xp: {
        eyebrow: 'ПРОГРАММА ЛОЯЛЬНОСТИ', title: 'Club XP', value: `${points(profile.clubXp)} XP`,
        description: 'Бонусный прогресс клуба. Club XP выдаётся за достижения, задачки дня и приглашения и не влияет на спортивный рейтинг.',
        facts: [{ label: 'Открыто достижений', value: `${profile.achievementCatalog.filter((item) => item.isUnlocked).length}/${profile.achievementCatalog.length}` }],
        actionTab: 'rewards', actionLabel: 'Открыть награды и достижения'
      },
      games: {
        eyebrow: 'ИГРОВАЯ СТАТИСТИКА', title: 'Сыграно турниров', value: String(profile.stats.gamesPlayed),
        description: 'Учитываются турниры, в которых для вас сохранён итоговый результат.', facts: recentGames,
        actionTab: 'history', actionLabel: 'Открыть историю игр'
      },
      wins: {
        eyebrow: 'ИГРОВАЯ СТАТИСТИКА', title: 'Победы', value: String(profile.stats.wins),
        description: 'Победой считается первое место в завершённом турнире.',
        facts: [{ label: 'Доля побед', value: profile.stats.gamesPlayed ? `${Math.round(profile.stats.wins / profile.stats.gamesPlayed * 100)}%` : '0%' }],
        actionTab: 'history', actionLabel: 'Посмотреть турниры'
      },
      finals: {
        eyebrow: 'ИГРОВАЯ СТАТИСТИКА', title: 'Финальные столы', value: `${profile.stats.finalTableRate}%`,
        description: 'Доля сыгранных турниров, в которых вы дошли до финального стола.',
        facts: [{ label: 'Финальных столов', value: String(profile.stats.finalTables) }, { label: 'Всего турниров', value: String(profile.stats.gamesPlayed) }],
        actionTab: 'history', actionLabel: 'Посмотреть результаты'
      },
      best: {
        eyebrow: 'ЛИЧНЫЙ РЕКОРД', title: 'Лучшее место', value: profile.stats.bestPlace ? `#${profile.stats.bestPlace}` : '—',
        description: 'Самое высокое место среди всех сохранённых результатов игрока.', facts: recentGames,
        actionTab: 'history', actionLabel: 'Открыть историю игр'
      },
      streak: {
        eyebrow: 'СЕРИЯ ПОСЕЩЕНИЙ', title: 'Текущая серия', value: String(profile.stats.currentStreak),
        description: 'Серия растёт при регулярных подтверждённых посещениях. Длинный перерыв завершает текущую серию, но рекорд сохраняется.',
        facts: [{ label: 'Текущая серия', value: `${profile.stats.currentStreak} посещ.` }, { label: 'Личный рекорд', value: `${profile.stats.bestStreak} посещ.` }]
      }
    };
    setProfileDetail(details[kind]);
  }

  function followDetailAction() {
    if (!profileDetail?.actionTab) return;
    const nextTab = profileDetail.actionTab;
    setProfileDetail(null);
    selectTab(nextTab);
  }

  const unlockedAchievements = profile.achievementCatalog.filter((item) => item.isUnlocked);
  const lockedAchievements = profile.achievementCatalog.filter((item) => !item.isUnlocked);

  return <div className="page profile-page">
    <section className="profile-hero">
      <Avatar firstName={profile.firstName} lastName={profile.lastName} photoUrl={profile.photoUrl} size="lg" />
      <button className="profile-edit-button" onClick={openEditor}><Edit3 /> Изменить профиль</button>
      <h1>{profile.nickname || profile.username || `${profile.firstName} ${profile.lastName ?? ''}`}</h1>
      <p>{profile.nickname ? `${profile.firstName} ${profile.lastName ?? ''}` : profile.username ? `@${profile.username}` : 'Игрок Poker Club'}</p>
      {profile.role === 'ADMIN' && <span className="admin-pill"><ShieldCheck size={14} /> Администратор</span>}
    </section>
    {profileMessage && !editing && <div className="profile-save-message">{profileMessage}</div>}
    {editing && <div className="profile-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}>
      <section className="profile-editor" role="dialog" aria-modal="true" aria-label="Редактирование профиля">
        <header><div><small>ПРОФИЛЬ</small><h2>Никнейм и фотография</h2></div><button onClick={() => setEditing(false)} aria-label="Закрыть"><X /></button></header>
        <div className="profile-photo-editor">
          <Avatar firstName={profile.firstName} lastName={profile.lastName} photoUrl={photoPreview} size="lg" />
          <div>
            <button className="button secondary" onClick={() => photoInput.current?.click()}><Camera />Выбрать фото</button>
            {(photoPreview || profile.photoUrl) && <button className="profile-photo-remove" onClick={() => { setPhotoPreview(null); setPhotoChanged(true); }}><Trash2 />Вернуть заглушку</button>}
            <input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event.target.files?.[0])} />
          </div>
        </div>
        <label className="profile-nickname-field">Никнейм<input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={24} placeholder="Например, RiverFox" /><small>Будет отображаться в рейтинге и внутри клуба</small></label>
        {profileMessage && <div className="form-error">{profileMessage}</div>}
        <button className="button primary wide" disabled={profileSaving || (nickname.trim().length > 0 && nickname.trim().length < 2)} onClick={() => void saveProfile()}><Save />{profileSaving ? 'Сохраняем…' : 'Сохранить'}</button>
      </section>
    </div>}
    <div className="profile-stats">
      <button onClick={() => openMetric('rank')}><Trophy size={20} /><strong>#{profile.rank}</strong><span>в рейтинге</span><CircleHelp /></button>
      <button onClick={() => openMetric('rating')}><Spade size={20} /><strong>{points(profile.points)}</strong><span>Rating PTS</span><CircleHelp /></button>
      <button onClick={() => openMetric('xp')}><Coins size={20} /><strong>{points(profile.clubXp)}</strong><span>Club XP</span><CircleHelp /></button>
    </div>
    <nav className="profile-tabs">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => selectTab('overview')}><Medal />Обзор</button>
      <button className={tab === 'history' ? 'active' : ''} onClick={() => selectTab('history')}><History />История</button>
      <button className={tab === 'rewards' ? 'active' : ''} onClick={() => selectTab('rewards')}><Gift />Награды</button>
      <button className={tab === 'friends' ? 'active' : ''} onClick={() => selectTab('friends')}><Users />Друзья</button>
    </nav>

    {tab === 'overview' && <>
      <div className="profile-metrics">
        <button onClick={() => openMetric('games')}><strong>{profile.stats.gamesPlayed}</strong><span>турниров</span><ChevronRight /></button>
        <button onClick={() => openMetric('wins')}><strong>{profile.stats.wins}</strong><span>побед</span><ChevronRight /></button>
        <button onClick={() => openMetric('finals')}><strong>{profile.stats.finalTableRate}%</strong><span>финальных столов</span><ChevronRight /></button>
        <button onClick={() => openMetric('best')}><strong>{profile.stats.bestPlace ? `#${profile.stats.bestPlace}` : '—'}</strong><span>лучшее место</span><ChevronRight /></button>
      </div>
      <button className="streak-card card profile-detail-row" onClick={() => openMetric('streak')}><span><Flame /></span><div><small>ТЕКУЩАЯ СЕРИЯ</small><strong>{profile.stats.currentStreak} посещения</strong><p>Личный рекорд: {profile.stats.bestStreak}</p></div><ChevronRight /></button>
      <button className="profile-achievements-entry card" onClick={() => selectTab('rewards')}><span><Award /></span><div><small>ДОСТИЖЕНИЯ</small><strong>{unlockedAchievements.length} из {profile.achievementCatalog.length} открыто</strong><p>{lockedAchievements.length ? `Ближайшие награды: ещё ${lockedAchievements.length}` : 'Все доступные достижения получены'}</p></div><ChevronRight /></button>
      {profile.registrations.length > 0 && <><div className="section-title"><h2>Предстоящие игры</h2><Link to="/games">Все игры</Link></div><div className="upcoming-profile-list card">{profile.registrations.map((registration) => <Link to="/games" key={registration.id}><CalendarCheck /><div><strong>{registration.tournament.title}</strong><span>{tournamentDate(registration.tournament.startsAt).full}</span></div><ChevronRight /></Link>)}</div></>}
      {profile.telegramId
        ? <div className="telegram-id card"><span>Ваш Telegram ID</span><code>{profile.telegramId}</code></div>
        : profile.email && <div className="telegram-id card"><span>Вход по почте</span><code>{profile.email}</code></div>}
      {profile.telegramId && <section className={`phone-share-card card ${profile.hasPhoneNumber ? 'saved' : ''}`}><span>{profile.hasPhoneNumber ? <CheckCircle2 /> : <Phone />}</span><div><strong>{profile.hasPhoneNumber ? 'Номер передан' : 'Оставить номер организаторам'}</strong><small>{profile.hasPhoneNumber ? `${profile.phoneNumberMasked} · доступен только администраторам` : 'Добровольно — для связи по турнирам и подаркам'}</small></div>{!profile.hasPhoneNumber && <button onClick={requestPhone}>Поделиться</button>}</section>}
      {profile.telegramId && phoneMessage && <div className="phone-share-message">{phoneMessage}</div>}
      {profile.telegramId && phoneFallbackUrl && !profile.hasPhoneNumber && <a className="phone-bot-fallback" href={phoneFallbackUrl}>Открыть бота и передать номер</a>}
      {profile.role === 'ADMIN' && <Link className="admin-entry card" to="/admin"><span><ShieldCheck /><span><strong>Управление клубом</strong><small>Турниры, игроки и программа лояльности</small></span></span><ChevronRight /></Link>}
    </>}

    {tab === 'history' && <>
      <div className="section-title"><h2>История Rating PTS</h2></div>
      <div className="points-history card">{profile.pointTransactions.map((entry) => <div className="point-history-row" key={entry.id}><span className={entry.amount > 0 ? 'point-plus' : 'point-minus'}>{entry.amount > 0 ? '+' : ''}{points(entry.amount)}</span><div><strong>{entry.reason}</strong><span>{tournamentDate(entry.createdAt).full} · {entry.createdBy.firstName}</span></div><small>{points(entry.balanceAfter)} PTS</small></div>)}{!profile.pointTransactions.length && <div className="empty-inline">Начислений в этом сезоне пока нет</div>}</div>
      <div className="section-title"><h2>Игры</h2></div>
      <div className="history-list card">{profile.results.map((result) => <div className="history-row" key={result.id}><span className="history-icon"><CalendarCheck size={19} /></span><div><strong>{result.tournament.title}</strong><span>{tournamentDate(result.tournament.startsAt).full}{result.isFinalTable ? ' · финальный стол' : ''}</span></div><div><strong>#{result.place}</strong><span>место</span></div></div>)}{!profile.results.length && <div className="empty-inline">История игр пока пуста</div>}</div>
    </>}

    {tab === 'rewards' && <>
      <section className="xp-balance-card"><span><Coins /></span><div><small>БОНУСНЫЙ БАЛАНС</small><strong>{points(profile.clubXp)} Club XP</strong><p>Не влияет на турнирный рейтинг</p></div></section>
      <section className="achievement-summary card"><span><Award /></span><div><small>КОЛЛЕКЦИЯ ДОСТИЖЕНИЙ</small><strong>{unlockedAchievements.length} из {profile.achievementCatalog.length}</strong><div><i style={{ width: `${profile.achievementCatalog.length ? unlockedAchievements.length / profile.achievementCatalog.length * 100 : 0}%` }} /></div><p>Нажмите на достижение, чтобы увидеть условие, прогресс и дату получения.</p></div></section>
      <div className="section-title"><h2>Получены</h2><span>{unlockedAchievements.length}</span></div>
      <div className="achievement-grid">{unlockedAchievements.map((achievement) => <button className="achievement-card unlocked" key={achievement.id} onClick={() => setSelectedAchievement(achievement)}><span>{achievementIcon(achievement.icon)}</span><div><strong>{achievement.title}</strong><p>{achievement.description}</p><small><CheckCircle2 />{achievement.unlockedAt ? tournamentDate(achievement.unlockedAt).full : 'Получено'} · +{achievement.xpAwarded ?? achievement.xpReward} XP</small></div><ChevronRight /></button>)}{!unlockedAchievements.length && <div className="empty-inline card">Первое достижение появится после посещения турнира</div>}</div>
      <div className="section-title"><h2>В процессе</h2><span>{lockedAchievements.length}</span></div>
      <div className="achievement-grid">{lockedAchievements.map((achievement) => <button className="achievement-card locked" key={achievement.id} onClick={() => setSelectedAchievement(achievement)}><span>{achievementIcon(achievement.icon, achievement.isSecret)}</span><div><strong>{achievement.isSecret ? 'Скрытое достижение' : achievement.title}</strong><p>{achievement.isSecret ? 'Продолжайте играть, чтобы раскрыть условие.' : achievement.description}</p><div className="achievement-progress"><i style={{ width: `${achievement.threshold ? achievement.progress / achievement.threshold * 100 : 0}%` }} /></div><small>{achievement.isSecret ? 'Условие скрыто' : `${achievement.progress} из ${achievement.threshold}`} · +{achievement.xpReward} XP</small></div><ChevronRight /></button>)}{!lockedAchievements.length && <div className="empty-inline card">Все доступные достижения уже открыты</div>}</div>
      <div className="section-title"><h2>История Club XP</h2></div>
      <div className="xp-history card">{profile.clubXpTransactions.map((entry) => <div key={entry.id}><span className={entry.amount > 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</span><div><strong>{entry.reason}</strong><small>{xpSourceLabel[entry.source]} · {tournamentDate(entry.createdAt).full}</small></div><em>{entry.balanceAfter} XP</em></div>)}{!profile.clubXpTransactions.length && <div className="empty-inline">Бонусных операций пока нет</div>}</div>
    </>}

    {tab === 'friends' && <>
      <section className="referral-hero"><span><UserPlus /></span><h2>Приглашайте друзей</h2><p>Награда начислится только после первого подтверждённого посещения друга.</p>{referral ? <><div><small>ВАШ КОД</small><strong>{referral.referralCode}</strong><button onClick={() => void navigator.clipboard.writeText(referral.referralCode)} aria-label="Скопировать код"><Copy /></button></div><button className="referral-share" onClick={() => void shareReferral()}><Send />Поделиться приглашением</button><small>Вы получите +{referral.rewardXp} XP, друг — +{referral.inviteeRewardXp} XP</small></> : <span className="mini-loader">Готовим ссылку…</span>}</section>
      {shareMessage && <div className="phone-share-message">{shareMessage}</div>}
      <div className="section-title"><h2>Приглашённые</h2><span>{referral?.referrals.length ?? profile.referralsSent.length}</span></div>
      <div className="referral-list card">{(referral?.referrals ?? profile.referralsSent).map((item) => <article key={item.id}><Avatar firstName={item.invitedUser.firstName} lastName={item.invitedUser.lastName} photoUrl={item.invitedUser.photoUrl} size="sm" /><div><strong>{item.invitedUser.nickname || (item.invitedUser.username ? `@${item.invitedUser.username}` : `${item.invitedUser.firstName} ${item.invitedUser.lastName ?? ''}`)}</strong><small>{item.status === 'REWARDED' ? `Посещение подтверждено · +${item.inviterXp} XP` : item.status === 'REJECTED' ? 'Приглашение отклонено' : 'Ожидаем первое посещение'}</small></div><span className={`referral-status ${item.status.toLowerCase()}`}>{item.status === 'REWARDED' ? <CheckCircle2 /> : item.status === 'PENDING' ? '…' : '×'}</span></article>)}{(referral?.referrals ?? profile.referralsSent).length === 0 && <div className="empty-inline">Приглашённых игроков пока нет</div>}</div>
    </>}

    {profileDetail && <div className="profile-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileDetail(null); }}>
      <section className="profile-info-dialog" role="dialog" aria-modal="true" aria-label={profileDetail.title}>
        <header><div><small>{profileDetail.eyebrow}</small><h2>{profileDetail.title}</h2></div><button onClick={() => setProfileDetail(null)} aria-label="Закрыть"><X /></button></header>
        <div className="profile-info-value"><BarChart3 /><strong>{profileDetail.value}</strong></div>
        <p>{profileDetail.description}</p>
        {profileDetail.facts.length > 0 && <div className="profile-info-facts">{profileDetail.facts.map((fact, index) => <div key={`${fact.label}-${index}`}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div>}
        {profileDetail.actionTab && <button className="profile-info-action" onClick={followDetailAction}>{profileDetail.actionLabel ?? 'Открыть подробнее'}<ChevronRight /></button>}
      </section>
    </div>}

    {selectedAchievement && <div className="profile-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAchievement(null); }}>
      <section className={`achievement-dialog ${selectedAchievement.isUnlocked ? 'unlocked' : 'locked'}`} role="dialog" aria-modal="true" aria-label={selectedAchievement.title}>
        <header><div><small>{selectedAchievement.isUnlocked ? 'ДОСТИЖЕНИЕ ПОЛУЧЕНО' : 'ДОСТИЖЕНИЕ В ПРОЦЕССЕ'}</small><h2>{selectedAchievement.isSecret && !selectedAchievement.isUnlocked ? 'Скрытое достижение' : selectedAchievement.title}</h2></div><button onClick={() => setSelectedAchievement(null)} aria-label="Закрыть"><X /></button></header>
        <div className="achievement-dialog-icon">{achievementIcon(selectedAchievement.icon, selectedAchievement.isSecret && !selectedAchievement.isUnlocked)}</div>
        <p>{selectedAchievement.isSecret && !selectedAchievement.isUnlocked ? 'Продолжайте играть — условие откроется после получения достижения.' : selectedAchievement.description}</p>
        <div className="achievement-dialog-section"><small>КАК ПОЛУЧИТЬ</small><strong>{selectedAchievement.isSecret && !selectedAchievement.isUnlocked ? 'Условие скрыто' : achievementCondition[selectedAchievement.rule](selectedAchievement.threshold)}</strong></div>
        <div className="achievement-dialog-progress"><div><span>Прогресс</span><strong>{selectedAchievement.isSecret && !selectedAchievement.isUnlocked ? 'Скрыт' : `${selectedAchievement.progress} из ${selectedAchievement.threshold}`}</strong></div><div><i style={{ width: `${selectedAchievement.threshold ? selectedAchievement.progress / selectedAchievement.threshold * 100 : 0}%` }} /></div></div>
        <div className="achievement-dialog-meta"><div><Target /><span>Награда<strong>+{selectedAchievement.xpAwarded ?? selectedAchievement.xpReward} Club XP</strong></span></div><div>{selectedAchievement.isUnlocked ? <CheckCircle2 /> : <LockKeyhole />}<span>{selectedAchievement.isUnlocked ? 'Дата получения' : 'Статус'}<strong>{selectedAchievement.isUnlocked && selectedAchievement.unlockedAt ? tournamentDate(selectedAchievement.unlockedAt).full : 'Ещё не получено'}</strong></span></div></div>
      </section>
    </div>}
  </div>;
}

function normalizeProfile(value: Profile): Profile {
  const results = value.results ?? [];
  const achievements = value.achievements ?? [];
  const wins = results.filter((item) => item.place === 1).length;
  const finalTables = results.filter((item) => item.isFinalTable).length;
  return {
    ...value,
    clubXp: Number.isFinite(value.clubXp) ? value.clubXp : 0,
    clubXpTransactions: value.clubXpTransactions ?? [],
    achievements,
    achievementCatalog: value.achievementCatalog ?? achievements.map((entry) => ({
      id: entry.achievement.id,
      key: entry.achievement.key,
      title: entry.achievement.title,
      description: entry.achievement.description,
      icon: entry.achievement.icon,
      rule: 'VISITS' as const,
      threshold: 1,
      xpReward: entry.achievement.xpReward,
      progress: 1,
      isUnlocked: true,
      isSecret: false,
      unlockedAt: entry.unlockedAt,
      xpAwarded: entry.xpAwarded
    })),
    registrations: value.registrations ?? [],
    referralsSent: value.referralsSent ?? [],
    stats: value.stats || {
      gamesPlayed: results.length,
      wins,
      finalTables,
      finalTableRate: results.length ? Math.round(finalTables / results.length * 100) : 0,
      bestPlace: results.length ? Math.min(...results.map((item) => item.place)) : null,
      currentStreak: 0,
      bestStreak: 0
    }
  };
}
