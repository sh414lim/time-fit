import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('visited web pages stay mounted when navigating between menus', () => {
  assert.match(main, /const \[visitedScreens, setVisitedScreens\] = useState/);
  assert.match(main, /new Set\(\[\.\.\.retainedScreenIds, active\]\)/);
  assert.match(main, /hidden=\{id !== active\}/);
  assert.match(main, /key=\{`\$\{mode\}:\$\{id\}`\}/);
});

test('preserved pages reset when the signed-in account or business changes', () => {
  assert.match(main, /const visitedScreenScope = `\$\{authContext\.session\?\.user\?\.id/);
  assert.match(main, /authContext\.membership\?\.organization_id \|\| "none"/);
  assert.match(main, /visitedScreenScopeRef\.current !== visitedScreenScope/);
});
