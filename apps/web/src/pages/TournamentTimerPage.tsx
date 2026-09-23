import { ArrowLeft, Expand, FastForward, Minimize, Pause, Play, Plus, Rewind, TimerReset } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, Loading } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { api, post } from '../lib/api';
import { blindLabel, resolveTimerDisplay, timerClock } from '../lib/tournamentTimer';
import type { TournamentTimer } from '../types';

export function TournamentTimerPage() {
  const { tournamentId = '' } = useParams();
  const { user } = useAuth();
  const [timer, setTimer] = useState<TournamentTimer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));

  const load = useCallback(async () => {
    try {
      const next = await api<TournamentTimer>(`/tournaments/${tournamentId}/timer`);
      setTimer(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Таймер недоступен');
    }
  }, [tournamentId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    const poll = window.setInterval(() => void load(), 10_000);
    return () => { window.clearInterval(tick); window.clearInterval(poll); };
  }, [load]);
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  async function action(payload: Record<string, unknown>) {
    if (user?.role !== 'ADMIN') return;
    setBusy(true);
    try {
      const next = await post<TournamentTimer>(`/admin/tournaments/${tournamentId}/timer/action`, payload);
      setTimer(next);
      setNow(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить таймер');
    } finally { setBusy(false); }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  if (!timer && !error) return <div className="timer-screen"><Loading label="Открываем таймер…" /></div>;
  if (!timer) return <div className="timer-screen"><ErrorState message={error ?? 'Таймер не найден'} /></div>;
  const display = resolveTimerDisplay(timer, now);
  const levelNumber = Math.max(1, timer.levels.slice(0, display.currentLevelIndex + 1).filter((level) => level.kind === 'LEVEL').length);
  const progress = display.currentLevel ? Math.max(0, Math.min(100, display.remainingSeconds / display.currentLevel.durationSeconds * 100)) : 0;

  return <main className={`timer-screen ${display.currentLevel?.kind === 'BREAK' ? 'is-break' : ''}`}>
    <header className="timer-screen-header">
      <Link to={user?.role === 'ADMIN' ? `/admin?section=tournaments&intent=openTournament&target=${tournamentId}` : '/games'}><ArrowLeft />Назад</Link>
      <div><span>POKER CLUB</span><strong>{timer.tournament.title}</strong></div>
      <button onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize /> : <Expand />}{fullscreen ? 'Свернуть' : 'На весь экран'}</button>
    </header>

    <section className="timer-screen-body">
      <div className="timer-screen-level"><span>{display.currentLevel?.kind === 'BREAK' ? 'ПЕРЕРЫВ' : `УРОВЕНЬ ${levelNumber}`}</span><strong>{display.currentLevel ? blindLabel(display.currentLevel) : '—'}</strong>{display.currentLevel?.kind === 'LEVEL' && <small>АНТЕ <b>{display.currentLevel.ante ?? 0}</b></small>}</div>
      <div className="timer-screen-clock"><strong>{timerClock(display.remainingSeconds)}</strong><div><i style={{ width: `${progress}%` }} /></div><span>{display.status === 'RUNNING' ? 'ИГРА ИДЁТ' : display.status === 'PAUSED' ? 'ПАУЗА' : display.status === 'FINISHED' ? 'ТАЙМЕР ЗАВЕРШЁН' : 'ГОТОВ К ЗАПУСКУ'}</span></div>
      <div className="timer-screen-next"><span>СЛЕДУЮЩИЙ ЭТАП</span><strong>{display.nextLevel ? blindLabel(display.nextLevel) : 'Финиш'}</strong>{display.nextLevel?.kind === 'LEVEL' && <small>АНТЕ {display.nextLevel.ante ?? 0}</small>}</div>
    </section>

    {user?.role === 'ADMIN' && <footer className="timer-screen-controls">
      <button disabled={busy || display.currentLevelIndex === 0} onClick={() => void action({ action: 'PREVIOUS' })}><Rewind />Назад</button>
      {display.status === 'RUNNING'
        ? <button className="main pause" disabled={busy} onClick={() => void action({ action: 'PAUSE' })}><Pause />Пауза</button>
        : <button className="main" disabled={busy} onClick={() => void action({ action: display.status === 'PAUSED' ? 'RESUME' : 'START' })}><Play />{display.status === 'PAUSED' ? 'Продолжить' : 'Запустить'}</button>}
      <button disabled={busy || display.status === 'FINISHED'} onClick={() => void action({ action: 'NEXT' })}><FastForward />Дальше</button>
      <button disabled={busy} onClick={() => void action({ action: 'ADD_TIME', seconds: 60 })}><Plus />1 мин</button>
      <button disabled={busy} onClick={() => void action({ action: 'ADD_TIME', seconds: 300 })}><Plus />5 мин</button>
      <button disabled={busy} onClick={() => void action({ action: 'RESET' })}><TimerReset />Сброс</button>
    </footer>}
    {error && <div className="timer-screen-error">{error}</div>}
  </main>;
}
