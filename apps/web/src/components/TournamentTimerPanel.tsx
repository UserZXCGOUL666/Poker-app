import {
  ArrowDown, ArrowUp, Copy, Edit3, ExternalLink, FastForward, Maximize2, Pause, Play,
  Plus, Rewind, Save, TimerReset, Trash2, X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../lib/api';
import { blindLabel, resolveTimerDisplay, timerClock, timerDuration } from '../lib/tournamentTimer';
import type { TournamentTimer, TournamentTimerLevelKind } from '../types';
import { Loading } from './Loading';

type DraftLevel = {
  key: string;
  kind: TournamentTimerLevelKind;
  durationMinutes: string;
  smallBlind: string;
  bigBlind: string;
  ante: string;
  label: string;
};

const makeKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function toDraft(timer: TournamentTimer): DraftLevel[] {
  return timer.levels.map((level) => ({
    key: level.id || makeKey(),
    kind: level.kind,
    durationMinutes: String(Math.max(1, Math.round(level.durationSeconds / 60))),
    smallBlind: level.smallBlind == null ? '' : String(level.smallBlind),
    bigBlind: level.bigBlind == null ? '' : String(level.bigBlind),
    ante: level.ante == null ? '' : String(level.ante),
    label: level.label ?? ''
  }));
}

export function TournamentTimerPanel({ tournamentId, onNotice, compact = false }: { tournamentId: string; onNotice: (message: string) => void; compact?: boolean }) {
  const [timer, setTimer] = useState<TournamentTimer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftLevel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const next = await api<TournamentTimer>(`/admin/tournaments/${tournamentId}/timer`);
      setTimer(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть таймер');
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [tournamentId]);

  useEffect(() => { setTimer(null); setEditing(false); void load(); }, [load]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    if (timer?.status !== 'RUNNING') return;
    const poll = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(poll);
  }, [load, timer?.status]);

  const display = timer ? resolveTimerDisplay(timer, now) : null;
  const totalSeconds = useMemo(() => timer?.levels.reduce((sum, level) => sum + level.durationSeconds, 0) ?? 0, [timer]);

  async function action(payload: Record<string, unknown>, notice?: string) {
    setBusy(true); setError(null);
    try {
      const next = await post<TournamentTimer>(`/admin/tournaments/${tournamentId}/timer/action`, payload);
      setTimer(next);
      setNow(Date.now());
      if (notice) onNotice(notice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить таймер');
    } finally { setBusy(false); }
  }

  function openEditor() {
    if (!timer) return;
    setDraft(toDraft(timer));
    setEditing(true);
    setError(null);
  }

  async function saveStructure() {
    if (!draft.length) return setError('Добавьте хотя бы один уровень');
    const normalized = draft.map((level, index) => ({
      index,
      kind: level.kind,
      durationMinutes: numberOrNull(level.durationMinutes),
      smallBlind: numberOrNull(level.smallBlind),
      bigBlind: numberOrNull(level.bigBlind),
      ante: numberOrNull(level.ante),
      label: level.label.trim() || null
    }));
    const invalid = normalized.find((level) => level.durationMinutes == null || level.durationMinutes < 1 || (level.kind === 'LEVEL' && (level.bigBlind == null || level.bigBlind < 1)));
    if (invalid) return setError(`Заполните обязательные числовые поля в строке ${invalid.index + 1}`);
    const inconsistent = normalized.find((level) => level.kind === 'LEVEL' && (level.smallBlind ?? 0) > (level.bigBlind ?? 0));
    if (inconsistent) return setError(`Малый блайнд не может превышать большой в строке ${inconsistent.index + 1}`);

    setBusy(true); setError(null);
    try {
      const next = await post<TournamentTimer>(`/admin/tournaments/${tournamentId}/timer/structure`, {
        levels: normalized.map((level) => ({
          kind: level.kind,
          durationSeconds: Math.round((level.durationMinutes ?? 0) * 60),
          smallBlind: level.kind === 'LEVEL' ? level.smallBlind ?? 0 : null,
          bigBlind: level.kind === 'LEVEL' ? level.bigBlind : null,
          ante: level.kind === 'LEVEL' ? level.ante ?? 0 : null,
          label: level.label
        }))
      }, 'PUT');
      setTimer(next);
      setEditing(false);
      onNotice('Структура таймера сохранена');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить структуру');
    } finally { setBusy(false); }
  }

  function addLevel(kind: TournamentTimerLevelKind) {
    const previous = [...draft].reverse().find((level) => level.kind === 'LEVEL');
    const previousSmall = numberOrNull(previous?.smallBlind ?? '') ?? 25;
    const previousBig = numberOrNull(previous?.bigBlind ?? '') ?? 50;
    setDraft((items) => [...items, kind === 'BREAK'
      ? { key: makeKey(), kind, durationMinutes: '10', smallBlind: '', bigBlind: '', ante: '', label: 'Перерыв' }
      : {
          key: makeKey(), kind, durationMinutes: '15',
          smallBlind: String(previous ? previousSmall * 2 : 25),
          bigBlind: String(previous ? previousBig * 2 : 50),
          ante: previous?.ante ?? '0', label: ''
        }]);
  }

  function updateDraft(index: number, patch: Partial<DraftLevel>) {
    setDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.length) return;
    setDraft((items) => {
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function copyPublicLink() {
    const url = `${window.location.origin}/timer/${tournamentId}`;
    try { await navigator.clipboard.writeText(url); onNotice('Публичная ссылка таймера скопирована'); }
    catch { setError('Не удалось скопировать ссылку. Откройте табло и скопируйте адрес из браузера.'); }
  }

  async function enterFullscreen() {
    try { await panelRef.current?.requestFullscreen(); }
    catch { setError('Браузер не разрешил полноэкранный режим'); }
  }

  if (!timer && busy) return <Loading label="Готовим турнирный таймер…" />;
  if (!timer) return <div className="form-error">{error || 'Таймер недоступен'}<button onClick={() => void load()}>Повторить</button></div>;

  return <div ref={panelRef} className={`timer-admin-panel ${compact ? 'timer-admin-compact' : ''}`}>
    <section className={`timer-console timer-${display?.status.toLowerCase()}`}>
      <header>
        <div><span className="timer-kicker">{display?.currentLevel?.kind === 'BREAK' ? 'ПЕРЕРЫВ' : `УРОВЕНЬ ${countPlayedLevels(timer, display?.currentLevelIndex ?? 0)}`}</span><h2>{timer.tournament.title}</h2></div>
        <div className="timer-header-actions">
          <span>{timerDuration(totalSeconds)} · {timer.levels.length} этапов</span>
          <button className="button secondary timer-copy-link" onClick={() => void copyPublicLink()}><Copy size={15} />Ссылка ТВ</button>
          <button className="button secondary timer-fullscreen" onClick={() => void enterFullscreen()}><Maximize2 size={15} />На весь экран</button>
          <Link className="button secondary" to={`/timer/${tournamentId}`} target="_blank"><ExternalLink size={15} />Табло</Link>
        </div>
      </header>
      <div className="timer-stage">
        <div className="timer-current">
          <span>{display?.currentLevel?.kind === 'BREAK' ? display.currentLevel.label || 'Перерыв' : 'БЛАЙНДЫ'}</span>
          <strong className={display?.currentLevel?.kind === 'BREAK' ? 'break-value' : ''}>{display?.currentLevel ? blindLabel(display.currentLevel) : '—'}</strong>
          {display?.currentLevel?.kind === 'LEVEL' && <small>АНТЕ <b>{display.currentLevel.ante ?? 0}</b></small>}
        </div>
        <div className="timer-clock-wrap">
          <strong className="timer-clock">{timerClock(display?.remainingSeconds ?? 0)}</strong>
          <div className="timer-progress"><i style={{ width: `${progressPercent(display?.remainingSeconds ?? 0, display?.currentLevel?.durationSeconds ?? 1)}%` }} /></div>
          <span>{statusLabel(display?.status ?? timer.status)}</span>
        </div>
        <div className="timer-next">
          <span>ДАЛЕЕ</span>
          <strong>{display?.nextLevel ? blindLabel(display.nextLevel) : 'Финиш'}</strong>
          <small>{display?.nextLevel ? timerDuration(display.nextLevel.durationSeconds) : 'Последний уровень'}</small>
        </div>
      </div>
      <div className="timer-controls">
        <button className="timer-icon-control" title="Предыдущий уровень" disabled={busy || (display?.currentLevelIndex ?? 0) === 0} onClick={() => void action({ action: 'PREVIOUS' })}><Rewind /></button>
        {display?.status === 'RUNNING'
          ? <button className="timer-main-control pause" disabled={busy} onClick={() => void action({ action: 'PAUSE' }, 'Таймер поставлен на паузу')}><Pause />Пауза</button>
          : <button className="timer-main-control" disabled={busy} onClick={() => void action({ action: display?.status === 'READY' || display?.status === 'FINISHED' ? 'START' : 'RESUME' }, 'Таймер запущен')}><Play />{display?.status === 'PAUSED' ? 'Продолжить' : 'Запустить'}</button>}
        <button className="timer-icon-control" title="Следующий уровень" disabled={busy || display?.status === 'FINISHED'} onClick={() => void action({ action: 'NEXT' })}><FastForward /></button>
        <button disabled={busy} onClick={() => void action({ action: 'ADD_TIME', seconds: 60 })}><Plus />1 мин</button>
        <button disabled={busy} onClick={() => void action({ action: 'ADD_TIME', seconds: 300 })}><Plus />5 мин</button>
        <button disabled={busy} onClick={() => void action({ action: 'RESET' }, 'Таймер сброшен')}><TimerReset />Сбросить</button>
      </div>
      {error && <div className="form-error timer-error">{error}</div>}
    </section>

    <section className="timer-level-overview">
      <header><div><h3>Структура турнира</h3><p>Нажмите на этап, чтобы мгновенно перейти к нему</p></div><button className="button secondary" onClick={openEditor}><Edit3 size={16} />Изменить</button></header>
      <div className="timer-level-strip">{timer.levels.map((level, index) => <button className={`${index === display?.currentLevelIndex ? 'active' : ''} ${level.kind === 'BREAK' ? 'break' : ''}`} key={level.id} disabled={busy} onClick={() => void action({ action: 'GOTO', levelIndex: index })}><span>{level.kind === 'BREAK' ? 'ПЕРЕРЫВ' : `L${countPlayedLevels(timer, index)}`}</span><strong>{blindLabel(level)}</strong><small>{timerDuration(level.durationSeconds)}</small></button>)}</div>
    </section>

    {editing && <section className="timer-structure-editor">
      <header><div><h3>Редактор уровней</h3><p>Пустое числовое поле остаётся пустым до сохранения. Ноль не подставляется автоматически.</p></div><button className="icon-button" onClick={() => setEditing(false)}><X /></button></header>
      <div className="timer-draft-list">{draft.map((level, index) => <article className={level.kind === 'BREAK' ? 'break' : ''} key={level.key}>
        <div className="timer-draft-order"><strong>{index + 1}</strong><button type="button" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></button><button type="button" disabled={index === draft.length - 1} onClick={() => move(index, 1)}><ArrowDown /></button></div>
        <label>Тип<select value={level.kind} onChange={(event: ChangeEvent<HTMLSelectElement>) => updateDraft(index, { kind: event.target.value as TournamentTimerLevelKind })}><option value="LEVEL">Уровень</option><option value="BREAK">Перерыв</option></select></label>
        <label>Минут<input type="number" min="1" max="360" value={level.durationMinutes} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft(index, { durationMinutes: event.target.value })} /></label>
        {level.kind === 'LEVEL' ? <>
          <label>Малый<input type="number" min="0" value={level.smallBlind} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft(index, { smallBlind: event.target.value })} /></label>
          <label>Большой<input type="number" min="1" value={level.bigBlind} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft(index, { bigBlind: event.target.value })} /></label>
          <label>Анте<input type="number" min="0" value={level.ante} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft(index, { ante: event.target.value })} /></label>
        </> : <label className="timer-break-label">Название<input maxLength={40} value={level.label} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft(index, { label: event.target.value })} /></label>}
        <div className="timer-draft-actions"><button title="Копировать" onClick={() => setDraft((items) => [...items.slice(0, index + 1), { ...level, key: makeKey() }, ...items.slice(index + 1)])}><Copy /></button><button className="danger" title="Удалить" disabled={draft.length === 1} onClick={() => setDraft((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button></div>
      </article>)}</div>
      <div className="timer-editor-footer">
        <div><button className="button secondary" onClick={() => addLevel('LEVEL')}><Plus />Уровень</button><button className="button secondary" onClick={() => addLevel('BREAK')}><Plus />Перерыв</button></div>
        <span>Общее время: <b>{timerDuration(draft.reduce((sum, level) => sum + (numberOrNull(level.durationMinutes) ?? 0) * 60, 0))}</b></span>
        <button className="button primary" disabled={busy} onClick={() => void saveStructure()}><Save />{busy ? 'Сохраняем…' : 'Сохранить структуру'}</button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </section>}
  </div>;
}

function numberOrNull(value: string) {
  if (value.trim() === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function countPlayedLevels(timer: TournamentTimer, throughIndex: number) {
  return Math.max(1, timer.levels.slice(0, throughIndex + 1).filter((level) => level.kind === 'LEVEL').length);
}

function progressPercent(remaining: number, duration: number) {
  return Math.max(0, Math.min(100, remaining / duration * 100));
}

function statusLabel(status: TournamentTimer['status']) {
  return { READY: 'Готов к запуску', RUNNING: 'Игра идёт', PAUSED: 'Пауза', FINISHED: 'Таймер завершён' }[status];
}
