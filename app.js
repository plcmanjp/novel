/* PLCManJP · AI 웹소설 연재관 — 정적 리더 로직
   - 외부 프레임워크 없음. 순수 DOM.
   - 모델이 생성한 title/body는 절대 innerHTML에 넣지 않는다 → textContent / DOM 노드만 사용.
   - 라우팅: location.hash
       #/                     작품 목록
       #/s/<series_id>        작품 상세(회차 인덱스)
       #/s/<series_id>/<ep>   회차 리더
*/
(function () {
  "use strict";

  var DATA = "data";
  var app = document.getElementById("app");
  var elTitle = document.getElementById("navTitle");
  var elGear = document.getElementById("gearBtn");
  var elSettings = document.getElementById("settings");
  var renderToken = 0;

  // 사이트 공통 테마: 라이트 ↔ 다크
  var THEME_KEY = "plcmanjp-theme";
  var themeOrder = ["light", "dark"];
  var themeLabel = { light: "라이트", dark: "다크" };
  var themeBtn = document.getElementById("themeBtn");
  var themeOut = document.getElementById("themeLbl");
  var currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  var themeMeta = document.getElementById("themeColor");
  function readTheme() {
    try {
      var theme = localStorage.getItem(THEME_KEY);
      if (theme === "dark" || theme === "light") return theme;
    } catch (e) {}
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function applyTheme(theme, save) {
    theme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    currentTheme = theme;
    themeOut.textContent = themeLabel[theme];
    themeBtn.setAttribute("aria-label", "테마 전환: 현재 " + themeLabel[theme]);
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#181a19" : "#faf9f6");
    if (save !== false) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    }
  }
  themeBtn.addEventListener("click", function () {
    applyTheme(themeOrder[(themeOrder.indexOf(currentTheme) + 1) % themeOrder.length]);
  });
  window.addEventListener("pageshow", function () { applyTheme(readTheme(), false); });
  window.addEventListener("storage", function (event) {
    if (event.key === THEME_KEY) applyTheme(event.newValue === "dark" ? "dark" : "light", false);
  });
  applyTheme(currentTheme, false);

  // ── 이 브라우저의 읽기 기록 (본문/계정 정보는 전송하지 않음) ──
  var progressViews = [];
  var activeReader = null;
  var pendingResume = null;
  var progressStore = window.NovelProgress.create({ onChange: refreshProgressViews });
  var tabId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  var openSequence = 0;
  try { window.history.scrollRestoration = "manual"; } catch (e) {}

  function refreshProgressViews() {
    progressViews.forEach(function (refresh) { refresh(); });
  }
  function progressSummary(state) {
    return (state.last ? "최근 " + state.last.episode + "화 · " : "") + "읽음 " + state.completed.length + "개";
  }
  function storageMessage(state) {
    if (state.status === "corrupt") return "저장된 기록을 확인할 수 없어 덮어쓰지 않았습니다. 기록 지우기로 이 작품만 새로 시작할 수 있습니다.";
    if (state.status === "memory") return "브라우저 저장소를 사용할 수 없어 기록이 이 탭에만 임시로 남습니다. 탭을 닫거나 새로고침하면 사라질 수 있습니다.";
    return "기록은 이 브라우저에만 저장되며 서버로 보내지 않습니다. 기기 간 동기화는 안 됩니다. 브라우저 데이터 삭제·시크릿 모드에서는 사라질 수 있습니다.";
  }
  function resumeLink(sid, last) {
    var link = el("a", "btn btn-primary resume-link", "이어 읽기 · " + last.episode + "화");
    link.href = "#/s/" + encodeURIComponent(sid) + "/" + last.episode;
    link.addEventListener("click", function (event) {
      pendingResume = { series: sid, episode: last.episode, position: last.position };
      if (location.hash === link.href) { event.preventDefault(); renderEpisode(sid, last.episode); }
    });
    return link;
  }
  function progressPanel(sid, eps) {
    var box = el("section", "reading-record");
    box.setAttribute("aria-label", "이 브라우저의 읽기 기록");
    var summary = el("p", "reading-summary");
    var actions = el("div", "record-actions");
    var resumeSlot = el("span", "resume-slot"); actions.appendChild(resumeSlot);
    var notice = el("p", "local-note");
    var feedback = el("p", "record-feedback"); feedback.setAttribute("role", "status");
    var confirmation = el("div", "record-confirm"); confirmation.id = "record-confirm-" + sid; confirmation.hidden = true;
    confirmation.appendChild(el("p", null, "이 작품의 이어 읽기 위치와 읽음 표시를 지울까요? 다른 작품과 읽기 설정은 유지됩니다."));
    var erase = el("button", "btn btn-ghost", "이 작품 기록 지우기"); erase.type = "button";
    var cancel = el("button", "btn btn-ghost", "취소"); cancel.type = "button";
    confirmation.appendChild(erase); confirmation.appendChild(cancel);
    var reset = el("button", "record-reset", "기록 지우기"); reset.type = "button";
    reset.setAttribute("aria-expanded", "false");
    reset.setAttribute("aria-controls", confirmation.id);
    actions.appendChild(reset);
    function dismiss() { confirmation.hidden = true; reset.setAttribute("aria-expanded", "false"); reset.focus(); }
    reset.addEventListener("click", function () { confirmation.hidden = false; reset.setAttribute("aria-expanded", "true"); cancel.focus(); });
    cancel.addEventListener("click", dismiss);
    confirmation.addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); dismiss(); } });
    erase.addEventListener("click", function () {
      progressStore.clear(sid);
      dismiss();
      feedback.textContent = "이 작품의 읽기 기록을 지웠습니다.";
      refreshProgressViews();
    });
    function refresh() {
      var state = progressStore.get(sid, eps);
      summary.textContent = "이 브라우저 · " + progressSummary(state);
      clear(resumeSlot);
      if (state.last) resumeSlot.appendChild(resumeLink(sid, state.last));
      notice.textContent = storageMessage(state);
    }
    progressViews.push(refresh);
    box.appendChild(summary); box.appendChild(actions); box.appendChild(confirmation); box.appendChild(feedback); box.appendChild(notice);
    refresh();
    return box;
  }
  function ownsReader(reader) {
    return !!reader && activeReader === reader && reader.token === renderToken && reader.body.isConnected && !reader.suspended;
  }
  function visibleReader(reader) {
    return ownsReader(reader) && document.visibilityState === "visible" && !(document.prerendering === true);
  }
  function readerTop() {
    var top = document.querySelector(".top");
    return Math.max(16, top ? top.getBoundingClientRect().bottom + 18 : 84);
  }
  function capturePosition(reader) {
    var y = window.scrollY || 0;
    var rect = reader.body.getBoundingClientRect();
    var height = Math.max(1, rect.height);
    // ratio 0 anchors the preface/header region; offset is its fractional scroll.
    if (rect.top > readerTop()) return { paragraph: 0, offset: y / Math.max(1, y + rect.top), ratio: 0 };
    var ratio = y <= 1 ? 0 : Math.min(1, Math.max(0.000001, (readerTop() - rect.top) / height));
    var ps = reader.body.children;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i].getBoundingClientRect();
      if (p.bottom > readerTop() || i === ps.length - 1) {
        return { paragraph: i, offset: Math.max(0, Math.min(1, (readerTop() - p.top) / Math.max(1, p.height))), ratio: ratio };
      }
    }
    return { paragraph: 0, offset: 0, ratio: ratio };
  }
  function restorePosition(reader, position) {
    if (!ownsReader(reader) || !position) return;
    if (position.ratio === 0) { window.scrollTo(0, Math.max(0, position.offset * ((window.scrollY || 0) + reader.body.getBoundingClientRect().top))); return; }
    var p = reader.body.children[position.paragraph];
    var rect = (p || reader.body).getBoundingClientRect();
    if (!rect.height) return;
    var offset = p ? position.offset : position.ratio;
    window.scrollTo(0, Math.max(0, (window.scrollY || 0) + rect.top + offset * rect.height - readerTop()));
  }
  // Wait for a stable layout and font metrics; never restore an abandoned route.
  function settleReader(reader, position, done) {
    var revision = ++reader.layoutRevision;
    reader.ready = false;
    var frames = 0, stable = 0, lastHeight = -1;
    function frame() {
      if (!ownsReader(reader) || revision !== reader.layoutRevision) return;
      var height = reader.body.getBoundingClientRect().height;
      stable = height === lastHeight ? stable + 1 : 0;
      lastHeight = height; frames++;
      if (stable < 2 && frames < 12) { window.requestAnimationFrame(frame); return; }
      restorePosition(reader, position);
      window.requestAnimationFrame(function () {
        if (!ownsReader(reader) || revision !== reader.layoutRevision) return;
        reader.ready = true;
        reader.lastY = window.scrollY || 0;
        reader.intent = false;
        if (done) done();
      });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ownsReader(reader) && revision === reader.layoutRevision) window.requestAnimationFrame(frame); });
    else window.requestAnimationFrame(frame);
  }
  function saveReader(reader) {
    if (!visibleReader(reader) || !reader.ready || !reader.started) return;
    clearTimeout(reader.saveTimer); reader.saveTimer = null;
    progressStore.updateLast(reader.series, reader.episode, capturePosition(reader), reader.epoch, reader.stamp);
  }
  function stopReader() {
    var reader = activeReader;
    if (!reader) return;
    saveReader(reader);
    clearTimeout(reader.saveTimer);
    reader.layoutRevision++;
    activeReader = null;
  }
  function readerStatus(reader) {
    if (!reader || activeReader !== reader || reader.token !== renderToken || !reader.body.isConnected) return;
    var state = progressStore.get(reader.series, reader.eps);
    var read = state.completed.indexOf(reader.episode) >= 0;
    var message = reader.suspended ? "다른 탭에서 기록을 지웠습니다. 회차를 다시 열면 새로 기록합니다." : (read ? "이 회차 읽음 · 본문 끝 도달 기준" : "본문 끝까지 이동하면 읽음으로 표시됩니다. 짧은 회차도 아래로 스크롤하거나 End 키로 확인해 주세요.");
    if (reader.status.textContent !== message) reader.status.textContent = message;
    var notice = storageMessage(state);
    if (reader.notice.textContent !== notice) reader.notice.textContent = notice;
  }
  function checkCompletion(reader) {
    if (!visibleReader(reader) || !reader.ready || !reader.started || !reader.intent || elSettings.classList.contains("open")) return;
    if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
    var last = reader.body.lastElementChild || reader.body.children[reader.body.children.length - 1];
    if (!last || !reader.hasText) return;
    var rect = last.getBoundingClientRect();
    // Only the actual text ending in the viewport counts, never the site footer.
    if (rect.height > 0 && rect.bottom >= readerTop() && rect.bottom <= window.innerHeight - 12) {
      if (progressStore.get(reader.series, reader.eps).completed.indexOf(reader.episode) >= 0) return;
      progressStore.complete(reader.series, reader.episode, reader.epoch);
      readerStatus(reader);
    }
  }
  function beginReader(sid, epNo, eps, body, hasText, token, status, notice) {
    var state = progressStore.get(sid, eps);
    var resume = pendingResume && pendingResume.series === sid && pendingResume.episode === epNo ? pendingResume.position : (state.last && state.last.episode === epNo ? state.last.position : null);
    pendingResume = null;
    var reader = { series: sid, episode: epNo, eps: eps, body: body, hasText: hasText, token: token, epoch: state.epoch, stamp: { at: Date.now(), id: tabId + "-" + (++openSequence) }, layoutRevision: 0, ready: false, started: false, intent: false, suspended: false, status: status, notice: notice, saveTimer: null };
    activeReader = reader;
    progressViews.push(function () { readerStatus(reader); });
    function activate() {
      if (!visibleReader(reader)) return;
      settleReader(reader, resume, function () {
        if (!visibleReader(reader)) return;
        reader.started = true;
        saveReader(reader);
        readerStatus(reader);
      });
    }
    reader.activate = activate;
    activate();
    readerStatus(reader);
  }
  function readingInput(event) {
    var reader = activeReader;
    if (!visibleReader(reader) || !reader.ready || !reader.started || event.isTrusted === false || elSettings.classList.contains("open")) return;
    if (event.type === "keydown") {
      if (["ArrowDown", "PageDown", "End", " "].indexOf(event.key) < 0 || /^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test((event.target && event.target.tagName) || "")) return;
    } else if (event.type === "wheel" && !(event.deltaY > 0)) return;
    reader.intent = true;
    window.requestAnimationFrame(function () { checkCompletion(reader); });
  }
  window.addEventListener("wheel", readingInput, { passive: true });
  window.addEventListener("touchmove", readingInput, { passive: true });
  document.addEventListener("keydown", readingInput);
  window.addEventListener("scroll", function () {
    var reader = activeReader;
    if (!visibleReader(reader) || !reader.ready || !reader.started) return;
    var y = window.scrollY || 0;
    if (y > reader.lastY + 1) reader.intent = true;
    reader.lastY = y;
    checkCompletion(reader);
    if (!reader.saveTimer) reader.saveTimer = setTimeout(function () { reader.saveTimer = null; saveReader(reader); }, 350);
  }, { passive: true });
  window.addEventListener("pagehide", function () { saveReader(activeReader); });
  document.addEventListener("visibilitychange", function () {
    var reader = activeReader;
    if (!reader) return;
    if (document.visibilityState !== "visible") {
      // Visibility already changed: flush the last visible position, not a new completion.
      if (ownsReader(reader) && reader.ready && reader.started) progressStore.updateLast(reader.series, reader.episode, capturePosition(reader), reader.epoch, reader.stamp);
      clearTimeout(reader.saveTimer); reader.saveTimer = null; reader.intent = false;
    } else if (!reader.started) reader.activate();
    else { reader.intent = false; reader.lastY = window.scrollY || 0; }
  });
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    if (activeReader) {
      var reader = activeReader, state = progressStore.reload(reader.series);
      if (state.epoch !== reader.epoch || (reader.started && !state.last)) {
        reader.suspended = true; reader.ready = false; reader.layoutRevision++;
        clearTimeout(reader.saveTimer); reader.saveTimer = null;
      } else if (!reader.started) reader.activate();
      reader.intent = false;
    }
    refreshProgressViews();
  });
  window.addEventListener("storage", function (event) {
    var sid = progressStore.idForKey(event.key);
    if (!sid && event.key !== null) return;
    if (sid) progressStore.reload(sid, event.newValue);
    var reader = activeReader;
    if (reader && (!sid || sid === reader.series)) {
      var state = progressStore.reload(reader.series);
      if (state.epoch !== reader.epoch || event.key === null || event.newValue === null) {
        reader.suspended = true; reader.ready = false; reader.layoutRevision++;
        clearTimeout(reader.saveTimer); reader.saveTimer = null;
        reader.status.textContent = "다른 탭에서 기록을 지웠습니다. 회차를 다시 열면 새로 기록합니다.";
      }
    }
    refreshProgressViews();
  });

  // ── 상태 라벨 ──
  var STATUS = {
    active:    { ko: "연재 중",   cls: "b-active" },
    paused:    { ko: "연재 일시정지", cls: "b-paused" },
    completed: { ko: "완결",      cls: "b-completed" },
    abandoned: { ko: "연재 중단", cls: "b-abandoned" }
  };

  // ── 리더 설정 (localStorage 보존) ──
  var LS_KEY = "plcmanjp-novel-reader";
  var SIZE_STEPS = [0.94, 1.00, 1.06, 1.12, 1.20, 1.30, 1.44]; // rem
  var LH_STEPS = [1.6, 1.75, 1.9, 1.95, 2.1, 2.3];
  var settings = loadSettings();
  applySettings();

  function loadSettings() {
    var def = { size: 3, lh: 3 }; // 인덱스
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return def;
      var o = JSON.parse(raw);
      var s = (Number.isInteger(o.size) && o.size >= 0 && o.size < SIZE_STEPS.length) ? o.size : def.size;
      var l = (Number.isInteger(o.lh) && o.lh >= 0 && o.lh < LH_STEPS.length) ? o.lh : def.lh;
      return { size: s, lh: l };
    } catch (e) { return def; }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function applySettings() {
    var reader = activeReader;
    var anchor = reader && reader.ready ? capturePosition(reader) : null;
    if (anchor) saveReader(reader);
    var root = document.documentElement.style;
    root.setProperty("--read-size", SIZE_STEPS[settings.size] + "rem");
    root.setProperty("--read-lh", String(LH_STEPS[settings.lh]));
    if (anchor) settleReader(reader, anchor, function () { saveReader(reader); });
  }

  // ── 유틸: 안전 DOM 헬퍼 ──
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // 항상 textContent
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function pad6(n) { var s = String(n); while (s.length < 6) s = "0" + s; return s; }

  function fmtDate(iso) {
    if (!iso || typeof iso !== "string") return "";
    // RFC3339 → YYYY.MM.DD (파싱 실패 시 앞 10자)
    var d = new Date(iso);
    if (!isNaN(d.getTime())) {
      var y = d.getFullYear(), m = ("0" + (d.getMonth() + 1)).slice(-2), day = ("0" + d.getDate()).slice(-2);
      return y + "." + m + "." + day;
    }
    return iso.slice(0, 10);
  }

  function seriesTitle(o) {
    // 봇 공개 스키마는 series_title 을 방출(004 확정 계약·불변). 구 title 은 fallback.
    return (o && (o.series_title || o.title)) || "";
  }

  function statusBadge(status) {
    var s = STATUS[status] || { ko: status || "알 수 없음", cls: "b-abandoned" };
    return el("span", "badge " + s.cls, s.ko);
  }

  // ── 네트워크 ──
  function getJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " (" + path + ")");
      return r.json();
    });
  }

  // ── 상태 화면 ──
  function showLoading(msg) {
    clear(app);
    var w = el("div", "state");
    w.appendChild(el("div", "spinner"));
    w.appendChild(el("p", null, msg || "불러오는 중…"));
    app.appendChild(w);
  }
  function showError(msg, retryFn) {
    closeSettings(false);
    elGear.hidden = true;
    clear(app);
    var w = el("div", "state");
    w.appendChild(el("div", "ico", "⚠"));
    w.appendChild(el("h2", null, "불러오지 못했습니다"));
    w.appendChild(el("p", null, msg || "데이터를 불러오는 중 문제가 발생했습니다."));
    if (retryFn) {
      var b = el("button", "btn btn-ghost", "다시 시도");
      b.addEventListener("click", retryFn);
      w.appendChild(b);
    }
    var home = el("a", "text-link", "연재관으로 돌아가기 →"); home.href = "#/"; w.appendChild(home);
    app.appendChild(w);
    finishView("불러오지 못했습니다");
  }
  function showEmpty(title, msg) {
    closeSettings(false);
    elGear.hidden = true;
    clear(app);
    var w = el("div", "state");
    w.appendChild(el("div", "ico", "☾"));
    w.appendChild(el("h2", null, title || "아직 공개된 작품이 없습니다"));
    w.appendChild(el("p", null, msg || "첫 연재가 시작되면 이곳에 표시됩니다."));
    var home = el("a", "text-link", "연재관으로 돌아가기 →"); home.href = "#/"; w.appendChild(home);
    app.appendChild(w);
    finishView(title || "AI 웹소설 연재관");
  }

  function setNavTitle(main, sub) {
    clear(elTitle);
    if (sub) {
      var g = el("span", "g", main);
      elTitle.appendChild(g);
      elTitle.appendChild(document.createTextNode(" " + sub));
    } else {
      elTitle.textContent = main;
    }
  }

  // Each navigation owns its response. Older fetches may finish, never repaint.
  function beginView(view) {
    stopReader();
    progressViews = [];
    var token = ++renderToken;
    closeSettings(false);
    elGear.hidden = true;
    document.body.setAttribute("data-view", view);
    app.setAttribute("aria-busy", "true");
    window.scrollTo(0, 0);
    return token;
  }
  function finishView(title) {
    app.setAttribute("aria-busy", "false");
    document.title = title + " | PLCManJP";
    app.focus({ preventScroll: true });
  }
  function publishedEpisodes(meta) {
    if (!meta || meta.status === "legacy_partial" || meta.legacy_partial === true) return [];
    return (Array.isArray(meta.episodes) ? meta.episodes : []).filter(function (ep) {
      return ep && Number.isSafeInteger(ep.episode) && ep.episode > 0;
    }).slice().sort(function (a, b) { return a.episode - b.episode; });
  }
  function breadcrumb(items) {
    var nav = el("nav", "crumb");
    nav.setAttribute("aria-label", "현재 위치");
    items.forEach(function (item, index) {
      if (index) { var sep = el("span", "sep", "/"); sep.setAttribute("aria-hidden", "true"); nav.appendChild(sep); }
      var part = el(item.href ? "a" : "span", null, item.text);
      if (item.href) part.href = item.href;
      else part.setAttribute("aria-current", "page");
      nav.appendChild(part);
    });
    return nav;
  }
  function bookCover(s, index) {
    var cover = el("div", "book-cover");
    var tones = { "ash-blade": "ember", "awkward-season": "sage", "hollow-observer": "ink" };
    cover.setAttribute("data-tone", tones[s.series_id] || "ink");
    cover.setAttribute("aria-hidden", "true");
    cover.appendChild(el("span", "cover-imprint", "PLCManJP · 웹소설"));
    cover.appendChild(el("span", "cover-title", seriesTitle(s)));
    cover.appendChild(el("span", "cover-rule"));
    cover.appendChild(el("span", "cover-genre", s.genre || "이야기"));
    var foot = el("span", "cover-foot");
    foot.appendChild(el("span", null, "AI FICTION"));
    if (index != null) foot.appendChild(el("span", null, ("0" + (index + 1)).slice(-2)));
    cover.appendChild(foot);
    return cover;
  }

  // ── 뷰: 작품 목록 ──
  function renderList() {
    var token = beginView("list");
    setNavTitle("웹소설 연재관");
    showLoading("작품 목록을 불러오는 중…");
    getJSON(DATA + "/index.json").then(function (idx) {
      if (token !== renderToken) return;
      var series = (idx && Array.isArray(idx.series)) ? idx.series : [];
      series = series.filter(function (s) { return s && s.status !== "legacy_partial" && s.legacy_partial !== true; });
      clear(app);
      var head = el("header", "library-head");
      head.appendChild(el("p", "eyebrow", "PLCManJP LABS · AI FICTION"));
      head.appendChild(el("h1", "page-h", "이야기가 머무는 서가."));
      head.appendChild(el("p", "page-sub", "하루의 틈에서, 한 편씩. 마음이 가는 이야기를 펼쳐보세요."));
      var note = el("div", "library-note");
      note.appendChild(el("span", null, "AI 웹소설 연재관"));
      note.appendChild(el("span", null, "설치 없이 · 회원가입 없이"));
      head.appendChild(note);
      app.appendChild(head);
      if (!series.length) { showListEmptyInline(); finishView("AI 웹소설 연재관"); return; }
      var shelfHeading = el("div", "section-heading");
      shelfHeading.appendChild(el("h2", null, "연재 작품"));
      shelfHeading.appendChild(el("span", null, series.length + "편의 이야기"));
      app.appendChild(shelfHeading);
      var list = el("div", "series-list");
      series.forEach(function (s, index) {
        var card = seriesCard(s, index);
        list.appendChild(card);
        var slot = el("p", "card-progress"); slot.hidden = true;
        card.querySelector(".book-info").appendChild(slot);
        getJSON(DATA + "/series/" + encodeURIComponent(s.series_id) + "/meta.json").then(function (meta) {
          if (token !== renderToken || !slot.isConnected) return;
          var nums = publishedEpisodes(meta).map(function (ep) { return ep.episode; });
          function refresh() {
            var state = progressStore.get(s.series_id, nums);
            slot.hidden = !state.last && !state.completed.length;
            slot.textContent = "이 브라우저 · " + progressSummary(state);
          }
          progressViews.push(refresh); refresh();
        }).catch(function () { /* An unavailable index must not invent a read count. */ });
      });
      app.appendChild(list);
      var endnote = el("p", "library-endnote", "모든 회차는 AI가 생성한 창작물입니다. 글자 크기와 줄 간격은 읽기 화면에서 조절할 수 있습니다.");
      app.appendChild(endnote);
      finishView("AI 웹소설 연재관");
    }).catch(function (err) {
      if (token !== renderToken) return;
      showError("작품 목록(index.json)을 불러오지 못했습니다. " + err.message, renderList);
    });
  }

  function showListEmptyInline() {
    var w = el("div", "state");
    w.appendChild(el("div", "ico", "☾"));
    w.appendChild(el("h2", null, "아직 공개된 작품이 없습니다"));
    w.appendChild(el("p", null, "첫 연재가 시작되면 이곳에 표시됩니다."));
    app.appendChild(w);
  }

  function seriesCard(s, index) {
    var a = el("a", "series-card");
    a.href = "#/s/" + encodeURIComponent(s.series_id);
    a.appendChild(bookCover(s, index));
    var info = el("div", "book-info");
    var row1 = el("div", "row1");
    if (s.genre) row1.appendChild(el("span", "genre", s.genre));
    row1.appendChild(statusBadge(s.status));
    info.appendChild(row1);
    info.appendChild(el("h3", null, seriesTitle(s) || "(제목 없음)"));
    if (s.summary) info.appendChild(el("p", "desc", s.summary));
    var foot = el("div", "foot");
    if (s.latest_episode != null) {
      var f1 = el("span"); f1.appendChild(document.createTextNode("최신화 ")); f1.appendChild(el("b", null, s.latest_episode + "화")); foot.appendChild(f1);
    }
    if (s.updated_at) {
      var f2 = el("span"); f2.appendChild(document.createTextNode("갱신 ")); f2.appendChild(el("b", null, fmtDate(s.updated_at))); foot.appendChild(f2);
    }
    if (s.started_at) {
      var f3 = el("span"); f3.appendChild(document.createTextNode("연재 시작 ")); f3.appendChild(el("b", null, fmtDate(s.started_at))); foot.appendChild(f3);
    }
    info.appendChild(foot);
    info.appendChild(el("span", "book-link", "작품 펼치기 →"));
    a.appendChild(info);
    return a;
  }

  // ── 뷰: 작품 상세 ──
  function renderSeries(seriesId) {
    var token = beginView("series");
    setNavTitle("웹소설 연재관");
    showLoading("작품 정보를 불러오는 중…");
    getJSON(DATA + "/series/" + encodeURIComponent(seriesId) + "/meta.json").then(function (m) {
      if (token !== renderToken) return;
      if (m.status === "legacy_partial" || m.legacy_partial === true) {
        showEmpty("공개되지 않은 작품입니다", "연재관에서 공개된 작품을 선택해 주세요."); return;
      }
      clear(app);
      var eps = publishedEpisodes(m);

      app.appendChild(breadcrumb([{ text: "연재관", href: "#/" }, { text: seriesTitle(m) || seriesId }]));

      // head
      var spread = el("section", "detail-spread");
      spread.appendChild(bookCover(m));
      var head = el("div", "detail-head");
      head.appendChild(el("p", "eyebrow", "이야기의 첫 장을 열어보세요"));
      var row1 = el("div", "row1");
      if (m.genre) row1.appendChild(el("span", "genre", m.genre));
      row1.appendChild(statusBadge(m.status));
      head.appendChild(row1);
      head.appendChild(el("h1", "page-h", seriesTitle(m) || "(제목 없음)"));
      if (m.summary) head.appendChild(el("p", "intro", m.summary));

      var facts = el("div", "facts");
      var latest = eps.length ? eps[eps.length - 1].episode : null;
      if (eps.length) { var c1 = el("span"); c1.appendChild(document.createTextNode("총 ")); c1.appendChild(el("b", null, eps.length + "화")); facts.appendChild(c1); }
      if (m.started_at) { var c2 = el("span"); c2.appendChild(document.createTextNode("연재 시작 ")); c2.appendChild(el("b", null, fmtDate(m.started_at))); facts.appendChild(c2); }
      if (m.updated_at) { var c3 = el("span"); c3.appendChild(document.createTextNode("마지막 갱신 ")); c3.appendChild(el("b", null, fmtDate(m.updated_at))); facts.appendChild(c3); }
      head.appendChild(facts);

      if (latest != null) {
        var cta = el("div", "cta");
        var read = el("a", "btn btn-primary", "최신화 읽기");
        read.href = "#/s/" + encodeURIComponent(seriesId) + "/" + latest;
        cta.appendChild(read);
        if (eps.length && eps[0].episode != null && eps[0].episode !== latest) {
          var first = el("a", "btn btn-ghost", eps[0].episode + "화부터");
          first.href = "#/s/" + encodeURIComponent(seriesId) + "/" + eps[0].episode;
          cta.appendChild(first);
        }
        head.appendChild(cta);
      }
      spread.appendChild(head);
      app.appendChild(spread);
      app.appendChild(progressPanel(seriesId, eps.map(function (ep) { return ep.episode; })));

      var indexHead = el("div", "section-heading");
      indexHead.appendChild(el("h2", null, "차례"));
      indexHead.appendChild(el("span", null, "공개된 " + eps.length + "개 회차 · 처음부터"));
      app.appendChild(indexHead);
      if (!eps.length) { app.appendChild(el("p", "state", "등록된 회차가 없습니다.")); finishView(seriesTitle(m)); return; }
      var list = el("div", "ep-list");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "회차 목록");
      eps.forEach(function (ep) {
        var a = el("a", "ep-item");
        a.href = "#/s/" + encodeURIComponent(seriesId) + "/" + ep.episode;
        var item = el("div"); item.setAttribute("role", "listitem");
        a.appendChild(el("span", "no", (ep.episode != null ? ep.episode : "?") + "화"));
        a.appendChild(el("span", "et", ep.title || "무제"));
        var badge = el("span", "read-badge", " 읽음"); badge.hidden = true;
        a.querySelector(".et").appendChild(badge);
        progressViews.push(function () { badge.hidden = progressStore.get(seriesId, eps.map(function (item) { return item.episode; })).completed.indexOf(ep.episode) < 0; });
        if (ep.published_at) a.appendChild(el("span", "em", fmtDate(ep.published_at)));
        item.appendChild(a); list.appendChild(item);
      });
      app.appendChild(list);
      refreshProgressViews();
      finishView(seriesTitle(m));
    }).catch(function (err) {
      if (token !== renderToken) return;
      showError("작품 정보(meta.json)를 불러오지 못했습니다. " + err.message, function () { renderSeries(seriesId); });
    });
  }

  // ── 뷰: 회차 리더 ──
  function renderEpisode(seriesId, epNo) {
    var token = beginView("episode");
    setNavTitle("웹소설 연재관");
    showLoading("회차를 불러오는 중…");
    // meta + episode 병렬 로드 (이전/다음 계산에 meta 필요)
    Promise.all([
      getJSON(DATA + "/series/" + encodeURIComponent(seriesId) + "/meta.json"),
      getJSON(DATA + "/series/" + encodeURIComponent(seriesId) + "/episodes/" + pad6(epNo) + ".json")
    ]).then(function (res) {
      if (token !== renderToken) return;
      var m = res[0], ep = res[1];
      var eps = publishedEpisodes(m).map(function (e) { return e.episode; });
      var pos = eps.indexOf(epNo);
      if (pos < 0) { showEmpty("공개되지 않은 회차입니다", "작품의 차례에서 공개된 회차를 선택해 주세요."); return; }
      clear(app);
      var prev = pos > 0 ? eps[pos - 1] : null;
      var next = (pos >= 0 && pos < eps.length - 1) ? eps[pos + 1] : null;

      setNavTitle(seriesTitle(m) || seriesId, "/ " + epNo + "화");

      app.appendChild(breadcrumb([{ text: "연재관", href: "#/" }, { text: seriesTitle(m) || seriesId, href: "#/s/" + encodeURIComponent(seriesId) }, { text: epNo + "화" }]));

      // reader head
      var rh = el("header", "reader-head");
      rh.appendChild(el("p", "reader-series", seriesTitle(m) || seriesId));
      var seasonTxt = (ep.season != null ? ("시즌 " + ep.season + " / ") : "");
      rh.appendChild(el("div", "epno", seasonTxt + epNo + "화"));
      var heading = el("h1", null, ep.title || "무제"); heading.id = "episodeTitle";
      rh.appendChild(heading);
      var rm = el("div", "rmeta");
      if (ep.published_at) rm.appendChild(el("span", null, fmtDate(ep.published_at)));
      if (ep.slot) rm.appendChild(el("span", null, ep.slot));
      if (ep.genre) rm.appendChild(el("span", null, ep.genre));
      rh.appendChild(rm);
      app.appendChild(rh);

      // body — 문단 분리, textContent 로만 삽입 (XSS 안전)
      var body = el("article", "reader-body");
      body.setAttribute("aria-labelledby", "episodeTitle");
      var raw = (typeof ep.body === "string") ? ep.body : "";
      var paras = raw.split(/\n{2,}/); // 빈 줄로 문단 분리
      paras.forEach(function (blk) {
        var lines = blk.split(/\n/).map(function (s) { return s.replace(/\s+$/, ""); }).filter(function (s) { return s.length; });
        if (!lines.length) return;
        var p = el("p");
        lines.forEach(function (line, i) {
          if (i > 0) p.appendChild(el("br"));
          p.appendChild(document.createTextNode(line)); // 순수 텍스트 노드
        });
        body.appendChild(p);
      });
      if (!body.childNodes.length) body.appendChild(el("p", null, "(본문이 비어 있습니다.)"));
      app.appendChild(body);

      // prev / toc / next — 한 줄 흐름(라벨 · 회차번호, 화살표는 바깥쪽)
      var ending = el("p", "reader-end", epNo + "화 끝"); app.appendChild(ending);
      var readStatus = el("p", "reader-progress"); readStatus.setAttribute("role", "status"); app.appendChild(readStatus);
      var localNotice = el("p", "local-note reader-local-note"); app.appendChild(localNotice);
      var nav = el("nav", "epnav"); nav.setAttribute("aria-label", "회차 이동");
      // 이전화
      if (prev != null) {
        var pa = el("a", "prev"); pa.href = "#/s/" + encodeURIComponent(seriesId) + "/" + prev;
        pa.appendChild(el("span", "ar", "←"));
        pa.appendChild(el("span", "lb", "이전화"));
        pa.appendChild(el("span", "epn", prev + "화"));
        nav.appendChild(pa);
      } else {
        var ps = el("span", "prev disabled");
        ps.appendChild(el("span", "ar", "←"));
        ps.appendChild(el("span", "lb", "이전화"));
        nav.appendChild(ps);
      }
      // 목록
      var tc = el("a", "toc"); tc.href = "#/s/" + encodeURIComponent(seriesId);
      tc.appendChild(el("span", "lb", "목록"));
      nav.appendChild(tc);
      // 다음화
      if (next != null) {
        var na = el("a", "next"); na.href = "#/s/" + encodeURIComponent(seriesId) + "/" + next;
        na.appendChild(el("span", "lb", "다음화"));
        na.appendChild(el("span", "epn", next + "화"));
        na.appendChild(el("span", "ar", "→"));
        nav.appendChild(na);
      } else {
        var ns = el("span", "next disabled");
        ns.appendChild(el("span", "lb", "다음화"));
        ns.appendChild(el("span", "ar", "→"));
        nav.appendChild(ns);
      }
      app.appendChild(nav);
      elGear.hidden = false;
      finishView(ep.title + " — " + seriesTitle(m));
      beginReader(seriesId, epNo, eps, body, !!raw.trim(), token, readStatus, localNotice);
    }).catch(function (err) {
      if (token !== renderToken) return;
      showError("회차를 불러오지 못했습니다. " + err.message, function () { renderEpisode(seriesId, epNo); });
    });
  }

  // ── 설정 패널 ──
  function buildSettings() {
    clear(elSettings);
    var w = el("div", "settings-inner");
    var panelHead = el("div", "settings-head");
    var title = el("h2", null, "읽기 설정"); title.id = "settingsTitle";
    panelHead.appendChild(title);
    var dismiss = el("button", "settings-close", "닫기 ×"); dismiss.type = "button";
    dismiss.addEventListener("click", function () { closeSettings(); });
    panelHead.appendChild(dismiss); w.appendChild(panelHead);

    // 글자 크기
    var r1 = el("div", "set-row");
    r1.appendChild(el("span", "lbl", "글자 크기"));
    var st1 = el("div", "stepper");
    var minus1 = el("button", null, "−"); minus1.setAttribute("aria-label", "글자 작게");
    var val1 = el("span", "val");
    var plus1 = el("button", null, "+"); plus1.setAttribute("aria-label", "글자 크게");
    st1.appendChild(minus1); st1.appendChild(val1); st1.appendChild(plus1);
    r1.appendChild(st1);

    // 줄 간격
    var r2 = el("div", "set-row");
    r2.appendChild(el("span", "lbl", "줄 간격"));
    var st2 = el("div", "stepper");
    var minus2 = el("button", null, "−"); minus2.setAttribute("aria-label", "줄 간격 좁게");
    var val2 = el("span", "val");
    var plus2 = el("button", null, "+"); plus2.setAttribute("aria-label", "줄 간격 넓게");
    st2.appendChild(minus2); st2.appendChild(val2); st2.appendChild(plus2);
    r2.appendChild(st2);
    var reset = el("button", "set-reset", "기본값");
    r2.appendChild(reset);

    w.appendChild(r1); w.appendChild(r2);
    w.appendChild(el("p", "settings-note", "설정은 현재 브라우저에 저장됩니다."));
    elSettings.appendChild(w);

    function refresh() {
      val1.textContent = Math.round(SIZE_STEPS[settings.size] * 100) + "%";
      val2.textContent = LH_STEPS[settings.lh].toFixed(2);
      minus1.disabled = settings.size <= 0;
      plus1.disabled = settings.size >= SIZE_STEPS.length - 1;
      minus2.disabled = settings.lh <= 0;
      plus2.disabled = settings.lh >= LH_STEPS.length - 1;
    }
    function bump(key, arr, d) {
      var v = settings[key] + d;
      if (v < 0 || v >= arr.length) return;
      settings[key] = v; applySettings(); saveSettings(); refresh();
    }
    minus1.addEventListener("click", function () { bump("size", SIZE_STEPS, -1); });
    plus1.addEventListener("click", function () { bump("size", SIZE_STEPS, 1); });
    minus2.addEventListener("click", function () { bump("lh", LH_STEPS, -1); });
    plus2.addEventListener("click", function () { bump("lh", LH_STEPS, 1); });
    reset.addEventListener("click", function () { settings = { size: 3, lh: 3 }; applySettings(); saveSettings(); refresh(); });
    refresh();
  }
  function openSettings() {
    elSettings.classList.add("open");
    elSettings.removeAttribute("inert");
    elSettings.setAttribute("aria-hidden", "false");
    elGear.setAttribute("aria-expanded", "true");
    var first = elSettings.querySelector("button");
    if (first) first.focus();
  }
  function closeSettings(returnFocus) {
    if (returnFocus !== false && elSettings.contains(document.activeElement) && !elGear.hidden) {
      elGear.focus();
    }
    elSettings.classList.remove("open");
    elSettings.setAttribute("inert", "");
    elSettings.setAttribute("aria-hidden", "true");
    elGear.setAttribute("aria-expanded", "false");
  }
  elGear.addEventListener("click", function () {
    if (elSettings.classList.contains("open")) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && elSettings.classList.contains("open")) {
      closeSettings(); elGear.focus(); event.preventDefault();
    }
  });
  document.addEventListener("click", function (event) {
    if (elSettings.classList.contains("open") && !elSettings.contains(event.target) && !elGear.contains(event.target)) closeSettings(false);
  });
  var skip = document.getElementById("skipLink");
  if (skip) skip.addEventListener("click", function (event) {
    event.preventDefault(); app.focus({ preventScroll: true }); app.scrollIntoView();
  });

  // ── 라우터: preserve existing hash URLs, reject malformed paths safely ──
  function parseHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h || h === "/") return { view: "list" };
    var parts = h.replace(/^\//, "").split("/");
    if (parts[0] === "s" && parts[1] && parts.length <= 3) {
      var sid;
      try { sid = decodeURIComponent(parts[1]); } catch (e) { return { view: "invalid" }; }
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(sid)) return { view: "invalid" };
      if (parts[2]) {
        var n = Number(parts[2]);
        if (/^\d+$/.test(parts[2]) && Number.isSafeInteger(n) && n > 0) return { view: "episode", series: sid, ep: n };
        return { view: "invalid" };
      }
      return { view: "series", series: sid };
    }
    return { view: "invalid" };
  }
  function route() {
    var r = parseHash();
    if (pendingResume && (r.view !== "episode" || r.series !== pendingResume.series || r.ep !== pendingResume.episode)) pendingResume = null;
    if (r.view === "episode") renderEpisode(r.series, r.ep);
    else if (r.view === "series") renderSeries(r.series);
    else if (r.view === "list") renderList();
    else { beginView("list"); showEmpty("페이지를 찾을 수 없습니다", "주소를 확인하거나 연재관에서 작품을 선택해 주세요."); }
  }

  buildSettings();
  window.addEventListener("hashchange", route);
  route();
})();
