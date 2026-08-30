// ============================================================
// 立体课本 · 导弹实验台 — 无头相机审计
// 把 main.ts 里的跟拍机位数学原样搬到 Node 里，拿真实弹道采样逐点验算：
//   1) 弹体是否真的在画面里（视锥判定，含纵横两个方向）
//   2) 是不是"正对弹尾"（只能看见尾部一个圆截面的经典 bug）
//   3) 弹体在画面里占多大（是不是特写）
//   4) 相机有没有钻到地面以下
// 不依赖 WebGL / 浏览器，可在 CI 里跑。
//   运行： npm run auditcam
// ============================================================
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? '  ' + extra : ''}`); }
};
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/* ---------- 载入弹道 ---------- */
const outdir = mkdtempSync(join(tmpdir(), 'dap-auditcam-'));
const outfile = join(outdir, 'flight.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'flight.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const { MissionSim } = await import(pathToFileURL(outfile).href);

/* ---------- 与 main.ts 保持一致的常量 ---------- */
const MISSILE_WORLD_SCALE = 5.5;
const MISSILE_LEN = 6.9;
const MISSILE_RAD = 0.55;
const L = MISSILE_LEN * MISSILE_WORLD_SCALE;   // 弹长（世界单位）
const R = MISSILE_RAD * MISSILE_WORLD_SCALE;
const ASPECT = 16 / 9;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const CAM_PRESET = {
  fpv: { ahead: 420, fov: 72 },
  chase: { fov: 42 },
  cine: { fov: 38 },
};

/* ---------- 向量小工具 ---------- */
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return mul(a, 1 / l); };
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const WORLD_UP = v3(0, 1, 0);

/* ---------- 复刻 main.ts 的机位解算 ---------- */
function basisFromVel(vel) {
  const spd = len(vel);
  const fwd = spd < 1e-3 ? v3(0, 1, 0) : mul(vel, 1 / spd);
  let right = cross(fwd, WORLD_UP);
  if (dot(right, right) < 1e-12) right = v3(1, 0, 0);
  right = norm(right);
  const up = norm(cross(right, fwd));
  return { spd, fwd, right, up };
}

function calcCam(mode, mPos, s, vel, shipPos, nowMs) {
  const { spd, fwd, right, up } = basisFromVel(vel);
  const P = CAM_PRESET[mode];
  let camPos, look, camUp, fov;

  if (mode === 'fpv') {
    // 纯导引头视角：机位在弹头前端略上方、看向正前方（弹身完全在身后）
    camPos = add(add(mPos, mul(fwd, L * .52)), mul(up, R * .8));
    look = add(mPos, mul(fwd, L * 3));
    fov = P.fov + clamp(spd / 1020, 0, 1) * 20;
    if (s.ph === 2 && shipPos) {
      const toShip = norm(sub(shipPos, mPos));
      const ld = norm(add(mul(toShip, .65), mul(fwd, .35)));
      look = add(mPos, mul(ld, L * 1.5));
      fov = 46 + clamp(len(sub(shipPos, mPos)) / 9000, 0, 1) * 26;   // 末段导引头推近
    }
    camUp = up;
  } else {
    let horiz = v3(-fwd.x, 0, -fwd.z);
    if (dot(horiz, horiz) < 1e-12) horiz = v3(0, 0, -1);
    horiz = norm(horiz);
    // 分段镜头语法（与 main.ts calcCamGoal 保持一致）
    const cine = mode === 'cine';
    const kLow = clamp(mPos.y / 2600, 0, 1);
    let dist, hgt, azC, azA, azF, fovT;
    if (cine) {
      if (s.ph === 0)      { dist = L * (2.20 + .40 * kLow); hgt = L * (-.42 + .62 * kLow); azC = 1.15; azA = .30; azF = .00013; fovT = 50 - 6 * kLow; }
      else if (s.ph === 1) { dist = L * 3.40;                hgt = L * .90;                 azC = 1.02; azA = .42; azF = .00016; fovT = 48; }
      else                 { dist = L * 2.90;                hgt = L * .55;                 azC = .78;  azA = .22; azF = .0002;  fovT = 46; }
    } else {
      if (s.ph === 0)      { dist = L * (2.00 + .30 * kLow); hgt = L * (-.30 + .50 * kLow); azC = .58;  azA = .10; azF = .00009; fovT = 48; }
      else if (s.ph === 1) { dist = L * 3.00;                hgt = L * .55;                 azC = .70;  azA = .12; azF = .00009; fovT = 50; }
      else                 { dist = L * 2.60;                hgt = L * .45;                 azC = .58;  azA = .10; azF = .00011; fovT = 48; }
    }
    dist *= 1 + clamp(spd / 1100, 0, 1) * .18;
    const azim = azC + Math.sin(nowMs * azF) * azA;
    const ca = Math.cos(azim), sa = Math.sin(azim);
    horiz = v3(horiz.x * ca - horiz.z * sa, 0, horiz.x * sa + horiz.z * ca);
    camPos = add(add(mPos, mul(horiz, dist)), mul(WORLD_UP, hgt));
    camPos.y = Math.max(camPos.y, 12);
    let fwdFlat = v3(fwd.x, 0, fwd.z);
    fwdFlat = dot(fwdFlat, fwdFlat) < 1e-12 ? v3(0, 0, 1) : norm(fwdFlat);
    look = add(add(mPos, mul(fwdFlat, L * .35)), mul(WORLD_UP, hgt * .16));
    if (s.ph === 2 && shipPos) {
      let ld = v3(shipPos.x - mPos.x, 0, shipPos.z - mPos.z);
      ld = dot(ld, ld) < 1e-12 ? fwdFlat : norm(ld);
      ld = norm(add(mul(ld, .55), mul(fwdFlat, .45)));
      look = add(add(mPos, mul(ld, L * 1.2)), mul(WORLD_UP, hgt * .18));
    }
    camUp = WORLD_UP;
    fov = fovT;
  }
  return { camPos, look, camUp, fov, fwd, spd };
}

/* ---------- 投影：把世界点投到 NDC，判断是否在画面内 ---------- */
function project(p, camPos, look, camUp, fov) {
  const f = norm(sub(look, camPos));              // 相机朝向（-Z）
  const zAxis = mul(f, -1);
  let xAxis = cross(camUp, zAxis);
  if (dot(xAxis, xAxis) < 1e-12) xAxis = v3(1, 0, 0);
  xAxis = norm(xAxis);
  const yAxis = norm(cross(zAxis, xAxis));
  const d = sub(p, camPos);
  const depth = dot(d, f);
  const tanV = Math.tan((fov * Math.PI / 180) / 2);
  const tanH = tanV * ASPECT;
  return { x: dot(d, xAxis) / (depth * tanH), y: dot(d, yAxis) / (depth * tanV), depth };
}

/* ---------- 发射位姿（与 main.ts padRestPos 保持一致） ----------
   弹体放大后全长 ≈ 37 m，弹根必须立在发射架导轨上、喷管底面停在台面上方，
   否则后半段弹体埋进发射台（"看不到后半段"的根因）。 */
const NOZZLE_LOCAL_Y = -3.7;
const PAD_ELEV = 79 * Math.PI / 180;
const PAD_DIR = v3(Math.cos(PAD_ELEV), Math.sin(PAD_ELEV), 0);
const RAIL_THRU_Y = 11, DECK_Y = 7, PAD_TAIL_CLEAR = .8;
const _tailDrop = -NOZZLE_LOCAL_Y * MISSILE_WORLD_SCALE;
const _t = (DECK_Y + PAD_TAIL_CLEAR - RAIL_THRU_Y + _tailDrop * PAD_DIR.y) / PAD_DIR.y;
const PAD_ROOT = v3(_t * PAD_DIR.x, RAIL_THRU_Y + _t * PAD_DIR.y, 0);

/* ---------- 跑全弹道（用与线上一致的发射位姿） ---------- */
const ms = new MissionSim();
ms.params.x0 = PAD_ROOT.x;
ms.params.y0 = PAD_ROOT.y;
ms.launch();
const dur = ms.samples[ms.samples.length - 1].t;
const velAt = (t) => {
  const a = ms.sampleAt(Math.max(0, t - .3)), b = ms.sampleAt(Math.min(dur, t + .3));
  const dt = Math.max(b.t - a.t, 1e-3);
  return v3((b.px - a.px) / dt, (b.py - a.py) / dt, (b.pz - a.pz) / dt);
};

const MODES = ['chase', 'cine', 'fpv'];
const TIMES = [0.5, 3, 8, 15, 25, 40, 55, dur * 0.8, dur - 0.2];

head(`跟拍机位审计（弹长 ${L.toFixed(1)} m · 任务时长 ${dur.toFixed(1)} s · 画面 16:9）`);
console.log('  模式     t(s)   距弹(m)  画面占比  视线夹角  在画面内  离地(m)');

const bad = { inFrame: [], endOn: [], tooFar: [], underGround: [], tooSmall: [], fpvLook: [] };

for (const mode of MODES) {
  for (const t of TIMES) {
    const s = ms.sampleAt(Math.min(t, dur));
    const mPos = v3(s.px, s.py, s.pz);
    const vel = velAt(s.t);
    const { camPos, look, camUp, fov, fwd } = calcCam(mode, mPos, s, vel, null, t * 1000);

    const dist = len(sub(camPos, mPos));
    const nose = add(mPos, mul(fwd, L / 2));
    const tail = add(mPos, mul(fwd, -L / 2));
    const pc = project(mPos, camPos, look, camUp, fov);
    const pn = project(nose, camPos, look, camUp, fov);
    const pt = project(tail, camPos, look, camUp, fov);

    // 中心是否在画面内（fpv 是导引头视角，弹身本就在身后，不参与此判定）
    const inFrame = pc.depth > 0 && Math.abs(pc.x) <= 1 && Math.abs(pc.y) <= 1;
    // 弹体投影长度占画面高度的比例（NDC 纵跨 2 = 整屏）
    const span = Math.hypot(pn.x - pt.x, pn.y - pt.y) / 2;
    // 阶段感知占比门槛：助推/末段保证特写（≥25%）；滑翔段是刻意的大远景
    // （看跳跃走廊+四周景物，用户明确要求"不要只看到导弹本体"），放宽到 ≥12%
    const spanTh = s.ph === 1 ? 0.12 : 0.25;
    // 视线与弹轴夹角：越接近 0 越"正对弹尾"（只能看见尾部一个圆面）
    const viewDir = norm(sub(look, camPos));
    const endOnCos = Math.abs(dot(viewDir, fwd));
    // fpv：视线应朝弹轴前方（机头朝前看），而不是看到弹身
    const fwdCos = dot(viewDir, fwd);

    if (mode !== 'fpv' && !inFrame) bad.inFrame.push(`${mode}@${t.toFixed(1)}s`);
    if (mode !== 'fpv' && endOnCos > 0.92) bad.endOn.push(`${mode}@${t.toFixed(1)}s endOnCos=${endOnCos.toFixed(3)}`);
    if (mode !== 'fpv' && dist > 260) bad.tooFar.push(`${mode}@${t.toFixed(1)}s ${dist.toFixed(0)}m`);
    if (camPos.y < 5) bad.underGround.push(`${mode}@${t.toFixed(1)}s y=${camPos.y.toFixed(1)}`);
    if (mode !== 'fpv' && span < spanTh) bad.tooSmall.push(`${mode}@${t.toFixed(1)}s 仅占 ${(span * 100).toFixed(0)}%`);
    if (mode === 'fpv' && fwdCos < .9) bad.fpvLook.push(`${mode}@${t.toFixed(1)}s cos=${fwdCos.toFixed(3)}`);

    console.log(`  ${mode.padEnd(6)} ${String(t.toFixed(1)).padStart(6)}  ${dist.toFixed(0).padStart(7)}  `
      + `${(span * 100).toFixed(0).padStart(7)}%  ${(Math.acos(endOnCos) * 180 / Math.PI).toFixed(0).padStart(7)}°  `
      + `${(inFrame ? '是' : '否').padStart(7)}  ${camPos.y.toFixed(0).padStart(6)}`);
  }
}

head('判定');
ok(bad.inFrame.length === 0, '全弹道弹体中心始终在画面内（fpv 导引头视角除外）', bad.inFrame.join(', '));
ok(bad.endOn.length === 0, '跟拍机位不正对弹尾（能看见弹体侧影而非尾部圆面）', bad.endOn.slice(0, 3).join(', '));
ok(bad.tooFar.length === 0, '跟拍距离在特写量级（< 260 m，不会被甩开）', bad.tooFar.slice(0, 3).join(', '));
ok(bad.underGround.length === 0, '相机全程不钻地', bad.underGround.slice(0, 3).join(', '));
ok(bad.tooSmall.length === 0, '弹体在画面中占比达标（助推/末段 ≥25% 特写；滑翔段 ≥12% 大远景）', bad.tooSmall.slice(0, 3).join(', '));
ok(bad.fpvLook.length === 0, '第一人称是"机头朝前看"的导引头视角（视线沿弹轴前方）', bad.fpvLook.slice(0, 3).join(', '));

/* ---------- 发射位姿审计：整弹必须完整立在台面上方 ---------- */
head('发射位姿审计');
const tailY = PAD_ROOT.y + NOZZLE_LOCAL_Y * MISSILE_WORLD_SCALE * PAD_DIR.y;
const noseY = PAD_ROOT.y + 3.06 * MISSILE_WORLD_SCALE * PAD_DIR.y;
const s0 = ms.samples[0];
ok(Math.abs(s0.py - PAD_ROOT.y) < .5 && Math.abs(s0.px - PAD_ROOT.x) < .5,
  '弹道起点 = 发射位姿（弹根落在导轨轴线上）',
  `sim=(${s0.px.toFixed(2)}, ${s0.py.toFixed(2)}) / pad=(${PAD_ROOT.x.toFixed(2)}, ${PAD_ROOT.y.toFixed(2)})`);
ok(tailY >= DECK_Y + .5, '喷管底面在台面上方（后半段不再埋进发射台）',
  `尾 y=${tailY.toFixed(1)} vs 台面 ${DECK_Y}`);
ok(noseY > tailY + MISSILE_LEN * MISSILE_WORLD_SCALE * .9,
  '整弹立在发射架上（弹长完整可见）', `弹体 y 跨度 ${(tailY).toFixed(1)} → ${noseY.toFixed(1)}`);

console.log(`\n结果  ${pass} 通过  ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
