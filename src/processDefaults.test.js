import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TARGET_ROLE,
  cleanScraperText,
  normalizeTargetRole,
} from './processDefaults.js';

test('treats masked scraper values as missing profile text', () => {
  assert.equal(cleanScraperText('******'), '');
  assert.equal(cleanScraperText(' *** '), '');
  assert.equal(cleanScraperText('***** *** ********'), '');
  assert.equal(cleanScraperText('Senior Recruiter'), 'Senior Recruiter');
});

test('defaults a missing or masked vacancy role to the target role', () => {
  assert.equal(DEFAULT_TARGET_ROLE, 'Senior Frontend Developer');
  assert.equal(normalizeTargetRole(''), DEFAULT_TARGET_ROLE);
  assert.equal(normalizeTargetRole('******'), DEFAULT_TARGET_ROLE);
  assert.equal(normalizeTargetRole('***** *** ********'), DEFAULT_TARGET_ROLE);
  assert.equal(normalizeTargetRole('Frontend Lead'), 'Frontend Lead');
});
