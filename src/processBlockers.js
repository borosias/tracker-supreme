export const BLOCKER_REASONS = {
  connection_pending: 'Рекрутер ещё не принял заявку',
  messaging_unavailable: 'Нельзя написать на платформе',
  contact_missing: 'Нет доступного контакта',
  application_unavailable: 'Нельзя отправить отклик',
  awaiting_introduction: 'Ожидается знакомство / рекомендация',
  materials_missing: 'Не хватает материалов',
  scheduling_constraint: 'Ограничение по времени',
  platform_restriction: 'Ограничение платформы',
  other: 'Другое',
};

export const PAUSE_REASONS = {
  project_postponed: 'Проект перенесли',
  waiting_for_timing: 'Вернуться позже',
  candidate_deprioritized: 'Временно не в приоритете',
  mutual_pause: 'Пауза по договорённости',
  other: 'Другое',
};

export const LOST_REASONS = {
  client_rejected: 'Клиент отказался',
  failed_interview: 'Не прошёл интервью',
  position_closed: 'Позицию закрыли',
  internal_hire: 'Закрыли внутренним кандидатом',
  recruiter_ghosted: 'Рекрутер пропал',
  no_response_after_followups: 'Нет ответа после follow-up',
  candidate_withdrew: 'Сам отказался',
  no_budget: 'Нет бюджета',
  other: 'Другое',
};

const BLOCKER_REASON_ORDER = {
  linkedin: [
    'connection_pending',
    'messaging_unavailable',
    'contact_missing',
    'platform_restriction',
    'awaiting_introduction',
    'materials_missing',
    'scheduling_constraint',
    'application_unavailable',
    'other',
  ],
  djinni: [
    'application_unavailable',
    'contact_missing',
    'platform_restriction',
    'materials_missing',
    'messaging_unavailable',
    'awaiting_introduction',
    'scheduling_constraint',
    'connection_pending',
    'other',
  ],
  default: Object.keys(BLOCKER_REASONS),
};

const ACTIVE_WORK_STATES = new Set(['active', 'waiting', 'action_required', 'offer_received']);

const isValidDateOnly = (value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const isProcessBlocked = (process) => Boolean(String(process?.blockerReason || '').trim());

export const getBlockerReasonOptions = (sourceType) => {
  const order = BLOCKER_REASON_ORDER[sourceType] || BLOCKER_REASON_ORDER.default;
  return order.map((key) => ({ key, label: BLOCKER_REASONS[key] }));
};

export const sortBlockedProcesses = (processes) =>
  [...processes].sort((a, b) => {
    const reviewComparison = (a.blockerReviewDate || '9999-12-31').localeCompare(b.blockerReviewDate || '9999-12-31');
    if (reviewComparison) return reviewComparison;
    return (a.blockedAt || '9999-12-31T23:59:59Z').localeCompare(b.blockedAt || '9999-12-31T23:59:59Z');
  });

export const partitionTodayItems = (processes, today) => {
  const active = processes.filter((process) => ACTIVE_WORK_STATES.has(process.workState));
  const blocked = sortBlockedProcesses(active.filter(isProcessBlocked), today);
  const due = active
    .filter((process) => !isProcessBlocked(process) && process.nextActionDate && process.nextActionDate <= today)
    .sort((a, b) => a.nextActionDate.localeCompare(b.nextActionDate));
  return { blocked, due };
};

export const validateStateAction = ({ action, reason, note, reviewDate = '' }) => {
  const errors = {};
  const normalizedReason = String(reason || '').trim();
  const normalizedNote = String(note || '').trim();

  if (!normalizedReason) {
    errors.reason = action === 'blocker'
      ? 'Выберите причину блокера.'
      : action === 'pause'
        ? 'Выберите причину паузы.'
        : 'Выберите причину завершения.';
    return errors;
  }
  if (normalizedReason === 'other' && !normalizedNote) errors.note = 'Опишите причину.';
  if (action === 'blocker' && reviewDate && !isValidDateOnly(reviewDate)) {
    errors.reviewDate = 'Укажите корректную дату проверки.';
  }
  return errors;
};

export const suggestNextAction = (process) => {
  if (['connection_pending', 'messaging_unavailable', 'contact_missing'].includes(process?.blockerReason)) {
    return 'Написать рекрутеру';
  }
  if (process?.blockerReason === 'application_unavailable') return 'Отправить отклик';
  return 'Продолжить процесс';
};

export const buildResolveBlockerPatch = (process, today) => ({
  blockerReason: '',
  blockerNote: '',
  blockedAt: '',
  blockerReviewDate: '',
  workState: 'action_required',
  nextActionDate: today,
  nextActionType: 'follow_up',
  nextActionNote: suggestNextAction(process),
});

export const buildResumePatch = (today) => ({
  workState: 'action_required',
  statusReason: '',
  statusNote: '',
  nextActionDate: today,
  nextActionType: 'follow_up',
});
