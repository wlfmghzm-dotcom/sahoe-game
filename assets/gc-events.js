/* 게임 안 행동 세기 (GoatCounter 이벤트) — v1, 2026-11-13
   - 모든 게임(games/*.html)이 </body> 앞에서 이 파일 하나를 불러온다. 고칠 때는 이 파일만 고치면 된다.
   - 무엇을 세나: 게임 열기, 개념 모드 시작, 단계 통과, 힌트 1·2·3, 개념 모드 완주, 도전 시작·성공·실패.
   - 개인을 알아보는 값(이름, 기기 ID, 쿠키)은 보내지 않는다. localStorage도 쓰지 않는다.
   - 실제 공개 주소(github.io)에서만 보낸다. 내 컴퓨터·미리보기에서는 보내지 않는다.
   - 엔진 함수를 바꾸지 않고 감싸기만 한다. 함수가 없는 게임(옛 엔진)은 '게임 열기'만 센다.
   - 이벤트 이름: ev/<게임ID>/<무엇>   예) ev/g28/s2/hint3, ev/g28/clear, ev/g28/ch3/pass */
(function () {
  'use strict';
  var GC = 'https://sahoe-game.goatcounter.com/count';
  var ON = /(^|\.)github\.io$/.test(location.hostname);
  var GID = (location.pathname.match(/([A-Za-z0-9_-]+)\.html$/) || [])[1] || 'unknown';
  var NAME = (document.title || GID).split(' – ')[0];
  var sent = {};   /* 한 번 연 화면에서 같은 이벤트는 한 번만 (데이터 양 줄이기) */

  function send(path, title, isEvent) {
    if (!ON) return;
    try {
      var q = '?p=' + encodeURIComponent(path) + '&t=' + encodeURIComponent(title || path) +
        (isEvent ? '&e=true' : '') + '&s=' + screen.width + ',' + screen.height + ',' + (window.devicePixelRatio || 1) +
        '&r=' + encodeURIComponent(document.referrer || '') + '&rnd=' + Math.random().toString(36).slice(2);
      var i = new Image(); i.src = GC + q;
    } catch (e) {}
  }
  function ev(what, title, once) {
    var p = 'ev/' + GID + '/' + what;
    if (once !== false) { if (sent[p]) return; sent[p] = 1; }
    send(p, NAME + ' · ' + title, true);
  }

  /* 게임 열기 (게임 페이지 자체의 방문) */
  send('/games/' + GID + '.html', document.title || GID, false);

  function g(n) { try { return window[n]; } catch (e) { return undefined; } }
  function st() { try { return (typeof G === 'object' && G) ? G : null; } catch (e) { return null; } }
  function ui() { try { return (typeof U === 'object' && U) ? U : null; } catch (e) { return null; } }
  function chOn() { try { return typeof ENG_CHON !== 'undefined' && !!ENG_CHON; } catch (e) { return false; } }
  function chLv() { try { return typeof ENG_CHLV !== 'undefined' ? ENG_CHLV : 0; } catch (e) { return 0; } }
  function wrap(name, mk) {
    var f = g(name); if (typeof f !== 'function' || f.__gc) return null;
    var w = mk(f); w.__gc = 1; window[name] = w; return { orig: f, wrap: w };
  }
  function safe(fn) { try { fn(); } catch (e) {} }

  /* 단계 시작: 개념 모드 첫 단계면 '시작' */
  wrap('beginStage', function (f) {
    return function () {
      var r = f.apply(this, arguments);
      safe(function () { var G0 = st(); if (G0 && G0.si === 0 && !chOn()) ev('start', '개념 모드 시작'); });
      return r;
    };
  });

  /* 단계 끝: 어느 단계를 통과했는지 */
  wrap('onStageEnd', function (f) {
    return function () {
      safe(function () {
        var G0 = st(); if (!G0) return;
        if (chOn()) ev('ch' + chLv() + '/s' + (G0.si + 1) + '/clear', '도전 ' + chLv() + ' · ' + (G0.si + 1) + '단계 통과');
        else ev('s' + (G0.si + 1) + '/clear', (G0.si + 1) + '단계 통과');
      });
      return f.apply(this, arguments);
    };
  });

  /* 힌트: 단계별로 1·2·3 중 몇 번째까지 봤는지. 3번 튕겨서 저절로 뜬 힌트는 따로 */
  var h = wrap('doHint', function (f) {
    return function (auto) {
      var U0 = ui(), before = U0 ? U0.hint : null;
      var r = f.apply(this, arguments);
      safe(function () {
        var U1 = ui(), G0 = st(); if (!U1 || !G0 || before == null || !(U1.hint > before)) return;
        var pre = chOn() ? 'ch' + chLv() + '/' : '';
        var lab = (chOn() ? '도전 ' + chLv() + ' · ' : '') + (G0.si + 1) + '단계 힌트 ' + U1.hint + (auto === true ? ' (자동)' : '');
        ev(pre + 's' + (G0.si + 1) + '/hint' + U1.hint + (auto === true ? '-auto' : ''), lab);
      });
      return r;
    };
  });
  /* 힌트 버튼은 엔진이 처음에 원래 함수를 붙여 두었으므로 감싼 함수로 다시 붙인다 */
  if (h) safe(function () {
    document.querySelectorAll('button, [onclick]').forEach(function (b) { if (b.onclick === h.orig) b.onclick = h.wrap; });
  });

  /* 결과 화면: 개념 모드 완주 / 도전 성공·실패 */
  wrap('results', function (f) {
    return function () {
      var ch = chOn(), lv = chLv();
      var r = f.apply(this, arguments);
      safe(function () {
        if (!ch) { ev('clear', '개념 모드 완주'); return; }
        var R = (ui() || {}).chRes || {};
        ev('ch' + lv + '/' + (R.pass ? 'pass' : 'fail'), '도전 ' + lv + (R.pass ? ' 성공' : ' 실패'), false);
      });
      return r;
    };
  });

  /* 도전 시작 (판마다 셈: 몇 판이나 다시 도전하는지) */
  wrap('engChStart', function (f) {
    return function (lv) {
      var r = f.apply(this, arguments);
      safe(function () { if (chOn()) ev('ch' + chLv() + '/start', '도전 ' + chLv() + ' 시작', false); });
      return r;
    };
  });
})();
