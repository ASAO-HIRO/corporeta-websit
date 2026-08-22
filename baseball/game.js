/* ============================================================
   パワフル野球 かんたん版
   - 依存ライブラリなしの Canvas 2D 野球ゲーム
   ============================================================ */
'use strict';

const W = 960, H = 640;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

/* ---------------- 汎用ユーティリティ ---------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const chance = p => Math.random() < p;
const DEG = Math.PI / 180;

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 能力値(1〜10)をパワプロ風のランク文字に */
function rank(v) {
  return v >= 9.5 ? 'S' : v >= 8.5 ? 'A' : v >= 7.5 ? 'B' : v >= 6.5 ? 'C'
       : v >= 5.5 ? 'D' : v >= 4.5 ? 'E' : v >= 3.5 ? 'F' : 'G';
}
const RANK_COLOR = {
  S: '#ff5d7a', A: '#ff5d7a', B: '#ff9f43', C: '#ffd34d',
  D: '#8ee36b', E: '#6ec7ff', F: '#9fb3c4', G: '#7d8f9e'
};

/* ---------------- 効果音（WebAudio・素材不要） ---------------- */
let audioCtx = null, sfxOn = true;
function tone(freq, dur, type, vol, slideTo) {
  if (!sfxOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol == null ? 0.14 : vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + dur);
  } catch (e) { /* 音が出せない環境は無視 */ }
}
function noise(dur, vol) {
  if (!sfxOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource();
    const g = audioCtx.createGain();
    g.gain.value = vol == null ? 0.12 : vol;
    src.buffer = buf; src.connect(g); g.connect(audioCtx.destination); src.start();
  } catch (e) { /* noop */ }
}
const SFX = {
  swing:  () => noise(0.12, 0.10),
  hit:    () => { tone(260, 0.10, 'square', 0.16, 120); noise(0.05, 0.10); },
  goodHit:() => { tone(520, 0.12, 'square', 0.18, 180); noise(0.06, 0.12); },
  homer:  () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.15), i * 90)); },
  mitt:   () => noise(0.06, 0.08),
  out:    () => tone(300, 0.16, 'sine', 0.12, 160),
  cursor: () => tone(880, 0.03, 'square', 0.04),
  select: () => tone(1200, 0.06, 'square', 0.08),
  score:  () => { [784, 988].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.14), i * 110)); }
};

/* ---------------- 球種データ ---------------- */
/* bx, by は「本塁到達時のズレ量(px)」。投球カーソルは最終到達点を指す。 */
const PITCH_TYPES = {
  straight: { name: 'ストレート', bx: 0,    by: -6,  spd: 1.00 },
  slider:   { name: 'スライダー', bx: -62,  by: 22,  spd: 0.91 },
  curve:    { name: 'カーブ',     bx: -34,  by: 62,  spd: 0.80 },
  fork:     { name: 'フォーク',   bx: 4,    by: 74,  spd: 0.86 },
  shoot:    { name: 'シュート',   bx: 54,   by: 20,  spd: 0.93 },
  change:   { name: 'チェンジ',   bx: 20,   by: 46,  spd: 0.76 },
  sinker:   { name: 'シンカー',   bx: 44,   by: 58,  spd: 0.82 }
};

/* ---------------- 選手・チーム生成 ---------------- */
const SURNAMES = [
  '佐藤', '鈴木', '高橋', '田中', '伊藤', '山本', '中村', '小林', '加藤', '吉田',
  '山田', '佐々木', '山口', '松本', '井上', '木村', '清水', '斎藤', '林', '森',
  '池田', '橋本', '石川', '前田', '藤田', '後藤', '岡田', '長谷川', '村上', '近藤',
  '坂本', '遠藤', '青木', '福田', '西村', '藤井', '太田', '三浦', '中島', '大野'
];
const POS_ORDER = ['中', '二', '右', '一', '三', '左', '遊', '捕', '指'];
/* 打順ごとの能力プロフィール（ミート / パワー / 走力 / 弾道） */
const LINEUP_PROFILE = [
  { m: 7.5, p: 4.0, s: 8.5, d: 1 },
  { m: 8.0, p: 4.5, s: 7.5, d: 2 },
  { m: 8.5, p: 7.0, s: 6.5, d: 3 },
  { m: 7.0, p: 9.0, s: 4.0, d: 4 },
  { m: 6.5, p: 8.0, s: 4.5, d: 3 },
  { m: 6.0, p: 6.5, s: 5.5, d: 3 },
  { m: 5.5, p: 5.0, s: 6.0, d: 2 },
  { m: 5.0, p: 4.0, s: 5.0, d: 2 },
  { m: 4.0, p: 3.0, s: 5.5, d: 1 }
];

const TEAM_DEFS = [
  { name: '東京サンダース',   short: '東京', color: '#e2493f', sub: '#7d1f18', seed: 20240401, power: 1.00 },
  { name: '大阪ブレイブス',   short: '大阪', color: '#f0a500', sub: '#8a5f00', seed: 19881212, power: 0.96 },
  { name: '横浜マリンズ',     short: '横浜', color: '#2f8fe0', sub: '#144a78', seed: 20011103, power: 0.92 },
  { name: '福岡グリーンズ',   short: '福岡', color: '#3fb56b', sub: '#1b5c36', seed: 19950917, power: 1.03 },
  { name: '札幌ノーザンズ',   short: '札幌', color: '#a86fe0', sub: '#4d2a75', seed: 20120724, power: 0.90 },
  { name: '名古屋ドラゴンズ', short: '名古', color: '#5ad2c8', sub: '#1f6d68', seed: 19730620, power: 0.98 }
];

function makeTeam(def) {
  const r = mulberry32(def.seed);
  const used = new Set();
  const pickName = () => {
    let n, guard = 0;
    do { n = SURNAMES[Math.floor(r() * SURNAMES.length)]; guard++; }
    while (used.has(n) && guard < 200);
    used.add(n);
    return n;
  };
  const sv = (base, spread) => clamp(Math.round(base * def.power + (r() * 2 - 1) * spread), 1, 10);

  const batters = LINEUP_PROFILE.map((pf, i) => ({
    name: pickName(),
    pos: POS_ORDER[i],
    order: i + 1,
    meet: sv(pf.m, 1.2),
    power: sv(pf.p, 1.4),
    speed: sv(pf.s, 1.2),
    dan: clamp(pf.d + (r() < 0.25 ? 1 : 0), 1, 4),
    ab: 0, h: 0, hr: 0, rbi: 0
  }));

  const roles = [
    { role: '先発', velo: 148, sta: 100 },
    { role: '中継', velo: 151, sta: 45 },
    { role: '抑え', velo: 154, sta: 35 }
  ];
  const arsenal = ['slider', 'curve', 'fork', 'shoot', 'change', 'sinker'];
  const pitchers = roles.map(ro => {
    const shuffled = arsenal.slice().sort(() => r() - 0.5);
    const nBreak = 2 + Math.floor(r() * 2);
    return {
      name: pickName(),
      role: ro.role,
      velo: Math.round(ro.velo * (0.94 + r() * 0.09) * (0.97 + def.power * 0.03)),
      control: sv(6.5, 2.0),
      stamina: Math.round(ro.sta * (0.85 + r() * 0.3)),
      maxStamina: 0,
      pitches: ['straight'].concat(shuffled.slice(0, nBreak)),
      k: 0, runs: 0
    };
  });
  pitchers.forEach(p => { p.maxStamina = p.stamina; });

  return {
    name: def.name, short: def.short, color: def.color, sub: def.sub,
    batters, pitchers,
    order: 0,          // 次の打者インデックス
    pitcherIdx: 0,
    runs: 0, hits: 0, errors: 0,
    lineScore: []
  };
}

/* ---------------- ゲーム状態 ---------------- */
const S = {
  scene: 'title',        // title / ready / pitch / play / result / inningbreak / gameover
  mode: 'full',          // full = 攻守両方 / bat = 打撃のみ
  innings: 9,
  userSide: 0,           // 0 = 先攻(ビジター), 1 = 後攻(ホーム)
  teams: [null, null],
  inning: 1,
  top: true,             // true = 表
  outs: 0, balls: 0, strikes: 0,
  bases: [null, null, null],
  batter: null,
  msg: null, msgTimer: 0, msgSub: null,
  banner: null, bannerTimer: 0,
  pitch: null,           // 投球中の情報
  play: null,            // 打球シミュレーション結果
  runners: [],           // 走者アニメ
  swingMode: 'power',    // power = 強振 / meet = ミート打ち
  bunt: false,
  cursor: { x: 480, y: 395 },
  aim: { x: 480, y: 395 },
  aimPitch: 0,
  cameFrom: 'batter',    // 表示中のビュー: batter / field
  title: { cursor: 0, team: 0, innings: 9, side: 0, mode: 'full' },
  log: [],
  shake: 0
};

const offTeam = () => S.teams[S.top ? 0 : 1];
const defTeam = () => S.teams[S.top ? 1 : 0];
const userIsBatting = () => (S.top ? 0 : 1) === S.userSide;
const curPitcher = () => { const t = defTeam(); return t.pitchers[t.pitcherIdx]; };

/* ============================================================
   レイアウト定数
   ============================================================ */
/* 打席ビュー（捕手の後ろから見た画面） */
const ZX = 480, ZY = 400;          // ストライクゾーン中心
const ZW = 150, ZH = 180;          // ストライクゾーンの大きさ
const REL = { x: 472, y: 212 };    // リリースポイント
const BALL_R_PLATE = 15;           // 本塁到達時のボール半径

/* フィールドビュー（メートル→画面座標） */
const FSC = 4.2, FX = 480, FY = 618;
const fx = x => FX + x * FSC;
const fy = y => FY - y * FSC;

/* 塁の座標(m)  x:右方向 y:センター方向 */
const BASE_POS = [
  { x: 19.4, y: 19.4 },   // 一塁
  { x: 0,    y: 38.8 },   // 二塁
  { x: -19.4, y: 19.4 },  // 三塁
  { x: 0,    y: 0 }       // 本塁
];
const FIELDERS = [
  { p: '投', x: 0,   y: 18.4, inf: true },
  { p: '捕', x: 0,   y: -2.5, inf: true },
  { p: '一', x: 17,  y: 25,   inf: true },
  { p: '二', x: 10,  y: 37,   inf: true },
  { p: '遊', x: -10, y: 37,   inf: true },
  { p: '三', x: -17, y: 25,   inf: true },
  { p: '左', x: -32, y: 76,   inf: false },
  { p: '中', x: 0,   y: 88,   inf: false },
  { p: '右', x: 32,  y: 76,   inf: false }
];
/* フェンスまでの距離(m)。a はセンターを 0 とした角度(度) */
const fenceDist = a => 100 - 5 * Math.abs(a) / 45;

/* ============================================================
   試合進行
   ============================================================ */
function startGame() {
  const t = S.title;
  const others = TEAM_DEFS.filter((_, i) => i !== t.team);
  const opp = others[Math.floor(Math.random() * others.length)];
  const mine = makeTeam(TEAM_DEFS[t.team]);
  const foe = makeTeam(opp);
  S.innings = t.innings;
  S.mode = t.mode;
  S.userSide = t.side;
  S.teams = t.side === 0 ? [mine, foe] : [foe, mine];
  S.inning = 1; S.top = true;
  S.outs = S.balls = S.strikes = 0;
  S.bases = [null, null, null];
  S.log = [];
  S.halfRuns = 0;
  S.scene = 'ready';
  S.cameFrom = 'batter';
  nextBatter();
  showBanner('1回表  ' + S.teams[0].name + ' の攻撃', 1500);
}

function nextBatter() {
  const t = offTeam();
  S.batter = t.batters[t.order % 9];
  t.order++;
  S.balls = S.strikes = 0;
  S.bunt = false;
  S.cursor.x = ZX; S.cursor.y = ZY;
  S.aim.x = ZX; S.aim.y = ZY;
  S.scene = 'ready';
  S.cameFrom = 'batter';
  S.readyTimer = 0.8;
}

function showMsg(text, sub, dur) {
  S.msg = text; S.msgSub = sub || null; S.msgTimer = dur == null ? 1.1 : dur;
}
function showBanner(text, ms) {
  S.banner = text; S.bannerTimer = (ms || 1400) / 1000;
}
function addLog(text) {
  S.log.unshift(text);
  if (S.log.length > 5) S.log.pop();
}

/* ---------------- 投球 ---------------- */
function throwPitch(typeKey, aimX, aimY) {
  const p = curPitcher();
  const pt = PITCH_TYPES[typeKey];
  const fatigue = clamp(p.stamina / Math.max(1, p.maxStamina), 0, 1);
  const ctrl = clamp(p.control * (0.55 + 0.45 * fatigue), 1, 10);
  const velo = p.velo * (0.93 + 0.07 * fatigue);

  /* コントロールによるブレ */
  const err = (11.5 - ctrl) * 6.5;
  const fx0 = aimX + gauss() * err;
  const fy0 = aimY + gauss() * err;

  const dur = (600 * (142 / velo)) / pt.spd / 1000;   // 秒
  S.pitch = {
    type: typeKey, pt: pt,
    finalX: clamp(fx0, ZX - 250, ZX + 250),
    finalY: clamp(fy0, ZY - 200, ZY + 200),
    dur: dur,
    t: 0,
    velo: Math.round(velo * pt.spd),
    swung: false, done: false,
    cpuSwing: null
  };
  /* ブレイク前の軌道終点（見かけ上の狙い） */
  S.pitch.aimX = S.pitch.finalX - pt.bx;
  S.pitch.aimY = S.pitch.finalY - pt.by;

  p.stamina = Math.max(0, p.stamina - 1);
  S.scene = 'pitch';
  S.cameFrom = 'batter';
  if (!userIsBatting()) {
    SFX.select();
    planCpuBat();                            // CPU が打者のときのスイングを決める
  }
}

function planCpuBat() {
  const b = S.batter, p = S.pitch;
  const inZone = Math.abs(p.finalX - ZX) < ZW / 2 + 14 && Math.abs(p.finalY - ZY) < ZH / 2 + 14;
  const disc = b.meet / 10;
  let prob = inZone ? 0.62 + disc * 0.25 : 0.26 - disc * 0.16;
  if (S.strikes === 2) prob += inZone ? 0.25 : 0.28;
  if (S.balls === 3 && !inZone) prob -= 0.12;
  if (S.balls === 0 && S.strikes === 0) prob -= 0.12;
  if (!chance(clamp(prob, 0.02, 0.97))) { p.cpuSwing = null; return; }

  const skill = b.meet / 10;
  const timing = 1 + gauss() * (0.165 - skill * 0.07);
  const errR = (11 - b.meet) * 4.5 + Math.abs(gauss()) * 10.5;
  const ang = Math.random() * Math.PI * 2;
  p.cpuSwing = {
    at: clamp(timing, 0.7, 1.3) * p.dur,
    cx: p.finalX + Math.cos(ang) * errR,
    cy: p.finalY + Math.sin(ang) * errR,
    mode: (b.power >= 7 && chance(0.6)) || chance(0.35) ? 'power' : 'meet'
  };
}

/** CPU 投手の配球 */
function cpuPitchChoice() {
  const p = curPitcher();
  const type = p.pitches[Math.floor(Math.random() * p.pitches.length)];
  const ahead = S.strikes > S.balls;
  const mustStrike = S.balls === 3;
  const behind = S.balls > S.strikes;
  let kind;
  if (mustStrike) kind = 'zone';
  else if (ahead) kind = chance(0.5) ? 'chase' : (chance(0.55) ? 'edge' : 'zone');
  else if (behind) kind = chance(0.5) ? 'zone' : 'edge';
  else kind = chance(0.42) ? 'zone' : (chance(0.7) ? 'edge' : 'chase');

  const side = chance(0.5) ? -1 : 1;
  let ax, ay;
  if (kind === 'zone') {
    ax = ZX + rnd(-1, 1) * ZW * (mustStrike ? 0.28 : 0.36);
    ay = ZY + rnd(-1, 1) * ZH * (mustStrike ? 0.26 : 0.34);
  } else if (kind === 'edge') {
    ax = ZX + side * ZW * rnd(0.36, 0.78);
    ay = ZY + rnd(-1, 1) * ZH * 0.62;
  } else {
    if (chance(0.55)) {
      ax = ZX + side * ZW * rnd(0.85, 1.25);
      ay = ZY + rnd(-0.6, 0.9) * ZH * 0.6;
    } else {
      ax = ZX + side * ZW * rnd(0.1, 0.6);
      ay = ZY + (chance(0.65) ? 1 : -1) * ZH * rnd(0.62, 0.95);
    }
  }
  throwPitch(type, ax, ay);
}

/* ---------------- スイング判定 ---------------- */
function doSwing(cx, cy, mode) {
  const p = S.pitch;
  if (!p || p.swung || p.done) return;
  p.swung = true;
  p.swingT = p.t;
  SFX.swing();

  const b = S.batter;
  const timing = p.t / p.dur;                 // 1.0 でジャストミート
  const dx = p.finalX - cx;
  const dy = p.finalY - cy;

  const size = cursorSize(b, mode);
  const hw = size.w / 2 + BALL_R_PLATE * 0.75;
  const hh = size.h / 2 + BALL_R_PLATE * 0.75;

  const spatialMiss = Math.abs(dx) > hw || Math.abs(dy) > hh;
  const timeErr = Math.abs(timing - 1);
  const timeMiss = timeErr > 0.24;

  if (spatialMiss || timeMiss) {
    p.result = 'swingmiss';
    finishPitch();
    return;
  }
  const qs = 1 - Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  const qt = 1 - timeErr / 0.24;
  const q = clamp(0.52 * qs + 0.48 * qt, 0, 1);
  p.result = 'contact';
  p.contact = { q, qs, qt, dx, dy, timing, mode };
  makeHit(b, p.contact);
}

function cursorSize(b, mode) {
  const base = 50 - b.meet * 2.2;                    // ミート10 → 28
  const f = mode === 'meet' ? 1.22 : 0.86;
  return { w: base * f + 12, h: base * f + 6 };
}

/** バント */
function doBunt(cx, cy) {
  const p = S.pitch;
  if (!p || p.swung || p.done) return;
  p.swung = true; p.swingT = p.t;
  SFX.swing();
  const b = S.batter;
  const timing = p.t / p.dur;
  const dx = Math.abs(p.finalX - cx), dy = Math.abs(p.finalY - cy);
  const ok = dx < 78 && dy < 76 && Math.abs(timing - 1) < 0.30;
  if (!ok) { p.result = 'swingmiss'; finishPitch(); return; }
  const inZone = Math.abs(p.finalX - ZX) < ZW / 2 + 10 && Math.abs(p.finalY - ZY) < ZH / 2 + 10;
  if (!inZone && chance(0.55)) { p.result = 'swingmiss'; finishPitch(); return; }
  p.result = 'contact';
  const ang = rnd(-32, 32);
  const dist = rnd(9, 22);
  startPlay({
    angle: ang, dist: dist, launch: 2, hangTime: 0.4,
    exitV: 8, bunt: true, batter: b
  });
}

/* ============================================================
   打球の生成とフィールドシミュレーション
   ============================================================ */
function makeHit(b, c) {
  const modeP = c.mode === 'power' ? 1.08 : 0.90;

  /* 打球方向: 早い(引っ張り) / 遅い(流し) + 左右のズレ */
  let angle = -(1 - c.timing) / 0.24 * 58 + c.dx * 0.26 + gauss() * 6;
  angle = clamp(angle, -78, 78);

  /* 打球角度: カーソルより下でとらえると上がる */
  let launch = 16 - c.dy * 1.05 + (b.dan - 2) * 4.5 + gauss() * 8.5;
  launch = clamp(launch, -22, 58);

  /* 初速 */
  const exitV = (24 + b.power * 2.1) * (0.50 + 0.50 * c.q) * modeP * rnd(0.95, 1.05);

  let dist, hang;
  if (launch <= 4) {
    dist = clamp(exitV * 1.9 * rnd(0.85, 1.15), 4, 95);
    hang = 0.25;
  } else {
    const th = launch * DEG;
    dist = (exitV * exitV) * Math.sin(2 * th) / 9.8 * 0.86;
    hang = 2 * exitV * Math.sin(th) / 9.8 * 0.92;
  }
  const foulProb = clamp(0.66 - c.q * 0.60, 0.04, 0.66);
  if (chance(foulProb)) angle = (angle < 0 ? -1 : 1) * rnd(47, 88);
  startPlay({ angle, dist, launch, hangTime: hang, exitV, batter: b, q: c.q, bunt: false });
}

function simulatePlay(h) {
  const a = h.angle;
  const rad = a * DEG;
  const land = { x: Math.sin(rad) * h.dist, y: Math.cos(rad) * h.dist };
  const res = { land, hangTime: h.hangTime, launch: h.launch, angle: a, dist: h.dist, bunt: h.bunt };

  /* ファウル */
  if (Math.abs(a) > 45) {
    res.type = 'foul'; res.text = 'ファウル';
    res.land = { x: Math.sin(clamp(a, -68, 68) * DEG) * Math.min(h.dist, 60),
                 y: Math.cos(clamp(a, -68, 68) * DEG) * Math.min(h.dist, 60) };
    return res;
  }

  /* ホームラン */
  if (h.launch >= 14 && h.dist >= fenceDist(a)) {
    res.type = 'HR'; res.text = 'ホームラン!!'; res.bases = 4;
    return res;
  }

  const bat = h.batter;
  const runSpd = 5.7 + bat.speed * 0.17;          // 一塁到達速度(m/s)
  const nearest = (px, py, infOnly) => {
    let best = -1, bd = 1e9;
    FIELDERS.forEach((f, i) => {
      if (infOnly && !f.inf) return;
      const d = Math.hypot(f.x - px, f.y - py);
      if (d < bd) { bd = d; best = i; }
    });
    return { i: best, d: bd };
  };

  /* --- ゴロ --- */
  if (h.launch <= 6) {
    const vg = Math.max(6, h.exitV * 0.72);
    let fielded = null;
    FIELDERS.forEach((f, i) => {
      if (!f.inf || f.p === '捕') return;
      const s = f.x * Math.sin(rad) + f.y * Math.cos(rad);        // 打球線上への射影
      if (s < 2 || s > 46) return;
      const perp = Math.abs(f.x * Math.cos(rad) - f.y * Math.sin(rad));
      const tBall = s / (vg * 0.78);
      const tMan = 0.34 + perp / 6.2;
      if (tMan <= tBall + 0.18) {
        const cand = { i, s, perp, t: tBall, px: Math.sin(rad) * s, py: Math.cos(rad) * s };
        if (!fielded || cand.s < fielded.s) fielded = cand;
      }
    });

    if (h.bunt) {
      const g = fielded || { i: 0, t: 0.9, px: land.x, py: land.y, s: h.dist };
      const dTo1 = Math.hypot(g.px - BASE_POS[0].x, g.py - BASE_POS[0].y);
      const tOut = g.t + 0.75 + dTo1 / 30;
      const tRun = 27.4 / (runSpd + 0.5);
      res.fielder = g.i; res.spot = { x: g.px, y: g.py }; res.groundTime = g.t;
      if (tOut < tRun && !chance(0.06)) {
        res.type = 'groundout'; res.text = 'バント失敗（アウト）'; res.outs = 1; res.sac = true;
      } else {
        res.type = 'infield_single'; res.text = 'バントヒット!'; res.bases = 1;
      }
      return res;
    }

    if (fielded) {
      const dTo1 = Math.hypot(fielded.px - BASE_POS[0].x, fielded.py - BASE_POS[0].y);
      const tOut = fielded.t + 0.62 + dTo1 / 31 + fielded.perp / 22;
      const tRun = 27.4 / runSpd;
      res.fielder = fielded.i; res.spot = { x: fielded.px, y: fielded.py }; res.groundTime = fielded.t;
      if (chance(0.028)) {
        res.type = 'error'; res.text = 'エラー!'; res.bases = 1; res.error = true;
        return res;
      }
      if (tOut < tRun) {
        res.type = 'groundout';
        res.text = FIELDERS[fielded.i].p + 'ゴロ';
        res.outs = 1;
      } else {
        res.type = 'infield_single'; res.text = '内野安打!'; res.bases = 1;
      }
      return res;
    }
    /* 内野を抜けた */
    const of = nearest(land.x, land.y, false);
    res.fielder = of.i; res.spot = { x: land.x, y: land.y }; res.groundTime = h.dist / (vg * 0.78);
    res.type = 'single'; res.text = 'ヒット!'; res.bases = 1;
    if (h.dist > 62 && of.d > 16 && chance(0.35 + bat.speed * 0.02)) { res.bases = 2; res.text = 'ツーベース!'; res.type = 'double'; }
    return res;
  }

  /* --- ライナー / フライ --- */
  const n = nearest(land.x, land.y, false);
  const f = FIELDERS[n.i];
  const react = f.inf ? 0.30 : 0.45;
  const spd = f.inf ? 6.2 : 6.5;
  const tMan = react + n.d / spd;
  const liner = h.launch < 16;
  const margin = liner ? 0.0 : 0.12;
  res.fielder = n.i; res.spot = { x: land.x, y: land.y };

  if (tMan <= h.hangTime + margin && h.dist < fenceDist(a)) {
    if (chance(0.02) && !f.inf) {
      res.type = 'error'; res.text = 'エラー!'; res.bases = 2; res.error = true;
      return res;
    }
    res.type = liner ? 'lineout' : 'flyout';
    res.text = f.p + (liner ? 'ライナー' : 'フライ');
    res.outs = 1;
    res.caught = true;
    return res;
  }

  /* 安打 */
  let bases = 1;
  if (h.dist >= 55 && n.d > 14) bases = 2;
  if (h.dist >= 70 && n.d > 24 && chance(0.45 + bat.speed * 0.03)) bases = 3;
  if (h.dist < 32) bases = 1;                       // ポテンヒット
  res.bases = bases;
  res.type = bases === 3 ? 'triple' : bases === 2 ? 'double' : 'single';
  res.text = bases === 3 ? 'スリーベース!!' : bases === 2 ? 'ツーベース!' :
             (h.dist < 32 ? 'ポテンヒット!' : 'ヒット!');
  return res;
}

/* ============================================================
   打球アニメーションの開始
   ============================================================ */
function startPlay(h) {
  const res = simulatePlay(h);
  const flight = res.type === 'HR' ? Math.max(2.2, res.hangTime * 1.1)
              : (h.launch <= 6 ? Math.max(0.75, (res.groundTime || 1) ) : Math.max(0.6, res.hangTime));
  S.play = {
    h, res,
    t: 0,
    flight: flight,
    phase: 'flight',
    ballFrom: { x: 0, y: 0 },
    ballTo: res.spot || res.land,
    fielderIdx: res.fielder != null ? res.fielder : -1,
    fielderFrom: res.fielder != null ? { x: FIELDERS[res.fielder].x, y: FIELDERS[res.fielder].y } : null
  };
  S.scene = 'play';
  S.cameFrom = 'field';
  S.shake = res.type === 'HR' ? 10 : 6;
  if (res.type === 'HR') SFX.homer();
  else if (h.q != null && h.q > 0.72) SFX.goodHit();
  else SFX.hit();
}

/* ============================================================
   走者処理・得点
   ============================================================ */
function newRunnerAnim() { S.runners = []; }
function runnerMove(player, from, to, out) {
  S.runners.push({ p: player, from, to, out: !!out });
}

function scoreRun(player, batter) {
  const t = offTeam();
  t.runs++;
  S.halfRuns++;
  t.lineScore[S.inning - 1] = S.halfRuns;
  if (batter) batter.rbi++;
  const dp = defTeam().pitchers[defTeam().pitcherIdx];
  dp.runs++;
  SFX.score();
}

/** 安打・エラーによる進塁 */
function advanceOnHit(bases, deep, batter) {
  const b = S.bases;
  const extra = p => p && chance(clamp(0.18 + p.speed * 0.06 + (deep ? 0.22 : 0), 0, 0.9));
  let runs = 0;
  const nb = [null, null, null];

  const send = (p, target) => {          // target: 0,1,2 = 塁 / 3 = 生還
    if (!p) return;
    if (target >= 3) { runnerMove(p, p._base, 3, false); scoreRun(p, batter); runs++; }
    else { runnerMove(p, p._base, target, false); nb[target] = p; }
  };
  [0, 1, 2].forEach(i => { if (b[i]) b[i]._base = i; });

  if (bases === 4) {
    [2, 1, 0].forEach(i => send(b[i], 3));
    runnerMove(batter, -1, 3, false);
    scoreRun(batter, batter); runs++;
  } else if (bases === 3) {
    [2, 1, 0].forEach(i => send(b[i], 3));
    runnerMove(batter, -1, 2, false); nb[2] = batter;
  } else if (bases === 2) {
    send(b[2], 3);
    send(b[1], 3);
    send(b[0], extra(b[0]) ? 3 : 2);
    runnerMove(batter, -1, 1, false); nb[1] = batter;
  } else {
    send(b[2], 3);
    send(b[1], (deep || extra(b[1])) ? 3 : 2);
    send(b[0], extra(b[0]) ? 2 : 1);
    runnerMove(batter, -1, 0, false); nb[0] = batter;
  }
  S.bases = nb;
  return runs;
}

/** 四球など、押し出しのみの進塁 */
function forceAdvance(batter) {
  const b = S.bases;
  [0, 1, 2].forEach(i => { if (b[i]) b[i]._base = i; });
  let runs = 0;
  if (b[0] && b[1] && b[2]) {
    runnerMove(b[2], 2, 3, false); scoreRun(b[2], batter); runs++;
    runnerMove(b[1], 1, 2, false); runnerMove(b[0], 0, 1, false);
    S.bases = [batter, b[0], b[1]];
  } else if (b[0] && b[1]) {
    runnerMove(b[1], 1, 2, false); runnerMove(b[0], 0, 1, false);
    S.bases = [batter, b[0], b[1]];
  } else if (b[0]) {
    runnerMove(b[0], 0, 1, false);
    S.bases = [batter, b[0], b[2]];
  } else {
    S.bases = [batter, b[1], b[2]];
  }
  runnerMove(batter, -1, 0, false);
  return runs;
}

/* ============================================================
   結果の反映
   ============================================================ */
function afterMsg(text, sub, dur, fn) {
  S.scene = 'result';
  S.runnerT = 0;
  S.after = fn || (() => nextBatter());
  showMsg(text, sub, dur);
}

/** 打席結果のあと、サヨナラ→チェンジ→次打者の順で進める */
function proceed() {
  if (checkWalkoff()) return;
  if (S.outs >= 3) endHalf(); else nextBatter();
}

function resolvePlay(res) {
  newRunnerAnim();
  const batter = S.batter;
  const t = offTeam();
  const outsBefore = S.outs;
  let sub = '';

  const deep = res.dist >= 55;

  switch (res.type) {
    case 'HR': {
      batter.ab++; batter.h++; batter.hr++; t.hits++;
      const r = advanceOnHit(4, true, batter);
      sub = r + '点';
      break;
    }
    case 'triple': case 'double': case 'single': case 'infield_single': {
      batter.ab++; batter.h++; t.hits++;
      const r = advanceOnHit(res.bases, deep, batter);
      if (r > 0) sub = r + '点';
      break;
    }
    case 'error': {
      batter.ab++; defTeam().errors++;
      const r = advanceOnHit(res.bases, deep, batter);
      if (r > 0) sub = r + '点';
      break;
    }
    case 'flyout': case 'lineout': {
      const sac = res.type === 'flyout' && S.bases[2] && outsBefore < 2 && res.dist >= 58;
      S.outs++;
      SFX.out();
      runnerMove(batter, -1, 0, true);
      if (sac) {
        const r3 = S.bases[2];
        runnerMove(r3, 2, 3, false);
        scoreRun(r3, batter);
        S.bases[2] = null;
        res.text = '犠牲フライ';
        sub = '1点';
        if (S.bases[1] && chance(0.4)) { runnerMove(S.bases[1], 1, 2, false); S.bases[2] = S.bases[1]; S.bases[1] = null; }
      } else {
        batter.ab++;
        /* 深いフライならタッチアップ */
        if (res.type === 'flyout' && res.dist >= 68 && outsBefore < 2) {
          if (S.bases[1] && !S.bases[2] && chance(0.45)) { runnerMove(S.bases[1], 1, 2, false); S.bases[2] = S.bases[1]; S.bases[1] = null; }
        }
      }
      break;
    }
    case 'groundout': {
      const r1 = S.bases[0];
      const dpOK = r1 && outsBefore < 2 && !res.bunt && res.fielder != null && FIELDERS[res.fielder].inf;
      const dpProb = dpOK ? clamp(0.44 - batter.speed * 0.02, 0.12, 0.6) : 0;
      SFX.out();
      if (dpOK && chance(dpProb)) {
        S.outs += 2;
        runnerMove(batter, -1, 0, true);
        runnerMove(r1, 0, 1, true);
        S.bases[0] = null;
        batter.ab++;
        res.text = 'ゲッツー!';
        if (S.bases[2] && S.outs < 3) { /* 三塁走者は自重 */ }
      } else {
        S.outs++;
        batter.ab++;
        runnerMove(batter, -1, 0, true);
        /* 三塁走者の生還 */
        if (S.bases[2] && outsBefore < 2 && (res.fielder == null || !FIELDERS[res.fielder].inf || chance(0.45))) {
          runnerMove(S.bases[2], 2, 3, false);
          scoreRun(S.bases[2], batter);
          S.bases[2] = null;
          sub = '1点';
        }
        /* 走者は進塁 */
        if (S.bases[1] && !S.bases[2] && chance(0.6)) { runnerMove(S.bases[1], 1, 2, false); S.bases[2] = S.bases[1]; S.bases[1] = null; }
        if (S.bases[0]) {
          if (!S.bases[1]) { runnerMove(S.bases[0], 0, 1, false); S.bases[1] = S.bases[0]; S.bases[0] = null; }
        }
        if (res.sac) { batter.ab--; res.text = 'バント（アウト）'; }
      }
      break;
    }
  }

  const txt = res.text;
  addLog(batter.name + ': ' + txt + (sub ? '（' + sub + '）' : ''));
  afterMsg(txt, sub, res.type === 'HR' ? 2.0 : 1.35, proceed);
}

/* ---------------- カウント処理 ---------------- */
function finishPitch() {
  const p = S.pitch;
  if (!p || p.done) return;
  p.done = true;

  if (p.result === 'swingmiss') {
    countStrike('空振り');
  } else if (p.result === 'take') {
    const inZone = Math.abs(p.finalX - ZX) <= ZW / 2 && Math.abs(p.finalY - ZY) <= ZH / 2;
    if (inZone) countStrike('見逃し'); else countBall();
  }
}

function countStrike(label) {
  S.strikes++;
  if (S.strikes >= 3) {
    S.outs++;
    curPitcher().k++;
    S.batter.ab++;
    SFX.out();
    newRunnerAnim();
    addLog(S.batter.name + ': 三振');
    afterMsg(label === '見逃し' ? '見逃し三振!' : '三振!', '', 1.25, proceed);
  } else {
    afterMsg('', '', 0.30, () => { S.scene = 'ready'; S.cameFrom = 'batter'; S.readyTimer = 0.42; });
  }
}

function countBall() {
  S.balls++;
  if (S.balls >= 4) {
    newRunnerAnim();
    const r = forceAdvance(S.batter);
    addLog(S.batter.name + ': 四球' + (r ? '（押し出し）' : ''));
    afterMsg('フォアボール', r ? '押し出し 1点' : '', 1.25, proceed);
  } else {
    afterMsg('', '', 0.30, () => { S.scene = 'ready'; S.cameFrom = 'batter'; S.readyTimer = 0.42; });
  }
}

function countFoul() {
  if (S.strikes < 2) S.strikes++;
  afterMsg('ファウル', '', 0.6, () => { S.scene = 'ready'; S.cameFrom = 'batter'; S.readyTimer = 0.42; });
}

/* ---------------- イニング進行 ---------------- */
function endHalf() {
  const t = offTeam();
  t.lineScore[S.inning - 1] = S.halfRuns || 0;

  /* 投手交代 */
  const d = defTeam();
  const p = d.pitchers[d.pitcherIdx];
  if (p.stamina <= 0 && d.pitcherIdx < d.pitchers.length - 1) {
    d.pitcherIdx++;
    addLog(d.short + ': 投手交代 → ' + d.pitchers[d.pitcherIdx].name);
  }

  S.outs = 0; S.balls = 0; S.strikes = 0;
  S.bases = [null, null, null];
  newRunnerAnim();

  const away = S.teams[0].runs, home = S.teams[1].runs;
  const last = S.inning >= S.innings;

  if (S.top) {
    /* 表終了 → 裏へ。最終回で後攻がリードしていれば試合終了 */
    if (last && home > away) return gameOver();
    S.top = false;
    S.halfRuns = 0;
    S.scene = 'inningbreak';
    showBanner(S.inning + '回裏  ' + S.teams[1].name + ' の攻撃', 1500);
  } else {
    if (last && away !== home) return gameOver();
    if (S.inning >= S.innings + 3) return gameOver();     // 延長は3回まで
    S.inning++;
    S.top = true;
    S.halfRuns = 0;
    S.scene = 'inningbreak';
    showBanner(S.inning + '回表  ' + S.teams[0].name + ' の攻撃', 1500);
  }
}

/** サヨナラ判定（裏の攻撃中に勝ち越したら即終了） */
function checkWalkoff() {
  if (S.top) return false;
  if (S.inning < S.innings) return false;
  if (S.teams[1].runs > S.teams[0].runs) {
    S.teams[1].lineScore[S.inning - 1] = S.halfRuns || 0;
    gameOver(true);
    return true;
  }
  return false;
}

function gameOver(walkoff) {
  S.scene = 'gameover';
  S.walkoff = !!walkoff;
  const a = S.teams[0].runs, h = S.teams[1].runs;
  S.resultText = a === h ? '引き分け' :
    (a > h ? S.teams[0].name : S.teams[1].name) + ' の勝ち';
}

/* ============================================================
   描画ヘルパ
   ============================================================ */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function txt(s, x, y, size, color, align, weight) {
  ctx.fillStyle = color || '#fff';
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = (weight || 'bold') + ' ' + size + 'px "Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif';
  ctx.fillText(s, x, y);
}

function ballPos(p) {
  const raw = p.t / p.dur;
  const t = clamp(raw, 0, 1);
  const tt = Math.pow(t, 1.45);
  const br = Math.pow(t, 2.2);
  let x = lerp(REL.x, p.aimX, tt) + p.pt.bx * br;
  let y = lerp(REL.y, p.aimY, tt) + p.pt.by * br;
  if (raw > 1) {                    // 捕手のミットへ吸い込まれる
    const o = (raw - 1) * 2.2;
    y += o * 40;
  }
  const r = 4 + 12 * Math.pow(t, 1.6) + (raw > 1 ? -6 * (raw - 1) : 0);
  return { x, y, r: Math.max(3, r) };
}

/* ============================================================
   スコアボード
   ============================================================ */
function drawScoreboard() {
  ctx.fillStyle = '#0d1620';
  ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = '#1c2b3a';
  ctx.fillRect(0, 88, W, 4);

  const cols = Math.max(S.innings, S.inning);
  const cw = 34, x0 = 210, y0 = 14;

  txt('回', x0 - 14, y0 + 12, 11, '#7fa8c9', 'right');
  for (let i = 0; i < cols; i++) {
    const cx = x0 + i * cw;
    const cur = (i + 1) === S.inning;
    if (cur) { ctx.fillStyle = '#24384c'; ctx.fillRect(cx - 1, y0, cw - 2, 62); }
    txt(String(i + 1), cx + cw / 2 - 1, y0 + 12, 11, cur ? '#ffd34d' : '#7fa8c9', 'center');
  }
  txt('R', x0 + cols * cw + 22, y0 + 12, 11, '#ffd34d', 'center');
  txt('H', x0 + cols * cw + 56, y0 + 12, 11, '#7fa8c9', 'center');
  txt('E', x0 + cols * cw + 88, y0 + 12, 11, '#7fa8c9', 'center');

  for (let ti = 0; ti < 2; ti++) {
    const t = S.teams[ti];
    const y = y0 + 34 + ti * 24;
    const isUser = ti === S.userSide;
    txt((isUser ? '▶ ' : '   ') + t.name, 196, y, 14, isUser ? '#fff' : '#c2d4e2', 'right');
    ctx.fillStyle = t.color;
    ctx.fillRect(14, y - 12, 6, 15);
    for (let i = 0; i < cols; i++) {
      const v = t.lineScore[i];
      const half = (i + 1) === S.inning && ((ti === 0 && S.top) || (ti === 1 && !S.top)) && S.scene !== 'gameover';
      let s = '';
      if (v != null) s = String(v);
      else if (half) s = '-';
      else if (ti === 1 && i + 1 <= S.inning && S.scene === 'gameover') s = 'X';
      txt(s, x0 + i * cw + cw / 2 - 1, y, 13, half ? '#ffd34d' : '#e8eef5', 'center');
    }
    txt(String(t.runs), x0 + cols * cw + 22, y, 16, '#ffd34d', 'center');
    txt(String(t.hits), x0 + cols * cw + 56, y, 13, '#c2d4e2', 'center');
    txt(String(t.errors), x0 + cols * cw + 88, y, 13, '#c2d4e2', 'center');
  }

  /* イニング表示 */
  const arrow = S.top ? '▲' : '▼';
  txt(S.inning + '回' + (S.top ? '表' : '裏') + ' ' + arrow, W - 20, 30, 15, '#ffd34d', 'right');
  txt(userIsBatting() ? '攻撃中' : '守備中', W - 20, 52, 12, userIsBatting() ? '#8ee36b' : '#6ec7ff', 'right');
  txt(sfxOn ? '♪ ON' : '♪ OFF', W - 20, 72, 10, '#5b7a95', 'right');
}

/* ============================================================
   カウント / 塁状況 / 選手カード
   ============================================================ */
function drawCount() {
  const x = 24, y = 108;
  ctx.fillStyle = 'rgba(8,16,24,0.72)';
  rr(x, y, 178, 74, 8); ctx.fill();

  const lamp = (lx, ly, on, color) => {
    ctx.beginPath(); ctx.arc(lx, ly, 6.5, 0, 7);
    ctx.fillStyle = on ? color : '#2a3a4a'; ctx.fill();
    ctx.strokeStyle = '#0d1620'; ctx.lineWidth = 1.5; ctx.stroke();
  };
  txt('B', x + 14, y + 22, 12, '#8ee36b');
  for (let i = 0; i < 3; i++) lamp(x + 42 + i * 20, y + 17, S.balls > i, '#4ce06a');
  txt('S', x + 14, y + 44, 12, '#ffd34d');
  for (let i = 0; i < 2; i++) lamp(x + 42 + i * 20, y + 39, S.strikes > i, '#ffd34d');
  txt('O', x + 14, y + 66, 12, '#ff6b6b');
  for (let i = 0; i < 2; i++) lamp(x + 42 + i * 20, y + 61, S.outs > i, '#ff5d5d');

  /* 塁ダイヤ */
  const dx = x + 132, dy = y + 38, s = 15;
  const diamond = (cx, cy, on) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx - 9, cy);
    ctx.closePath();
    ctx.fillStyle = on ? '#ffd34d' : '#2a3a4a'; ctx.fill();
    ctx.strokeStyle = '#0d1620'; ctx.lineWidth = 1.5; ctx.stroke();
  };
  diamond(dx + s, dy, !!S.bases[0]);
  diamond(dx, dy - s, !!S.bases[1]);
  diamond(dx - s, dy, !!S.bases[2]);
}

function statChip(x, y, label, v) {
  txt(label, x, y, 10, '#9fb3c4');
  txt(rank(v), x + 22, y + 1, 14, RANK_COLOR[rank(v)]);
}

function drawBatterCard() {
  const x = 22, y = H - 96, w = 250, h = 74;
  ctx.fillStyle = 'rgba(8,16,24,0.78)';
  rr(x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = offTeam().color;
  ctx.fillRect(x, y + 8, 5, h - 16);

  const b = S.batter;
  if (!b) return;
  txt(b.order + '番 ' + b.pos, x + 16, y + 22, 11, '#9fb3c4');
  txt(b.name, x + 16, y + 44, 20, '#fff');
  const avg = b.ab > 0 ? (b.h / b.ab).toFixed(3).replace(/^0/, '') : '.---';
  txt('打率 ' + avg + '  本' + b.hr + '  点' + b.rbi, x + 16, y + 62, 11, '#9fb3c4');
  statChip(x + 150, y + 22, 'ミート', b.meet);
  statChip(x + 150, y + 40, 'パワー', b.power);
  statChip(x + 150, y + 58, '走力', b.speed);
  txt('弾道' + b.dan, x + 208, y + 62, 10, '#7fa8c9');
}

function drawPitcherCard() {
  const p = curPitcher();
  const x = W - 272, y = H - 96, w = 250, h = 74;
  ctx.fillStyle = 'rgba(8,16,24,0.78)';
  rr(x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = defTeam().color;
  ctx.fillRect(x + w - 5, y + 8, 5, h - 16);

  txt(p.role + '投手', x + 14, y + 22, 11, '#9fb3c4');
  txt(p.name, x + 14, y + 44, 20, '#fff');
  txt(p.velo + 'km/h  奪三振' + p.k, x + 14, y + 62, 11, '#9fb3c4');
  statChip(x + 150, y + 22, 'コン', p.control);
  /* スタミナバー */
  txt('スタミナ', x + 150, y + 44, 10, '#9fb3c4');
  const ratio = clamp(p.stamina / Math.max(1, p.maxStamina), 0, 1);
  ctx.fillStyle = '#243444'; rr(x + 150, y + 50, 86, 9, 4); ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? '#4ce06a' : ratio > 0.2 ? '#ffd34d' : '#ff5d5d';
  rr(x + 150, y + 50, 86 * ratio, 9, 4); ctx.fill();
}

/* ============================================================
   打席ビュー
   ============================================================ */
function drawBatterView() {
  /* 背景 */
  const g = ctx.createLinearGradient(0, 92, 0, H);
  g.addColorStop(0, '#16303f');
  g.addColorStop(0.32, '#20492f');
  g.addColorStop(1, '#2f6d3f');
  ctx.fillStyle = g; ctx.fillRect(0, 92, W, H - 92);

  /* スタンド */
  ctx.fillStyle = '#12222e';
  ctx.fillRect(0, 92, W, 66);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.01) + ')';
    ctx.fillRect((i * 37) % W, 100 + (i % 5) * 11, 22, 5);
  }
  /* 内野の土 */
  ctx.fillStyle = '#8a6236';
  ctx.beginPath();
  ctx.ellipse(480, 560, 430, 190, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#2f6d3f';
  ctx.beginPath();
  ctx.ellipse(480, 330, 250, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a6236';
  ctx.beginPath();
  ctx.ellipse(472, 300, 92, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  /* 本塁 */
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.moveTo(430, 588); ctx.lineTo(530, 588); ctx.lineTo(540, 604);
  ctx.lineTo(480, 618); ctx.lineTo(420, 604); ctx.closePath(); ctx.fill();

  /* 投手 */
  drawPitcherFigure();

  /* ストライクゾーン */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(ZX - ZW / 2, ZY - ZH / 2, ZW, ZH);
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(ZX - ZW / 2 + ZW / 3 * i, ZY - ZH / 2);
    ctx.lineTo(ZX - ZW / 2 + ZW / 3 * i, ZY + ZH / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ZX - ZW / 2, ZY - ZH / 2 + ZH / 3 * i);
    ctx.lineTo(ZX + ZW / 2, ZY - ZH / 2 + ZH / 3 * i); ctx.stroke();
  }
  ctx.restore();

  /* 打者 */
  drawBatterFigure();

  /* 投球中のボール */
  if (S.pitch && (S.scene === 'pitch')) {
    const p = S.pitch;
    const b = ballPos(p);
    /* 残像 */
    for (let i = 1; i <= 5; i++) {
      const pt = { ...p, t: Math.max(0, p.t - i * 0.022) };
      const q = ballPos(pt);
      ctx.globalAlpha = 0.11 * (5 - i) / 4;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r * 0.85, 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#c94b4b'; ctx.lineWidth = Math.max(1, b.r * 0.16);
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.62, 0.6, 2.4); ctx.stroke();
  }

  /* ミートカーソル or 投球カーソル */
  if (userIsBatting()) {
    if (S.scene === 'ready' || S.scene === 'pitch') drawMeetCursor();
  } else if (userPitching()) {
    if (S.scene === 'ready' || S.scene === 'pitch') drawAimCursor();
  }
}

function drawMeetCursor() {
  const b = S.batter;
  const s = cursorSize(b, S.swingMode);
  const x = S.cursor.x, y = S.cursor.y;
  const swinging = S.pitch && S.pitch.swung && (S.pitch.t - S.pitch.swingT) < 0.14;
  ctx.save();
  ctx.strokeStyle = S.bunt ? '#6ec7ff' : (S.swingMode === 'power' ? '#ff9f43' : '#8ee36b');
  ctx.lineWidth = swinging ? 5 : 3;
  ctx.globalAlpha = swinging ? 1 : 0.92;
  if (S.bunt) {
    ctx.strokeRect(x - 70, y - 62, 140, 124);
    txt('バント', x, y - 70, 12, '#6ec7ff', 'center');
  } else {
    const w = s.w, h = s.h;
    const c = 12;
    const seg = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    seg(x - w / 2, y - h / 2, x - w / 2 + c, y - h / 2); seg(x - w / 2, y - h / 2, x - w / 2, y - h / 2 + c);
    seg(x + w / 2, y - h / 2, x + w / 2 - c, y - h / 2); seg(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + c);
    seg(x - w / 2, y + h / 2, x - w / 2 + c, y + h / 2); seg(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - c);
    seg(x + w / 2, y + h / 2, x + w / 2 - c, y + h / 2); seg(x + w / 2, y + h / 2, x + w / 2, y + h / 2 - c);
    ctx.globalAlpha = 0.5;
    seg(x - 6, y, x + 6, y); seg(x, y - 6, x, y + 6);
  }
  ctx.restore();
}

function drawAimCursor() {
  const x = S.aim.x, y = S.aim.y;
  ctx.save();
  ctx.strokeStyle = '#6ec7ff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 8, y);
  ctx.moveTo(x + 8, y); ctx.lineTo(x + 26, y);
  ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 8);
  ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 26); ctx.stroke();
  ctx.restore();
}

function drawPitcherFigure() {
  const wind = S.pitch && S.scene === 'pitch' ? clamp(S.pitch.t / (S.pitch.dur * 0.25), 0, 1) : 0;
  const x = 472, y = 292 + wind * 10;
  const col = defTeam() ? defTeam().color : '#ddd';
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x, 306, 26, 7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#f0d9b5';
  ctx.beginPath(); ctx.arc(x, y - 46, 9, 0, 7); ctx.fill();
  ctx.fillStyle = col;
  rr(x - 11, y - 38, 22, 30, 5); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 30);
  ctx.lineTo(x - 20 - wind * 12, y - 34 + wind * 22);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 9, y - 30); ctx.lineTo(x + 18, y - 20); ctx.stroke();
  ctx.strokeStyle = '#20303f';
  ctx.beginPath(); ctx.moveTo(x - 4, y - 8); ctx.lineTo(x - 9, y + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 4, y - 8); ctx.lineTo(x + 10, y + 8); ctx.stroke();
  ctx.restore();
}

function drawBatterFigure() {
  const swing = S.pitch && S.pitch.swung ? clamp((S.pitch.t - S.pitch.swingT) / 0.16, 0, 1) : 0;
  const x = 320, y = 560;
  const col = offTeam().color;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 10, 34, 9, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#f0d9b5';
  ctx.beginPath(); ctx.arc(x, y - 96, 14, 0, 7); ctx.fill();
  ctx.fillStyle = '#1d2b38';
  ctx.beginPath(); ctx.arc(x, y - 100, 15, Math.PI, 0); ctx.fill();
  ctx.fillStyle = col;
  rr(x - 17, y - 84, 34, 48, 8); ctx.fill();
  ctx.fillStyle = '#20303f';
  rr(x - 16, y - 38, 13, 44, 5); ctx.fill();
  rr(x + 3, y - 38, 13, 44, 5); ctx.fill();
  /* バット */
  const a = lerp(-1.15, 1.5, swing);
  ctx.save();
  ctx.translate(x + 12, y - 70);
  ctx.rotate(a);
  ctx.strokeStyle = '#c8a165'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -66); ctx.stroke();
  ctx.restore();
  if (swing > 0 && swing < 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x + 12, y - 70, 62, -1.15 - 1.57, a - 1.57); ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   フィールドビュー
   ============================================================ */
function drawFieldView() {
  ctx.fillStyle = '#1b3b26';
  ctx.fillRect(0, 92, W, H - 92);

  /* 外野の芝（フェンス内） */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fx(0), fy(0));
  for (let a = -45; a <= 45; a += 3) {
    const d = fenceDist(a);
    ctx.lineTo(fx(Math.sin(a * DEG) * d), fy(Math.cos(a * DEG) * d));
  }
  ctx.closePath();
  ctx.fillStyle = '#2f6d3f'; ctx.fill();
  /* 芝の縞 */
  ctx.clip();
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.030)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(0, fy(i * 9 + 9), W, 9 * FSC);
  }
  ctx.restore();

  /* 内野の土（マウンドを中心とした円弧） */
  const MC = { x: 0, y: 18.4 }, MR = 29;
  ctx.beginPath();
  for (let a = 225; a >= -45; a -= 3) {
    const px = MC.x + Math.cos(a * DEG) * MR;
    const py = MC.y + Math.sin(a * DEG) * MR;
    if (a === 225) ctx.moveTo(fx(px), fy(py)); else ctx.lineTo(fx(px), fy(py));
  }
  ctx.lineTo(fx(0), fy(-1.5));
  ctx.closePath();
  ctx.fillStyle = '#8a6236'; ctx.fill();

  /* 内野の芝（ダイヤモンドの内側） */
  ctx.beginPath();
  ctx.moveTo(fx(0), fy(7));
  ctx.lineTo(fx(15), fy(20.5)); ctx.lineTo(fx(0), fy(34)); ctx.lineTo(fx(-15), fy(20.5));
  ctx.closePath();
  ctx.fillStyle = '#2f6d3f'; ctx.fill();

  /* ベースパス */
  ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx(0), fy(0));
  ctx.lineTo(fx(19.4), fy(19.4)); ctx.lineTo(fx(0), fy(38.8)); ctx.lineTo(fx(-19.4), fy(19.4));
  ctx.closePath(); ctx.stroke();

  /* マウンド */
  ctx.beginPath(); ctx.arc(fx(0), fy(18.4), 4.5 * FSC, 0, 7);
  ctx.fillStyle = '#966d3d'; ctx.fill();

  /* 本塁周りの土 */
  ctx.beginPath(); ctx.arc(fx(0), fy(0), 4 * FSC, 0, 7);
  ctx.fillStyle = '#8a6236'; ctx.fill();

  /* ファウルライン */
  ctx.strokeStyle = 'rgba(255,255,255,0.72)'; ctx.lineWidth = 2;
  [-45, 45].forEach(a => {
    ctx.beginPath();
    ctx.moveTo(fx(0), fy(0));
    ctx.lineTo(fx(Math.sin(a * DEG) * fenceDist(a)), fy(Math.cos(a * DEG) * fenceDist(a)));
    ctx.stroke();
  });
  /* フェンス */
  ctx.strokeStyle = '#c9d6e0'; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let a = -45; a <= 45; a += 2) {
    const d = fenceDist(a);
    const px = fx(Math.sin(a * DEG) * d), py = fy(Math.cos(a * DEG) * d);
    if (a === -45) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  /* ベース */
  ctx.fillStyle = '#f5f5f5';
  BASE_POS.forEach((b, i) => {
    const px = fx(b.x), py = fy(b.y);
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  });

  /* 野手 */
  const play = S.play;
  FIELDERS.forEach((f, i) => {
    let px = f.x, py = f.y;
    if (play && play.fielderIdx === i && play.res.type !== 'HR') {
      const pr = clamp(play.t / Math.max(0.2, play.flight), 0, 1);
      px = lerp(play.fielderFrom.x, play.ballTo.x, pr);
      py = lerp(play.fielderFrom.y, play.ballTo.y, pr);
    }
    ctx.beginPath(); ctx.arc(fx(px), fy(py), 8, 0, 7);
    ctx.fillStyle = defTeam().color; ctx.fill();
    ctx.strokeStyle = '#0d1620'; ctx.lineWidth = 1.5; ctx.stroke();
    txt(f.p, fx(px), fy(py) + 4, 10, '#fff', 'center');
  });

  /* 走者 */
  drawRunners();

  /* 打球 */
  if (play && play.phase === 'flight') drawBallInPlay(play);
}

function basePoint(idx) {
  if (idx < 0 || idx === 3) return { x: 0, y: 0 };
  return BASE_POS[idx];
}

function drawRunners() {
  const col = offTeam().color;
  const dot = (mx, my, out, label) => {
    ctx.beginPath(); ctx.arc(fx(mx), fy(my), 7, 0, 7);
    ctx.fillStyle = out ? '#6b7784' : col; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    if (label) txt(label, fx(mx), fy(my) - 12, 10, '#fff', 'center');
  };

  if (S.scene === 'result' && S.runners.length) {
    const t = clamp(S.runnerT, 0, 1);
    S.runners.forEach(r => {
      const a = basePoint(r.from), b = basePoint(r.to);
      const e = t * t * (3 - 2 * t);
      dot(lerp(a.x, b.x, e), lerp(a.y, b.y, e), r.out && t > 0.85);
    });
    return;
  }

  [0, 1, 2].forEach(i => { if (S.bases[i]) dot(BASE_POS[i].x, BASE_POS[i].y); });
  if (S.play && S.play.phase === 'flight') {
    const pr = clamp(S.play.t / Math.max(0.3, S.play.flight), 0, 1);
    const b = BASE_POS[0];
    dot(lerp(0, b.x, pr * 0.8), lerp(0, b.y, pr * 0.8));
  }
}

function drawBallInPlay(play) {
  const pr = clamp(play.t / play.flight, 0, 1);
  const res = play.res;
  const isHR = res.type === 'HR';
  const far = isHR ? { x: res.land.x * 1.22, y: res.land.y * 1.22 } : play.ballTo;
  const bx = lerp(0, far.x, pr), by = lerp(0, far.y, pr);
  const grounder = res.launch <= 6;
  const hgt = grounder ? 0.6 : Math.sin(pr * Math.PI) * (res.dist * Math.tan(clamp(res.launch, 5, 60) * DEG) / 3.4);

  /* 影 */
  ctx.beginPath(); ctx.ellipse(fx(bx), fy(by), 4, 2.4, 0, 0, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  /* ボール */
  const py = fy(by) - hgt * FSC * 0.9;
  ctx.beginPath(); ctx.arc(fx(bx), py, 5 + hgt * 0.05, 0, 7);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = '#b34141'; ctx.lineWidth = 1.2; ctx.stroke();
}

/* ============================================================
   オーバーレイ（メッセージ・バナー・ログ）
   ============================================================ */
function drawOverlay() {
  /* 打席ログ */
  ctx.save();
  ctx.globalAlpha = 0.85;
  S.log.forEach((l, i) => {
    txt(l, W - 24, 128 + i * 17, 11, i === 0 ? '#e8eef5' : 'rgba(200,215,228,' + (0.7 - i * 0.13) + ')', 'right', 'normal');
  });
  ctx.restore();

  /* 球種表示 */
  if (S.pitch && (S.scene === 'pitch' || (S.scene === 'result' && S.cameFrom === 'batter'))) {
    const p = S.pitch;
    const show = p.done || p.t >= p.dur;
    if (show) {
      ctx.fillStyle = 'rgba(8,16,24,0.72)';
      rr(W / 2 - 78, 104, 156, 34, 6); ctx.fill();
      txt(p.pt.name, W / 2 - 8, 127, 15, '#ffd34d', 'right');
      txt(p.velo + ' km/h', W / 2 + 70, 127, 13, '#c2d4e2', 'right');
    }
  }

  /* 中央メッセージ */
  if (S.msg && S.msgTimer > 0) {
    const a = clamp(S.msgTimer * 3, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    const big = ['ホームラン!!', 'ヒット!', 'ツーベース!', 'スリーベース!!', '三振!', '見逃し三振!'].indexOf(S.msg) >= 0;
    const size = big ? 46 : 34;
    ctx.fillStyle = 'rgba(8,16,24,0.66)';
    const w = Math.max(260, S.msg.length * size * 0.68 + 60);
    rr(W / 2 - w / 2, 250, w, S.msgSub ? 104 : 76, 10); ctx.fill();
    txt(S.msg, W / 2, 306, size, big ? '#ffd34d' : '#fff', 'center');
    if (S.msgSub) txt(S.msgSub, W / 2, 336, 18, '#8ee36b', 'center');
    ctx.restore();
  }

  /* イニングバナー */
  if (S.banner && S.bannerTimer > 0) {
    const a = clamp(S.bannerTimer * 2.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,16,24,0.86)';
    ctx.fillRect(0, 280, W, 84);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(0, 280, W, 3); ctx.fillRect(0, 361, W, 3);
    txt(S.banner, W / 2, 332, 30, '#fff', 'center');
    ctx.restore();
  }
}

function drawControlHint() {
  const y = H - 14;
  let s;
  if (S.scene === 'ready' || S.scene === 'pitch') {
    s = userIsBatting()
      ? '← ↑ → ↓ カーソル   スペース スイング   Z ' + (S.swingMode === 'power' ? '強振' : 'ミート') + '   X バント'
      : '1〜' + curPitcher().pitches.length + ' 球種   ← ↑ → ↓ コース   スペース 投球';
  } else s = '';
  if (s) txt(s, W / 2, y, 12, 'rgba(200,215,228,0.8)', 'center', 'normal');
}

/* ============================================================
   タイトル / 結果画面
   ============================================================ */
const TITLE_ROWS = ['team', 'side', 'innings', 'mode', 'start'];

function drawTitle() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0f2233'); g.addColorStop(1, '#123024');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  txt('⚾ パワフル野球', W / 2, 128, 54, '#ffd34d', 'center');
  txt('か ん た ん 版', W / 2, 162, 18, '#8ee36b', 'center');

  const t = S.title;
  const rows = [
    { label: 'チーム', value: TEAM_DEFS[t.team].name, color: TEAM_DEFS[t.team].color },
    { label: '先攻/後攻', value: t.side === 0 ? '先攻（表から攻撃）' : '後攻（裏から攻撃）' },
    { label: 'イニング', value: t.innings + ' 回制' },
    { label: 'モード', value: t.mode === 'full' ? '攻守（投げて打つ）' : '打撃のみ（守備おまかせ）' },
    { label: '', value: '▶ 試合開始' }
  ];
  rows.forEach((r, i) => {
    const y = 244 + i * 52;
    const sel = t.cursor === i;
    if (sel) {
      ctx.fillStyle = 'rgba(255,211,77,0.14)';
      rr(232, y - 28, 496, 42, 8); ctx.fill();
      ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
      rr(232, y - 28, 496, 42, 8); ctx.stroke();
    }
    if (r.label) {
      txt(r.label, 268, y, 15, sel ? '#ffd34d' : '#9fb3c4');
      txt(sel ? '◀ ' + r.value + ' ▶' : r.value, 692, y, 17, r.color || '#fff', 'right');
    } else {
      txt(r.value, W / 2, y, 20, sel ? '#ffd34d' : '#c2d4e2', 'center');
    }
  });

  txt('↑↓ 選択   ←→ 変更   スペース/Enter 決定', W / 2, 560, 13, '#7fa8c9', 'center', 'normal');
  txt('対戦相手はランダムに決まります', W / 2, 586, 12, '#5b7a95', 'center', 'normal');
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(6,12,18,0.9)';
  ctx.fillRect(0, 92, W, H - 92);
  txt('試合終了', W / 2, 168, 40, '#ffd34d', 'center');
  if (S.walkoff) txt('サヨナラ!!', W / 2, 202, 20, '#ff9f43', 'center');
  txt(S.resultText, W / 2, 236, 26, '#fff', 'center');
  txt(S.teams[0].name + ' ' + S.teams[0].runs + ' - ' + S.teams[1].runs + ' ' + S.teams[1].name,
      W / 2, 272, 20, '#c2d4e2', 'center');

  /* 打撃成績 */
  const me = S.teams[S.userSide];
  txt(me.name + ' 打撃成績', W / 2, 316, 15, '#8ee36b', 'center');
  const x0 = 250;
  txt('打者', x0, 340, 11, '#7fa8c9');
  ['打数', '安打', '本', '点'].forEach((h, i) => txt(h, x0 + 200 + i * 60, 340, 11, '#7fa8c9', 'center'));
  me.batters.forEach((b, i) => {
    const y = 362 + i * 20;
    txt(b.order + ' ' + b.pos + ' ' + b.name, x0, y, 13, '#e8eef5', 'left', 'normal');
    [b.ab, b.h, b.hr, b.rbi].forEach((v, j) =>
      txt(String(v), x0 + 200 + j * 60, y, 13, j === 0 ? '#c2d4e2' : (v > 0 ? '#ffd34d' : '#8899a8'), 'center', 'normal'));
  });
  txt('スペース / Enter でタイトルへ', W / 2, H - 26, 13, '#7fa8c9', 'center', 'normal');
}

/* ============================================================
   入力
   ============================================================ */
const keys = Object.create(null);
const userPitching = () => S.mode === 'full' && !userIsBatting();

window.addEventListener('keydown', e => {
  const k = e.key;
  if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].indexOf(k) >= 0) e.preventDefault();
  if (keys[k]) return;                 // オートリピート抑止
  keys[k] = true;
  onKeyDown(k);
});
window.addEventListener('keyup', e => { keys[e.key] = false; });
cv.addEventListener('mousedown', () => cv.focus());

function onKeyDown(k) {
  if (k === 'm' || k === 'M') { sfxOn = !sfxOn; return; }

  if (S.scene === 'title') {
    const t = S.title;
    if (k === 'ArrowUp') { t.cursor = (t.cursor + TITLE_ROWS.length - 1) % TITLE_ROWS.length; SFX.cursor(); }
    else if (k === 'ArrowDown') { t.cursor = (t.cursor + 1) % TITLE_ROWS.length; SFX.cursor(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const d = k === 'ArrowRight' ? 1 : -1;
      const row = TITLE_ROWS[t.cursor];
      if (row === 'team') t.team = (t.team + d + TEAM_DEFS.length) % TEAM_DEFS.length;
      else if (row === 'side') t.side = t.side === 0 ? 1 : 0;
      else if (row === 'innings') { const opts = [1, 3, 6, 9]; let i = opts.indexOf(t.innings); t.innings = opts[(i + d + opts.length) % opts.length]; }
      else if (row === 'mode') t.mode = t.mode === 'full' ? 'bat' : 'full';
      SFX.cursor();
    } else if (k === ' ' || k === 'Enter') {
      if (TITLE_ROWS[t.cursor] === 'start') { SFX.select(); startGame(); }
      else { t.cursor = (t.cursor + 1) % TITLE_ROWS.length; SFX.cursor(); }
    }
    return;
  }

  if (k === 'r' || k === 'R') { S.scene = 'title'; return; }

  if (k === ' ' || k === 'Enter') {
    if (S.scene === 'result') { S.msgTimer = Math.min(S.msgTimer, 0.04); return; }
    if (S.scene === 'inningbreak') { S.bannerTimer = 0; return; }
  }

  if (S.scene === 'gameover') {
    if (k === ' ' || k === 'Enter') S.scene = 'title';
    return;
  }

  /* --- 打撃 --- */
  if (userIsBatting()) {
    if (k === 'z' || k === 'Z') {
      S.swingMode = S.swingMode === 'power' ? 'meet' : 'power';
      S.bunt = false; SFX.cursor(); return;
    }
    if (k === 'x' || k === 'X') { S.bunt = !S.bunt; SFX.cursor(); return; }
    if (k === ' ' && S.scene === 'pitch') {
      if (S.bunt) doBunt(S.cursor.x, S.cursor.y);
      else doSwing(S.cursor.x, S.cursor.y, S.swingMode);
    }
    return;
  }

  /* --- 投球 --- */
  if (userPitching() && S.scene === 'ready' && S.bannerTimer <= 0) {
    const p = curPitcher();
    const n = parseInt(k, 10);
    if (n >= 1 && n <= p.pitches.length) { S.aimPitch = n - 1; SFX.cursor(); return; }
    if (k === ' ') { throwPitch(p.pitches[S.aimPitch] || 'straight', S.aim.x, S.aim.y); }
  }
}

function handleHeldKeys(dt) {
  const spd = 330 * dt;
  let dx = 0, dy = 0;
  if (keys['ArrowLeft']) dx -= spd;
  if (keys['ArrowRight']) dx += spd;
  if (keys['ArrowUp']) dy -= spd;
  if (keys['ArrowDown']) dy += spd;
  if (!dx && !dy) return;

  if (userIsBatting() && (S.scene === 'ready' || S.scene === 'pitch')) {
    S.cursor.x = clamp(S.cursor.x + dx, ZX - ZW / 2 - 105, ZX + ZW / 2 + 105);
    S.cursor.y = clamp(S.cursor.y + dy, ZY - ZH / 2 - 90, ZY + ZH / 2 + 90);
  } else if (userPitching() && S.scene === 'ready') {
    S.aim.x = clamp(S.aim.x + dx, ZX - ZW / 2 - 60, ZX + ZW / 2 + 60);
    S.aim.y = clamp(S.aim.y + dy, ZY - ZH / 2 - 55, ZY + ZH / 2 + 55);
  }
}

/* ============================================================
   更新
   ============================================================ */
function update(dt) {
  if (S.bannerTimer > 0) S.bannerTimer -= dt;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 26);
  if (S.scene === 'title' || S.scene === 'gameover') return;
  handleHeldKeys(dt);

  switch (S.scene) {
    case 'ready': {
      if (!userPitching()) {
        S.readyTimer -= dt;
        if (S.readyTimer <= 0 && S.bannerTimer <= 0) cpuPitchChoice();
      }
      break;
    }
    case 'pitch': {
      const p = S.pitch;
      p.t += dt;
      if (!userIsBatting() && p.cpuSwing && !p.swung && p.t >= p.cpuSwing.at) {
        doSwing(p.cpuSwing.cx, p.cpuSwing.cy, p.cpuSwing.mode);
      }
      if (!p.done && !p.swung && p.t > p.dur * 1.14) {
        SFX.mitt();
        p.result = 'take';
        finishPitch();
      }
      break;
    }
    case 'play': {
      const pl = S.play;
      pl.t += dt;
      if (pl.t >= pl.flight) {
        pl.phase = 'done';
        if (pl.res.type === 'foul') { addLog(S.batter.name + ': ファウル'); countFoul(); }
        else resolvePlay(pl.res);
      }
      break;
    }
    case 'result': {
      S.runnerT = (S.runnerT || 0) + dt / 0.75;
      S.msgTimer -= dt;
      if (S.msgTimer <= 0) {
        const fn = S.after; S.after = null; S.msg = null;
        S.play = null;
        if (fn) fn();
      }
      break;
    }
    case 'inningbreak': {
      if (S.bannerTimer <= 0) {
        S.play = null;
        nextBatter();
      }
      break;
    }
  }
}

/* ============================================================
   描画
   ============================================================ */
function render() {
  ctx.clearRect(0, 0, W, H);
  if (S.scene === 'title') { drawTitle(); return; }

  ctx.save();
  if (S.shake > 0) ctx.translate(rnd(-S.shake, S.shake) * 0.5, rnd(-S.shake, S.shake) * 0.5);
  if (S.cameFrom === 'field') drawFieldView(); else drawBatterView();
  ctx.restore();

  drawScoreboard();
  drawCount();
  drawBatterCard();
  drawPitcherCard();
  if (userPitching() && (S.scene === 'ready' || S.scene === 'pitch')) drawPitchMenu();
  drawOverlay();
  drawControlHint();
  if (S.scene === 'gameover') drawGameOver();
}

function drawPitchMenu() {
  const p = curPitcher();
  const x = 24, y = 200;
  ctx.fillStyle = 'rgba(8,16,24,0.72)';
  rr(x, y, 148, 26 + p.pitches.length * 22, 8); ctx.fill();
  txt('球種', x + 12, y + 20, 11, '#9fb3c4');
  p.pitches.forEach((k, i) => {
    const sel = i === S.aimPitch;
    const yy = y + 40 + i * 22;
    if (sel) { ctx.fillStyle = 'rgba(255,211,77,0.18)'; rr(x + 6, yy - 14, 136, 20, 4); ctx.fill(); }
    txt((i + 1) + '.', x + 12, yy, 12, sel ? '#ffd34d' : '#7fa8c9');
    txt(PITCH_TYPES[k].name, x + 34, yy, 13, sel ? '#fff' : '#c2d4e2');
  });
}

/* ============================================================
   メインループ
   ============================================================ */
let last = 0;
function loop(ts) {
  if (!last) last = ts;
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
cv.focus();
