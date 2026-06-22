# Process Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flexible reversible blockers and replace the ambiguous pause/lost quick-event form with explicit recruiter-workflow actions.

**Architecture:** Blockers overlay hiring stage and work state. Current blocker fields stay on the process for fast reads while add/resolve events preserve history. Pure helpers own taxonomy, validation, sorting, and patches for LinkedIn and Djinni.

**Tech Stack:** React 19, Vite 8, Google Apps Script V8, Google Sheets, Node test runner, existing CSS and Lucide icons.

---

### Task 1: Pure blocker domain model

**Files:**
- Create: `src/processBlockers.js`
- Create: `src/processBlockers.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for blocker detection, reason ordering, validation, partitioning, sorting, and resolution**

```js
test('connection blockers resolve into outreach work', () => {
  const patch = getResolveBlockerPatch({
    blockerReason: 'connection_pending',
    sourceType: 'linkedin',
  }, '2026-06-22');
  assert.equal(patch.blockerReason, '');
  assert.equal(patch.workState, 'action_required');
  assert.equal(patch.nextActionDate, '2026-06-22');
  assert.equal(patch.nextActionNote, 'Написать рекрутеру');
});

test('other blocker requires a note', () => {
  assert.equal(validateProcessStateAction('blocker', { reason: 'other', note: '' }), 'Добавь комментарий к причине «Другое»');
});
```

- [ ] **Step 2: Add `src/processBlockers.test.js` to the test command; run tests and verify missing exports fail**

```json
"test": "node --test apps-script/Code.test.cjs src/importDiagnostics.test.js src/processBlockers.test.js"
```

- [ ] **Step 3: Implement named exports**

Export `BLOCKER_REASONS`, `PAUSE_REASONS`, `LOST_REASONS`, `isProcessBlocked`, `getBlockerReasonEntries`, `validateProcessStateAction`, `partitionDueProcesses`, `sortBlockedProcesses`, `getResolveBlockerPatch`, `getResumePatch`, and `getReasonLabel`.

Source-aware ordering changes priority only; it never hides reasons. `other` requires a trimmed note. Blocked processes are active but excluded from ordinary due work.

- [ ] **Step 4: Run tests and commit as `feat: add process blocker domain model`**

### Task 2: Apps Script schema and persistence

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/Code.test.cjs`

- [ ] **Step 1: Write failing schema tests**

Assert `Processes` includes:

```js
['blockerReason', 'blockerNote', 'blockedAt', 'blockerReviewDate']
```

Assert `Events` includes `blockerReason`. Mock an existing sheet and prove schema evolution appends missing headers without reordering or replacing populated columns.

- [ ] **Step 2: Run tests and verify missing columns/migration behavior fail**

- [ ] **Step 3: Change `ensureSchema_` to append missing headers**

An empty sheet gets the complete header row. A populated sheet keeps its header order and receives missing columns on the right. Never rewrite existing populated headers.

- [ ] **Step 4: Normalize blocker fields in `upsertProcess_` and persist `blockerReason` in `appendEvent_`**

- [ ] **Step 5: Run tests and commit as `feat: persist process blockers`**

### Task 3: Application data and blocker lists

**Files:**
- Modify: `src/RecruitingPipelineTracker.jsx`
- Modify: `src/tracker.css`

- [ ] **Step 1: Extend `cleanProcess`, `createEvent`, and event labels**

Add `blockerReason`, `blockerNote`, `blockedAt`, `blockerReviewDate`, and event types `blocker_added`, `blocker_resolved`, and `resumed`.

- [ ] **Step 2: Derive blocked and actionable work once**

```js
const { blocked, actionable } = useMemo(
  () => partitionDueProcesses(processes, todayISO(), ACTIVE_WORK_STATES),
  [processes],
);
```

Pass blocked items into Today. Show them before due work sorted by overdue review date, review date, then blocked date. Keep them active in funnel and statistics.

- [ ] **Step 3: Add a separate blocker badge and details**

Cards keep their work-state pill and add a text + icon blocker badge. The drawer shows reason, note, blocked date, and review date. Add the blocked count to Header and Stats without repeated child scans.

- [ ] **Step 4: Run tests, lint, and build; commit as `feat: surface blocked recruiting processes`**

### Task 4: Explicit communication and state actions

**Files:**
- Modify: `src/RecruitingPipelineTracker.jsx`
- Modify: `src/tracker.css`
- Modify: `src/processBlockers.js`
- Modify: `src/processBlockers.test.js`

- [ ] **Step 1: Add failing transition tests**

Prove blocker/pause/lost reject empty reasons, `other` rejects empty notes, resolve clears all blocker fields, resume clears pause fields, and reopen clears lost fields.

- [ ] **Step 2: Run tests and verify RED**

- [ ] **Step 3: Split the drawer UI into `Коммуникация` and `Состояние процесса`**

Communication actions use an optional note: message, reply, interview, and offer. State actions are add/resolve blocker, pause/resume, and end/reopen.

- [ ] **Step 4: Add a focused inline form keyed by action**

Only relevant fields appear. Blocker requires reason and review date (default +7 days); pause/lost require their own explicit reason lists; `other` requires a note. Buttons have `Отмена` and a specific confirmation label. Errors stay visible and are announced.

- [ ] **Step 5: Implement patches and immutable events**

Add blocker patch:

```js
{
  blockerReason: reason,
  blockerNote: note.trim(),
  blockedAt: new Date().toISOString(),
  blockerReviewDate: reviewDate,
}
```

Resolve uses `getResolveBlockerPatch`, schedules today, and appends `blocker_resolved`. Resume/reopen append `resumed`, clear their current reasons, and preserve old events.

- [ ] **Step 6: Run tests, lint, and build; commit as `feat: add explicit process status actions`**

### Task 5: Documentation and rendered QA

**Files:**
- Modify: `README.md`
- Modify: `docs/setup.md`

- [ ] **Step 1: Document semantics and new Sheets fields**

State the decision rule: waiting means an action was sent, blocked means the next action is impossible, paused means intentionally deferred, and lost means terminal. Document automatic append-only schema evolution.

- [ ] **Step 2: Run `npm.cmd run test`, `npm.cmd run lint`, `npm.cmd run build`, and `git diff --check`; expect exit 0**

- [ ] **Step 3: Validate rendered flows**

Exercise `drawer → add blocker → Today blockers → resolve`, `pause → resume`, and `lost → reopen` using LinkedIn and Djinni records. Check desktop/mobile layout, keyboard operation, visible validation, console health, and screenshots.

- [ ] **Step 4: Commit docs as `docs: explain process blockers`**
