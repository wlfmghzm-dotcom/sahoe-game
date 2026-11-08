#!/usr/bin/env node
/*
  선생님들이 올린 게임(커뮤니티 게임) 모으기 — GitHub Actions에서 6시간마다 실행
  ------------------------------------------------------------------------
  1. 구글 설문지 응답 시트를 '웹에 게시 → CSV'한 주소를 읽는다 (tools/community.config.json의 csv, 또는 --csv).
  2. '승인' 칸이 체크된 줄만 고른다. 승인 안 된 주소는 열어 보지도 않는다.
  3. 주소·과목·학년학기·단원·차시·글자 수를 검사하고, 같은 주소는 하나만 남긴다.
  4. 새로 들어온 게임만 Playwright로 열어 <title>/og:title을 읽고 1000×600 화면을 480×288로 찍어
     community/thumbs/<id>.png로 저장한다(실패하면 og:image, 그것도 안 되면 그림 없이).
  5. community.json을 다시 쓴다. 승인이 풀린 게임은 빠지고 그 그림도 지운다. 내용이 같으면 파일을 건드리지 않는다.

  쓰는 법:  node tools/community.mjs                       (설정 파일의 CSV 주소)
            node tools/community.mjs --csv ./test.csv       (로컬 파일로 시험)
            node tools/community.mjs --csv ./test.csv --allow-local   (시험용: http://localhost 주소 허용)
  의존성: playwright (npx playwright install --with-deps chromium)
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const ALLOW_LOCAL = argv.includes('--allow-local');
const OUT_JSON = path.join(ROOT, 'community.json');
const THUMBS = path.join(ROOT, 'community', 'thumbs');
const MAX_ROWS = 2000, MAX_GAMES = 300, MAX_CSV_BYTES = 2 * 1024 * 1024;
const LIM = { name: 40, desc: 120, by: 20, title: 80, subject: 10 };

/* ---------- CSV 주소 ---------- */
let csvSrc = arg('--csv');
if (!csvSrc) {
  try { csvSrc = JSON.parse(fs.readFileSync(path.join(HERE, 'community.config.json'), 'utf8')).csv; } catch (e) {}
}
if (!csvSrc) { console.log('CSV 주소가 아직 없어요(site.json의 site.submitCsv). 할 일 없음.'); process.exit(0); }

/* ---------- 읽기 ---------- */
async function readCsv(src) {
  if (/^https:\/\//.test(src)) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(src, { signal: ctl.signal, redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_CSV_BYTES) throw new Error('CSV가 너무 커요');
      return buf.toString('utf8');
    } finally { clearTimeout(t); }
  }
  if (/^[a-z]+:/i.test(src)) throw new Error('CSV 주소는 https:// 이거나 파일 경로여야 해요');
  const buf = fs.readFileSync(path.resolve(src));
  if (buf.length > MAX_CSV_BYTES) throw new Error('CSV가 너무 커요');
  return buf.toString('utf8');
}
/* RFC 4180: 따옴표 안 쉼표·줄바꿈·"" 처리 */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/* ---------- 검사 ---------- */
const key = s => String(s || '').replace(/[\s·・‧.･:：()（）]/g, '').toLowerCase();
const COLS = { url: '게임 주소', name: '게임 이름', subject: '과목', grade: '학년·학기', unit: '단원 번호', lesson: '차시 번호', desc: '한 줄 소개', by: '표시 이름', ok: '승인', ts: '타임스탬프' };
const YES = new Set(['true', '체크', 'o', 'ㅇ', 'y', 'yes', '예', '승인', '✓', '✔', 'v', '1']);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

function isPrivateHost(h) {
  h = h.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !net.isIP(h)) return true;
  if (net.isIPv4(h)) { const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  if (net.isIPv6(h)) return true; /* IPv6 그대로 쓴 주소는 받지 않음 */
  return false;
}
function checkUrl(raw) {
  const s = String(raw || '').trim();
  if (s.length < 12 || s.length > 500 || /\s/.test(s)) return null;
  let u; try { u = new URL(s); } catch (e) { return null; }
  const local = ALLOW_LOCAL && u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !local) return null;
  if (u.username || u.password) return null;
  if (!local && (isPrivateHost(u.hostname) || net.isIP(u.hostname))) return null;
  if (u.port && !local && u.port !== '443') return null;
  u.hash = u.hash.length > 100 ? '' : u.hash;
  return u.href;
}
const grade = s => { const m = /([1-6])\D+([12])/.exec(String(s || '')) || /^([1-6])([12])$/.exec(String(s || '').trim()); return m ? `${m[1]}-${m[2]}` : null; };
const intIn = (s, lo, hi) => { const m = /^\D*(\d{1,3})/.exec(String(s || '')); const n = m ? +m[1] : NaN; return n >= lo && n <= hi ? n : null; };
const lessonNo = s => { const m = /(\d{1,3})(?:\s*[~\-–]\s*(\d{1,3}))?/.exec(String(s || '')); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : a; return a >= 1 && a <= 99 && b >= a && b <= 99 ? (a === b ? String(a) : `${a}~${b}`) : null; };
const dateOf = s => { /* 구글 설문 타임스탬프: '2026. 11. 8 오후 3:12:45' 또는 '11/8/2026 15:12:45' */
  const t = String(s || ''); let m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
};

/* ---------- 캡처 ---------- */
async function capture(browser, url, id) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 0.48, acceptDownloads: false, serviceWorkers: 'block', locale: 'ko-KR' });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  const info = { title: '', thumb: '' };
  /* 사설 주소로 가는 하위 요청은 막음(러너 내부망 보호) */
  await ctx.route('**/*', r => { try { const h = new URL(r.request().url()).hostname; if (!ALLOW_LOCAL && isPrivateHost(h)) return r.abort(); } catch (e) { return r.abort(); } return r.continue(); });
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (resp && resp.status() >= 400) throw new Error('HTTP ' + resp.status());
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const meta = await page.evaluate(() => ({
      title: document.title || '',
      og: (document.querySelector('meta[property="og:title"]') || {}).content || '',
      img: (document.querySelector('meta[property="og:image"]') || {}).content || ''
    })).catch(() => ({ title: '', og: '', img: '' }));
    info.title = clean(meta.og || meta.title, LIM.title);
    const file = path.join(THUMBS, id + '.png');
    try { await page.screenshot({ path: file, type: 'png', timeout: 15000 }); info.thumb = `community/thumbs/${id}.png`; }
    catch (e) {
      let img = ''; try { img = new URL(meta.img, page.url()).href; } catch (x) {}
      if (/^https:\/\//.test(img)) {
        await page.setContent(`<body style="margin:0;background:#eee"><img src="${img.replace(/"/g, '%22')}" style="width:1000px;height:600px;object-fit:cover;display:block"></body>`);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: file, type: 'png' }); info.thumb = `community/thumbs/${id}.png`;
      }
    }
  } catch (e) { console.log(`  ! ${url} 열기 실패: ${e.message.split('\n')[0]}`); }
  await ctx.close();
  return info;
}

/* ---------- 실행 ---------- */
let text;
try { text = await readCsv(csvSrc); }
catch (e) { console.log('CSV를 읽지 못했어요. 이번에는 아무것도 바꾸지 않아요: ' + e.message); process.exit(0); }
const rows = parseCsv(text);
if (rows.length < 1) { console.log('CSV가 비었어요. 바꾸지 않아요.'); process.exit(0); }
const head = rows[0].map(key), col = {};
for (const [k, name] of Object.entries(COLS)) col[k] = head.indexOf(key(name));
const need = ['url', 'name', 'subject', 'grade', 'unit', 'lesson', 'ok'].filter(k => col[k] < 0);
if (need.length) { console.error('CSV에 이 열이 없어요(설문 질문 제목을 그대로 써 주세요): ' + need.map(k => COLS[k]).join(', ')); process.exit(1); }
if (rows.length - 1 > MAX_ROWS) console.log(`줄이 너무 많아 앞 ${MAX_ROWS}줄만 봐요.`);

let old = { games: [] };
try { old = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch (e) {}
const oldBy = new Map((old.games || []).map(g => [g.id, g]));
const today = new Date().toISOString().slice(0, 10);
const picked = new Map(); let skipped = 0;
for (const r of rows.slice(1, MAX_ROWS + 1)) {
  const v = k => (col[k] >= 0 ? r[col[k]] : '') || '';
  if (!YES.has(String(v('ok')).trim().toLowerCase())) continue;           /* 승인 안 된 줄: 열어 보지 않음 */
  const url = checkUrl(v('url')), gr = grade(v('grade')), unit = intIn(v('unit'), 1, 20), lesson = lessonNo(v('lesson'));
  const name = clean(v('name'), LIM.name), subject = clean(v('subject'), LIM.subject).replace(/과목$/, '');
  if (!url || !gr || !unit || !lesson || !name || !subject) { skipped++; console.log(`  - 건너뜀(형식): ${clean(v('url'), 80)} / ${name}`); continue; }
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  if (picked.has(id)) { console.log(`  - 건너뜀(같은 주소 중복): ${url}`); continue; }   /* 먼저 올린 사람 것을 남김 */
  picked.set(id, { id, url, name, subject, grade: gr, unit, lesson, desc: clean(v('desc'), LIM.desc), by: clean(v('by'), LIM.by).replace(/\s*(선생님|선생|교사|쌤)$/, ''), added: (oldBy.get(id) || {}).added || dateOf(v('ts')) || today });
  if (picked.size >= MAX_GAMES) { console.log(`최대 ${MAX_GAMES}개까지만 올려요.`); break; }
}

fs.mkdirSync(THUMBS, { recursive: true });
const todo = [...picked.values()].filter(g => { const o = oldBy.get(g.id); return !o || !o.thumb || !fs.existsSync(path.join(ROOT, o.thumb)); });
if (todo.length) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  for (const g of todo) { console.log(`  + 캡처: ${g.url}`); const info = await capture(browser, g.url, g.id); Object.assign(g, { title: info.title, thumb: info.thumb }); }
  await browser.close();
}
for (const g of picked.values()) { const o = oldBy.get(g.id); if (o && !todo.includes(g)) { g.title = o.title || ''; g.thumb = o.thumb || ''; } }

/* 승인이 풀렸거나 목록에 없는 그림은 지움 */
const keep = new Set([...picked.values()].map(g => g.thumb).filter(Boolean).map(t => path.basename(t)));
for (const f of fs.readdirSync(THUMBS)) if (!keep.has(f)) { fs.rmSync(path.join(THUMBS, f)); console.log('  - 그림 지움: ' + f); }

const FIELDS = ['id', 'url', 'name', 'subject', 'grade', 'unit', 'lesson', 'desc', 'by', 'added', 'thumb', 'title'];
const games = [...picked.values()].sort((a, b) => b.added.localeCompare(a.added) || a.id.localeCompare(b.id)).map(g => Object.fromEntries(FIELDS.map(k => [k, g[k] ?? ''])));
const next = JSON.stringify({ version: 1, games }, null, 1) + '\n';
const prev = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, 'utf8') : '';
if (next !== prev) { fs.writeFileSync(OUT_JSON, next); console.log(`community.json 바뀜: 게임 ${games.length}개 (건너뜀 ${skipped})`); }
else console.log(`바뀐 것 없음: 게임 ${games.length}개 (건너뜀 ${skipped})`);
