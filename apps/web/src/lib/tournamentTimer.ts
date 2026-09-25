import type { TournamentTimer } from '../types';

export function resolveTimerDisplay(timer: TournamentTimer, nowMs = Date.now()) {
  let currentLevelIndex = timer.currentLevelIndex;
  let remainingSeconds = timer.remainingSeconds;
  let status = timer.status;
  if (status === 'RUNNING') {
    remainingSeconds -= Math.max(0, Math.floor((nowMs - new Date(timer.serverNow).getTime()) / 1000));
    while (remainingSeconds <= 0 && currentLevelIndex < timer.levels.length - 1) {
      const overflow = Math.max(0, -remainingSeconds);
      currentLevelIndex += 1;
      remainingSeconds = timer.levels[currentLevelIndex].durationSeconds - overflow;
    }
    if (remainingSeconds <= 0 && currentLevelIndex === timer.levels.length - 1) {
      status = 'FINISHED';
      remainingSeconds = 0;
    }
  }
  return {
    status,
    currentLevelIndex,
    remainingSeconds: Math.max(0, remainingSeconds),
    currentLevel: timer.levels[currentLevelIndex] ?? null,
    nextLevel: timer.levels[currentLevelIndex + 1] ?? null
  };
}

export function timerClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function timerDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return [hours ? `${hours} ч` : '', minutes ? `${minutes} мин` : ''].filter(Boolean).join(' ') || '0 мин';
}

export function blindLabel(level: Pick<TournamentTimer['levels'][number], 'kind' | 'smallBlind' | 'bigBlind' | 'label'>) {
  if (level.kind === 'BREAK') return level.label || 'Перерыв';
  return `${level.smallBlind ?? 0} / ${level.bigBlind ?? 0}`;
}
