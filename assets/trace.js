/* 게임 행동 궤적 기록 (연구 파일럿용) — v1, 2026-11-13
   - 기본은 꺼져 있다. 교사가 teacher/trace.html에서 '이 기기 기록 켜기'를 누른 기기에서만 기록한다.
   - 기록은 이 기기(브라우저 localStorage)에만 남는다. 어디로도 보내지 않는다.
   - 이름·학번 같은 개인 정보는 없다. 기기마다 무작위 ID 하나만 붙는다.
   - 엔진 함수를 바꾸지 않고 감싸기만 한다(gc-events.js와 같은 방식). 옛 엔진(g27)은 기록하지 않는다.
   한 줄(이벤트) 형식: {t: 이 판 시작 뒤 ms, a: 행동, m: 'c'(개념) | 'chN'(도전 N), s: 단계(1부터), ...}
     a='start'  개념 모드 시작          a='chstart' 도전 시작(lv)
     a='drop'   놓기: ok(받아들여짐), why(튕긴 까닭), ev(일어난 일 종류), d(점수 변화), h(그때 힌트 단계), tr(해 보기 중), via(자동 이동)
     a='hint'   힌트: h(1~3), auto(3번 튕겨서 저절로)
     a='stage'  단계 통과                a='end'  결과 화면: score, pass(도전 성공 여부) */
(function () {
  'use strict';
  var K = 'sgtrace:', ON_KEY = K + 'on', DID_KEY = K + 'did', LOG_KEY = K + 'log', MAX = 30000;
  var ls; try { ls = window.localStorage; if (ls.getItem(ON_KEY) !== '1') return; } catch (e) { return; }
  if (typeof window.drop !== 'function' || typeof window.beginStage !== 'function') return;

  var GID = (location.pathname.match(/([A-Za-z0-9_-]+)\.html$/) || [])[1] || 'unknown';
  var did = ls.getItem(DID_KEY);
  if (!did) { did = Math.random().toString(36).slice(2, 10); try { ls.setItem(DID_KEY, did); } catch (e) {} }
  var T0 = performance.now();
  var SID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var buf = [], meta = { sid: SID, did: did, g: GID, at: new Date().toISOString(), w: innerWidth, h: innerHeight, v: 1 };

  function G_() { try { return (typeof G === 'object' && G) ? G : null; } catch (e) { return null; } }
  function U_() { try { return (typeof U === 'object' && U) ? U : null; } catch (e) { return null; } }
  function mode() { try { return (typeof ENG_CHON !== 'undefined' && ENG_CHON) ? 'ch' + ENG_CHLV : 'c'; } catch (e) { return 'c'; } }
  function rec(a, o) {
    var g = G_(), e = { t: Math.round(performance.now() - T0), a: a, m: mode(), s: g && typeof g.si === 'number' ? g.si + 1 : null };
    if (o) for (var k in o) if (o[k] !== undefined) e[k] = o[k];
    buf.push(e); if (buf.length >= 20) flush();
  }
  function flush() {
    if (!buf.length) return;
    try {
      var all = JSON.parse(ls.getItem(LOG_KEY) || '[]');
      var last = all.length ? all[all.length - 1] : null;
      if (!last || last.sid !== SID) { last = { sid: SID, did: did, g: GID, at: meta.at, w: meta.w, h: meta.h, v: meta.v, e: [] }; all.push(last); }
      last.e = last.e.concat(buf); buf = [];
      var n = 0; for (var i = all.length - 1; i >= 0; i--) { n += all[i].e.length; if (n > MAX) { all = all.slice(i + 1); break; } }
      ls.setItem(LOG_KEY, JSON.stringify(all));
    } catch (e) { buf = []; }
  }
  addEventListener('pagehide', flush); addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
  setInterval(flush, 5000);

  function wrap(name, mk) { var f = window[name]; if (typeof f !== 'function') return null; var w = mk(f); window[name] = w; return { orig: f, wrap: w }; }
  function safe(fn) { try { fn(); } catch (e) {} }

  wrap('drop', function (f) {
    return function (G0, src, dst, via) {
      var r = f.apply(this, arguments);
      safe(function () {
        var u = U_(), d = (r && r.G && G0 && typeof r.G.score === 'number' && typeof G0.score === 'number') ? r.G.score - G0.score : undefined;
        rec('drop', {
          src: String(src), dst: String(dst), ok: !!(r && r.ok), why: r && !r.ok ? r.why : undefined,
          ev: r && r.ev ? r.ev.map(function (x) { return x && x.t; }).filter(Boolean).join(',') : undefined,
          d: d, h: u ? u.hint : undefined, tr: u && u.tr ? 1 : undefined, via: via ? 1 : undefined
        });
      });
      return r;
    };
  });
  wrap('beginStage', function (f) {
    return function () { var r = f.apply(this, arguments); safe(function () { var g = G_(); if (g && g.si === 0 && mode() === 'c') rec('start'); }); return r; };
  });
  wrap('onStageEnd', function (f) {
    return function () { safe(function () { var g = G_(); rec('stage', { score: g ? g.score : undefined }); }); return f.apply(this, arguments); };
  });
  var h = wrap('doHint', function (f) {
    return function (auto) {
      var u = U_(), b = u ? u.hint : null, r = f.apply(this, arguments);
      safe(function () { var u2 = U_(); if (u2 && b != null && u2.hint > b) rec('hint', { h: u2.hint, auto: auto === true ? 1 : undefined }); });
      return r;
    };
  });
  if (h) safe(function () { document.querySelectorAll('button, [onclick]').forEach(function (b) { if (b.onclick === h.orig) b.onclick = h.wrap; }); });
  wrap('results', function (f) {
    return function () {
      var m = mode(), r = f.apply(this, arguments);
      safe(function () { var g = G_(), u = U_(); rec('end', { m: m, score: g ? g.score : undefined, pass: m !== 'c' && u && u.chRes ? (u.chRes.pass ? 1 : 0) : undefined }); flush(); });
      return r;
    };
  });
  wrap('engChStart', function (f) {
    return function () { var r = f.apply(this, arguments); safe(function () { if (mode() !== 'c') rec('chstart'); }); return r; };
  });
})();
