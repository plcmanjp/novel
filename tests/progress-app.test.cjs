'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, flush } = require('./dom-harness.cjs');

const PREFIX = 'plcmanjp-novel-progress-v1:';
const SID = 'ash-blade';
const epPath = (no, sid = SID) => 'data/series/' + sid + '/episodes/' + String(no).padStart(6, '0') + '.json';
const chapter = { episode: 43, title: '진행 기록 검사', body: '첫 문단\n같은 문단의 다음 줄\n\n둘째 문단\n\n셋째 문단\n\n마지막 문단' };
const key = sid => PREFIX + sid;
const json = value => JSON.parse(JSON.stringify(value));
const record = (env, sid = SID) => env.local.has(key(sid)) ? JSON.parse(env.local.get(key(sid))) : null;
const published = sid => JSON.parse(fs.readFileSync(path.join(__dirname, '../data/series', sid, 'meta.json'), 'utf8')).episodes.map(item => item.episode);
const diskRecord = ({ episode = 43, completed = [], paragraph = 1, offset = 0.26, ratio = 0.315, epoch = '0', at = 1 } = {}) => JSON.stringify({
  version: 1, epoch, completed,
  last: episode === null ? null : { episode, position: { paragraph, offset, ratio }, updatedAt: at, openedAt: at, sessionId: 'seed' }
});

// This is an explicit geometry model, not a layout-engine substitute. The four
// paragraphs are 300 px tall, begin at document y=300, and move with scrollY.
function layout(node, env) {
  if (node.classList.contains('top')) return { top: 0, bottom: 60, width: 1000 };
  if (node.classList.contains('reader-body')) return { top: 300 - env.window.scrollY, height: node.children.length * 300, width: 600 };
  if (node.parentElement?.classList.contains('reader-body')) {
    const index = node.parentElement.children.indexOf(node);
    return { top: 300 + index * 300 - env.window.scrollY, height: 300, width: 600 };
  }
  if (node.classList.contains('site')) return { top: 1800 - env.window.scrollY, height: 180, width: 1000 };
  return null;
}
function make(options = {}) {
  return setup({
    hash: '#/s/' + SID + '/43', layout, manualFrames: true, manualTimers: true,
    ...options,
    responses: { [epPath(43)]: chapter, [epPath(45)]: { ...chapter, episode: 45, title: '건너뛴 다음 화' }, ...options.responses }
  });
}
async function ready(env) { await flush(); await env.frames(5); return env; }
async function complete(env, y = 800) { await env.scroll(y); await env.frames(2); }
function progressWrites(env, sid = SID) { return env.writes.filter(([name]) => name === key(sid)); }

test('opening a published chapter records last opened only after ready, never completed', async () => {
  const env = make(); await flush();
  assert.equal(record(env), null, 'loading/layout work must not write a reading session');
  await env.frames(5);
  assert.equal(record(env).last.episode, 43);
  assert.equal(record(env).last.position.ratio, 0);
  assert.deepEqual(record(env).completed, []);
  assert.ok(env.one('.reader-progress').textContent.includes('본문 끝'));
  assert.ok(env.one('.reader-local-note').textContent.includes('서버로 보내지 않습니다'));
});

test('skipping from 43 to 45 completes neither prior nor missing chapters', async () => {
  const env = await ready(make());
  await env.advance(1); await env.navigate('#/s/ash-blade/45'); await env.frames(5);
  assert.equal(record(env).last.episode, 45);
  assert.deepEqual(record(env).completed, []);
  await complete(env);
  assert.deepEqual(record(env).completed, [45]);
  await env.navigate('#/s/ash-blade');
  const marked = env.all('.ep-item').filter(node => !node.querySelector('.read-badge').hidden);
  assert.deepEqual(marked.map(node => node.href), ['#/s/ash-blade/45']);
  assert.equal(env.one('.reading-summary').textContent, '이 브라우저 · 최근 45화 · 읽음 1개');
});

test('only actual text ending in viewport counts, not footer or zero geometry', async () => {
  const env = await ready(make());
  await env.scroll(1600); await env.frames(2); // Actual text bottom is above fixed header.
  assert.deepEqual(record(env).completed, []);
  env.layout = () => null;
  await env.scroll(900); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
});

test('an upward-only movement after restored footer does not create a completion intent', async () => {
  const env = await ready(make({ storage: { [key(SID)]: diskRecord({ paragraph: 3, offset: 1, ratio: 1 }) } }));
  assert.equal(env.window.scrollY, 1422);
  assert.deepEqual(record(env).completed, []);
  await env.scroll(800); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
});

test('genuine downward movement to actual reader end marks only that chapter, idempotently', async () => {
  const env = await ready(make());
  await complete(env);
  assert.deepEqual(record(env).completed, [43]);
  assert.ok(env.one('.reader-progress').textContent.includes('이 회차 읽음'));
  const completedWrites = progressWrites(env).length;
  await env.scroll(810); await env.frames(2);
  assert.deepEqual(record(env).completed, [43]);
  assert.equal(progressWrites(env).length, completedWrites, 'repeated bottom checks do not bypass throttling with duplicate completion writes');
  assert.equal(env.one('.reader-body').children.map(node => node.textContent).join('|'), '첫 문단같은 문단의 다음 줄|둘째 문단|셋째 문단|마지막 문단');
});

test('programmatic downward scrolling saves position but cannot manufacture reading completion', async () => {
  const env = await ready(make());
  await env.scroll(800, { input: false }); await env.frames(2); await env.advance(350);
  assert.deepEqual(record(env).completed, []);
  assert.ok(record(env).last.position.ratio > 0, 'scroll position still remains resumable');
  env.event(env.document, 'keydown', { key: 'End', isTrusted: true }); await env.frames(2);
  assert.deepEqual(record(env).completed, [43], 'a deliberate reading key can confirm the visible text ending');
});

test('a reading gesture expires before a later unrelated programmatic scroll', async () => {
  const env = await ready(make());
  await env.scroll(400); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
  await env.advance(1201);
  await env.scroll(800, { input: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
  env.event(env.document.body, 'wheel', { deltaY: 20, isTrusted: true }); await env.frames(2);
  assert.deepEqual(record(env).completed, [43], 'a fresh trusted wheel gesture still works');
});

test('Tab focus navigation clears an earlier reading gesture before automatic focus scroll', async () => {
  const env = await ready(make());
  await env.scroll(400); await env.frames(2);
  env.event(env.document, 'keydown', { key: 'Tab', isTrusted: true });
  await env.scroll(800, { input: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
});

test('interactive pointer navigation clears an earlier reading gesture before offscreen link auto-scroll', async () => {
  const env = await ready(make());
  await env.scroll(400); await env.frames(2);
  env.event(env.one('.epnav .toc'), 'pointerdown', { clientX: 200, clientY: 790, isTrusted: true });
  await env.scroll(800, { input: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
  assert.equal(env.location.hash, '#/s/ash-blade/43');
});

test('untrusted wheel events cannot arm completion for subsequent automatic scroll', async () => {
  const env = await ready(make());
  env.event(env.document.body, 'wheel', { deltaY: 20, isTrusted: false });
  await env.scroll(800, { input: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
});

test('root scrollbar dragging can arm and refresh genuine reading intent, unlike ordinary root clicks', async () => {
  const env = await ready(make());
  env.document.documentElement.clientWidth = 980;
  env.event(env.document.documentElement, 'pointerdown', { clientX: 400, clientY: 300, buttons: 1, button: 0, isTrusted: true });
  await env.scroll(800, { input: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
  env.event(env.document.documentElement, 'pointerdown', { clientX: 990, clientY: 300, buttons: 1, button: 0, isTrusted: true });
  await env.advance(1201);
  env.event(env.document.documentElement, 'pointermove', { clientX: 990, clientY: 650, buttons: 1, isTrusted: true });
  await env.scroll(810, { input: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, [43]);
  env.event(env.document.documentElement, 'pointerup', { buttons: 0, isTrusted: true });
});

for (const hiddenMode of ['hidden', 'unfocused', 'prerender']) {
  test(hiddenMode + ' reader cannot earn completion; a fresh visible input can', async () => {
    const env = await ready(make());
    if (hiddenMode === 'hidden') env.document.visibilityState = 'hidden';
    if (hiddenMode === 'unfocused') env.document.focused = false;
    if (hiddenMode === 'prerender') env.document.prerendering = true;
    await complete(env);
    assert.deepEqual(record(env).completed, []);
    env.document.visibilityState = 'visible'; env.document.focused = true; env.document.prerendering = false;
    env.event(env.document, 'visibilitychange');
    env.event(env.document, 'keydown', { key: 'End', isTrusted: true }); await env.frames(2);
    assert.deepEqual(record(env).completed, [43]);
  });
}

test('a background-loaded chapter stays unrecorded until activated visibly', async () => {
  const env = make({ visibilityState: 'hidden' }); await ready(env);
  assert.equal(record(env), null);
  env.document.visibilityState = 'visible'; env.event(env.document, 'visibilitychange');
  await env.frames(5);
  assert.equal(record(env).last.episode, 43);
  assert.deepEqual(record(env).completed, []);
});

test('short chapters do not auto-complete on open; explicit End after readiness can confirm bottom', async () => {
  const shortLayout = (node, env) => {
    if (node.classList.contains('top')) return { top: 0, bottom: 60 };
    if (node.classList.contains('reader-body')) return { top: 200 - env.window.scrollY, height: 200 };
    if (node.parentElement?.classList.contains('reader-body')) return { top: 200 + node.parentElement.children.indexOf(node) * 50 - env.window.scrollY, height: 50 };
    return null;
  };
  const env = await ready(make({ layout: shortLayout }));
  assert.deepEqual(record(env).completed, []);
  env.event(env.document, 'keydown', { key: 'End', isTrusted: false }); await env.frames(2);
  assert.deepEqual(record(env).completed, []);
  env.event(env.document, 'keydown', { key: 'End', isTrusted: true }); await env.frames(2);
  assert.deepEqual(record(env).completed, [43]);
});

test('empty chapter placeholders can never earn a completion mark', async () => {
  const env = await ready(make({ responses: { [epPath(43)]: { ...chapter, body: '  \n\n' } } }));
  env.event(env.document, 'keydown', { key: 'End', isTrusted: true }); await env.frames(2);
  await complete(env);
  assert.deepEqual(record(env).completed, []);
});

test('a matched reload restores its paragraph anchor without completing; another chapter starts at top', async () => {
  const env = await ready(make({ storage: { [key(SID)]: diskRecord() } }));
  assert.equal(env.window.scrollY, 600);
  assert.deepEqual(record(env).completed, []);
  await env.advance(1); await env.navigate('#/s/ash-blade/45'); await env.frames(5);
  assert.equal(env.window.scrollY, 0);
  assert.equal(record(env).last.episode, 45);
  assert.deepEqual(record(env).completed, []);
});

test('a saved partial header/preface scroll restores without jumping to the first paragraph', async () => {
  const env = await ready(make());
  await env.scroll(180); await env.frames(2); await env.advance(350);
  const saved = record(env).last.position;
  assert.equal(saved.ratio, 0); assert.equal(saved.offset, 0.6);
  const restored = await ready(make({ now: 2000000, storage: Object.fromEntries(env.local) }));
  assert.equal(restored.window.scrollY, 180);
  assert.deepEqual(record(restored).completed, []);
});

test('explicit resume link carries only the selected published chapter anchor', async () => {
  const env = make({ hash: '#/s/ash-blade', storage: { [key(SID)]: diskRecord({ completed: [1, 43] }) } }); await flush();
  const link = env.one('.resume-link');
  assert.equal(link.textContent, '이어 읽기 · 43화'); assert.equal(link.href, '#/s/ash-blade/43');
  link.click(); await flush(); await env.frames(5);
  assert.equal(env.window.scrollY, 600); assert.equal(record(env).last.episode, 43);
  assert.deepEqual(record(env).completed, [1, 43]);
});

test('scroll saves are throttled at 350ms and pagehide flushes before navigation can reset scroll', async () => {
  const env = await ready(make());
  const initial = progressWrites(env).length;
  await env.scroll(400); await env.scroll(450); await env.frames(2);
  assert.equal(progressWrites(env).length, initial);
  await env.advance(349); assert.equal(progressWrites(env).length, initial);
  await env.advance(1); assert.equal(progressWrites(env).length, initial + 1);
  const saved = record(env).last.position;
  await env.scroll(550); env.event(env.window, 'pagehide', { bubbles: false });
  assert.notDeepEqual(record(env).last.position, saved);
  assert.equal(env.queuedTimers, 0);
  const beforeRoute = record(env).last.position;
  await env.navigate('#/s/ash-blade');
  assert.deepEqual(record(env).last.position, beforeRoute);
});

test('visibility transition flushes last visible position but never marks a hidden bottom', async () => {
  const env = await ready(make());
  await env.scroll(500); await env.frames(2);
  env.document.visibilityState = 'hidden'; env.event(env.document, 'visibilitychange');
  assert.ok(record(env).last.position.ratio > 0);
  const saved = record(env).last.position;
  await env.scroll(800); await env.advance(1000);
  assert.deepEqual(record(env).last.position, saved); assert.deepEqual(record(env).completed, []);
  assert.equal(env.queuedTimers, 0);
});

test('stale network success cannot write last opened or resume an abandoned chapter', async () => {
  const env = make({ hold: url => url === epPath(43), storage: { [key(SID)]: diskRecord() } }); await flush();
  await env.advance(1); await env.navigate('#/s/ash-blade/45'); await env.frames(5);
  await env.release(epPath(43)); await env.frames(8);
  assert.equal(record(env).last.episode, 45); assert.equal(env.window.scrollY, 0);
  assert.equal(env.one('.reader-head h1').textContent, '건너뛴 다음 화');
});

test('abandoned restore frames and setting-layout frames cannot scroll or write a newer route', async () => {
  const env = make({ storage: { [key(SID)]: diskRecord() } }); await flush(); await env.frame();
  await env.advance(1); await env.navigate('#/s/ash-blade/45'); await env.frames(8);
  assert.equal(env.window.scrollY, 0); assert.equal(record(env).last.episode, 45);
  await env.scroll(400); await env.frames(2); env.byId('gearBtn').click(); env.button('글자 크게').click();
  await env.navigate('#/s/awkward-season'); const writes = progressWrites(env).length;
  assert.ok(record(env).last.position.ratio > 0, 'navigation before setting reflow settles retains the pre-setting reading anchor');
  await env.frames(12); await env.advance(1000);
  assert.equal(env.window.scrollY, 0); assert.equal(progressWrites(env).length, writes);
  assert.equal(env.location.hash, '#/s/awkward-season');
});

test('font changes retain a paragraph anchor without adding a completion mark', async () => {
  const env = await ready(make()); await env.scroll(600); await env.frames(2); await env.advance(350);
  const saved = record(env).last.position;
  env.byId('gearBtn').click(); env.button('글자 크게').click(); await env.frames(5);
  assert.equal(env.window.scrollY, 600); assert.deepEqual(record(env).last.position, saved);
  assert.deepEqual(record(env).completed, []);
});

test('published gaps filter library summaries, resume links and TOC badges without rewriting disk', async () => {
  const raw = diskRecord({ episode: 44, completed: [1, 43, 44, 45, 999999] });
  const env = make({ hash: '#/', storage: { [key(SID)]: raw } }); await flush();
  const card = env.all('.series-card').find(node => node.href === '#/s/ash-blade');
  assert.equal(card.querySelector('.card-progress').textContent, '이 브라우저 · 읽음 3개');
  assert.equal(env.local.get(key(SID)), raw);
  await env.navigate('#/s/ash-blade');
  assert.equal(env.one('.resume-link'), null);
  assert.equal(env.one('.reading-summary').textContent, '이 브라우저 · 읽음 3개');
  const read = env.all('.ep-item').filter(node => !node.querySelector('.read-badge').hidden).map(node => Number(node.href.split('/').pop()));
  assert.deepEqual(read, [1, 43, 45]); assert.ok(!published(SID).includes(44));
  assert.equal(env.local.get(key(SID)), raw);
});

test('library metadata failure hides unverified read count and late responses cannot repaint a new route', async () => {
  const url = 'data/series/ash-blade/meta.json';
  const env = make({ hash: '#/', storage: { [key(SID)]: diskRecord({ completed: [1, 44] }) }, responses: { [url]: { httpStatus: 500 } } }); await flush();
  const card = env.all('.series-card').find(node => node.href === '#/s/ash-blade');
  assert.equal(card.querySelector('.card-progress').hidden, true);
  const delayed = make({ hash: '#/', hold: path => path === url }); await flush();
  await delayed.navigate('#/s/awkward-season'); await delayed.release(url);
  assert.equal(delayed.one('.card-progress'), null); assert.equal(delayed.location.hash, '#/s/awkward-season');
});

test('per-work clear requires deliberate confirmation; Cancel and Escape preserve URL, records and settings', async () => {
  const other = diskRecord({ episode: 3, completed: [1, 3] });
  const own = diskRecord({ completed: [1, 43] });
  const env = make({ hash: '#/s/ash-blade', storage: { [key(SID)]: own, [key('awkward-season')]: other, 'plcmanjp-theme': 'dark', 'plcmanjp-novel-reader': '{"size":5,"lh":4}' } }); await flush();
  const history = json(env.history.entries);
  env.button('기록 지우기').click();
  assert.equal(env.one('.record-confirm').hidden, false); assert.equal(env.document.activeElement.textContent, '취소');
  env.button('취소').click(); assert.equal(env.local.get(key(SID)), own);
  env.button('기록 지우기').click(); env.event(env.button('취소'), 'keydown', { key: 'Escape' });
  assert.equal(env.one('.record-confirm').hidden, true); assert.equal(env.local.get(key(SID)), own);
  assert.equal(env.document.activeElement.textContent, '기록 지우기');
  assert.equal(env.location.hash, '#/s/ash-blade'); assert.deepEqual(env.history.entries, history);
  env.button('기록 지우기').click(); env.button('이 작품 기록 지우기').click();
  assert.equal(record(env).last, null); assert.deepEqual(record(env).completed, []); assert.notEqual(record(env).epoch, '0');
  assert.equal(env.local.get(key('awkward-season')), other); assert.equal(env.local.get('plcmanjp-theme'), 'dark');
  assert.equal(env.local.get('plcmanjp-novel-reader'), '{"size":5,"lh":4}');
  assert.equal(env.one('.resume-link'), null); assert.equal(env.one('.reading-summary').textContent, '이 브라우저 · 읽음 0개');
  assert.equal(env.one('.record-feedback').textContent, '이 작품의 읽기 기록을 지웠습니다.');
});

test('external reset invalidates delayed saves, layout work and completion until chapter reopened', async () => {
  const disk = new Map(); const env = await ready(make({ sharedStorage: disk }));
  await env.scroll(500); await env.frames(2);
  const external = env.window.NovelProgress.create({ storage: env.window.localStorage, now: () => env.now + 1 }); external.clear(SID);
  env.event(env.window, 'storage', { key: key(SID), newValue: disk.get(key(SID)), bubbles: false });
  assert.ok(env.one('.reader-progress').textContent.includes('다른 탭에서 기록을 지웠습니다'));
  await complete(env); await env.advance(1000); env.event(env.window, 'pagehide', { bubbles: false });
  assert.equal(record(env).last, null); assert.deepEqual(record(env).completed, []);
  await env.navigate('#/s/ash-blade'); await env.navigate('#/s/ash-blade/43'); await env.frames(5);
  assert.equal(record(env).last.episode, 43); assert.deepEqual(record(env).completed, []);
});

test('storage-event reset evidence wins even when a stale process already overwrote disk and resetter closed', async () => {
  const env = await ready(make());
  const stale = env.local.get(key(SID));
  const external = env.window.NovelProgress.create({ storage: env.window.localStorage, now: () => env.now + 1 });
  external.clear(SID); const reset = env.local.get(key(SID));
  env.local.set(key(SID), stale); // Another process finishes its pre-reset write.
  env.event(env.window, 'storage', { key: key(SID), oldValue: stale, newValue: reset, bubbles: false });
  assert.ok(env.one('.reader-progress').textContent.includes('다른 탭에서 기록을 지웠습니다'));
  assert.equal(record(env).last, null); assert.deepEqual(record(env).completed, []);
  assert.equal(record(env).epoch, JSON.parse(reset).epoch);
  await complete(env); await env.advance(1000);
  assert.equal(record(env).last, null); assert.deepEqual(record(env).completed, []);
});

test('newer tab owns recent chapter despite older tab delayed scroll/pagehide saves', async () => {
  const disk = new Map(); const old = await ready(make({ sharedStorage: disk, now: 1000 }));
  await old.scroll(500); await old.frames(2);
  const newer = await ready(make({ hash: '#/s/ash-blade/45', sharedStorage: disk, now: 2000 }));
  assert.equal(record(newer).last.episode, 45);
  await old.advance(350); old.event(old.window, 'pagehide', { bubbles: false });
  assert.equal(record(old).last.episode, 45);
  old.event(old.window, 'storage', { key: key(SID), bubbles: false });
  await complete(old); newer.event(newer.window, 'storage', { key: key(SID), bubbles: false });
  assert.deepEqual(record(newer).completed, [43]); assert.equal(record(newer).last.episode, 45);
});

test('bfcache restoration refreshes library summaries and TOC badges changed by another tab', async () => {
  for (const hash of ['#/', '#/s/ash-blade']) {
    const env = make({ hash }); await flush();
    const external = env.window.NovelProgress.create({ storage: env.window.localStorage, now: () => env.now + 1 });
    external.complete(SID, 43);
    env.event(env.window, 'pageshow', { persisted: true, bubbles: false });
    if (hash === '#/') {
      const card = env.all('.series-card').find(node => node.href === '#/s/ash-blade');
      assert.equal(card.querySelector('.card-progress').hidden, false);
      assert.equal(card.querySelector('.card-progress').textContent, '이 브라우저 · 읽음 1개');
    } else {
      assert.equal(env.one('.reading-summary').textContent, '이 브라우저 · 읽음 1개');
      assert.equal(env.all('.ep-item').find(node => node.href.endsWith('/43')).querySelector('.read-badge').hidden, false);
    }
  }
});

test('bfcache restoration after another tab resets announces suspension and does not resurrect data', async () => {
  const env = await ready(make());
  const external = env.window.NovelProgress.create({ storage: env.window.localStorage, now: () => env.now + 1 });
  external.clear(SID);
  env.event(env.window, 'pageshow', { persisted: true, bubbles: false });
  assert.ok(env.one('.reader-progress').textContent.includes('다른 탭에서 기록을 지웠습니다'));
  await complete(env); await env.advance(1000);
  assert.equal(record(env).last, null); assert.deepEqual(record(env).completed, []);
});

test('storage corruption and access failures remain nonfatal and visible without clobbering corrupt bytes', async () => {
  const raw = '{unparseable';
  const corrupt = await ready(make({ storage: { [key(SID)]: raw } }));
  await complete(corrupt); await corrupt.advance(350);
  assert.equal(corrupt.local.get(key(SID)), raw); assert.ok(corrupt.one('.reader-local-note').textContent.includes('덮어쓰지 않았습니다'));
  const blocked = await ready(make({ blockStorage: true }));
  await complete(blocked); blocked.byId('gearBtn').click(); blocked.button('글자 크게').click(); await blocked.frames(5);
  assert.ok(blocked.one('.reader-body')); assert.ok(blocked.one('.reader-local-note').textContent.includes('이 탭에만 임시'));
  const quota = await ready(make()); quota.storageFaults.write = new Error('QuotaExceededError');
  await complete(quota); await quota.advance(350);
  assert.ok(quota.one('.reader-progress').textContent.includes('이 회차 읽음')); assert.ok(quota.one('.reader-local-note').textContent.includes('이 탭에만 임시'));
});

test('unpublished and failed chapters never get a reading-history session', async () => {
  const env = make({ hash: '#/s/ash-blade/44', responses: { [epPath(44)]: chapter } }); await ready(env); await env.scroll(800); await env.frames(5);
  assert.equal(record(env), null); assert.equal(env.one('.reader-body'), null);
  const failed = make({ responses: { [epPath(43)]: { httpStatus: 404 } } }); await ready(failed); await failed.scroll(800); await failed.frames(5);
  assert.equal(record(failed), null); assert.ok(failed.button('다시 시도'));
});

