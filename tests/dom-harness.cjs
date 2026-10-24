'use strict';

// Deliberately small, dependency-free DOM model for app-level regression tests.
// It executes the real scripts and event handlers, but does NOT model layout,
// CSS, browser focus rules, accessibility APIs, or real history restoration.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class TestEvent {
  constructor(type, properties = {}) {
    Object.assign(this, { type, bubbles: true, defaultPrevented: false }, properties);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener.call(this, event);
    if (event.bubbles && !event.stopped && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
}

class Node extends Target {
  constructor(tag, document, text = '') {
    super();
    this.tagName = tag.toUpperCase();
    this.nodeType = tag === '#text' ? 3 : 1;
    this.ownerDocument = document;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this._text = text;
    this.hidden = false;
    this.disabled = false;
    this.style = {
      values: new Map(),
      setProperty(key, value) { this.values.set(key, String(value)); },
      getPropertyValue(key) { return this.values.get(key) || ''; },
      removeProperty(key) { this.values.delete(key); }
    };
    this.classList = {
      contains: value => this.className.split(/\s+/).includes(value),
      add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
      remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); },
      toggle: (value, force) => {
        const add = force === undefined ? !this.classList.contains(value) : force;
        this.classList[add ? 'add' : 'remove'](value);
        return add;
      }
    };
  }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return this.ownerDocument.contains(this); }
  get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    if (this.nodeType === 3) this._text = String(value);
    else if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  set innerHTML(_) { throw new Error('Unsafe innerHTML assignment: use textContent/DOM nodes'); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get href() { return this.getAttribute('href') || ''; }
  set href(value) { this.setAttribute('href', value); }
  get dataset() {
    return Object.fromEntries([...this.attributes].filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
    if (name === 'disabled') this.disabled = false;
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node); }
  prepend(...nodes) { for (const node of nodes.reverse()) this.insertBefore(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node, this.firstChild); }
  insertBefore(node, before) {
    if (!before) return this.appendChild(node);
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = this.childNodes.indexOf(before);
    if (index < 0) throw new Error('insertBefore target missing');
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild target missing');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) this.removeChild(node); this.append(...nodes); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  getBoundingClientRect() {
    const supplied = this.ownerDocument.layout?.(this) || {};
    const top = supplied.top ?? 0;
    const left = supplied.left ?? 0;
    const bottom = supplied.bottom ?? top + (supplied.height ?? 0);
    const right = supplied.right ?? left + (supplied.width ?? 0);
    return { x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top, ...supplied };
  }
  scrollIntoView() {}
  matches(selector) {
    const attributes = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    const bare = selector.replace(/\[[^\]]*\]/g, '');
    const tag = bare.match(/^[a-z][\w-]*/i);
    if (tag && this.tagName !== tag[0].toUpperCase()) return false;
    const id = bare.match(/#([\w-]+)/);
    if (id && this.id !== id[1]) return false;
    if ([...bare.matchAll(/\.([\w-]+)/g)].some(match => !this.classList.contains(match[1]))) return false;
    return attributes.every(([, name, value]) => this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value));
  }
  closest(selector) { let node = this; while (node && node.nodeType === 1) { if (node.matches(selector)) return node; node = node.parentElement; } return null; }
  querySelectorAll(selector) {
    const alternatives = selector.split(',').map(value => value.trim());
    const matches = [];
    function walk(node) {
      for (const child of node.children) {
        if (alternatives.some(alternative => {
          const parts = alternative.split(/\s+/);
          if (!child.matches(parts.pop())) return false;
          let ancestor = child.parentElement;
          while (parts.length) {
            const part = parts.pop();
            while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentElement;
            if (!ancestor) return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        })) matches.push(child);
        walk(child);
      }
    }
    walk(this);
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() {
    if (this.disabled) return;
    this.focus();
    const event = new TestEvent('click');
    this.dispatchEvent(event);
    if (this.tagName === 'A' && this.href.startsWith('#') && !event.defaultPrevented) this.ownerDocument.navigate(this.href);
  }
}

class Document extends Node {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.documentElement = this.createElement('html');
    this.appendChild(this.documentElement);
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
    this.title = '';
    this.visibilityState = 'visible';
  }
  createElement(tag) { return new Node(tag, this); }
  createTextNode(text) { return new Node('#text', this, String(text)); }
  getElementById(id) { return this.querySelector('#' + id); }
  hasFocus() { return this.focused !== false; }
}

function parseMarkup(document, html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const stack = [document];
  for (const token of clean.match(/<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = token.slice(2, -1).trim().toUpperCase();
      while (stack.length > 1) { if (stack.pop().tagName === tag) break; }
      continue;
    }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)[1].toLowerCase();
      const node = tag === 'html' ? document.documentElement : tag === 'head' ? document.head : tag === 'body' ? document.body : document.createElement(tag);
      for (const [, name, quoted, single, bare] of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(name, quoted ?? single ?? bare ?? '');
      if (!node.parentNode) stack[stack.length - 1].appendChild(node);
      if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !token.endsWith('/>')) stack.push(node);
    } else if (token.trim()) stack[stack.length - 1].appendChild(document.createTextNode(token));
  }
}

async function flush() { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); }

function setup(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const fixtureRoot = options.fixtureRoot || path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const document = new Document();
  parseMarkup(document, html);
  // Multiple contexts may share this map; storage events remain explicit so tests
  // can reproduce delayed cross-tab delivery without pretending to be a browser.
  const local = options.sharedStorage || new Map(Object.entries(options.storage || {}));
  const writes = [];
  const storageFaults = { read: false, write: false, remove: false, ...options.storageFaults };
  function storageFailure(kind) {
    const failure = options.blockStorage || storageFaults[kind];
    if (failure) throw failure instanceof Error ? failure : new Error('Storage ' + kind + ' disabled');
  }
  const localStorage = {
    getItem(key) { storageFailure('read'); return local.get(key) ?? null; },
    setItem(key, value) { storageFailure('write'); local.set(key, String(value)); writes.push([key, String(value)]); },
    removeItem(key) { storageFailure('remove'); local.delete(key); },
    key(index) { storageFailure('read'); return [...local.keys()][index] ?? null; },
    get length() { storageFailure('read'); return local.size; }
  };
  const window = new Target();
  document.parentNode = window;
  const location = { hash: options.hash || '#/' };
  const history = { entries: [location.hash], position: 0, scrollRestoration: 'auto' };
  const scrolls = [];
  Object.assign(window, { document, location, localStorage, history, innerHeight: options.innerHeight ?? 800, scrollY: 0, pageYOffset: 0 });
  document.focused = options.focused !== false;
  document.visibilityState = options.visibilityState || 'visible';
  window.scrollTo = (...args) => { scrolls.push(args); window.scrollY = typeof args[0] === 'object' ? args[0].top : args[1]; window.pageYOffset = window.scrollY; };
  window.matchMedia = query => ({ matches: query.includes('dark') ? !!options.systemDark : false, addEventListener() {}, removeEventListener() {} });
  let now = options.now ?? 1000000;
  let callbackId = 0;
  const animationFrames = new Map();
  const timers = new Map();
  window.requestAnimationFrame = callback => {
    const id = ++callbackId;
    if (options.manualFrames) animationFrames.set(id, callback);
    else callback(0);
    return id;
  };
  window.cancelAnimationFrame = id => { animationFrames.delete(id); };
  const scheduleTimeout = options.manualTimers ? (callback, delay = 0, ...args) => {
    const id = ++callbackId;
    timers.set(id, { callback, due: now + Math.max(0, Number(delay) || 0), args });
    return id;
  } : setTimeout;
  const cancelTimeout = options.manualTimers ? id => { timers.delete(id); } : clearTimeout;
  const ClockDate = options.manualTimers ? class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  } : Date;
  Object.assign(window, { setTimeout: scheduleTimeout, clearTimeout: cancelTimeout, Date: ClockDate });
  const requests = [];
  const pending = [];
  function dataFor(url) {
    if (options.responses && Object.hasOwn(options.responses, url)) return options.responses[url];
    const file = path.join(fixtureRoot, url);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const match = url.match(/^data\/series\/([^/]+)\/episodes\/(\d+)\.json$/);
    if (match) {
      const metaFile = path.join(fixtureRoot, 'data/series', match[1], 'meta.json');
      if (fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        const episode = meta.episodes.find(item => item.episode === Number(match[2]));
        if (episode) return { ...episode, series_id: match[1], body: '테스트용 문장입니다.\n같은 문단의 다음 줄입니다.\n\n두 번째 문단입니다.' };
      }
    }
    return { httpStatus: 404 };
  }
  function response(data) {
    if (data instanceof Error) return Promise.reject(data);
    const status = data?.httpStatus || 200;
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(structuredClone(data)) });
  }
  const fetch = (url, init) => {
    const request = { url, init, index: requests.length };
    requests.push(request);
    if (options.hold?.(url, request.index)) return new Promise((resolve, reject) => pending.push({ ...request, resolve, reject }));
    return response(dataFor(url));
  };
  const sandbox = { document, window, location, history, localStorage, fetch, console, AbortController, URL, Date: ClockDate, Event: TestEvent, KeyboardEvent: TestEvent, setTimeout: scheduleTimeout, clearTimeout: cancelTimeout, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame };
  const context = vm.createContext(sandbox);
  document.navigate = hash => {
    if (hash === location.hash) return;
    history.entries.splice(history.position + 1);
    history.entries.push(hash);
    history.position++;
    location.hash = hash;
    window.dispatchEvent(new TestEvent('hashchange', { bubbles: false }));
  };
  const env = {
    document, window, location, history, local, writes, storageFaults, requests, pending, scrolls, context,
    // Rectangles are viewport-relative and supplied by the test, not CSS-derived.
    layout: options.layout || null,
    get now() { return now; },
    get queuedFrames() { return animationFrames.size; },
    get queuedTimers() { return timers.size; },
    frame: async () => {
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) callback(now);
      await flush();
      return callbacks.length;
    },
    frames: async (count = 1) => { for (let index = 0; index < count; index++) await env.frame(); },
    advance: async milliseconds => {
      if (!options.manualTimers) throw new Error('advance requires setup({ manualTimers: true })');
      const target = now + Math.max(0, milliseconds);
      let executions = 0;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        if (++executions > 10000) throw new Error('Too many timers: possible unbounded timer loop');
        const [id, timer] = next;
        now = timer.due;
        timers.delete(id);
        timer.callback(...timer.args);
        await flush();
      }
      now = target;
      await flush();
    },
    scroll: async (y, { input = true } = {}) => {
      if (input) document.body.dispatchEvent(new TestEvent('wheel', { deltaY: y - window.scrollY, isTrusted: true }));
      window.scrollTo(0, y);
      window.dispatchEvent(new TestEvent('scroll', { bubbles: false, isTrusted: true }));
      await flush();
    },
    app: document.getElementById('app'),
    byId: id => document.getElementById(id),
    all: selector => document.querySelectorAll(selector),
    one: selector => document.querySelector(selector),
    button: label => document.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label || node.textContent === label),
    navigate: async hash => { document.navigate(hash); await flush(); },
    traverse: async direction => {
      history.position = Math.max(0, Math.min(history.entries.length - 1, history.position + direction));
      location.hash = history.entries[history.position];
      window.dispatchEvent(new TestEvent('hashchange', { bubbles: false }));
      await flush();
    },
    event: (target, type, properties = {}) => target.dispatchEvent(new TestEvent(type, properties)),
    release: async (predicate, value) => {
      const index = pending.findIndex(request => typeof predicate === 'string' ? request.url === predicate : predicate(request));
      if (index < 0) throw new Error('No pending request matches ' + predicate);
      const request = pending.splice(index, 1)[0];
      if (value instanceof Error) request.reject(value);
      else request.resolve(await response(value === undefined ? dataFor(request.url) : value));
      await flush();
    },
    flush
  };
  document.layout = node => env.layout?.(node, env);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = match[1].match(/\bsrc=["']([^"']+)["']/);
    const filename = src ? src[1].replace(/\?.*$/, '') : 'inline-theme-init.js';
    const code = src ? fs.readFileSync(path.join(root, filename), 'utf8') : match[2];
    vm.runInContext(code, context, { filename });
  }
  return env;
}

module.exports = { setup, flush, TestEvent };
