# Import Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, stage-by-stage import diagnostics readable inside Tracker Supreme and copyable as safe JSON.

**Architecture:** Apps Script builds one in-memory trace per import, persists one bounded summary row in `Diagnostics`, and returns the current trace. React loads history only when the diagnostics tab opens and renders readable stages with JSON as secondary disclosure.

**Tech Stack:** Google Apps Script V8, Google Sheets, React 19, Vite 8, Node test runner, existing CSS and Lucide icons.

---

### Task 1: Diagnostic trace contract

**Files:**
- Modify: `apps-script/Code.test.cjs`
- Modify: `apps-script/Code.gs`

- [ ] **Step 1: Write failing tests for stage ordering, redaction, and page classification**

```js
test('classifies blocked LinkedIn pages', () => {
  const api = loadAppsScript();
  assert.equal(api.classifyLinkedinPage_('<div class="authwall">Sign in to LinkedIn</div>'), 'authwall');
  assert.equal(api.classifyLinkedinPage_('<form action="/checkpoint/challenge/">Security verification</form>'), 'checkpoint');
});

test('adds stable ordered diagnostic stages without secrets', () => {
  const api = loadAppsScript();
  const diagnostic = api.createDiagnostic_('diag_1', 'linkedin', 'https://www.linkedin.com/in/example', '2026-06-22T10:00:00.000Z');
  api.addDiagnosticStage_(diagnostic, 'public_fetch', 'success', 'PUBLIC_HTTP_OK', 'Получен ответ', 120, {
    httpStatus: 200,
    authorization: 'Bearer secret',
  });
  assert.equal(diagnostic.trace[0].sequence, 1);
  assert.equal(diagnostic.trace[0].details.httpStatus, 200);
  assert.equal('authorization' in diagnostic.trace[0].details, false);
});
```

- [ ] **Step 2: Run `npm.cmd run test` and verify it fails for missing helpers**

- [ ] **Step 3: Implement `createDiagnostic_`, `addDiagnosticStage_`, `sanitizeDiagnosticDetails_`, and `classifyLinkedinPage_`**

```js
function addDiagnosticStage_(diagnostic, stage, status, reasonCode, message, durationMs, details) {
  diagnostic.trace.push({
    sequence: diagnostic.trace.length + 1,
    stage: stage,
    status: status,
    reasonCode: reasonCode,
    message: message,
    durationMs: Math.max(0, Number(durationMs) || 0),
    details: sanitizeDiagnosticDetails_(details || {}),
  });
  return diagnostic;
}
```

Redaction drops keys matching `token|secret|authorization|cookie|html|raw|payload`. Classification returns `profile`, `authwall`, `checkpoint`, `placeholder`, or `unknown`.

- [ ] **Step 4: Run `npm.cmd run test`; expect all tests to pass**

- [ ] **Step 5: Commit `apps-script/Code.gs` and `apps-script/Code.test.cjs` as `feat: add import diagnostic trace contract`**

### Task 2: Persistence and API

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/Code.test.cjs`

- [ ] **Step 1: Write failing tests for the sheet schema and JSON serialization**

```js
assert.deepEqual(Array.from(api.SHEETS.diagnostics.headers), [
  'requestId', 'action', 'sourceType', 'sourceUrl', 'outcome', 'provider',
  'failedStage', 'reasonCode', 'message', 'confidence', 'durationMs',
  'startedAt', 'completedAt', 'traceJson',
]);
```

Also assert malformed `traceJson` returns `trace: []` and `traceCorrupted: true`.

- [ ] **Step 2: Run `npm.cmd run test`; expect missing diagnostics schema/serializer failures**

- [ ] **Step 3: Implement `diagnosticToRow_`, `diagnosticFromRow_`, `persistDiagnostic_`, `listDiagnostics_`, `getDiagnostic_`, and `clearDiagnostics_`**

Persist one row per request. Keep newest 500 rows. Cleanup and logging failures use `console.warn` and never change the import result.

- [ ] **Step 4: Add `listDiagnostics`, `getDiagnostic`, and `clearDiagnostics` cases to `doPost`**

```js
case 'listDiagnostics':
  return json_({ ok: true, diagnostics: listDiagnostics_(payload.limit) });
case 'getDiagnostic':
  return json_({ ok: true, diagnostic: getDiagnostic_(payload.requestId) });
case 'clearDiagnostics':
  clearDiagnostics_();
  return json_({ ok: true });
```

List defaults to 30 and clamps to 1–100.

- [ ] **Step 5: Run tests and commit as `feat: persist bounded import diagnostics`**

### Task 3: Instrument LinkedIn stages

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/Code.test.cjs`

- [ ] **Step 1: Extend existing fixtures with failing trace assertions**

Cover public success, HTTP-200 authwall to Apify success, placeholder-only manual fallback, provider exception, and diagnostics persistence failure. Assert stable reason codes and that persistence failure still returns the draft.

```js
assert.deepEqual(result.diagnosticSummary.trace.map((entry) => entry.stage), [
  'validate_input', 'public_fetch', 'public_parse', 'apify_config',
  'apify_fetch', 'apify_parse', 'finalize',
]);
assert.equal(result.diagnosticSummary.reasonCode, 'SUCCESS_APIFY');
```

- [ ] **Step 2: Run tests and verify trace assertions fail**

- [ ] **Step 3: Pass one diagnostic through `importSource_`, `enrichLinkedin_`, and `enrichLinkedinFromPublicPage_`**

Record HTTP status, content type, body length, page type, metadata presence, placeholder field names, provider, timings, and final outcome. Never record HTML, tokens, payloads, emails, or raw responses.

- [ ] **Step 4: Return `diagnosticSummary` and emit the same safe object through `console.log({ message: 'import_diagnostic', ... })`**

- [ ] **Step 5: Run tests and commit as `feat: trace LinkedIn enrichment stages`**

### Task 4: Frontend model and UI

**Files:**
- Create: `src/importDiagnostics.js`
- Create: `src/importDiagnostics.test.js`
- Modify: `src/RecruitingPipelineTracker.jsx`
- Modify: `src/tracker.css`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for `parseDiagnostic`, `filterDiagnostics`, `maskDiagnosticUrl`, and `formatDiagnosticReport`**

```js
test('formats a copy-safe report', () => {
  const report = JSON.parse(formatDiagnosticReport(fixture));
  assert.equal(report.requestId, 'diag_1');
  assert.equal(report.trace[0].stage, 'public_fetch');
  assert.equal(JSON.stringify(report).includes('test-token'), false);
});
```

- [ ] **Step 2: Change the test command to include the new frontend tests; run it and verify RED**

```json
"test": "node --test apps-script/Code.test.cjs src/importDiagnostics.test.js"
```

- [ ] **Step 3: Implement named pure exports in `src/importDiagnostics.js`; run tests and verify GREEN**

- [ ] **Step 4: Add diagnostics state loaded only when `API → Диагностика` first opens**

Do not add a diagnostics request to initial `listProcesses`. Use functional state updates and derive filtered lists without mirrored effects.

- [ ] **Step 5: Add the current-run summary to Import and history to API settings**

Include counters, filters, refresh, expandable stage timeline, JSON disclosure, copy, retry, clear confirmation, loading/error/empty states, `aria-expanded`, and stable request ID keys.

- [ ] **Step 6: Add responsive `diagnostic-*` styles matching current colors, typography, radii, and 44px controls**

- [ ] **Step 7: Run test, lint, and build; commit as `feat: add import diagnostics UI`**

### Task 5: Documentation and rendered QA

**Files:**
- Modify: `README.md`
- Modify: `docs/setup.md`

- [ ] **Step 1: Document the Diagnostics sheet, 500-run retention, `SHARED_SECRET`, UI location, and Apps Script redeployment**

- [ ] **Step 2: Run `npm.cmd run test`, `npm.cmd run lint`, `npm.cmd run build`, and `git diff --check`; expect exit 0**

- [ ] **Step 3: Validate `API → Диагностика → expand → JSON → copy` and `Импорт → current trace` on desktop and mobile**

Check page identity, meaningful DOM, no framework overlay, console health, screenshot evidence, and interaction state.

- [ ] **Step 4: Commit docs as `docs: explain import diagnostics`**
