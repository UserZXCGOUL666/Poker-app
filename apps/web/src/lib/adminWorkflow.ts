import type { TournamentStatus } from '../types';

export type AdminWorkflowStage = 'PREPARE' | 'CHECK_IN' | 'SEATING' | 'PUBLISH' | 'START' | 'RESULTS' | 'POINTS' | 'DONE';

export type AdminFocusTournament = {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  capacity: number;
  participantCount: number;
  status: TournamentStatus;
  registrationClosed: boolean;
  seatingPublishedAt: string | null;
  seatingVersion: number;
  season: { name: string };
  registrationCounts: { registered: number; waitlisted: number; checked_in: number; played: number; cancelled: number };
  _count: { results: number; notifications: number; tables: number; seats: number; pointBatches: number };
};

export type AdminWorkflow = {
  stage: AdminWorkflowStage;
  title: string;
  hint: string;
  action: string;
  completedSteps: number;
  steps: { id: string; label: string; state: 'done' | 'active' | 'pending' }[];
};

const labels = ['Заявки', 'Чек-ин', 'Рассадка', 'Игра', 'Результаты', 'Очки'];

export function deriveAdminWorkflow(tournament: AdminFocusTournament, now = new Date()): AdminWorkflow {
  const registrations = tournament.registrationCounts.registered + tournament.registrationCounts.checked_in + tournament.registrationCounts.played;
  const checkedIn = tournament.registrationCounts.checked_in + tournament.registrationCounts.played;
  const startsIn = new Date(tournament.startsAt).getTime() - now.getTime();
  const checkInWindow = startsIn <= 6 * 60 * 60 * 1000;

  let stage: AdminWorkflowStage;
  let title: string;
  let hint: string;
  let action: string;

  if (tournament.status === 'CANCELLED') {
    stage = 'DONE'; title = 'Турнир отменён'; hint = 'Рабочий цикл закрыт без начисления очков.'; action = 'Открыть турнир';
  } else if (tournament._count.pointBatches > 0) {
    stage = 'DONE'; title = 'Турнир полностью закрыт'; hint = 'Места сохранены, очки начислены и операции записаны в аудит.'; action = 'Посмотреть итоги';
  } else if (tournament._count.results > 0) {
    stage = 'POINTS'; title = 'Осталось начислить очки'; hint = 'Проверьте суммы и подтвердите один атомарный пакет начислений.'; action = 'Проверить и начислить';
  } else if (tournament.status === 'ACTIVE' || tournament.status === 'FINISHED') {
    stage = 'RESULTS'; title = tournament.status === 'ACTIVE' ? 'Игра идёт' : 'Нужны результаты'; hint = 'Внесите порядок мест — сохранение автоматически завершит турнир.'; action = 'Внести результаты';
  } else if (tournament.seatingPublishedAt) {
    stage = 'START'; title = 'Всё готово к старту'; hint = 'Рассадка опубликована. Запустите турнир — поздняя регистрация останется доступной.'; action = 'Начать турнир';
  } else if (tournament._count.seats > 0) {
    stage = 'PUBLISH'; title = 'Проверьте черновик рассадки'; hint = 'Места сформированы, но игроки их ещё не видят.'; action = 'Проверить и опубликовать';
  } else if (checkedIn > 0) {
    stage = 'SEATING'; title = 'Пора рассаживать игроков'; hint = `Подтверждено присутствие: ${checkedIn}. Сформируйте столы и проверьте места.`; action = 'Сформировать рассадку';
  } else if (checkInWindow && registrations > 0) {
    stage = 'CHECK_IN'; title = 'Откройте чек-ин'; hint = 'Отмечайте только тех, кто действительно пришёл. Массовой отметки здесь намеренно нет.'; action = 'Отметить присутствующих';
  } else {
    stage = 'PREPARE'; title = registrations ? 'Подготовка идёт по плану' : 'Нужны участники';
    hint = registrations ? `В основном списке ${registrations} из ${tournament.capacity}. Проверьте заявки и напоминание.` : 'Откройте список участников или дождитесь самостоятельных заявок.';
    action = 'Открыть участников';
  }

  const done = [
    registrations > 0,
    checkedIn > 0,
    Boolean(tournament.seatingPublishedAt),
    tournament.status === 'ACTIVE' || tournament.status === 'FINISHED',
    tournament._count.results > 0,
    tournament._count.pointBatches > 0
  ];
  const completedSteps = done.filter(Boolean).length;
  const activeIndex = stage === 'DONE' ? -1 : ({ PREPARE: 0, CHECK_IN: 1, SEATING: 2, PUBLISH: 2, START: 3, RESULTS: 4, POINTS: 5 } as const)[stage];
  const steps = labels.map((label, index) => ({
    id: label,
    label,
    state: done[index] ? 'done' as const : index === activeIndex ? 'active' as const : 'pending' as const
  }));

  return { stage, title, hint, action, completedSteps, steps };
}
