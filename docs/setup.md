# Recruiting Pipeline Tracker Setup

## Files

- `recruiting-pipeline-tracker.jsx` — React component for the tracker UI.
- `recruiting-pipeline-apps-script.gs` — Google Apps Script backend for Google Sheet, Apify enrichment, and Google Calendar sync.

## Google Sheet + Apps Script

1. Create a Google Sheet for the tracker.
2. Open `Extensions -> Apps Script`.
3. Paste `recruiting-pipeline-apps-script.gs` into `Code.gs`.
4. Open `Project Settings -> Script Properties` and add:
   - `APIFY_TOKEN`: your Apify token for LinkedIn enrichment.
   - `SHARED_SECRET`: optional, but recommended. Use the same value in the tracker API settings.
   - `SPREADSHEET_ID`: optional if the script is bound to the Sheet; required only for standalone Apps Script projects.
5. Deploy as `Web app`:
   - Execute as: `Me`.
   - Who has access: choose the narrowest option that still lets your tracker call it. If using a public Web App URL, set `SHARED_SECRET`.
6. Copy the Web App URL into the tracker `API` tab.

The script creates these tabs automatically on first call: `Processes`, `Events`, `Contacts`, `Sources`, `Settings`.

## Data Model

The main card is a `HiringProcess`. It stores current state for fast UI:

- `hiringStage`: application, recruiter talk, HR screen, tech interview, client/final interview, pre-offer final, offer.
- `workState`: active, waiting, action required, paused, lost, offer received, offer accepted, offer declined.
- `statusReason`: client rejected, failed interview, position closed, internal hire, recruiter ghosted, project postponed, no budget, other.

Every meaningful change also gets an `Events` row, so a process can be paused or lost at any stage without losing where it happened.

## Import Rules

- LinkedIn: the tracker sends the URL to Apps Script; Apps Script calls Apify. The React app never stores Apify tokens.
- Djinni: the tracker sends URL/text to Apps Script; Apps Script parses pasted public text and preserves the raw source.
- Manual fallback: if enrichment fails, the tracker opens a draft with source URL/text preserved.

## Calendar Rules

- `nextActionType = interview` with date and time creates a timed Google Calendar event.
- Other next actions create all-day reminders.
- The Calendar event ID is saved back to the `Processes` row and an event is appended to `Events`.

