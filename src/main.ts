// ============================================================
// 立体课本 · 导弹实验台 — 总控
// 章节 · UI · 标注 · 遥测 · 相机导演 · 主循环
// ============================================================
import * as THREE from 'three';
import { createScene } from './scene';
import { buildMissile } from './parts';
import { Plume, Trail, Boom, buildShip } from './effects';
import { MissionSim, predictedIntercept } from './flight';
import { sfx } from './audio';

/* ---------- 音效解锁 ----------
   浏览器策略：AudioContext 必须由真实用户手势启动。
   挂一次性监听，任何首次交互都尝试解锁；解锁后自动摘除监听。 */
let _sfxArmed = false;
function armAudioOnce() {
  if (_sfxArmed) return;
  _sfxArmed = true;
  sfx.unlock();
  removeEventListener('pointerdown', armAudioOnce);
  removeEventListener('keydown', armAudioOnce);
  removeEventListener('touchstart', armAudioOnce);
}
addEventListener('pointerdown', armAudioOnce);
addEventListener('keydown', armAudioOnce);
addEventListener('touchstart', armAudioOnce);

/** 取单个元素（本教具大量直接访问 DOM 属性，统一放宽为 any） */
const $ = (s: string): any => document.querySelector(s);
/** 取元素集合，并统一转成 HTMLElement[]，便于访问 dataset 等属性 */
const $$ = (s: string): any[] => Array.prototype.slice.call(document.querySelectorAll(s));
if (window.__MLAB_BOOTED) {
  throw new Error('[导弹实验台] 检测到重复初始化，已跳过本次启动。');
}
window.__MLAB_BOOTED = true;
const app = $('#appCanvasWrap');
const DEG = Math.PI / 180;

/* ============================================================ */
/*                       应 用 状 态                             */
/* ============================================================ */
const S: any = {
  /* 工位：assembly 装配台 / bench 试车台 / range 靶场
     不是"章节"——同一个实验台上的三个位置，一条连续的任务线贯穿其中 */
  station: 'assembly',
  labelsOn: true, spinOn: false, cutawayOn: false, highlightOn: false,
  explore: .0,            // 爆炸度
  // 试车
  burning: false, clock: 0, BURN_T: 7.0, curProfile: 0, manualScrub: false,
  burnChart: [],
  // 靶场任务
  missionPlaying: false, mt: 0, spd: 1, missionEnded: false,
  missionChartsDirty: false,
  targetMove: false,      // 目标舰是否做规避机动
  showRunning: false,     // 全流程演示进行中
  missionCam: 'chase',    // fpv 第一人称 / chase 第三人称 / cine 电影机位 / global 全局
  soundOn: true,          // 音效开关（需用户手势后才能真正出声）
};

/* ============================================================
   飞行世界的尺度约定
   真实弹长约 5.9 m，直接放进 27 km 的靶场里会小成一个点——
   跟拍时弹体只占画面 8%，根本看不清。教学可视化允许适度夸张：
   弹体在飞行世界放大 2.6×，相机距离同步放大，比例观感不变
   但本体细节清晰可见。装配台/试车台不受影响（真实比例）。
   ============================================================ */
const MISSILE_WORLD_SCALE = 5.5;   // 飞行世界放大倍率：弹体更大、跟拍时细节更清楚

/* ============================================================ */
/*                   场景与模型装配                               */
/* ============================================================ */
let viewer, M, plumeHangar;
let flyMissile = null, plumeWorld = null, shipMesh = null, losLine = null, predictRing = null;
let markerSprite = null, aimMark = null, planPath = null, trail = null, boom = null;
let clipPlane = null;
// 高亮 = 部件自发光（"透亮"），不是外部打光：材质/贴图/颜色都不覆盖，
// 只是在本色基础上透出一层光，因此外观完整保留，仅用于区分"当前选中哪一件"。
let hlMats = null;
const HL_GLOW = new THREE.Color(0x9fe4ff);   // 冷白，贴合场景科技色
const HL_MIX = .58;                          // 混入本色的比例：金属件留本色，深色件也亮得起来
const HL_POWER = .60;                        // 自发光强度，克制，能分辨即可
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
  const show = S.labelsOn && S.station !== 'range';
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

/* ---------- 数据面板: 飞行遥测（靶场工位） ---------- */
function teleTemplate() {
  $('#tabTele').innerHTML = `
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
    <div class="mini-canvas-wrap"><h4>末段制导律 · 需用过载 a = N·Vc·λ̇</h4>
      <canvas id="pnCanvas"></canvas></div>
    <div class="station-card open" style="cursor:default">
      <div class="station-name">为什么“视线转得越快越危险”？</div>
      <div class="station-detail" style="display:block">只要视线在旋转（λ̇≠0），就说明导弹没对准未来的碰撞点。比例导引按 <b>a = N·Vc·λ̇</b> 下达侧向指令，把视线转率<strong style="color:#57d294">压向零</strong>——视线一旦被拉直，弹目必然相遇。末段把左侧 HUD 的“弹目距离”和这条曲线对着看，最直观。</div>
    </div>
    <div class="mini-canvas-wrap"><h4>速度色标</h4>
      <canvas id="legendCv" style="height:26px"></canvas></div>`;
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
/* 三个工位：同一个实验台上的三个位置，不是四段互不相干的课本章节 */
const STATIONS: any = {
  assembly: {
    idx: 0, cn: '装配台', en: 'ASSEMBLY',
    goal: '拖动爆炸滑杆把这枚导弹拆开，或直接点击任意部件查看它的档案。',
    // 机位刻意贴近：让弹体撑满画面，细节（蒙皮、铆钉、喷印）才看得见
    cam: [3.4, 0.95, 6.6], tgt: [0, .18, 0],
    hintDrag: '拖动旋转 · 滚轮缩放', hintClick: '点击部件 → 自动飞到特写',
  },
  bench: {
    idx: 1, cn: '试车台', en: 'TEST BENCH',
    goal: '点火试车：看星型药柱退移、推力曲线，以及喷管里喷出的高温燃气。',
    cam: [2.0, -1.78, 4.4], tgt: [0, -3.3, 0],
    hintDrag: '拖动旋转 · 滚轮缩放', hintClick: '点击部件 → 自动飞到特写',
  },
  range: {
    idx: 2, cn: '靶场', en: 'RANGE',
    goal: '发射！一条时间轴走完 助推 → 惯性中段 → 末段导引 → 命中，末段自动画出视线连线。',
    hintDrag: '镜头自动驾驶中', hintClick: '末段自动进入末端特写 · 可拖动时间轴回放',
  },
};
const STATION_ORDER = ['assembly', 'bench', 'range'];
window.__focusPart = { key: null };

function goStation(key, opts: any = {}) {
  if (!STATIONS[key]) key = 'assembly';
  const changed = key !== S.station;
  S.station = key;
  const C = STATIONS[key];

  // 工位按钮态 + 提示文案
  $$('.station-btn').forEach(b => b.classList.toggle('active', b.dataset.station === key));
  $('#stGoal').textContent = C.goal;
  $('#hintDrag').textContent = C.hintDrag;
  $('#hintClick').textContent = C.hintClick;

  // 桌面分组显隐
  $('#grpModel').style.display = key === 'assembly' ? '' : 'none';
  $('#grpMotor').style.display = key === 'bench' ? '' : 'none';
  $('#grpRange').style.display = key === 'range' ? '' : 'none';

  // 工位转场闪现
  if (changed || opts.flash) {
    $('#mfSub').textContent = C.en; $('#mfBig').textContent = C.cn;
    const mf = $('#modeFlash');
    mf.classList.remove('show'); void mf.offsetWidth; mf.classList.add('show');
    setTimeout(() => mf.classList.remove('show'), 1500);
  }

  stopAllSims();
  clearHighlight();          // 切换工位时收掉高亮
  // 离开试车台必须熄火：否则 burning 一直为真、按钮停在"燃烧中…"，
  // 切回来时看起来像卡住了。
  if (key !== 'bench' && S.burning) {
    S.burning = false;
    sfx.rocketOff();
    const ib = $('#igniteBtn');
    if (ib) { ib.textContent = '点火试车'; ib.classList.remove('armed'); }
  }
  if (key === 'range') {
    enterRange(opts.snap !== false);
    setPanelTab('tele', '飞行遥测 · 全任务');
  } else {
    viewer.setWorldMode(false);
    updateStationCam(changed ? 1.05 : .55);
    setPanelTab('parts', key === 'assembly' ? '部件档案 · 整弹视图' : '部件档案 · 试车台');
  }

  $('#panelRail') && ($('#panelRail').style.display = '');
  updateHudVisibility();
  try { localStorage.setItem('mlab_st', key); } catch (e) { /* 隐私模式忽略 */ }
}

/* ---------- 装配台 / 试车台机位：随爆炸度自动后退 ----------
   拆得越开，部件散得越远。若相机不动，散开的舱段会飞出画幅——
   这里按爆炸度沿视线方向整体后撤，保证任何时候整弹都在画面里。   */
function updateStationCam(dur = .55) {
  if (S.station === 'range') return;
  const C = STATIONS[S.station];
  const zoom = 1 + (S.station === 'assembly' ? S.explore * 1.05 : 0);
  const spin = S.spinOn ? -1 : 1;
  viewer.flyCam(
    [C.cam[0] * spin * zoom, HANGAR_Y + C.cam[1] * zoom, C.cam[2] * zoom],
    [C.tgt[0], HANGAR_Y + C.tgt[1] + (S.station === 'assembly' ? S.explore * .55 : 0), C.tgt[2]],
    dur);
}

/* HUD 只在靶场工位、且任务已经开始后显示 */
function updateHudVisibility() {
  const hud = $('#flightHud');
  if (!hud) return;
  const on = S.station === 'range' && (S.missionPlaying || S.mt > 0);
  hud.classList.toggle('show', !!on);
}

function setPanelTab(tab, unitText) {
  $$('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tabParts').style.display = tab === 'parts' ? '' : 'none';
  $('#tabTele').style.display = tab === 'tele' ? '' : 'none';
  if (unitText) $('#panelHeadUnit').textContent = unitText;
  if (tab === 'tele') { teleTemplate(); S.missionChartsDirty = true; }
  else buildPartsCards();
  charts.pn = null;
}

function stopAllSims() {
  // 试车熄火（保留燃烧进度）
  plumeHangar && plumeHangar.setPower(0);
  // 靶场：暂停任务播放
  S.missionPlaying = false;
  updatePauseBtn();
  // 离开靶场必须把相机交还轨道控制，否则跟拍模块会一直锁死视角
  if (S.station !== 'range') viewer && viewer.setCamAuto(false);
}

/* ============================================================
   只按"可见的实体网格"求包围盒。
   不能用 Box3.setFromObject：羽流的火花粒子在未激活时停在 y=9999 做隐藏位，
   会被一起算进去，包围盒被撑到上万米——点击部件算特写距离时，
   相机会被甩到几公里外，聚焦功能等于失效。
   ============================================================ */
const _tmpBox = new THREE.Box3();
function boxOfMeshes(obj) {
  const box = new THREE.Box3();
  box.makeEmpty();
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(_tmpBox);
  });
  return box;
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
  if (moved > 6 || S.station === 'range') return;
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
  // 点空白：高亮开着就收掉当前高亮（单件高亮，不残留）
  if (S.highlightOn) clearHighlight();
});

function selectPart(key, { fly = false } = {}) {
  window.__focusPart.key = key;
  const p = M.parts[key];
  // 卡片态
  $$('#tabParts .station-card').forEach(c => {
    c.classList.toggle('active', c.dataset.key === key);
    c.classList.toggle('open', c.dataset.key === key);
    if (c.dataset.key === key) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  // 高亮：补光式"光感"，只照这一件；开关关着就不亮
  if (S.highlightOn) applyHighlight(key);
  else clearHighlight();
  if (fly) {
    // 特写距离按部件实际尺寸自适应：小件（引信环）贴近看细节，
    // 大件（发动机）拉开看全貌，一律用固定 3.1 会让小件显得很远、大件塞满画面。
    const grp = p.anchor.parent;
    const wp = new THREE.Vector3(); p.anchor.getWorldPosition(wp);
    const box = boxOfMeshes(grp);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const dist = Math.max(sph.radius * 2.5, 1.35);
    const dir = viewer.camera.position.clone().sub(wp).normalize();
    const np = wp.clone().addScaledVector(dir, dist);
    viewer.flyCam([np.x, np.y, np.z], [wp.x, wp.y, wp.z], .9);
    sfx.select();
  }
}

/* 高亮 = 让被选部件自发光。
   前提是每个部件已独占自己的材质实例（见 parts.ts 的 reg 克隆），
   否则改共享材质会让所有共用件一起亮，就做不到"只亮这一件"。 */
function applyHighlight(key) {
  const p = M.parts[key];
  if (!p) return;
  clearHighlight();                  // 先收掉上一个：永远只亮一件，不累计
  const grp = p.anchor.parent;
  const mats = new Set<any>();
  grp.traverse(o => { if (o.isMesh && o.material) mats.add(o.material); });
  mats.forEach(m => {
    if (m.userData.hlBase === undefined) {
      m.userData.hlBase = { em: m.emissiveIntensity ?? 0, col: m.emissive ? m.emissive.getHex() : 0x000000 };
    }
    // 在材质本色基础上混入冷白光：金属件仍保留质感，深色内构件也亮得起来
    const own = m.color ? m.color.clone() : new THREE.Color(0xffffff);
    const glow = own.lerp(HL_GLOW, HL_MIX).multiplyScalar(HL_POWER);
    m.emissive = m.emissive || new THREE.Color(0);
    m.emissive.copy(glow);
    m.emissiveIntensity = 1;
  });
  hlMats = mats;
  sfx.select();
}
function clearHighlight() {
  if (hlMats) {
    hlMats.forEach(m => {
      const b = m.userData.hlBase;
      if (!b) return;
      if (m.emissive) m.emissive.setHex(b.col);
      m.emissiveIntensity = b.em;
    });
    hlMats = null;
  }
  // 注意：保留 window.__focusPart.key —— 卡片仍选中，只是不再发光；
  // 这样重新打开开关时能立刻点亮上次点选的部件。
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
    if (S.clock >= S.BURN_T) { S.clock = 0; _lastBurnFrac = -1; burnFrac(0); S.burnChart = []; }
    S.burning = true;
    $('#igniteBtn').textContent = '燃烧中…';
    $('#igniteBtn').classList.add('armed');
    setTimeout(() => $('#igniteBtn').classList.remove('armed'), 1300);
    chip($('#motorChip'), '燃烧 BURNING', 'burn');
    sfx.ignition();
  });
  $('#burnSlider').addEventListener('input', e => {
    const v = +e.target.value / 100;
    if (!S.burning) {
      S.clock = v * S.BURN_T;
      _lastBurnFrac = -1; burnFrac(v);   // 手动拖动也要走同一节流口径
      const prof = thrustProfile(v);
      plumeHangar.setPower(prof > 0.02 ? Math.max(prof, .18) : 0);
      updateThrustReadout(prof);
      syncRangeFill(e.target);
      // 手动拖燃面滑杆也给出推力声，拖到 0 时熄火
      if (prof > 0.02) sfx.rocketOn(Math.max(prof, .25)); else sfx.rocketOff();
    }
  });
}

/* 药柱退移是整块 ExtrudeGeometry 的重建。每帧重建会在 7 秒里持续制造
   上百份几何垃圾，GC 一抖就表现为"点火后卡住"。按燃面进度增量节流
   （全程约 40 次重建），肉眼看仍是连续退移。 */
let _lastBurnFrac = -1;
function burnFrac(f) {
  if (Math.abs(f - _lastBurnFrac) < .004 && f < 1) return;
  _lastBurnFrac = f;
  M.updateBurn(f);
}
function tickBurn(dt) {
  if (!(S.burning && S.station === 'bench')) return;
  S.clock += dt;
  const f = Math.min(S.clock / S.BURN_T, 1);
  burnFrac(f);
  const prof = thrustProfile(f);
  S.curProfile = prof;
  plumeHangar.setPower(Math.max(prof, f >= 1 ? 0 : .12));
  // 喉衬烧热感
  const throatMat = M.allMats.find(m => m.name === 'throat');
  if (throatMat) { throatMat.emissive.setHex(0xff5a1e); throatMat.emissiveIntensity = prof * 1.5; }
  // 读数
  updateThrustReadout(prof);
  // 试车轰鸣：跟着推力曲线走，推力掉了声音也跟着弱下去
  if (f < 1) sfx.rocketOn(Math.max(prof, .18));
  // 曲线历史
  S.burnChart.push(f);
  const sl = $('#burnSlider'); sl.value = f * 100; syncRangeFill(sl);
  if (f >= 1) {
    S.burning = false;
    $('#igniteBtn').textContent = '再烧一遍';
    chip($('#motorChip'), '燃尽 BURNOUT', 'fly');
    plumeHangar.setPower(0);
    sfx.rocketOff();
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
/*              靶场 · 飞行体视觉接线（弹 + 目标舰 + 导引可视化）     */
/* ============================================================ */
function ensureRangeVisuals() {
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
    // 真实弹长约 5.9 m，放进 27 km 的靶场里跟拍时只占画面 8%，
    // 细节全糊掉。这里按教学可视化需要放大 2.6×（比例观感不变，本体看得清）。
    flyMissile.scale.setScalar(MISSILE_WORLD_SCALE);
    viewer.world.add(flyMissile);
    plumeWorld = new Plume(findNozzleTip(flyMissile));
    plumeWorld.scale = MISSILE_WORLD_SCALE;   // 羽流随机体同步放大
    plumeWorld.setDistance(MISSILE_WORLD_SCALE);
  }
}
function findNozzleTip(rootObj) {
  let res = null;
  rootObj.traverse(o => { if (o.name === 'nozzleTip') res = o; });
  return res || new THREE.Object3D();
}
function hideRangeFlight() {
  flyMissile && (flyMissile.visible = false);
  plumeWorld && plumeWorld.group.visible && plumeWorld.setPower(0);
  losLine && (losLine.visible = false);
  predictRing && (predictRing.visible = false);
  shipMesh && (shipMesh.visible = false);
}

/* ============================================================
   目标舰：用“命中时刻恰好抵达瞄准点”反推它的运动
   这样弹道积分器一行都不用改，弹目关系仍然物理自洽——
   导弹瞄准的是未来位置，所以末段一开始，目标正好在前方。
   ============================================================ */
const _zero = new THREE.Vector3();
const SHIP_VEL = new THREE.Vector3(-11.5, 0, 3.4);      // ≈ 12 m/s（约 23 节）横向规避
function shipVelocity() { return S.targetMove ? SHIP_VEL : _zero; }
function missionDuration() {
  const sm = missionSim.samples;
  return sm.length ? sm[sm.length - 1].t : 0;
}
/** 命中点 = 弹道最后一个采样（落到海面处） */
function impactPoint(out) {
  const sm = missionSim.samples;
  if (!sm.length) return out.set(missionSim.params.aimX, 6, 0);
  const last = sm[sm.length - 1];
  return out.set(last.px, 6, last.pz);
}
function shipPosAt(t, out) {
  return out.copy(impactPoint(_impV)).addScaledVector(shipVelocity(), t - missionDuration());
}

/* ---------- 末段导引可视化：视线连线 + 预测命中点 + 弹目读数 ---------- */
const _impV = new THREE.Vector3();
const _mPos = new THREE.Vector3(), _mVel = new THREE.Vector3();
const _sPos = new THREE.Vector3(), _sVel = new THREE.Vector3();
const _relV = new THREE.Vector3(), _rdV = new THREE.Vector3(), _crV = new THREE.Vector3();
/** 供 predictedIntercept 复用的轻量伪 sim（它只读这四个字段） */
const _pseudo: any = {
  missilePos: new THREE.Vector3(), missileVel: new THREE.Vector3(),
  shipPos: new THREE.Vector3(), shipVel: new THREE.Vector3(),
};
/** t 时刻的导弹速度（相邻采样差分） */
function missionVelAt(t, out) {
  const sm = missionSim.samples;
  if (!sm.length) return out.set(0, 0, 0);
  const a = missionSim.sampleAt(Math.max(0, t - .3));
  const b = missionSim.sampleAt(Math.min(missionDuration(), t + .3));
  const dtt = Math.max(b.t - a.t, 1e-3);
  return out.set((b.px - a.px) / dtt, (b.py - a.py) / dtt, (b.pz - a.pz) / dtt);
}
function updateGuidance(s) {
  const terminal = !!s && s.ph === 2;
  const setT2 = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  if (!terminal) {
    if (losLine) losLine.visible = false;
    if (predictRing) predictRing.visible = false;
    setT2('#mSepVal', '— m'); setT2('#mCloseVal', '— m/s'); setT2('#mGVal', '— G');
    setT2('#hudSep', '—');
    return;
  }
  _mPos.set(s.px, s.py, s.pz);
  missionVelAt(s.t, _mVel);
  shipPosAt(s.t, _sPos);
  _sVel.copy(shipVelocity());

  // 视线连线（LOS）
  if (losLine) {
    if ($('#losBtn').classList.contains('on')) {
      const pa = losLine.geometry.attributes.position;
      pa.setXYZ(0, _mPos.x, _mPos.y, _mPos.z);
      pa.setXYZ(1, _sPos.x, _sPos.y + 14, _sPos.z);
      pa.needsUpdate = true;
      losLine.visible = true;
    } else losLine.visible = false;
  }
  // 预测命中点（平面匀速直线近似解 |Δp + Δv·t| 最小）
  if (predictRing) {
    if ($('#predictBtn').classList.contains('on')) {
      _pseudo.missilePos.copy(_mPos); _pseudo.missileVel.copy(_mVel);
      _pseudo.shipPos.copy(_sPos); _pseudo.shipVel.copy(_sVel);
      predictedIntercept(_pseudo, _pv);
      predictRing.position.copy(_pv);
      predictRing.rotation.y += .02;
      predictRing.scale.setScalar(1 + .1 * Math.sin(performance.now() * .004));
      predictRing.visible = true;
    } else predictRing.visible = false;
  }
  // 弹目读数 + 比例导引的“需用过载” a = N·Vc·λ̇
  _relV.copy(_sPos).sub(_mPos);
  const dist = _relV.length();
  _rdV.copy(_sVel).sub(_mVel);
  const closing = -_relV.clone().normalize().dot(_rdV);
  const omega = _crV.copy(_relV).cross(_rdV).divideScalar(Math.max(dist * dist, 1)).length();
  const gNeed = clamp(4.2 * Math.max(closing, 0) * omega / 9.80665, 0, 40);
  setT2('#mSepVal', dist.toFixed(0) + ' m');
  setT2('#mCloseVal', closing.toFixed(0) + ' m/s');
  setT2('#mGVal', gNeed.toFixed(1) + ' G');
  setT2('#hudSep', dist.toFixed(0));
  if (charts.pn) charts.pn.hist.push(gNeed);
  else charts.pn = { hist: [gNeed] };
  // 舵偏示意：需用过载 → 舵面偏转
  try { M.finAngle.call({ finDirs: findFinDirs(flyMissile) }, clamp(gNeed / 17, -1, 1) * 14 * DEG); } catch (_) {}
}

/* ---------- 飞行 HUD ---------- */
const PHASE_NAMES = ['助推 BOOST', '惯性中段 MIDCOURSE', '末段导引 TERMINAL', '命中 IMPACT'];
function updateHud(s) {
  if (!s) return;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set('#hudT', 'T+' + s.t.toFixed(1) + 's');
  set('#hudAlt', (s.py / 1000).toFixed(1));
  set('#hudV', s.v.toFixed(0));
  set('#hudMach', s.mach.toFixed(2));
  set('#hudG', (s.g || 0).toFixed(1));
  set('#hudRng', (s.px / 1000).toFixed(1));
  set('#hudPhase', PHASE_NAMES[s.ph] || '待发射');
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
/* ============================================================
   飞行跟拍机位
   四种视角，全部由本模块直接驱动相机（已绕开 OrbitControls）：
     fpv    第一人称：骑在弹背上，视野随速度张开
     chase  第三人称：挂在水平后上方，弹体占画面约 1/4
     cine   电影机位：侧后方缓慢环绕，交代弹目关系
     global 全局视角：拉到战区尺度看完整弹道
   关键修正：旧实现沿“-速度方向”偏移，发射时弹道接近垂直（程序角 72°），
   相机会被甩到地面以下（y ≈ -52 m），于是“发射后看不到导弹”。
   现在统一改用「水平后方向 + 世界上方」偏移，并给相机地面高度兜底。
   ============================================================ */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const CAM_PRESET: any = {
  fpv:   { dist: 0,  hgt: 0,  ahead: 420, fov: 72, resp: 9.0, label: '第一人称' },
  chase: { dist: 55, hgt: 15, ahead: 34,  fov: 42, resp: 4.2, label: '第三人称' },
  cine:  { dist: 96, hgt: 32, ahead: 50,  fov: 38, resp: 2.6, label: '电影机位' },
};
const _camGoalPos = new THREE.Vector3(), _camGoalLook = new THREE.Vector3();
const _camNowPos = new THREE.Vector3(), _camNowLook = new THREE.Vector3();
const _camNowUp = new THREE.Vector3(0, 1, 0), _camGoalUp = new THREE.Vector3(0, 1, 0);
// 跟拍用的「相对弹体偏移量」：平滑在弹体局部做，才能保证零滞后
const _offGoalPos = new THREE.Vector3(), _offGoalLook = new THREE.Vector3();
const _offNowPos = new THREE.Vector3(), _offNowLook = new THREE.Vector3();
let _camFov = 46, _camSnap = true;
const _vhat = new THREE.Vector3(), _horiz = new THREE.Vector3();
const _cRight = new THREE.Vector3(), _cUp = new THREE.Vector3();
const _toShip = new THREE.Vector3(), _lookDir = new THREE.Vector3(), _fwdFlat = new THREE.Vector3();

/* 弹体在飞行世界里的实际尺寸（本体局部跨度 × 放大倍率）。
   机位距离/高度全部以弹长为基准，改 MISSILE_WORLD_SCALE 时构图自动跟随。 */
const MISSILE_LEN = 6.9;      // 局部跨度：喷口 -3.7 ~ 罩尖 3.18
const MISSILE_RAD = 0.55;
function missileLen() { return MISSILE_LEN * MISSILE_WORLD_SCALE; }
function missileRad() { return MISSILE_RAD * MISSILE_WORLD_SCALE; }

/** 由速度方向构造稳定的正交基（前向/右向/上向），垂直爬升时自动退化处理 */
function basisFromVel(vel, outFwd, outRight, outUp) {
  const spd = vel.length();
  if (spd < 1e-3) outFwd.set(0, 1, 0); else outFwd.copy(vel).divideScalar(spd);
  outRight.crossVectors(outFwd, WORLD_UP);
  if (outRight.lengthSq() < 1e-6) outRight.set(1, 0, 0);   // 垂直向上/向下飞行
  outRight.normalize();
  outUp.crossVectors(outRight, outFwd).normalize();
  return spd;
}

/** 计算某一模式在当前时刻的理想机位，写入 _camGoalPos / _camGoalLook / _camGoalUp，返回目标 FOV */
function calcCamGoal(mode, s, spd, fwd, right, up) {
  const P = CAM_PRESET[mode];
  const L = missileLen(), r = missileRad();
  if (mode === 'fpv') {
    /* 骑在弹背：机位在弹体中后段上方。
       不能再退到喷口处——那里正对羽流，画面会被火焰糊满、只剩一个尾端。 */
    _camGoalPos.copy(_mPos).addScaledVector(fwd, -L * .35).addScaledVector(up, r * 2.4);
    _camGoalLook.copy(_mPos).addScaledVector(fwd, P.ahead);
    // 末段：视线压向目标舰，让拦截过程保留在画面中央
    if (s.ph === 2 && shipMesh) {
      _toShip.copy(_sPos).sub(_mPos);
      if (_toShip.lengthSq() > 1) {
        _lookDir.copy(_toShip).normalize().lerp(fwd, .35).normalize();
        _camGoalLook.copy(_mPos).addScaledVector(_lookDir, P.ahead);
      }
    }
    _camGoalUp.copy(up);
    return P.fov + clamp(spd / 1020, 0, 1) * 20;           // 速度越快视野越广，增强速度感
  }
  if (mode === 'chase' || mode === 'cine') {
    // 水平后方向：把速度投影到水平面再取反，避免大俯仰角把相机甩到地下
    _horiz.set(-fwd.x, 0, -fwd.z);
    if (_horiz.lengthSq() < 1e-6) _horiz.set(0, 0, -1);
    _horiz.normalize();
    /* 关键：机位必须偏离弹尾轴线，绝不能正对弹尾！
       正后方跟拍只能看见尾部一个圆截面，细长的弹体被自己完全挡住，
       观感就是"很小、只看得见尾端"。这里固定偏到侧后方约 33°，
       让弹体以侧影入画；电影机位再在其基础上缓慢环绕。 */
    /* 摆动范围必须整体避开 0（弹尾轴线）：电影机位原来在 0.62±0.85 之间摆动，
       摆到 azim≈0 时又变成正对弹尾，弹体只剩一个圆截面、占比掉到 11%。
       现在让它在 26°~89° 之间环绕，全程都是侧影/四分之三视角。 */
    const azim = mode === 'chase'
      ? 0.58 + Math.sin(performance.now() * .00009) * .10
      : 1.05 + Math.sin(performance.now() * .00016) * .42;
    const ca = Math.cos(azim), sa = Math.sin(azim);
    const hx = _horiz.x, hz = _horiz.z;
    _horiz.set(hx * ca - hz * sa, 0, hx * sa + hz * ca);
    // 距离/高度按弹长取：改世界放大倍率时构图自动跟随，且保证是"特写"
    const dist = (mode === 'cine' ? L * 1.9 : L * 1.4) * (1 + clamp(spd / 1100, 0, 1) * .35);
    const hgt = mode === 'cine' ? L * .72 : L * .38;
    _camGoalPos.copy(_mPos).addScaledVector(_horiz, dist).addScaledVector(WORLD_UP, hgt);
    _camGoalPos.y = Math.max(_camGoalPos.y, 12);           // 地面兜底，杜绝钻地

    /* 视线锚点：沿「水平前方」略微前引，再微抬，让弹体稳定落在画面中部。
       不能用 3D 速度方向前移——助推段速度上仰 60°~70°，前方几十米处会远高于弹体，
       相机随之仰头，弹体被压到画面下缘之外（实测夹角 22.4° > 垂直半视角 21°，整个出画）。
       也不能前引太远：视点推到弹前方几十米，弹体会被挤到画面边缘。现在只前引约 0.3 个弹长。 */
    _fwdFlat.set(fwd.x, 0, fwd.z);
    if (_fwdFlat.lengthSq() < 1e-6) _fwdFlat.set(0, 0, 1); else _fwdFlat.normalize();
    _camGoalLook.copy(_mPos).addScaledVector(_fwdFlat, L * .30).addScaledVector(WORLD_UP, hgt * .18);
    // 末段：视线偏向目标舰，弹与目标同框（同样取水平投影，避免俯冲时视线砸向海面）
    if (s.ph === 2 && shipMesh) {
      _toShip.copy(_sPos).sub(_mPos);
      if (_toShip.lengthSq() > 1) {
        _lookDir.set(_toShip.x, 0, _toShip.z);
        if (_lookDir.lengthSq() < 1e-6) _lookDir.copy(_fwdFlat); else _lookDir.normalize();
        _lookDir.lerp(_fwdFlat, .45).normalize();
        _camGoalLook.copy(_mPos).addScaledVector(_lookDir, L * 1.2).addScaledVector(WORLD_UP, hgt * .18);
      }
    }
    _camGoalUp.copy(WORLD_UP);
    void right;
    return P.fov;
  }
  return _camFov;
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
function enterRange(snap = true) {
  stopAllSims();
  viewer.setWorldMode(true);
  ensureMissionVisuals();
  ensureRangeVisuals();       // 弹 / 羽流 / 目标舰 / 视线连线（由靶场统一持有）
  hideRangeFlight();
  aimMark.position.set(missionSim.params.aimX, 0, 0);
  // 预积分
  missionSim.launch();
  const Sm = missionSim.samples;
  // 目标舰就位：按“命中时刻抵达瞄准点”反推，末段一开始它就在正前方
  shipMesh.visible = true;
  shipPosAt(0, _sPos);
  shipMesh.position.copy(_sPos);
  shipMesh.rotation.y = Math.atan2(-shipVelocity().z, shipVelocity().x);
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
  // 进入靶场即由跟拍模块接管相机（发射前先给出待发的全局机位）
  _camSnap = true;
  viewer.setCamAuto(true);
  if (snap) {
    S.missionCam = 'global';
    syncCamButtons();
    viewer.setCamRig(new THREE.Vector3(-5800, 6400, 11200), new THREE.Vector3(9000, 8000, 0), WORLD_UP, 42);
  }
  flyMissile.visible = true;
  const s0 = Sm[0];
  flyMissile.position.set(s0.px, s0.py, s0.pz);
  orientAlong(flyMissile, new THREE.Vector3(Math.cos(79 * DEG), Math.sin(79 * DEG), 0));
  try { M.finAngle.call({ finDirs: findFinDirs(flyMissile) }, 0); } catch (_) {}
  plumeWorld && plumeWorld.setPower(0);
  markerSprite.visible = false;
  requestAnimationFrame(drawTimeline);
  drawProfileChart(); drawLegend();
  updateHud(s0);
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
  const nxtIdx = Math.min(Math.round(S.mt / missionSim.dt) + 1, sm.length - 1);
  const nxt = sm[nxtIdx];
  const dv = new THREE.Vector3(nxt.px - s.px, nxt.py - s.py, nxt.pz - s.pz);
  if (dv.lengthSq() > 1) orientAlong(flyMissile, dv);
  plumeWorld.setPower(s.ph === 0 ? .88 : 0);
  trailRebuildTo(Math.round(S.mt / missionSim.dt / 4));
  // 目标舰与导引可视化随时间轴同步
  if (shipMesh) {
    shipPosAt(S.mt, _sPos);
    shipMesh.position.copy(_sPos);
    shipMesh.rotation.y = Math.atan2(-shipVelocity().z, shipVelocity().x);
    shipMesh.visible = true;
  }
  updateGuidance(s);
  updateHud(s);
  $('#launchBtn').textContent = S.missionEnded ? '重新发射' : '继续';
  drawTimeline();
  missionUIOnce(s);
  updateHudVisibility();
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
    badge.textContent = PHASE_NAMES[s.ph] || '待发射';
    badge.className = 'phase-badge ' + ['', 'midcourse', 'terminal', 'terminal'][s.ph];
    $('#tlPhaseNow').textContent = PHASE_NAMES[s.ph] || '待发射';
  }
  const note = $('#msNote');
  if (note) {
    note.textContent = [
      '固体火箭发动机全推力工作，程序角控制转弯。',
      '发动机已关机，靠惯性爬升——弹道最高、阻力最小的一段。',
      '导引头截获目标！比例导引把视线转率压向零，舵面开始大幅偏转。',
      '近炸引信起爆，战斗部破片覆盖目标。'
    ][s.ph] || '';
  }
}
/* ---------- 飞行音效 ----------
   助推段给火箭轰鸣，全程按马赫数给破空风噪；
   突破音障与末段锁定各只触发一次（时间轴回拖后允许再次触发）。 */
let _sfxBoomed = false, _sfxLocked = false;
function updateMissionSound(s) {
  if (!s) return;
  if (s.ph === 0) sfx.rocketOn(.5 + .5 * Math.min(s.t / 3, 1));
  else sfx.rocketOff();
  sfx.windOn(s.mach);
  if (!_sfxBoomed && s.mach >= 1.0) { _sfxBoomed = true; sfx.sonicBoom(); }
  if (s.mach < .9) _sfxBoomed = false;
  if (!_sfxLocked && s.ph === 2) { _sfxLocked = true; sfx.lock(); }
  if (s.ph < 2) _sfxLocked = false;
}
let _pnTick = 0;
function tickRange(dt) {
  if (S.station !== 'range') return;
  const sm = missionSim.samples;
  if (!sm.length) return;
  /* 命中之后 / 暂停时也必须继续驱动相机：
     原来这里直接 return，相机就冻在最后一帧，而跟拍机位此刻正在火球内部，
     画面先是黑掉、随后整个应用像卡死一样不再响应。 */
  if (!S.missionPlaying || S.missionEnded) {
    const sp = missionSim.sampleAt(Math.min(S.mt, missionDuration()));
    if (sp) camMissionTick(dt, sp);
    return;
  }
  S.mt += dt * S.spd * (location.search.includes('fast') ? 4 : 1);
  const dur = sm[sm.length - 1].t;
  if (S.mt >= dur) {
    S.mt = dur; S.missionPlaying = false; S.missionEnded = true;
    updatePauseBtn();
    $('#launchBtn').textContent = '重新发射';
    // 已经炸了：收掉弹体与尾焰，别把它们留在火球里
    if (flyMissile) flyMissile.visible = false;
    if (plumeWorld) plumeWorld.setPower(0);
    // 命中：在目标舰处起爆
    impactPoint(_impV);
    boom.fire(new THREE.Vector3(_impV.x, 16, _impV.z), 130);
    // 震动按世界尺度给（米制，几十米外才看得出）
    viewer.shakeAt(14);
    sfx.rocketOff(); sfx.windOff();
    sfx.explosion(1.15);
    _sfxBoomed = false; _sfxLocked = false;
    if (losLine) losLine.visible = false;
    if (predictRing) predictRing.visible = false;
  }
  const s = missionSim.sampleAt(S.mt);
  flyMissile.visible = true;
  flyMissile.position.set(s.px, s.py, s.pz);
  const nxt = missionSim.sampleAt(S.mt + .1);
  if (nxt && nxt !== s) {
    const dv = _pv.set(nxt.px - s.px, nxt.py - s.py, nxt.pz - s.pz);
    if (dv.lengthSq() > 1) orientAlong(flyMissile, dv);
  }
  plumeWorld.setPower(s.ph === 0 ? .88 : 0);
  if (trail) trail.push(s.px, s.py, s.pz, s.v);
  updateMissionSound(s);
  // 目标舰随任务时间推进
  if (shipMesh) {
    shipPosAt(S.mt, _sPos);
    shipMesh.position.copy(_sPos);
    shipMesh.rotation.y = Math.atan2(-shipVelocity().z, shipVelocity().x);
    shipMesh.visible = true;
  }
  updateGuidance(s);
  camMissionTick(dt, s);
  drawTimeline();
  missionUIOnce(s);
  updateHud(s);
  if (++_pnTick % 4 === 0) drawPNChart();
}
function nxtSafe(s) { const n = missionSim.sampleAt(s.t + missionSim.dt * 6); return n && n !== s ? n : s; }
const _pv2 = new THREE.Vector3(), _pv3 = new THREE.Vector3(), _pv4 = new THREE.Vector3();
let _camAnchor = new THREE.Vector3(9000, 400, 2600);
function camMissionTick(dt, s) {
  if (!flyMissile) return;
  if (S.missionEnded) { aftermathCam(dt); return; }   // 命中后切战后环绕机位
  missionVelAt(s.t, _mVel);
  _mPos.set(s.px, s.py, s.pz);
  const mode = S.missionCam;
  const spd = basisFromVel(_mVel, _vhat, _cRight, _cUp);
  let goalFov = _camFov, resp = 4.2;

  if (mode === 'global') {
    // 全局：战区尺度缓慢环绕，交代完整弹道与弹目相对位置
    const cx = missionSim.meta.range * 500;
    const R = missionSim.meta.range * 340 + 3200;
    const ang = performance.now() * .00004;
    _camGoalPos.set(cx - Math.cos(ang) * R * .9, R * .58, Math.sin(ang) * R * .9);
    _camGoalLook.set(cx, 5200, 0);
    _camGoalUp.copy(WORLD_UP);
    goalFov = 42; resp = 1.4;
    if (markerSprite) { markerSprite.visible = true; markerSprite.position.set(s.px, s.py + 260, s.pz); }
    if (planPath) planPath.visible = true;
  } else {
    goalFov = calcCamGoal(mode, s, spd, _vhat, _cRight, _cUp);
    resp = CAM_PRESET[mode].resp;
    if (markerSprite) markerSprite.visible = false;
    // 电影机位保留计划弹道做空间参照，跟拍/第一人称时隐藏以免挡视线
    if (planPath) planPath.visible = (mode === 'cine');
  }

  // 切换机位时瞬移（否则从全局 lerp 到弹背会穿过整片地形）
  if (_camSnap) {
    _camNowPos.copy(_camGoalPos); _camNowLook.copy(_camGoalLook);
    _camNowUp.copy(_camGoalUp); _camFov = goalFov; _camSnap = false;
    // 同步初始化相对偏移，避免下一帧从零向量缓动过来
    _offNowPos.copy(_camGoalPos).sub(_mPos);
    _offNowLook.copy(_camGoalLook).sub(_mPos);
  } else if (mode === 'global') {
    // 全局是缓慢环绕，位置插值无副作用
    const k = 1 - Math.exp(-dt * resp);
    _camNowPos.lerp(_camGoalPos, k);
    _camNowLook.lerp(_camGoalLook, k);
    _camNowUp.lerp(_camGoalUp, k).normalize();
    _camFov += (goalFov - _camFov) * k;
  } else {
    /* 跟拍必须用「相对弹体的偏移量」做平滑，不能直接平滑世界坐标！
       指数平滑的稳态滞后 ≈ 速度 / 响应系数：超声速下（约 1000 m/s、resp 4.2）
       相机和视点都会被甩在弹后 200+ 米 —— 弹体又小又飘、爬升时飞出画面上缘；
       视点滞后更致命，相机等于回头看，弹体直接出画。
       这里把目标机位换算成相对弹体的偏移，只对偏移量做平滑再挂回弹体当前位置：
       相对关系保留电影感的缓动，但对弹体零滞后。 */
    const k = 1 - Math.exp(-dt * resp);
    _offGoalPos.copy(_camGoalPos).sub(_mPos);
    _offGoalLook.copy(_camGoalLook).sub(_mPos);
    _offNowPos.lerp(_offGoalPos, k);
    _offNowLook.lerp(_offGoalLook, Math.min(1, k * 1.35));
    _camNowPos.copy(_mPos).add(_offNowPos);
    _camNowLook.copy(_mPos).add(_offNowLook);
    _camNowUp.lerp(_camGoalUp, k).normalize();
    _camFov += (goalFov - _camFov) * k;
  }
  viewer.setCamRig(_camNowPos, _camNowLook, _camNowUp, _camFov);
}

/* 命中之后：跟拍机位离弹体只有几十米，而火球半径约 130 m ——
   相机正好在火球内部，画面会被糊成一片黑。这里退到火球外做一个缓慢环绕，
   让爆炸完整可见，同时相机继续被驱动（否则画面会整帧冻住）。 */
const _aftC = new THREE.Vector3();
function aftermathCam(dt) {
  impactPoint(_aftC);
  _aftC.y = Math.max(_aftC.y, 40);
  const R = 640;
  const ang = performance.now() * .00014;
  _camGoalPos.set(_aftC.x + Math.cos(ang) * R, _aftC.y + 230, _aftC.z + Math.sin(ang) * R);
  _camGoalLook.copy(_aftC);
  _camGoalUp.copy(WORLD_UP);
  const k = 1 - Math.exp(-dt * 1.5);
  _camNowPos.lerp(_camGoalPos, k);
  _camNowLook.lerp(_camGoalLook, k);
  _camNowUp.lerp(_camGoalUp, k).normalize();
  _camFov += (42 - _camFov) * k;
  viewer.setCamRig(_camNowPos, _camNowLook, _camNowUp, _camFov);
}

/* ============================================================ */
/*                    UI 事 件 绑 定                               */
/* ============================================================ */
function syncRangeFill(inp) {
  const pct = (inp.value - inp.min) / (inp.max - inp.min) * 100;
  inp.style.setProperty('--fill', pct + '%');
}

/* ---------- 机位切换 ---------- */
const CAM_HINT: any = {
  fpv: '第一人称：骑在弹背上，视野随速度张开，末段视线压向目标舰',
  chase: '第三人称：侧后方约 33° 跟拍，弹体以侧影入画、占画面四到九成',
  cine: '电影机位：侧后方 36°~84° 缓慢环绕，交代弹目关系，不会摆到正对弹尾',
  global: '全局：战区尺度俯瞰完整弹道，菱形光标标出导弹位置',
  free: '自由：交还鼠标，可自由环绕观察（拖动旋转 / 滚轮缩放）',
};
function setMissionCam(mode) {
  if (!CAM_HINT[mode]) mode = 'chase';
  S.missionCam = mode;
  syncCamButtons();
  _camSnap = true;                                   // 跨尺度切换直接瞬移，避免镜头穿地飞行
  viewer.setCamAuto(mode !== 'free');
  if (mode === 'free') {
    // 交还轨道相机前先把 FOV 拉回常值（跟拍时可能被速度感拉到 80°+）
    viewer.camera.fov = 42; viewer.camera.updateProjectionMatrix();
  } else if (S.station === 'range') {
    const s = missionSim.sampleAt(S.mt) || missionSim.samples[0];
    if (s) camMissionTick(0, s);
  }
  sfx.whoosh(true);
}
function syncCamButtons() {
  $$('#camGroup .cam-btn').forEach(b => b.classList.toggle('on', b.dataset.cam === S.missionCam));
  const hint = $('#camHint');
  if (hint) hint.textContent = CAM_HINT[S.missionCam] || '';
}

function bindUI() {
  // 爆炸滑杆
  const ex = $('#explodeSlider');
  ex.addEventListener('input', () => {
    S.explore = ex.value / 100;
    M.setExplode(S.explore);
    $('#explodeVal').textContent = ex.value + '%';
    syncRangeFill(ex);
    updateStationCam(.12);      // 拆得越开相机同步后撤，部件不会飞出画幅
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
  // 高亮开关：装配台 / 试车台两处按钮共享同一状态，保持同步
  $$('.hl-toggle').forEach(b => b.addEventListener('click', function () {
    S.highlightOn = !S.highlightOn;
    $$('.hl-toggle').forEach(x => x.classList.toggle('on', S.highlightOn));
    if (!S.highlightOn) clearHighlight();
    else if (window.__focusPart.key) applyHighlight(window.__focusPart.key);  // 开着时立即点亮当前已选件
  }));
  $('#viewFront').addEventListener('click', () =>
    viewer.flyCam([0, HANGAR_Y + .6, 13.4], [0, HANGAR_Y + .2]));
  $('#resetView').addEventListener('click', () =>
    viewer.flyCam([5.8, HANGAR_Y + 1.5, 11.4], [0, HANGAR_Y + .15]));

  // 试车
  setupBurnUI();

  // 工位切换（手动切换会中断全流程演示）
  $$('.station-btn').forEach(b => b.addEventListener('click', () => {
    stopShow();
    goStation(b.dataset.station);
  }));
  $('#fullShowBtn').addEventListener('click', () => S.showRunning ? stopShow() : runFullShow());

  // 靶场任务
  $('#launchBtn').addEventListener('click', function () { stopShow(); beginPlay(); });
  function beginPlay() {
    enterRange(false);              // 发射/重新发射: 一律重置并立即起飞
    S.missionPlaying = true; S.missionEnded = false;
    updatePauseBtn();
    $('#launchBtn').textContent = '重新发射';
    $('#pauseBtn').textContent = '暂停';
    $('#pauseBtn').disabled = false;
    updateHudVisibility();
  }
  // 导引可视化开关
  $('#losBtn').addEventListener('click', function () { this.classList.toggle('on'); });
  $('#predictBtn').addEventListener('click', function () { this.classList.toggle('on'); });
  $('#targetMoveBtn').addEventListener('click', function () {
    S.targetMove = !S.targetMove;
    this.classList.toggle('on', S.targetMove);
    if (S.station === 'range') seekMission(S.mt);   // 立即重算目标位置
  });
  $('#pauseBtn').addEventListener('click', () => {
    S.missionPlaying = !S.missionPlaying; updatePauseBtn();
    $('#pauseBtn').textContent = S.missionPlaying ? '暂停' : '继续';
    const s = missionSim.sampleAt(S.mt); if (s) missionUIOnce(s);
  });
  $$('.spd-btn').forEach(b => b.addEventListener('click', () => {
    $$('.spd-btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); S.spd = +b.dataset.spd;
  }));
  $$('#camGroup .cam-btn').forEach(b => b.addEventListener('click', () => {
    setMissionCam(b.dataset.cam);
    sfx.click();
  }));
  $('#missionReset').addEventListener('click', () => {
    stopShow(); enterRange(true);
    sfx.rocketOff(); sfx.windOff(); sfx.whoosh(false);
  });

  // 音效开关
  $('#sndBtn').addEventListener('click', function () {
    S.soundOn = !S.soundOn;
    sfx.setEnabled(S.soundOn);
    this.classList.toggle('on', S.soundOn);
    $('#sndLabel').textContent = S.soundOn ? '音效' : '静音';
    if (S.soundOn) { armAudioOnce(); sfx.select(); }
  });

  // 面板开合
  $('#panelClose').addEventListener('click', () => {
    $('#dataPanel').classList.add('closed');
    $('#panelRail').style.display = '';
  });
  $('#panelRail').addEventListener('click', () => {
    $('#dataPanel').classList.remove('closed');
    $('#panelRail').style.display = 'none';
  });
  $$('.panel-tab').forEach(b => b.addEventListener('click', () => {
    if (S.station !== 'range' && b.dataset.tab === 'tele') return;   // 只有靶场有遥测
    setPanelTab(b.dataset.tab, undefined);
  }));

  // 键盘：← → 切工位，空格在当前工位执行主操作
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const i = STATIONS[S.station].idx;
    if (e.key === 'ArrowRight') { stopShow(); goStation(STATION_ORDER[Math.min(i + 1, 2)]); }
    else if (e.key === 'ArrowLeft') { stopShow(); goStation(STATION_ORDER[Math.max(i - 1, 0)]); }
    else if (e.code === 'Space') {
      e.preventDefault();
      if (S.station === 'range') { stopShow(); $('#launchBtn').click(); }
      else if (S.station === 'bench') $('#igniteBtn').click();
    }
    else if (e.key.toLowerCase() === 'l') $('#labelBtn').click();
    else if (e.key.toLowerCase() === 'c') $('#cutawayBtn').click();
    else if (e.key.toLowerCase() === 'e') {
      const target = S.explore > .5 ? 0 : 1;
      animExplore(target);
    }
    else if (e.key === 'Escape') stopShow();
  });
}

/* ============================================================
   全流程演示：合拢 → 点火 → 发射 → 全弹道 → 命中
   一条时间线贯穿三个工位，相机全程自动导演
   ============================================================ */
const showTimers: any[] = [];
function stopShow() {
  S.showRunning = false;
  while (showTimers.length) clearTimeout(showTimers.pop());
  const b = $('#fullShowBtn');
  if (b) {
    b.classList.remove('playing');
    const tri = b.querySelector('.tri'); if (tri) tri.textContent = '▶';
    const lbl = b.querySelector('span:last-child'); if (lbl) lbl.textContent = '全流程演示';
  }
}
function showStep(fn, ms) {
  showTimers.push(setTimeout(() => { if (S.showRunning) fn(); }, ms));
}
function runFullShow() {
  stopShow();
  S.showRunning = true;
  const b = $('#fullShowBtn');
  if (b) {
    b.classList.add('playing');
    const tri = b.querySelector('.tri'); if (tri) tri.textContent = '■';
    const lbl = b.querySelector('span:last-child'); if (lbl) lbl.textContent = '演示中 · 点击停止';
  }
  // ① 装配台：先把散开的舱段合拢
  goStation('assembly', { snap: true });
  animExplore(0);
  // ② 试车台：点火，看药柱退移与体积火焰
  showStep(() => {
    goStation('bench', { snap: true });
    showStep(() => $('#igniteBtn').click(), 950);
  }, 1800);
  // ③ 靶场：发射，走完助推 → 中段 → 末段 → 命中
  showStep(() => {
    goStation('range', { snap: true });
    showStep(() => {
      $('#launchBtn').click();
      const dur = missionSim.samples.length ? missionSim.samples[missionSim.samples.length - 1].t : 60;
      showStep(() => stopShow(), dur / S.spd * 1000 + 2600);
    }, 1300);
  }, 6800);
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
let _guardCount = 0;
/** 任何一帧里抛异常都会让 requestAnimationFrame 断掉、整个应用永久卡死。
    这里把 rAF 排在最前面，并逐个子系统隔离，单点出错只丢该模块，画面继续跑。 */
function guardErr(tag, e) {
  if (_guardCount++ < 4) console.warn('[dap-pap] ' + tag + ' 出错已隔离：', e);
}
function loop() {
  requestAnimationFrame(loop);        // 先排下一帧：任何异常都不会让画面停死
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, .12);   // 低帧率下避免慢动作(子步长内再细分)
  lastT = now;
  try { tickBurn(dt); } catch (e) { guardErr('试车台', e); }
  try { tickRange(dt); } catch (e) { guardErr('靶场', e); }
  try { plumeHangar.update(dt); } catch (e) { guardErr('机库羽流', e); }
  try { plumeWorld && plumeWorld.update(dt); } catch (e) { guardErr('飞行羽流', e); }
  try { boom && boom.update(dt); } catch (e) { guardErr('爆炸', e); }
  try { updateLabels(dt); } catch (e) { guardErr('标注', e); }
  try { viewer.update(dt); } catch (e) { guardErr('渲染', e); }
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
  goStation('assembly', { flash: false, snap: true });
  // 深链：#station=assembly|bench|range 直达工位；#chapter=N 保留旧链接兼容
  const ms = location.hash.match(/station=(assembly|bench|range)/);
  if (ms) goStation(ms[1], { flash: false, snap: true });
  const mc = location.hash.match(/chapter=([1-4])/);
  if (mc && !ms) goStation(['assembly', 'bench', 'range', 'range'][+mc[1] - 1], { flash: false, snap: true });
  const mv = location.hash.match(/view=([-\d.,|]+)/);
  if (mv) {
    const [p, t] = mv[1].split('|').map(s => s.split(',').map(Number));
    if (p && p.length === 3) viewer.snapView(p, t || [0, 0, 0]);
  }
  // 定格状态深链：直接把实验台摆成某个姿势，便于课件嵌入与截图
  const me = location.hash.match(/explode=(\d+)/);
  if (me) setTimeout(() => {
    const v = Math.max(0, Math.min(100, +me[1]));
    const sl = $('#explodeSlider');
    sl.value = v; S.explore = v / 100;
    M.setExplode(S.explore); $('#explodeVal').textContent = v + '%';
    syncRangeFill(sl); updateStationCam(.01);
  }, 900);
  const mk = location.hash.match(/cam=(fpv|chase|cine|global|free)/);
  if (mk) setTimeout(() => { if (S.station !== 'range') goStation('range'); setMissionCam(mk[1]); }, 1000);
  // 任务定格：跳到指定时刻并摆好机位（无头环境无法等动画，用它取中间帧）
  const mt2 = location.hash.match(/mt=([\d.]+)/);
  if (mt2) setTimeout(() => {
    if (S.station !== 'range') goStation('range', { snap: false });
    seekMission(+mt2[1]);
    _camSnap = true;
    const s = missionSim.sampleAt(S.mt);
    if (s) camMissionTick(0, s);
  }, 1300);

  // 验证/演示：自动点火、发射、完整演示
  if (/[?&]ignite=1/.test(location.hash)) setTimeout(() => { goStation('bench'); setTimeout(() => $('#igniteBtn')?.click(), 600); }, 700);
  if (/[?&]launch=1/.test(location.hash)) setTimeout(() => { goStation('range'); setTimeout(() => $('#launchBtn')?.click(), 600); }, 700);
  if (/[?&]show=1/.test(location.hash)) setTimeout(() => runFullShow(), 900);
  if (/[?&]debug=1/.test(location.hash)) setTimeout(dumpSceneStats, 2600);
  const ma = location.hash.match(/audit=([\d.,]+)/);
  const mam = location.hash.match(/auditCam=([a-z,]+)/);
  if (ma) setTimeout(() => {
    if (S.station !== 'range') goStation('range', { snap: false });
    runCamAudit(ma[1].split(',').map(Number).filter(n => !isNaN(n)),
      mam ? mam[1].split(',') : ['chase']);
  }, 1500);
  loop();
}

/* ---------- 跟拍质量审计 ----------
   #audit=3,20,45,60  依次把任务定格到这些时刻，检查每个机位下
   相机是否钻地、与弹体的距离、弹体是否真的落在视锥内。
   无头环境读不了画面，这条能自动回归"发射后看得到导弹"这类问题。 */
function runCamAudit(times, modes) {
  const rows = [];
  for (const md of modes) {
    S.missionCam = md;
    for (const t of times) {
      seekMission(t);
      _camSnap = true;
      const s = missionSim.sampleAt(S.mt);
      if (!s) continue;
      camMissionTick(0, s);
      viewer.camera.updateMatrixWorld();
      viewer.camera.matrixWorldInverse.copy(viewer.camera.matrixWorld).invert();
      const fr = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse));
      const cp = viewer.camera.position, mp = flyMissile.position;
      rows.push({
        cam: md, t: +t.toFixed(1), ph: s.ph, mach: +s.mach.toFixed(2),
        dist: +cp.distanceTo(mp).toFixed(1),
        camY: +cp.y.toFixed(1),
        above: cp.y > 0,
        inView: fr.containsPoint(mp),
      });
    }
  }
  const d = document.createElement('div');
  d.id = 'camAudit'; d.style.display = 'none';
  d.textContent = JSON.stringify(rows);
  document.body.appendChild(d);
}

/* 调试自检：#debug=1 时把场景统计写进一个隐藏节点。
   无头环境（截图/自动化）读不了画面，但能读到它，用于确认
   模型真的建出来了、几何量级正常，而不是一个空场景。 */
function dumpSceneStats() {
  let meshes = 0, tris = 0, lines = 0, lights = 0;
  viewer.scene.traverse(o => {
    if (o.isLight) lights++;
    if (o.isLine || o.isLineSegments) lines++;
    if (o.isMesh && o.geometry) {
      meshes++;
      const g = o.geometry;
      const c = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      tris += c / 3;
    }
  });
  const box = boxOfMeshes(M.root);
  const size = box.getSize(new THREE.Vector3());
  // 跟拍质量自检：相机与弹体的空间关系，直接回答"发射后还能不能看到导弹"
  viewer.camera.updateMatrixWorld();
  // matrixWorldInverse 只在 renderer.render() 内部刷新，手工做视锥判定前必须先自己求逆，
  // 否则拿到的是上一帧的矩阵，判定结果不可信。
  viewer.camera.matrixWorldInverse.copy(viewer.camera.matrixWorld).invert();
  const camPos = viewer.camera.position;
  const fly = flyMissile && flyMissile.visible ? flyMissile.position : null;
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse));
  const d = document.createElement('div');
  d.id = 'debugStats'; d.style.display = 'none';
  d.textContent = JSON.stringify({
    meshes, tris: Math.round(tris), lines, lights,
    missileLen: +size.y.toFixed(3), missileWide: +size.x.toFixed(3),
    worldScale: MISSILE_WORLD_SCALE, station: S.station, cam: S.missionCam,
    fov: +viewer.camera.fov.toFixed(1),
    camera: [+camPos.x.toFixed(1), +camPos.y.toFixed(1), +camPos.z.toFixed(1)],
    missile: fly ? [+fly.x.toFixed(1), +fly.y.toFixed(1), +fly.z.toFixed(1)] : null,
    camDist: fly ? +camPos.distanceTo(fly).toFixed(1) : null,
    camAboveGround: camPos.y > 0,
    missileInView: fly ? frustum.containsPoint(fly) : null,
  });
  document.body.appendChild(d);
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
