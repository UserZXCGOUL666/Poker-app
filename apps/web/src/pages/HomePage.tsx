import { Armchair, BarChart3, Check, ChevronRight, Crown, ListOrdered, Trophy, UserCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { DailyEngagement } from '../components/DailyEngagement';
import { ErrorState, Loading } from '../components/Loading';
import { api, apiAssetUrl, post } from '../lib/api';
import { clubRankProgress } from '../lib/clubRank';
import { points, tournamentDate } from '../lib/format';
import type { HomeData } from '../types';

function playerName(player: HomeData['user']) {
  return player.nickname || player.username || `${player.firstName} ${player.lastName ?? ''}`.trim();
}

function leaderName(player: HomeData['leaders'][number]) {
  return player.nickname || player.username || `${player.firstName} ${player.lastName ?? ''}`.trim();
}

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrationMessage, setRegistrationMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [savingRegistration, setSavingRegistration] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api<HomeData>('/home'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить главную');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;

  const next = data.nextTournament ? tournamentDate(data.nextTournament.startsAt) : null;
  const xp = clubRankProgress(data.user.clubXp);
  const activeRegistration = data.nextTournament?.registration && data.nextTournament.registration.status !== 'CANCELLED'
    ? data.nextTournament.registration
    : null;
  const registrationAvailable = Boolean(data.nextTournament
    && !data.nextTournament.registrationClosed
    && (!data.nextTournament.registrationDeadline || new Date(data.nextTournament.registrationDeadline) > new Date()));

  async function registerForNextTournament() {
    if (!data?.nextTournament || activeRegistration || !registrationAvailable || savingRegistration) return;
    setSavingRegistration(true);
    setRegistrationMessage(null);
    try {
      const result = await post<{ registration: { status: string } }>(`/tournaments/${data.nextTournament.id}/registration`);
      setRegistrationMessage({
        kind: 'success',
        text: result.registration.status === 'WAITLISTED' ? 'Вы добавлены в лист ожидания' : 'Место на турнире подтверждено'
      });
      await load();
    } catch (cause) {
      setRegistrationMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Не удалось записаться на турнир' });
    } finally {
      setSavingRegistration(false);
    }
  }

  const leadersBlock = <section className="home-leaders card">
    <header>
      <div><Trophy /><h2>Лидеры сезона</h2></div>
      <Link to="/rating">Смотреть рейтинг <ChevronRight /></Link>
    </header>
    <div className="home-leader-list">
      {data.leaders.map((leader, index) => (
        <Link className={`home-leader-row leader-place-${index + 1}`} to="/rating" key={leader.id} aria-label={`${leaderName(leader)}, место ${index + 1}`}>
          <span className="home-leader-place">{index === 0 ? <Crown /> : index + 1}</span>
          <Avatar firstName={leader.firstName} lastName={leader.lastName} photoUrl={leader.photoUrl} size="sm" />
          <strong>{leaderName(leader)}</strong>
          <small>#{index + 1}</small>
          <b>{points(leader.points)} PTS</b>
        </Link>
      ))}
    </div>
  </section>;

  const resultsBlock = <section className="home-results-block card">
    <header><div><BarChart3 /><h2>Ваши результаты</h2></div></header>
    <div className="home-result-metrics">
      <div><span>Турниров сыграно</span><strong>{data.gamesPlayed}</strong></div>
      <div><span>Финальных столов</span><strong>{data.finalTables}</strong></div>
      <div><span>Побед</span><strong>{data.wins}</strong></div>
    </div>
    <Link className="home-full-stats" to="/profile?tab=overview">Открыть полную статистику <ChevronRight /></Link>
  </section>;

  return <div className="page home-page">
    <p className="season-line">{data.season?.name ?? 'Новый сезон'} · Неделя {data.week}</p>

    <section
      className={`home-overview-card ${data.branding?.hasRatingBanner ? 'home-overview-custom' : ''}`}
      style={data.branding?.hasRatingBanner ? { backgroundImage: `linear-gradient(100deg, rgba(30, 12, 25, .96), rgba(52, 20, 37, .78)), url(${apiAssetUrl(`/branding/rating-banner?v=${encodeURIComponent(data.branding.updatedAt ?? '')}`)})` } : undefined}
    >
      <Link className="home-player-summary" to="/rating" aria-label="Открыть рейтинг игроков">
        <small>ИГРОК</small>
        <h1>{playerName(data.user)}</h1>
        <span>Ваша позиция</span>
        <strong>#{data.user.rank}</strong>
        <em>из {data.user.totalUsers}</em>
      </Link>
      <div className="home-tournament-summary">
        <small>БЛИЖАЙШИЙ ТУРНИР</small>
        {data.nextTournament && next ? <>
          <Link className="home-tournament-link" to={`/games?tournament=${data.nextTournament.id}`}>
            <div><h2>{data.nextTournament.title}</h2><p>{next.day} {next.month} · {next.time}</p><span>{data.nextTournament.participantCount}/{data.nextTournament.capacity} участников</span></div>
            <ChevronRight />
          </Link>
          {data.nextSeating?.tournament.id === data.nextTournament.id && <Link className="home-seat-inline" to={`/games?tournament=${data.nextTournament.id}`}><Armchair />Стол №{data.nextSeating.table.number} · место №{data.nextSeating.seatNumber}</Link>}
          <button
            className={`home-registration-button ${activeRegistration ? 'registered' : ''}`}
            disabled={savingRegistration || Boolean(activeRegistration) || !registrationAvailable}
            onClick={() => void registerForNextTournament()}
          >
            {activeRegistration?.status === 'WAITLISTED'
              ? <><ListOrdered />Вы в листе ожидания</>
              : activeRegistration
                ? <><Check />Вы записаны</>
                : !registrationAvailable
                  ? <><X />Регистрация закрыта</>
                  : <><UserCheck />{savingRegistration ? 'Записываем…' : data.nextTournament.participantCount >= data.nextTournament.capacity ? 'Встать в очередь' : 'Записаться'}</>}
          </button>
        </> : <Link className="home-tournament-empty" to="/games"><span>Турниры скоро появятся</span><ChevronRight /></Link>}
      </div>
    </section>
    {registrationMessage && <div className={`home-registration-message ${registrationMessage.kind}`}>{registrationMessage.kind === 'success' ? <Check /> : <X />}{registrationMessage.text}</div>}
    {data.nextSeating && data.nextSeating.tournament.id !== data.nextTournament?.id && <section className="my-seat-card card"><span><Armchair /></span><div><small>ВАША РАССАДКА · {data.nextSeating.tournament.title}</small><strong>Стол №{data.nextSeating.table.number} <i>·</i> Место №{data.nextSeating.seatNumber}</strong></div><Link to={`/games?tournament=${data.nextSeating.tournament.id}`}><ChevronRight /></Link></section>}

    <Link className="home-xp-card card" to="/profile?tab=rewards" aria-label="Открыть ранги и прогресс Club XP">
      <div className="home-xp-progress" aria-label={`Прогресс до следующего ранга: ${Math.round(xp.progress)}%`}><i style={{ width: `${xp.progress}%` }} /></div>
      <div className="home-rank-column"><small>РАНГ</small><strong>{xp.rank.name}</strong></div>
      <div className="home-xp-column"><small>CLUB XP</small><strong>{points(xp.xp)} XP</strong><span>{xp.nextRank ? `До ${xp.nextRank.name}: ${points(xp.xpToNext)} XP` : 'Максимальный ранг достигнут'}</span></div>
      <ChevronRight className="home-xp-chevron" />
    </Link>

    <DailyEngagement before={<>{leadersBlock}{resultsBlock}</>} />
  </div>;
}
