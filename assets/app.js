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
  }

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
        body: JSON.stringify({ issue: date, article: art, v: v, rid: readerId() }) });
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
      target.scrollIntoView({ behavior: "smooth", block: "start" });
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
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
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
