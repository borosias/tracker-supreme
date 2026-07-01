const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAppsScript(overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const sandbox = { console, ...overrides };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.__SHEETS = SHEETS;`, sandbox);
  return sandbox;
}

test('parses a public LinkedIn Person from JSON-LD', () => {
  const { parseLinkedinPublicMetadata_ } = loadAppsScript();
  const html = `
    <html><head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebPage", "url": "https://www.linkedin.com/in/example" },
            {
              "@type": "Person",
              "name": "Ada Lovelace",
              "jobTitle": "Senior Recruiter",
              "description": "Hiring engineers",
              "url": "https://www.linkedin.com/in/example",
              "worksFor": [{ "@type": "Organization", "name": "Analytical Engines" }],
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "London",
                "addressCountry": "United Kingdom"
              }
            }
          ]
        }
      </script>
    </head></html>`;

  assert.deepEqual(
    JSON.parse(JSON.stringify(parseLinkedinPublicMetadata_(html, 'https://www.linkedin.com/in/example'))),
    {
      name: 'Ada Lovelace',
      headline: 'Senior Recruiter',
      companyName: 'Analytical Engines',
      location: 'London, United Kingdom',
      description: 'Hiring engineers',
      profileUrl: 'https://www.linkedin.com/in/example',
    },
  );
});

test('falls back to OpenGraph metadata when JSON-LD is unavailable', () => {
  const { parseLinkedinPublicMetadata_ } = loadAppsScript();
  const html = `
    <html><head>
      <meta property="og:title" content="Grace Hopper - Engineering Leader | LinkedIn">
      <meta property="og:description" content="Engineering Leader at Compilers Inc.">
      <meta property="og:url" content="https://www.linkedin.com/in/grace-hopper">
    </head></html>`;

  assert.deepEqual(
    JSON.parse(JSON.stringify(parseLinkedinPublicMetadata_(html, 'https://www.linkedin.com/in/grace-hopper'))),
    {
      name: 'Grace Hopper',
      headline: 'Engineering Leader',
      companyName: '',
      location: '',
      description: 'Engineering Leader at Compilers Inc.',
      profileUrl: 'https://www.linkedin.com/in/grace-hopper',
    },
  );
});

test('decodes repeatedly encoded OpenGraph entities', () => {
  const { parseLinkedinPublicMetadata_ } = loadAppsScript();
  const html = `
    <html><head>
      <meta property="og:title" content="Ada &amp;amp; Grace - Recruiting | LinkedIn">
      <meta property="og:description" content="R&amp;amp;D hiring">
    </head></html>`;

  const metadata = parseLinkedinPublicMetadata_(html, 'https://www.linkedin.com/in/example');

  assert.equal(metadata.name, 'Ada & Grace');
  assert.equal(metadata.description, 'R&D hiring');
});

test('maps public LinkedIn metadata to an actionable process draft', () => {
  const { linkedinMetadataToProcessDraft_ } = loadAppsScript();
  const draft = linkedinMetadataToProcessDraft_({
    name: 'Ada Lovelace',
    headline: 'Senior Recruiter',
    companyName: 'Analytical Engines',
    location: 'London, United Kingdom',
    description: 'Hiring engineers',
    profileUrl: 'https://www.linkedin.com/in/example',
  });

  assert.equal(draft.title, 'Analytical Engines — recruiter contact');
  assert.equal(draft.recruiterName, 'Ada Lovelace');
  assert.equal(draft.recruiterTitle, 'Senior Recruiter');
  assert.equal(draft.role, 'Senior Frontend Developer');
  assert.equal(draft.companyName, 'Analytical Engines');
  assert.equal(draft.recruiterLinkedinUrl, 'https://www.linkedin.com/in/example');
  assert.equal(draft.hiringStage, 'recruiter_talk');
  assert.equal(draft.workState, 'action_required');
  assert.equal(draft.sourceType, 'linkedin');
});

test('enriches LinkedIn from the public page without Apify', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Person",
        "name": "Ada Lovelace",
        "jobTitle": "Senior Recruiter",
        "url": "https://www.linkedin.com/in/example",
        "worksFor": { "name": "Analytical Engines" }
      }
    </script>`;
  const UrlFetchApp = {
    fetch(url, options) {
      assert.equal(url, 'https://www.linkedin.com/in/example');
      assert.equal(options.muteHttpExceptions, true);
      assert.equal(options.followRedirects, true);
      return {
        getResponseCode: () => 200,
        getContentText: () => html,
      };
    },
  };
  const { enrichLinkedinFromPublicPage_ } = loadAppsScript({ UrlFetchApp });

  const result = enrichLinkedinFromPublicPage_('https://www.linkedin.com/in/example');

  assert.equal(result.confidence, 'medium');
  assert.deepEqual(Array.from(result.warnings), []);
  assert.equal(result.processDraft.recruiterName, 'Ada Lovelace');
  assert.equal(result.processDraft.companyName, 'Analytical Engines');
});

test('uses public LinkedIn metadata before checking Apify credentials', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Person",
        "name": "Ada Lovelace",
        "jobTitle": "Senior Recruiter",
        "url": "https://www.linkedin.com/in/example"
      }
    </script>`;
  const UrlFetchApp = {
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => html,
    }),
  };
  const PropertiesService = {
    getScriptProperties() {
      throw new Error('Apify credentials must not be read after direct enrichment succeeds');
    },
  };
  const { enrichLinkedin_ } = loadAppsScript({ UrlFetchApp, PropertiesService });

  const result = enrichLinkedin_('https://www.linkedin.com/in/example');

  assert.equal(result.confidence, 'medium');
  assert.equal(result.processDraft.recruiterName, 'Ada Lovelace');
});

test('builds the current free Actor input contract', () => {
  const { buildLinkedinActorInput_ } = loadAppsScript();

  const input = buildLinkedinActorInput_('https://www.linkedin.com/in/example');

  assert.deepEqual(JSON.parse(JSON.stringify(input)), {
    profileUrls: [{ url: 'https://www.linkedin.com/in/example' }],
    includeEmail: false,
  });
});

test('normalizes the current free Actor output contract', () => {
  const { normalizeLinkedinActorMetadata_ } = loadAppsScript();

  const metadata = normalizeLinkedinActorMetadata_(
    {
      basic_info: {
        fullname: 'Ada Lovelace',
        headline: 'Senior Recruiter',
        current_company: 'Analytical Engines',
        profile_url: 'https://www.linkedin.com/in/example',
        about: 'Hiring engineers',
        location: { full: 'London, United Kingdom' },
      },
    },
    'https://www.linkedin.com/in/example',
  );

  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), {
    name: 'Ada Lovelace',
    headline: 'Senior Recruiter',
    companyName: 'Analytical Engines',
    location: 'London, United Kingdom',
    description: 'Hiring engineers',
    profileUrl: 'https://www.linkedin.com/in/example',
  });
});

test('treats Actor placeholder values as missing metadata', () => {
  const { normalizeLinkedinActorMetadata_ } = loadAppsScript();

  const metadata = normalizeLinkedinActorMetadata_(
    {
      basic_info: {
        fullname: 'N/A',
        headline: 'N/A',
        current_company: 'N/A',
        location: { full: 'N/A' },
      },
    },
    'https://www.linkedin.com/in/example',
  );

  assert.equal(metadata.name, '');
  assert.equal(metadata.headline, '');
  assert.equal(metadata.companyName, '');
  assert.equal(metadata.location, '');
});

test('returns a manual draft when the Actor only returns placeholders', () => {
  const UrlFetchApp = {
    fetch(url) {
      if (url.startsWith('https://www.linkedin.com/')) {
        return {
          getResponseCode: () => 999,
          getContentText: () => '',
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify([
            {
              basic_info: {
                fullname: 'N/A',
                headline: 'N/A',
                current_company: 'N/A',
              },
            },
          ]),
      };
    },
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (key === 'APIFY_TOKEN' ? 'test-token' : ''),
    }),
  };
  const { enrichLinkedin_ } = loadAppsScript({ UrlFetchApp, PropertiesService });

  const result = enrichLinkedin_('https://www.linkedin.com/in/example');

  assert.equal(result.confidence, 'low');
  assert.equal(result.processDraft.companyName, '');
  assert.equal(result.processDraft.title, 'LinkedIn contact');
  assert.match(result.warnings.join(' '), /usable profile data/i);
});

test('keeps legacy Actor output compatible with an APIFY_ACTOR_ID override', () => {
  const { normalizeLinkedinActorMetadata_ } = loadAppsScript();

  const metadata = normalizeLinkedinActorMetadata_(
    {
      profile: {
        full_name: 'Grace Hopper',
        headline: 'Engineering Leader',
        currentPosition: [{ title: 'VP Engineering', companyName: 'Compilers Inc.' }],
        location: { default: 'New York, United States' },
      },
    },
    'https://www.linkedin.com/in/grace-hopper',
  );

  assert.equal(metadata.name, 'Grace Hopper');
  assert.equal(metadata.headline, 'Engineering Leader');
  assert.equal(metadata.companyName, 'Compilers Inc.');
  assert.equal(metadata.location, 'New York, United States');
});

test('falls back to the current free Actor when public metadata is blocked', () => {
  const calls = [];
  const UrlFetchApp = {
    fetch(url, options) {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          getResponseCode: () => 999,
          getContentText: () => '',
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify([
            {
              basic_info: {
                fullname: 'Ada Lovelace',
                headline: 'Senior Recruiter',
                current_company: 'Analytical Engines',
                profile_url: 'https://www.linkedin.com/in/example',
              },
            },
          ]),
      };
    },
  };
  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key) {
          if (key === 'APIFY_TOKEN') return 'test-token';
          return '';
        },
      };
    },
  };
  const { enrichLinkedin_ } = loadAppsScript({ UrlFetchApp, PropertiesService });

  const result = enrichLinkedin_('https://www.linkedin.com/in/example');

  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /scrapers-hub~linkedin-profile-details-scraper-email-no-cookies-required/);
  assert.deepEqual(JSON.parse(calls[1].options.payload), {
    profileUrls: [{ url: 'https://www.linkedin.com/in/example' }],
    includeEmail: false,
  });
  assert.equal(result.confidence, 'high');
  assert.equal(result.processDraft.recruiterName, 'Ada Lovelace');
  assert.equal(result.processDraft.companyName, 'Analytical Engines');
});

test('drops masked recruiter titles and keeps the default target vacancy role', () => {
  const { cleanLinkedinText_, getLinkedinPlaceholderFields_, linkedinMetadataToProcessDraft_ } = loadAppsScript();

  assert.equal(cleanLinkedinText_('******'), '');
  assert.equal(cleanLinkedinText_('***** *** ********'), '');
  assert.deepEqual(Array.from(getLinkedinPlaceholderFields_({ headline: '***** *** ********' })), ['headline']);
  const draft = linkedinMetadataToProcessDraft_({
    name: 'Ada Lovelace',
    headline: '***** *** ********',
    profileUrl: 'https://www.linkedin.com/in/example',
  });

  assert.equal(draft.recruiterTitle, '');
  assert.equal(draft.role, 'Senior Frontend Developer');
});

test('uses the default target role for a manual LinkedIn fallback draft', () => {
  const { parseGenericSource_ } = loadAppsScript();
  const draft = parseGenericSource_('linkedin', 'https://www.linkedin.com/in/example', '');

  assert.equal(draft.role, 'Senior Frontend Developer');
});

test('classifies blocked LinkedIn pages', () => {
  const { classifyLinkedinPage_ } = loadAppsScript();

  assert.equal(classifyLinkedinPage_('<div class="authwall">Sign in to LinkedIn</div>', null), 'authwall');
  assert.equal(
    classifyLinkedinPage_('<form action="/checkpoint/challenge/">Security verification</form>', null),
    'checkpoint',
  );
  assert.equal(classifyLinkedinPage_('<html><body>Public page without profile metadata</body></html>', null), 'unknown');
  assert.equal(classifyLinkedinPage_('<html></html>', { name: 'Ada Lovelace' }), 'profile');
});

test('adds ordered diagnostic stages without sensitive details', () => {
  const { createDiagnostic_, addDiagnosticStage_ } = loadAppsScript();
  const diagnostic = createDiagnostic_(
    'diag_1',
    'linkedin',
    'https://www.linkedin.com/in/example',
    '2026-06-22T10:00:00.000Z',
  );

  addDiagnosticStage_(diagnostic, 'public_fetch', 'success', 'PUBLIC_HTTP_OK', 'Получен ответ', 120, {
    httpStatus: 200,
    contentType: 'text/html',
    authorization: 'Bearer secret',
    nested: { token: 'secret', hasJsonLdPerson: true },
  });

  assert.equal(diagnostic.trace[0].sequence, 1);
  assert.equal(diagnostic.trace[0].stage, 'public_fetch');
  assert.equal(diagnostic.trace[0].details.httpStatus, 200);
  assert.equal('authorization' in diagnostic.trace[0].details, false);
  assert.equal('token' in diagnostic.trace[0].details.nested, false);
  assert.equal(diagnostic.trace[0].details.nested.hasJsonLdPerson, true);
});

test('defines the persistent Diagnostics sheet contract', () => {
  const { __SHEETS } = loadAppsScript();

  assert.deepEqual(Array.from(__SHEETS.diagnostics.headers), [
    'requestId',
    'action',
    'sourceType',
    'sourceUrl',
    'outcome',
    'provider',
    'failedStage',
    'reasonCode',
    'message',
    'confidence',
    'durationMs',
    'startedAt',
    'completedAt',
    'traceJson',
  ]);
});

test('defines blocker fields for processes and immutable event history', () => {
  const { __SHEETS } = loadAppsScript();

  assert.equal(__SHEETS.processes.headers.includes('blockerReason'), true);
  assert.equal(__SHEETS.processes.headers.includes('blockerNote'), true);
  assert.equal(__SHEETS.processes.headers.includes('blockedAt'), true);
  assert.equal(__SHEETS.processes.headers.includes('blockerReviewDate'), true);
  assert.equal(__SHEETS.events.headers.includes('blockerReason'), true);
});

test('schema evolution preserves existing and custom columns while appending missing fields', () => {
  const { mergeHeaders_ } = loadAppsScript();

  assert.deepEqual(
    Array.from(mergeHeaders_(['id', 'customColumn', 'title'], ['id', 'title', 'blockerReason'])),
    ['id', 'customColumn', 'title', 'blockerReason'],
  );
  assert.deepEqual(Array.from(mergeHeaders_([''], ['id', 'title'])), ['id', 'title']);
});

function createMemorySheet(headers) {
  const rows = [];
  return {
    _rows: rows,
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length + 1,
    getRange(row, column, numRows, numColumns) {
      return {
        getValues() {
          if (row === 1) return [headers.slice(column - 1, column - 1 + numColumns)];
          return rows.slice(row - 2, row - 2 + numRows).map((item) => item.slice(column - 1, column - 1 + numColumns));
        },
        setValues(values) {
          if (row === 1) {
            values[0].forEach((value, index) => {
              headers[column - 1 + index] = value;
            });
            return;
          }
          values.forEach((value, index) => {
            rows[row - 2 + index] = value;
          });
        },
      };
    },
    appendRow(row) {
      rows.push(row);
    },
  };
}

test('creates a timed Calendar event for follow-up when nextActionTime is set', () => {
  const sheets = {
    Processes: createMemorySheet([
      'id',
      'title',
      'role',
      'nextActionType',
      'nextActionDate',
      'nextActionTime',
      'calendarEventId',
      'createdAt',
      'updatedAt',
    ]),
    Events: createMemorySheet(['id', 'processId', 'type', 'title', 'note', 'calendarEventId']),
  };
  const spreadsheet = {
    getSheetByName(name) {
      return sheets[name];
    },
  };
  const createdEvents = [];
  const CalendarApp = {
    getDefaultCalendar() {
      return {
        createEvent(title, start, end, options) {
          createdEvents.push({ type: 'timed', title, start, end, options });
          return { getId: () => 'calendar_event_1' };
        },
        createAllDayEvent(title, day, options) {
          createdEvents.push({ type: 'all-day', title, day, options });
          return { getId: () => 'calendar_event_1' };
        },
      };
    },
  };
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet,
  };
  const PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => '' }),
  };
  const Utilities = { getUuid: () => 'uuid-calendar' };
  const { syncCalendar_ } = loadAppsScript({ CalendarApp, SpreadsheetApp, PropertiesService, Utilities });

  const result = syncCalendar_('proc_1', {
    id: 'proc_1',
    title: 'Follow up with recruiter',
    role: 'Senior Frontend Developer',
    nextActionType: 'follow_up',
    nextActionDate: '2026-06-24',
    nextActionTime: '09:30',
  });

  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0].type, 'timed');
  assert.equal(createdEvents[0].start.getFullYear(), 2026);
  assert.equal(createdEvents[0].start.getMonth(), 5);
  assert.equal(createdEvents[0].start.getDate(), 24);
  assert.equal(createdEvents[0].start.getHours(), 9);
  assert.equal(createdEvents[0].start.getMinutes(), 30);
  assert.equal(createdEvents[0].end.getHours(), 10);
  assert.equal(createdEvents[0].end.getMinutes(), 30);
  assert.equal(result.process.calendarEventId, 'calendar_event_1');
});

test('serializes and parses diagnostic rows safely', () => {
  const { diagnosticToRow_, diagnosticFromRow_ } = loadAppsScript();
  const diagnostic = {
    requestId: 'diag_1',
    action: 'importSource',
    sourceType: 'linkedin',
    sourceUrl: 'https://www.linkedin.com/in/example',
    outcome: 'fallback',
    provider: 'manual',
    failedStage: 'apify_parse',
    reasonCode: 'APIFY_PLACEHOLDER_ONLY',
    message: 'Провайдер вернул только значения-заглушки',
    confidence: 'low',
    durationMs: 411,
    startedAt: '2026-06-22T10:00:00.000Z',
    completedAt: '2026-06-22T10:00:00.411Z',
    trace: [{ sequence: 1, stage: 'finalize', status: 'fallback', details: {} }],
  };

  const row = diagnosticToRow_(diagnostic);
  const parsed = diagnosticFromRow_(row);
  assert.equal(parsed.requestId, 'diag_1');
  assert.equal(parsed.trace[0].stage, 'finalize');
  assert.equal(parsed.traceCorrupted, false);

  const corrupted = diagnosticFromRow_({ ...row, traceJson: '{broken' });
  assert.deepEqual(Array.from(corrupted.trace), []);
  assert.equal(corrupted.traceCorrupted, true);
});

test('traces an authwall fallback through Apify to a successful import', () => {
  const calls = [];
  const UrlFetchApp = {
    fetch(url) {
      calls.push(url);
      if (calls.length === 1) {
        return {
          getResponseCode: () => 200,
          getContentText: () => '<html><div class="authwall">Sign in to LinkedIn</div></html>',
          getHeaders: () => ({ 'Content-Type': 'text/html; charset=utf-8' }),
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify([
            {
              basic_info: {
                fullname: 'Ada Lovelace',
                headline: 'Senior Recruiter',
                current_company: 'Analytical Engines',
              },
            },
          ]),
        getHeaders: () => ({ 'Content-Type': 'application/json' }),
      };
    },
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (key === 'APIFY_TOKEN' ? 'test-token' : ''),
    }),
  };
  let sequence = 0;
  const Utilities = { getUuid: () => `uuid-${++sequence}` };
  const silentConsole = { log() {}, warn() {}, error() {} };
  const api = loadAppsScript({ UrlFetchApp, PropertiesService, Utilities, console: silentConsole });
  api.persistDiagnostic_ = () => null;

  const result = api.importSource_({
    sourceType: 'linkedin',
    url: 'https://www.linkedin.com/in/example',
  });

  assert.equal(result.diagnosticSummary.reasonCode, 'SUCCESS_APIFY');
  assert.equal(result.diagnosticSummary.provider, 'apify');
  assert.deepEqual(Array.from(result.diagnosticSummary.trace, (entry) => entry.stage), [
    'validate_input',
    'public_fetch',
    'public_parse',
    'apify_config',
    'apify_fetch',
    'apify_parse',
    'finalize',
  ]);
  assert.equal(result.diagnosticSummary.trace[2].reasonCode, 'PUBLIC_AUTHWALL');
  assert.equal(JSON.stringify(result.diagnosticSummary).includes('test-token'), false);
});

test('keeps a successful Apify fetch distinct from an invalid JSON parse', () => {
  let call = 0;
  const UrlFetchApp = {
    fetch() {
      call += 1;
      return call === 1
        ? {
            getResponseCode: () => 200,
            getContentText: () => '<html><div class="authwall">Sign in</div></html>',
            getHeaders: () => ({ 'Content-Type': 'text/html' }),
          }
        : {
            getResponseCode: () => 200,
            getContentText: () => '{invalid-json',
            getHeaders: () => ({ 'Content-Type': 'application/json' }),
          };
    },
  };
  const PropertiesService = {
    getScriptProperties: () => ({ getProperty: (key) => (key === 'APIFY_TOKEN' ? 'test-token' : '') }),
  };
  const api = loadAppsScript({
    UrlFetchApp,
    PropertiesService,
    Utilities: { getUuid: () => 'uuid' },
    console: { log() {}, warn() {}, error() {} },
  });
  api.persistDiagnostic_ = () => null;

  const result = api.importSource_({ sourceType: 'linkedin', url: 'https://www.linkedin.com/in/example' });
  const apifyStages = result.diagnosticSummary.trace.filter((entry) => entry.stage.startsWith('apify_'));

  assert.deepEqual(Array.from(apifyStages, (entry) => `${entry.stage}:${entry.status}`), [
    'apify_config:success',
    'apify_fetch:success',
    'apify_parse:failed',
  ]);
  assert.equal(result.diagnosticSummary.reasonCode, 'APIFY_PARSE_ERROR');
});
