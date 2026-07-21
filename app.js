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

  // 사이트 공통 테마: 라이트 ↔ 다크
  var THEME_KEY = "plcmanjp-theme";
  var themeOrder = ["light", "dark"];
  var themeLabel = { light: "라이트", dark: "다크" };
  var themeBtn = document.getElementById("themeBtn");
  var themeOut = document.getElementById("themeLbl");
  var currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  function readTheme() {
    try {
      var theme = localStorage.getItem(THEME_KEY);
      return theme === "dark" ? "dark" : "light";
    } catch (e) {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }
  }
  function applyTheme(theme, save) {
    theme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    currentTheme = theme;
    themeOut.textContent = themeLabel[theme];
    themeBtn.setAttribute("aria-label", "테마 전환: 현재 " + themeLabel[theme]);
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
      var s = (typeof o.size === "number" && o.size >= 0 && o.size < SIZE_STEPS.length) ? o.size : def.size;
      var l = (typeof o.lh === "number" && o.lh >= 0 && o.lh < LH_STEPS.length) ? o.lh : def.lh;
      return { size: s, lh: l };
    } catch (e) { return def; }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function applySettings() {
    var root = document.documentElement.style;
    root.setProperty("--read-size", SIZE_STEPS[settings.size] + "rem");
    root.setProperty("--read-lh", String(LH_STEPS[settings.lh]));
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
    app.appendChild(w);
  }
  function showEmpty(title, msg) {
    clear(app);
    var w = el("div", "state");
    w.appendChild(el("div", "ico", "☾"));
    w.appendChild(el("h2", null, title || "아직 공개된 작품이 없습니다"));
    w.appendChild(el("p", null, msg || "첫 연재가 시작되면 이곳에 표시됩니다."));
    app.appendChild(w);
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

  // ── 뷰: 작품 목록 ──
  function renderList() {
    elGear.hidden = true;
    closeSettings();
    setNavTitle("AI 웹소설 연재관");
    showLoading("작품 목록을 불러오는 중…");
    getJSON(DATA + "/index.json").then(function (idx) {
      var series = (idx && Array.isArray(idx.series)) ? idx.series : [];
      // legacy_partial 은 봇이 애초에 넣지 않지만, 방어적으로 한 번 더 거른다.
      series = series.filter(function (s) { return s && s.status !== "legacy_partial" && s.legacy_partial !== true; });
      clear(app);
      var head = el("div");
      head.appendChild(el("h1", "page-h", "AI 웹소설 연재관"));
      head.appendChild(el("p", "page-sub", "AI가 매일 한 편씩 새로운 이야기를 써 내려갑니다. 오늘 이어진 회차를 지금 바로 읽어보세요."));
      app.appendChild(head);

      if (!series.length) { showListEmptyInline(); return; }

      var list = el("div", "series-list");
      series.forEach(function (s) {
        list.appendChild(seriesCard(s));
      });
      app.appendChild(list);
    }).catch(function (err) {
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

  function seriesCard(s) {
    var a = el("a", "series-card");
    a.href = "#/s/" + encodeURIComponent(s.series_id);
    var row1 = el("div", "row1");
    if (s.genre) row1.appendChild(el("span", "genre", s.genre));
    row1.appendChild(statusBadge(s.status));
    a.appendChild(row1);
    a.appendChild(el("h3", null, seriesTitle(s) || "(제목 없음)"));
    if (s.summary) a.appendChild(el("p", "desc", s.summary));
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
    a.appendChild(foot);
    return a;
  }

  // ── 뷰: 작품 상세 ──
  function renderSeries(seriesId) {
    elGear.hidden = true;
    closeSettings();
    setNavTitle("AI 웹소설 연재관");
    showLoading("작품 정보를 불러오는 중…");
    getJSON(DATA + "/series/" + encodeURIComponent(seriesId) + "/meta.json").then(function (m) {
      clear(app);
      var eps = Array.isArray(m.episodes) ? m.episodes.slice() : [];
      eps.sort(function (a, b) { return (a.episode || 0) - (b.episode || 0); });

      // breadcrumb
      var cb = el("div", "crumb");
      var home = el("a", null, "연재관"); home.href = "#/"; cb.appendChild(home);
      cb.appendChild(el("span", "sep", "/"));
      cb.appendChild(el("span", null, seriesTitle(m) || seriesId));
      app.appendChild(cb);

      // head
      var head = el("div", "detail-head");
      var row1 = el("div", "row1");
      if (m.genre) row1.appendChild(el("span", "genre", m.genre));
      row1.appendChild(statusBadge(m.status));
      head.appendChild(row1);
      head.appendChild(el("h1", "page-h", seriesTitle(m) || "(제목 없음)"));
      if (m.summary) head.appendChild(el("p", "intro", m.summary));

      var facts = el("div", "facts");
      var latest = m.latest_episode != null ? m.latest_episode : (eps.length ? eps[eps.length - 1].episode : null);
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
          var first = el("a", "btn btn-ghost", "1화부터");
          first.href = "#/s/" + encodeURIComponent(seriesId) + "/" + eps[0].episode;
          cta.appendChild(first);
        }
        head.appendChild(cta);
      }
      app.appendChild(head);

      // episode index
      app.appendChild(el("div", "ep-index-h", "회차 목록"));
      if (!eps.length) { app.appendChild(function(){var w=el("div","state");w.appendChild(el("p",null,"등록된 회차가 없습니다."));return w;}()); return; }
      var list = el("div", "ep-list");
      eps.forEach(function (ep) {
        var a = el("a", "ep-item");
        a.href = "#/s/" + encodeURIComponent(seriesId) + "/" + ep.episode;
        a.appendChild(el("span", "no", (ep.episode != null ? ep.episode : "?") + "화"));
        a.appendChild(el("span", "et", ep.title || "무제"));
        if (ep.published_at) a.appendChild(el("span", "em", fmtDate(ep.published_at)));
        list.appendChild(a);
      });
      app.appendChild(list);
    }).catch(function (err) {
      showError("작품 정보(meta.json)를 불러오지 못했습니다. " + err.message, function () { renderSeries(seriesId); });
    });
  }

  // ── 뷰: 회차 리더 ──
  function renderEpisode(seriesId, epNo) {
    elGear.hidden = false;
    closeSettings();
    setNavTitle("AI 웹소설 연재관");
    showLoading("회차를 불러오는 중…");
    // meta + episode 병렬 로드 (이전/다음 계산에 meta 필요)
    Promise.all([
      getJSON(DATA + "/series/" + encodeURIComponent(seriesId) + "/meta.json"),
      getJSON(DATA + "/series/" + encodeURIComponent(seriesId) + "/episodes/" + pad6(epNo) + ".json")
    ]).then(function (res) {
      var m = res[0], ep = res[1];
      clear(app);

      var eps = Array.isArray(m.episodes) ? m.episodes.map(function (e) { return e.episode; }).filter(function (n) { return n != null; }) : [];
      eps.sort(function (a, b) { return a - b; });
      var pos = eps.indexOf(epNo);
      var prev = pos > 0 ? eps[pos - 1] : null;
      var next = (pos >= 0 && pos < eps.length - 1) ? eps[pos + 1] : null;

      setNavTitle(seriesTitle(m) || seriesId, "· " + epNo + "화");

      // breadcrumb
      var cb = el("div", "crumb");
      var home = el("a", null, "연재관"); home.href = "#/"; cb.appendChild(home);
      cb.appendChild(el("span", "sep", "/"));
      var sl = el("a", null, seriesTitle(m) || seriesId); sl.href = "#/s/" + encodeURIComponent(seriesId); cb.appendChild(sl);
      cb.appendChild(el("span", "sep", "/"));
      cb.appendChild(el("span", null, epNo + "화"));
      app.appendChild(cb);

      // reader head
      var rh = el("div", "reader-head");
      var seasonTxt = (ep.season != null ? ("시즌 " + ep.season + " · ") : "");
      rh.appendChild(el("div", "epno", seasonTxt + epNo + "화"));
      rh.appendChild(el("h1", null, ep.title || "무제"));
      var rm = el("div", "rmeta");
      if (ep.published_at) rm.appendChild(el("span", null, fmtDate(ep.published_at)));
      if (ep.slot) rm.appendChild(el("span", null, ep.slot));
      if (ep.genre) rm.appendChild(el("span", null, ep.genre));
      rh.appendChild(rm);
      app.appendChild(rh);

      // body — 문단 분리, textContent 로만 삽입 (XSS 안전)
      var body = el("article", "reader-body");
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
      var nav = el("div", "epnav");
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
      window.scrollTo(0, 0);
    }).catch(function (err) {
      showError("회차를 불러오지 못했습니다. " + err.message, function () { renderEpisode(seriesId, epNo); });
    });
  }

  // ── 설정 패널 ──
  function buildSettings() {
    clear(elSettings);
    var w = el("div", "wrap");

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
  }
  function closeSettings() {
    if (elSettings.contains(document.activeElement)) {
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

  // ── 라우터 ──
  function parseHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h || h === "/" ) return { view: "list" };
    var parts = h.replace(/^\//, "").split("/");
    // ["s", <id>] 또는 ["s", <id>, <ep>]
    if (parts[0] === "s" && parts[1]) {
      var sid = decodeURIComponent(parts[1]);
      if (parts[2]) {
        var n = parseInt(parts[2], 10);
        if (!isNaN(n) && n > 0) return { view: "episode", series: sid, ep: n };
      }
      return { view: "series", series: sid };
    }
    return { view: "list" };
  }
  function route() {
    var r = parseHash();
    if (r.view === "episode") renderEpisode(r.series, r.ep);
    else if (r.view === "series") renderSeries(r.series);
    else renderList();
  }

  buildSettings();
  window.addEventListener("hashchange", route);
  route();
})();
