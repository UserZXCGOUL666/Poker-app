import { Armchair, BarChart3, Check, ChevronRight, Crown, ListOrdered, Trophy, UserCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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
    try { setData(await api<HomeData>('/home')); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить главную'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;

  const next = data.nextTournament ? tournamentDate(data.nextTournament.startsAt) : null;
  const xp = clubRankProgress(data.user.clubXp);
  const activeRegistration = data.nextTournament?.registration && data.nextTournament.registration.status !== 'CANCELLED' ? data.nextTournament.registration : null;
  const registrationAvailable = Boolean(data.nextTournament && !data.nextTournament.registrationClosed && (!data.nextTournament.registrationDeadline || new Date(data.nextTournament.registrationDeadline) > new Date()));

  async function registerForNextTournament() {
    if (!data?.nextTournament || activeRegistration || !registrationAvailable || savingRegistration) return;
    setSavingRegistration(true); setRegistrationMessage(null);
    try {
      const result = await post<{ registration: { status: string } }>(`/tournaments/${data.nextTournament.id}/registration`);
      setRegistrationMessage({ kind: 'success', text: result.registration.status === 'WAITLISTED' ? 'Вы добавлены в лист ожидания' : 'Место на турнире подтверждено' });
      await load();
    } catch (cause) {
      setRegistrationMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Не удалось записаться на турнир' });
    } finally { setSavingRegistration(false); }
  }

  const leadersBlock = <section className="home-leaders card hud-data-panel">
    <header><div><Trophy /><h2>Лидеры сезона</h2></div><Link to="/rating">Рейтинг <ChevronRight /></Link></header>
    <div className="home-leader-list">{data.leaders.map((leader, index) => (
      <Link className={`home-leader-row leader-place-${index + 1}`} to="/rating" key={leader.id}>
        <span className="home-leader-place">{index === 0 ? <Crown /> : index + 1}</span>
        <Avatar firstName={leader.firstName} lastName={leader.lastName} photoUrl={leader.photoUrl} size="sm" />
        <strong>{leaderName(leader)}</strong><small>#{index + 1}</small><b>{points(leader.points)} PTS</b>
      </Link>
    ))}</div>
  </section>;

  const resultsBlock = <section className="home-results-block card hud-data-panel">
    <header><div><BarChart3 /><h2>Ваши результаты</h2></div></header>
    <div className="home-result-metrics">
      <div><span>Турниров</span><strong>{data.gamesPlayed}</strong></div>
      <div><span>Финальных столов</span><strong>{data.finalTables}</strong></div>
      <div><span>Побед</span><strong>{data.wins}</strong></div>
    </div>
    <Link className="home-full-stats" to="/profile?tab=overview">Полная статистика <ChevronRight /></Link>
  </section>;

  const rankProgress = Math.max(4, Math.min(100, xp.progress));
  return <div className="page home-page hud-home-v2">
    <div className="hud-home-kicker"><span>PLAYER / DASHBOARD</span><b>{data.season?.name ?? 'Новый сезон'} · W{data.week}</b></div>

    <section className="hud-command-card">
      <div className="hud-command-copy">
        <small>PLAYER ID</small>
        <h1>{playerName(data.user)}</h1>
        <span>ТЕКУЩАЯ ПОЗИЦИЯ</span>
        <strong>#{data.user.rank}</strong>
        <em>ИЗ {data.user.totalUsers} ИГРОКОВ</em>
      </div>
      <Link className="hud-rank-dial" to="/profile?tab=rewards" style={{ '--rank-progress': `${rankProgress * 3.6}deg` } as CSSProperties}>
        <div><span>RANK</span><strong>{xp.rank.name}</strong><b>{points(xp.xp)} XP</b></div>
      </Link>
      <div className="hud-command-footer"><span>CLUB PERFORMANCE</span><i /><span>LIVE PROFILE</span></div>
    </section>

    <section className={`hud-next-event ${data.branding?.hasRatingBanner ? 'has-banner' : ''}`} style={data.branding?.hasRatingBanner ? { backgroundImage: `linear-gradient(90deg, rgba(8,9,10,.98), rgba(8,9,10,.84)), url(${apiAssetUrl(`/branding/rating-banner?v=${encodeURIComponent(data.branding.updatedAt ?? '')}`)})` } : undefined}>
      <div className="hud-next-index"><small>NEXT EVENT</small><strong>{next?.day ?? '--'}</strong><span>{next?.month ?? '---'}</span></div>
      <div className="hud-next-body">
        <small>БЛИЖАЙШИЙ ТУРНИР</small>
        {data.nextTournament && next ? <>
          <Link to={`/games?tournament=${data.nextTournament.id}`} className="hud-next-link"><h2>{data.nextTournament.title}</h2><p>{next.time} · {data.nextTournament.participantCount}/{data.nextTournament.capacity} игроков</p></Link>
          {data.nextSeating?.tournament.id === data.nextTournament.id && <Link className="home-seat-inline" to={`/games?tournament=${data.nextTournament.id}`}><Armchair />Стол {data.nextSeating.table.number} · место {data.nextSeating.seatNumber}</Link>}
        </> : <Link to="/games" className="hud-next-link"><h2>Турниры скоро появятся</h2><p>Открыть календарь клуба</p></Link>}
      </div>
      {data.nextTournament && <button className={`hud-event-action ${activeRegistration ? 'registered' : ''}`} disabled={savingRegistration || Boolean(activeRegistration) || !registrationAvailable} onClick={() => void registerForNextTournament()}>
        {activeRegistration?.status === 'WAITLISTED' ? <><ListOrdered />В очереди</> : activeRegistration ? <><Check />Вы записаны</> : !registrationAvailable ? <><X />Закрыто</> : <><UserCheck />{savingRegistration ? '...' : 'Записаться'}</>}
      </button>}
    </section>

    {registrationMessage && <div className={`home-registration-message ${registrationMessage.kind}`}>{registrationMessage.kind === 'success' ? <Check /> : <X />}{registrationMessage.text}</div>}
    {data.nextSeating && data.nextSeating.tournament.id !== data.nextTournament?.id && <section className="my-seat-card card"><span><Armchair /></span><div><small>ВАША РАССАДКА · {data.nextSeating.tournament.title}</small><strong>Стол №{data.nextSeating.table.number} <i>·</i> Место №{data.nextSeating.seatNumber}</strong></div><Link to={`/games?tournament=${data.nextSeating.tournament.id}`}><ChevronRight /></Link></section>}

    <section className="hud-xp-strip">
      <div><small>CLUB XP</small><strong>{points(xp.xp)}</strong></div>
      <div className="hud-xp-track"><i style={{ width: `${xp.progress}%` }} /></div>
      <span>{xp.nextRank ? `${points(xp.xpToNext)} XP ДО ${xp.nextRank.name.toUpperCase()}` : 'MAX RANK'}</span>
    </section>

    <DailyEngagement before={<>{leadersBlock}{resultsBlock}</>} />
  </div>;
}
