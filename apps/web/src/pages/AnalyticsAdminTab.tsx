import {
  Activity, BarChart3, BellRing, CalendarCheck2, Download, RefreshCw, Sparkles,
  Target, TrendingUp, Trophy, UserCheck, UserPlus, Users
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loading } from '../components/Loading';
import { api } from '../lib/api';
import { tournamentDate } from '../lib/format';

type PeriodKey = '7d' | '30d' | '90d' | 'season';
type Trend = { current: number; previous: number; deltaPercent: number | null };
type AnalyticsData = {
  period: { key: PeriodKey; label: string; from: string; to: string };
  summary: {
    usersTotal: number; newPlayers: number; activePlayers: number; returningPlayers: number; returningShare: number;
    registrations: number; attendance: number; noShows: number; attendanceRate: number; tournaments: number;
    averageAttendance: number; tableOccupancy: number; ratingPtsIssued: number; clubXpIssued: number;
    trends: { newPlayers: Trend; registrations: Trend; attendance: Trend };
  };
  engagement: {
    appOpens: number; uniqueAppUsers: number; dailyHandAttempts: number; dailyHandCorrect: number;
    dailyHandSuccessRate: number; achievementsUnlocked: number; referralsCreated: number;
    referralsRewarded: number; referralConversion: number; adminActions: number;
  };
  delivery: { sent: number; failed: number; rate: number };
  operations: { averageResultDelayHours: number; averagePointsDelayHours: number };
  timeSeries: { day: string; registrations: number; attendance: number; newPlayers: number; appOpens: number }[];
  weekdays: { name: string; games: number; attendance: number; averageAttendance: number }[];
  formats: { title: string; games: number; attendance: number; averageAttendance: number }[];
  tournaments: { id: string; title: string; startsAt: string; status: string; registered: number; attended: number; noShows: number; capacity: number; occupancy: number; seated: number; tableCapacity: number; seatingOccupancy: number }[];
  growthLeaders: { userId: string; name: string; username: string | null; ratingPts: number; clubXp: number }[];
};

const periods: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 дней' }, { key: '30d', label: '30 дней' },
  { key: '90d', label: '90 дней' }, { key: 'season', label: 'Сезон' }
];

const number = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function TrendBadge({ value }: { value: Trend }) {
  if (value.deltaPercent === null) return <small className="analytics-trend neutral">нет базы сравнения</small>;
  const direction = value.deltaPercent > 0 ? 'up' : value.deltaPercent < 0 ? 'down' : 'neutral';
  return <small className={`analytics-trend ${direction}`}>{value.deltaPercent > 0 ? '+' : ''}{decimal.format(value.deltaPercent)}% к прошлому периоду</small>;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function hours(value: number) {
  if (!value) return '—';
  if (value < 1) return `${Math.round(value * 60)} мин`;
  return `${decimal.format(value)} ч`;
}

export function AnalyticsAdminTab() {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<AnalyticsData>(`/admin/analytics?period=${period}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить аналитику'); }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const insights = useMemo(() => {
    if (!data) return [];
    const items: { tone: 'good' | 'attention' | 'info'; title: string; text: string }[] = [];
    if (!data.summary.tournaments) items.push({ tone: 'info', title: 'Период без турниров', text: 'Выберите более длинный период, чтобы увидеть посещаемость и загрузку столов.' });
    else if (data.summary.attendanceRate >= 80) items.push({ tone: 'good', title: 'Стабильная явка', text: `${decimal.format(data.summary.attendanceRate)}% записавшихся дошли до игры.` });
    else items.push({ tone: 'attention', title: 'Есть резерв по явке', text: `${data.summary.noShows} неявок. Напоминание за день и подтверждение участия помогут заполнить столы.` });
    if (data.weekdays[0]) items.push({ tone: 'info', title: `Лучший день — ${data.weekdays[0].name.toLowerCase()}`, text: `${data.weekdays[0].attendance} посещений за ${data.weekdays[0].games} игр.` });
    if (data.delivery.sent + data.delivery.failed > 0 && data.delivery.rate < 95) items.push({ tone: 'attention', title: 'Проверьте доставку', text: `${data.delivery.failed} сообщений не доставлено. Возможно, пользователи заблокировали бота.` });
    if (data.engagement.dailyHandAttempts > 0) items.push({ tone: 'good', title: 'Ежедневная раздача работает', text: `${data.engagement.dailyHandAttempts} ответов, точность ${decimal.format(data.engagement.dailyHandSuccessRate)}%.` });
    return items.slice(0, 4);
  }, [data]);

  function downloadCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [
      ['Poker Club — аналитика', data.period.label],
      ['Период', `${data.period.from.slice(0, 10)} — ${data.period.to.slice(0, 10)}`],
      [],
      ['День', 'Новые игроки', 'Регистрации', 'Посещения', 'Открытия приложения'],
      ...data.timeSeries.map((item) => [item.day, item.newPlayers, item.registrations, item.attendance, item.appOpens]),
      [],
      ['Турнир', 'Дата', 'Записались', 'Пришли', 'Неявки', 'Вместимость', 'Заполнение, %'],
      ...data.tournaments.map((item) => [item.title, item.startsAt.slice(0, 10), item.registered, item.attended, item.noShows, item.capacity, item.occupancy])
    ];
    const blob = new Blob([`﻿${rows.map((row) => row.map(csvCell).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `poker-club-analytics-${data.period.from.slice(0, 10)}-${data.period.to.slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="admin-view analytics-view">
    <div className="admin-heading-row"><div className="admin-heading"><span>ДАННЫЕ БЕЗ ТАБЛИЦ ВРУЧНУЮ</span><h1>Аналитика клуба</h1><p>Явка, активность, рост и качество работы администратора в одном экране</p></div><div className="admin-heading-actions"><button className="button secondary" disabled={!data} onClick={downloadCsv}><Download size={16} />CSV</button><button className="button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Обновить</button></div></div>
    <div className="analytics-periods" aria-label="Период аналитики">{periods.map((item) => <button key={item.key} className={period === item.key ? 'active' : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
    {error && <div className="form-error">{error}<button className="button ghost" onClick={() => void load()}>Повторить</button></div>}
    {loading && !data ? <Loading label="Собираем показатели…" /> : data && <>
      <section className="analytics-kpis">
        <article><span><UserPlus /></span><small>Новые игроки</small><strong>{number.format(data.summary.newPlayers)}</strong><TrendBadge value={data.summary.trends.newPlayers} /></article>
        <article><span><UserCheck /></span><small>Регистрации</small><strong>{number.format(data.summary.registrations)}</strong><TrendBadge value={data.summary.trends.registrations} /></article>
        <article><span><CalendarCheck2 /></span><small>Посещения</small><strong>{number.format(data.summary.attendance)}</strong><TrendBadge value={data.summary.trends.attendance} /></article>
        <article><span><Target /></span><small>Явка</small><strong>{decimal.format(data.summary.attendanceRate)}%</strong><small>{data.summary.noShows} неявок</small></article>
      </section>

      <section className="analytics-panel analytics-chart-panel">
        <header><div><h2>Динамика клуба</h2><p>{data.period.label} · посещения считаются по чек-ину и результатам</p></div><div className="analytics-legend"><span className="registration">Регистрации</span><span className="attendance">Посещения</span></div></header>
        <AnalyticsChart items={data.timeSeries} />
      </section>

      <section className="analytics-insights"><header><Sparkles /><div><h2>Что важно сейчас</h2><p>Короткие выводы по выбранному периоду</p></div></header><div>{insights.map((item) => <article className={item.tone} key={item.title}><strong>{item.title}</strong><p>{item.text}</p></article>)}</div></section>

      <div className="analytics-columns">
        <section className="analytics-panel"><header><div><h2>Аудитория и лояльность</h2><p>Не только рейтинг, но и привычка возвращаться</p></div><Users /></header><div className="analytics-metric-list">
          <Metric label="Всего игроков" value={number.format(data.summary.usersTotal)} hint={`${data.summary.activePlayers} активны в периоде`} />
          <Metric label="Вернувшиеся игроки" value={number.format(data.summary.returningPlayers)} hint={`${decimal.format(data.summary.returningShare)}% активной аудитории`} />
          <Metric label="Открытия приложения" value={number.format(data.engagement.appOpens)} hint={`${data.engagement.uniqueAppUsers} уникальных игроков`} />
          <Metric label="Реферальные приглашения" value={`${data.engagement.referralsRewarded}/${data.engagement.referralsCreated}`} hint={`Конверсия ${decimal.format(data.engagement.referralConversion)}%`} />
          <Metric label="Достижения" value={number.format(data.engagement.achievementsUnlocked)} hint="Открыто за период" />
        </div></section>
        <section className="analytics-panel"><header><div><h2>Операции</h2><p>Скорость и качество работы клуба</p></div><Activity /></header><div className="analytics-metric-list">
          <Metric label="Средняя посещаемость" value={decimal.format(data.summary.averageAttendance)} hint={`за ${data.summary.tournaments} турниров`} />
          <Metric label="Заполнение мест" value={`${decimal.format(data.summary.tableOccupancy)}%`} hint="По вместимости турниров" />
          <Metric label="Результаты после старта" value={hours(data.operations.averageResultDelayHours)} hint="Среднее время фиксации" />
          <Metric label="Начисления после старта" value={hours(data.operations.averagePointsDelayHours)} hint="Среднее время до пакета очков" />
          <Metric label="Действия администраторов" value={number.format(data.engagement.adminActions)} hint="Записаны в аудите" />
        </div></section>
        <section className="analytics-panel"><header><div><h2>Коммуникации и награды</h2><p>Доставка и оборот двух независимых систем</p></div><BellRing /></header><div className="analytics-metric-list">
          <Metric label="Доставка уведомлений" value={`${decimal.format(data.delivery.rate)}%`} hint={`${data.delivery.sent} доставлено · ${data.delivery.failed} ошибок`} />
          <Metric label="Выдано Rating PTS" value={number.format(data.summary.ratingPtsIssued)} hint="Турнирный рейтинг" />
          <Metric label="Выдано Club XP" value={number.format(data.summary.clubXpIssued)} hint="Лояльность и активность" />
          <Metric label="Ежедневная раздача" value={number.format(data.engagement.dailyHandAttempts)} hint={`${data.engagement.dailyHandCorrect} верных ответов`} />
        </div></section>
      </div>

      <div className="analytics-columns analytics-rankings">
        <section className="analytics-panel"><header><div><h2>Популярные дни</h2><p>По фактическим посещениям</p></div><BarChart3 /></header><div className="analytics-ranked-list">{data.weekdays.map((item, index) => <article key={item.name}><b>{index + 1}</b><div><strong>{item.name}</strong><small>{item.games} игр · в среднем {decimal.format(item.averageAttendance)}</small></div><em>{item.attendance}</em></article>)}{!data.weekdays.length && <p className="analytics-empty">Недостаточно данных</p>}</div></section>
        <section className="analytics-panel"><header><div><h2>Форматы</h2><p>Какие игры собирают больше игроков</p></div><Trophy /></header><div className="analytics-ranked-list">{data.formats.map((item, index) => <article key={item.title}><b>{index + 1}</b><div><strong>{item.title}</strong><small>{item.games} игр · в среднем {decimal.format(item.averageAttendance)}</small></div><em>{item.attendance}</em></article>)}{!data.formats.length && <p className="analytics-empty">Недостаточно данных</p>}</div></section>
        <section className="analytics-panel"><header><div><h2>Рост игроков</h2><p>Rating PTS и Club XP за период</p></div><TrendingUp /></header><div className="analytics-ranked-list">{data.growthLeaders.map((item, index) => <article key={item.userId}><b>{index + 1}</b><div><strong>{item.username ? `@${item.username}` : item.name}</strong><small>+{number.format(Math.max(0, item.ratingPts))} PTS · +{number.format(Math.max(0, item.clubXp))} XP</small></div><em>{number.format(item.ratingPts + item.clubXp)}</em></article>)}{!data.growthLeaders.length && <p className="analytics-empty">Начислений в периоде нет</p>}</div></section>
      </div>

      <section className="analytics-panel analytics-tournaments"><header><div><h2>Турниры периода</h2><p>Запись, явка и загрузка каждого события</p></div></header><div className="analytics-table-wrap"><table><thead><tr><th>Турнир</th><th>Записались</th><th>Пришли</th><th>Неявки</th><th>Заполнение</th></tr></thead><tbody>{data.tournaments.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>{tournamentDate(item.startsAt).full}</small></td><td>{item.registered}</td><td>{item.attended}</td><td className={item.noShows ? 'warning' : ''}>{item.noShows}</td><td><span className="analytics-progress"><i style={{ width: `${Math.min(100, item.occupancy)}%` }} /></span><b>{decimal.format(item.occupancy)}%</b></td></tr>)}</tbody></table>{!data.tournaments.length && <p className="analytics-empty">В выбранном периоде турниров нет</p>}</div></section>
    </>}
  </div>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article><div><strong>{label}</strong><small>{hint}</small></div><b>{value}</b></article>;
}

function AnalyticsChart({ items }: { items: AnalyticsData['timeSeries'] }) {
  const max = Math.max(1, ...items.flatMap((item) => [item.registrations, item.attendance]));
  const labelEvery = items.length > 60 ? 14 : items.length > 31 ? 7 : items.length > 14 ? 5 : 1;
  return <div className="analytics-chart-scroll"><div className="analytics-chart" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(${items.length > 45 ? 8 : 14}px, 1fr))` }}>{items.map((item, index) => <div className="analytics-chart-day" key={item.day} title={`${item.day}: регистрации ${item.registrations}, посещения ${item.attendance}`}><div><i className="registration" style={{ height: `${Math.max(item.registrations ? 4 : 0, (item.registrations / max) * 100)}%` }} /><i className="attendance" style={{ height: `${Math.max(item.attendance ? 4 : 0, (item.attendance / max) * 100)}%` }} /></div><small>{index % labelEvery === 0 ? new Date(`${item.day}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''}</small></div>)}</div></div>;
}
