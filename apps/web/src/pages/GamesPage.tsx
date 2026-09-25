import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ListOrdered, MapPin, RotateCcw, Timer, UserCheck, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorState, Loading } from '../components/Loading';
import { api, post } from '../lib/api';
import { tournamentDate } from '../lib/format';
import { addLocalDays, localDateKey, startOfLocalDay, startOfLocalWeek, tournamentVisualState, weekOffsetForDate, type TournamentVisualState } from '../lib/tournamentWeek';
import type { Tournament } from '../types';

const dayName = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });
const dayDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const rangeDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const statusLabels: Record<TournamentVisualState, string> = {
  upcoming: 'ПРЕДСТОИТ',
  active: 'ИДЁТ',
  finished: 'ЗАВЕРШЕНО',
  cancelled: 'ОТМЕНЕНО'
};

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function GamesPage() {
  const [searchParams] = useSearchParams();
  const focusedTournamentId = searchParams.get('tournament');
  const [items, setItems] = useState<Tournament[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const now = new Date();

  const load = useCallback(async () => {
    try { setItems(await api<Tournament[]>('/tournaments')); setLoadError(null); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Не удалось загрузить турниры'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!items || !focusedTournamentId) return;
    const focused = items.find((item) => item.id === focusedTournamentId);
    if (!focused) return;
    setWeekOffset(weekOffsetForDate(new Date(focused.startsAt)));
    const timer = window.setTimeout(() => {
      document.getElementById(`tournament-${focusedTournamentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [focusedTournamentId, items]);

  async function register(game: Tournament) {
    setSavingId(game.id); setActionError(null); setNotice(null);
    try {
      const result = await post<{ registration: { status: string } }>(`/tournaments/${game.id}/registration`);
      setNotice(result.registration.status === 'WAITLISTED' ? 'Вы добавлены в лист ожидания' : 'Место на турнире подтверждено');
      await load();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось записаться'); }
    finally { setSavingId(null); }
  }

  async function cancel(game: Tournament) {
    setSavingId(game.id); setActionError(null); setNotice(null);
    try { await post(`/tournaments/${game.id}/registration`, undefined, 'DELETE'); setNotice('Запись отменена'); await load(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось отменить запись'); }
    finally { setSavingId(null); }
  }

  const currentWeekStart = startOfLocalWeek(now);
  const weekStart = addLocalDays(currentWeekStart, weekOffset * 7);
  const weekEnd = addLocalDays(weekStart, 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addLocalDays(weekStart, index)), [weekStart.getTime()]);
  const itemsByDay = useMemo(() => {
    const result = new Map<string, Tournament[]>();
    for (const item of items ?? []) {
      const startsAt = new Date(item.startsAt);
      if (startsAt < weekStart || startsAt >= weekEnd) continue;
      const key = localDateKey(startsAt);
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    for (const tournaments of result.values()) tournaments.sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
    return result;
  }, [items, weekStart.getTime(), weekEnd.getTime()]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!items) return <Loading />;

  return <div className="page games-diary-page">
    <div className="games-diary-heading">
      <div className="page-heading"><span className="eyebrow">КАЛЕНДАРЬ КЛУБА</span><h1>Турниры</h1><p>Вся игровая неделя — одним взглядом</p></div>
      <div className="week-navigation" aria-label="Навигация по неделям">
        <button onClick={() => setWeekOffset((value) => value - 1)} aria-label="Предыдущая неделя"><ChevronLeft /></button>
        <div><strong>{rangeDate.format(weekStart)} — {rangeDate.format(addLocalDays(weekStart, 6))}</strong><span>{weekOffset === 0 ? 'Текущая неделя' : weekOffset < 0 ? 'Прошедшая неделя' : 'Предстоящая неделя'}</span></div>
        <button onClick={() => setWeekOffset((value) => value + 1)} aria-label="Следующая неделя"><ChevronRight /></button>
        {weekOffset !== 0 && <button className="week-today-button" onClick={() => setWeekOffset(0)}><RotateCcw />Сегодня</button>}
      </div>
    </div>

    {notice && <div className="games-notice"><Check size={16} />{notice}</div>}
    {actionError && <div className="games-notice error"><X size={16} />{actionError}<button onClick={() => setActionError(null)}>Закрыть</button></div>}

    <div className="week-diary">
      {days.map((date) => {
        const key = localDateKey(date);
        const tournaments = itemsByDay.get(key) ?? [];
        const isPast = date < startOfLocalDay(now);
        const isToday = key === localDateKey(now);
        return <section className={`week-day-row ${isPast ? 'is-past' : ''} ${isToday ? 'is-today' : ''}`} key={key}>
          <header className="week-day-label">
            <div><strong>{capitalize(dayName.format(date))}</strong><span>{dayDate.format(date)}</span></div>
            {isToday ? <em>СЕГОДНЯ</em> : isPast ? <em>ЗАВЕРШЕНО</em> : null}
          </header>
          <div className="week-day-content">
            {tournaments.length ? tournaments.map((game) => {
              const dateInfo = tournamentDate(game.startsAt);
              const visualState = tournamentVisualState(game.status, game.startsAt, now);
              const registrationAvailable = (game.status === 'UPCOMING' || game.status === 'ACTIVE') && visualState !== 'finished' && !game.registrationClosed && (!game.registrationDeadline || new Date(game.registrationDeadline) > now);
              const isRegistered = Boolean(game.registration && game.registration.status !== 'CANCELLED');
              const canCancel = game.status === 'UPCOMING' && (game.registration?.status === 'REGISTERED' || game.registration?.status === 'WAITLISTED');
              const registrationLabel = game.registration?.status === 'WAITLISTED' ? 'Вы в листе ожидания' : game.registration?.status === 'CHECKED_IN' || game.registration?.status === 'PLAYED' ? 'Чек-ин подтверждён' : isRegistered ? 'Вы записаны' : !registrationAvailable ? 'Регистрация закрыта' : game.participantCount >= game.capacity ? 'Встать в лист ожидания' : 'Записаться на турнир';
              return <article id={`tournament-${game.id}`} className={`diary-tournament diary-${visualState} ${focusedTournamentId === game.id ? 'game-card-focused' : ''}`} key={game.id}>
                <div className="diary-tournament-main">
                  <div className="diary-title-row"><h2>{game.title}</h2><span className={`diary-status diary-status-${visualState}`}>{visualState === 'finished' && <Check />}{statusLabels[visualState]}</span></div>
                  <div className="diary-meta">
                    <span><CalendarDays />{dateInfo.full}</span>
                    <span><Clock3 />{dateInfo.time}</span>
                    <span className="diary-location"><MapPin />{game.location || 'Место уточняется'}</span>
                    <span><Users />{game.participantCount || game._count?.results || 0}/{game.capacity}</span>
                  </div>
                </div>
                {(visualState === 'upcoming' || visualState === 'active') && <div className="diary-actions">
                  {visualState === 'active' && game.timerAvailable && <Link className="diary-timer-button" to={`/timer/${game.id}`}><Timer />Таймер</Link>}
                  <button className={`diary-register-button ${isRegistered ? 'registered' : ''}`} disabled={savingId === game.id || !registrationAvailable || isRegistered} onClick={() => void register(game)}>
                    {game.registration?.status === 'WAITLISTED' ? <ListOrdered /> : <UserCheck />}
                    {savingId === game.id ? 'Подождите…' : registrationLabel}
                  </button>
                  {canCancel && <button className="diary-cancel-button" disabled={savingId === game.id} onClick={() => void cancel(game)} aria-label={`Отменить участие в ${game.title}`}><X />Отменить</button>}
                </div>}
              </article>;
            }) : <div className="week-day-empty"><CalendarDays /><span>{isPast ? 'Турниров не было' : 'Турниров нет'}</span></div>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
