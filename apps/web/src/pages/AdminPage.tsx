import {
  ArrowDown, ArrowLeft, ArrowUp, Bell, CalendarDays, CalendarPlus, CheckCircle2, ChevronRight,
  Armchair, CircleAlert, ClipboardCheck, Coins, Copy, Edit3, Eye, EyeOff, FileStack, Filter, Gift, History, ImagePlus, KeyRound, LayoutDashboard,
  ListChecks, LogOut, Medal, MonitorSmartphone, NotebookPen, Plus, RefreshCw, RotateCcw, Save,
  Search, Settings, ShieldCheck, ShieldOff, Shuffle, Spade, Tags, Trash2, Trophy, UserCheck, UserMinus, UserRound, Play,
  Users, X, MoreHorizontal, Phone, BarChart3
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ErrorState, Loading } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { api, post } from '../lib/api';
import { deriveAdminWorkflow, type AdminFocusTournament } from '../lib/adminWorkflow';
import { points, tournamentDate } from '../lib/format';
import { applyAccentColor, DEFAULT_ACCENT_COLOR, normalizeAccentColor } from '../lib/theme';
import type { PlayerTag, PointTransaction, Season, Tournament, TournamentRegistrationStatus, User } from '../types';
import { LoyaltyAdminTab } from './LoyaltyAdminTab';
import { AnalyticsAdminTab } from './AnalyticsAdminTab';
import { MainTournamentWorkspace } from '../components/MainTournamentWorkspace';

type AdminSection = 'overview' | 'players' | 'tournaments' | 'seating' | 'loyalty' | 'analytics' | 'audit' | 'access' | 'settings' | 'more';
type AdminIntentKind = 'points' | 'newTournament' | 'results' | 'participants' | 'invite' | 'openTournament' | 'seating';
type AdminIntent = { kind: AdminIntentKind; nonce: number; targetId?: string } | null;

const adminSectionValues: AdminSection[] = ['overview', 'players', 'tournaments', 'seating', 'loyalty', 'analytics', 'audit', 'access', 'settings', 'more'];
const adminIntentValues: AdminIntentKind[] = ['points', 'newTournament', 'results', 'participants', 'invite', 'openTournament', 'seating'];

function initialAdminSection(): AdminSection {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('section') as AdminSection | null;
  const intent = params.get('intent') as AdminIntentKind | null;
  if (value === 'seating' || intent === 'seating' || intent === 'participants' || intent === 'results') return 'overview';
  return value && adminSectionValues.includes(value) ? value : 'overview';
}

function initialAdminIntent(): AdminIntent {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get('intent') as AdminIntentKind | null;
  if (!kind || !adminIntentValues.includes(kind)) return null;
  return { kind, targetId: params.get('target') ?? undefined, nonce: Date.now() };
}

function replaceAdminLocation(section: AdminSection, kind?: AdminIntentKind, targetId?: string) {
  const url = new URL(window.location.href);
  url.pathname = '/admin';
  url.search = '';
  if (section !== 'overview') url.searchParams.set('section', section);
  if (kind) url.searchParams.set('intent', kind);
  if (targetId) url.searchParams.set('target', targetId);
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}
type AdminUser = Pick<User, 'id' | 'telegramId' | 'firstName' | 'lastName' | 'username' | 'nickname' | 'photoUrl' | 'role' | 'points' | 'clubXp'> & {
  phoneNumber: string | null;
  phoneSharedAt: string | null;
  tags: PlayerTag[];
  lastPlayedAt: string | null;
  _count?: { results: number; browserSessions: number; registrations: number };
};
type BrowserSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  user?: Pick<AdminUser, 'id' | 'telegramId' | 'firstName' | 'lastName' | 'username' | 'nickname'>;
};
type BrowserInviteResult = { url: string; expiresAt: string; user: AdminUser };
type AdminUserDetails = AdminUser & {
  photoUrl: string | null;
  createdAt: string;
  adminNote: string | null;
  pointTransactions: PointTransaction[];
  results: { id: string; place: number; createdAt: string; tournament: Pick<Tournament, 'id' | 'title' | 'startsAt' | 'status'> }[];
  browserSessions: BrowserSession[];
};
type AdminPointTransaction = PointTransaction & { user: Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'nickname'> };
type Overview = {
  players: number;
  tournaments: number;
  activeBrowserSessions: number;
  activeSeason: Season | null;
  nextTournament: Tournament | null;
  focusTournament: AdminFocusTournament | null;
  recentTournaments: (Tournament & { _count: { results: number; notifications: number; registrations: number } })[];
  recentPointTransactions: AdminPointTransaction[];
  alerts: { id: string; severity: 'critical' | 'warning' | 'info'; title: string; text: string; section: AdminSection; targetId?: string }[];
};
type ReasonPreset = { id: string; label: string; reason: string; kind: 'AWARD' | 'DEDUCTION' | 'BOTH'; defaultAmount: number | null; sortOrder: number; isActive: boolean };
type TournamentTemplate = { id: string; name: string; title: string; description: string | null; location: string | null; capacity: number; recurrenceEnabled: boolean; nextStartsAt: string | null; weeksAhead: number; isActive: boolean; _count: { tournaments: number } };
type Registration = { id: string; status: TournamentRegistrationStatus; createdAt: string; user: AdminUser };
type PointBatch = { id: string; note: string | null; createdAt: string; _count: { transactions: number } };
type AuditLog = { id: string; action: string; entityType: string; entityId: string | null; summary: string; before: unknown; after: unknown; metadata: unknown; createdAt: string; actor: Pick<User, 'id' | 'firstName' | 'lastName' | 'username'> | null };
type AuditResponse = { logs: AuditLog[]; filters: { actions: string[]; entityTypes: string[] } };
type TournamentDetails = Tournament & {
  description: string | null;
  season: Season;
  results: { userId: string; place: number; points: number; user: Pick<AdminUser, 'id' | 'firstName' | 'lastName' | 'username' | 'nickname'> }[];
  registrations: Registration[];
  pointBatches: PointBatch[];
};
type SeatingPlayer = Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'nickname' | 'photoUrl'>;
type SeatingData = {
  tournament: Pick<Tournament, 'id' | 'title' | 'startsAt' | 'status'> & { seatingPublishedAt: string | null; seatingVersion: number };
  tables: { id: string; number: number; capacity: number; seats: { id: string; userId: string; seatNumber: number; user: SeatingPlayer }[] }[];
  registrations: { id: string; userId: string; status: TournamentRegistrationStatus; user: SeatingPlayer }[];
  unseated: { id: string; userId: string; status: TournamentRegistrationStatus; user: SeatingPlayer }[];
  eligibleCount: number;
  seatedCount: number;
};
type BrandingSettings = { ratingBannerImageData: string | null; accentColor: string; updatedAt: string | null };
type TrainingLeadSettings = { trainingSheetUrl: string; trainingLeadPopupEnabled: boolean; googleSheetsConfigured: boolean; googleServiceAccountEmail?: string | null; totalLeads?: number; unsyncedLeads?: number; updatedAt: string | null };

const desktopSections = [
  { id: 'overview' as const, label: 'MAIN', icon: LayoutDashboard },
  { id: 'players' as const, label: 'Игроки', icon: Users },
  { id: 'tournaments' as const, label: 'Турниры', icon: CalendarDays },
  { id: 'analytics' as const, label: 'Аналитика', icon: BarChart3 },
  { id: 'audit' as const, label: 'Аудит', icon: History },
  { id: 'settings' as const, label: 'Настройки', icon: Settings },
  { id: 'more' as const, label: 'Ещё', icon: MoreHorizontal }
];
const mobileSections = [
  { id: 'overview' as const, label: 'MAIN', icon: LayoutDashboard },
  { id: 'players' as const, label: 'Игроки', icon: Users },
  { id: 'tournaments' as const, label: 'Турниры', icon: CalendarDays },
  { id: 'more' as const, label: 'Ещё', icon: MoreHorizontal }
];
const sectionTitles: Record<AdminSection, string> = {
  overview: 'MAIN', players: 'Игроки', tournaments: 'Турниры', seating: 'Рассадка', loyalty: 'Лояльность', analytics: 'Аналитика', audit: 'Аудит', access: 'Безопасность', settings: 'Настройки', more: 'Ещё'
};

export function AdminPage() {
  const { user } = useAuth();
  const [section, setSection] = useState<AdminSection>(initialAdminSection);
  const [intent, setIntent] = useState<AdminIntent>(initialAdminIntent);
  const [mainTournamentId, setMainTournamentId] = useState(() => new URLSearchParams(window.location.search).get('target') ?? '');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tags, setTags] = useState<PlayerTag[]>([]);
  const [reasonPresets, setReasonPresets] = useState<ReasonPreset[]>([]);
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loadedSections, setLoadedSections] = useState<Partial<Record<AdminSection, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api<Overview>('/admin/overview'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить админку');
    }
  }, []);

  const loadSectionData = useCallback(async (target: AdminSection) => {
    try {
      if (target === 'players') {
        const [usersData, tagsData, reasonsData] = await Promise.all([api<AdminUser[]>('/admin/users'), api<PlayerTag[]>('/admin/tags'), api<ReasonPreset[]>('/admin/reason-presets')]);
        setUsers(usersData); setTags(tagsData); setReasonPresets(reasonsData);
      } else if (target === 'tournaments') {
        const [seasonsData, tournamentsData, templatesData] = await Promise.all([api<Season[]>('/admin/seasons'), api<Tournament[]>('/tournaments'), api<TournamentTemplate[]>('/admin/tournament-templates')]);
        setSeasons(seasonsData); setTournaments(tournamentsData); setTemplates(templatesData);
      } else if (target === 'seating') {
        setTournaments(await api<Tournament[]>('/tournaments'));
      } else if (target === 'access') {
        setUsers(await api<AdminUser[]>('/admin/users'));
      } else if (target === 'settings') {
        const [seasonsData, tagsData, reasonsData] = await Promise.all([api<Season[]>('/admin/seasons'), api<PlayerTag[]>('/admin/tags'), api<ReasonPreset[]>('/admin/reason-presets')]);
        setSeasons(seasonsData); setTags(tagsData); setReasonPresets(reasonsData);
      }
      setLoadedSections((current) => ({ ...current, [target]: true }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить раздел админки');
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => {
    if (section === 'overview' || section === 'loyalty' || section === 'analytics' || section === 'audit' || section === 'more' || loadedSections[section]) return;
    void loadSectionData(section);
  }, [section, loadedSections, loadSectionData]);

  function navigate(next: AdminSection, kind?: AdminIntentKind, targetId?: string) {
    if (next === 'seating' || kind === 'seating' || kind === 'participants' || kind === 'results') {
      if (targetId) setMainTournamentId(targetId);
      setSection('overview');
      setIntent(null);
      replaceAdminLocation('overview');
      return;
    }
    setSection(next);
    setIntent(kind ? { kind, targetId, nonce: Date.now() } : null);
    replaceAdminLocation(next, kind, targetId);
  }
  function done(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
    void loadOverview();
    if (section !== 'overview' && section !== 'loyalty' && section !== 'analytics' && section !== 'audit' && section !== 'more') void loadSectionData(section);
  }

  if (error) return <div className="admin-shell"><ErrorState message={error} /></div>;
  if (!overview) return <div className="admin-shell"><Loading label="Открываем админку…" /></div>;

  const moreActive = section === 'more' || section === 'seating' || section === 'loyalty' || section === 'analytics' || section === 'audit' || section === 'access' || section === 'settings';
  const sectionReady = section === 'overview' || section === 'loyalty' || section === 'analytics' || section === 'audit' || section === 'more' || Boolean(loadedSections[section]);
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><span><Spade size={21} fill="currentColor" /></span><div><strong>POKER CLUB</strong><small>Панель управления</small></div></div>
      <small className="admin-nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</small>
      <nav>{desktopSections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} />{label}</button>)}</nav>
      <div className="admin-user"><Link to="/profile" aria-label="Открыть профиль"><Avatar firstName={user!.firstName} lastName={user!.lastName} photoUrl={user!.photoUrl} size="sm" /></Link><div><strong>{user!.nickname || user!.firstName}</strong><small>Администратор</small></div><Link to="/" aria-label="Вернуться в приложение"><LogOut size={18} /></Link></div>
    </aside>
    <main className="admin-main">
      <header className="admin-mobile-head"><Link to="/"><ArrowLeft /></Link><strong>{sectionTitles[section]}</strong><Link to="/profile" aria-label="Открыть профиль"><Avatar firstName={user!.firstName} lastName={user!.lastName} photoUrl={user!.photoUrl} size="sm" /></Link></header>
      {notice && <div className="toast"><CheckCircle2 size={18} />{notice}</div>}
      {section === 'overview' && <MainTournamentWorkspace initialTournamentId={mainTournamentId || overview.focusTournament?.id} onNotice={done} onOpenTournament={(id) => navigate('tournaments', 'openTournament', id)} />}
      {!sectionReady && <div className="admin-view"><Loading label="Загружаем раздел…" /></div>}
      {section === 'players' && sectionReady && <PlayersTab users={users} tags={tags} reasonPresets={reasonPresets} intent={intent} onDone={done} />}
      {section === 'tournaments' && sectionReady && <TournamentsTab seasons={seasons} tournaments={tournaments} templates={templates} intent={intent} onDone={done} onOpenMain={(id) => { setMainTournamentId(id); navigate('overview'); }} />}
      {section === 'seating' && sectionReady && <SeatingTab tournaments={tournaments} intent={intent} onDone={done} />}
      {section === 'loyalty' && <LoyaltyAdminTab onDone={done} />}
      {section === 'analytics' && <AnalyticsAdminTab />}
      {section === 'audit' && <AuditTab />}
      {section === 'access' && sectionReady && <AccessTab users={users} onDone={done} />}
      {section === 'settings' && sectionReady && <SettingsTab seasons={seasons} tags={tags} reasonPresets={reasonPresets} onDone={done} />}
      {section === 'more' && <MoreTab onNavigate={navigate} />}
      <nav className="admin-mobile-tabs">{mobileSections.map(({ id, label, icon: Icon }) => {
        const active = id === 'more' ? moreActive : section === id;
        return <button key={id} className={active ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} /><span>{label}</span></button>;
      })}</nav>
    </main>
  </div>;
}

function AdminHeading({ eyebrow, title, text, actions }: { eyebrow: string; title: string; text: string; actions?: ReactNode }) {
  return <div className="admin-heading-row"><div className="admin-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{actions && <div className="admin-heading-actions">{actions}</div>}</div>;
}

function OverviewTab({ data, onNavigate, onDone }: { data: Overview; onNavigate: (section: AdminSection, kind?: AdminIntentKind, targetId?: string) => void; onDone: (message: string) => void }) {
  return <div className="admin-view">
    <AdminHeading eyebrow="ОПЕРАЦИОННЫЙ ЦЕНТР" title="Сегодня" text="Один экран ведёт администратора от заявок до начисления очков" />
    {data.focusTournament ? <TournamentCommandCenter tournament={data.focusTournament} onNavigate={onNavigate} onDone={onDone} /> : <section className="today-empty"><span><CalendarPlus /></span><div><h2>Нет турнира для работы</h2><p>Создайте игру из шаблона — после этого здесь появится следующий шаг.</p></div><button className="button primary" onClick={() => onNavigate('tournaments', 'newTournament')}><Plus size={16} />Создать турнир</button></section>}
    {data.alerts.length > 0 && <section className="smart-alerts" aria-label="Требует внимания">
      <div className="admin-section-title"><div><h2>Исключения</h2><p>Только то, что требует решения администратора</p></div><span>{data.alerts.length}</span></div>
      <div>{data.alerts.map((alert) => <button className={`smart-alert ${alert.severity}`} key={alert.id} onClick={() => onNavigate(alert.section, alert.targetId ? 'openTournament' : undefined, alert.targetId)}><CircleAlert /><div><strong>{alert.title}</strong><small>{alert.text}</small></div><ChevronRight /></button>)}</div>
    </section>}
    <div className="admin-stat-grid admin-stat-grid-four">
      <div><span><Users /></span><p>Игроков</p><strong>{data.players}</strong></div>
      <div><span><CalendarDays /></span><p>Турниров</p><strong>{data.tournaments}</strong></div>
      <div><span><MonitorSmartphone /></span><p>Сессий в браузере</p><strong>{data.activeBrowserSessions}</strong></div>
      <div><span><Trophy /></span><p>Активный сезон</p><strong className="stat-text">{data.activeSeason?.name ?? 'Не выбран'}</strong></div>
    </div>
    <section className="quick-actions-section">
      <div className="admin-section-title"><div><h2>Быстрые действия</h2><p>Частые операции без поиска по меню</p></div></div>
      <div className="quick-actions-grid">
        <button onClick={() => onNavigate('players', 'points')}><span><Coins /></span><div><strong>Изменить очки</strong><small>Начислить или списать</small></div><ChevronRight /></button>
        <button onClick={() => onNavigate('tournaments', 'newTournament')}><span><CalendarPlus /></span><div><strong>Создать турнир</strong><small>Добавить игру в расписание</small></div><ChevronRight /></button>
        <button onClick={() => onNavigate('tournaments', 'results')}><span><Medal /></span><div><strong>Внести результаты</strong><small>Расставить игроков по местам</small></div><ChevronRight /></button>
        <button onClick={() => onNavigate('seating', 'seating')}><span><Armchair /></span><div><strong>Рассадить игроков</strong><small>Столы, места и публикация</small></div><ChevronRight /></button>
        <button onClick={() => onNavigate('access', 'invite')}><span><KeyRound /></span><div><strong>Выдать доступ</strong><small>Создать браузерную ссылку</small></div><ChevronRight /></button>
      </div>
    </section>
    <div className="overview-columns">
      <section className="admin-section">
        <div className="admin-section-title"><div><h2>Турниры</h2><p>{data.nextTournament ? `Ближайший: ${tournamentDate(data.nextTournament.startsAt).full}` : 'Ближайших игр пока нет'}</p></div><button className="button ghost" onClick={() => onNavigate('tournaments')}>Все <ChevronRight size={15} /></button></div>
        <div className="overview-tournament-list">{data.recentTournaments.slice(0, 5).map((item) => <button key={item.id} onClick={() => onNavigate('tournaments', 'openTournament', item.id)}><div className="mini-date"><strong>{tournamentDate(item.startsAt).day}</strong><span>{tournamentDate(item.startsAt).month}</span></div><div><strong>{item.title}</strong><small>{item.location || 'Место не указано'} · {item._count.results} результатов</small></div><Status value={item.status} /><ChevronRight /></button>)}{!data.recentTournaments.length && <Empty icon={<CalendarDays />} title="Турниров пока нет" text="Создайте первую игру через быстрое действие" />}</div>
      </section>
      <section className="admin-section">
        <div className="admin-section-title"><div><h2>Последние операции</h2><p>Журнал ручного изменения баланса</p></div><button className="button ghost" onClick={() => onNavigate('players')}>Игроки <ChevronRight size={15} /></button></div>
        <div className="overview-points-list">{data.recentPointTransactions.map((entry) => <article key={entry.id}><span className={entry.amount > 0 ? 'award' : 'deduct'}>{entry.amount > 0 ? '+' : ''}{points(entry.amount)}</span><div><strong>{playerLabel(entry.user)}</strong><small>{entry.reason} · {tournamentDate(entry.createdAt).full}</small></div><b>{points(entry.balanceAfter)}</b></article>)}{!data.recentPointTransactions.length && <Empty icon={<Coins />} title="Операций пока нет" text="Начисления появятся здесь" />}</div>
      </section>
    </div>
  </div>;
}

function TournamentCommandCenter({ tournament, onNavigate, onDone }: {
  tournament: AdminFocusTournament;
  onNavigate: (section: AdminSection, kind?: AdminIntentKind, targetId?: string) => void;
  onDone: (message: string) => void;
}) {
  const workflow = deriveAdminWorkflow(tournament);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const activePlayers = tournament.registrationCounts.registered + tournament.registrationCounts.checked_in + tournament.registrationCounts.played;
  const checkedIn = tournament.registrationCounts.checked_in + tournament.registrationCounts.played;

  async function notifyPlayers() {
    setSaving(true); setError(null);
    try {
      const result = await post<{ sentCount: number; failedCount: number }>(`/admin/tournaments/${tournament.id}/notify`);
      onDone(`Напоминание отправлено: ${result.sentCount}, ошибок: ${result.failedCount}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отправить напоминание'); }
    finally { setSaving(false); }
  }

  async function startTournament() {
    if (!window.confirm(`Начать «${tournament.title}»?\n\nПришли: ${checkedIn}. Рассадка опубликована: да. Поздняя регистрация останется открытой.`)) return;
    setSaving(true); setError(null);
    try {
      await post(`/admin/tournaments/${tournament.id}`, { status: 'ACTIVE' }, 'PATCH');
      onDone('Турнир запущен, поздняя регистрация доступна');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось начать турнир'); }
    finally { setSaving(false); }
  }

  function primaryAction() {
    if (workflow.stage === 'CHECK_IN') return setCheckInOpen(true);
    if (workflow.stage === 'SEATING' || workflow.stage === 'PUBLISH') return onNavigate('seating', 'seating', tournament.id);
    if (workflow.stage === 'START') return void startTournament();
    if (workflow.stage === 'RESULTS' || workflow.stage === 'POINTS') return onNavigate('tournaments', 'results', tournament.id);
    if (workflow.stage === 'DONE') return onNavigate('tournaments', 'openTournament', tournament.id);
    return onNavigate('tournaments', 'participants', tournament.id);
  }

  return <section className="tournament-command-center">
    <header className="command-head">
      <div className="command-date"><strong>{tournamentDate(tournament.startsAt).day}</strong><span>{tournamentDate(tournament.startsAt).month}</span></div>
      <div className="command-title"><span>{tournament.season.name} · {tournamentDate(tournament.startsAt).full}</span><h2>{tournament.title}</h2><p>{tournament.location || 'Место не указано'}</p></div>
      <Status value={tournament.status} />
    </header>
    <ol className="workflow-steps" aria-label={`Выполнено этапов: ${workflow.completedSteps} из ${workflow.steps.length}`}>
      {workflow.steps.map((step, index) => <li key={step.id} className={step.state}><span>{step.state === 'done' ? <CheckCircle2 /> : index + 1}</span><small>{step.label}</small></li>)}
    </ol>
    <div className="command-body">
      <div className="next-admin-action">
        <span className={`stage-icon stage-${workflow.stage.toLowerCase()}`}>{workflow.stage === 'CHECK_IN' ? <ClipboardCheck /> : workflow.stage === 'SEATING' || workflow.stage === 'PUBLISH' ? <Armchair /> : workflow.stage === 'START' ? <Play /> : workflow.stage === 'RESULTS' || workflow.stage === 'POINTS' ? <Medal /> : <CheckCircle2 />}</span>
        <div><small>СЛЕДУЮЩИЙ ШАГ</small><h3>{workflow.title}</h3><p>{workflow.hint}</p></div>
      </div>
      <div className="command-metrics">
        <article><span>Заявки</span><strong>{activePlayers}<small> / {tournament.capacity}</small></strong></article>
        <article><span>Пришли</span><strong>{checkedIn}</strong></article>
        <article><span>Рассажены</span><strong>{tournament._count.seats}</strong></article>
        <article><span>Очки</span><strong>{tournament._count.pointBatches ? 'Готово' : 'Нет'}</strong></article>
      </div>
    </div>
    {error && <div className="form-error command-error">{error}</div>}
    <footer className="command-actions">
      <button className="button primary command-primary" disabled={saving} onClick={primaryAction}>{workflow.stage === 'START' ? <Play size={17} /> : workflow.stage === 'CHECK_IN' ? <ClipboardCheck size={17} /> : workflow.stage === 'SEATING' || workflow.stage === 'PUBLISH' ? <Armchair size={17} /> : workflow.stage === 'RESULTS' || workflow.stage === 'POINTS' ? <Medal size={17} /> : <ChevronRight size={17} />}{saving ? 'Выполняем…' : workflow.action}</button>
      {tournament.status === 'UPCOMING' && <button className="button secondary" disabled={saving} onClick={() => void notifyPlayers()}><Bell size={16} />{tournament._count.notifications ? 'Повторить напоминание' : 'Напомнить игрокам'}</button>}
      <button className="button ghost" onClick={() => onNavigate('tournaments', 'openTournament', tournament.id)}>Все параметры <ChevronRight size={15} /></button>
    </footer>
    {checkInOpen && <CheckInModal tournamentId={tournament.id} onClose={(changed) => { setCheckInOpen(false); if (changed) onDone('Чек-ин обновлён'); }} />}
  </section>;
}

function CheckInModal({ tournamentId, onClose }: { tournamentId: string; onClose: (changed: boolean) => void }) {
  const [details, setDetails] = useState<TournamentDetails | null>(null);
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const load = useCallback(async () => {
    try { setDetails(await api<TournamentDetails>(`/admin/tournaments/${encodeURIComponent(tournamentId)}`)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть чек-ин'); }
  }, [tournamentId]);
  useEffect(() => { void load(); }, [load]);
  const registrations = (details?.registrations ?? []).filter((registration) => ['REGISTERED', 'CHECKED_IN', 'PLAYED'].includes(registration.status) && playerLabel(registration.user).toLowerCase().includes(query.toLowerCase()));
  const present = details?.registrations.filter((registration) => registration.status === 'CHECKED_IN' || registration.status === 'PLAYED').length ?? 0;

  async function checkIn(registration: Registration) {
    if (registration.status !== 'REGISTERED') return;
    if (!window.confirm(`Фишки уже выданы игроку ${playerLabel(registration.user)}?\n\nПосле подтверждения чек-ин отменить нельзя.`)) return;
    setSavingId(registration.id); setError(null);
    try {
      await post(`/admin/registrations/${registration.id}`, { status: 'CHECKED_IN' }, 'PATCH');
      await load();
      setChanged(true);
      setNotice(`${playerLabel(registration.user)}: чек-ин зафиксирован`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить отметку'); }
    finally { setSavingId(null); }
  }

  return <Modal title="Быстрый чек-ин" onClose={() => onClose(changed)}><div className="checkin-panel">
    <div className="checkin-summary"><span><ClipboardCheck /></span><div><strong>{present} пришли</strong><small>из {details?.participantCount ?? 0} участников основного списка</small></div></div>
    <div className="players-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или @username" /></div>
    {notice && <div className="checkin-inline-notice"><CheckCircle2 size={15} />{notice}</div>}
    {error && <div className="form-error">{error}</div>}
    {!details ? <Loading label="Загружаем список…" /> : <div className="checkin-list">{registrations.map((registration) => {
      const isPresent = registration.status === 'CHECKED_IN' || registration.status === 'PLAYED';
      return <button key={registration.id} className={isPresent ? 'present' : ''} disabled={savingId === registration.id || isPresent} onClick={() => void checkIn(registration)}><Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} size="sm" /><span><strong>{playerLabel(registration.user)}</strong><small>{registration.status === 'PLAYED' ? 'Участие зафиксировано' : isPresent ? 'Чек-ин зафиксирован' : 'Сначала выдайте фишки'}</small></span><i>{isPresent ? <CheckCircle2 /> : 'Подтвердить'}</i></button>})}{!registrations.length && <Empty icon={<Users />} title="Никого не найдено" text="Проверьте строку поиска" />}</div>}
    <div className="checkin-note"><ShieldCheck size={15} /><span><strong>Сначала выдайте игроку фишки.</strong> После подтверждения чек-ин отменить нельзя. Каждая отметка записывается в аудит.</span></div>
  </div></Modal>;
}

function PlayersTab({ users, tags, reasonPresets, intent, onDone }: { users: AdminUser[]; tags: PlayerTag[]; reasonPresets: ReasonPreset[]; intent: AdminIntent; onDone: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'active30' | 'never'>('all');
  const [accessFilter, setAccessFilter] = useState<'all' | 'active' | 'none'>('all');
  const [minPoints, setMinPoints] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const [detail, setDetail] = useState<AdminUserDetails | null>(null);
  const [detailTab, setDetailTab] = useState<'balance' | 'history' | 'notes' | 'access'>('balance');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'award' | 'deduct'>('award');
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('Участие в турнире');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [invite, setInvite] = useState<BrowserInviteResult | null>(null);
  const [note, setNote] = useState('');
  const [tagId, setTagId] = useState('');
  const [reversing, setReversing] = useState<PointTransaction | null>(null);
  const [reversalReason, setReversalReason] = useState('Отмена ошибочной операции');
  const detailRequest = useRef(0);

  const loadDetail = useCallback(async (userId: string, clear = false) => {
    if (!userId) return setDetail(null);
    const request = ++detailRequest.current;
    if (clear) setDetail(null);
    setLoading(true);
    try {
      const next = await api<AdminUserDetails>(`/admin/users/${encodeURIComponent(userId)}`);
      if (detailRequest.current === request) { setDetail(next); setNote(next.adminNote ?? ''); }
    } catch (cause) {
      if (detailRequest.current === request) setFormError(cause instanceof Error ? cause.message : 'Не удалось открыть карточку игрока');
    } finally {
      if (detailRequest.current === request) setLoading(false);
    }
  }, []);
  useEffect(() => { setInvite(null); setFormError(null); void loadDetail(selectedId, true); }, [selectedId, loadDetail]);
  useEffect(() => {
    if (intent?.kind === 'points') setDetailTab('balance');
    if (intent?.kind === 'invite') setDetailTab('access');
  }, [intent?.nonce, intent?.kind]);

  const filtered = users.filter((item) => {
    const matchesSearch = `${item.firstName} ${item.lastName ?? ''} ${item.username ?? ''} ${item.nickname ?? ''} ${item.telegramId} ${item.phoneNumber ?? ''}`.toLowerCase().includes(query.toLowerCase());
    const matchesTag = !tagFilter || item.tags.some((tag) => tag.id === tagFilter);
    const lastPlayed = item.lastPlayedAt ? new Date(item.lastPlayedAt).getTime() : 0;
    const matchesActivity = activityFilter === 'all' || (activityFilter === 'never' ? !lastPlayed : lastPlayed >= Date.now() - 30 * 86_400_000);
    const matchesAccess = accessFilter === 'all' || (accessFilter === 'active' ? (item._count?.browserSessions ?? 0) > 0 : (item._count?.browserSessions ?? 0) === 0);
    const matchesPoints = !minPoints || item.points >= Number(minPoints);
    return matchesSearch && matchesTag && matchesActivity && matchesAccess && matchesPoints;
  });
  const numericAmount = Math.max(0, Number(amount) || 0);
  const signedAmount = mode === 'award' ? numericAmount : -numericAmount;
  const projected = (detail?.points ?? 0) + signedAmount;

  async function changePoints(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !numericAmount || projected < 0) return;
    setSaving(true); setFormError(null);
    try {
      await post('/admin/points', { userId: detail.id, amount: signedAmount, reason, idempotencyKey: requestKey });
      setRequestKey(crypto.randomUUID());
      await loadDetail(detail.id);
      onDone(`${signedAmount > 0 ? 'Начислено' : 'Списано'} ${points(Math.abs(signedAmount))} PTS`);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось изменить баланс'); }
    finally { setSaving(false); }
  }

  async function createInvite() {
    if (!detail) return;
    setSaving(true); setFormError(null); setInvite(null);
    try {
      const result = await post<BrowserInviteResult>('/admin/browser-access/invites', { userId: detail.id });
      setInvite(result); onDone('Одноразовая ссылка создана на 30 минут');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось создать ссылку'); }
    finally { setSaving(false); }
  }
  async function revoke(sessionId: string) {
    setSaving(true); setFormError(null);
    try {
      await post(`/admin/browser-access/sessions/${sessionId}/revoke`);
      await loadDetail(selectedId); onDone('Браузерный доступ отозван');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось отозвать доступ'); }
    finally { setSaving(false); }
  }
  async function saveNote() {
    if (!detail) return;
    setSaving(true); setFormError(null);
    try { await post(`/admin/users/${detail.id}/note`, { note: note.trim() || null }, 'PATCH'); await loadDetail(detail.id); onDone('Приватная заметка сохранена'); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось сохранить заметку'); }
    finally { setSaving(false); }
  }
  async function addTag() {
    if (!detail || !tagId) return;
    setSaving(true); setFormError(null);
    try { await post(`/admin/users/${detail.id}/tags`, { tagId }); setTagId(''); await loadDetail(detail.id); onDone('Тег добавлен игроку'); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось добавить тег'); }
    finally { setSaving(false); }
  }
  async function removeTag(id: string) {
    if (!detail) return;
    setSaving(true); setFormError(null);
    try { await post(`/admin/users/${detail.id}/tags/${id}`, undefined, 'DELETE'); await loadDetail(detail.id); onDone('Тег удалён у игрока'); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось удалить тег'); }
    finally { setSaving(false); }
  }
  async function reverseTransaction() {
    if (!reversing) return;
    setSaving(true); setFormError(null);
    try { await post(`/admin/points/${reversing.id}/reverse`, { reason: reversalReason, idempotencyKey: crypto.randomUUID() }); setReversing(null); await loadDetail(selectedId); onDone('Операция безопасно отменена встречной проводкой'); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось отменить операцию'); }
    finally { setSaving(false); }
  }

  return <div className="admin-view">
    <AdminHeading eyebrow="УЧАСТНИКИ КЛУБА" title="Игроки" text="Баланс, история и доступ конкретного пользователя в одной карточке" />
    <div className="players-workspace">
      <aside className="players-panel">
        <div className="players-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, username, телефон или ID" /><button className={filtersOpen ? 'active' : ''} onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Расширенные фильтры"><Filter size={15} /></button></div>
        {filtersOpen && <div className="advanced-player-filters">
          <label>Тег<select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Все теги</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label>Активность<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}><option value="all">Любая</option><option value="active30">Играл за 30 дней</option><option value="never">Без игр</option></select></label>
          <label>Доступ<select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value as typeof accessFilter)}><option value="all">Любой</option><option value="active">Есть браузерная сессия</option><option value="none">Нет браузерной сессии</option></select></label>
          <label>Минимум PTS<input type="number" min="0" value={minPoints} onChange={(event) => setMinPoints(event.target.value)} placeholder="0" /></label>
          <button onClick={() => { setTagFilter(''); setActivityFilter('all'); setAccessFilter('all'); setMinPoints(''); }}><RotateCcw size={13} />Сбросить</button>
        </div>}
        <div className="players-count">Найдено: {filtered.length}</div>
        <div className="players-list">{filtered.map((item, index) => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><span className="player-rank">#{users.indexOf(item) + 1 || index + 1}</span><Avatar firstName={item.firstName} lastName={item.lastName} size="sm" /><div><strong>{playerLabel(item)}</strong><small>{item.phoneNumber ? `☎ ${item.phoneNumber}` : `ID ${item.telegramId}`} · {item._count?.results ?? 0} игр</small><span className="mini-tags">{item.tags.slice(0, 2).map((tag) => <i key={tag.id} style={{ '--tag-color': tag.color } as CSSProperties}>{tag.name}</i>)}</span></div><b>{points(item.points)}<small> PTS</small></b></button>)}{!filtered.length && <Empty icon={<Search />} title="Игроки не найдены" text="Попробуйте другой запрос или сбросьте фильтры" />}</div>
      </aside>
      <section className="player-detail">
        {formError && !detail && !loading && <div className="form-error">{formError}</div>}
        {loading && !detail ? <Loading label="Открываем карточку…" /> : detail ? <>
          <header className="player-detail-head"><Avatar firstName={detail.firstName} lastName={detail.lastName} photoUrl={detail.photoUrl} size="lg" /><div><span>{detail.role === 'ADMIN' ? 'АДМИНИСТРАТОР' : 'ИГРОК'}</span><h2>{playerLabel(detail)}</h2><p>{detail.firstName} {detail.lastName ?? ''} · Telegram ID {detail.telegramId}{detail.phoneNumber ? ` · ${detail.phoneNumber}` : ' · телефон не передан'}</p></div><strong>{points(detail.points)}<small> PTS</small></strong></header>
          <div className="player-detail-tabs"><button className={detailTab === 'balance' ? 'active' : ''} onClick={() => setDetailTab('balance')}><Coins />Баланс</button><button className={detailTab === 'history' ? 'active' : ''} onClick={() => setDetailTab('history')}><Medal />История</button><button className={detailTab === 'notes' ? 'active' : ''} onClick={() => setDetailTab('notes')}><NotebookPen />Заметки</button><button className={detailTab === 'access' ? 'active' : ''} onClick={() => setDetailTab('access')}><KeyRound />Доступ</button></div>
          {detailTab === 'balance' && <form className="player-points-editor" onSubmit={changePoints}>
            <div className="point-mode"><button type="button" className={mode === 'award' ? 'active award' : ''} onClick={() => setMode('award')}>+ Начислить</button><button type="button" className={mode === 'deduct' ? 'active deduct' : ''} onClick={() => setMode('deduct')}>− Списать</button></div>
            <div className="reason-preset-chips">{reasonPresets.filter((preset) => preset.isActive && (preset.kind === 'BOTH' || preset.kind === (mode === 'award' ? 'AWARD' : 'DEDUCTION'))).map((preset) => <button type="button" key={preset.id} onClick={() => { setReason(preset.reason); if (preset.defaultAmount) setAmount(String(Math.abs(preset.defaultAmount))); }}>{preset.label}</button>)}</div>
            <div className="form-row"><label>Количество PTS<input type="number" min="1" max="100000" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label>Причина<input list="player-point-reasons" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={160} required /><datalist id="player-point-reasons"><option value="Участие в турнире" /><option value="Призовое место" /><option value="Бонус клуба" /><option value="Корректировка результата" /><option value="Нарушение регламента" /></datalist></label></div>
            <div className={`balance-preview ${projected < 0 ? 'invalid' : ''}`}><span>Баланс после операции</span><strong>{points(projected)} PTS</strong></div>
            {formError && <div className="form-error">{formError}</div>}
            <button className={`button wide ${mode === 'award' ? 'primary' : 'deduct-button'}`} disabled={saving || !numericAmount || projected < 0}><Save size={17} />{saving ? 'Сохраняем…' : mode === 'award' ? 'Начислить очки' : 'Списать очки'}</button>
          </form>}
          {detailTab === 'history' && <div className="player-history-grid"><section><h3>Операции с очками</h3><div className="compact-audit">{detail.pointTransactions.map((entry) => <article className={entry.reversalOfId ? 'reversal' : entry.reversedBy ? 'reversed' : ''} key={entry.id}><span className={entry.amount > 0 ? 'award' : 'deduct'}>{entry.amount > 0 ? '+' : ''}{points(entry.amount)}</span><div><strong>{entry.reason}</strong><small>{tournamentDate(entry.createdAt).full} · {entry.createdBy.firstName}{entry.batch?.tournament ? ` · ${entry.batch.tournament.title}` : ''}</small>{entry.reversedBy && <em>Операция отменена</em>}{entry.reversalOfId && <em>Встречная проводка</em>}</div><b>{points(entry.balanceAfter)}</b>{!entry.reversalOfId && !entry.reversedBy && entry.season.isActive && <button className="reverse-action" onClick={() => { setReversing(entry); setReversalReason('Отмена ошибочной операции'); }} title="Отменить операцию"><RotateCcw size={13} /></button>}</article>)}{!detail.pointTransactions.length && <Empty icon={<Coins />} title="Операций нет" text="История пока пуста" />}</div></section><section><h3>Последние турниры</h3><div className="player-games-list">{detail.results.map((result) => <article key={result.id}><span>#{result.place}</span><div><strong>{result.tournament.title}</strong><small>{tournamentDate(result.tournament.startsAt).full}</small></div><Status value={result.tournament.status} /></article>)}{!detail.results.length && <Empty icon={<Medal />} title="Игр пока нет" text="Результаты появятся после турнира" />}</div></section></div>}
          {detailTab === 'notes' && <div className="player-notes-panel"><section><div><h3>Приватная заметка</h3><p>Видна только администраторам и попадает в аудит изменений.</p></div><textarea rows={7} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например: предпочитает вечерние игры, связаться перед финалом…" /><small>{note.length}/2000</small><button className="button primary" disabled={saving} onClick={() => void saveNote()}><Save size={16} />Сохранить заметку</button></section><section><div><h3>Теги игрока</h3><p>Используйте теги для поиска и внутренних групп.</p></div><div className="player-tag-list">{detail.tags.map((tag) => <span key={tag.id} style={{ '--tag-color': tag.color } as CSSProperties}>{tag.name}<button onClick={() => void removeTag(tag.id)} aria-label={`Удалить тег ${tag.name}`}><X size={12} /></button></span>)}</div><div className="tag-assign"><select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">Выберите тег</option>{tags.filter((tag) => !detail.tags.some((assigned) => assigned.id === tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button className="button secondary" disabled={!tagId || saving} onClick={() => void addTag()}><Plus size={15} />Добавить</button></div></section></div>}
          {detailTab === 'access' && <div className="player-access-panel">
            <div className="personal-invite"><div><h3>Вход из обычного браузера</h3><p>Создайте одноразовую ссылку лично для этого игрока.</p></div><button className="button primary" onClick={() => void createInvite()} disabled={saving}><KeyRound size={16} />Создать ссылку</button></div>
            {formError && <div className="form-error">{formError}</div>}
            {invite && <InviteResult invite={invite} onCopied={onDone} />}
            <h3>Сессии пользователя</h3><SessionList sessions={detail.browserSessions} onRevoke={revoke} />
          </div>}
        </> : <Empty icon={<UserRound />} title="Выберите игрока" text="Карточка откроется справа" />}
      </section>
    </div>
    {reversing && <Modal title="Отменить операцию" onClose={() => setReversing(null)}><div className="admin-form"><div className="destructive-note"><CircleAlert size={16} /><span>Исходная запись останется в журнале. Сервер создаст встречную проводку на {points(-reversing.amount)} PTS — это безопасно для аудита.</span></div><label>Причина отмены<input minLength={3} maxLength={160} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} /></label>{formError && <div className="form-error">{formError}</div>}<button className="button deduct-button wide" disabled={saving || reversalReason.trim().length < 3} onClick={() => void reverseTransaction()}><RotateCcw size={16} />{saving ? 'Отменяем…' : 'Подтвердить отмену'}</button></div></Modal>}
  </div>;
}

function TournamentsTab({ seasons, tournaments, templates, intent, onDone, onOpenMain }: { seasons: Season[]; tournaments: Tournament[]; templates: TournamentTemplate[]; intent: AdminIntent; onDone: (message: string) => void; onOpenMain: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | Tournament['status']>('ALL');
  const [selectedId, setSelectedId] = useState(tournaments.find((item) => item.status === 'UPCOMING')?.id ?? tournaments[0]?.id ?? '');
  const [detail, setDetail] = useState<TournamentDetails | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateDefault, setTemplateDefault] = useState<TournamentTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  const loadDetail = useCallback(async (id: string, clear = false) => {
    if (!id) return setDetail(null);
    const request = ++detailRequest.current;
    if (clear) setDetail(null);
    setLoadingDetail(true);
    try {
      const next = await api<TournamentDetails>(`/admin/tournaments/${id}`);
      if (detailRequest.current === request) setDetail(next);
    } catch (cause) {
      if (detailRequest.current === request) setFormError(cause instanceof Error ? cause.message : 'Не удалось открыть турнир');
    } finally {
      if (detailRequest.current === request) setLoadingDetail(false);
    }
  }, []);
  useEffect(() => { setFormError(null); void loadDetail(selectedId, true); }, [selectedId, loadDetail]);
  useEffect(() => {
    if (intent?.kind === 'newTournament') { setFormError(null); setCreateOpen(true); }
    if ((intent?.kind === 'results' || intent?.kind === 'participants' || intent?.kind === 'seating') && intent.targetId) onOpenMain(intent.targetId);
    if (intent?.kind === 'openTournament' && intent.targetId) setSelectedId(intent.targetId);
  }, [intent?.nonce, intent?.kind, intent?.targetId]);

  const filtered = tournaments.filter((item) => (filter === 'ALL' || item.status === filter) && `${item.title} ${item.location ?? ''}`.toLowerCase().includes(query.toLowerCase()));

  async function createTournament(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      const created = await post<Tournament>('/admin/tournaments', tournamentPayload(form));
      setCreateOpen(false); setSelectedId(created.id); onDone('Турнир создан');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось создать турнир'); }
    finally { setSaving(false); }
  }
  async function updateTournament(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return;
    setSaving(true); setFormError(null);
    try {
      const updated = await post<TournamentDetails>(`/admin/tournaments/${detail.id}`, tournamentPayload(new FormData(event.currentTarget)), 'PATCH');
      setDetail({ ...detail, ...updated }); onDone('Изменения турнира сохранены');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось сохранить турнир'); }
    finally { setSaving(false); }
  }
  async function removeTournament() {
    if (!detail || !window.confirm(`Удалить турнир «${detail.title}»? Это действие нельзя отменить.`)) return;
    try {
      await post(`/admin/tournaments/${detail.id}`, undefined, 'DELETE');
      const next = tournaments.find((item) => item.id !== detail.id);
      setSelectedId(next?.id ?? ''); setDetail(null); onDone('Турнир удалён');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось удалить турнир'); }
  }
  async function notify() {
    if (!detail) return;
    setSaving(true);
    try { const result = await post<{ sentCount: number; failedCount: number }>(`/admin/tournaments/${detail.id}/notify`); onDone(`Отправлено: ${result.sentCount}, ошибок: ${result.failedCount}`); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Не удалось отправить уведомление'); }
    finally { setSaving(false); }
  }
  return <div className="admin-view">
    <AdminHeading eyebrow="ИГРОВОЙ КАЛЕНДАРЬ" title="Турниры" text="Создание, настройки, шаблоны и архив. Проведение текущей игры вынесено в MAIN." actions={<><button className="button secondary" onClick={() => setTemplatesOpen(true)}><FileStack size={17} />Шаблоны</button><button className="button primary" onClick={() => { setTemplateDefault(null); setFormError(null); setCreateOpen(true); }}><Plus size={17} />Новый турнир</button></>} />
    <div className="tournament-workspace">
      <aside className="tournament-panel">
        <div className="players-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или место" /></div>
        <div className="compact-filter"><button className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>Все</button><button className={filter === 'UPCOMING' ? 'active' : ''} onClick={() => setFilter('UPCOMING')}>Скоро</button><button className={filter === 'FINISHED' ? 'active' : ''} onClick={() => setFilter('FINISHED')}>Готово</button></div>
        <div className="tournament-list">{filtered.map((item) => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><div className="mini-date"><strong>{tournamentDate(item.startsAt).day}</strong><span>{tournamentDate(item.startsAt).month}</span></div><div><strong>{item.title}</strong><small>{tournamentDate(item.startsAt).time} · {item.location || 'Без места'}</small></div><Status value={item.status} /></button>)}{!filtered.length && <Empty icon={<Search />} title="Турниры не найдены" text="Измените поиск или фильтр" />}</div>
      </aside>
      <section className="tournament-detail">{formError && !detail && !loadingDetail && <div className="form-error">{formError}</div>}{loadingDetail && !detail ? <Loading label="Открываем турнир…" /> : detail ? <>
        <header className="tournament-detail-head"><div><Status value={detail.status} /><h2>{detail.title}</h2><p>{tournamentDate(detail.startsAt).full} · {detail.location || 'Место не указано'}</p></div><div><button className="button primary" onClick={() => onOpenMain(detail.id)}><LayoutDashboard size={16} />Открыть в MAIN</button><button className="button secondary" disabled={saving || detail.status !== 'UPCOMING'} onClick={() => void notify()}><Bell size={16} />Уведомить</button><button className="icon-button delete-tournament" title="Удалить турнир" onClick={() => void removeTournament()}><Trash2 size={16} /></button></div></header>
        <div className="tournament-main-handoff"><LayoutDashboard /><div><strong>Операционная работа находится в MAIN</strong><p>Чек-ин, рассадка, карточки игроков, ребаи, выбывания, результаты, PTS и таймер доступны в едином рабочем пространстве.</p></div><button className="button secondary" onClick={() => onOpenMain(detail.id)}>Перейти</button></div>
        <form key={detail.id} className="admin-form tournament-edit-form" onSubmit={updateTournament}>
          <label>Название<input name="title" required minLength={2} defaultValue={detail.title} /></label>
          <div className="form-row"><label>Сезон<select name="seasonId" required defaultValue={detail.seasonId}>{seasons.map((season) => <option value={season.id} key={season.id}>{season.name}</option>)}</select></label><label>Дата и время<input name="startsAt" type="datetime-local" required defaultValue={dateTimeInput(detail.startsAt)} /></label></div>
          <div className="form-row"><label>Место<input name="location" defaultValue={detail.location ?? ''} /></label><label>Статус<select name="status" defaultValue={detail.status}><option value="UPCOMING">Скоро</option><option value="ACTIVE">Идёт</option><option value="FINISHED">Завершён</option><option value="CANCELLED">Отменён</option></select></label></div>
          <div className="form-row"><label>Максимум игроков<input name="capacity" type="number" min="2" max="1000" defaultValue={detail.capacity} /></label><label>Заявлено участников<input value={detail.participantCount} readOnly title="Считается автоматически по заявкам" /></label></div>
          <div className="form-row"><label>Дедлайн регистрации<input name="registrationDeadline" type="datetime-local" defaultValue={detail.registrationDeadline ? dateTimeInput(detail.registrationDeadline) : ''} /></label><label className="checkbox registration-toggle"><input type="checkbox" name="registrationClosed" defaultChecked={detail.registrationClosed} />Регистрация закрыта вручную</label></div>
          <input type="hidden" name="participantCount" value={detail.participantCount} />
          <label>Описание<textarea name="description" rows={4} defaultValue={detail.description ?? ''} /></label>
          {formError && <div className="form-error">{formError}</div>}
          <button className="button primary wide" disabled={saving}><Save size={17} />{saving ? 'Сохраняем…' : 'Сохранить изменения'}</button>
        </form>
      </> : <Empty icon={<CalendarDays />} title="Выберите турнир" text="Информация откроется справа" />}</section>
    </div>
    {createOpen && <Modal title="Новый турнир" onClose={() => { setCreateOpen(false); setTemplateDefault(null); setFormError(null); }}><form key={templateDefault?.id ?? 'blank'} className="admin-form" onSubmit={createTournament}>
      {templates.filter((item) => item.isActive).length > 0 && <label>Заполнить из шаблона<select value={templateDefault?.id ?? ''} onChange={(event) => setTemplateDefault(templates.find((item) => item.id === event.target.value) ?? null)}><option value="">Без шаблона</option>{templates.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      <label>Название<input name="title" required minLength={2} defaultValue={templateDefault?.title ?? ''} placeholder="Пятничный турнир" /></label>
      <div className="form-row"><label>Сезон<select name="seasonId" required defaultValue={seasons.find((season) => season.isActive)?.id}>{seasons.map((season) => <option value={season.id} key={season.id}>{season.name}</option>)}</select></label><label>Дата и время<input name="startsAt" type="datetime-local" required /></label></div>
      <div className="form-row"><label>Место<input name="location" defaultValue={templateDefault?.location ?? ''} placeholder="Poker Club" /></label><label>Максимум игроков<input name="capacity" type="number" min="2" defaultValue={templateDefault?.capacity ?? 48} /></label></div>
      <input type="hidden" name="participantCount" value="0" /><input type="hidden" name="status" value="UPCOMING" />
      <input type="hidden" name="registrationClosed" value="false" />
      <label>Описание<textarea name="description" rows={3} defaultValue={templateDefault?.description ?? ''} placeholder="Краткое описание игры" /></label>
      {formError && <div className="form-error">{formError}</div>}
      <button className="button primary wide" disabled={saving}><Save size={17} />{saving ? 'Сохраняем…' : 'Создать турнир'}</button>
    </form></Modal>}
    {templatesOpen && <TemplatesManager templates={templates} onClose={() => setTemplatesOpen(false)} onDone={onDone} onUse={(template) => { setTemplatesOpen(false); setTemplateDefault(template); setCreateOpen(true); }} />}
  </div>;
}

function ParticipantsEditor({ details, users, selectedId, setSelectedId, saving, error, onAdd, onStatus }: {
  details: TournamentDetails; users: AdminUser[]; selectedId: string; setSelectedId: (id: string) => void; saving: boolean; error: string | null;
  onAdd: () => Promise<void>; onStatus: (id: string, status: TournamentRegistrationStatus) => Promise<void>;
}) {
  const occupied = details.registrations.filter((item) => ['REGISTERED', 'CHECKED_IN', 'PLAYED'].includes(item.status));
  const waitlist = details.registrations.filter((item) => item.status === 'WAITLISTED');
  const cancelled = details.registrations.filter((item) => item.status === 'CANCELLED');
  const available = users.filter((user) => !details.registrations.some((item) => item.user.id === user.id && item.status !== 'CANCELLED'));
  return <div className="participants-editor">
    <div className="registration-summary"><article><UserCheck /><strong>{occupied.length}</strong><span>в основном списке</span></article><article><ListChecks /><strong>{waitlist.length}</strong><span>в листе ожидания</span></article><article><Users /><strong>{Math.max(0, details.capacity - occupied.length)}</strong><span>свободных мест</span></article></div>
    <div className="add-player"><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Добавить игрока</option>{available.map((user) => <option value={user.id} key={user.id}>{playerLabel(user)}</option>)}</select><button className="button secondary" disabled={!selectedId || saving} onClick={() => void onAdd()}><Plus size={17} />Добавить</button></div>
    {error && <div className="form-error">{error}</div>}
    <div className="registration-groups">
      <RegistrationGroup title="Основной список" items={occupied} saving={saving} onStatus={onStatus} />
      <RegistrationGroup title="Лист ожидания" items={waitlist} saving={saving} onStatus={onStatus} ordered />
      {cancelled.length > 0 && <RegistrationGroup title="Отменённые" items={cancelled} saving={saving} onStatus={onStatus} muted />}
    </div>
  </div>;
}

function RegistrationGroup({ title, items, saving, onStatus, ordered = false, muted = false }: { title: string; items: Registration[]; saving: boolean; onStatus: (id: string, status: TournamentRegistrationStatus) => Promise<void>; ordered?: boolean; muted?: boolean }) {
  return <section className={muted ? 'muted' : ''}><h3>{title}<span>{items.length}</span></h3><div>{items.map((registration, index) => {
    const locked = registration.status === 'CHECKED_IN' || registration.status === 'PLAYED';
    return <article key={registration.id}><span className="registration-order">{ordered ? index + 1 : <UserCheck size={15} />}</span><Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} size="sm" /><div><strong>{playerLabel(registration.user)}</strong><small>{registrationStatusLabel(registration.status)} · {tournamentDate(registration.createdAt).full}{locked ? ' · необратимо' : ''}</small></div><select disabled={saving || registration.status === 'PLAYED'} value={registration.status} onChange={(event) => void onStatus(registration.id, event.target.value as TournamentRegistrationStatus)}>{registration.status === 'CHECKED_IN' ? <><option value="CHECKED_IN">Присутствие подтверждено</option><option value="PLAYED">Сыграл</option></> : registration.status === 'PLAYED' ? <option value="PLAYED">Сыграл</option> : <><option value="REGISTERED">В основном списке</option><option value="WAITLISTED">Лист ожидания</option><option value="CHECKED_IN">Пришёл</option><option value="CANCELLED">Отменить</option></>}</select></article>})}{items.length === 0 && <p>Список пуст</p>}</div></section>;
}

function TemplatesManager({ templates, onClose, onDone, onUse }: { templates: TournamentTemplate[]; onClose: () => void; onDone: (message: string) => void; onUse: (template: TournamentTemplate) => void }) {
  const [editing, setEditing] = useState<TournamentTemplate | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function openForm(template: TournamentTemplate | null) { setEditing(template); setError(null); setFormOpen(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get('name'), title: form.get('title'), description: form.get('description') || null, location: form.get('location') || null,
      capacity: Number(form.get('capacity')), recurrenceEnabled: form.get('recurrenceEnabled') === 'on',
      nextStartsAt: form.get('nextStartsAt') ? new Date(String(form.get('nextStartsAt'))).toISOString() : null,
      weeksAhead: Number(form.get('weeksAhead')), isActive: form.get('isActive') === 'on'
    };
    try { await post(editing ? `/admin/tournament-templates/${editing.id}` : '/admin/tournament-templates', payload, editing ? 'PATCH' : 'POST'); setFormOpen(false); onDone(editing ? 'Шаблон обновлён' : 'Шаблон создан'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить шаблон'); }
    finally { setSaving(false); }
  }
  async function remove(template: TournamentTemplate) {
    if (!window.confirm(`Удалить шаблон «${template.name}»? Созданные турниры останутся.`)) return;
    setSaving(true); setError(null);
    try { await post(`/admin/tournament-templates/${template.id}`, undefined, 'DELETE'); onDone('Шаблон удалён'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить шаблон'); }
    finally { setSaving(false); }
  }
  async function generate() {
    setSaving(true); setError(null);
    try { const result = await post<{ created: number }>('/admin/tournament-templates/run'); onDone(`Расписание проверено, создано турниров: ${result.created}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать игры по расписанию'); }
    finally { setSaving(false); }
  }
  return <Modal title="Шаблоны турниров" onClose={onClose}><div className="template-manager"><div className="template-toolbar"><button className="button secondary" disabled={saving} onClick={() => void generate()}><RefreshCw size={16} />Создать по расписанию</button><button className="button primary" onClick={() => openForm(null)}><Plus size={16} />Новый шаблон</button></div>{error && <div className="form-error">{error}</div>}<div className="template-list">{templates.map((template) => <article key={template.id} className={!template.isActive ? 'inactive' : ''}><span><FileStack /></span><div><strong>{template.name}</strong><small>{template.title} · {template.capacity} мест</small><em>{template.recurrenceEnabled ? `Еженедельно, горизонт ${template.weeksAhead} нед.` : 'Ручное использование'} · создано ${template._count.tournaments}</em></div><div><button onClick={() => onUse(template)} title="Создать турнир"><CalendarPlus /></button><button onClick={() => openForm(template)} title="Редактировать"><Edit3 /></button><button className="danger" onClick={() => void remove(template)} title="Удалить"><Trash2 /></button></div></article>)}{templates.length === 0 && <Empty icon={<FileStack />} title="Шаблонов пока нет" text="Сохраните параметры повторяющихся турниров" />}</div></div>{formOpen && <Modal title={editing ? 'Редактировать шаблон' : 'Новый шаблон'} onClose={() => setFormOpen(false)}><form className="admin-form" onSubmit={save}><div className="form-row"><label>Название шаблона<input name="name" required defaultValue={editing?.name ?? ''} placeholder="Пятничная игра" /></label><label>Название турнира<input name="title" required defaultValue={editing?.title ?? ''} placeholder="Пятничный турнир" /></label></div><div className="form-row"><label>Место<input name="location" defaultValue={editing?.location ?? ''} /></label><label>Вместимость<input name="capacity" type="number" min="2" defaultValue={editing?.capacity ?? 48} /></label></div><label>Описание<textarea name="description" rows={3} defaultValue={editing?.description ?? ''} /></label><label className="checkbox"><input name="recurrenceEnabled" type="checkbox" defaultChecked={editing?.recurrenceEnabled ?? false} />Создавать турнир каждую неделю</label><div className="form-row"><label>Первая/следующая игра<input name="nextStartsAt" type="datetime-local" defaultValue={editing?.nextStartsAt ? dateTimeInput(editing.nextStartsAt) : ''} /></label><label>Создавать вперёд, недель<input name="weeksAhead" type="number" min="1" max="12" defaultValue={editing?.weeksAhead ?? 4} /></label></div><label className="checkbox"><input name="isActive" type="checkbox" defaultChecked={editing?.isActive ?? true} />Шаблон активен</label>{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={saving}><Save size={16} />{saving ? 'Сохраняем…' : 'Сохранить шаблон'}</button></form></Modal>}</Modal>;
}

function ResultsEditor({ details, users, onSaved, onDone }: { details: TournamentDetails; users: AdminUser[]; onSaved: () => Promise<void>; onDone: (message: string) => void }) {
  const [entries, setEntries] = useState<AdminUser[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [batchKey, setBatchKey] = useState(() => crypto.randomUUID());
  const [eliminationMode, setEliminationMode] = useState(false);
  const [eliminatedCount, setEliminatedCount] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const draftKey = `poker-results-draft:${details.id}`;
  useEffect(() => {
    let next = details.results.map((result) => users.find((user) => user.id === result.userId)).filter((user): user is AdminUser => Boolean(user));
    let restoredEliminated = 0;
    let restoredScores: Record<string, string> | null = null;
    if (!details.results.length) {
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as { ids?: string[]; eliminatedCount?: number; scores?: Record<string, string> } | null;
        if (draft?.ids?.length) {
          const restored = draft.ids.map((id) => users.find((user) => user.id === id)).filter((user): user is AdminUser => Boolean(user));
          if (restored.length === draft.ids.length) {
            next = restored;
            restoredEliminated = Math.min(Number(draft.eliminatedCount) || 0, Math.max(0, restored.length - 1));
            restoredScores = draft.scores ?? null;
          }
        }
      } catch { localStorage.removeItem(draftKey); }
    } else {
      localStorage.removeItem(draftKey);
    }
    setEntries(next);
    setEliminatedCount(restoredEliminated);
    setScores(Object.fromEntries(next.map((user, index) => [user.id, restoredScores?.[user.id] ?? String(defaultTournamentScore(index))])));
    setDraftReady(true);
  }, [details.id, details.results, users, draftKey]);
  useEffect(() => {
    if (!draftReady || details.results.length) return;
    if (entries.length) localStorage.setItem(draftKey, JSON.stringify({ ids: entries.map((entry) => entry.id), eliminatedCount, scores }));
    else localStorage.removeItem(draftKey);
  }, [details.results.length, draftKey, draftReady, eliminatedCount, entries, scores]);
  const available = useMemo(() => users.filter((user) => !entries.some((entry) => entry.id === user.id)), [users, entries]);
  const arrivals = useMemo(() => details.registrations
    .filter((registration) => registration.status === 'CHECKED_IN' || registration.status === 'PLAYED')
    .map((registration) => users.find((user) => user.id === registration.user.id))
    .filter((user): user is AdminUser => Boolean(user)), [details.registrations, users]);
  const placesSaved = details.results.length === entries.length && details.results.every((result, index) => result.userId === entries[index]?.id && result.place === index + 1);
  function setOrderedEntries(next: AdminUser[]) {
    setEntries(next);
    setScores(Object.fromEntries(next.map((user, index) => [user.id, String(defaultTournamentScore(index))])));
  }
  function move(index: number, direction: -1 | 1) { const next = [...entries]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setOrderedEntries(next); }
  function addArrivals() {
    if (arrivals.length < 2) { setError('Для результатов нужно отметить минимум двух пришедших'); return; }
    if (entries.length && !window.confirm('Заменить текущий черновик списком прошедших чек-ин?')) return;
    setOrderedEntries(arrivals); setEliminatedCount(0); setEliminationMode(true);
    setError(null);
  }
  function eliminate(index: number) {
    const activeCount = entries.length - eliminatedCount;
    if (index >= activeCount || activeCount <= 1) return;
    const next = [...entries];
    const [player] = next.splice(index, 1);
    next.splice(activeCount - 1, 0, player);
    setOrderedEntries(next); setEliminatedCount((count) => count + 1);
  }
  async function save() {
    setSaving(true); setError(null);
    try { await post(`/admin/tournaments/${details.id}/results`, { results: entries.map((user, index) => ({ userId: user.id, place: index + 1 })) }, 'PUT'); await onSaved(); onDone('Места игроков сохранены'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить результаты'); }
    finally { setSaving(false); }
  }
  async function awardAll() {
    const awardEntries = entries.map((user, index) => ({ userId: user.id, amount: Number(scores[user.id] ?? 0), reason: `${details.title}: ${index + 1} место` })).filter((entry) => Number.isInteger(entry.amount) && entry.amount !== 0);
    if (!awardEntries.length || !window.confirm(`Начислить очки ${awardEntries.length} игрокам одной атомарной операцией?`)) return;
    setSaving(true); setError(null);
    try { await post('/admin/points/bulk', { tournamentId: details.id, idempotencyKey: batchKey, note: `Итоги турнира «${details.title}»`, entries: awardEntries }); setBatchKey(crypto.randomUUID()); await onSaved(); onDone(`Пакетно начислены очки: ${awardEntries.length} игрокам`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось начислить очки пакетом'); }
    finally { setSaving(false); }
  }
  return <div className="integrated-results">
    <div className="results-note"><CircleAlert size={17} /><span>Сначала сохраните места. Затем проверьте очки и начислите их одной атомарной операцией — либо всем, либо никому.</span></div>
    {!placesSaved && <div className="results-fast-tools"><div><strong>Быстрое заполнение</strong><small>Черновик автоматически сохраняется в этом браузере</small></div><button className="button secondary" disabled={arrivals.length < 2 || saving} onClick={addArrivals}><UserCheck size={16} />Добавить пришедших ({arrivals.length})</button><button className={`button ghost ${eliminationMode ? 'active' : ''}`} disabled={entries.length < 2} onClick={() => setEliminationMode((value) => !value)}><UserMinus size={16} />Режим выбывания</button></div>}
    <div className="add-player"><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}><option value="">Выберите игрока</option>{available.map((user) => <option value={user.id} key={user.id}>{playerLabel(user)}</option>)}</select><button className="button secondary" disabled={!playerId} onClick={() => { const user = users.find((item) => item.id === playerId); if (user) setOrderedEntries([...entries, user]); setPlayerId(''); }}><Plus size={17} />Добавить</button></div>
    {eliminationMode && entries.length > 1 && !placesSaved && <div className="elimination-hint"><UserMinus size={16} /><span>Нажимайте «Выбыл» по ходу игры. Первый выбывший автоматически получит последнее место. Осталось в игре: <strong>{entries.length - eliminatedCount}</strong>.</span></div>}
    <div className="result-list">{entries.map((user, index) => {
      const eliminated = index >= entries.length - eliminatedCount;
      return <div className={`result-row scoring ${eliminated ? 'eliminated' : ''}`} key={user.id}><span className={`result-place ${index < 3 ? 'podium' : ''}`}>{index + 1}</span><Avatar firstName={user.firstName} lastName={user.lastName} size="sm" /><div><strong>{playerLabel(user)}</strong><small>{eliminated ? 'Место определено выбыванием' : `Причина: «${details.title}: ${index + 1} место»`}</small></div><label><input aria-label={`Очки, ${user.firstName}`} type="number" min="1" max="100000" value={scores[user.id] ?? ''} onChange={(event) => setScores({ ...scores, [user.id]: event.target.value })} /><span>PTS</span></label>{eliminationMode && !placesSaved && !eliminated ? <button className="eliminate-button" disabled={entries.length - eliminatedCount <= 1} onClick={() => eliminate(index)}><UserMinus size={14} />Выбыл</button> : <div className="row-actions"><button onClick={() => move(index, -1)} disabled={index === 0 || placesSaved}><ArrowUp /></button><button onClick={() => move(index, 1)} disabled={index === entries.length - 1 || placesSaved}><ArrowDown /></button><button className="danger" disabled={placesSaved} onClick={() => setOrderedEntries(entries.filter((entry) => entry.id !== user.id))}><X /></button></div>}</div>;
    })}{!entries.length && <Empty icon={<Medal />} title="Добавьте участников" text="Загрузите прошедших чек-ин одним нажатием" />}</div>
    {error && <div className="form-error">{error}</div>}
    <div className="results-actions"><button className="button secondary" disabled={entries.length < 2 || saving || placesSaved} onClick={() => void save()}><Save size={17} />{placesSaved ? 'Места сохранены' : saving ? 'Сохраняем…' : 'Сохранить места'}</button><button className="button primary" disabled={!placesSaved || details.pointBatches.length > 0 || saving || entries.some((entry) => Number(scores[entry.id]) <= 0)} onClick={() => void awardAll()}><Coins size={17} />{details.pointBatches.length > 0 ? 'Очки уже начислены' : 'Начислить всем'}</button></div>
    {details.pointBatches.length > 0 && <div className="batch-history"><strong>Пакеты начислений</strong>{details.pointBatches.map((batch) => <span key={batch.id}>{tournamentDate(batch.createdAt).full} · {batch._count.transactions} операций</span>)}</div>}
  </div>;
}

function SeatingTab({ tournaments, intent, onDone }: { tournaments: Tournament[]; intent: AdminIntent; onDone: (message: string) => void }) {
  const available = tournaments.filter((item) => item.status === 'UPCOMING' || item.status === 'ACTIVE');
  const [tournamentId, setTournamentId] = useState(intent?.kind === 'seating' && intent.targetId ? intent.targetId : available[0]?.id ?? tournaments[0]?.id ?? '');
  const [data, setData] = useState<SeatingData | null>(null);
  const [capacityPerTable, setCapacityPerTable] = useState('8');
  const [tableCount, setTableCount] = useState('');
  const [onlyCheckedIn, setOnlyCheckedIn] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ userId: string; seatId: string | null; label: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) { setData(null); return; }
    setLoading(true); setError(null);
    try {
      const next = await api<SeatingData>(`/admin/tournaments/${encodeURIComponent(id)}/seating`);
      setData(next);
      if (next.tables[0]) setCapacityPerTable(String(next.tables[0].capacity));
      setTableCount(next.tables.length ? String(next.tables.length) : '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить рассадку'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setSelectedPlayer(null); void load(tournamentId); }, [tournamentId, load]);
  useEffect(() => {
    if (intent?.kind === 'seating' && intent.targetId) setTournamentId(intent.targetId);
  }, [intent?.kind, intent?.nonce, intent?.targetId]);

  async function generate() {
    if (!tournamentId) return;
    const replacing = Boolean(data?.tables.length);
    if (replacing && !window.confirm(`${data?.tournament.seatingPublishedAt ? 'Рассадка опубликована. ' : ''}Пересоздать её случайным образом? Ручные перемещения будут заменены.`)) return;
    setSaving(true); setError(null); setSelectedPlayer(null);
    try {
      const next = await post<SeatingData>(`/admin/tournaments/${tournamentId}/seating/generate`, {
        capacityPerTable: Number(capacityPerTable),
        tableCount: tableCount ? Number(tableCount) : undefined,
        onlyCheckedIn,
        force: replacing
      });
      setData(next); setTableCount(String(next.tables.length));
      onDone(`Рассажено ${next.seatedCount} игроков за ${next.tables.length} столами`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сформировать рассадку'); }
    finally { setSaving(false); }
  }

  async function chooseSeat(tableId: string, seatNumber: number, occupant?: SeatingData['tables'][number]['seats'][number]) {
    if (!selectedPlayer) {
      if (occupant) setSelectedPlayer({ userId: occupant.userId, seatId: occupant.id, label: playerLabel(occupant.user) });
      return;
    }
    if (occupant?.userId === selectedPlayer.userId) { setSelectedPlayer(null); return; }
    if (!selectedPlayer.seatId && occupant) { setError('Для нового игрока выберите свободное место'); return; }
    setSaving(true); setError(null);
    try {
      const next = await post<SeatingData>(`/admin/tournaments/${tournamentId}/seating/assign`, { userId: selectedPlayer.userId, tableId, seatNumber });
      setData(next); setSelectedPlayer(null);
      onDone(occupant ? 'Игроки поменяны местами' : 'Место игрока обновлено');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить место'); }
    finally { setSaving(false); }
  }

  async function unseat(seatId: string) {
    setSaving(true); setError(null);
    try {
      const next = await post<SeatingData>(`/admin/tournaments/${tournamentId}/seating/seats/${seatId}`, undefined, 'DELETE');
      setData(next); setSelectedPlayer(null); onDone('Игрок возвращён в список без места');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось освободить место'); }
    finally { setSaving(false); }
  }

  async function publish() {
    if (!data) return;
    if (data.unseated.length && !window.confirm(`${data.unseated.length} игроков пока без места. Всё равно опубликовать рассадку?`)) return;
    setSaving(true); setError(null);
    try {
      const result = await post<{ seating: SeatingData; sentCount: number; failedCount: number }>(`/admin/tournaments/${tournamentId}/seating/publish`);
      setData(result.seating); onDone(`Рассадка опубликована · уведомлено ${result.sentCount}, ошибок ${result.failedCount}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось опубликовать рассадку'); }
    finally { setSaving(false); }
  }

  async function unpublish() {
    setSaving(true); setError(null);
    try { const next = await post<SeatingData>(`/admin/tournaments/${tournamentId}/seating/unpublish`); setData(next); onDone('Рассадка скрыта от игроков'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось скрыть рассадку'); }
    finally { setSaving(false); }
  }

  return <div className="admin-view seating-view">
    <AdminHeading eyebrow="ТУРНИРНЫЙ ДИРЕКТОР" title="Рассадка игроков" text="Автоматическое распределение, ручные перестановки и публикация мест в Telegram" />
    <section className="seating-toolbar">
      <label className="seating-tournament-select">Турнир<select value={tournamentId} onChange={(event) => setTournamentId(event.target.value)}><option value="">Выберите турнир</option>{(available.length ? available : tournaments).map((item) => <option key={item.id} value={item.id}>{item.title} · {tournamentDate(item.startsAt).full}</option>)}</select></label>
      <label>Мест за столом<select value={capacityPerTable} onChange={(event) => setCapacityPerTable(event.target.value)}>{Array.from({ length: 9 }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label>
      <label>Количество столов<input type="number" min="1" max="100" value={tableCount} onChange={(event) => setTableCount(event.target.value)} placeholder="Авто" /></label>
      <label className="seating-check"><input type="checkbox" checked={onlyCheckedIn} onChange={(event) => setOnlyCheckedIn(event.target.checked)} />Только прошедшие чек-ин</label>
      <button className="button primary" disabled={saving || !tournamentId} onClick={() => void generate()}><Shuffle size={17} />{data?.tables.length ? 'Пересобрать' : 'Рассадить'}</button>
    </section>
    {error && <div className="form-error seating-error">{error}</div>}
    {loading && !data ? <Loading label="Открываем зал…" /> : data ? <>
      <div className="seating-summary">
        <article><span><Users /></span><div><small>Игроков с местом</small><strong>{data.seatedCount}<em> / {data.eligibleCount}</em></strong></div></article>
        <article><span><Armchair /></span><div><small>Столов</small><strong>{data.tables.length}</strong></div></article>
        <article className={data.tournament.seatingPublishedAt ? 'published' : ''}><span>{data.tournament.seatingPublishedAt ? <Eye /> : <EyeOff />}</span><div><small>Статус</small><strong>{data.tournament.seatingPublishedAt ? 'Опубликована' : 'Черновик'}</strong></div></article>
        <div className="seating-publish-actions">{data.tournament.seatingPublishedAt ? <button className="button secondary" disabled={saving} onClick={() => void unpublish()}><EyeOff size={16} />Скрыть</button> : <button className="button publish-button" disabled={saving || !data.seatedCount} onClick={() => void publish()}><Eye size={16} />Опубликовать</button>}</div>
      </div>
      {selectedPlayer && <div className="seating-selection"><Armchair size={16} /><span>Выбран <strong>{selectedPlayer.label}</strong>. Нажмите на {selectedPlayer.seatId ? 'любое другое место для переноса или обмена' : 'свободное место'}.</span><button onClick={() => setSelectedPlayer(null)}><X size={15} /></button></div>}
      <div className="poker-room">{data.tables.map((table) => {
        const seats = new Map(table.seats.map((seat) => [seat.seatNumber, seat]));
        return <article className="poker-table-card" key={table.id}>
          <header><div><span>СТОЛ</span><strong>№{table.number}</strong></div><p>{table.seats.length}/{table.capacity} мест</p></header>
          <div className="poker-seat-grid">{Array.from({ length: table.capacity }, (_, index) => index + 1).map((seatNumber) => {
            const seat = seats.get(seatNumber);
            const selected = seat?.userId === selectedPlayer?.userId;
            return <div className={`poker-seat ${seat ? 'occupied' : 'empty'} ${selected ? 'selected' : ''}`} key={seatNumber}>
              <button disabled={saving} onClick={() => void chooseSeat(table.id, seatNumber, seat)}>
                <span>{seatNumber}</span>{seat ? <><Avatar firstName={seat.user.firstName} lastName={seat.user.lastName} photoUrl={seat.user.photoUrl} size="sm" /><strong>{playerLabel(seat.user)}</strong></> : <><i>+</i><small>Свободно</small></>}
              </button>
              {seat && <button className="unseat-button" disabled={saving} onClick={() => void unseat(seat.id)} title="Освободить место"><UserMinus size={12} /></button>}
            </div>;
          })}</div>
        </article>;
      })}</div>
      <section className="unseated-panel"><div className="admin-section-title"><div><h2>Без места</h2><p>Выберите игрока, затем нажмите на свободное место за столом</p></div><span>{data.unseated.length}</span></div><div className="unseated-list">{data.unseated.map((registration) => <button key={registration.id} className={selectedPlayer?.userId === registration.userId ? 'selected' : ''} onClick={() => setSelectedPlayer({ userId: registration.userId, seatId: null, label: playerLabel(registration.user) })}><Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} photoUrl={registration.user.photoUrl} size="sm" /><span><strong>{playerLabel(registration.user)}</strong><small>{registrationStatusLabel(registration.status)}</small></span><Plus size={15} /></button>)}{!data.unseated.length && <p>Все доступные игроки рассажены.</p>}</div></section>
    </> : <Empty icon={<Armchair />} title="Выберите турнир" text="После выбора здесь появятся столы и список игроков" />}
  </div>;
}

function AccessTab({ users, onDone }: { users: AdminUser[]; onDone: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [invite, setInvite] = useState<BrowserInviteResult | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSessions = useCallback(async () => { try { setSessions(await api<BrowserSession[]>('/admin/browser-access/sessions')); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сессии'); } }, []);
  useEffect(() => { void loadSessions(); }, [loadSessions]);
  const visible = sessions.filter((session) => {
    const active = isSessionActive(session);
    const name = `${session.user?.firstName ?? ''} ${session.user?.lastName ?? ''} ${session.user?.username ?? ''} ${session.user?.telegramId ?? ''}`.toLowerCase();
    return (showAll || active) && name.includes(query.toLowerCase());
  });
  async function createInvite() {
    if (!selectedId) return;
    setSaving(true); setError(null); setInvite(null);
    try { const result = await post<BrowserInviteResult>('/admin/browser-access/invites', { userId: selectedId }); setInvite(result); onDone('Одноразовая ссылка создана на 30 минут'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать ссылку'); }
    finally { setSaving(false); }
  }
  async function revoke(id: string) {
    setSaving(true); setError(null);
    try { await post(`/admin/browser-access/sessions/${id}/revoke`); await loadSessions(); onDone('Браузерный доступ отозван'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отозвать доступ'); }
    finally { setSaving(false); }
  }
  return <div className="admin-view">
    <AdminHeading eyebrow="БЕЗОПАСНОСТЬ" title="Доступ из браузера" text="Адресные приглашения и мгновенный отзыв активных сессий" />
    <div className="access-overview-grid">
      <section className="browser-invite-card"><div className="access-card-head"><span><KeyRound /></span><div><h2>Новое приглашение</h2><p>30 минут · одно использование</p></div></div><label>Пользователь<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setInvite(null); }}>{users.map((user) => <option value={user.id} key={user.id}>{user.username ? `@${user.username}` : `${user.firstName} ${user.lastName ?? ''}`} · ID {user.telegramId}</option>)}</select></label><button className="button primary wide" disabled={!selectedId || saving} onClick={() => void createInvite()}><KeyRound size={16} />{saving ? 'Создаём…' : 'Создать ссылку'}</button>{error && <div className="form-error">{error}</div>}{invite && <InviteResult invite={invite} onCopied={onDone} />}<p className="access-warning">Передавайте ссылку лично: первый открывший получит сессию выбранного пользователя.</p></section>
      <section className="security-summary"><span><MonitorSmartphone /></span><strong>{sessions.filter(isSessionActive).length}</strong><p>активных браузерных сессий</p><small>Каждая проверяется сервером при любом защищённом запросе.</small></section>
    </div>
    <section className="all-sessions-section"><div className="admin-section-title"><div><h2>Сессии пользователей</h2><p>Поиск и централизованный отзыв доступа</p></div><label className="show-all-toggle"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Показывать завершённые</label></div><div className="players-search sessions-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, username или Telegram ID" /></div><div className="global-session-list">{visible.map((session) => <article key={session.id} className={isSessionActive(session) ? 'active' : ''}><Avatar firstName={session.user?.firstName ?? '?'} lastName={session.user?.lastName ?? null} size="sm" /><div><strong>{session.user?.username ? `@${session.user.username}` : `${session.user?.firstName ?? ''} ${session.user?.lastName ?? ''}`}</strong><small>ID {session.user?.telegramId} · создана {tournamentDate(session.createdAt).full}</small></div><span>{isSessionActive(session) ? `До ${tournamentDate(session.expiresAt).full}` : session.revokedAt ? 'Отозвана' : 'Истекла'}</span>{isSessionActive(session) && <button className="button revoke-button" onClick={() => void revoke(session.id)}><ShieldOff size={15} />Отозвать</button>}</article>)}{!visible.length && <Empty icon={<MonitorSmartphone />} title="Сессий не найдено" text="Измените фильтр или создайте приглашение" />}</div></section>
  </div>;
}

function SettingsTab({ seasons, tags, reasonPresets, onDone }: { seasons: Season[]; tags: PlayerTag[]; reasonPresets: ReasonPreset[]; onDone: (message: string) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Season | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<PlayerTag | null>(null);
  const [editingPreset, setEditingPreset] = useState<ReasonPreset | null>(null);
  function openNew() { setEditing(null); setError(null); setModalOpen(true); }
  function openEdit(season: Season) { setEditing(season); setError(null); setModalOpen(true); }
  async function saveSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const isActive = form.get('isActive') === 'on';
    if (isActive && !editing?.isActive && !window.confirm('Активация нового сезона сбросит текущие балансы игроков до 0. История операций сохранится. Продолжить?')) return;
    if (!isActive && editing?.isActive && !window.confirm('Отключить активный сезон? До активации другого сезона начислять и списывать очки будет нельзя.')) return;
    setSaving(true); setError(null);
    const payload = { name: form.get('name'), number: Number(form.get('number')), startsAt: new Date(String(form.get('startsAt'))).toISOString(), endsAt: new Date(String(form.get('endsAt'))).toISOString(), isActive };
    try { await post(editing ? `/admin/seasons/${editing.id}` : '/admin/seasons', payload, editing ? 'PATCH' : 'POST'); setModalOpen(false); onDone(editing ? 'Сезон обновлён' : 'Сезон создан'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить сезон'); }
    finally { setSaving(false); }
  }
  async function activate(season: Season) {
    if (season.isActive || !window.confirm(`Активировать «${season.name}»? Текущие балансы игроков будут сброшены до 0, история сохранится.`)) return;
    try { await post(`/admin/seasons/${season.id}`, { isActive: true }, 'PATCH'); onDone(`${season.name} активирован`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось активировать сезон'); }
  }
  async function finalize(season: Season) {
    if (!season.isActive || !window.confirm(`Завершить «${season.name}»? Текущий рейтинг будет навсегда зафиксирован. После этого очки сезона изменить нельзя.`)) return;
    setSaving(true); setError(null);
    try { const result = await post<{ standings: unknown[] }>(`/admin/seasons/${season.id}/finalize`); onDone(`Сезон завершён, сохранено мест: ${result.standings.length}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось завершить сезон'); }
    finally { setSaving(false); }
  }
  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); const form = new FormData(event.currentTarget);
    try { await post(editingTag ? `/admin/tags/${editingTag.id}` : '/admin/tags', { name: form.get('name'), color: form.get('color') }, editingTag ? 'PATCH' : 'POST'); setTagOpen(false); setEditingTag(null); onDone(editingTag ? 'Тег обновлён' : 'Тег создан'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать тег'); }
    finally { setSaving(false); }
  }
  async function createPreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); const form = new FormData(event.currentTarget);
    const rawAmount = String(form.get('defaultAmount') ?? '').trim();
    try { await post(editingPreset ? `/admin/reason-presets/${editingPreset.id}` : '/admin/reason-presets', { label: form.get('label'), reason: form.get('reason'), kind: form.get('kind'), defaultAmount: rawAmount ? Number(rawAmount) : null, sortOrder: editingPreset?.sortOrder ?? reasonPresets.length * 10, isActive: editingPreset?.isActive ?? true }, editingPreset ? 'PATCH' : 'POST'); setPresetOpen(false); setEditingPreset(null); onDone(editingPreset ? 'Шаблон причины обновлён' : 'Шаблон причины создан'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать шаблон'); }
    finally { setSaving(false); }
  }
  async function togglePreset(preset: ReasonPreset) {
    setSaving(true); setError(null);
    try { await post(`/admin/reason-presets/${preset.id}`, { isActive: !preset.isActive }, 'PATCH'); onDone(preset.isActive ? 'Шаблон скрыт' : 'Шаблон включён'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить шаблон'); }
    finally { setSaving(false); }
  }
  async function deleteTag(tag: PlayerTag) {
    if (!window.confirm(`Удалить тег «${tag.name}» у всех игроков?`)) return;
    setSaving(true); setError(null);
    try { await post(`/admin/tags/${tag.id}`, undefined, 'DELETE'); onDone('Тег удалён'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить тег'); }
    finally { setSaving(false); }
  }
  return <div className="admin-view">
    <AdminHeading eyebrow="ПАРАМЕТРЫ КЛУБА" title="Настройки" text="Сезоны и важные параметры работы приложения" actions={<button className="button primary" onClick={openNew}><Plus size={17} />Новый сезон</button>} />
    {error && <div className="form-error settings-error">{error}</div>}
    <section><div className="admin-section-title"><div><h2>Сезоны</h2><p>Периоды рейтинга, финальный снимок и текущий баланс</p></div></div><div className="season-management-grid">{seasons.map((season) => <article className={season.isActive ? 'active' : season.finalizedAt ? 'finalized' : ''} key={season.id}><div className="season-card-top"><span>{season.finalizedAt ? 'ЗАВЕРШЁН' : season.isActive ? 'АКТИВНЫЙ' : 'НЕАКТИВНЫЙ'}</span>{!season.finalizedAt && <button className="icon-button" onClick={() => openEdit(season)} title="Редактировать"><Edit3 size={15} /></button>}</div><h2>{season.name}</h2><p>{dateOnlyLabel(season.startsAt)} — {dateOnlyLabel(season.endsAt)}</p>{season.finalizedAt && season.standings && <ol className="season-podium">{season.standings.map((standing) => <li key={standing.user.id}><b>#{standing.rank}</b><span>{standing.user.username ? `@${standing.user.username}` : standing.user.firstName}</span><strong>{points(standing.points)}</strong></li>)}</ol>}<div><strong>{season.finalizedAt ? season._count?.standings ?? 0 : season._count?.tournaments ?? 0}<small>{season.finalizedAt ? ' мест сохранено' : ' турниров'}</small></strong>{season.isActive ? <button className="button finalize-button" disabled={saving} onClick={() => void finalize(season)}><ShieldCheck size={15} />Завершить</button> : !season.finalizedAt && <button className="button secondary" onClick={() => void activate(season)}>Активировать</button>}</div></article>)}</div></section>
    <div className="settings-columns">
      <section className="settings-list-card"><div className="admin-section-title"><div><h2>Шаблоны причин</h2><p>Быстрые кнопки при начислении</p></div><button className="button secondary" onClick={() => { setError(null); setEditingPreset(null); setPresetOpen(true); }}><Plus size={15} />Добавить</button></div><div>{reasonPresets.map((preset) => <article className={!preset.isActive ? 'inactive' : ''} key={preset.id}><span><Coins /></span><div><strong>{preset.label}</strong><small>{preset.reason}{preset.defaultAmount ? ` · ${Math.abs(preset.defaultAmount)} PTS` : ''}</small></div><div className="settings-row-actions"><button title="Изменить" onClick={() => { setError(null); setEditingPreset(preset); setPresetOpen(true); }}><Edit3 /></button><button onClick={() => void togglePreset(preset)}>{preset.isActive ? 'Скрыть' : 'Включить'}</button></div></article>)}</div></section>
      <section className="settings-list-card"><div className="admin-section-title"><div><h2>Теги игроков</h2><p>Приватная сегментация клуба</p></div><button className="button secondary" onClick={() => { setError(null); setEditingTag(null); setTagOpen(true); }}><Plus size={15} />Добавить</button></div><div>{tags.map((tag) => <article key={tag.id}><i style={{ background: tag.color }} /><div><strong>{tag.name}</strong><small>Доступен в карточке и фильтрах</small></div><div className="settings-row-actions"><button title="Изменить" onClick={() => { setError(null); setEditingTag(tag); setTagOpen(true); }}><Edit3 /></button><button className="danger" title="Удалить" onClick={() => void deleteTag(tag)}><Trash2 /></button></div></article>)}</div></section>
    </div>
    <TrainingLeadSettingsEditor onDone={onDone} />
    <BrandingEditor onDone={onDone} />
    <section className="owner-security-card"><span><ShieldCheck /></span><div><h3>Администраторы защищены на сервере</h3><p>Главные Telegram ID задаются в <code>ADMIN_TELEGRAM_IDS</code>. Сервер проверяет whitelist при каждом запросе к админке и исправляет роль пользователя при входе.</p></div></section>
    {modalOpen && <Modal title={editing ? 'Редактировать сезон' : 'Новый сезон'} onClose={() => setModalOpen(false)}><form className="admin-form" onSubmit={saveSeason}><div className="form-row"><label>Название<input name="name" required minLength={2} defaultValue={editing?.name ?? ''} placeholder="Сезон 05" /></label><label>Номер<input type="number" name="number" required min="1" defaultValue={editing?.number ?? Math.max(0, ...seasons.map((season) => season.number)) + 1} /></label></div><div className="form-row"><label>Начало<input type="date" name="startsAt" required defaultValue={editing ? dateInput(editing.startsAt) : ''} /></label><label>Окончание<input type="date" name="endsAt" required defaultValue={editing ? dateInput(editing.endsAt) : ''} /></label></div><label className="checkbox"><input type="checkbox" name="isActive" defaultChecked={editing?.isActive ?? false} />Активный сезон</label>{!editing?.isActive && <div className="destructive-note"><CircleAlert size={16} /><span>Активация сбросит текущие балансы до 0. Журнал очков и прошлые сезоны сохранятся.</span></div>}{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={saving}><Save size={17} />{saving ? 'Сохраняем…' : 'Сохранить сезон'}</button></form></Modal>}
    {tagOpen && <Modal title={editingTag ? 'Редактировать тег' : 'Новый тег'} onClose={() => { setTagOpen(false); setEditingTag(null); }}><form key={editingTag?.id ?? 'new'} className="admin-form" onSubmit={createTag}><label>Название<input name="name" minLength={2} maxLength={30} required defaultValue={editingTag?.name ?? ''} placeholder="VIP" /></label><label>Цвет<input name="color" type="color" defaultValue={editingTag?.color ?? '#3b8cff'} /></label>{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={saving}><Tags size={16} />{editingTag ? 'Сохранить тег' : 'Создать тег'}</button></form></Modal>}
    {presetOpen && <Modal title={editingPreset ? 'Редактировать шаблон' : 'Новый шаблон причины'} onClose={() => { setPresetOpen(false); setEditingPreset(null); }}><form key={editingPreset?.id ?? 'new'} className="admin-form" onSubmit={createPreset}><div className="form-row"><label>Короткое название<input name="label" minLength={2} maxLength={30} required defaultValue={editingPreset?.label ?? ''} placeholder="Призовое место" /></label><label>Для операции<select name="kind" defaultValue={editingPreset?.kind ?? 'BOTH'}><option value="BOTH">Любой</option><option value="AWARD">Начисление</option><option value="DEDUCTION">Списание</option></select></label></div><label>Текст причины<input name="reason" minLength={3} maxLength={160} required defaultValue={editingPreset?.reason ?? ''} placeholder="Призовое место в турнире" /></label><label>Сумма по умолчанию (необязательно)<input name="defaultAmount" type="number" min="-100000" max="100000" defaultValue={editingPreset?.defaultAmount ?? ''} placeholder="100" /></label>{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={saving}><Save size={16} />{editingPreset ? 'Сохранить шаблон' : 'Создать шаблон'}</button></form></Modal>}
  </div>;
}

function TrainingLeadSettingsEditor({ onDone }: { onDone: (message: string) => void }) {
  const [settings, setSettings] = useState<TrainingLeadSettings | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<TrainingLeadSettings>('/admin/training-leads/settings')
      .then((value) => { setSettings(value); setSheetUrl(value.trainingSheetUrl); setEnabled(value.trainingLeadPopupEnabled); })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  async function syncTrainingLeads() {
    setSaving(true); setError(null);
    try {
      const result = await post<{ synced: number; failed: number; remaining: number }>('/admin/training-leads/sync');
      setSettings((current) => current ? { ...current, unsyncedLeads: result.remaining } : current);
      onDone(`Синхронизировано заявок: ${result.synced}${result.failed ? ` · ошибок: ${result.failed}` : ''}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось повторить синхронизацию'); }
    finally { setSaving(false); }
  }

  async function saveTrainingLeadSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const result = await post<TrainingLeadSettings>('/admin/training-leads/settings', { trainingSheetUrl: sheetUrl.trim(), trainingLeadPopupEnabled: enabled }, 'PUT');
      setSettings((current) => ({ ...current, ...result } as TrainingLeadSettings));
      setSheetUrl(result.trainingSheetUrl); setEnabled(result.trainingLeadPopupEnabled);
      onDone(result.trainingLeadPopupEnabled ? 'Форма бесплатного обучения включена' : 'Настройки формы обучения сохранены');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить настройки формы'); }
    finally { setSaving(false); }
  }

  return <section className="training-lead-admin-card">
    <header><span><NotebookPen /></span><div><small>ЛИД-ФОРМА</small><h3>Бесплатное обучение по покеру</h3><p>Всплывающая форма справа в приложении. Заявки сохраняются на сервере и отправляются в Google Sheets.</p></div></header>
    <form onSubmit={saveTrainingLeadSettings}>
      <label className="training-sheet-url">Ссылка на Google Sheets<input type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /></label>
      <label className="training-lead-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>Показывать форму игрокам</strong><small>После отправки одному пользователю форма повторно не показывается.</small></span></label>
      <div className={`training-sheet-status ${settings?.googleSheetsConfigured ? 'ok' : 'warning'} ${settings?.googleSheetsConfigured && settings?.unsyncedLeads ? 'has-retry' : ''}`}>
        <span>{settings?.googleSheetsConfigured ? <CheckCircle2 /> : <CircleAlert />}</span>
        <div><strong>{settings?.googleSheetsConfigured ? 'Google Sheets API подключён' : 'Нужны credentials Google'}</strong><small>{settings?.googleSheetsConfigured ? `Заявок: ${settings.totalLeads ?? 0}${settings.unsyncedLeads ? ` · ожидают синхронизации: ${settings.unsyncedLeads}` : ''}${settings.googleServiceAccountEmail ? ` · дайте редакторский доступ: ${settings.googleServiceAccountEmail}` : ''}` : 'Добавьте GOOGLE_SERVICE_ACCOUNT_EMAIL и GOOGLE_PRIVATE_KEY в переменные Vercel. Даже без них заявки сохраняются в базе и не теряются.'}</small></div>
        {Boolean(settings?.googleSheetsConfigured && settings?.unsyncedLeads) && <button className="button secondary" type="button" disabled={saving} onClick={() => void syncTrainingLeads()}><RefreshCw size={13} />Повторить отправку</button>}
      </div>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary" disabled={saving}><Save size={15} />{saving ? 'Сохраняем…' : 'Сохранить'}</button>
    </form>
  </section>;
}

function BrandingEditor({ onDone }: { onDone: (message: string) => void }) {
  const [settings, setSettings] = useState<BrandingSettings | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<BrandingSettings>('/admin/branding').then((value) => { setSettings(value); setPreview(value.ratingBannerImageData); setAccentColor(normalizeAccentColor(value.accentColor)); }).catch((cause: Error) => setError(cause.message));
  }, []);
  useEffect(() => () => { if (settings) applyAccentColor(settings.accentColor); }, [settings]);

  async function saveAccent() {
    setSaving(true); setError(null);
    try {
      const normalized = normalizeAccentColor(accentColor);
      const result = await post<BrandingSettings>('/admin/branding/accent-color', { accentColor: normalized }, 'PUT');
      setSettings(result); setAccentColor(applyAccentColor(result.accentColor)); onDone('Цвет интерфейса обновлён для всех пользователей');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить цвет интерфейса'); }
    finally { setSaving(false); }
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try { setPreview(await prepareRatingBanner(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось обработать изображение'); }
  }
  async function save() {
    if (!preview) return;
    setSaving(true); setError(null);
    try {
      const result = await post<BrandingSettings>('/admin/branding/rating-banner', { imageData: preview }, 'PUT');
      setSettings(result); setPreview(result.ratingBannerImageData); onDone('Изображение рейтинговой карточки обновлено');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изображение'); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!window.confirm('Вернуть стандартный синий фон рейтинговой карточки?')) return;
    setSaving(true); setError(null);
    try {
      const result = await post<BrandingSettings>('/admin/branding/rating-banner', undefined, 'DELETE');
      setSettings(result); setPreview(null); onDone('Стандартный фон восстановлен');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить изображение'); }
    finally { setSaving(false); }
  }
  const changed = preview !== settings?.ratingBannerImageData;
  const accentChanged = normalizeAccentColor(accentColor) !== normalizeAccentColor(settings?.accentColor);
  const presets = ['#3B8CFF', '#FF7A00', '#46D98B', '#A66BFF', '#F04458'];
  return <section className="branding-editor">
    <div className="admin-section-title"><div><h2>Оформление клуба</h2><p>Общий акцент интерфейса и фоновое изображение рейтинговой карточки</p></div></div>
    <div className="theme-color-editor">
      <div><span className="theme-color-preview" style={{ background: accentColor }} /><div><h3>Цвет интерфейса</h3><p>Применяется для всех игроков и администраторов. Подходит для сезонного и праздничного оформления.</p></div></div>
      <div className="theme-color-actions"><div className="theme-presets">{presets.map((color) => <button key={color} className={normalizeAccentColor(accentColor) === color ? 'active' : ''} style={{ '--preset-color': color } as CSSProperties} onClick={() => { setAccentColor(color); applyAccentColor(color); }} title={color} aria-label={`Выбрать цвет ${color}`} />)}</div><label>Свой цвет<input type="color" value={accentColor} onChange={(event) => { setAccentColor(event.target.value.toUpperCase()); applyAccentColor(event.target.value); }} /></label><button className="button primary" disabled={!accentChanged || saving} onClick={() => void saveAccent()}><Save size={15} />Сохранить для всех</button></div>
    </div>
    <div className="branding-editor-grid">
      <div className={`branding-preview ${preview ? 'custom' : ''}`} style={preview ? { backgroundImage: `linear-gradient(90deg, rgba(var(--accent-rgb), .88), rgba(var(--accent-rgb), .52)), url(${preview})` } : undefined}><span>Ваш рейтинг</span><strong>#2</strong><small>100 PTS</small></div>
      <div className="branding-controls"><span><ImagePlus /></span><div><h3>{preview ? 'Изображение выбрано' : 'Стандартный фон'}</h3><p>PNG, JPEG или WebP. Файл автоматически уменьшается и переводится в WebP.</p></div><div><label className="button secondary">Выбрать файл<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event)} /></label><button className="button primary" disabled={!preview || !changed || saving} onClick={() => void save()}><Save size={15} />Сохранить</button>{settings?.ratingBannerImageData && <button className="icon-button delete-tournament" disabled={saving} onClick={() => void remove()} title="Вернуть стандартный фон"><Trash2 size={15} /></button>}</div></div>
    </div>
    {error && <div className="form-error">{error}</div>}
  </section>;
}

function AuditTab() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams(); if (search.trim()) params.set('search', search.trim()); if (action) params.set('action', action); if (entityType) params.set('entityType', entityType);
    try { setData(await api<AuditResponse>(`/admin/audit?${params.toString()}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить аудит'); }
    finally { setLoading(false); }
  }, [search, action, entityType]);
  useEffect(() => { void load(); }, [action, entityType]);
  return <div className="admin-view"><AdminHeading eyebrow="НЕИЗМЕНЯЕМЫЙ ЖУРНАЛ" title="Аудит действий" text="Кто, когда и что изменил — с состоянием до и после операции" actions={<button className="button secondary" onClick={() => void load()}><RefreshCw size={16} />Обновить</button>} />
    <div className="audit-filters"><div className="players-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} placeholder="Поиск по описанию" /></div><select value={action} onChange={(event) => setAction(event.target.value)}><option value="">Все действия</option>{data?.filters.actions.map((item) => <option value={item} key={item}>{auditActionLabel(item)}</option>)}</select><select value={entityType} onChange={(event) => setEntityType(event.target.value)}><option value="">Все разделы</option>{data?.filters.entityTypes.map((item) => <option value={item} key={item}>{auditEntityLabel(item)}</option>)}</select><button className="button primary" onClick={() => void load()}><Search size={15} />Найти</button></div>
    {error && <div className="form-error">{error}</div>}{loading && !data ? <Loading label="Загружаем журнал…" /> : <div className="audit-timeline">{data?.logs.map((log) => <article key={log.id}><span><History /></span><div className="audit-entry-head"><div><strong>{log.summary}</strong><small>{log.actor ? log.actor.username ? `@${log.actor.username}` : `${log.actor.firstName} ${log.actor.lastName ?? ''}` : 'Система'} · {tournamentDate(log.createdAt).full}</small></div><em>{auditActionLabel(log.action)}</em></div>{Boolean(log.before || log.after || log.metadata) && <><button className="audit-expand" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>{expanded === log.id ? 'Скрыть детали' : 'Показать детали'}<ChevronRight /></button>{expanded === log.id && <div className="audit-diff"><AuditJson title="До" value={log.before} /><AuditJson title="После" value={log.after} /><AuditJson title="Данные" value={log.metadata} /></div>}</>}</article>)}{data && data.logs.length === 0 && <Empty icon={<History />} title="Записей не найдено" text="Измените фильтры или поисковый запрос" />}</div>}
  </div>;
}

function AuditJson({ title, value }: { title: string; value: unknown }) {
  if (!value) return null;
  return <section><strong>{title}</strong><pre>{JSON.stringify(value, null, 2)}</pre></section>;
}

function MoreTab({ onNavigate }: { onNavigate: (section: AdminSection) => void }) {
  return <div className="admin-view more-view"><AdminHeading eyebrow="УПРАВЛЕНИЕ" title="Ещё" text="Лояльность, безопасность и дополнительные параметры клуба" /><div className="more-menu-grid"><button onClick={() => onNavigate('analytics')}><span><BarChart3 /></span><div><strong>Аналитика клуба</strong><small>Явка, рост, активность и эффективность</small></div><ChevronRight /></button><button onClick={() => onNavigate('loyalty')}><span><Gift /></span><div><strong>Программа лояльности</strong><small>Club XP, советы, раздачи и рефералы</small></div><ChevronRight /></button><button onClick={() => onNavigate('audit')}><span><History /></span><div><strong>Аудит действий</strong><small>Полная история изменений</small></div><ChevronRight /></button><button onClick={() => onNavigate('access')}><span><KeyRound /></span><div><strong>Доступ из браузера</strong><small>Приглашения и активные сессии</small></div><ChevronRight /></button><button onClick={() => onNavigate('settings')}><span><Settings /></span><div><strong>Настройки</strong><small>Сезоны, оформление, причины и теги</small></div><ChevronRight /></button><Link to="/"><span><LogOut /></span><div><strong>Вернуться в приложение</strong><small>Закрыть панель управления</small></div><ChevronRight /></Link></div></div>;
}

function InviteResult({ invite, onCopied }: { invite: BrowserInviteResult; onCopied: (message: string) => void }) {
  const [copyError, setCopyError] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(invite.url); setCopyError(false); onCopied('Ссылка скопирована'); } catch { setCopyError(true); } }
  return <div className="invite-result"><div><strong>Ссылка для {invite.user.firstName}</strong><small>Действует до {tournamentDate(invite.expiresAt).full} и сгорит после входа</small></div><textarea readOnly value={invite.url} rows={4} onFocus={(event) => event.currentTarget.select()} /><button className="button secondary wide" onClick={() => void copy()}><Copy size={16} />Скопировать ссылку</button>{copyError && <div className="form-error">Выделите ссылку и скопируйте её вручную.</div>}</div>;
}

function SessionList({ sessions, onRevoke }: { sessions: BrowserSession[]; onRevoke: (id: string) => Promise<void> }) {
  return <div className="personal-session-list">{sessions.map((session) => <article key={session.id} className={isSessionActive(session) ? 'active' : ''}><span><MonitorSmartphone /></span><div><strong>{isSessionActive(session) ? 'Активная сессия' : session.revokedAt ? 'Сессия отозвана' : 'Сессия истекла'}</strong><small>Создана {tournamentDate(session.createdAt).full} · до {tournamentDate(session.expiresAt).full}</small></div>{isSessionActive(session) && <button className="icon-button revoke-session" onClick={() => void onRevoke(session.id)} title="Отозвать" aria-label="Отозвать браузерную сессию"><ShieldOff size={16} /></button>}</article>)}{!sessions.length && <Empty icon={<MonitorSmartphone />} title="Сессий пока нет" text="Создайте одноразовую ссылку для входа" />}</div>;
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-result">{icon}<strong>{title}</strong><p>{text}</p></div>;
}

function Status({ value }: { value: Tournament['status'] }) {
  const text = { UPCOMING: 'Скоро', ACTIVE: 'Идёт', FINISHED: 'Завершён', CANCELLED: 'Отменён' }[value];
  return <span className={`status status-${value.toLowerCase()}`}>{text}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={onClose}><X /></button></div>{children}</div></div>;
}

function tournamentPayload(form: FormData) {
  return {
    seasonId: form.get('seasonId'),
    title: form.get('title'),
    description: form.get('description') || null,
    startsAt: new Date(String(form.get('startsAt'))).toISOString(),
    location: form.get('location') || null,
    capacity: Number(form.get('capacity')),
    participantCount: Number(form.get('participantCount')),
    status: form.get('status'),
    registrationClosed: form.get('registrationClosed') === 'on' || form.get('registrationClosed') === 'true',
    registrationDeadline: form.get('registrationDeadline') ? new Date(String(form.get('registrationDeadline'))).toISOString() : null
  };
}
function dateTimeInput(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function dateInput(value: string) { return new Date(value).toISOString().slice(0, 10); }
function dateOnlyLabel(value: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
function playerLabel(user: Pick<User, 'firstName' | 'lastName' | 'username'> & { nickname?: string | null }) { return user.nickname || (user.username ? `@${user.username}` : `${user.firstName} ${user.lastName ?? ''}`.trim()); }
function defaultTournamentScore(index: number) { return [500, 350, 250, 150, 100][index] ?? 50; }
async function prepareRatingBanner(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Выберите PNG, JPEG или WebP');
  if (file.size > 8 * 1024 * 1024) throw new Error('Исходный файл должен быть меньше 8 МБ');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Изображение повреждено или не поддерживается'));
    element.src = source;
  });
  const width = 1400;
  const height = 560;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не поддерживает обработку изображений');
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  let data = canvas.toDataURL('image/webp', .8);
  if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', .82);
  if (data.length > 850_000) throw new Error('После обработки изображение всё ещё слишком большое. Выберите более простой файл.');
  return data;
}
function isSessionActive(session: BrowserSession) { return !session.revokedAt && new Date(session.expiresAt) > new Date(); }
function registrationStatusLabel(value: TournamentRegistrationStatus) { return { REGISTERED: 'В основном списке', WAITLISTED: 'Лист ожидания', CHECKED_IN: 'Присутствие подтверждено', PLAYED: 'Сыграл', CANCELLED: 'Отменено' }[value]; }
function auditActionLabel(value: string) {
  if (value === 'BROADCAST_SENT') return 'Рассылка';
  const labels: Record<string, string> = { POINTS_AWARDED: 'Начисление очков', POINTS_DEDUCTED: 'Списание очков', POINTS_BATCH_CREATED: 'Пакет очков', POINTS_REVERSED: 'Отмена операции', TOURNAMENT_CREATED: 'Создание турнира', TOURNAMENT_UPDATED: 'Изменение турнира', TOURNAMENT_DELETED: 'Удаление турнира', TOURNAMENT_RESULTS_UPDATED: 'Результаты', REGISTRATION_CREATED: 'Регистрация', WAITLIST_JOINED: 'Лист ожидания', REGISTRATION_STATUS_CHANGED: 'Статус заявки', REGISTRATION_CANCELLED: 'Отмена заявки', WAITLIST_PROMOTED: 'Перевод из очереди', SEASON_CREATED: 'Создание сезона', SEASON_UPDATED: 'Изменение сезона', SEASON_FINALIZED: 'Финализация сезона', USER_NOTE_UPDATED: 'Заметка', USER_TAG_ADDED: 'Добавление тега', USER_TAG_REMOVED: 'Удаление тега', PHONE_SHARED: 'Передача телефона', TAG_CREATED: 'Создание тега', TAG_UPDATED: 'Изменение тега', TAG_DELETED: 'Удаление тега', BROWSER_INVITE_CREATED: 'Браузерное приглашение', BROWSER_CODE_USED: 'Вход по Telegram-коду', BROWSER_SESSION_REVOKED: 'Отзыв доступа', TOURNAMENT_NOTIFICATION_SENT: 'Уведомление', TOURNAMENT_TEMPLATE_CREATED: 'Создание шаблона', TOURNAMENT_TEMPLATE_UPDATED: 'Изменение шаблона', TOURNAMENT_TEMPLATE_DELETED: 'Удаление шаблона', RECURRING_TOURNAMENT_CREATED: 'Турнир по расписанию', REASON_PRESET_CREATED: 'Создание причины', REASON_PRESET_UPDATED: 'Изменение причины', SEATING_GENERATED: 'Создание рассадки', SEATING_REGENERATED: 'Пересоздание рассадки', PLAYER_SEATED: 'Посадка игрока', PLAYER_MOVED: 'Пересадка игрока', SEATS_SWAPPED: 'Обмен местами', PLAYER_UNSEATED: 'Снятие с места', SEATING_PUBLISHED: 'Публикация рассадки', SEATING_UNPUBLISHED: 'Скрытие рассадки', RATING_BANNER_UPDATED: 'Фон рейтинга', RATING_BANNER_REMOVED: 'Удаление фона рейтинга', INTERFACE_COLOR_UPDATED: 'Цвет интерфейса', TOURNAMENT_REBUY: 'Ребай', TOURNAMENT_REENTRY: 'Повторный вход', TOURNAMENT_ELIMINATION: 'Выбывание', TOURNAMENT_BOUNTY: 'Баунти', TOURNAMENT_BONUS_XP: 'Бонус Club XP', TOURNAMENT_TABLE_CREATED: 'Создание стола', TOURNAMENT_TABLE_UPDATED: 'Количество мест', TOURNAMENT_TABLE_CLOSED: 'Закрытие стола', TOURNAMENT_TIMER_CREATED: 'Создание таймера', TOURNAMENT_TIMER_STRUCTURE_UPDATED: 'Структура таймера', TOURNAMENT_TIMER_START: 'Запуск таймера', TOURNAMENT_TIMER_PAUSE: 'Пауза таймера', TOURNAMENT_TIMER_RESUME: 'Продолжение таймера', TOURNAMENT_TIMER_NEXT: 'Следующий уровень', TOURNAMENT_TIMER_PREVIOUS: 'Предыдущий уровень', TOURNAMENT_TIMER_RESET: 'Сброс таймера', TOURNAMENT_TIMER_FINISH: 'Завершение таймера', TOURNAMENT_TIMER_GOTO: 'Переход к уровню', TOURNAMENT_TIMER_ADD_TIME: 'Добавление времени', TOURNAMENT_TIMER_SET_REMAINING: 'Остаток времени' };
  return labels[value] ?? value.split('_').join(' ').toLowerCase();
}
function auditEntityLabel(value: string) { if (value === 'TelegramBroadcast') return 'Рассылки'; return ({ User: 'Игроки', Tournament: 'Турниры', TournamentSeating: 'Рассадка', ClubSettings: 'Оформление', Season: 'Сезоны', PointTransaction: 'Очки', PointBatch: 'Пакеты очков', TournamentRegistration: 'Регистрации', TournamentTemplate: 'Шаблоны турниров', PlayerTag: 'Теги', BrowserSession: 'Доступ', BrowserInvite: 'Приглашения', TournamentPlayerAction: 'Операции турнира', TournamentTimer: 'Таймер турнира' } as Record<string, string>)[value] ?? value; }
