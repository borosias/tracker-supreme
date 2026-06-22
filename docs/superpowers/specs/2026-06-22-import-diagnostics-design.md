# Tracker Supreme v1 Import Diagnostics Design

Date: 2026-06-22

## 1. Goal

Make LinkedIn import failures understandable without opening Apps Script, Apify, or Google Cloud. Every import receives a correlation ID, records the stages that actually ran, explains the first failed stage in plain Russian, and exposes a safe structured trace in the existing application UI.

The feature is for the current single-user v1 and must remain cheap, low-maintenance, responsive, and easy to migrate into the v2 backend.

## 2. Confirmed product brief

- Match the existing dark Tracker Supreme interface, typography, spacing, status colors, and responsive behavior.
- Provide full working interactions, not a static mock.
- Show recent runs as readable summaries with expandable stage timelines.
- Preserve an adequate JSON representation for copying and deeper investigation.
- Identify the failed stage, machine-readable reason code, human-readable reason, provider, timings, and fallback path.
- Avoid Cloud Console as a requirement.
- Tell the operator what to deploy and test after implementation.

## 3. Considered approaches

### Cloud Logging only

Structured `console` logs would be technically strong, but the current Apps Script project does not expose Cloud Console logs and connecting a standard Google Cloud project adds setup and permission work. It also leaves diagnostics outside the product.

### One spreadsheet row per stage

This is easy to append and query, but produces several rows for every import, makes retention noisier, and requires grouping rows for every UI read.

### One diagnostic run per row with a structured JSON trace — selected

The summary fields remain filterable spreadsheet columns while `traceJson` contains the ordered stages. One import creates one row, one API object, and one expandable UI card. The format maps cleanly to a future PostgreSQL JSONB column or dedicated telemetry store.

Apps Script also emits the same safe object through `console.log`, but the spreadsheet and application are the primary viewing path.

## 4. Storage model

Apps Script creates a `Diagnostics` sheet with these columns:

- `requestId`: opaque correlation ID such as `diag_...`;
- `action`: initially `importSource`;
- `sourceType`: `linkedin`, `djinni`, or another supported source;
- `sourceUrl`: original URL, required for retry in the current owner-only v1;
- `outcome`: `success`, `fallback`, or `failed`;
- `provider`: `linkedin_public`, `apify`, `manual`, or `parser`;
- `failedStage`: first stage that prevented the preferred result, or empty on direct success;
- `reasonCode`: stable machine-readable final reason;
- `message`: concise Russian explanation;
- `confidence`: `high`, `medium`, or `low`;
- `durationMs`: total duration;
- `startedAt` and `completedAt`: ISO timestamps;
- `traceJson`: ordered JSON array of stage entries.

History is bounded to the newest 500 runs. Cleanup happens after a successful append and never blocks the import response.

## 5. Trace contract

Each trace entry has this stable shape:

```json
{
  "sequence": 2,
  "stage": "public_parse",
  "status": "failed",
  "reasonCode": "PUBLIC_AUTHWALL",
  "message": "LinkedIn вернул страницу входа вместо публичного профиля",
  "durationMs": 8,
  "details": {
    "httpStatus": 200,
    "contentType": "text/html",
    "bodyLength": 142381,
    "pageType": "authwall",
    "hasJsonLdPerson": false,
    "hasOpenGraph": false
  }
}
```

Stages for LinkedIn are:

1. `validate_input`
2. `public_fetch`
3. `public_parse`
4. `apify_config`
5. `apify_fetch`
6. `apify_parse`
7. `finalize`

Only executed stages are stored. `finalize` always states which provider won or why a manual fallback was opened.

Initial reason codes include:

- `INVALID_LINKEDIN_URL`
- `PUBLIC_HTTP_ERROR`
- `PUBLIC_AUTHWALL`
- `PUBLIC_CHECKPOINT`
- `PUBLIC_NO_METADATA`
- `PUBLIC_FETCH_EXCEPTION`
- `APIFY_NOT_CONFIGURED`
- `APIFY_HTTP_ERROR`
- `APIFY_EMPTY_DATASET`
- `APIFY_PLACEHOLDER_ONLY`
- `APIFY_PARSE_ERROR`
- `SUCCESS_PUBLIC`
- `SUCCESS_APIFY`
- `MANUAL_FALLBACK`

Reason codes are stable API data. Russian messages may improve without changing client logic.

## 6. Privacy and safety

Diagnostics never store:

- `APIFY_TOKEN`, `SHARED_SECRET`, authorization headers, or cookies;
- complete LinkedIn HTML;
- complete raw provider responses;
- email addresses or copied source text;
- exception stacks returned to the browser.

Diagnostic details use status codes, response sizes, content types, page classifications, field-presence booleans, top-level response keys, and placeholder field names. The UI masks the profile URL for display but retains the existing URL for owner retry.

The diagnostics API uses the existing shared-secret check. Setup documentation will mark `SHARED_SECRET` as required before exposing a Web App URL beyond private owner use.

## 7. Backend behavior

`importSource_` creates a trace at the start and passes it through the LinkedIn enrichment chain. Helpers append normalized stage entries without writing to Sheets during network work.

The final diagnostic is persisted once after the import result is known. Persistence is wrapped so a logging failure adds a console warning but never changes the import result.

New API actions:

- `listDiagnostics`: returns the newest runs, default 30 and maximum 100;
- `getDiagnostic`: returns one full trace by `requestId`;
- `clearDiagnostics`: removes diagnostic rows after explicit UI confirmation.

`importSource` additionally returns `diagnosticSummary`, including `requestId`, outcome, provider, failed stage, final reason, message, duration, and stage summaries. This lets the import screen explain the current run immediately without another request.

## 8. Page classification

A successful HTTP 200 is not automatically a successful profile response. The parser classifies the HTML before extracting data:

- `profile`: useful Person JSON-LD or LinkedIn OpenGraph metadata;
- `authwall`: sign-in or authentication-wall markers;
- `checkpoint`: challenge, verification, or checkpoint markers;
- `placeholder`: only unusable values such as `N/A`;
- `unknown`: HTML lacks both profile metadata and known blocking markers.

The classification, rather than HTTP status alone, drives the reason shown to the operator.

## 9. User interface

### Import result

After an import, the Import screen shows a compact diagnostic strip above the draft action:

- provider badge;
- outcome label and plain-language message;
- duration and short request ID;
- `Показать этапы` control.

Expanding it reveals the stage timeline. Success, failure, fallback, and skipped states are communicated with icon plus text, never color alone.

### API → Diagnostics

The existing API screen gains a two-option local navigation: `Подключение` and `Диагностика`.

Diagnostics contains:

- summary counters for recent successful, fallback, and failed runs;
- `Все`, `Проблемы`, and `Успешные` filters;
- refresh control;
- newest-first run cards showing time, masked profile, provider, duration, and result;
- keyboard-accessible expandable stage timeline;
- readable details grid for each stage;
- `Повторить импорт`, `Скопировать отчёт`, and `Показать JSON` actions;
- empty, loading, API-error, and no-configuration states;
- an explicit confirmation before clearing history.

Raw JSON is secondary disclosure. The default view explains the run in human terms.

### Responsive and accessibility behavior

- Desktop cards use a summary row; narrow screens stack metadata without horizontal scrolling.
- Controls have at least 44px touch targets.
- Expanders use buttons with `aria-expanded` and associated regions.
- Status text and icons remain understandable without color.
- Copy and retry actions report success or failure through the existing toast pattern.
- Motion remains minimal and respects `prefers-reduced-motion`.

## 10. Error handling

- Diagnostics persistence failure cannot fail an otherwise successful import.
- Malformed historical `traceJson` renders a safe `Повреждённый лог` state and keeps the summary visible.
- API list failures preserve the last successfully loaded diagnostics and show a retry action.
- Retry creates a new request ID and never overwrites the previous run.
- Clear-history failure leaves current UI data untouched and reports the backend message.

## 11. Testing

Backend tests cover:

- stable trace entry shape and sequence;
- authwall/checkpoint/profile classification;
- public success, public failure to Apify success, placeholder fallback, and provider exception traces;
- redaction of secrets and raw response bodies;
- one-row persistence and 500-run retention;
- list/get/clear action contracts;
- logging failure not changing import behavior.

Frontend tests are kept at pure-function level in the current toolchain where practical: trace parsing, filters, status labels, masked profile display, and copied report formatting. Existing lint and production build remain delivery gates.

## 12. Deployment and operator checklist

After implementation:

1. Replace Apps Script `Code.gs` with the repository version.
2. Create a new version of the existing Web App deployment so its URL remains unchanged.
3. Confirm `SHARED_SECRET` matches the value saved in the application.
4. Reload the web application and open `API → Диагностика`.
5. Run one known public profile and one profile that previously produced `N/A`.
6. Verify both runs show a request ID and an understandable stage timeline.
7. Copy one JSON report and confirm it contains no tokens, full HTML, or raw provider payload.

## 13. Migration to v2

The UI consumes a diagnostic API contract rather than spreadsheet columns directly. V2 can store the same summary columns plus trace JSON in PostgreSQL, attach `workspaceId` and actor identity, enforce owner/admin permissions, and add metrics without redesigning the current screen.
