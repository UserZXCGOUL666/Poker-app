import {
  Armchair, ChevronLeft, ChevronRight, CircleAlert, Coins, Crown, Eye, EyeOff,
  History, Minus, Plus, RefreshCw, RotateCcw, Save, Search, Skull, Sparkles, Trash2, Trophy, UserCheck,
  UserMinus, Users, X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react';
import { api, post } from '../lib/api';
import { tournamentDate } from '../lib/format';
import type { PlayerTag, Season, Tournament, TournamentPlayerActionType, TournamentRegistrationStatus, User } from '../types';
import { Avatar } from './Avatar';
import { Loading } from './Loading';
import { TournamentTimerPanel } from './TournamentTimerPanel';

type MainUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'nickname' | 'photoUrl' | 'points' | 'clubXp'> & {
  telegramId?: string | null;
  tags?: PlayerTag[];
};

type Registration = {
  id: string;
  status: TournamentRegistrationStatus;
  createdAt: string;
  user: MainUser;
};

type TournamentDetails = Tournament & {
  season: Season;
  registrations: Registration[];
  results: { userId: string; place: number; points: number; user: MainUser }[];
  pointBatches: { id: string; createdAt: string; note: string | null; _count: { transactions: number } }[];
};

type SeatingSeat = { id: string; userId: string; seatNumber: number; user: MainUser };
type SeatingTable = { id: string; number: number; capacity: number; seats: SeatingSeat[] };
type SeatingData = {
  tournament: Pick<Tournament, 'id' | 'title' | 'startsAt' | 'status'> & { seatingPublishedAt: string | null; seatingVersion: number };
  tables: SeatingTable[];
  registrations: { id: string; userId: string; status: TournamentRegistrationStatus; user: MainUser }[];
  unseated: { id: string; userId: string; status: TournamentRegistrationStatus; user: MainUser }[];
  eligibleCount: number;
  seatedCount: number;
};

type TournamentActionType = TournamentPlayerActionType;
type TournamentAction = {
  id: string;
  type: TournamentActionType;
  value: number;
  note: string | null;
  createdAt: string;
  userId: string;
  targetUserId: string | null;
  user: MainUser;
  targetUser: MainUser | null;
  createdBy: Pick<MainUser, 'id' | 'firstName' | 'lastName' | 'username'>;
};

type MainTab = 'participants' | 'results' | 'history';

type Props = {
  initialTournamentId?: string;
  onNotice: (message: string) => void;
  onOpenTournament: (id: string) => void;
};

export function MainTournamentWorkspace({ initialTournamentId, onNotice, onOpenTournament }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [allUsers, setAllUsers] = useState<MainUser[]>([]);
  const [tournamentId, setTournamentId] = useState(initialTournamentId ?? '');
  const [details, setDetails] = useState<TournamentDetails | null>(null);
  const [seating, setSeating] = useState<SeatingData | null>(null);
  const [actions, setActions] = useState<TournamentAction[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<{ userId: string; seatId: string | null; label: string } | null>(null);
  const [seatPicker, setSeatPicker] = useState<{ tableId: string; seatNumber: number } | null>(null);
  const [seatQuery, setSeatQuery] = useState('');
  const [participantQuery, setParticipantQuery] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [bountyActorId, setBountyActorId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('participants');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceRequestRef = useRef(0);

  const loadIndex = useCallback(async () => {
    try {
      const [tournamentData, userData] = await Promise.all([
        api<Tournament[]>('/tournaments'),
        api<MainUser[]>('/admin/users')
      ]);
      const operational = tournamentData.filter((item) => item.status === 'ACTIVE' || item.status === 'UPCOMING' || (item.status === 'FINISHED' && !item._count?.results));
      const visible = operational.length ? operational : tournamentData;
      const selected = tournamentData.find((item) => item.id === tournamentId || item.id === initialTournamentId);
      setTournaments(selected && !visible.some((item) => item.id === selected.id) ? [selected, ...visible] : visible);
      setAllUsers(userData);
      setTournamentId((current) => current || initialTournamentId || operational.find((item) => item.status === 'ACTIVE')?.id || operational[0]?.id || tournamentData[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть MAIN');
    }
  }, [initialTournamentId, tournamentId]);

  const loadWorkspace = useCallback(async (id: string, quiet = false) => {
    const requestId = ++workspaceRequestRef.current;
    if (!id) { setDetails(null); setSeating(null); setActions([]); setLoading(false); return; }
    if (!quiet) {
      setLoading(true);
      setDetails(null);
      setSeating(null);
      setActions([]);
      setActiveTableId(null);
    }
    try {
      const [detailData, seatingData, actionData] = await Promise.all([
        api<TournamentDetails>(`/admin/tournaments/${encodeURIComponent(id)}`),
        api<SeatingData>(`/admin/tournaments/${encodeURIComponent(id)}/seating`),
        api<TournamentAction[]>(`/admin/tournaments/${encodeURIComponent(id)}/actions`)
      ]);
      if (requestId !== workspaceRequestRef.current) return;
      setDetails(detailData);
      setSeating(seatingData);
      setActions(actionData);
      setActiveTableId((current) => seatingData.tables.some((table) => table.id === current) ? current : seatingData.tables[0]?.id ?? null);
      setSelectedPlayer(null);
      setError(null);
    } catch (cause) {
      if (requestId === workspaceRequestRef.current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить рабочее пространство');
    } finally { if (!quiet && requestId === workspaceRequestRef.current) setLoading(false); }
  }, []);

  useEffect(() => { void loadIndex(); }, [loadIndex]);
  useEffect(() => {
    if (initialTournamentId) setTournamentId(initialTournamentId);
  }, [initialTournamentId]);
  useEffect(() => { void loadWorkspace(tournamentId); }, [loadWorkspace, tournamentId]);

  const activeTable = seating?.tables.find((table) => table.id === activeTableId) ?? seating?.tables[0] ?? null;
  const activeRegistrations = useMemo(() => (details?.registrations ?? []).filter((registration) => registration.status !== 'CANCELLED' && registration.status !== 'WAITLISTED'), [details]);
  const registeredUserIds = useMemo(() => new Set((details?.registrations ?? []).filter((registration) => registration.status !== 'CANCELLED').map((registration) => registration.user.id)), [details]);
  const addableUsers = useMemo(() => allUsers.filter((user) => !registeredUserIds.has(user.id)), [allUsers, registeredUserIds]);
  const filteredRegistrations = useMemo(() => activeRegistrations.filter((registration) => playerLabel(registration.user).toLowerCase().includes(participantQuery.toLowerCase())), [activeRegistrations, participantQuery]);
  const actionStats = useMemo(() => buildActionStats(actions), [actions]);
  const operationsLocked = details?.status === 'FINISHED' || details?.status === 'CANCELLED';

  async function refresh(message?: string) {
    await Promise.all([loadWorkspace(tournamentId, true), loadIndex()]);
    if (message) onNotice(message);
  }

  async function withBusy(operation: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция не выполнена'); }
    finally { setBusy(false); }
  }

  async function addParticipant() {
    if (!addUserId || !details) return;
    await withBusy(async () => {
      await post(`/admin/tournaments/${details.id}/registrations`, { userId: addUserId });
      setAddUserId('');
      await refresh('Игрок добавлен в турнир');
    });
  }

  async function setRegistrationStatus(registration: Registration, status: TournamentRegistrationStatus) {
    if (status === 'CHECKED_IN' && !window.confirm(`Фишки уже выданы игроку ${playerLabel(registration.user)}? Чек-ин отменить нельзя.`)) return;
    await withBusy(async () => {
      await post(`/admin/registrations/${registration.id}`, { status }, 'PATCH');
      await refresh(status === 'CHECKED_IN' ? 'Чек-ин зафиксирован' : 'Статус игрока обновлён');
    });
  }

  async function recordAction(userId: string, type: TournamentActionType, extra: Partial<{ targetUserId: string; value: number; note: string }> = {}) {
    if (!details) return;
    await withBusy(async () => {
      await post(`/admin/tournaments/${details.id}/actions`, { userId, type, value: extra.value ?? 1, targetUserId: extra.targetUserId, note: extra.note });
      await refresh(actionNotice(type, extra.value));
    });
  }

  async function generateSeating() {
    if (!details) return;
    const capacity = activeTable?.capacity ?? 10;
    await withBusy(async () => {
      const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/generate`, { capacityPerTable: capacity, onlyCheckedIn: false, force: Boolean(seating?.tournament.seatingPublishedAt) });
      setSeating(next);
      setActiveTableId(next.tables[0]?.id ?? null);
      onNotice(`Рассажено ${next.seatedCount} игроков`);
    });
  }

  async function createTable() {
    if (!details) return;
    await withBusy(async () => {
      const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/tables`, { capacity: activeTable?.capacity ?? 10 });
      setSeating(next);
      setActiveTableId(next.tables[next.tables.length - 1]?.id ?? null);
      onNotice('Новый стол создан');
    });
  }

  async function changeCapacity(delta: number) {
    if (!details || !activeTable) return;
    const capacity = Math.max(2, Math.min(10, activeTable.capacity + delta));
    if (capacity === activeTable.capacity) return;
    await withBusy(async () => {
      const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/tables/${activeTable.id}`, { capacity }, 'PATCH');
      setSeating(next);
      onNotice(`За столом №${activeTable.number}: ${capacity} мест`);
    });
  }

  async function closeTable() {
    if (!details || !activeTable) return;
    const occupied = activeTable.seats.length;
    if (!window.confirm(`Закрыть стол №${activeTable.number}?${occupied ? ` ${occupied} игроков вернутся в список без места.` : ''}`)) return;
    await withBusy(async () => {
      const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/tables/${activeTable.id}`, undefined, 'DELETE');
      setSeating(next);
      setActiveTableId(next.tables[0]?.id ?? null);
      onNotice('Стол закрыт');
    });
  }

  async function assignSeat(tableId: string, seatNumber: number, player: { userId: string; seatId: string | null; label: string }, occupant?: SeatingSeat) {
    if (!details) return;
    if (!player.seatId && occupant) return setError('Для нового игрока выберите свободное место');
    await withBusy(async () => {
      const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/assign`, { userId: player.userId, tableId, seatNumber });
      setSeating(next);
      setSelectedPlayer(null);
      setSeatPicker(null);
      setSeatQuery('');
      onNotice(occupant ? 'Игроки поменяны местами' : 'Игрок посажен за стол');
    });
  }

  async function unseat(seatId: string) {
    if (!details) return;
    await withBusy(async () => {
      const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/seats/${seatId}`, undefined, 'DELETE');
      setSeating(next);
      setSelectedPlayer(null);
      onNotice('Игрок возвращён в список без места');
    });
  }

  async function publishSeating() {
    if (!details || !seating) return;
    await withBusy(async () => {
      if (seating.tournament.seatingPublishedAt) {
        const next = await post<SeatingData>(`/admin/tournaments/${details.id}/seating/unpublish`);
        setSeating(next);
        onNotice('Рассадка скрыта');
      } else {
        const result = await post<{ seating: SeatingData; sentCount: number; failedCount: number }>(`/admin/tournaments/${details.id}/seating/publish`);
        setSeating(result.seating);
        onNotice(`Рассадка опубликована · уведомлено ${result.sentCount}`);
      }
    });
  }

  if (loading && !details) return <div className="main-workspace-loading"><Loading label="Собираем MAIN…" /></div>;

  return <div className="main-workspace">
    <header className="main-workspace-header">
      <div>
        <span>ТУРНИРНЫЙ ОПЕРАЦИОННЫЙ ЦЕНТР</span>
        <h1>MAIN</h1>
        <p>Стол, участники, таймер, выбывания, результаты и начисления без переходов между разделами.</p>
      </div>
      <div className="main-header-actions">
        <button className="button secondary" disabled={busy || !tournamentId} onClick={() => void refresh()}><RefreshCw size={16} />Обновить</button>
        {details && <button className="button ghost" onClick={() => onOpenTournament(details.id)}>Настройки турнира <ChevronRight size={15} /></button>}
      </div>
    </header>

    <div className="main-tournament-tabs" role="tablist">
      {tournaments.map((item) => <button key={item.id} className={item.id === tournamentId ? 'active' : ''} onClick={() => setTournamentId(item.id)}>
        <span>{item.status === 'ACTIVE' ? 'LIVE' : tournamentDate(item.startsAt).day}</span>
        <div><strong>{item.title}</strong><small>{item.location || tournamentDate(item.startsAt).full}</small></div>
      </button>)}
      {!tournaments.length && <p>Нет турниров для работы.</p>}
    </div>

    {error && <div className="form-error main-workspace-error"><CircleAlert size={16} />{error}</div>}

    {details && seating ? <>
      <section className="main-tournament-summary">
        <div><span>{details.season.name} · {tournamentDate(details.startsAt).full}</span><h2>{details.title}</h2><p>{details.location || 'Место не указано'}</p></div>
        <div className="main-summary-metrics">
          <article><small>Участники</small><strong>{activeRegistrations.length}</strong></article>
          <article><small>Чек-ин</small><strong>{activeRegistrations.filter((item) => item.status === 'CHECKED_IN' || item.status === 'PLAYED').length}</strong></article>
          <article><small>За столами</small><strong>{seating.seatedCount}</strong></article>
          <article><small>Статус</small><strong>{statusLabel(details.status)}</strong></article>
        </div>
      </section>

      <div className="main-command-grid">
        <section className="main-table-zone">
          <div className="main-zone-head">
            <div><span><Armchair /></span><div><h3>Игровой зал</h3><p>Нажмите на место или перетащите игрока</p></div></div>
            <div className="main-table-actions">
              <button className="button secondary" disabled={busy} onClick={() => void generateSeating()}><RotateCcw size={15} />{seating.tables.length ? 'Пересобрать' : 'Рассадить'}</button>
              <button className="button secondary" disabled={busy} onClick={() => void createTable()}><Plus size={15} />Стол</button>
              <button className={`button ${seating.tournament.seatingPublishedAt ? 'secondary' : 'primary'}`} disabled={busy || !seating.seatedCount} onClick={() => void publishSeating()}>{seating.tournament.seatingPublishedAt ? <EyeOff size={15} /> : <Eye size={15} />}{seating.tournament.seatingPublishedAt ? 'Скрыть' : 'Опубликовать'}</button>
            </div>
          </div>

          <div className="main-table-switcher">
            <button disabled={!activeTable || seating.tables.indexOf(activeTable) <= 0} onClick={() => setActiveTableId(seating.tables[Math.max(0, seating.tables.indexOf(activeTable!) - 1)]?.id ?? null)}><ChevronLeft /></button>
            <div>{seating.tables.map((table) => <button key={table.id} className={table.id === activeTable?.id ? 'active' : ''} onClick={() => setActiveTableId(table.id)}>Стол {table.number}<small>{table.seats.length}/{table.capacity}</small></button>)}</div>
            <button disabled={!activeTable || seating.tables.indexOf(activeTable) >= seating.tables.length - 1} onClick={() => setActiveTableId(seating.tables[Math.min(seating.tables.length - 1, seating.tables.indexOf(activeTable!) + 1)]?.id ?? null)}><ChevronRight /></button>
          </div>

          {activeTable ? <>
            <div className="main-table-config">
              <span>Стол №{activeTable.number}</span>
              <div className="seat-count-stepper"><button disabled={busy || activeTable.capacity <= 2} onClick={() => void changeCapacity(-1)}><Minus /></button><strong>{activeTable.capacity} мест</strong><button disabled={busy || activeTable.capacity >= 10} onClick={() => void changeCapacity(1)}><Plus /></button></div>
              <button className="main-close-table" disabled={busy} onClick={() => void closeTable()}><Trash2 />Закрыть стол</button>
            </div>
            {selectedPlayer && <div className="main-selected-player"><Armchair /><span>Выбран <strong>{selectedPlayer.label}</strong>. Нажмите на место для переноса или обмена.</span><button onClick={() => setSelectedPlayer(null)}><X /></button></div>}
            <div className="visual-poker-table">
              <div className="poker-felt"><span>POKER CLUB</span><strong>TABLE {activeTable.number}</strong><small>{activeTable.seats.length} / {activeTable.capacity}</small></div>
              {Array.from({ length: activeTable.capacity }, (_, index) => index + 1).map((seatNumber, index) => {
                const seat = activeTable.seats.find((item) => item.seatNumber === seatNumber);
                const position = seatPosition(index, activeTable.capacity);
                return <div className={`visual-seat ${seat ? 'occupied' : 'empty'} ${selectedPlayer?.userId === seat?.userId ? 'selected' : ''}`} style={position} key={seatNumber}
                  onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
                  onDrop={() => selectedPlayer && void assignSeat(activeTable.id, seatNumber, selectedPlayer, seat)}>
                  <button draggable={Boolean(seat)} disabled={busy}
                    onDragStart={() => seat && setSelectedPlayer({ userId: seat.userId, seatId: seat.id, label: playerLabel(seat.user) })}
                    onClick={() => {
                      if (selectedPlayer) return void assignSeat(activeTable.id, seatNumber, selectedPlayer, seat);
                      if (seat) setSelectedPlayer({ userId: seat.userId, seatId: seat.id, label: playerLabel(seat.user) });
                      else setSeatPicker({ tableId: activeTable.id, seatNumber });
                    }}>
                    <i>{seatNumber}</i>
                    {seat ? <><Avatar firstName={seat.user.firstName} lastName={seat.user.lastName} photoUrl={seat.user.photoUrl} size="sm" /><strong>{playerLabel(seat.user)}</strong></> : <><Plus /><strong>Свободно</strong></>}
                  </button>
                  {seat && <button className="visual-unseat" disabled={busy} title="Освободить место" onClick={() => void unseat(seat.id)}><UserMinus /></button>}
                </div>;
              })}
            </div>
          </> : <div className="main-no-table"><Armchair /><strong>Столы ещё не созданы</strong><p>Создайте пустой стол или выполните автоматическую рассадку.</p><button className="button primary" onClick={() => void createTable()}><Plus />Создать стол на 10 мест</button></div>}

          <div className="main-unseated">
            <div><h4>Без места</h4><span>{seating.unseated.length}</span></div>
            <div>{seating.unseated.map((registration) => <button draggable key={registration.id} className={selectedPlayer?.userId === registration.userId ? 'selected' : ''}
              onDragStart={() => setSelectedPlayer({ userId: registration.userId, seatId: null, label: playerLabel(registration.user) })}
              onClick={() => setSelectedPlayer({ userId: registration.userId, seatId: null, label: playerLabel(registration.user) })}>
              <Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} photoUrl={registration.user.photoUrl} size="sm" /><span><strong>{playerLabel(registration.user)}</strong><small>{registrationStatusLabel(registration.status)}</small></span><Plus />
            </button>)}{!seating.unseated.length && <p>Все доступные игроки рассажены.</p>}</div>
          </div>
        </section>

        <aside className="main-timer-zone"><TournamentTimerPanel key={details.id} tournamentId={details.id} onNotice={onNotice} compact /></aside>
      </div>

      <section className="main-lower-zone">
        <nav className="main-lower-tabs">
          <button className={activeTab === 'participants' ? 'active' : ''} onClick={() => setActiveTab('participants')}><Users />Участники <span>{activeRegistrations.length}</span></button>
          <button className={activeTab === 'results' ? 'active' : ''} onClick={() => setActiveTab('results')}><Trophy />Результаты и PTS</button>
          <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><History />Операции <span>{actions.length}</span></button>
        </nav>

        {activeTab === 'participants' && <div className="main-participants-panel">
          <div className="main-participants-toolbar">
            <div className="players-search"><Search /><input value={participantQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setParticipantQuery(event.target.value)} placeholder="Найти игрока" /></div>
            <div className="main-add-player"><select value={addUserId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setAddUserId(event.target.value)}><option value="">Добавить участника…</option>{addableUsers.map((user) => <option key={user.id} value={user.id}>{playerLabel(user)}</option>)}</select><button className="button primary" disabled={!addUserId || busy} onClick={() => void addParticipant()}><Plus />Добавить</button></div>
          </div>
          <div className="main-player-grid">{filteredRegistrations.map((registration) => {
            const stats = actionStats.get(registration.user.id) ?? emptyStats();
            const eliminated = stats.eliminated;
            return <article className={`main-player-card ${eliminated ? 'eliminated' : ''}`} key={registration.id}>
              <header><Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} photoUrl={registration.user.photoUrl} size="md" /><div><strong>{playerLabel(registration.user)}</strong><small>{registrationStatusLabel(registration.status)} · {registration.user.points} PTS · {registration.user.clubXp} XP</small></div>{eliminated && <span className="player-out"><Skull />OUT</span>}</header>
              <div className="player-action-counters"><span>R <b>{stats.rebuys}</b></span><span>RE <b>{stats.reentries}</b></span><span>B <b>{stats.bounties}</b></span><span>XP <b>+{stats.bonusXp}</b></span></div>
              <div className="main-player-actions">
                {registration.status === 'REGISTERED' && <button className="checkin" disabled={busy || operationsLocked} onClick={() => void setRegistrationStatus(registration, 'CHECKED_IN')}><UserCheck />Чек-ин</button>}
                {!eliminated && <button disabled={busy || operationsLocked} onClick={() => void recordAction(registration.user.id, 'REBUY')}><Coins />Ребай</button>}
                {eliminated ? <button disabled={busy || operationsLocked} onClick={() => void recordAction(registration.user.id, 'REENTRY')}><RotateCcw />Re-entry</button> : <button className="danger" disabled={busy || operationsLocked} onClick={() => void recordAction(registration.user.id, 'ELIMINATION')}><Skull />Выбыл</button>}
                <button disabled={busy || operationsLocked} onClick={() => setBountyActorId(registration.user.id)}><Crown />Баунти</button>
                <button disabled={busy || operationsLocked} onClick={() => void recordAction(registration.user.id, 'BONUS_XP', { value: 50, note: `Бонус турнира «${details.title}»` })}><Sparkles />+50 XP</button>
              </div>
            </article>;
          })}{!filteredRegistrations.length && <div className="main-empty-list"><Users /><strong>Игроки не найдены</strong></div>}</div>
        </div>}

        {activeTab === 'results' && <MainResultsPanel details={details} actions={actions} users={activeRegistrations.map((item) => item.user)} onSaved={() => refresh()} onNotice={onNotice} />}

        {activeTab === 'history' && <div className="main-action-history">{actions.map((action) => <article key={action.id}><span className={`action-${action.type.toLowerCase()}`}>{actionIcon(action.type)}</span><div><strong>{actionTitle(action)}</strong><small>{action.note || actionLabel(action.type)} · {tournamentDate(action.createdAt).full}</small></div><em>{playerLabel(action.createdBy)}</em></article>)}{!actions.length && <div className="main-empty-list"><History /><strong>Операций пока нет</strong></div>}</div>}
      </section>
    </> : <div className="main-empty-list"><CircleAlert /><strong>Выберите турнир</strong></div>}

    {seatPicker && seating && <div className="modal-backdrop"><div className="modal-card main-picker-modal"><header><h2>Посадить на место №{seatPicker.seatNumber}</h2><button onClick={() => setSeatPicker(null)}><X /></button></header><div className="players-search"><Search /><input autoFocus value={seatQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setSeatQuery(event.target.value)} placeholder="Имя игрока" /></div><div className="main-picker-list">{seating.unseated.filter((item) => playerLabel(item.user).toLowerCase().includes(seatQuery.toLowerCase())).slice(0, 12).map((registration) => <button key={registration.id} onClick={() => void assignSeat(seatPicker.tableId, seatPicker.seatNumber, { userId: registration.userId, seatId: null, label: playerLabel(registration.user) })}><Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} photoUrl={registration.user.photoUrl} size="sm" /><span><strong>{playerLabel(registration.user)}</strong><small>{registrationStatusLabel(registration.status)}</small></span><Armchair /></button>)}</div></div></div>}

    {bountyActorId && <div className="modal-backdrop"><div className="modal-card main-picker-modal"><header><h2>Кого выбил {playerLabel(activeRegistrations.find((item) => item.user.id === bountyActorId)?.user ?? { firstName: 'Игрок', lastName: null, username: null, nickname: null })}?</h2><button onClick={() => setBountyActorId(null)}><X /></button></header><div className="main-picker-list">{activeRegistrations.filter((item) => item.user.id !== bountyActorId && !actionStats.get(item.user.id)?.eliminated).map((registration) => <button key={registration.id} onClick={() => { const actor = bountyActorId; setBountyActorId(null); void recordAction(actor, 'BOUNTY', { targetUserId: registration.user.id }); }}><Avatar firstName={registration.user.firstName} lastName={registration.user.lastName} photoUrl={registration.user.photoUrl} size="sm" /><span><strong>{playerLabel(registration.user)}</strong><small>Баунти и выбывание</small></span><Crown /></button>)}</div></div></div>}
  </div>;
}

function MainResultsPanel({ details, actions, users, onSaved, onNotice }: { details: TournamentDetails; actions: TournamentAction[]; users: MainUser[]; onSaved: () => Promise<void>; onNotice: (message: string) => void }) {
  const initialOrder = useMemo(() => resultOrder(details, actions, users), [details, actions, users]);
  const [entries, setEntries] = useState<MainUser[]>(initialOrder);
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries(initialOrder.map((user, index) => [user.id, String(details.pointBatches.length ? details.results.find((item) => item.userId === user.id)?.points ?? 0 : defaultTournamentScore(index))])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(initialOrder);
    setScores(Object.fromEntries(initialOrder.map((user, index) => [user.id, String(details.pointBatches.length ? details.results.find((item) => item.userId === user.id)?.points ?? 0 : defaultTournamentScore(index))])));
  }, [details.id, details.results, initialOrder]);

  const placesSaved = details.results.length === entries.length && details.results.every((result, index) => result.userId === entries[index]?.id && result.place === index + 1);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    setEntries(next);
  }

  async function savePlaces() {
    if (entries.length < 2) return setError('Для результатов нужно минимум два игрока');
    setBusy(true); setError(null);
    try {
      await post(`/admin/tournaments/${details.id}/results`, { results: entries.map((user, index) => ({ userId: user.id, place: index + 1 })) }, 'PUT');
      await onSaved();
      onNotice('Места сохранены');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить места'); }
    finally { setBusy(false); }
  }

  async function awardPts() {
    const batch = entries.map((user, index) => ({ userId: user.id, amount: Number(scores[user.id]), reason: `${details.title}: ${index + 1} место` }));
    if (batch.some((item) => !Number.isInteger(item.amount) || item.amount < 1 || item.amount > 100_000)) {
      setError('PTS должны быть целыми числами от 1 до 100 000');
      return;
    }
    if (!window.confirm(`Начислить PTS ${batch.length} игрокам одной атомарной операцией?`)) return;
    setBusy(true); setError(null);
    try {
      await post('/admin/points/bulk', { tournamentId: details.id, idempotencyKey: crypto.randomUUID(), note: `Итоги турнира «${details.title}»`, entries: batch });
      await onSaved();
      onNotice(`PTS начислены ${batch.length} игрокам`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось начислить PTS'); }
    finally { setBusy(false); }
  }

  return <div className="main-results-panel">
    <div className="main-results-note"><Trophy /><div><strong>Единые результаты турнира</strong><p>Порядок выбывания уже учтён. При необходимости скорректируйте оставшиеся места стрелками.</p></div></div>
    <div className="main-results-list">{entries.map((user, index) => <article key={user.id}><span className={index < 3 ? 'podium' : ''}>{index + 1}</span><Avatar firstName={user.firstName} lastName={user.lastName} photoUrl={user.photoUrl} size="sm" /><div><strong>{playerLabel(user)}</strong><small>{index === 0 ? 'Победитель' : `${index + 1} место`}</small></div><label><input type="number" min="1" max="100000" value={scores[user.id] ?? ''} onChange={(event: ChangeEvent<HTMLInputElement>) => setScores((current) => ({ ...current, [user.id]: event.target.value }))} /><b>PTS</b></label><div><button disabled={placesSaved || index === 0} onClick={() => move(index, -1)}><ChevronLeft /></button><button disabled={placesSaved || index === entries.length - 1} onClick={() => move(index, 1)}><ChevronRight /></button></div></article>)}</div>
    {error && <div className="form-error">{error}</div>}
    <footer><button className="button secondary" disabled={busy || placesSaved || entries.length < 2} onClick={() => void savePlaces()}><Save />{placesSaved ? 'Места сохранены' : 'Сохранить места'}</button><button className="button primary" disabled={busy || !placesSaved || details.pointBatches.length > 0 || entries.some((user) => !Number.isInteger(Number(scores[user.id])) || Number(scores[user.id]) < 1 || Number(scores[user.id]) > 100_000)} onClick={() => void awardPts()}><Coins />{details.pointBatches.length ? 'PTS уже начислены' : 'Начислить PTS автоматически'}</button></footer>
  </div>;
}

function resultOrder(details: TournamentDetails, actions: TournamentAction[], users: MainUser[]) {
  if (details.results.length) return details.results.map((result) => users.find((user) => user.id === result.userId) ?? result.user).filter((user): user is MainUser => Boolean(user));
  const userMap = new Map(users.map((user) => [user.id, user]));
  const currentState = buildActionStats(actions);
  const active = users.filter((user) => !currentState.get(user.id)?.eliminated);
  const eliminations = [...actions].filter((action) => action.type === 'ELIMINATION' && currentState.get(action.userId)?.eliminated && currentState.get(action.userId)?.lastEliminationId === action.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id)).map((action) => userMap.get(action.userId)).filter((user): user is MainUser => Boolean(user));
  return [...active, ...eliminations];
}

function buildActionStats(actions: TournamentAction[]) {
  const result = new Map<string, ReturnType<typeof emptyStats>>();
  const chronological = [...actions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
  for (const action of chronological) {
    const stats = result.get(action.userId) ?? emptyStats();
    if (action.type === 'REBUY') stats.rebuys += action.value;
    if (action.type === 'REENTRY') { stats.reentries += action.value; stats.eliminated = false; }
    if (action.type === 'ELIMINATION') { stats.eliminated = true; stats.lastEliminationId = action.id; }
    if (action.type === 'BOUNTY') stats.bounties += action.value;
    if (action.type === 'BONUS_XP') stats.bonusXp += action.value;
    result.set(action.userId, stats);
  }
  return result;
}

function emptyStats() { return { rebuys: 0, reentries: 0, bounties: 0, bonusXp: 0, eliminated: false, lastEliminationId: '' }; }

function seatPosition(index: number, count: number): CSSProperties {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / count);
  const x = 50 + Math.cos(angle) * 45;
  const y = 50 + Math.sin(angle) * 43;
  return { left: `${x}%`, top: `${y}%` };
}

function playerLabel(user: { firstName: string; lastName?: string | null; username?: string | null; nickname?: string | null }) {
  return user.nickname || (user.username ? `@${user.username}` : `${user.firstName} ${user.lastName ?? ''}`.trim());
}

function defaultTournamentScore(index: number) { return [500, 350, 250, 150, 100, 75, 60, 50, 40, 30][index] ?? 20; }
function statusLabel(status: Tournament['status']) { return { UPCOMING: 'Предстоящий', ACTIVE: 'Идёт', FINISHED: 'Завершён', CANCELLED: 'Отменён' }[status]; }
function registrationStatusLabel(value: TournamentRegistrationStatus) { return { REGISTERED: 'В основном списке', WAITLISTED: 'Лист ожидания', CHECKED_IN: 'Чек-ин', PLAYED: 'Сыграл', CANCELLED: 'Отменено' }[value]; }
function actionLabel(type: TournamentActionType) { return { REBUY: 'Ребай', REENTRY: 'Повторный вход', ELIMINATION: 'Выбывание', BOUNTY: 'Баунти', BONUS_XP: 'Бонус Club XP' }[type]; }
function actionNotice(type: TournamentActionType, value = 1) { return type === 'BONUS_XP' ? `Начислено ${value} Club XP` : `${actionLabel(type)} зафиксирован`; }
function actionIcon(type: TournamentActionType) { return type === 'REBUY' ? <Coins /> : type === 'REENTRY' ? <RotateCcw /> : type === 'ELIMINATION' ? <Skull /> : type === 'BOUNTY' ? <Crown /> : <Sparkles />; }
function actionTitle(action: TournamentAction) {
  const user = playerLabel(action.user);
  if (action.type === 'BOUNTY') return `${user} выбил ${action.targetUser ? playerLabel(action.targetUser) : 'игрока'}`;
  if (action.type === 'BONUS_XP') return `${user}: +${action.value} Club XP`;
  return `${user}: ${actionLabel(action.type)}`;
}
