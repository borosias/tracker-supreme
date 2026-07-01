import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('./tracker.css', import.meta.url), 'utf8');

test('mobile app navigation wraps instead of clipping off-screen tabs', () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.app-tabs\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.app-tabs\s*\{[\s\S]*overflow-x:\s*visible/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.app-tabs\s*>\s*button\s*\{[\s\S]*flex:\s*1\s+1\s+calc\(50%\s*-\s*0\.25rem\)/);
});
