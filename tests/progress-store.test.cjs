'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../progress.js'), 'utf8');
const POSITION = { paragraph: 2, offset: 0.4, ratio: 0.25 };
const json = object => JSON.parse(JSON.stringify(object));
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values, writes: [], readError: false, writeError: false,
    getItem(key) { if (this.readError) throw new Error('SecurityError'); return this.values.get(key) ?? null; },
    setItem(key, value) { if (this.writeError) throw new Error('QuotaExceededError'); this.writes.push([key, value]); this.values.set(key, value); }
  };
}
function make(disk = storage(), extra = {}) {
  const window = {};
  Object.defineProperty(window, 'localStorage', extra.storageGetter ? { get: extra.storageGetter } : { value: disk });
  vm.runInNewContext(code, { window });
  return { api: window.NovelProgress, store: window.NovelProgress.create({ now: () => 1000, ...extra }), disk };
}
const last = (store, sid = 'ash-blade') => json(store.get(sid)).last;

test('empty history is browser-local, versioned, and writes nothing until a mutation', () => {
  const { store, disk, api } = make();
  assert.deepEqual(json(store.get('ash-blade')), { last: null, completed: [], epoch: '0', status: 'saved' });
  assert.equal(disk.writes.length, 0);
  assert.equal(api.keyFor('ash-blade'), 'plcmanjp-novel-progress-v1:ash-blade');
  assert.equal(store.idForKey(api.keyFor('ash-blade')), 'ash-blade');
  assert.equal(store.ownsKey('plcmanjp-theme'), false);
});

test('last opened is independent of completed; skipping chapters never completes prior ones', () => {
  const { store, disk } = make();
  assert.equal(store.updateLast('ash-blade', 45, POSITION, '0', { at: 20, id: 'tab-a' }), true);
  assert.deepEqual(json(store.get('ash-blade').completed), []);
  assert.equal(last(store).episode, 45);
  store.complete('ash-blade', 45, '0');
  store.complete('ash-blade', 1, '0');
  store.complete('ash-blade', 45, '0');
  assert.deepEqual(json(store.get('ash-blade').completed), [1, 45]);
  const restored = make(disk).store;
  assert.deepEqual(json(restored.get('ash-blade')), json(store.get('ash-blade')));
});

test('published filtering uses explicit set and never mutates saved gaps or unavailable chapters', () => {
  const { store, disk } = make();
  for (const ep of [1, 43, 44, 45, 9999]) store.complete('ash-blade', ep);
  store.updateLast('ash-blade', 44, POSITION);
  const bytes = disk.values.get(store.keyFor('ash-blade'));
  assert.deepEqual(json(store.get('ash-blade', [1, 43, 45]).completed), [1, 43, 45]);
  assert.equal(store.get('ash-blade', [1, 43, 45]).last, null);
  assert.deepEqual(json(store.get('ash-blade', []).completed), []);
  assert.equal(disk.values.get(store.keyFor('ash-blade')), bytes);
});

test('returned snapshots cannot mutate storage or later snapshots', () => {
  const { store } = make(); store.updateLast('ash-blade', 2, POSITION); store.complete('ash-blade', 2);
  const view = store.get('ash-blade'); view.completed.push(999); view.last.position.paragraph = 99; view.last.episode = 99;
  assert.deepEqual(json(store.get('ash-blade').completed), [2]);
  assert.equal(last(store).episode, 2); assert.equal(last(store).position.paragraph, 2);
});

test('clear is per work, creates a persisted tombstone, and rejects stale reader epochs', () => {
  const { store, disk } = make(); store.complete('ash-blade', 1); store.complete('awkward-season', 3);
  const otherBytes = disk.values.get(store.keyFor('awkward-season'));
  assert.equal(store.clear('ash-blade'), true);
  const reset = store.get('ash-blade'); assert.notEqual(reset.epoch, '0');
  assert.deepEqual(json(reset.completed), []); assert.equal(reset.last, null);
  assert.equal(store.complete('ash-blade', 5, '0'), false);
  assert.equal(store.updateLast('ash-blade', 5, POSITION, '0'), false);
  assert.equal(disk.values.get(store.keyFor('awkward-season')), otherBytes);
  assert.equal(store.complete('ash-blade', 5, reset.epoch), true);
});

test('concurrent tabs reread and union completed marks while keeping newest opened session', () => {
  const disk = storage(), a = make(disk).store, b = make(disk).store;
  a.updateLast('ash-blade', 1, POSITION, '0', { at: 10, id: 'a' }); a.complete('ash-blade', 1, '0');
  b.updateLast('ash-blade', 45, POSITION, '0', { at: 20, id: 'b' }); b.complete('ash-blade', 45, '0');
  assert.equal(a.updateLast('ash-blade', 1, { paragraph: 8, offset: 0.2, ratio: 0.9 }, '0', { at: 10, id: 'a' }), false);
  assert.equal(last(a).episode, 45);
  assert.deepEqual(json(a.get('ash-blade').completed), [1, 45]);
  assert.equal(b.updateLast('ash-blade', 45, { paragraph: 5, offset: 0.2, ratio: 0.4 }, '0', { at: 20, id: 'b' }), true);
  assert.equal(last(a).position.paragraph, 5);
});

test('storage-event reload heals a simulated genuinely simultaneous same-epoch overwrite', () => {
  const disk = storage(), a = make(disk).store, b = make(disk).store;
  a.complete('ash-blade', 1); const bytesA = disk.values.get(a.keyFor('ash-blade'));
  disk.values.delete(a.keyFor('ash-blade')); // Model two processes reading the same initial bytes.
  b.complete('ash-blade', 45); const bytesB = disk.values.get(a.keyFor('ash-blade'));
  disk.values.set(a.keyFor('ash-blade'), bytesA); b.reload('ash-blade');
  assert.deepEqual(json(b.get('ash-blade').completed), [1, 45]);
  a.reload('ash-blade'); assert.deepEqual(json(a.get('ash-blade').completed), [1, 45]);
  assert.notEqual(disk.values.get(a.keyFor('ash-blade')), bytesB);
  const writes = disk.writes.length; a.reload('ash-blade'); b.reload('ash-blade');
  assert.equal(disk.writes.length, writes, 'already converged records do not bounce writes');
});

test('external reset wins over stale tab and failed in-memory writes', () => {
  const disk = storage(), a = make(disk).store, b = make(disk).store;
  a.complete('ash-blade', 1); b.get('ash-blade');
  disk.writeError = true; a.complete('ash-blade', 5); assert.equal(a.status('ash-blade'), 'memory');
  disk.writeError = false; b.clear('ash-blade');
  const epoch = b.get('ash-blade').epoch;
  a.reload('ash-blade'); assert.equal(a.get('ash-blade').epoch, epoch);
  assert.deepEqual(json(a.get('ash-blade').completed), []);
  assert.equal(a.complete('ash-blade', 10, '0'), false);
  a.reload('ash-blade'); assert.deepEqual(json(b.get('ash-blade').completed), []);
});

test('same-millisecond sessions have a stable tie break; a session cannot change chapter', () => {
  const { store } = make();
  store.updateLast('ash-blade', 2, POSITION, '0', { at: 100, id: 'z' });
  assert.equal(store.updateLast('ash-blade', 3, POSITION, '0', { at: 100, id: 'a' }), false);
  assert.equal(store.updateLast('ash-blade', 3, POSITION, '0', { at: 100, id: 'z' }), false);
  assert.equal(last(store).episode, 2);
});

for (const raw of ['{bad json', 'null', '[]', '{"version":2,"epoch":"0","last":null,"completed":[]}', '{"version":1,"epoch":"0","last":null,"completed":[0]}', 'x'.repeat(300001)]) {
  test('corrupt/unknown storage is not silently overwritten: ' + raw.slice(0, 45), () => {
    const disk = storage({ 'plcmanjp-novel-progress-v1:ash-blade': raw }); const { store } = make(disk);
    assert.equal(store.status('ash-blade'), 'corrupt');
    assert.equal(store.complete('ash-blade', 1), true);
    assert.equal(store.updateLast('ash-blade', 2, POSITION), true);
    assert.equal(disk.writes.length, 0); assert.equal(disk.values.get(store.keyFor('ash-blade')), raw);
    assert.deepEqual(json(store.get('ash-blade').completed), [1]); assert.equal(last(store).episode, 2);
    store.clear('ash-blade'); assert.equal(store.status('ash-blade'), 'saved'); assert.equal(store.get('ash-blade').last, null);
    assert.notEqual(disk.values.get(store.keyFor('ash-blade')), raw);
  });
}

test('quota errors keep usable session history, report memory-only, and recover later', () => {
  const disk = storage(), { store } = make(disk); store.complete('ash-blade', 1);
  disk.writeError = true; store.complete('ash-blade', 2); store.updateLast('ash-blade', 2, POSITION);
  assert.equal(store.status('ash-blade'), 'memory'); assert.deepEqual(json(store.get('ash-blade').completed), [1, 2]);
  assert.equal(JSON.parse(disk.values.get(store.keyFor('ash-blade'))).last, null);
  disk.writeError = false; store.reload('ash-blade');
  assert.equal(store.status('ash-blade'), 'saved'); assert.deepEqual(json(make(disk).store.get('ash-blade').completed), [1, 2]);
});

test('read security errors and throwing localStorage getter are nonfatal', () => {
  const disk = storage(); disk.readError = true; disk.writeError = true;
  for (const { store } of [make(disk), make(undefined, { storageGetter() { throw new Error('SecurityError'); } }), make(undefined, { storage: null })]) {
    assert.doesNotThrow(() => store.complete('ash-blade', 2));
    assert.deepEqual(json(store.get('ash-blade').completed), [2]); assert.equal(store.status('ash-blade'), 'memory');
  }
});

test('failed clear remains in memory without resurrecting old disk bytes until recovery', () => {
  const disk = storage(), { store } = make(disk); store.complete('ash-blade', 1); disk.writeError = true;
  store.clear('ash-blade'); const reset = store.get('ash-blade');
  assert.notEqual(reset.epoch, '0'); assert.deepEqual(json(reset.completed), []); assert.equal(reset.status, 'memory');
  disk.writeError = false; store.reload('ash-blade'); assert.equal(store.status('ash-blade'), 'saved');
  assert.deepEqual(json(make(disk).store.get('ash-blade').completed), []);
});

test('storage removal clears cached history and no global clear operation is used', () => {
  const { store, disk } = make(); store.complete('ash-blade', 1); disk.values.delete(store.keyFor('ash-blade'));
  assert.deepEqual(json(store.reload('ash-blade').completed), []);
  assert.equal(typeof store.clearAll, 'undefined');
});

test('invalid ids, episodes, positions, stamps and epochs cannot write', () => {
  const { store, disk } = make();
  for (const id of ['', '../ash-blade', '__proto__', 'a/b', 'x'.repeat(81), null]) {
    assert.equal(store.keyFor(id), null); assert.equal(store.complete(id, 1), false); assert.equal(store.clear(id), false);
  }
  for (const ep of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) assert.equal(store.complete('ash-blade', ep), false);
  for (const position of [null, {}, { ...POSITION, paragraph: -1 }, { ...POSITION, paragraph: 100001 }, { ...POSITION, offset: NaN }, { ...POSITION, offset: 2 }, { ...POSITION, ratio: -1 }]) assert.equal(store.updateLast('ash-blade', 1, position), false);
  for (const stamp of [{ at: -1, id: 'a' }, { at: 1, id: '../a' }, { at: 1, id: '' }]) assert.equal(store.updateLast('ash-blade', 1, POSITION, '0', stamp), false);
  assert.equal(store.complete('ash-blade', 1, 'wrong'), false); assert.equal(disk.writes.length, 0);
  assert.equal(store.complete('constructor', 1), true); assert.deepEqual(json(store.get('constructor').completed), [1]);
});

test('oversized or malformed schema is rejected and unknown properties never enter snapshots', () => {
  const { store, disk } = make(); const key = store.keyFor('ash-blade');
  for (const value of [
    { version: 1, epoch: '0', last: null, completed: Array(10001).fill(1) },
    { version: 1, epoch: '../bad', last: null, completed: [] },
    { version: 1, epoch: '0', last: { episode: 1, position: POSITION, updatedAt: 1 }, completed: [] }
  ]) { disk.values.set(key, JSON.stringify(value)); assert.equal(store.status('ash-blade'), 'corrupt'); }
  disk.values.set(key, '{"version":1,"epoch":"0","last":null,"completed":[3,1,3],"__proto__":{"polluted":true},"secret":"discard"}');
  const result = json(store.get('ash-blade')); assert.deepEqual(result.completed, [1, 3]); assert.equal(result.secret, undefined); assert.equal({}.polluted, undefined);
});

test('callbacks observe mutations and reload, get is silent, callback failures do not escape', () => {
  let calls = 0; let store;
  const made = make(undefined, { onChange(id, value) { calls++; assert.equal(id, 'ash-blade'); assert.equal(value.last, null); store.get(id); throw new Error('UI error'); } }); store = made.store;
  store.get('ash-blade'); assert.equal(calls, 0);
  assert.doesNotThrow(() => store.complete('ash-blade', 1)); assert.equal(calls, 1);
  store.reload('ash-blade'); assert.equal(calls, 2);
});


test('failed clear remains authoritative over another old-generation tab save', () => {
  const disk = storage(), a = make(disk).store, b = make(disk).store;
  a.complete('ash-blade', 1); b.get('ash-blade');
  disk.writeError = true; a.clear('ash-blade'); const resetEpoch = a.get('ash-blade').epoch;
  disk.writeError = false; b.complete('ash-blade', 5, '0');
  assert.deepEqual(json(a.get('ash-blade').completed), []);
  assert.equal(a.get('ash-blade').epoch, resetEpoch);
  a.reload('ash-blade');
  assert.deepEqual(json(b.reload('ash-blade').completed), []);
  assert.equal(b.get('ash-blade').epoch, resetEpoch);
});


test('successful clear survives delayed pre-reset bytes and rewrites newer tombstone', () => {
  const disk = storage(), a = make(disk).store, b = make(disk).store;
  a.complete('ash-blade', 1); a.updateLast('ash-blade', 1, POSITION, '0', { at: 5, id: 'old-reader' });
  const stale = disk.values.get(a.keyFor('ash-blade'));
  b.get('ash-blade'); b.clear('ash-blade'); const reset = b.get('ash-blade');
  disk.values.set(a.keyFor('ash-blade'), stale); // Already-read old process finishes after reset.
  const restored = b.reload('ash-blade');
  assert.equal(restored.epoch, reset.epoch); assert.equal(restored.last, null);
  assert.deepEqual(json(restored.completed), []);
  assert.equal(JSON.parse(disk.values.get(a.keyFor('ash-blade'))).epoch, reset.epoch);
  assert.equal(a.complete('ash-blade', 5, '0'), false);
  assert.equal(a.updateLast('ash-blade', 1, POSITION, '0', { at: 5, id: 'old-reader' }), false);
});

test('monotonic reset timestamps survive backward clocks and multiple clears', () => {
  const disk = storage(); let clock = 1000;
  const { store } = make(disk, { now: () => clock });
  store.complete('ash-blade', 1); store.clear('ash-blade'); const first = store.get('ash-blade').epoch;
  clock = 1; store.clear('ash-blade'); const second = store.get('ash-blade').epoch;
  assert.equal(parseInt(second.split('-')[0], 36), parseInt(first.split('-')[0], 36) + 1);
  const secondBytes = disk.values.get(store.keyFor('ash-blade'));
  disk.values.set(store.keyFor('ash-blade'), JSON.stringify({ version: 1, epoch: first, last: null, completed: [2] }));
  store.reload('ash-blade'); assert.equal(disk.values.get(store.keyFor('ash-blade')), secondBytes);
  assert.deepEqual(json(store.get('ash-blade').completed), []);
});

test('simultaneous reset epochs converge deterministically by full-id tie break', () => {
  const disk = storage(), a = make(disk).store, b = make(disk).store;
  const key = a.keyFor('ash-blade');
  const lower = { version: 1, epoch: 'rs-1-aaaa', last: null, completed: [] };
  const higher = { version: 1, epoch: 'rs-1-zzzz', last: null, completed: [] };
  disk.values.set(key, JSON.stringify(lower)); a.get('ash-blade');
  disk.values.set(key, JSON.stringify(higher)); b.get('ash-blade');
  disk.values.set(key, JSON.stringify(lower)); // Lower winner arrives late.
  b.reload('ash-blade'); a.reload('ash-blade');
  assert.equal(a.get('ash-blade').epoch, higher.epoch); assert.equal(b.get('ash-blade').epoch, higher.epoch);
  const count = disk.writes.length; b.reload('ash-blade'); a.reload('ash-blade');
  assert.equal(disk.writes.length, count);
});

test('read failure cannot clobber unseen existing bytes even if setItem is allowed', () => {
  const disk = storage(); const source = make(disk).store;
  source.complete('ash-blade', 45); source.updateLast('ash-blade', 45, POSITION, '0', { at: 2000, id: 'newer' });
  const key = source.keyFor('ash-blade'), original = disk.values.get(key);
  disk.readError = true; const { store } = make(disk);
  store.complete('ash-blade', 1); store.updateLast('ash-blade', 1, POSITION, '0', { at: 1000, id: 'old' });
  assert.equal(disk.values.get(key), original); assert.equal(store.status('ash-blade'), 'memory');
  disk.readError = false; store.reload('ash-blade');
  assert.deepEqual(json(store.get('ash-blade').completed), [1, 45]);
  assert.equal(last(store).episode, 45); assert.equal(store.status('ash-blade'), 'saved');
});


test('validated storage-event reset payload survives resetter closing before stale disk overwrite', () => {
  const disk = storage(), resetter = make(disk).store, receiver = make(disk).store;
  resetter.complete('ash-blade', 1); const key = resetter.keyFor('ash-blade');
  const oldBytes = disk.values.get(key); receiver.get('ash-blade');
  resetter.clear('ash-blade'); const resetBytes = disk.values.get(key);
  const resetEpoch = JSON.parse(resetBytes).epoch;
  disk.values.set(key, oldBytes); // Resetter is now unavailable; event is receiver's only reset evidence.
  const state = receiver.reload('ash-blade', resetBytes);
  assert.equal(state.epoch, resetEpoch); assert.deepEqual(json(state.completed), []); assert.equal(state.last, null);
  assert.equal(JSON.parse(disk.values.get(key)).epoch, resetEpoch);
  assert.equal(receiver.complete('ash-blade', 5, '0'), false);
});

test('reload ignores corrupt or deleted event payloads and unions valid same-epoch event marks', () => {
  const disk = storage(), { store } = make(disk); store.complete('ash-blade', 1);
  const key = store.keyFor('ash-blade'), original = disk.values.get(key);
  store.reload('ash-blade', '{bad'); store.reload('ash-blade', null);
  assert.equal(disk.values.get(key), original);
  store.reload('ash-blade', JSON.stringify({ version: 1, epoch: '0', last: null, completed: [45] }));
  assert.deepEqual(json(store.get('ash-blade').completed), [1, 45]);
  assert.deepEqual(JSON.parse(disk.values.get(key)).completed, [1, 45]);
  const writes = disk.writes.length; store.reload('ash-blade', disk.values.get(key));
  assert.equal(disk.writes.length, writes);
});
