# Tracker Supreme Process Blockers Design

Date: 2026-06-22

## 1. Goal

Represent temporary obstacles in recruiter workflows without confusing them with normal waiting, an intentional pause, or a terminal loss. The model must work for LinkedIn direct outreach, Djinni applications, referrals, missing candidate materials, and future channels.

This is a separate domain feature from import diagnostics. Both may ship in the same release, but diagnostic failures must never mutate recruiting-process state automatically.

## 2. Decision model

Every process has four independent concepts:

| Concept | Question | Examples |
|---|---|---|
| Hiring stage | Where is the process? | Application, recruiter talk, HR screen, technical interview |
| Work state | Whose action or attention is next? | Active, waiting, action required, paused |
| Blocker | What temporarily prevents the next useful action? | Connection request pending, messaging unavailable, missing contact |
| Outcome | Why did the process end? | Client rejected, interview failed, position closed |

The same process can be at `recruiter_talk`, have `workState = action_required`, and carry a temporary blocker. Removing the blocker does not erase or guess the stage.

## 3. Boundary rules

### Waiting

Use `waiting` after a valid outbound action has happened and an external response is expected. Examples: a LinkedIn message was delivered, a Djinni application was submitted, or the recruiter promised feedback.

Waiting is not a blocker because the communication path works and the next action has already happened.

### Blocked

Use a blocker when the next intended action cannot be performed because a prerequisite or channel is unavailable. Examples: the recruiter has not accepted a LinkedIn connection request, messaging is unavailable, contact data is missing, or an introduction is still required.

A blocker is temporary, reversible, and orthogonal to `workState`. It does not set `lost` or `paused`.

### Paused

Use `paused` when the process is deliberately not being worked for a period even though it is not terminal. Examples: the project was postponed, the candidate intentionally deprioritized it, or both sides agreed to return later.

### Lost

Use `lost` only when the current opportunity is no longer expected to continue. Examples: client rejection, failed interview, closed position, internal hire, exhausted follow-ups, or candidate withdrawal.

## 4. V1 data model

`Processes` gains:

- `blockerReason`: empty when there is no active blocker;
- `blockerNote`: operator context, free text;
- `blockedAt`: ISO timestamp;
- `blockerReviewDate`: date on which the process should return to attention.

The active-blocker predicate is `Boolean(blockerReason)`. No extra boolean is stored, avoiding contradictory states such as `isBlocked = false` with a non-empty reason.

`Events` gains `blockerReason`. The existing event `note` stores blocker context or resolution notes.

New event types:

- `blocker_added`;
- `blocker_resolved`;
- `resumed` is exposed for paused processes.

Every blocker change is append-only in event history while the current active blocker remains denormalized on the process for fast UI reads.

## 5. Reason taxonomy

Blocker reasons are channel-neutral codes with source-aware ordering in the UI:

- `connection_pending`: recruiter has not accepted a connection request or invitation;
- `messaging_unavailable`: the platform does not allow a message or InMail;
- `contact_missing`: no usable recruiter contact is available;
- `application_unavailable`: an application cannot currently be submitted on the platform;
- `awaiting_introduction`: waiting for a referral or warm introduction before contact;
- `materials_missing`: CV, portfolio, answers, or other candidate information is required first;
- `scheduling_constraint`: a time-zone or availability constraint prevents the next step;
- `platform_restriction`: account limit, temporary restriction, or platform problem;
- `other`: requires a non-empty note.

For `sourceType = linkedin`, connection and messaging reasons appear first. For `sourceType = djinni`, application, contact, and platform reasons appear first. All reasons remain selectable so unusual workflows are not blocked by the UI.

Pause reasons become a dedicated list:

- `project_postponed`;
- `waiting_for_timing`;
- `candidate_deprioritized`;
- `mutual_pause`;
- `other`.

Lost reasons remain terminal and are adjusted for recruiter workflows:

- `client_rejected`;
- `failed_interview`;
- `position_closed`;
- `internal_hire`;
- `recruiter_ghosted`;
- `no_response_after_followups`;
- `candidate_withdrew`;
- `no_budget`;
- `other`.

No status action silently substitutes `project_postponed` or `other`. Pause, lost, and blocker actions require an explicit reason. `other` additionally requires a note.

## 6. Source-specific workflows

### LinkedIn direct outreach

1. Profile imported or process created.
2. If a message can be sent, `message_sent` moves the process to `waiting` and schedules a follow-up.
3. If a connection request must be accepted first, add `connection_pending` without changing the stage.
4. The default blocker review date is seven days later and remains editable.
5. When the request is accepted, resolve the blocker. The process becomes `action_required`, receives today's next-action date, and suggests `Написать рекрутеру`.
6. If follow-ups are exhausted, explicitly end the process with `no_response_after_followups` or `recruiter_ghosted`; a pending connection does not become lost automatically.

### Djinni application

1. A submitted application moves the process to `waiting`.
2. If submission is impossible because of a temporary platform or profile requirement, use `application_unavailable`, `materials_missing`, or `platform_restriction`.
3. If the vacancy is actually closed, use terminal `position_closed`, not a blocker.
4. If the recruiter replies, `reply_received` moves the process back to active work and clears no blocker automatically; an explicit blocker must be resolved so history remains truthful.

### Referral or introduction

Use `awaiting_introduction` only while contact cannot reasonably happen without the intermediary. Once the introduction arrives, resolve the blocker and schedule the outreach action.

### Candidate-owned prerequisite

Use `materials_missing` for CV, portfolio, screening answers, or another concrete prerequisite. The blocker review date should be near-term and the note states what must be prepared.

## 7. Interaction design

### Process drawer

The current ambiguous `Быстрое событие` block is split into two sections.

`Коммуникация` contains lightweight actions with an optional note:

- message sent;
- reply received;
- interview scheduled;
- offer received where applicable.

`Состояние процесса` contains explicit actions:

- add blocker;
- pause;
- end process;
- resolve blocker when blocked;
- resume when paused;
- reopen when lost.

Selecting a state action opens a focused inline form containing only the fields relevant to that action. It has `Отмена` and a specific submit label such as `Поставить блокер`. The reason selector is never shown when it will be ignored.

### Blocker form

The form contains:

- required reason;
- optional note, required for `other`;
- review date defaulting to seven days from today;
- concise explanation that the hiring stage and current process history remain unchanged.

### Visible blocker state

Blocked cards keep the normal work-state pill and add a separate amber blocker badge with text. The drawer shows reason, note, blocked date, review date, `Снять блокер`, and `Изменить` controls.

Blocked state is never communicated by color alone.

### Today and funnel

`Дела` gains a `Блокеры` section above the normal due list. It contains blocked active processes sorted by overdue review date, then review date, then blocked date.

Blocked processes are excluded from the ordinary due-action list to avoid duplicate cards, but remain active in funnel and statistics. Their stage does not change.

The header and statistics expose a blocked count. Funnel cards retain their stage placement and show the blocker badge.

## 8. Resolve, resume, and reopen behavior

Resolving a blocker:

- appends `blocker_resolved` with the previous reason and optional resolution note;
- clears all current blocker fields;
- sets `workState = action_required`;
- sets `nextActionDate` to today;
- suggests a source-aware next action (`Написать рекрутеру` for connection/messaging blockers, `Отправить отклик` for application blockers, or `Продолжить процесс` otherwise).

Resuming a pause:

- appends `resumed`;
- clears the pause status reason and note;
- sets `workState = action_required` and schedules today.

Reopening a lost process is allowed but explicit. It appends `resumed`, clears the terminal reason, and schedules an action for today. Historical loss events remain immutable.

## 9. Form editing and validation

The full process form shows blocker fields only when an active blocker exists. New blockers are created through the focused action form so a partial blocker cannot be saved accidentally.

Validation rules:

- blocker, pause, and lost actions require a reason;
- `other` requires a note;
- blocker review date must be a valid date when supplied;
- resolving a blocker is idempotent in the backend-facing update path;
- terminal offer states cannot receive a blocker without first reopening the process.

## 10. Accessibility and responsive behavior

- State-action forms use semantic labels and native controls.
- Expand/cancel/confirm actions are keyboard operable.
- Error text is linked to its field and announced through an accessible status region.
- Buttons meet 44px touch targets on narrow screens.
- On mobile, action sections and forms stack in one column without horizontal scrolling.
- Reason text and icons accompany color badges.

## 11. Testing

Pure frontend tests cover:

- active-blocker detection;
- source-aware reason ordering;
- blocked-process separation from ordinary due work;
- blocker sorting;
- required reason and `other` note validation;
- resolve behavior and suggested next action;
- pause/lost actions rejecting an empty reason.

Apps Script tests cover persistence of new process/event fields and schema evolution without dropping existing columns.

Rendered validation covers:

- add and resolve blocker;
- pause and resume;
- end and reopen;
- LinkedIn and Djinni reason ordering;
- desktop and narrow layouts;
- keyboard expansion and visible validation errors.

## 12. Migration to v2

V2 stores blockers in `process_blockers` with `workspace_id`, `process_id`, reason, note, review date, created/resolved timestamps, actor IDs, and resolution note. A partial unique index permits only one active blocker per process. `hiring_processes.active_blocker_id` may cache the active relation for common reads.

Permissions follow process-edit permissions. Blocker creation and resolution become auditable domain commands. Workspace-specific reason catalogs can be introduced later without changing the initial stable system codes.
