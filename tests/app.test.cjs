'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, flush } = require('./dom-harness.cjs');

const root = process.env.NOVEL_APP_ROOT ? path.resolve(process.env.NOVEL_APP_ROOT) : path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(__dirname, '..');
const SERIES = ['ash-blade', 'awkward-season', 'hollow-observer'];
const THEME_KEY = 'plcmanjp-theme';
const READER_KEY = 'plcmanjp-novel-reader';
const data = relative => JSON.parse(fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'));
const meta = id => data('data/series/' + id + '/meta.json');
const make = options => setup({ root, fixtureRoot, ...options });
const style = (env, name) => env.document.documentElement.style.getPropertyValue(name);
const settings = env => JSON.parse(env.local.get(READER_KEY));
const epPath = (id, no) => 'data/series/' + id + '/episodes/' + String(no).padStart(6, '0') + '.json';
const heading = env => env.app.querySelector('h1')?.textContent;

test('public library retains work order, titles, summaries, and hash links', async () => {
  const env = make(); await flush();
  const index = data('data/index.json');
  const links = env.all('.series-card');
  assert.deepEqual(links.map(node => node.href), index.series.map(work => '#/s/' + work.series_id));
  for (const [indexNo, work] of index.series.entries()) {
    assert.ok(links[indexNo].textContent.includes(work.series_title));
    assert.ok(links[indexNo].textContent.includes(work.summary));
  }
  assert.equal(env.byId('gearBtn').hidden, true);
});

test('legacy/partial works never enter the public library', async () => {
  const index = data('data/index.json');
  index.series.push({ series_id: 'partial-a', status: 'legacy_partial' }, { series_id: 'partial-b', legacy_partial: true });
  const env = make({ responses: { 'data/index.json': index } }); await flush();
  assert.equal(env.all('.series-card').length, 3);
});

for (const id of SERIES) {
  test(id + ': complete published table of contents preserves ordering and title text', async () => {
    const env = make({ hash: '#/s/' + id }); await flush();
    const episodes = meta(id).episodes.slice().sort((a, b) => a.episode - b.episode);
    const links = env.all('.ep-item');
    assert.equal(links.length, episodes.length);
    assert.deepEqual(links.map(node => node.href), episodes.map(ep => '#/s/' + id + '/' + ep.episode));
    for (const [index, ep] of episodes.entries()) assert.ok(links[index].textContent.includes(ep.title));
    assert.equal(heading(env), meta(id).series_title);
  });
}

test('previous and next use the published sequence across the missing 44th episode', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  assert.equal(env.one('.epnav .prev').href, '#/s/ash-blade/42');
  assert.equal(env.one('.epnav .next').href, '#/s/ash-blade/45');
  env.one('.epnav .next').click(); await flush();
  assert.equal(env.location.hash, '#/s/ash-blade/45');
  assert.equal(env.one('.epnav .prev').href, '#/s/ash-blade/43');
});

test('first and final episodes have non-actionable unavailable neighbors', async () => {
  const env = make({ hash: '#/s/ash-blade/1' }); await flush();
  assert.equal(env.one('.epnav .prev').tagName, 'SPAN');
  assert.equal(env.one('.epnav .prev').href, '');
  const final = Math.max(...meta('ash-blade').episodes.map(ep => ep.episode));
  await env.navigate('#/s/ash-blade/' + final);
  assert.equal(env.one('.epnav .next').tagName, 'SPAN');
  assert.equal(env.one('.epnav .next').href, '');
});

test('first and latest call-to-action URLs target actual published entries', async () => {
  const env = make({ hash: '#/s/ash-blade' }); await flush();
  const episodeNumbers = meta('ash-blade').episodes.map(ep => ep.episode);
  const links = env.all('.cta a').map(node => node.href);
  assert.ok(links.includes('#/s/ash-blade/' + Math.min(...episodeNumbers)));
  assert.ok(links.includes('#/s/ash-blade/' + Math.max(...episodeNumbers)));
  for (const href of links) assert.ok(episodeNumbers.includes(Number(href.split('/').pop())));
});

test('a stale latest_episode pointer cannot link to an unpublished episode', async () => {
  const altered = meta('ash-blade'); altered.latest_episode = 999999;
  const env = make({ hash: '#/s/ash-blade', responses: { 'data/series/ash-blade/meta.json': altered } }); await flush();
  const numbers = altered.episodes.map(ep => ep.episode);
  for (const link of env.all('.cta a')) assert.ok(numbers.includes(Number(link.href.split('/').pop())));
});

test('real published episode title, paragraph order, and line breaks remain intact', async () => {
  const filename = epPath('ash-blade', 43);
  const episode = data(filename);
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  assert.equal(heading(env), episode.title);
  const rendered = env.one('.reader-body').children.map(p => p.childNodes.map(node => node.tagName === 'BR' ? '\n' : node.textContent).join(''));
  const original = episode.body.split(/\n{2,}/).map(block => block.split('\n').map(line => line.trimEnd()).filter(Boolean).join('\n')).filter(Boolean);
  assert.deepEqual(rendered, original);
});

test('model-produced title/body strings render as text, not HTML or script', async () => {
  const title = '<img src=x onerror=alert(1)> & <script>bad()</script>';
  const body = '첫 줄 <script>globalThis.INJECTED = true</script>\n둘째 줄 & 안전\n\n<img src=x onerror=alert(1)>';
  const fixture = { episode: 43, season: 1, title, body };
  const env = make({ hash: '#/s/ash-blade/43', responses: { [epPath('ash-blade', 43)]: fixture } }); await flush();
  assert.equal(heading(env), title);
  assert.ok(env.one('.reader-body').textContent.includes('<script>globalThis.INJECTED = true</script>'));
  assert.equal(env.one('.reader-body').querySelectorAll('script,img').length, 0);
  assert.equal(env.context.INJECTED, undefined);
});

test('an unlisted episode file cannot be displayed as a published chapter', async () => {
  const env = make({ hash: '#/s/ash-blade/44', responses: { [epPath('ash-blade', 44)]: { episode: 44, title: 'UNLISTED DRAFT', body: 'Never display this text.' } } }); await flush();
  assert.ok(!env.one('.reader-body'), 'reader body must not be rendered');
  assert.ok(!env.app.textContent.includes('Never display this text.'));
  assert.equal(env.byId('gearBtn').hidden, true);
});

test('a 404 gives a usable retry which recovers when data becomes available', async () => {
  const responses = { [epPath('ash-blade', 43)]: { httpStatus: 404 } };
  const env = make({ hash: '#/s/ash-blade/43', responses }); await flush();
  assert.ok(!env.one('.reader-body'), 'reader body must not be rendered');
  assert.ok(env.button('다시 시도'));
  responses[epPath('ash-blade', 43)] = data(epPath('ash-blade', 43));
  env.button('다시 시도').click(); await flush();
  assert.ok(env.one('.reader-body'));
  assert.equal(heading(env), data(epPath('ash-blade', 43)).title);
});

test('slow library success cannot overwrite a newer series route', async () => {
  const env = make({ hold: url => url === 'data/index.json' });
  await env.navigate('#/s/ash-blade');
  assert.equal(heading(env), meta('ash-blade').series_title);
  await env.release('data/index.json');
  assert.equal(heading(env), meta('ash-blade').series_title);
  assert.ok(env.one('.ep-list'));
});

test('slow library failure cannot replace a newer successful episode', async () => {
  const env = make({ hold: url => url === 'data/index.json' });
  await env.navigate('#/s/ash-blade/45');
  await env.release('data/index.json', new Error('Delayed request failure'));
  assert.equal(heading(env), data(epPath('ash-blade', 45)).title);
  assert.ok(env.one('.reader-body'));
});

test('rapid consecutive chapter requests keep the newest title, content, navigation, and settings', async () => {
  const env = make({ hash: '#/s/ash-blade/43', hold: url => url === epPath('ash-blade', 43) });
  await env.navigate('#/s/ash-blade/45');
  await env.release(epPath('ash-blade', 43));
  assert.equal(heading(env), data(epPath('ash-blade', 45)).title);
  assert.equal(env.one('.epnav .prev').href, '#/s/ash-blade/43');
  assert.equal(env.byId('gearBtn').hidden, false);
});

test('modeled Back/Forward hash traversal rerenders the matching work and episode', async () => {
  const env = make(); await flush();
  await env.navigate('#/s/ash-blade');
  await env.navigate('#/s/ash-blade/43');
  await env.navigate('#/s/ash-blade/45');
  await env.traverse(-1);
  assert.equal(heading(env), data(epPath('ash-blade', 43)).title);
  await env.traverse(-1);
  assert.equal(heading(env), meta('ash-blade').series_title);
  assert.equal(env.byId('gearBtn').hidden, true);
  await env.traverse(1);
  assert.equal(heading(env), data(epPath('ash-blade', 43)).title);
  await env.traverse(1);
  assert.equal(heading(env), data(epPath('ash-blade', 45)).title);
});

test('legacy leading-zero chapter URLs remain readable without changing the hash', async () => {
  const env = make({ hash: '#/s/ash-blade/000043' }); await flush();
  assert.equal(heading(env), data(epPath('ash-blade', 43)).title);
  assert.equal(env.location.hash, '#/s/ash-blade/000043');
  assert.equal(env.one('.epnav .prev').href, '#/s/ash-blade/42');
  assert.equal(env.one('.epnav .next').href, '#/s/ash-blade/45');
});

for (const hash of ['#/s/%E0%A4%A', '#/s/ash-blade/43junk', '#/s/ash-blade/43/extra', '#/s/ash-blade/0', '#/s/ash-blade/-1', '#/s/ash-blade/1.5']) {
  test('malformed route safely rejects without reader rendering: ' + hash, async () => {
    const env = make({ hash }); await flush();
    assert.ok(!env.one('.reader-body'), 'reader body must not be rendered');
    assert.ok(env.app.textContent.length > 0);
  });
}

test('theme defaults to system but valid saved preference takes precedence', async () => {
  let env = make({ systemDark: true }); await flush();
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
  env = make({ systemDark: true, storage: { [THEME_KEY]: 'light' } }); await flush();
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'light');
});

test('legacy theme key migrates once while keeping the selected color scheme', async () => {
  const env = make({ storage: { 'plcmanjp-tool-theme': 'dark' } }); await flush();
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(env.local.get(THEME_KEY), 'dark');
  assert.equal(env.local.has('plcmanjp-tool-theme'), false);
});

test('repeated theme toggle updates accessible label, theme color, and local preference', async () => {
  const env = make(); await flush();
  const firstColor = env.byId('themeColor').getAttribute('content');
  for (const expected of ['dark', 'light', 'dark']) {
    env.byId('themeBtn').click();
    assert.equal(env.document.documentElement.getAttribute('data-theme'), expected);
    assert.equal(env.local.get(THEME_KEY), expected);
    assert.ok(env.byId('themeBtn').getAttribute('aria-label').includes(expected === 'dark' ? '다크' : '라이트'));
  }
  assert.notEqual(env.byId('themeColor').getAttribute('content'), firstColor);
});

test('theme changes synchronize from storage and bfcache pageshow without extra writes', async () => {
  const env = make(); await flush();
  const writes = env.writes.length;
  env.event(env.window, 'storage', { key: THEME_KEY, newValue: 'dark', bubbles: false });
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
  env.event(env.window, 'storage', { key: 'unrelated-key', newValue: 'light', bubbles: false });
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
  env.local.set(THEME_KEY, 'light');
  env.event(env.window, 'pageshow', { bubbles: false, persisted: true });
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(env.writes.length, writes);
});

test('storage access denial does not prevent reading, settings changes, or theme switching', async () => {
  const env = make({ hash: '#/s/ash-blade/43', blockStorage: true }); await flush();
  assert.ok(env.one('.reader-body'));
  env.byId('gearBtn').click(); env.button('글자 크게').click(); env.byId('themeBtn').click();
  assert.notEqual(style(env, '--read-size'), 'undefinedrem');
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
});

test('font size and line height persist and restore through a fresh page context', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  env.byId('gearBtn').click();
  env.button('글자 크게').click(); env.button('줄 간격 넓게').click();
  const restored = make({ hash: env.location.hash, storage: Object.fromEntries(env.local) }); await flush();
  assert.equal(style(restored, '--read-size'), style(env, '--read-size'));
  assert.equal(style(restored, '--read-lh'), style(env, '--read-lh'));
  assert.equal(heading(restored), heading(env));
});

test('settings step controls clamp both ends and reset to the unchanged defaults', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  const defaults = [style(env, '--read-size'), style(env, '--read-lh')];
  env.byId('gearBtn').click();
  for (let i = 0; i < 20; i++) { env.button('글자 크게').click(); env.button('줄 간격 넓게').click(); }
  assert.equal(env.button('글자 크게').disabled, true);
  assert.equal(env.button('줄 간격 넓게').disabled, true);
  assert.deepEqual(settings(env), { size: 6, lh: 5 });
  for (let i = 0; i < 20; i++) { env.button('글자 작게').click(); env.button('줄 간격 좁게').click(); }
  assert.equal(env.button('글자 작게').disabled, true);
  assert.equal(env.button('줄 간격 좁게').disabled, true);
  assert.deepEqual(settings(env), { size: 0, lh: 0 });
  env.button('기본값').click();
  assert.deepEqual([style(env, '--read-size'), style(env, '--read-lh')], defaults);
  assert.deepEqual(settings(env), { size: 3, lh: 3 });
});

for (const saved of ['not json', 'null', '{"size":-1,"lh":999}', '{"size":2.5,"lh":1.5}', '{"size":"2","lh":"1"}']) {
  test('invalid saved reader settings fall back safely: ' + saved, async () => {
    const env = make({ hash: '#/s/ash-blade/43', storage: { [READER_KEY]: saved } }); await flush();
    assert.equal(style(env, '--read-size'), '1.12rem');
    assert.equal(style(env, '--read-lh'), '1.95');
    assert.ok(env.one('.reader-body'));
  });
}

test('Escape dismisses settings and returns focus to the settings trigger', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  env.byId('gearBtn').click();
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'false');
  env.button('글자 크게').focus();
  env.event(env.document, 'keydown', { key: 'Escape' });
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
  assert.equal(env.byId('gearBtn').getAttribute('aria-expanded'), 'false');
  assert.equal(env.document.activeElement, env.byId('gearBtn'));
});

test('outside click dismisses the settings panel while inside controls keep it open', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  env.byId('gearBtn').click();
  env.button('글자 크게').click();
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'false');
  env.event(env.app, 'click');
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
});

test('navigation closes settings, and returning to reading does not reopen stale controls', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  env.byId('gearBtn').click(); env.button('글자 크게').focus();
  await env.navigate('#/s/ash-blade');
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
  assert.equal(env.byId('settings').hasAttribute('inert'), true);
  assert.equal(env.byId('gearBtn').hidden, true);
  await env.navigate('#/s/ash-blade/45');
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
  assert.equal(env.byId('gearBtn').getAttribute('aria-expanded'), 'false');
  env.byId('gearBtn').click(); env.byId('gearBtn').click();
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
});

test('the explicit settings close button dismisses without changing the reading URL', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  env.byId('gearBtn').click();
  const close = env.one('.settings-close');
  assert.ok(close, 'settings needs an explicit close control');
  close.click();
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
  assert.equal(env.location.hash, '#/s/ash-blade/43');
  assert.ok(env.document.activeElement === env.byId('gearBtn'));
});

test('the skip link focuses the content without replacing the reader hash route', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  const skip = env.byId('skipLink');
  assert.ok(skip, 'skip link must exist');
  skip.click(); await flush();
  assert.equal(env.location.hash, '#/s/ash-blade/43');
  assert.ok(env.document.activeElement === env.app);
  assert.equal(env.app.getAttribute('tabindex'), '-1');
  assert.ok(env.one('.reader-body'));
});

test('successful routes expose a matching document title and clear the busy state', async () => {
  const env = make({ hash: '#/s/ash-blade/43' }); await flush();
  assert.ok(env.document.title.includes(data(epPath('ash-blade', 43)).title));
  assert.equal(env.app.getAttribute('aria-busy'), 'false');
  assert.ok(env.document.activeElement === env.app);
  await env.navigate('#/s/awkward-season');
  assert.ok(env.document.title.includes(meta('awkward-season').series_title));
  assert.equal(env.app.getAttribute('aria-busy'), 'false');
  assert.ok(env.document.activeElement === env.app);
});

test('slow episode loading with saved settings does not expose a panel that can steal focus', async () => {
  const env = make({ hash: '#/s/ash-blade/43', storage: { [READER_KEY]: '{"size":5,"lh":4}' }, hold: url => url === epPath('ash-blade', 43) });
  await flush();
  assert.equal(env.byId('gearBtn').hidden, true);
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
  assert.equal(style(env, '--read-size'), '1.3rem');
  await env.release(epPath('ash-blade', 43));
  assert.equal(env.byId('gearBtn').hidden, false);
  assert.equal(env.byId('settings').getAttribute('aria-hidden'), 'true');
  env.byId('gearBtn').click();
  env.button('줄 간격 넓게').focus();
  assert.equal(env.document.activeElement, env.button('줄 간격 넓게'));
  assert.equal(style(env, '--read-lh'), '2.1');
});
