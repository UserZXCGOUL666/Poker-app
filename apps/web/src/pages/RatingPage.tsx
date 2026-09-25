import { Crown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { ErrorState, Loading } from '../components/Loading';
import { api } from '../lib/api';
import { points } from '../lib/format';
import type { Player } from '../types';

export function RatingPage() {
  const [players, setPlayers] = useState<(Player & { rank: number })[] | null>(null);
  const [period, setPeriod] = useState<'season' | 'week'>('season');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setPlayers(null); api<(Player & { rank: number })[]>(`/leaderboard?period=${period}`).then(setPlayers).catch((e: Error) => setError(e.message)); }, [period]);
  const filtered = useMemo(() => players?.filter((player) => `${player.firstName} ${player.lastName} ${player.username} ${player.nickname}`.toLowerCase().includes(query.toLowerCase())), [players, query]);
  if (error) return <ErrorState message={error} />;
  return <div className="page rating-page">
    <div className="page-heading"><span className="eyebrow">POKER CLUB</span><h1>Рейтинг</h1><p>Сильнейшие игроки клуба</p></div>
    <div className="segmented"><button className={period === 'season' ? 'active' : ''} onClick={() => setPeriod('season')}>Сезон</button><button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>Неделя</button></div>
    <label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти игрока" /></label>
    {!players ? <Loading label="Считаем рейтинг…" /> : <div className="ranking-table">
      {filtered?.map((player) => <div className={`ranking-row ${player.rank <= 3 ? `top-${player.rank}` : ''}`} key={player.id}>
        <span className="ranking-place">{player.rank === 1 ? <Crown size={18} /> : String(player.rank).padStart(2, '0')}</span>
        <Avatar firstName={player.firstName} lastName={player.lastName} photoUrl={player.photoUrl} size="sm" />
        <div><strong>{player.nickname || player.username || `${player.firstName} ${player.lastName ?? ''}`}</strong><span>{player.firstName} {player.lastName}</span></div>
        <b>{points(player.points)}<small> PTS</small></b>
      </div>)}
    </div>}
  </div>;
}
