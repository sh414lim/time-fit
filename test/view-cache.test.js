import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidateViewCache, readViewCache, writeViewCache } from '../src/lib/viewCache.js';

test('화면 캐시는 계정·사업장별로 분리되고 만료·무효화된다', () => {
  writeViewCache('payroll:owner:store:2026-09', { total: 10 }, 1000);
  writeViewCache('payroll:other:store:2026-09', { total: 20 }, 1000);
  assert.deepEqual(readViewCache('payroll:owner:store:2026-09', 2000), { total: 10 });
  invalidateViewCache('payroll:owner:store:');
  assert.equal(readViewCache('payroll:owner:store:2026-09', 2000), null);
  assert.equal(readViewCache('payroll:other:store:2026-09', 31000), null);
});
