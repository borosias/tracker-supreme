import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResolveBlockerPatch,
  buildResumePatch,
  getBlockerReasonOptions,
  isProcessBlocked,
  partitionTodayItems,
  sortBlockedProcesses,
  validateStateAction,
} from './processBlockers.js';

test('a blocker is active only while a reason is present', () => {
  assert.equal(isProcessBlocked({ blockerReason: 'connection_pending' }), true);
  assert.equal(isProcessBlocked({ blockerReason: '' }), false);
  assert.equal(isProcessBlocked({}), false);
});

test('prioritizes reasons for LinkedIn and Djinni without removing uncommon choices', () => {
  const linkedin = getBlockerReasonOptions('linkedin').map(({ key }) => key);
  const djinni = getBlockerReasonOptions('djinni').map(({ key }) => key);

  assert.deepEqual(linkedin.slice(0, 3), ['connection_pending', 'messaging_unavailable', 'contact_missing']);
  assert.deepEqual(djinni.slice(0, 3), ['application_unavailable', 'contact_missing', 'platform_restriction']);
  assert.equal(linkedin.includes('application_unavailable'), true);
  assert.equal(djinni.includes('connection_pending'), true);
});

test('separates active blockers from ordinary due work', () => {
  const processes = [
    { id: 'blocked', workState: 'action_required', blockerReason: 'connection_pending', blockerReviewDate: '2026-06-21', nextActionDate: '2026-06-20' },
    { id: 'due', workState: 'action_required', nextActionDate: '2026-06-22' },
    { id: 'future', workState: 'active', nextActionDate: '2026-06-23' },
    { id: 'lost', workState: 'lost', nextActionDate: '2026-06-20' },
  ];

  const result = partitionTodayItems(processes, '2026-06-22');
  assert.deepEqual(result.blocked.map(({ id }) => id), ['blocked']);
  assert.deepEqual(result.due.map(({ id }) => id), ['due']);
});

test('sorts blockers by overdue review date, review date, then blocked timestamp', () => {
  const sorted = sortBlockedProcesses([
    { id: 'later', blockerReason: 'other', blockerReviewDate: '2026-06-25', blockedAt: '2026-06-01T10:00:00Z' },
    { id: 'older', blockerReason: 'other', blockerReviewDate: '2026-06-20', blockedAt: '2026-06-02T10:00:00Z' },
    { id: 'oldest', blockerReason: 'other', blockerReviewDate: '2026-06-20', blockedAt: '2026-06-01T10:00:00Z' },
    { id: 'unscheduled', blockerReason: 'other', blockerReviewDate: '', blockedAt: '2026-05-01T10:00:00Z' },
  ], '2026-06-22');

  assert.deepEqual(sorted.map(({ id }) => id), ['oldest', 'older', 'later', 'unscheduled']);
});

test('requires explicit reasons and a note for other', () => {
  assert.deepEqual(validateStateAction({ action: 'blocker', reason: '', note: '' }), { reason: 'Выберите причину блокера.' });
  assert.deepEqual(validateStateAction({ action: 'pause', reason: 'other', note: '' }), { note: 'Опишите причину.' });
  assert.deepEqual(validateStateAction({ action: 'lost', reason: '', note: '' }), { reason: 'Выберите причину завершения.' });
  assert.deepEqual(validateStateAction({ action: 'blocker', reason: 'connection_pending', note: '', reviewDate: 'not-a-date' }), { reviewDate: 'Укажите корректную дату проверки.' });
  assert.deepEqual(validateStateAction({ action: 'blocker', reason: 'connection_pending', note: '', reviewDate: '2026-06-29' }), {});
});

test('resolving a LinkedIn connection blocker schedules outreach today', () => {
  assert.deepEqual(
    buildResolveBlockerPatch({ sourceType: 'linkedin', blockerReason: 'connection_pending' }, '2026-06-22'),
    {
      blockerReason: '',
      blockerNote: '',
      blockedAt: '',
      blockerReviewDate: '',
      workState: 'action_required',
      nextActionDate: '2026-06-22',
      nextActionType: 'follow_up',
      nextActionNote: 'Написать рекрутеру',
    },
  );
});

test('resuming a paused or lost process clears its outcome and schedules today', () => {
  assert.deepEqual(buildResumePatch('2026-06-22'), {
    workState: 'action_required',
    statusReason: '',
    statusNote: '',
    nextActionDate: '2026-06-22',
    nextActionType: 'follow_up',
  });
});
