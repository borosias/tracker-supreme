# Recruiting Pipeline Tracker Setup

## Files

- `src/` — React tracker UI.
- `apps-script/Code.gs` — Google Apps Script backend for Google Sheets, optional LinkedIn enrichment, and Google Calendar sync.

## Google Sheet + Apps Script

1. Create a Google Sheet for the tracker.
2. Open `Extensions -> Apps Script`.
3. Paste `apps-script/Code.gs` into `Code.gs`.
4. Open `Project Settings -> Script Properties` and add:
   - `APIFY_TOKEN`: optional. Used only as a fallback when public LinkedIn metadata is unavailable.
   - `APIFY_ACTOR_ID`: optional. Overrides the default free fallback Actor.
   - `SHARED_SECRET`: optional, but recommended. Use the same value in the tracker API settings.
   - `SPREADSHEET_ID`: optional if the script is bound to the Sheet; required only for standalone Apps Script projects.
5. Deploy as `Web app`:
   - Execute as: `Me`.
   - Who has access: choose the narrowest option that still lets your tracker call it. If using a public Web App URL, set `SHARED_SECRET`.
6. Copy the Web App URL into the tracker `API -> Подключение` tab.

The script creates these tabs automatically on first call: `Processes`, `Events`, `Contacts`, `Sources`, `Settings`, `Diagnostics`.

When updating an existing deployment, create a **new version** of the same Web App deployment. Do not create a second spreadsheet or replace the current Web App URL. Schema evolution appends missing columns and preserves existing/custom columns.

## Data Model

The main card is a `HiringProcess`. It stores current state for fast UI:

- `hiringStage`: application, recruiter talk, HR screen, tech interview, client/final interview, pre-offer final, offer.
- `workState`: active, waiting, action required, paused, lost, offer received, offer accepted, offer declined.
- `statusReason`: client rejected, failed interview, position closed, internal hire, recruiter ghosted, project postponed, no budget, other.
- `blockerReason`, `blockerNote`, `blockedAt`, `blockerReviewDate`: an optional temporary obstacle that does not replace the hiring stage or work state.

Every meaningful change also gets an `Events` row, so a process can be paused or lost at any stage without losing where it happened.

Use `waiting` only after an outbound action was completed and an external reply is expected. Use a blocker when the next action cannot happen yet (for example, a LinkedIn connection is pending or Djinni does not allow an application). Use `paused` for an intentional delay and `lost` only for a terminal outcome.

## Import Rules

- LinkedIn: Apps Script first reads public JSON-LD/OpenGraph profile metadata directly. This path is free and does not call Apify.
- LinkedIn fallback: if the public response is blocked or has no metadata and `APIFY_TOKEN` is configured, Apps Script calls the default free Actor. `APIFY_ACTOR_ID` can switch providers without a code deployment.
- Provider independence: enrichment failure never blocks creating a process; the tracker preserves the URL and opens a manual draft.
- Masked provider values such as `******` are treated as missing data. The recruiter title remains empty instead of storing the mask, while the vacancy role defaults to `Senior Frontend Developer` because LinkedIn profile parsing cannot infer the vacancy discussed in direct messages.
- Djinni: the tracker sends URL/text to Apps Script; Apps Script parses pasted public text and preserves the raw source.
- Manual fallback: if enrichment fails, the tracker opens a draft with source URL/text preserved.

## Import Diagnostics

- Open `API -> Диагностика` to see the latest 50 import runs.
- `Проблемы` shows fallbacks and errors; `Все` also includes successful imports.
- Expand a row to see the exact ordered stages: input validation, public LinkedIn request/parse, Apify configuration/request/parse, and final result.
- `Безопасный JSON` and `Копировать JSON` omit tokens, secrets, authorization headers, cookies, raw HTML, and payloads.
- `Повторить импорт` returns the source to the import screen without automatically sending a request.
- Diagnostics are kept to the latest 500 rows. `Очистить журнал` removes diagnostic history only; it does not modify hiring processes.

After deploying the update, test one normally public LinkedIn profile and one profile that previously produced `N/A`. The second should now either identify the exact blocked/provider stage or open a manual draft with a concrete reason code.

## Calendar Rules

- `nextActionType = interview` with date and time creates a timed Google Calendar event.
- Other next actions create all-day reminders.
- The Calendar event ID is saved back to the `Processes` row and an event is appended to `Events`.
