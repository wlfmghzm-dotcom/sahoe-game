#!/usr/bin/env node
/*
  사이트 점검 — 게시(push) 전에 꼭 돌린다.   node tools/check-site.mjs        (점검만, 문제가 있으면 종료 코드 1)
                                           node tools/check-site.mjs --fix  (고칠 수 있는 것은 고친 뒤 다시 점검)
  ------------------------------------------------------------------------
  왜 있나: 2026-11-12 다른 세션이 5-2 과학 4단원을 부분적으로 끼워 넣으며 QR 그림 10개를 게임 주소로 바로 만들었다.
          QR 집계 페이지(go/)를 건너뛰어 하루 동안 QR 열기가 세지지 않았고, 아무 점검도 이를 잡지 못했다.
  무엇을 보나 (games/<id>.html 하나마다):
    1. go/<id>.html 이 있고, 표준 틀(qr-<id> 세기 → ../games/<id>.html 이동, sendBeacon)인지          [--fix: 표준 틀로 다시 씀]
    2. qr/<id>.png 가 있고, 그 QR을 실제로 읽었을 때 <BASE>go/<id>.html 이 나오는지                       [--fix: vendor/qrcode.js로 다시 그림]
    3. 게임 화면에 assets/gc-open.js 줄이 딱 한 번 있는지, 지운 통계 스크립트(gc-events.js, trace.js)가 없는지 [--fix: 넣거나 뺌]
    4. 대문(index.html) 목록의 게임 파일이 실제로 있는지, 차시 페이지가 가리키는 QR 그림이 있는지
    5. qr/site.png 에 사이트 주소가 들어 있는지
  외부 패키지·외부 서비스 없음(Node 내장 zlib만).
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.argv.includes('--fix');
const GC = 'sahoe-game';
const p = (...a) => path.join(ROOT, ...a);
const read = f => fs.readFileSync(p(f), 'utf8');
const exists = f => fs.existsSync(p(f));

// 사이트 주소: sitemap 첫 줄
const BASE = (read('sitemap.xml').match(/<loc>(https?:\/\/[^<]+?\/)<\/loc>/) || [])[1];
if (!BASE) { console.error('sitemap.xml에서 사이트 주소를 찾지 못함'); process.exit(1); }

// ---------- QR (vendor/qrcode.js, 대문 QR 창과 같은 라이브러리·같은 설정 'M') ----------
const qrcode = (() => { const m = { exports: {} }; new Function('module', 'exports', read('vendor/qrcode.js') + ';module.exports=qrcode;')(m, m.exports); return m.exports; })();
function qrRows(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(); const r = []; for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) row.push(q.isDark(y, x)); r.push(row); } return r; }
const CELL = 15, MARGIN = 60;   // 기존 그림 규격: 칸 15px, 여백 60px (33칸 → 615px)

// ---------- PNG 읽기/쓰기 (8비트 회색·RGB·RGBA, 비월간) ----------
function crc32(buf) { let c, crc = ~0; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function pngRead(file) {
  const b = fs.readFileSync(file); let o = 8, w, h, depth, ctype; const idat = [];
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; if (d[12]) throw new Error('interlaced'); }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break; o += 12 + len; }
  if (depth !== 8) throw new Error('bit depth ' + depth);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]; if (!bpp) throw new Error('color type ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = (y && x >= bpp) ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x]; if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 0xff; } }
  return { w, h, dark: (x, y) => px[y * stride + x * bpp] < 128 };
}
function pngWriteGray(file, w, h, get) {
  const raw = Buffer.alloc(h * (w + 1)); for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = get(x, y) ? 0 : 255; }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
// QR 읽기: 그림 속 주소를 직접 읽는다(만든 도구가 달라 모양이 달라도 내용이 같으면 통과). 버전 1~6, 깨끗한 디지털 그림 전제.
const QR_BLOCKS = { 1: { L: [[1, 19]], M: [[1, 16]], Q: [[1, 13]], H: [[1, 9]] }, 2: { L: [[1, 34]], M: [[1, 28]], Q: [[1, 22]], H: [[1, 16]] },
  3: { L: [[1, 55]], M: [[1, 44]], Q: [[2, 17]], H: [[2, 13]] }, 4: { L: [[1, 80]], M: [[2, 32]], Q: [[2, 24]], H: [[4, 9]] },
  5: { L: [[1, 108]], M: [[2, 43]], Q: [[2, 15], [2, 16]], H: [[2, 11], [2, 12]] }, 6: { L: [[2, 68]], M: [[4, 27]], Q: [[4, 19]], H: [[4, 15]] } };
const QR_ALIGN = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };
const QR_MASK = [(i, j) => (i + j) % 2 === 0, i => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0, (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0, (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0, (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0];
function qrDecode(file) {
  const img = pngRead(file);
  let x0 = -1, y0 = -1; for (let y = 0; y < img.h && y0 < 0; y++) for (let x = 0; x < img.w; x++) if (img.dark(x, y)) { x0 = x; y0 = y; break; }
  if (x0 < 0) throw new Error('빈 그림');
  let fw = 0; while (x0 + fw < img.w && img.dark(x0 + fw, y0)) fw++;          // 찾기 무늬 윗줄 = 7칸
  const cell = fw / 7; let x1 = img.w - 1; while (x1 > 0 && !img.dark(x1, y0)) x1--;
  const n = Math.round((x1 - x0 + 1) / cell), ver = (n - 17) / 4;
  if (!QR_BLOCKS[ver]) throw new Error('지원하지 않는 크기(' + n + '칸)');
  const M = []; for (let i = 0; i < n; i++) { M.push([]); for (let j = 0; j < n; j++) M[i].push(img.dark(Math.floor(x0 + (j + 0.5) * cell), Math.floor(y0 + (i + 0.5) * cell))); }
  const F = Array.from({ length: n }, () => Array(n).fill(false)), mark = (r0, c0, h, w) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < n && c < n) F[r][c] = true; };
  mark(0, 0, 9, 9); mark(0, n - 8, 9, 8); mark(n - 8, 0, 8, 9); mark(6, 0, 1, n); mark(0, 6, n, 1);
  if (QR_ALIGN[ver]) { const a = QR_ALIGN[ver]; mark(a - 2, a - 2, 5, 5); }   // 버전 2~6은 정렬 무늬 1개
  const order = []; let up = true;
  for (let c = n - 1; c > 0; c -= 2) { if (c === 6) c = 5; for (let k = 0; k < n; k++) { const r = up ? n - 1 - k : k; for (const cc of [c, c - 1]) if (!F[r][cc]) order.push([r, cc]); } up = !up; }
  for (const ec of ['M', 'L', 'Q', 'H']) for (let m = 0; m < 8; m++) {
    const bits = order.map(([r, c]) => M[r][c] !== QR_MASK[m](r, c));
    const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; bytes.push(v); }
    const blocks = []; for (const [cnt, len] of QR_BLOCKS[ver][ec]) for (let b = 0; b < cnt; b++) blocks.push({ len, d: [] });
    const total = blocks.reduce((a, b) => a + b.len, 0), maxLen = Math.max(...blocks.map(b => b.len)); let k = 0;
    for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.len) b.d.push(bytes[k++]);
    const data = blocks.flatMap(b => b.d); if (data.length !== total) continue;
    const db = []; for (const v of data) for (let t = 7; t >= 0; t--) db.push((v >> t) & 1);
    const take = (pos, len) => { let v = 0; for (let t = 0; t < len; t++) v = (v << 1) | db[pos + t]; return v; };
    if (take(0, 4) !== 4) continue; const cnt = take(4, 8); if (12 + cnt * 8 > db.length) continue;
    const out = []; for (let t = 0; t < cnt; t++) out.push(take(12 + t * 8, 8));
    const after = Math.ceil((12 + cnt * 8 + 4) / 8), pad = data.slice(after);
    if (!pad.every((v, i) => v === (i % 2 ? 0x11 : 0xEC))) continue;   // 남는 칸 채우기 규칙까지 맞아야 진짜 해석
    return Buffer.from(out).toString('utf8');
  }
  throw new Error('QR을 읽지 못함');
}
function qrMatches(file, text) {
  let got; try { got = qrDecode(file); } catch (e) { return 'QR을 읽지 못함(' + e.message + ')'; }
  return got === text ? '' : `QR 주소가 다름: ${got}`;
}
function qrWrite(file, text) { const rows = qrRows(text), n = rows.length, s = n * CELL + 2 * MARGIN;
  pngWriteGray(file, s, s, (x, y) => { const cx = Math.floor((x - MARGIN) / CELL), cy = Math.floor((y - MARGIN) / CELL); return cx >= 0 && cy >= 0 && cx < n && cy < n && rows[cy][cx]; }); }

// ---------- go/ 표준 틀 ----------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function goPage(id, title) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<noscript><meta http-equiv="refresh" content="0;url=../games/${id}.html"></noscript><style>body{margin:0;font:18px/1.5 system-ui,sans-serif;background:#F6F4EE;color:#2A2D3A;display:grid;place-items:center;min-height:100vh}a{color:#3D49A8}</style></head>
<body><p><a href="../games/${id}.html">게임 여는 중…</a></p><script>
(function(){var to="../games/${id}.html",done=false;function go(){if(done)return;done=true;location.replace(to+location.hash);}
try{var n=1,f=function(){if(--n<=0)go();},b='https://${GC}.goatcounter.com/count?rnd='+Math.random().toString(36).slice(2)+'&s='+screen.width+','+screen.height+','+(window.devicePixelRatio||1)+'&r=';
[['qr-${id}','QR로 열기','&e=true']].forEach(function(h){var u=b+'&p='+encodeURIComponent(h[0])+'&t='+encodeURIComponent(h[1])+h[2];var sent=false;try{sent=!!(navigator.sendBeacon&&navigator.sendBeacon(u));}catch(e){}if(sent){f();}else{var i=new Image();i.onload=i.onerror=f;i.src=u;}});}catch(e){go();}
setTimeout(go,700);})();
</script></body></html>
`;
}
const goOk = (s, id) => s.includes(`var to="../games/${id}.html"`) && s.includes(`['qr-${id}','QR로 열기','&e=true']`) && s.includes('navigator.sendBeacon') && s.includes(`https://${GC}.goatcounter.com/count`);

const GC_OPEN = '<script src="../assets/gc-open.js" defer></script>';
const GONE = ['gc-events.js', 'trace.js'];

// ---------- 점검 ----------
function run() {
  const errs = [], fixed = [];
  const ids = fs.readdirSync(p('games')).filter(f => /^[A-Za-z0-9_-]+\.html$/.test(f)).map(f => f.slice(0, -5)).sort();
  for (const id of ids) {
    let g = read(`games/${id}.html`);
    const title = ((g.match(/<title>([^<]*)<\/title>/) || [])[1] || id).split(' – ')[0].trim();
    // 1. go 페이지
    const gf = `go/${id}.html`;
    if (!exists(gf) || !goOk(read(gf), id)) {
      if (FIX) { fs.writeFileSync(p(gf), goPage(id, title)); fixed.push(gf); } else errs.push(`${gf}: ${exists(gf) ? '표준 틀이 아님(qr- 세기·이동·sendBeacon)' : '없음'}`);
    }
    // 2. QR 그림
    const qf = `qr/${id}.png`, want = BASE + `go/${id}.html`;
    const why = exists(qf) ? qrMatches(p(qf), want) : '없음';
    if (why) {
      const hint = why.endsWith(BASE + `games/${id}.html`) ? ' — 게임 주소를 바로 담고 있어 QR 집계를 건너뜀' : '';
      if (FIX) { qrWrite(p(qf), want); fixed.push(qf); } else errs.push(`${qf}: ${why}${hint} (기대: ${want})`);
    }
    // 3. 게임 화면 통계 줄
    let changed = false;
    for (const s of GONE) { const re = new RegExp(`<script src="\\.\\./assets/${s.replace('.', '\\.')}"[^>]*></script>\\n?`, 'g');
      if (re.test(g)) { if (FIX) { g = g.replace(re, ''); changed = true; } else errs.push(`games/${id}.html: 지운 스크립트 ${s}가 남아 있음`); } }
    const cnt = g.split('gc-open.js').length - 1;
    if (cnt !== 1) {
      if (FIX) { g = g.split('\n').filter(l => !l.includes('gc-open.js')).join('\n'); const i = g.lastIndexOf('</body>'); g = g.slice(0, i) + GC_OPEN + '\n' + g.slice(i); changed = true; }
      else errs.push(`games/${id}.html: gc-open.js 줄이 ${cnt}번 (1번이어야 함)`);
    }
    if (changed) { fs.writeFileSync(p(`games/${id}.html`), g); fixed.push(`games/${id}.html`); }
  }
  // 4. 대문 목록·차시 페이지
  const idx = read('index.html');
  for (const m of idx.matchAll(/"file":"(games\/[^"]+\.html)"/g)) if (!exists(m[1])) errs.push(`index.html: 목록의 ${m[1]} 파일이 없음`);
  for (const f of fs.readdirSync(p('lessons')).filter(f => f.endsWith('.html'))) {
    const s = read(`lessons/${f}`);
    for (const m of s.matchAll(/src="\.\.\/(qr\/[^"]+\.png)"/g)) if (!exists(m[1])) errs.push(`lessons/${f}: ${m[1]} 그림이 없음`);
  }
  // 5. 사이트 QR
  if (exists('qr/site.png')) { const w = qrMatches(p('qr/site.png'), BASE); if (w) { if (FIX) { qrWrite(p('qr/site.png'), BASE); fixed.push('qr/site.png'); } else errs.push(`qr/site.png: ${w} (기대: ${BASE})`); } }
  // go/ 에 짝 없는 페이지
  for (const f of fs.readdirSync(p('go')).filter(f => f.endsWith('.html'))) if (!ids.includes(f.slice(0, -5))) errs.push(`go/${f}: 짝이 되는 게임이 없음`);
  return { ids, errs, fixed };
}

let r = run();
if (FIX && r.fixed.length) { console.log(`고침 ${r.fixed.length}개:\n  ` + r.fixed.join('\n  ')); r = run(); }
if (r.errs.length) { console.error(`✗ 사이트 점검 실패 ${r.errs.length}건 (게임 ${r.ids.length}개)\n  ` + r.errs.join('\n  ') + (FIX ? '' : '\n  → node tools/check-site.mjs --fix 로 고칠 수 있는 것은 고쳐짐')); process.exit(1); }
console.log(`✓ 사이트 점검 통과: 게임 ${r.ids.length}개 — go 페이지·QR(${BASE}go/…)·통계 줄·대문 목록·차시 QR 모두 맞음`);
