/* 게임 페이지를 '바로' 연 횟수 세기 — v1, 2026-11-13
   - 대문의 '열기'(open-<id>)와 QR(qr-<id>)은 이미 세고 있으므로, 그 두 길로 온 경우는 세지 않는다.
   - 패들렛·클래스룸·웨일스페이스 등에 올린 게임 주소로 바로 들어온 경우만 direct-<id> 이벤트 1회.
   - 게임 안의 행동은 세지 않는다. 쿠키·기기 저장소 없음, 공개 주소(github.io)에서만 보냄. */
(function () {
  try {
    if (!/(^|\.)github\.io$/.test(location.hostname)) return;
    var gid = (location.pathname.match(/([A-Za-z0-9_-]+)\.html$/) || [])[1]; if (!gid) return;
    var ref = document.referrer || '';
    if (ref.indexOf(location.origin + '/sahoe-game/') === 0) return;   /* 대문·QR 이동 페이지에서 온 경우: 이미 셈 */
    var t = (document.title || gid).split(' – ')[0];
    var u = 'https://sahoe-game.goatcounter.com/count?p=' + encodeURIComponent('direct-' + gid) +
      '&t=' + encodeURIComponent(t + ' · 바로 열기') + '&e=true&s=' + screen.width + ',' + screen.height + ',' + (window.devicePixelRatio || 1) +
      '&r=' + encodeURIComponent(ref) + '&rnd=' + Math.random().toString(36).slice(2);
    /* count.js와 같은 방식: sendBeacon(페이지를 떠나도 전송 보장), 안 되면 그림 요청 */
    if (!(navigator.sendBeacon && navigator.sendBeacon(u))) { var i = new Image(); i.src = u; }
  } catch (e) {}
})();
