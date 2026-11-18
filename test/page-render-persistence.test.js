import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('visited application pages stay mounted across navigation', () => {
  assert.match(app, /const KeepAlivePage = React\.memo/);
  assert.match(app, /!previous\.active && !next\.active/);
  assert.match(app, /visitedPages\.has\(visitKey\)/);
  assert.match(app, /<KeepAlivePage/);
  assert.match(styles, /\.app-page-panel\[hidden\]/);
});

test('manager and employee navigation restore each page scroll position', () => {
  assert.match(app, /pageScrollPositionsRef/);
  assert.match(app, /rememberPageScroll/);
  assert.match(app, /restorePageScroll/);
  assert.match(app, /navigateEmployee/);
});

test('retained pages are isolated by signed-in account and organization', () => {
  assert.match(app, /currentPageScope/);
  assert.match(app, /authContext\.session\?\.user\?\.id/);
  assert.match(app, /authContext\.membership\?\.organization_id/);
  assert.match(app, /key\.startsWith\(`\$\{currentPageScope\}:/);
});
