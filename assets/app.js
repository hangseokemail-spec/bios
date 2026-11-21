/* 바이오스 화면 동작: 호 불러오기, 달력(과월호), 차례 이동, 독자 별점 */
(function () {
  "use strict";
  var issues = [];
  var current = null;
  var viewYear, viewMonth;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  /* 별점 저장소(구글 시트 Apps Script 웹 앱 주소). 비어 있으면 이 브라우저에만 기억한다. */
  var RATING_URL = "https://script.google.com/macros/s/AKfycbxjs_5plZKX-UFW_yoAvwoVuhU43fqvXjpwipotltpro_dyK73d1EM0B9-6rb84cUrA3w/exec";

  /* 움직임 줄이기 설정이면 부드러운 스크롤 대신 바로 이동 */
  function motion() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function key(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hashFor(iss) { return "ho-" + iss.date.replace(/-/g, ""); }
  function fromHash() {
    var h = (location.hash || "").replace("#", "");
    var m = /^ho-(\d{4})(\d{2})(\d{2})$/.exec(h);
    if (!m) return null;
    var k = m[1] + "-" + m[2] + "-" + m[3];
    for (var i = 0; i < issues.length; i++) if (issues[i].date === k) return issues[i];
    return null;
  }

  function setBar(iss) {
    var el = $("#bar-issue");
    if (el) el.textContent = iss.label + " · " + iss.dateLabel + " · " + iss.title;
    document.title = "바이오스 " + iss.label;
  }

  function load(iss, push) {
    current = iss;
    setBar(iss);
    var host = $("#issue");
    if (window.__INLINE_ISSUES && window.__INLINE_ISSUES[iss.date]) {
      host.innerHTML = window.__INLINE_ISSUES[iss.date];
      after(push, iss);
      return;
    }
    host.innerHTML = '<div class="loading">바이오스 ' + iss.label + " 펼치는 중…</div>";
    fetch(iss.file).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function (html) {
      host.innerHTML = html;
      after(push, iss);
    }).catch(function () {
      host.innerHTML = '<div class="loading">이 호를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</div>';
    });
  }

  function after(push, iss) {
    if (push) {
      try { history.replaceState(null, "", "#" + hashFor(iss)); } catch (e) { location.hash = hashFor(iss); }
    }
    window.scrollTo(0, 0);
    initRatings(iss);
    try { tieLast(document.getElementById("issue")); } catch (e) {}
    try { tieText(document.getElementById("issue")); } catch (e) {}
    try { setupSides(); } catch (e) {}
  }

  /* ── 줄바꿈 묶기 ──────────────────────────────
     본문은 양끝 정렬 + 한글 글자 사이 줄바꿈(app.css)이라, 숫자와 단위(2019|년, 100|분), 영문과 조사(ERV|가),
     가운뎃점 양옆(2호|·3호)이 줄 끝에서 갈라질 수 있다. 그런 자리만 <span class="nb">(줄바꿈 금지)로 묶는다.
     글자는 바꾸지 않으므로 복사·검색·낭독에는 영향이 없다. */
  var RX_AN = /[0-9A-Za-zμ²³°℃%]/, RX_H = /[가-힣]/, RX_TOK = /[0-9A-Za-zμ²³°℃%.,~\/+\-−×]/, RX_CL = /[)\]’”]/;
  function joint(a2, a, b) {
    if (!a || /\s/.test(a) || /\s/.test(b)) return 0;
    if (RX_AN.test(a) && RX_H.test(b)) return 2;                    // 2019년, ERV가, 120kW의
    if (RX_CL.test(a) && RX_H.test(b) && a2 && RX_AN.test(a2)) return 2; // (fMRI)을
    if (a === "·" || b === "·") return 2;                          // 2호·3호, 성질·통계
    if (RX_TOK.test(a) && (RX_TOK.test(b) || RX_CL.test(b))) return 1; // 숫자·영문 낱말 안
    return 0;
  }
  function tieNode(node) {
    var s = node.data;
    if (s.length < 2 || !/[0-9A-Za-z·]/.test(s)) return;
    var groups = [], start = 0, prot = false;
    for (var i = 1; i <= s.length; i++) {
      var j = i < s.length ? joint(s[i - 2], s[i - 1], s[i]) : 0;
      if (j === 2) prot = true;
      if (!j) { if (prot && i - start > 1) groups.push([start, i]); start = i; prot = false; }
    }
    if (!groups.length) return;
    var frag = document.createDocumentFragment(), pos = 0;
    groups.forEach(function (g) {
      if (g[0] > pos) frag.appendChild(document.createTextNode(s.slice(pos, g[0])));
      var sp = document.createElement("span"); sp.className = "nb"; sp.textContent = s.slice(g[0], g[1]);
      frag.appendChild(sp); pos = g[1];
    });
    if (pos < s.length) frag.appendChild(document.createTextNode(s.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }
  function tieText(root) {
    if (!root || !document.createTreeWalker) return;
    var skip = "svg, sup, a, table, .nb, h2, h3, h4, h5, script, style, .sources, .rate";
    var areas = root.querySelectorAll(".story .main, .story .side, .story .hero .dek, .brief p, .notice, .toc-head p, .toc-list p, .cover-main p, .colophon p");
    Array.prototype.forEach.call(areas, function (area) {
      var w = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, null), n, list = [];
      while ((n = w.nextNode())) if (!n.parentElement.closest(skip)) list.push(n);
      list.forEach(tieNode);
    });
  }

  /* ── 끝줄 외톨이 막기(13판) ─────────────────────
     양끝 정렬 + 글자 사이 줄바꿈에서는 문단 끝 낱말이 '들여다봅|니다.'처럼 갈려 마지막 줄에 두세 글자만 남을 수 있다.
     문단의 마지막 낱말(14자 이하)만 <span class="nb">로 묶어(tieText보다 먼저 — '10층이다.'를 통째로), 마지막 줄에 적어도 낱말 하나가 통째로 가게 한다. */
  var LAST_SEL = ".story .main > p, .story .main > ul > li, .story .main > ol > li, .story .side p, .story .side li, .story .side dd, " +
    ".story figcaption, .ans-body p, .ans-body li, .think-note, .debate p, .debate li, .debate-mid, .story .hero .dek, " +
    ".notice p, .toc-head p, .toc-list p, .cover-main p, .colophon p, .sources li, .brief p, .show-head p, .prod p, .vid p";
  function tieLast(root) {
    if (!root || !document.createTreeWalker) return;
    Array.prototype.forEach.call(root.querySelectorAll(LAST_SEL), function (el) {
      if (el.querySelector("p, li, dd, details, table, svg")) return;
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, last = null;
      while ((n = w.nextNode())) if (/\S/.test(n.data) && !n.parentElement.closest("sup, svg")) last = n;
      if (!last || last.parentElement.closest(".nb")) return;
      var m = /(\S+\s\S{1,3}|\S+)(\s*)$/.exec(last.data);   // 끝 낱말이 세 글자 이하면 앞 낱말까지 함께
      if (!m || m[1].length < 2 || m[1].length > (last.parentElement.closest("a") ? 24 : 16)) return;
      var sp = document.createElement("span"); sp.className = "nb"; sp.textContent = m[1];
      var tail = m.index ? last.splitText(m.index) : last; tail.data = m[2];
      tail.parentNode.insertBefore(sp, tail);
    });
  }

  /* ── 곁상자 배치 ──────────────────────────────
     상자마다 '관련 단락'을 정한다.
       ① 상자에 data-near="단락 번호"(0 = 리드, 1 = 첫 소제목…)가 있으면 그것.
       ② 용어 상자처럼 <dl>이 있으면 첫 용어가 본문에 처음 나오는 단락.
       ③ 아니면 상자 글과 겹치는 낱말(드문 낱말일수록 무겁게)이 가장 많은 단락.
     넓은 화면(1024px 이상): 상자를 그 단락의 소제목 높이에 놓고, 겹치면 아래로, 본문보다 길어지면 위로 당긴다.
       표(.tbl)는 곁 단까지 펼치고, 상자는 그 높이를 비켜 간다.
     좁은 화면: 상자를 그 단락 첫 문단 뒤로 옮기고, 화면 높이의 62%보다 길면 접어 두고 '전체 보기' 단추를 단다.
     JS가 없거나 오류가 나면 예전처럼 곁 단(좁은 화면은 본문 아래)에 쌓인 채로 남는다. */
  var LAYS = [], RO = null, WIDE_Q = "(min-width: 1024px)", rafId = 0;
  function wideNow() { return window.matchMedia ? window.matchMedia(WIDE_Q).matches : window.innerWidth >= 1024; }
  function words(text) {
    var out = {}, m, s, i;
    var hr = /[가-힣]{2,}/g;
    while ((m = hr.exec(text))) { s = m[0]; for (i = 0; i < s.length - 1; i++) out[s.substr(i, 2)] = 1; }
    var lr = /[A-Za-z]{2,}|[0-9][0-9.,~]*[%A-Za-zμ가-힣]?/g;
    while ((m = lr.exec(text))) out[m[0].toLowerCase()] = 1;
    return out;
  }
  function sectionsOf(main) {
    var secs = [{ h3: null, els: [] }];
    Array.prototype.forEach.call(main.children, function (el) {
      if (el.tagName === "H3") secs.push({ h3: el, els: [] }); else secs[secs.length - 1].els.push(el);
    });
    secs.forEach(function (s) {
      var p = null, lead = null;
      s.els.forEach(function (e) { if (e.tagName === "P") { if (!p) p = e; if (!lead && e.classList.contains("lead")) lead = e; } });
      s.after = lead || p || s.h3;
      s.text = (s.h3 ? s.h3.textContent : "") + " " + s.els.map(function (e) { return e.textContent; }).join(" ");
      s.w = words(s.text);
      s.n = Object.keys(s.w).length || 1;
    });
    return secs;
  }
  function anchorOf(box, secs) {
    var near = box.getAttribute("data-near");
    if (near !== null && near !== "" && !isNaN(+near)) return Math.max(0, Math.min(secs.length - 1, +near));
    var dt = box.querySelector("dl dt");
    if (dt) {
      var term = dt.textContent.replace(/[(（].*$/, "").trim().split(/[\s·,]/)[0].replace(/(과|와)$/, "");
      if (term.length >= 2) for (var i = 0; i < secs.length; i++) if (secs[i].text.indexOf(term) >= 0) return i;
    }
    var bw = words(Array.prototype.map.call(box.childNodes, function (c) { return c.nodeName === "H5" ? "" : c.textContent; }).join(" "));
    var S = secs.length, best = 0, bestScore = 0;
    secs.forEach(function (s, j) {
      var sc = 0;
      Object.keys(bw).forEach(function (t) {
        if (!s.w[t]) return;
        var df = 0; secs.forEach(function (x) { if (x.w[t]) df++; });
        sc += Math.max(0, Math.log((S + 1) / (df + 0.5)));
      });
      sc = sc / Math.pow(s.n, 0.35);
      if (sc > bestScore + 1e-9) { bestScore = sc; best = j; }
    });
    return best;
  }
  function setupSides() {
    if (RO) { RO.disconnect(); }
    LAYS = [];
    var bodies = document.querySelectorAll("#issue .story > .body");
    Array.prototype.forEach.call(bodies, function (body, bi) {
      var main = body.querySelector(":scope > .main"), side = body.querySelector(":scope > .side");
      if (!main || !side) return;
      var boxes = Array.prototype.filter.call(side.children, function (el) { return el.classList.contains("box"); });
      if (!boxes.length) return;
      var secs = sectionsOf(main);
      var art = body.closest(".story");
      boxes.forEach(function (b, i) {
        b._order = i; b._sec = anchorOf(b, secs);
        if (!b.id) b.id = (art && art.id ? art.id : "art" + bi) + "-box" + (i + 1);
      });
      var sorted = boxes.slice().sort(function (a, b) { return a._sec - b._sec || a._order - b._order; });
      LAYS.push({ body: body, main: main, side: side, boxes: boxes, sorted: sorted, secs: secs, mode: "" });
    });
    if (!LAYS.length) return;
    if (window.ResizeObserver) {
      RO = new ResizeObserver(function () { schedule(); });
      LAYS.forEach(function (st) { RO.observe(st.main); });
    }
    layoutAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }
  function schedule() {
    if (rafId) return;
    rafId = (window.requestAnimationFrame || setTimeout)(function () { rafId = 0; layoutAll(); });
  }
  function layoutAll() {
    var wide = wideNow();
    LAYS.forEach(function (st) {
      try { if (wide) layWide(st); else layNarrow(st); } catch (e) {}
    });
  }
  function px(v) { return parseFloat(v) || 0; }
  function clearMore(box) {
    var nx = box.nextElementSibling;
    if (nx && nx.classList.contains("box-more")) nx.parentNode.removeChild(nx);
    box.classList.remove("is-folded", "has-more");
    box.style.removeProperty("--fold-h");
  }
  function layWide(st) {
    if (st.mode !== "wide") {
      st.boxes.forEach(function (b) { clearMore(b); b.classList.remove("box--inset"); st.side.appendChild(b); });
      st.side.hidden = false;
      st.side.classList.add("is-laid");
      st.body.classList.add("is-laid");
      st.mode = "wide";
    }
    var cs = getComputedStyle(st.body);
    var gapX = px(cs.columnGap), GAP = px(cs.rowGap) || 48;
    var sideRect = st.side.getBoundingClientRect();
    st.body.style.setProperty("--span", Math.round(sideRect.width + gapX) + "px");
    var top0 = st.main.getBoundingClientRect().top;
    var mainH = st.main.getBoundingClientRect().height;
    var obs = Array.prototype.map.call(st.main.querySelectorAll(":scope > .tbl"), function (el) {
      var r = el.getBoundingClientRect(); return { a: r.top - top0 - GAP / 2, b: r.bottom - top0 + GAP / 2 };
    });
    function hit(t, h) { for (var i = 0; i < obs.length; i++) if (t < obs[i].b && t + h > obs[i].a) return obs[i]; return null; }
    var items = st.sorted.map(function (b) {
      var s = st.secs[b._sec], want = 0;
      if (s && s.h3 && s.h3.isConnected) want = s.h3.getBoundingClientRect().top - top0;
      return { el: b, h: b.offsetHeight, want: Math.max(0, want), t: 0 };
    });
    // 1) 위에서부터: 원하는 높이에, 앞 상자와 겹치지 않게, 펼친 표를 비켜서
    var cur = 0, o;
    items.forEach(function (it) {
      var t = Math.max(it.want, cur), guard = 0;
      while ((o = hit(t, it.h)) && guard++ < 20) t = o.b;
      it.t = t; cur = t + it.h + GAP;
    });
    // 2) 마지막 상자가 본문보다 아래로 나가면, 아래에서부터 위로 당긴다(원래 높이보다 위로도 갈 수 있다)
    var last = items[items.length - 1];
    if (last && last.t + last.h > mainH) {
      var lim = mainH;
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i], t = Math.min(it.t, lim - it.h), guard = 0;
        while ((o = hit(t, it.h)) && guard++ < 20) t = o.a - it.h;
        it.t = t; lim = t - GAP;
      }
      // 3) 맨 위를 넘어가면 위에서부터 다시 쌓는다(이때는 곁 단이 본문보다 길어진다)
      if (items[0].t < 0) {
        cur = 0;
        items.forEach(function (it) { var t = Math.max(it.t, cur), g = 0; while ((o = hit(t, it.h)) && g++ < 20) t = o.b; it.t = t; cur = t + it.h + GAP; });
      }
    }
    var bottom = 0;
    items.forEach(function (it) { it.el.style.top = Math.round(it.t) + "px"; bottom = Math.max(bottom, it.t + it.h); });
    st.side.style.height = Math.ceil(bottom) + "px";
  }
  function layNarrow(st) {
    if (st.mode !== "narrow") {
      st.side.classList.remove("is-laid");
      st.body.classList.remove("is-laid");
      st.body.style.removeProperty("--span");
      st.side.style.height = "";
      var lastBySec = {};
      st.sorted.forEach(function (b) {
        b.style.top = "";
        var s = st.secs[b._sec];
        var ref = lastBySec[b._sec] || (s && s.after);
        if (ref && ref.parentNode === st.main) ref.parentNode.insertBefore(b, ref.nextSibling);
        else st.main.insertBefore(b, st.main.firstChild);
        b.classList.add("box--inset");
        lastBySec[b._sec] = b;
      });
      st.side.hidden = true;
      st.mode = "narrow";
    }
    // 긴 상자 접기: 화면 높이의 62%보다 길면 36%만 보이게
    var vh = window.innerHeight || 800;
    var limit = Math.max(420, vh * 0.62), foldH = Math.round(Math.max(260, vh * 0.36));
    st.sorted.forEach(function (b) {
      var title = (b.querySelector("h5") || {}).textContent || "상자";
      var more = b.nextElementSibling && b.nextElementSibling.classList.contains("box-more") ? b.nextElementSibling : null;
      var full = b.scrollHeight;
      if (full <= limit + 40) { if (more) clearMore(b); return; }
      if (!more) {
        more = document.createElement("button");
        more.type = "button"; more.className = "box-more";
        more.setAttribute("aria-controls", b.id);
        more.addEventListener("click", function () {
          var open = more.getAttribute("aria-expanded") === "true";
          setFold(b, more, title, open);
          if (open) {
            var r = b.getBoundingClientRect();
            if (r.top < 60) window.scrollBy(0, r.top - 72);
          }
        });
        b.parentNode.insertBefore(more, b.nextSibling);
        setFold(b, more, title, true);
      }
      b.style.setProperty("--fold-h", foldH + "px");
    });
  }
  function setFold(b, more, title, fold) {
    b.classList.add("has-more");
    b.classList.toggle("is-folded", fold);
    more.setAttribute("aria-expanded", fold ? "false" : "true");
    more.textContent = fold ? "‘" + title.trim() + "’ 전체 보기" : "‘" + title.trim() + "’ 접기";
  }
  window.addEventListener("resize", function () { if (LAYS.length) schedule(); });
  /* 인쇄할 때는 접힌 답을 모두 펼치고, 끝나면 되돌린다 */
  var printOpened = [];
  window.addEventListener("beforeprint", function () {
    printOpened = Array.prototype.filter.call(document.querySelectorAll("#issue details.ans:not([open])"), function (d) { d.open = true; return true; });
  });
  window.addEventListener("afterprint", function () { printOpened.forEach(function (d) { d.open = false; }); printOpened = []; });

  /* 독자 별점: 기사 끝 .rate 블록. 점수는 시트에 쌓이고, 목요일 기획 회의가 다음 호 기사 고를 때 참고한다. */
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function readerId() {
    var id = store("ss-rid");
    if (!id || !/^[a-z0-9]{6,40}$/.test(id)) {
      id = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, "").slice(0, 20);
      store("ss-rid", id);
    }
    return id;
  }
  function paint(box, v, cls) {
    var stars = box.querySelectorAll(".star");
    for (var i = 0; i < stars.length; i++) {
      var n = +stars[i].getAttribute("data-v");
      stars[i].classList.toggle(cls, n <= v);
      if (cls === "on") stars[i].setAttribute("aria-checked", n === v ? "true" : "false");
    }
  }
  function initRatings(iss) {
    var boxes = document.querySelectorAll("#issue .rate[data-article]");
    if (!boxes.length) return;
    Array.prototype.forEach.call(boxes, function (box) {
      var art = box.getAttribute("data-article");
      var saved = +(store("ss-rate:" + iss.date + ":" + art) || 0);
      if (saved) { paint(box, saved, "on"); box.classList.add("done"); msg(box, "별점 " + saved + "점을 남겼어요. 다시 누르면 바뀝니다."); }
      box.addEventListener("mouseover", function (e) {
        var s = e.target.closest ? e.target.closest(".star") : null;
        if (s) paint(box, +s.getAttribute("data-v"), "hover");
      });
      box.addEventListener("mouseleave", function () { paint(box, 0, "hover"); });
      box.addEventListener("click", function (e) {
        var s = e.target.closest ? e.target.closest(".star") : null;
        if (!s) return;
        var v = +s.getAttribute("data-v");
        paint(box, v, "on");
        box.classList.add("done");
        store("ss-rate:" + iss.date + ":" + art, String(v));
        send(iss.date, art, v);
        msg(box, "고마워요! 별점 " + v + "점은 다음 호 기사를 고를 때 반영됩니다.");
      });
    });
    loadAverages(iss);
  }
  function msg(box, t) { var m = box.querySelector(".rate-msg"); if (m) m.textContent = t; }
  function send(date, art, v) {
    if (!RATING_URL) return;
    try {
      fetch(RATING_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ issue: date, article: art, v: v, rid: readerId() }) }).catch(function () {});
    } catch (e) {}
  }
  function loadAverages(iss) {
    if (!RATING_URL || !window.fetch) return;
    fetch(RATING_URL + "?issue=" + encodeURIComponent(iss.date)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ratings || !current || current.date !== iss.date) return;
      Object.keys(d.ratings).forEach(function (art) {
        var r = d.ratings[art];
        var box = document.querySelector('#issue .rate[data-article="' + art + '"] .rate-avg');
        if (box && r.n >= 3) box.textContent = "독자 평균 ★" + r.avg.toFixed(1) + " · " + r.n + "명 참여";
      });
    }).catch(function () {});
  }

  /* 차례·표지 문구에서 기사로 이동 (주소의 #는 호 선택에만 씀) */
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-goto]") : null;
    if (!t) return;
    var target = document.getElementById(t.getAttribute("data-goto"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: motion(), block: "start" });
    }
  });

  /* 달력 */
  function openCal() {
    var d = current ? new Date(current.date + "T00:00:00") : new Date();
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
    drawCal();
    $("#cal").classList.add("open");
    var c = $("#cal-close"); if (c) c.focus();
  }
  function closeCal() { $("#cal").classList.remove("open"); }

  function drawCal() {
    var byDate = {};
    issues.forEach(function (i) { byDate[i.date] = i; });
    $("#cal-title").textContent = viewYear + "년 " + (viewMonth + 1) + "월";
    var grid = $("#cal-grid");
    var html = DOW.map(function (w) { return '<div class="dow">' + w + "</div>"; }).join("");
    var first = new Date(viewYear, viewMonth, 1);
    var days = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (var b = 0; b < first.getDay(); b++) html += "<div></div>";
    var start = new Date("2026-11-20T00:00:00");
    for (var d = 1; d <= days; d++) {
      var dt = new Date(viewYear, viewMonth, d);
      var k = key(dt);
      var iss = byDate[k];
      var cls = "d";
      if (dt.getDay() === 5) cls += " fri";
      if (iss) {
        cls += " has" + (current && current.date === k ? " cur" : "");
        html += '<button type="button" class="' + cls + '" data-date="' + k + '" aria-label="' + iss.label + ' 보기">' + d + "</button>";
      } else {
        if (dt.getDay() === 5 && dt >= start) cls += " plan";
        html += '<div class="' + cls + '">' + d + "</div>";
      }
    }
    grid.innerHTML = html;
    var list = $("#cal-list");
    list.innerHTML = issues.slice().reverse().map(function (i) {
      return '<li><a href="#' + hashFor(i) + '" data-date="' + i.date + '"><b>' + i.label + "</b> " + i.dateLabel + " — " + i.title + "</a></li>";
    }).join("");
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-date]") : null;
    if (!t || !$("#cal").contains(t)) return;
    e.preventDefault();
    var k = t.getAttribute("data-date");
    for (var i = 0; i < issues.length; i++) if (issues[i].date === k) { closeCal(); load(issues[i], true); return; }
  });

  function init() {
    $("#btn-cal").addEventListener("click", openCal);
    $("#cal-close").addEventListener("click", closeCal);
    $("#cal").addEventListener("click", function (e) { if (e.target === this) closeCal(); });
    $("#cal-prev").addEventListener("click", function () { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } drawCal(); });
    $("#cal-next").addEventListener("click", function () { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } drawCal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCal(); });
    $("#btn-toc").addEventListener("click", function () {
      var t = document.getElementById("toc");
      if (t) t.scrollIntoView({ behavior: motion(), block: "start" });
    });
    window.addEventListener("hashchange", function () {
      var iss = fromHash();
      if (iss && (!current || iss.date !== current.date)) load(iss, false);
    });

    var got = function (list) {
      issues = list.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var iss = fromHash() || issues[issues.length - 1];
      load(iss, false);
    };
    if (window.__INLINE_INDEX) { got(window.__INLINE_INDEX); return; }
    fetch("issues/index.json").then(function (r) { return r.json(); }).then(got).catch(function () {
      $("#issue").innerHTML = '<div class="loading">호 목록을 불러오지 못했어요.</div>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
