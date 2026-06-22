const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAppsScript(overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const sandbox = { console, ...overrides };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
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
