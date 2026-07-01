import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterDiagnostics,
  formatDiagnosticReport,
  maskDiagnosticUrl,
  normalizeDiagnostic,
} from './importDiagnostics.js';

const fixture = {
  requestId: 'diag_1234567890',
  sourceType: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/in/ada-lovelace',
  outcome: 'fallback',
  provider: 'manual',
  reasonCode: 'APIFY_PLACEHOLDER_ONLY',
  message: 'Провайдер не вернул полезных данных',
  durationMs: 411,
  trace: [
    {
      sequence: 1,
      stage: 'public_fetch',
      status: 'success',
      reasonCode: 'PUBLIC_HTTP_OK',
      message: 'LinkedIn вернул HTML-страницу',
      details: { httpStatus: 200 },
    },
  ],
};

test('normalizes malformed diagnostic traces without hiding the summary', () => {
  const normalized = normalizeDiagnostic({ ...fixture, trace: 'broken', traceCorrupted: true });

  assert.deepEqual(normalized.trace, []);
  assert.equal(normalized.traceCorrupted, true);
  assert.equal(normalized.shortRequestId, 'diag_12345');
});

test('filters problem diagnostics separately from successes', () => {
  const success = { ...fixture, requestId: 'diag_success', outcome: 'success' };

  assert.deepEqual(filterDiagnostics([fixture, success], 'problems').map((item) => item.requestId), [fixture.requestId]);
  assert.deepEqual(filterDiagnostics([fixture, success], 'success').map((item) => item.requestId), ['diag_success']);
});

test('masks the LinkedIn URL for list display', () => {
  assert.equal(maskDiagnosticUrl(fixture.sourceUrl), 'linkedin.com/in/ada-l…');
});

test('formats a copy-safe JSON report', () => {
  const report = JSON.parse(formatDiagnosticReport({
    ...fixture,
    trace: [{ ...fixture.trace[0], details: { token: 'test-token', httpStatus: 200 } }],
  }));

  assert.equal(report.requestId, fixture.requestId);
  assert.equal(report.trace[0].stage, 'public_fetch');
  assert.equal(report.trace[0].details.httpStatus, 200);
  assert.equal(JSON.stringify(report).includes('test-token'), false);
});
