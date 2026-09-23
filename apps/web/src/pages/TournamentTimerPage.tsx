import {
  ArrowLeft, Expand, FastForward, Gauge, Minimize, Pause, Play, Plus, Rewind,
  Settings2, TimerReset, X
} from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, Loading } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { api, post } from '../lib/api';
import { blindLabel, resolveTimerDisplay, timerClock } from '../lib/tournamentTimer';
import type { TournamentTimer } from '../types';

const wallClock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const wallDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });

function Marquee({ text, speed, position }: { text: string; speed: number; position: 'top' | 'bottom' }) {
  const repeated = `${text}   ◆   ${text}   ◆   ${text}   ◆   `;
  return <div className={`hud-marquee hud-marquee-${position}`} style={{ '--ticker-speed': `${speed}s` } as CSSProperties}>
    <div><span>{repeated}</span><span aria-hidden="true">{repeated}</span></div>
  </div>;
}

export function TournamentTimerPage() {
  const { tournamentId = '' } = useParams();
  const { user } = useAuth();
  const [timer, setTimer] = useState<TournamentTimer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [topTicker, setTopTicker] = useState('');
  const [bottomTicker, setBottomTicker] = useState('');
  const [tickerSpeed, setTickerSpeed] = useState(28);

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
    if (!timer || settingsOpen) return;
    setTopTicker(timer.topTicker ?? 'POKER CLUB · ТУРНИРНАЯ СЕРИЯ · ИГРАЕМ ЧЕСТНО · РАСТЁМ ВМЕСТЕ');
    setBottomTicker(timer.bottomTicker ?? 'СЛЕДИТЕ ЗА БЛАЙНДАМИ · УВАЖАЙТЕ ДИЛЕРА · СЛЕДУЮЩИЙ УРОВЕНЬ УКАЗАН СПРАВА');
    setTickerSpeed(timer.tickerSpeed || 28);
  }, [timer?.id, timer?.updatedAt, settingsOpen]);
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

  async function saveDisplaySettings() {
    if (user?.role !== 'ADMIN') return;
    setBusy(true);
    try {
      const next = await post<TournamentTimer>(`/admin/tournaments/${tournamentId}/timer/display`, {
        topTicker: topTicker.trim() || null,
        bottomTicker: bottomTicker.trim() || null,
        tickerSpeed
      }, 'PUT');
      setTimer(next);
      setSettingsOpen(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить оформление табло');
    } finally { setBusy(false); }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  if (!timer && !error) return <div className="timer-screen hud-timer-screen"><Loading label="Открываем таймер…" /></div>;
  if (!timer) return <div className="timer-screen hud-timer-screen"><ErrorState message={error ?? 'Таймер не найден'} /></div>;

  const display = resolveTimerDisplay(timer, now);
  const levelNumber = Math.max(1, timer.levels.slice(0, display.currentLevelIndex + 1).filter((level) => level.kind === 'LEVEL').length);
  const progress = display.currentLevel ? Math.max(0, Math.min(1, display.remainingSeconds / display.currentLevel.durationSeconds)) : 0;
  const progressDegrees = Math.round(progress * 300);
  const currentBlinds = display.currentLevel ? blindLabel(display.currentLevel) : '—';
  const nextBlinds = display.nextLevel ? blindLabel(display.nextLevel) : 'ФИНИШ';
  const effectiveTopTicker = timer.topTicker || topTicker || `POKER CLUB · ${timer.tournament.title}`;
  const effectiveBottomTicker = timer.bottomTicker || bottomTicker || `УРОВЕНЬ ${levelNumber} · ${currentBlinds} · ДАЛЕЕ ${nextBlinds}`;
  const clockDate = new Date(now);

  return <main className={`timer-screen hud-timer-screen ${display.currentLevel?.kind === 'BREAK' ? 'is-break' : ''}`}>
    <Marquee text={effectiveTopTicker} speed={timer.tickerSpeed || tickerSpeed} position="top" />

    <header className="hud-timer-header">
      <Link className="hud-ghost-button" to={user?.role === 'ADMIN' ? `/admin?section=tournaments&intent=openTournament&target=${tournamentId}` : '/games'}><ArrowLeft /> Назад</Link>
      <div className="hud-timer-brand"><span className="hud-spade">♠</span><div><strong>POKER CLUB</strong><small>TOURNAMENT CONTROL</small></div></div>
      <div className="hud-wall-clock"><strong>{wallClock.format(clockDate)}</strong><span>{wallDate.format(clockDate)}</span></div>
      <div className="hud-timer-tools">
        {user?.role === 'ADMIN' && <button className="hud-icon-button" onClick={() => setSettingsOpen(true)} aria-label="Настроить табло"><Settings2 /></button>}
        <button className="hud-ghost-button" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize /> : <Expand />}<span>{fullscreen ? 'Свернуть' : 'Экран'}</span></button>
      </div>
    </header>

    <section className="hud-timer-layout">
      <aside className="hud-timer-panel hud-current-panel">
        <div className="hud-panel-kicker">ТЕКУЩИЙ ЭТАП</div>
        <h1>{display.currentLevel?.kind === 'BREAK' ? (display.currentLevel.label || 'ПЕРЕРЫВ') : timer.tournament.title}</h1>
        <div className="hud-tag-row"><span className="hot">{display.currentLevel?.kind === 'BREAK' ? 'BREAK' : `LEVEL ${levelNumber}`}</span><span>{statusLabel(display.status)}</span></div>
        <div className="hud-rule" />
        <div className="hud-stat-pair"><div><span>БЛАЙНДЫ</span><strong>{currentBlinds}</strong></div><div><span>ANTE</span><strong>{display.currentLevel?.kind === 'LEVEL' ? (display.currentLevel.ante ?? 0) : '—'}</strong></div></div>
        <div className="hud-mini-status"><Gauge /><div><span>ЭТАП</span><strong>{display.currentLevelIndex + 1} / {timer.levels.length}</strong></div></div>
      </aside>

      <section className="hud-clock-stage">
        <div className="hud-dial" style={{ '--dial-progress': `${progressDegrees}deg` } as CSSProperties}>
          <div className="hud-dial-scale" />
          <div className="hud-dial-core">
            <span>{display.currentLevel?.kind === 'BREAK' ? 'ПЕРЕРЫВ' : 'ДО СЛЕДУЮЩЕГО УРОВНЯ'}</span>
            <strong>{timerClock(display.remainingSeconds)}</strong>
            <em>{statusLabel(display.status)}</em>
          </div>
        </div>
      </section>

      <aside className="hud-timer-panel hud-next-panel">
        <div className="hud-panel-kicker">ДАЛЕЕ</div>
        <h2>{display.nextLevel?.kind === 'BREAK' ? (display.nextLevel.label || 'ПЕРЕРЫВ') : nextBlinds}</h2>
        <div className="hud-next-grid">
          <div><span>ТИП</span><strong>{display.nextLevel ? (display.nextLevel.kind === 'BREAK' ? 'ПЕРЕРЫВ' : 'БЛАЙНДЫ') : 'ФИНИШ'}</strong></div>
          <div><span>ANTE</span><strong>{display.nextLevel?.kind === 'LEVEL' ? (display.nextLevel.ante ?? 0) : '—'}</strong></div>
          <div><span>ДЛИТЕЛЬНОСТЬ</span><strong>{display.nextLevel ? `${Math.round(display.nextLevel.durationSeconds / 60)} МИН` : '—'}</strong></div>
        </div>
        <div className="hud-level-list">
          {timer.levels.slice(display.currentLevelIndex + 1, display.currentLevelIndex + 4).map((level, index) => <div key={level.id} className={index === 0 ? 'active' : ''}><span>{level.kind === 'BREAK' ? 'B' : levelNumber + index + 1}</span><strong>{blindLabel(level)}</strong><small>{Math.round(level.durationSeconds / 60)}м</small></div>)}
        </div>
      </aside>
    </section>

    {user?.role === 'ADMIN' && <footer className="hud-timer-controls">
      <button disabled={busy || display.currentLevelIndex === 0} onClick={() => void action({ action: 'PREVIOUS' })}><Rewind /><span>Назад</span></button>
      {display.status === 'RUNNING'
        ? <button className="primary pause" disabled={busy} onClick={() => void action({ action: 'PAUSE' })}><Pause /><span>Пауза</span></button>
        : <button className="primary" disabled={busy} onClick={() => void action({ action: display.status === 'PAUSED' ? 'RESUME' : 'START' })}><Play /><span>{display.status === 'PAUSED' ? 'Продолжить' : 'Запустить'}</span></button>}
      <button disabled={busy || display.status === 'FINISHED'} onClick={() => void action({ action: 'NEXT' })}><FastForward /><span>Дальше</span></button>
      <button disabled={busy} onClick={() => void action({ action: 'ADD_TIME', seconds: 60 })}><Plus /><span>1 мин</span></button>
      <button disabled={busy} onClick={() => void action({ action: 'ADD_TIME', seconds: 300 })}><Plus /><span>5 мин</span></button>
      <button disabled={busy} onClick={() => void action({ action: 'RESET' })}><TimerReset /><span>Сброс</span></button>
    </footer>}

    <Marquee text={effectiveBottomTicker} speed={Math.max(10, (timer.tickerSpeed || tickerSpeed) + 5)} position="bottom" />

    {settingsOpen && user?.role === 'ADMIN' && <div className="hud-settings-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}>
      <section className="hud-settings-panel">
        <header><div><span>DISPLAY CONTROL</span><h2>Бегущие строки</h2></div><button onClick={() => setSettingsOpen(false)}><X /></button></header>
        <label><span>Верхняя строка</span><textarea maxLength={260} rows={3} value={topTicker} onChange={(event) => setTopTicker(event.target.value)} /></label>
        <label><span>Нижняя строка</span><textarea maxLength={260} rows={3} value={bottomTicker} onChange={(event) => setBottomTicker(event.target.value)} /></label>
        <label><span>Скорость · {tickerSpeed} сек</span><input type="range" min="8" max="90" value={tickerSpeed} onChange={(event) => setTickerSpeed(Number(event.target.value))} /></label>
        <button className="hud-save-display" disabled={busy} onClick={() => void saveDisplaySettings()}>{busy ? 'Сохраняем…' : 'Сохранить для табло'}</button>
      </section>
    </div>}

    {error && <div className="timer-screen-error">{error}</div>}
  </main>;
}

function statusLabel(status: TournamentTimer['status']) {
  return { READY: 'ГОТОВ', RUNNING: 'LIVE', PAUSED: 'ПАУЗА', FINISHED: 'ЗАВЕРШЁН' }[status];
}
