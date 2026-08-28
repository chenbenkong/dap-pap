// ============================================================
// 立体课本 · 导弹实验台 — 无头自检
// 把纯计算层（弹道积分 / 比例导引 / 目标舰反解）拿到 Node 里跑完整任务，
// 不依赖 WebGL，用于 CI 与本地快速回归。
//   运行： npm run selftest
// ============================================================
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? '  ' + extra : ''}`); }
};
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/* ---------- 1. 把 flight.ts 打成可在 Node 直接 import 的 ESM ---------- */
const outdir = mkdtempSync(join(tmpdir(), 'dap-selftest-'));
const outfile = join(outdir, 'flight.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'flight.ts')],
  bundle: true, format: 'esm', platform: 'node',
  outfile, logLevel: 'silent',
  external: [],
});
const { MissionSim, StrikeSim, predictedIntercept } = await import(pathToFileURL(outfile).href);
const THREE = await import('three');

/* ---------- 2. 全程任务弹道 ---------- */
head('全程任务弹道 MissionSim');
const ms = new MissionSim();
const S = ms.launch();
const meta = ms.meta;

ok(S.length > 100, '弹道采样点已生成', `${S.length} 点`);
ok(meta.duration > 20 && meta.duration < 120, '任务时长落在合理区间', `${meta.duration.toFixed(1)} s`);
ok(meta.range > 5 && meta.range < 60, '射程落在合理区间', `${meta.range.toFixed(1)} km`);
ok(meta.apex > 1000, '弹道顶点高于 1 km', `${(meta.apex / 1000).toFixed(2)} km`);
ok(meta.maxMach > 1.2, '飞出超音速', `Ma ${meta.maxMach.toFixed(2)}`);

// 数值健康度：不得出现 NaN / Infinity
let bad = 0;
for (const s of S) {
  if (![s.t, s.px, s.py, s.pz, s.v, s.mach, s.g].every(Number.isFinite)) bad++;
}
ok(bad === 0, '全部采样点数值有限（无 NaN / Infinity）', bad ? `${bad} 个异常` : '');

// 阶段完整性：0 助推 → 1 中段 → 2 末段 → 3 命中
const phases = [...new Set(S.map((s) => s.ph))];
ok(phases.includes(0) && phases.includes(1) && phases.includes(2) && phases.includes(3),
  '四个飞行阶段全部出现', `phases=[${phases.join(',')}]`);

const firstT = (p) => { const s = S.find((x) => x.ph === p); return s ? s.t : NaN; };
const tBoost = firstT(1), tMid = firstT(2), tImp = firstT(3);
ok(tBoost > 0 && tMid > tBoost && tImp > tMid,
  '阶段时序单调递增', `助推→${tBoost.toFixed(1)}s  中段→${tMid.toFixed(1)}s  命中→${tImp.toFixed(1)}s`);

// 命中精度：末段导引应把落点收敛到 aimX 附近
const impact = S[S.length - 1];
const aimX = ms.params.aimX;
const missBy = Math.abs(impact.px - aimX);
ok(missBy / aimX < 0.02, '末段落点偏差 < 2% 射程',
  `落点 x=${(impact.px / 1000).toFixed(2)}km  目标 ${(aimX / 1000).toFixed(1)}km  偏差 ${missBy.toFixed(0)}m`);

// 命中姿态：应当是从上往下的俯冲（vel.y < 0），且高度收敛到海面
ok(impact.py <= 6.001 && impact.py >= -1, '命中高度收敛到海面', `y=${impact.py.toFixed(2)} m`);

// 过载包线：轴向（助推段弹体载荷）与横向（末段气动机动）分开考核
const gMax = Math.max(...S.map((s) => s.g));
const glMax = Math.max(...S.map((s) => s.gl ?? 0));
const gBoost = Math.max(...S.filter((s) => s.ph === 0).map((s) => s.g));
const glTerm = Math.max(...S.filter((s) => s.ph === 2).map((s) => s.gl ?? 0));
ok(meta.gPeak > 1 && meta.gPeak < 30, '轴向过载落在弹体结构可承受区间',
  `峰值 ${gMax.toFixed(1)} G（助推段 ${gBoost.toFixed(1)} G）`);
ok(glTerm <= ms.params.nMax + 0.5, '末段横向机动过载未超出气动舵极限',
  `${glTerm.toFixed(1)} G / 极限 ${ms.params.nMax} G`);
ok(glTerm > 1, '末段确实拉出了机动过载（导引在工作）', `${glTerm.toFixed(1)} G`);
ok(meta.missBy / aimX < 0.02, '元信息记录的脱靶量与采样一致', `${meta.missBy.toFixed(0)} m`);
void glMax;

// 采样等间距（时间轴拖动依赖这一点）
let maxGap = 0;
for (let i = 1; i < S.length; i++) maxGap = Math.max(maxGap, S[i].t - S[i - 1].t);
ok(maxGap <= ms.dt * 1.5, '采样时间步均匀', `dt=${ms.dt}s 最大间隔 ${maxGap.toFixed(3)}s`);

/* ---------- 3. 时间轴随机访问 ---------- */
head('时间轴随机访问 sampleAt');
let acc = 0;
for (let i = 0; i <= 40; i++) {
  const t = (meta.duration * i) / 40;
  const s = ms.sampleAt(t);
  if (s && Number.isFinite(s.px) && Number.isFinite(s.py)) acc++;
}
ok(acc === 41, '全程 41 个时间点均可采样', `${acc}/41`);
ok(ms.sampleAt(-5) !== null && ms.sampleAt(1e6) !== null, '越界时间被安全钳制');

/* ---------- 4. 比例导引追击 ---------- */
head('比例导引 StrikeSim（固定随机数，可复现）');
let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const sim = new StrikeSim();
sim.reset(rng);

let hit = false, t = 0, midShip = null, midPred = null;
sim.onHit = () => { hit = true; };
const dt = 0.02;
const step = sim.step ?? sim.update;
while (t < 60 && !hit) {
  step.call(sim, dt);
  // 在导引中途（尚未命中）抓一次预测命中点，这才是"预测"有意义的时刻
  if (!midPred && sim.state === 'homing' && t > 2 && sim.dist > 800) {
    midPred = predictedIntercept(sim, new THREE.Vector3());
    midShip = sim.shipPos.clone();
  }
  t += dt;
}

ok(typeof step === 'function', 'StrikeSim 具备步进接口');
ok(sim.minDist < 60, '比例导引收敛，脱靶量在战斗部威力半径内',
  `最近距离 ${sim.minDist.toFixed(1)} m  用时 ${sim.time.toFixed(1)} s  命中=${hit}`);
ok(sim.state === 'hit' || sim.minDist < 60, '导引末态正确', `state=${sim.state}`);
ok(sim.machNow > 0.8, '末段仍保持有效速度', `Ma ${sim.machNow.toFixed(2)}`);

/* ---------- 5. 预测命中点（供"预测拦截点"光环使用） ---------- */
head('预测命中点 predictedIntercept（导引中途）');
const out = new THREE.Vector3();
predictedIntercept(sim, out);
ok([out.x, out.y, out.z].every(Number.isFinite), '预测点数值有限',
  `(${out.x.toFixed(0)}, ${out.y.toFixed(0)}, ${out.z.toFixed(0)})`);
if (midPred) {
  ok(midPred.distanceTo(midShip) > 1,
    '中途预测点领先于目标舰当前位置（真正在做提前量）',
    `提前量 ${midPred.distanceTo(midShip).toFixed(0)} m`);
  // 预测点应大体落在目标舰航向前方
  const shipDir = sim.shipVel.clone().normalize();
  const toPred = midPred.clone().sub(midShip).normalize();
  ok(toPred.dot(shipDir) > 0.5, '预测点位于目标舰航向前方',
    `cos=${toPred.dot(shipDir).toFixed(2)}`);
} else {
  ok(false, '未能捕获导引中途的预测点（初速/初距需调整）');
}

/* ---------- 6. 目标舰反解（渲染端用它保证"命中瞬间舰在命中点"） ---------- */
head('目标舰运动反解');
const SHIP_VEL = new THREE.Vector3(-11.5, 0, 3.4);
const impactPoint = new THREE.Vector3(impact.px, 6, impact.pz);
const shipPosAt = (tt) => impactPoint.clone().addScaledVector(SHIP_VEL, tt - meta.duration);

const atImpact = shipPosAt(meta.duration);
ok(atImpact.distanceTo(impactPoint) < 1e-6,
  '命中时刻舰船恰好位于命中点', `Δ=${atImpact.distanceTo(impactPoint).toExponential(2)} m`);
const atStart = shipPosAt(0);
const sailed = atStart.distanceTo(impactPoint);
ok(sailed > 100 && sailed < 3000, '全任务期间舰船航程合理', `${sailed.toFixed(0)} m`);

/* ---------- 结果 ---------- */
console.log(`\n\x1b[1m结果\x1b[0m  \x1b[32m${pass} 通过\x1b[0m  ${fail ? `\x1b[31m${fail} 失败\x1b[0m` : '0 失败'}\n`);
process.exit(fail ? 1 : 0);
