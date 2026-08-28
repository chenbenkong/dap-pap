// ============================================================
// 立体课本 · 导弹实验台 — 总控
// 章节 · UI · 标注 · 遥测 · 相机导演 · 主循环
// ============================================================
import * as THREE from 'three';
import { createScene } from './scene';
import { buildMissile } from './parts';
import { Plume, Trail, Boom, buildShip } from './effects';
import { StrikeSim, MissionSim, predictedIntercept } from './flight';

const $ = s => document.querySelector(s);
if (window.__MLAB_BOOTED) {
  throw new Error('[导弹实验台] 检测到重复初始化，已跳过本次启动。');
}
window.__MLAB_BOOTED = true;
const app = $('#appCanvasWrap');
const DEG = Math.PI / 180;

/* ============================================================ */
/*                       应 用 状 态                             */
/* ============================================================ */
const S = {
  chapter: 1,
  labelsOn: true, spinOn: false, cutawayOn: false,
  explore: .0,            // 爆炸度
  // 试车
  burning: false, clock: 0, BURN_T: 7.0, curProfile: 0, manualScrub: false,
  burnChart: [],
  // 追击
  strikeState: 'idle',
  // 任务
  missionPlaying: false, mt: 0, spd: 1, missionEnded: false,
};

/* ============================================================ */
/*                   场景与模型装配                               */
/* ============================================================ */
let viewer, M, plumeHangar;
let flyMissile = null, plumeWorld = null, shipMesh = null, losLine = null, predictRing = null;
let markerSprite = null, aimMark = null, planPath = null, trail = null, boom = null;
let clipPlane = null;
const strikeSim = new StrikeSim();
const missionSim = new MissionSim();
const HANGAR_Y = 5.15;

/* ---------- 标注层 ---------- */
const lblLayer = $('#labels'), svg = $('#leaderSvg');
const NS = 'http://www.w3.org/2000/svg';
svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight);
addEventListener('resize', () => { svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight); });

function makeLabel(titleEN, titleCN, hot = false) {
  const el = document.createElement('div');
  el.className = 'lbl'; if (hot) el.classList.add('hot');
  el.innerHTML = `${titleCN}<small>${titleEN}</small>`;
  lblLayer.appendChild(el);
  const ln = document.createElementNS(NS, 'line');
  ln.setAttribute('stroke', hot ? 'rgba(111,199,232,.65)' : 'rgba(255,180,84,.55)');
  ln.setAttribute('stroke-width', '1'); ln.style.display = 'none';
  svg.appendChild(ln);
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', '2.4'); dot.setAttribute('fill', hot ? '#6fc7e8' : '#ffb454');
  dot.style.display = 'none';
  svg.appendChild(dot);
  return { el, ln, dot };
}
const partLabels = {};
let extraLabelAim = null;   // 在 boot() 内、M 就绪后再填充

const _wp = new THREE.Vector3();

function projectToScreen(v3) {
  _wp.copy(v3).project(viewer.camera);
  if (_wp.z > 1 || _wp.z < -1) return null;
  return {
    x: (_wp.x * .5 + .5) * innerWidth,
    y: (-_wp.y * .5 + .5) * innerHeight,
    z: _wp.z,
  };
}
function updateLabels(dt) {
  const show = S.labelsOn && (S.chapter === 1 || S.chapter === 2);
  const focusKey = window.__focusPart?.key ?? null;
  let anyVisible = false;
  if (show) {
    // 先收集可见标签 → 屏幕纵序 → 左右交替 + 纵向推挤防重叠
    const items = [];
    for (const k of M.order) {
      const part = M.parts[k], lab = partLabels[k];
      part.anchor.getWorldPosition(_wp);
      const sp = projectToScreen(_wp);
      const dCam = viewer.camera.position.distanceTo(_wp);
      const vis = !!sp && dCam < 26 && (S.explore > .12 || dCam < 15);
      lab.el.style.opacity = vis ? '1' : '0';
      lab.el.classList.toggle('hot', focusKey === k);
      if (vis) items.push({ k, lab, sp });
      else { lab.ln.style.display = 'none'; lab.dot.style.display = 'none'; }
    }
    items.sort((a, b) => a.sp.y - b.sp.y);
    let prevY = -1e9;
    items.forEach((it, i) => {
      const lab = it.lab, sp = it.sp;
      let ly = sp.y - 34;                       // 标签中心默认在锚点上方
      if (ly < prevY + 30) ly = prevY + 30;     // 纵向推挤
      prevY = ly;
      const lx = sp.x + (i % 2 === 0 ? -92 : 92); // 左右交替
      anyVisible = true;
      lab.el.style.left = lx + 'px';
      lab.el.style.top = ly + 'px';
      lab.ln.style.display = ''; lab.dot.style.display = '';
      lab.ln.setAttribute('x1', sp.x); lab.ln.setAttribute('y1', sp.y);
      lab.ln.setAttribute('x2', lx); lab.ln.setAttribute('y2', ly + 13);
      lab.dot.setAttribute('cx', sp.x); lab.dot.setAttribute('cy', sp.y);
    });
  }
  if (!show || !anyVisible) {
    for (const k of M.order) {
      const lab = partLabels[k];
      lab.ln.style.display = 'none';
      lab.dot.style.display = 'none';
    }
  }
  if (!show) {
    for (const k of M.order) partLabels[k].el.style.opacity = '0';
  }
}

/* ============================================================ */
/*                        UI 引 擎                                */
/* ============================================================ */
const ui = {};

function chip(el, txt, cls = '') { el.textContent = txt; el.className = `state-chip ${cls}`; }

/* ---------- 数据面板: 部件档案卡 ---------- */
function buildPartsCards() {
  const wrap = $('#tabParts'); wrap.innerHTML = '';
  for (const k of M.order) {
    const p = M.parts[k];
    const c = document.createElement('button');
    c.className = 'station-card';
    c.dataset.key = k;
    c.innerHTML = `
      <div class="station-name"><span class="dot"></span>${p.name}</div>
      <div class="station-note">${p.note}</div>
      <table class="spec-table">${p.specs.map(s => `<tr><td>${s[0]}</td><td>${s[1]}</td></tr>`).join('')}</table>
      <div class="station-detail">${p.desc}</div>`;
    c.addEventListener('click', () => selectPart(k, { fly: true }));
    wrap.appendChild(c);
  }
}

/* ---------- 数据面板: 遥测模板 ---------- */
function teleTemplate(kind) {
  const teleBox = $('#tabTele');
  if (kind === 'strike') {
    teleBox.innerHTML = `
      <div class="phase-strip"><span class="phase-badge" id="stBadge">搜索</span>
        <span class="phase-note" id="stNote">导引头正在截获目标…</span></div>
      <div class="tele-grid">
        <div class="tele-cell hi"><small>弹目距离</small><b><span id="tDist">—</span><i>m</i></b></div>
        <div class="tele-cell"><small>接近速度</small><b><span id="tClose">—</span><i>m/s</i></b></div>
        <div class="tele-cell"><small>指令过载</small><b><span id="tG">—</span><i>g</i></b></div>
        <div class="tele-cell"><small>飞行马赫</small><b><span id="tMach">—</span><i>Ma</i></b></div>
      </div>
      <div class="mini-canvas-wrap"><h4>制导律 · 比例导引 a = N·Vc·λ̇</h4>
        <canvas id="pnCanvas"></canvas></div>
      <div class="station-card open" style="cursor:default">
        <div class="station-name">为什么“转得越快越危险”？</div>
        <div class="station-detail" style="display:block">若视线在旋转（λ̇≠0），说明导弹没有正对前置碰撞点。比例导引以 <b>N·Vc·λ̇</b> 下达侧向指令，把视线转率<strong style="color:#57d294">压向零</strong>——视线一旦平直，弹目必然相遇。</div>
      </div>`;
  } else {
    teleBox.innerHTML = `
      <div class="phase-strip"><span class="phase-badge" id="msBadge">待发射</span>
        <span class="phase-note" id="msNote">按下发射，沿时间轴回放全程。</span></div>
      <div class="tele-grid">
        <div class="tele-cell hi"><small>T+</small><b><span id="tTime">00.0</span><i>s</i></b></div>
        <div class="tele-cell hi"><small>高度</small><b><span id="tAlt">0.0</span><i>km</i></b></div>
        <div class="tele-cell"><small>速度</small><b><span id="tSpd">0</span><i>m/s</i></b></div>
        <div class="tele-cell"><small>马赫</small><b><span id="tMach2">0.00</span><i>Ma</i></b></div>
        <div class="tele-cell"><small>射程</small><b><span id="tRng">0.0</span><i>km</i></b></div>
        <div class="tele-cell"><small>过载</small><b><span id="tGm">0.0</span><i>g</i></b></div>
      </div>
      <div class="mini-canvas-wrap"><h4>速度—高度剖面（示意）</h4><canvas id="profCanvas"></canvas></div>
      <div class="mini-canvas-wrap"><h4>速度色标</h4>
        <canvas id="legendCv" style="height:26px"></canvas></div>`;
  }
}

/* ---------- 小图表 ---------- */
const charts = { pn: null };
function drawPNChart() {
  const cv = $('#pnCanvas'); if (!cv) return;
  const dpr = Math.min(devicePixelRatio, 2);
  if (!charts.pn) { charts.pn = { hist: [] }; }
  const ctx = cvsCtx(cv, dpr);
  if (!ctx.c) return;
  const { W, H } = ctx;
  ctx.c.clearRect(0, 0, W, H);
  // 背景
  ctx.c.fillStyle = 'rgba(20,38,63,.25)'; ctx.c.fillRect(0, 0, W, H);
  const hist = charts.pn.hist;
  ctx.c.strokeStyle = '#ffb454'; ctx.c.lineWidth = 1.6; ctx.c.beginPath();
  const n = hist.length;
  for (let i = 0; i < n; i++) {
    const x = W - Math.min(i, 170) * (W / 170);
    const y = H - Math.min(hist[n - 1 - i] / 17, 1) * (H - 8) - 4;
    i ? ctx.c.lineTo(x, y) : ctx.c.moveTo(x, y);
    if (i >= 170) break;
  }
  ctx.c.stroke();
  ctx.c.fillStyle = '#8fa3bd'; ctx.c.font = '9px monospace';
  ctx.c.fillText('g', 4, 11); ctx.c.fillText('17g', 4, H - 18); ctx.c.fillText('-3s', W - 22, H - 4);
}
function cvsCtx(cv, dpr) {
  const rect = cv.getBoundingClientRect();
  if (rect.width < 4) return {};
  cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  return { c, W: rect.width, H: rect.height };
}
function drawProfileChart() {
  const cv = $('#profCanvas'); if (!cv) return;
  if (!missionSim.samples.length) return;
  const Sm = missionSim.samples;
  const dpr = Math.min(devicePixelRatio, 2);
  const info = cvsCtx(cv, dpr); if (!info.c) return;
  const { c, W, H } = info;
  c.clearRect(0, 0, W, H);
  const maxAlt = Math.max(...Sm.map(s => s.py)) * 1.12;
  const maxV = Math.max(...Sm.map(s => s.v)) * 1.12;
  const phCol = ['#ffb454', '#57d294', '#ff6161', '#ff6161'];
  // 高度填充
  c.beginPath(); c.moveTo(0, H);
  Sm.forEach((s, i) => { c.lineTo(i / (Sm.length - 1) * W, H - s.py / maxAlt * (H - 14)); });
  c.lineTo(W, H); c.closePath();
  c.fillStyle = 'rgba(111,199,232,.16)'; c.fill();
  // 分相着色的速度线
  c.lineWidth = 1.8;
  for (let ph = 0; ph <= 3; ph++) {
    c.strokeStyle = phCol[ph]; c.beginPath(); let started = false;
    Sm.forEach((s, i) => {
      if (s.ph !== ph) return;
      const x = i / (Sm.length - 1) * W, y = H - s.v / maxV * (H - 14) - 2;
      started ? c.lineTo(x, y) : (c.moveTo(x, y), started = true);
    });
    if (started) c.stroke();
  }
  // 图例
  c.font = '9px monospace'; c.fillStyle = '#8fa3bd';
  c.fillText('高度', 5, 11); c.fillText('速度(分相)', W - 62, 11);
}
function drawLegend() {
  const cv = $('#legendCv'); if (!cv) return;
  const info = cvsCtx(cv, Math.min(devicePixelRatio, 2)); if (!info.c) return;
  const { c, W, H } = info;
  const g = c.createLinearGradient(0, 0, W, 0);
  const cols = ['#6fc7e8', '#cfeffc', '#ffd9a0', '#ffb454'];
  cols.forEach((col, i) => g.addColorStop(i / 3, col));
  c.fillStyle = g; c.fillRect(0, 6, W, 8);
  c.font = '9px monospace'; c.fillStyle = '#8fa3bd';
  c.fillText('260m/s', 2, H - 1); c.fillText('1250m/s', W - 44, H - 1);
}

/* ============================================================ */
/*                     章 节 调 度                                */
/* ============================================================ */
const CHAPTERS = [
  { tag: '第 1 章', en: 'CHAPTER 01', big: '结构解剖', title: '认识一枚导弹' },
  { tag: '第 2 章', en: 'CHAPTER 02', big: '动力原理', title: '推力从哪里来' },
  { tag: '第 3 章', en: 'CHAPTER 03', big: '制导追击', title: '如何咬住目标' },
  { tag: '第 4 章', en: 'CHAPTER 04', big: '全程弹道', title: '从点火到命中' },
];
window.__focusPart = { key: null };

function goChapter(n, opts = {}) {
  n = Math.max(1, Math.min(4, n));
  const changed = n !== S.chapter;
  S.chapter = n;
  const C = CHAPTERS[n - 1];
  $('#chTag').textContent = C.tag;
  $('#chTitle').textContent = C.title;
  $('#chGoal').textContent = [
    '拖动爆炸滑杆拆开导弹，或直接点击部件查看档案。',
    '点火试车：看药柱退移、推力曲线和喷管里的燃气。',
    '对手开始机动！观察视线连线被比例导引“拉直”的过程。',
    '发射！拖动时间轴回放助推—中段—末段的全过程。'
  ][n - 1];

  // 桌面分组显隐
  $('#grpModel').style.display = (n <= 2) ? '' : 'none';
  $('#grpMotor').style.display = n === 2 ? '' : 'none';
  $('#grpStrike').style.display = n === 3 ? '' : 'none';
  $('#grpMission').style.display = n === 4 ? '' : 'none';

  // 章节闪现动画
  if (changed || opts.flash) {
    $('#mfSub').textContent = C.en; $('#mfBig').textContent = C.big;
    const mf = $('#modeFlash');
    mf.classList.remove('show'); void mf.offsetWidth; mf.classList.add('show');
    setTimeout(() => mf.classList.remove('show'), 1500);
  }

  // 场景模式切换
  stopAllSims();
  if (n <= 2) {
    viewer.setWorldMode(false);
    if (n === 2) viewer.flyCam([3.6, HANGAR_Y - 2.9, 7.8], [0, HANGAR_Y - 3.3, 0]);   // 试车台: 喷管侧后特写
    else viewer.flyCam([5.8 * (S.spinOn ? -1 : 1), HANGAR_Y + 1.5 + S.explore * .5, 11.4], [0, HANGAR_Y + .15 + S.explore * 1.2]);
    setPanelTab('parts', n === 1 ? '部件档案 · 整弹视图' : '部件档案 · 试车台');
  } else if (n === 3) {
    enterStrike(opts.snap !== false);
    setPanelTab('tele', '追击遥测 · 拦截演示');
  } else {
    enterMission(opts.snap !== false);
    setPanelTab('tele', '任务遥测 · 全弹道');
  }

  // 提示条文案
  $('#hintDrag').textContent = n <= 2 ? '拖动旋转 · 滚轮缩放' : '镜头自动驾驶中';
  $('#hintClick').textContent = n <= 2 ? '点击部件查看详情' : (n === 3 ? '视线连续线=导航的输入' : '时间轴可拖拽回放');

  $('#panelRail') && ($('#panelRail').style.display = '');
  try { localStorage.setItem('mlab_ch', String(n)); } catch (e) { /* 隐私模式忽略 */ }
}

function setPanelTab(tab, unitText) {
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tabParts').style.display = tab === 'parts' ? '' : 'none';
  $('#tabTele').style.display = tab === 'tele' ? '' : 'none';
  if (unitText) $('#panelHeadUnit').textContent = unitText;
  if (tab === 'tele') { teleTemplate(S.chapter === 3 ? 'strike' : 'mission'); S.missionChartsDirty = true; }
  else buildPartsCards();
  charts.pn = null;
}

function stopAllSims() {
  // 试车复位可视（保留进度）
  plumeHangar && plumeHangar.setPower(0);
  // 追击清理
  hideStrikeVisuals();
  strikeSim.state = 'ready';
  S.strikeState = 'idle';
  // 任务暂停
  S.missionPlaying = false;
  updatePauseBtn();
}

/* ============================================================ */
/*                 部件选择与高亮                                  */
/* ============================================================ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downXY = null;

addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
addEventListener('pointerup', e => {
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 6 || S.chapter > 2) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && (el.closest('.control-desk') || el.closest('.data-panel') || el.closest('.overlay-top'))) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, viewer.camera);
  const hits = raycaster.intersectObject(M.root, true);
  for (const h of hits) {
    let o = h.object;
    while (o && o !== M.root) {
      if (o.userData.partKey) { selectPart(o.userData.partKey, { fly: e.detail !== 2 }); return; }
      o = o.parent;
    }
  }
});

function selectPart(key, { fly = false } = {}) {
  window.__focusPart.key = key;
  const p = M.parts[key];
  // 卡片态
  document.querySelectorAll('#tabParts .station-card').forEach(c => {
    c.classList.toggle('active', c.dataset.key === key);
    c.classList.toggle('open', c.dataset.key === key);
    if (c.dataset.key === key) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  // 高亮
  M.allMats.forEach(m => { if (m.emissiveIntensity !== undefined && m.userData.baseEm === undefined) m.userData.baseEm = m.emissiveIntensity ?? 0; });
  M.shellMats.forEach(() => {});
  M.parts[key].meshes.forEach(()=>{});
  // 该部件材质发光脉冲
  const grp = p.anchor.parent;
  const mats = new Set();
  grp.traverse(o => { if (o.isMesh && o.material) mats.add(o.material); });
  mats.forEach(m => { m.emissive = m.emissive || new THREE.Color(0); m.emissive.setHex(0xffb454); });
  if (fly) {
    const wp = new THREE.Vector3(); p.anchor.getWorldPosition(wp);
    const dir = viewer.camera.position.clone().sub(wp).normalize();
    const np = wp.clone().addScaledVector(dir, 3.1).add(new THREE.Vector3(0, .5, 0));
    viewer.flyCam([np.x, np.y, np.z], [wp.x, wp.y, wp.z], .9);
  }
  clearTimeout(window.__hlTO);
  window.__hlTO = setTimeout(() => {
    mats.forEach(m => {
      const base = m.userData.baseEm ?? 0;
      m.emissiveIntensity = base;
      if (!m.userData.keepEmissive) m.emissive.setHex(m.name === 'accent' ? 0x593407 : 0x000000);
      if (m.name === 'throat') m.emissive.setHex(0x000000);
    });
    window.__focusPart.key = null;
  }, 2200);
}

/* ============================================================ */
/*           第 2 章 · 固体发动机试车                              */
/* ============================================================ */
function thrustProfile(f) {   // f∈[0,1] 已燃比
  if (f <= 0) return 0;
  if (f < .06) return f / .06 * 1.02;                  // 点火爬升
  if (f < .78) return 1.02 - .34 * Math.sin((f - .06) * Math.PI);   // 平台略降
  const u = (f - .78) / .22;
  return Math.max(0, (1 - u) * .72);                   // 拖尾熄火
}

function setupBurnUI() {
  $('#igniteBtn').addEventListener('click', () => {
    if (S.burning) return;
    if (S.clock >= S.BURN_T) { S.clock = 0; M.updateBurn(0); S.burnChart = []; }
    S.burning = true;
    $('#igniteBtn').textContent = '燃烧中…';
    $('#igniteBtn').classList.add('armed');
    setTimeout(() => $('#igniteBtn').classList.remove('armed'), 1300);
    chip($('#motorChip'), '燃烧 BURNING', 'burn');
  });
  $('#burnSlider').addEventListener('input', e => {
    const v = +e.target.value / 100;
    if (!S.burning) {
      S.clock = v * S.BURN_T;
      M.updateBurn(v);
      const prof = thrustProfile(v);
      plumeHangar.setPower(prof > 0.02 ? Math.max(prof, .18) : 0);
      updateThrustReadout(prof);
      syncRangeFill(e.target);
    }
  });
}

function tickBurn(dt) {
  if (!(S.burning && S.chapter === 2)) return;
  S.clock += dt;
  const f = Math.min(S.clock / S.BURN_T, 1);
  M.updateBurn(f);
  const prof = thrustProfile(f);
  S.curProfile = prof;
  plumeHangar.setPower(Math.max(prof, f >= 1 ? 0 : .12));
  // 喉衬烧热感
  const throatMat = M.allMats.find(m => m.name === 'throat');
  if (throatMat) { throatMat.emissive.setHex(0xff5a1e); throatMat.emissiveIntensity = prof * 1.5; }
  // 读数
  updateThrustReadout(prof);
  // 曲线历史
  S.burnChart.push(f);
  const sl = $('#burnSlider'); sl.value = f * 100; syncRangeFill(sl);
  if (f >= 1) {
    S.burning = false;
    $('#igniteBtn').textContent = '再烧一遍';
    chip($('#motorChip'), '燃尽 BURNOUT', 'fly');
    plumeHangar.setPower(0);
  }
}
let _thrustPeak = 206;   // kN 显示基数
function updateThrustReadout(prof) {
  const F = _thrustPeak * prof;
  $('#thrustVal').textContent = `≈ ${F.toFixed(0)} kN`;
  $('#mdotVal').textContent = `≈ ${(F / (238 * 9.81)).toFixed(1)} kg/s`;
  $('#tbVal').textContent = `${Math.max(0, S.BURN_T - S.clock).toFixed(1)} s`;
  const bv = $('#burnVal'); bv.textContent = `${Math.round(S.clock / S.BURN_T * 100)}%`;
}

/* ============================================================ */
/*              第 3 章 · 追击演示 (视觉接线)                      */
/* ============================================================ */
function ensureStrikeVisuals() {
  if (!boom) { boom = new Boom(viewer.scene); }   // 命中爆炸两组章共用
  if (!shipMesh) {
    shipMesh = buildShip(155);
    viewer.world.add(shipMesh);
    losLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x6fc7e8, transparent: true, opacity: .8 })
    );
    losLine.visible = false; losLine.frustumCulled = false;
    viewer.world.add(losLine);
    predictRing = new THREE.Mesh(
      new THREE.SphereGeometry(30, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffb454, wireframe: true, transparent: true, opacity: .5 })
    );
    predictRing.visible = false;
    viewer.world.add(predictRing);
  }
  if (!flyMissile) {
    flyMissile = M.root.clone(true);
    flyMissile.scale.setScalar(1);
    viewer.world.add(flyMissile);
    plumeWorld = new Plume(findNozzleTip(flyMissile));
    plumeWorld.scale = 26;         // 世界米尺度
  }
}
function findNozzleTip(rootObj) {
  let res = null;
  rootObj.traverse(o => { if (o.name === 'nozzleTip') res = o; });
  return res || new THREE.Object3D();
}
function hideStrikeVisuals() {
  shipMesh && (shipMesh.visible = false);
  flyMissile && (flyMissile.visible = false);
  plumeWorld && plumeWorld.group.visible && plumeWorld.setPower(0);
  losLine && (losLine.visible = false);
  predictRing && (predictRing.visible = false);
}
function strikeReset(first = false) {
  ensureStrikeVisuals();
  strikeSim.reset();
  S.strikeState = 'running';
  shipMesh.visible = true;
  flyMissile.visible = true;
  losLine.geometry.attributes;   // noop
  chip($('#strikeChip'), '交战 ENGAGED', 'fly');
  $('#strikeBtn').textContent = '战斗进行中…';
  if (!first) viewer.flyCam([strikeSim.shipPos.x / 1000 + 2.6, 3.4, strikeSim.shipPos.z / 1000 + 5.4],
    [strikeSim.shipPos.x / 1000, .3, strikeSim.shipPos.z / 1000], 1.2);
}
strikeSim.onHit = sim => {
  S.strikeState = 'hit';
  boom.fire(sim.hitPoint, 120);
  viewer.shakeAt(.3);
  plumeWorld.setPower(0);
  flyMissile.visible = false;
  losLine.visible = false;
  predictRing.visible = false;
  chip($('#strikeChip'), '命中 HIT!', '');
  $('#strikeBtn').textContent = '再来一局';
  $('#stBadge') && ($('#stBadge').textContent = '命中', $('#stBadge').className = 'phase-badge terminal');
  $('#stNote') && ($('#stNote').textContent = `近炸引信起爆！最小弹目距离 ${sim.minDist.toFixed(0)} m`);
};
strikeSim.onStop = sim => {
  if (S.strikeState === 'hit') return;
  S.strikeState = 'timeout';
  chip($('#strikeChip'), '脱靶 MISS', '');
  $('#strikeBtn').textContent = '再来一局';
  $('#stBadge') && ($('#stBadge').textContent = '脱靶', $('#stBadge').className = 'phase-badge');
  $('#stNote') && ($('#stNote').textContent = `燃料耗尽仍差 ${sim.minDist.toFixed(0)} m —— 试试重置对手换个角度。`);
};
function enterStrike(snap = true) {
  stopAllSims();
  viewer.setWorldMode(true);
  ensureStrikeVisuals();
  strikeSim.reset();
  shipMesh.visible = true; flyMissile.visible = true;
  S.strikeState = 'idle';
  chip($('#strikeChip'), '待命 STANDBY');
  $('#strikeBtn').textContent = '开始追击';
  plumeWorld.setPower(0);
  if (snap) viewer.snapView([strikeSim.shipPos.x / 1000 + 4, 3.8, strikeSim.shipPos.z / 1000 + 7],
    [strikeSim.shipPos.x / 1000, .2, strikeSim.shipPos.z / 1000]);
}
function tickStrike(dt) {
  if (S.chapter !== 3 || S.strikeState !== 'running') return;
  const steps = 2;
  const mult = location.search.includes('fast') ? 4 : 1;   // 慢机器调试加速
  for (let i = 0; i < steps; i++) strikeSim.step(dt / steps * mult);
  // 同步视觉
  shipMesh.position.copy(strikeSim.shipPos);
  shipMesh.rotation.y = Math.atan2(-strikeSim.shipVel.z, strikeSim.shipVel.x);
  flyMissile.position.copy(strikeSim.missilePos);
  orientAlong(flyMissile, strikeSim.missileVel);
  plumeWorld.setPower(0);   // 拦截弹已脱离助推段，无羽流
  // 舵偏示意 = 指令过载映射
  try { M.finAngle.call({ finDirs: findFinDirs(flyMissile) }, clamp(strikeSim.gCmd / 17, -1, 1) * 14 * DEG); } catch (_) {}
  // LOS
  if ($('#losBtn').classList.contains('on')) {
    const posAttr = losLine.geometry.attributes.position;
    posAttr.setXYZ(0, strikeSim.missilePos.x, strikeSim.missilePos.y, strikeSim.missilePos.z);
    posAttr.setXYZ(1, strikeSim.shipPos.x, strikeSim.shipPos.y + 14, strikeSim.shipPos.z);
    posAttr.needsUpdate = true;
    losLine.visible = true;
  } else losLine.visible = false;
  // 预测点
  if ($('#predictBtn').classList.contains('on')) {
    predictedIntercept(strikeSim, _pv);
    predictRing.position.copy(_pv);
    predictRing.rotation.y += dt * 2;
    predictRing.scale.setScalar(1 + .1 * Math.sin(performance.now() * .004));
    predictRing.visible = true;
  } else predictRing.visible = false;
  // 相机跟弹(视线朝向目标)
  camChase(strikeSim.missilePos, strikeSim.missileVel, dt, strikeSim.shipPos);
  // 遥测 UI
  const setT = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  if (Math.random() < .3) {
    setT('#tDist', strikeSim.dist.toFixed(0));
    setT('#tClose', strikeSim.closing.toFixed(0));
    setT('#tG', strikeSim.gCmd.toFixed(1));
    setT('#tMach', strikeSim.machNow.toFixed(2));
    if (charts.pn) charts.pn.hist.push(strikeSim.gCmd);
    else charts.pn = { hist: [strikeSim.gCmd] };
    drawPNChart();
  }
}
const _pv = new THREE.Vector3(), _cv = new THREE.Vector3(), _tv = new THREE.Vector3(), _tv2 = new THREE.Vector3();
function orientAlong(obj, dir) {
  _tv.copy(dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _tv);
  obj.quaternion.copy(q);
  // 无额外自旋，保持弹体纵轴严格沿速度方向
}
function findFinDirs(clonedRoot) {
  let out = [];
  clonedRoot.traverse(o => { if (o.isGroup && o.children.length && o.children[0].geometry && o.name !== 'MISSILE') {} });
  // 更稳: 用克隆中 fins 组
  const finGrp = (() => { let r = null; clonedRoot.traverse(o => { if (o.userData.partKey === 'fins') r = o; }); return r; })();
  if (finGrp) out = finGrp.children.filter(o => o.isGroup);
  return out;
}
function camChase(target, vel, dt, aim) {
  // aim 给定时: 相机挂在弹后略高, 镜头看向“弹前方→目标”方向, 目标始终入画
  const dir = _cvtmp(aim ? _tv2.copy(aim).sub(target) : vel).clone();
  _cv.copy(dir).multiplyScalar(-50).add(target);
  _cv.y += 13;
  const k = 1 - Math.exp(-dt * 2.4);
  viewer.camera.position.lerp(_cv, k);
  _tv.copy(target).addScaledVector(dir, 44);
  viewer.controls.target.lerp(_tv, k * 1.15);
}
function _cvtmp(v) { return _lerpDir.copy(v).normalize(); }
const _lerpDir = new THREE.Vector3();
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

/* ============================================================ */
/*          第 4 章 · 任务全弹道                                   */
/* ============================================================ */
function ensureMissionVisuals() {
  if (!boom) { boom = new Boom(viewer.scene); }
  if (!trail) { trail = new Trail(viewer.scene); }
  if (!aimMark) {
    aimMark = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(180, 230, 48),
      new THREE.MeshBasicMaterial({ color: 0xff6161, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 4;
    const plaqueCol = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 700, 12),
      new THREE.MeshBasicMaterial({ color: 0xff6161, transparent: true, opacity: .12, depthWrite: false }));
    plaqueCol.position.y = 350;
    aimMark.add(ring, plaqueCol);
    viewer.world.add(aimMark);
    // 计划弹道虚线
    planPath = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x4a6ea8, dashSize: 640, gapSize: 420, transparent: true, opacity: .45 }));
    planPath.frustumCulled = false;
    viewer.world.add(planPath);
    // 常显光标(全局视角的小标记)
    markerSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeDiamondTex(), transparent: true, opacity: .95, depthWrite: false,
    }));
    markerSprite.scale.setScalar(560);
    viewer.world.add(markerSprite);
  }
}
function makeDiamondTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  c.translate(48, 48); c.rotate(Math.PI / 4);
  c.fillStyle = '#ffb454'; c.shadowColor = '#ffb454'; c.shadowBlur = 18;
  c.fillRect(-19, -19, 38, 38);
  c.strokeStyle = 'rgba(255,180,84,.9)'; c.lineWidth = 5;
  c.strokeRect(-30, -30, 60, 60);
  return new THREE.CanvasTexture(cv);
}
function enterMission(snap = true) {
  stopAllSims();
  viewer.setWorldMode(true);
  ensureMissionVisuals();
  hideStrikeVisuals();
  aimMark.position.set(missionSim.params.aimX, 0, 0);
  // 预积分
  missionSim.launch();
  const Sm = missionSim.samples;
  // 计划路径
  const pts = [];
  for (let i = 0; i < Sm.length; i += 6) pts.push(new THREE.Vector3(Sm[i].px, Sm[i].py, Sm[i].pz));
  planPath.geometry.dispose();
  planPath.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  planPath.computeLineDistances();
  planPath.visible = true;
  trail.reset();
  S.missionEnded = false; S.mt = 0; S.missionPlaying = false;
  updatePauseBtn();
  chipLaunchIdle();
  drawPlanMeta();
  if (snap) viewer.snapView([-5800, 6400, 11200], [9000, 8000, 0]);
  flyMissile.visible = true;
  const s0 = Sm[0];
  flyMissile.position.set(s0.px, s0.py, s0.pz);
  orientAlong(flyMissile, new THREE.Vector3(Math.cos(79 * DEG), Math.sin(79 * DEG), 0));
  plumeWorld && plumeWorld.setPower(0);
  markerSprite.visible = false;
  requestAnimationFrame(drawTimeline);
  drawProfileChart(); drawLegend();
}
function chipLaunchIdle() {
  chip($('#launchBtn'), '发射', '');     // btn-primary 自带样式即可
  $('#launchBtn').textContent = '发射';
  $('#launchBtn').disabled = false;
  $('#pauseBtn').disabled = true;
  $('#tlPhaseNow').textContent = '待发射';
}
function drawPlanMeta() {
  const m = missionSim.meta;
  const note = $('#msNote');
  if (note) note.textContent = `射程 ${m.range.toFixed(1)} km · 弹道顶点 ${(m.apex / 1000).toFixed(1)} km · 最大 Ma ${m.maxMach.toFixed(1)} —— 按下发射看它走完。`;
}
function updatePauseBtn() {
  $('#pauseBtn').textContent = S.missionPlaying ? '暂停' : '继续';
  $('#pauseBtn').disabled = !S.missionPlaying && S.mt > 0 ? false : !S.missionPlaying;
}

/* ---------- 时间轴画布 ---------- */
function drawTimeline() {
  const cv = $('#timelineCv'); const sm = missionSim.samples;
  if (!cv || !sm.length) return;
  const dpr = Math.min(devicePixelRatio, 2);
  const info = cvsCtx(cv, dpr); if (!info.c) return;
  const { c, W, H } = info;
  const dur = sm[sm.length - 1].t;
  // 相位带
  const bandCols = ['rgba(255,180,84,', 'rgba(87,210,148,', 'rgba(255,97,97,', 'rgba(255,97,97,'];
  let phStart = 0;
  function band(ph, x0, x1) {
    c.fillStyle = bandCols[ph] + '.16)';
    c.fillRect(x0, 4, x1 - x0, H - 8);
    c.strokeStyle = bandCols[ph] + '.55)';
    c.strokeRect(x0 + .5, 4.5, x1 - x0 - 1, H - 9);
  }
  let prevPh = sm[0].ph, segStart = 0;
  for (let i = 1; i <= sm.length - 1; i++) {
    const s = sm[i];
    if (s.ph !== prevPh) {
      band(prevPh, segStart / dur * W, i / dur * W);
      segStart = i; prevPh = s.ph;
    }
  }
  band(prevPh, segStart / dur * W, W);
  // 进度游标
  const cx = S.mt / dur * W;
  c.fillStyle = '#fff';
  c.fillRect(cx - 1, 2, 2, H - 4);
  const tEl = $('#tlTimeRight'); if (tEl) tEl.textContent = `T+${S.mt.toFixed(1)}s`;
}
// 拖动
(() => {
  const tl = $('#timeline');
  let dragging = false;
  const setFrom = e => {
    if (!missionSim.samples.length) return;
    const r = tl.getBoundingClientRect();
    const fr = clamp((e.clientX - r.left) / r.width, 0, 1);
    seekMission(fr * missionSim.samples[missionSim.samples.length - 1].t);
  };
  tl.addEventListener('pointerdown', e => { dragging = true; S.missionPlaying = false; updatePauseBtn(); setFrom(e); });
  addEventListener('pointermove', e => dragging && setFrom(e));
  addEventListener('pointerup', () => dragging = false);
})();

function seekMission(tt) {
  const sm = missionSim.samples;
  if (!sm.length) return;
  const dur = sm[sm.length - 1].t;
  S.mt = clamp(tt, 0, dur);
  if (S.missionEnded && S.mt < dur) S.missionEnded = false;
  const s = missionSim.sampleAt(S.mt);
  flyMissile.visible = true;
  flyMissile.position.set(s.px, s.py, s.pz);
  const nxtIdx = Math.min(Math.round(S.mt / MS.dt) + 1, sm.length - 1);
  const nxt = sm[nxtIdx];
  const dv = new THREE.Vector3(nxt.px - s.px, nxt.py - s.py, nxt.pz - s.pz);
  if (dv.lengthSq() > 1) orientAlong(flyMissile, dv);
  plumeWorld.setPower(s.ph === 0 ? .88 : 0);
  trailRebuildTo(Math.round(S.mt / missionSim.dt / 4));
  $('#launchBtn').textContent = S.missionEnded ? '重新发射' : '继续';
  drawTimeline();
  missionUIOnce(s);
}
function trailRebuildTo(count) {
  if (!trail || !missionSim.samples.length) return;
  const sm = missionSim.samples;
  trail.reset();
  for (let i = 0; i <= Math.min(count, sm.length - 1); i++) {
    const s = sm[Math.min(i * 4, sm.length - 1)];
    trail.push(s.px, s.py, s.pz, s.v);
  }
}
function missionUIOnce(s) {
  const setT = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  setT('#tTime', s.t.toFixed(1));
  setT('#tAlt', (s.py / 1000).toFixed(1));
  setT('#tSpd', s.v.toFixed(0));
  setT('#tMach2', s.mach.toFixed(2));
  setT('#tRng', (s.px / 1000).toFixed(1));
  setT('#tGm', (s.g || 0).toFixed(1));
  const badge = $('#msBadge');
  if (badge) {
    const names = ['助推 BOOST', '惯性中段 MIDCOURSE', '末段俯冲 TERMINAL', '命中 IMPACT'];
    badge.textContent = names[s.ph];
    badge.className = 'phase-badge ' + ['', 'midcourse', 'terminal', 'terminal'][s.ph];
    $('#tlPhaseNow').textContent = names[s.ph];
  }
}
function tickMission(dt) {
  if (S.chapter !== 4 || !S.missionPlaying || S.missionEnded) return;
  const sm = missionSim.samples;
  S.mt += dt * S.spd * (location.search.includes('fast') ? 4 : 1);
  const dur = sm[sm.length - 1].t;
  if (S.mt >= dur) {
    S.mt = dur; S.missionPlaying = false; S.missionEnded = true;
    updatePauseBtn();
    chip($('#launchBtn'), '', '');
    $('#launchBtn').textContent = '重新发射';
  }
  const s = missionSim.sampleAt(S.mt);
  flyMissile.position.set(s.px, s.py, s.pz);
  const nxt = missionSim.sampleAt(S.mt + .1);
  if (nxt && nxt !== s) {
    const dv = _pv.set(nxt.px - s.px, nxt.py - s.py, nxt.pz - s.pz);
    if (dv.lengthSq() > 1) orientAlong(flyMissile, dv);
  }
  plumeWorld.setPower(s.ph === 0 ? .88 : 0);
  if (trail) trail.push(s.px, s.py, s.pz, s.v);
  // 相机: 默认跟随
  if (curMissionCam === 'follow') {
    const vdir = _cvtmp(_pv2.set(s.px, s.py, s.pz).sub(missionSim.sampleAt(Math.max(0, S.mt - 1.2))).lengthSq() > 0 ? _pv3.set(nxtSafe(s).px - s.px, nxtSafe(s).py - s.py, nxtSafe(s).pz - s.pz) : _pv4.set(1, 0, 0));
    void vdir;
  }
  camMissionTick(dt, s);
  drawTimeline();
  missionUIOnce(s);
}
function nxtSafe(s) { const n = missionSim.sampleAt(s.t + missionSim.dt * 6); return n && n !== s ? n : s; }
const _pv2 = new THREE.Vector3(), _pv3 = new THREE.Vector3(), _pv4 = new THREE.Vector3();
let curMissionCam = 'follow';
let _camAnchor = new THREE.Vector3(9000, 400, 2600);
function camMissionTick(dt, s) {
  const k = 1 - Math.exp(-dt * (curMissionCam === 'follow' ? 2.4 : 1.4));
  if (curMissionCam === 'follow') {
    const ahead = nxtSafe(s);
    _cv.set(ahead.px - s.px, ahead.py - s.py, ahead.pz - s.pz).normalize();
    const back = _tv.copy(_cv).multiplyScalar(-95).add(new THREE.Vector3(s.px, s.py, s.pz));
    back.y += 34;
    viewer.camera.position.lerp(back, k);
    _camAnchor.lerp(new THREE.Vector3(s.px, s.py, s.pz), k * 1.3);
    viewer.controls.target.copy(_camAnchor);
    markerSprite.visible = false;
    planPath && (planPath.visible = false);
  } else {
    // 全局: 缓慢环绕重心
    const cx = missionSim.meta.range * 500;
    const R = missionSim.meta.range * 340 + 3200;
    const ang = performance.now() * .00004;
    viewer.camera.position.lerp(new THREE.Vector3(cx - Math.cos(ang) * R * .9, R * .58, Math.sin(ang) * R * .9), k * .5);
    viewer.controls.target.lerp(new THREE.Vector3(cx, 5200, 0), k * .6);
    markerSprite.visible = true;
    markerSprite.position.set(s.px, s.py + 140, s.pz);
    planPath && (planPath.visible = true);
  }
}

/* ============================================================ */
/*                    UI 事 件 绑 定                               */
/* ============================================================ */
function syncRangeFill(inp) {
  const pct = (inp.value - inp.min) / (inp.max - inp.min) * 100;
  inp.style.setProperty('--fill', pct + '%');
}

function bindUI() {
  // 爆炸滑杆
  const ex = $('#explodeSlider');
  ex.addEventListener('input', () => {
    S.explore = ex.value / 100;
    M.setExplode(S.explore);
    $('#explodeVal').textContent = ex.value + '%';
    syncRangeFill(ex);
  });
  syncRangeFill(ex);

  $('#cutawayBtn').addEventListener('click', function () {
    S.cutawayOn = !S.cutawayOn;
    this.classList.toggle('on', S.cutawayOn);
    applyCutaway();
  });
  $('#labelBtn').addEventListener('click', function () {
    S.labelsOn = !S.labelsOn; this.classList.toggle('on', S.labelsOn);
  });
  $('#spinBtn').addEventListener('click', function () {
    S.spinOn = !S.spinOn; this.classList.toggle('on', S.spinOn);
    viewer.controls.autoRotate = S.spinOn;
  });
  $('#viewGlobal').addEventListener('click', () =>
    viewer.flyCam([6.6, HANGAR_Y + 2.6, 12.2], [0, HANGAR_Y + .1]));
  $('#viewFront').addEventListener('click', () =>
    viewer.flyCam([0, HANGAR_Y + .6, 13.4], [0, HANGAR_Y + .2]));
  $('#resetView').addEventListener('click', () =>
    viewer.flyCam([5.8, HANGAR_Y + 1.5, 11.4], [0, HANGAR_Y + .15]));

  // 试车
  setupBurnUI();

  // 追击
  $('#strikeBtn').addEventListener('click', function () {
    if (this.textContent.includes('战斗')) return;
    strikeReset(false);
  });
  $('#strikeReset').addEventListener('click', () => enterStrike(true));
  $('#losBtn').addEventListener('click', function () { this.classList.toggle('on'); });
  $('#predictBtn').addEventListener('click', function () { this.classList.toggle('on'); });

  // 任务
  $('#launchBtn').addEventListener('click', function () {
    if (S.missionEnded || S.mt > 0 && S.mt >= missionSim.samples[missionSim.samples.length - 1].t - .01) {
      enterMission(false);
      beginPlay();
      return;
    }
    enterMission(false);            // 发射/重新发射: 一律重置并立即起飞
    beginPlay();
  });
  function beginPlay() {
    if (S.missionEnded) { enterMission(false); }
    S.missionPlaying = true; updatePauseBtn();
    $('#launchBtn').textContent = '重新发射';
    $('#pauseBtn').textContent = '暂停';
    $('#pauseBtn').disabled = false;
  }
  $('#pauseBtn').addEventListener('click', () => {
    S.missionPlaying = !S.missionPlaying; updatePauseBtn();
    $('#pauseBtn').textContent = S.missionPlaying ? '暂停' : '继续';
    const s = missionSim.sampleAt(S.mt); if (s) missionUIOnce(s);
  });
  document.querySelectorAll('.spd-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.spd-btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); S.spd = +b.dataset.spd;
  }));
  document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-cam]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); curMissionCam = b.dataset.cam;
    if (curMissionCam === 'globalView') {
      viewer.flyCam([-3600, 11000, 17500], [missionSim.meta.range * 500, 5500, 0], 1.4);
    } else {
      viewer.flyCam(null, null);
    }
  }));
  $('#missionReset').addEventListener('click', () => enterMission(true));

  // 面板开合
  $('#panelClose').addEventListener('click', () => {
    $('#dataPanel').classList.add('closed');
    $('#panelRail').style.display = '';
  });
  $('#panelRail').addEventListener('click', () => {
    $('#dataPanel').classList.remove('closed');
    $('#panelRail').style.display = 'none';
  });
  document.querySelectorAll('.panel-tab').forEach(b => b.addEventListener('click', () => {
    if (S.chapter <= 2 && b.dataset.tab === 'tele') return;   // 第1/2章暂无遥测
    setPanelTab(b.dataset.tab);
  }));

  // 键盘
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') goChapter(S.chapter + 1);
    else if (e.key === 'ArrowLeft') goChapter(S.chapter - 1);
    else if (e.code === 'Space') {
      e.preventDefault();
      if (S.chapter === 3) $('#strikeBtn').click();
      else if (S.chapter === 4) $('#launchBtn').click();
    }
    else if (e.key.toLowerCase() === 'l') $('#labelBtn').click();
    else if (e.key.toLowerCase() === 'c') $('#cutawayBtn').click();
    else if (e.key.toLowerCase() === 'e') {
      const target = S.explore > .5 ? 0 : 1;
      animExplore(target);
    }
  });

  // 章节导航按钮
  $('#navPrev').onclick = () => goChapter(S.chapter - 1);
  $('#navNext').onclick = () => goChapter(S.chapter + 1);
}
let exploreAnim = null;
function animExplore(to) {
  const from = S.explore; const t0 = performance.now();
  cancelAnimationFrame(exploreAnim);
  (function step() {
    const k = Math.min(1, (performance.now() - t0) / 900);
    const e = k < .5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
    S.explore = from + (to - from) * e;
    M.setExplode(S.explore);
    const ex = $('#explodeSlider');
    ex.value = S.explore * 100;
    $('#explodeVal').textContent = Math.round(ex.value) + '%';
    syncRangeFill(ex);
    if (k < 1) exploreAnim = requestAnimationFrame(step);
  })();
}
function applyCutaway() {
  M.shellMats.forEach(m => {
    m.clippingPlanes = S.cutawayOn ? [clipPlane] : [];
    m.clipShadows = true;
    if (S.cutawayOn) { m.transparent = true; m.opacity = Math.min(m.opacity ?? 1, .55); }
    else { m.opacity = m.name === 'radome' ? .66 : 1; m.transparent = m.name === 'radome'; }
  });
  const accMat = M.allMats.find(m => m.name === 'accent');
  accMat.clippingPlanes = S.cutawayOn ? [clipPlane] : [];
  accMat.transparent = S.cutawayOn || undefined;
  accMat.opacity = S.cutawayOn ? .55 : 1;
}

/* ============================================================ */
/*                        主 循 环                                */
/* ============================================================ */
let lastT = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, .12);   // 低帧率下避免慢动作(子步长内再细分)
  lastT = now;
  tickBurn(dt);
  tickStrike(dt);
  tickMission(dt);
  plumeHangar.update(dt);
  plumeWorld && plumeWorld.update(dt);
  boom && boom.update(dt);
  updateLabels(dt);
  // 自动爆炸小呼吸(ch1未操作时缓慢提示?)
  viewer.update(dt);
  requestAnimationFrame(loop);
}

/* ============================================================ */
/*                         启 动                                  */
/* ============================================================ */
const tips = [
  '正在装配弹体舱段…', '铺设电缆与舵机线路…', '加注教学推进剂(仅示意)…',
  '校准惯性测量组合…', '导入四章立体课程…', '准备完毕！'
];
async function boot() {
  /* ---- 真实初始化（务必在错误兜底面内）---- */
  viewer = createScene(app);
  M = buildMissile();
  M.root.position.y = HANGAR_Y;

  // 允许外壳半透明时露出内部：剖视用裁剪面
  clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  viewer.renderer.localClippingEnabled = true;

  viewer.hangar.add(M.root);
  plumeHangar = new Plume(M.nozzleTip);
  plumeHangar.group.visible = false;
  plumeHangar.scale = 1.15;

  // 部件标注（依赖 M 就绪）
  for (const k of M.order) {
    const p = M.parts[k];
    partLabels[k] = makeLabel(p.en, p.name);
  }
  extraLabelAim = makeLabel('TARGET POINT', '预定落点', true);

  /* ---- 进度条只是装饰，初始化完成后尽快收起 ---- */
  const bar = $('#ldBar'), tipEl = $('#ldTip');
  for (let i = 0; i < tips.length; i++) {
    tipEl.textContent = tips[i];
    bar.style.width = ((i + 1) / tips.length * 100) + '%';
    await new Promise(r => setTimeout(r, 130));
  }
  bindUI();
  buildPartsCards();
  setPanelTab('parts', '部件档案 · 整弹视图');
  // 开场动画: 先散开再组装
  M.setExplode(1); S.explore = 1;
  $('#explodeSlider').value = 100; $('#explodeVal').textContent = '100%'; syncRangeFill($('#explodeSlider'));
  setTimeout(() => { animExplore(0); }, 420);
  $('#loader').classList.add('done');
  window.__MLAB_READY = true;
  window.dispatchEvent(new Event('mLabReady'));
  goChapter(1, { flash: false, snap: true });
  // 调试/分享视角：#view=相机x,y,z|目标x,y,z
  const mv = location.hash.match(/view=([-\d.,|]+)/);
  if (mv) {
    const [p, t] = mv[1].split('|').map(s => s.split(',').map(Number));
    if (p && p.length === 3) viewer.snapView(p, t || [0, 0, 0]);
  }
  loop();
}

/* 失败兜底：任何初始化异常都不再静默卡死，而是给出可读提示 */
function failBoot(err) {
  console.error('[导弹实验台] 启动失败:', err);
  if (typeof window.__mLabFail === 'function') window.__mLabFail(
    err && err.message ? err.message : String(err),
    err && err.stack ? err.stack.split('\n').slice(0, 3).join(' · ') : ''
  );
  else {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#04070d;color:#e9eff7;z-index:999;text-align:center;padding:30px;line-height:2';
    el.innerText = '当前浏览器不支持 WebGL，或初始化出错。\n请换用最新版 Chrome / Edge / Safari 打开本教具。';
    document.body.appendChild(el);
  }
}
try {
  boot().catch(failBoot);
} catch (err) {
  failBoot(err);
}
