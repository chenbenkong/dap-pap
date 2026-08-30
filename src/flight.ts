// ============================================================
// 立体课本 · 导弹实验台 — 飞行仿真
// A. 比例导引追击演示(第3章)
// B. 全程任务弹道：助推-惯性中段-末段导引-命中(第4章)
// 单位制：米、秒；模型比例在渲染端另行缩放
// ============================================================
import * as THREE from 'three';

const G0 = 9.80665;

/* ---------- 简易大气 ---------- */
function rho(h) { return 1.225 * Math.exp(-Math.max(h, 0) / 8500); }
function sos(h) { return Math.max(295, 340 - h * .0038); }   // 音速近似

/* ============================================================
   A. 追击演示（比例导引 Proportional Navigation）
   ============================================================ */
export class StrikeSim {
  // 字段声明（TS 不会从构造函数赋值反推属性）
  missilePos: any; missileVel: any; shipPos: any; shipVel: any;
  state = 'ready'; time = 0; minDist = Infinity;
  N = 4.2; aMaxG = 17; vMax = 1020; vMin = 860;
  onHit: any = null; onStop: any = null;
  searchT = 0; gCmd = 0; machNow = 0; dist = 0; closing = 0;
  _prevD: any; hitPoint: any;

  constructor() {
    this.missilePos = new THREE.Vector3();
    this.missileVel = new THREE.Vector3();
    this.shipPos = new THREE.Vector3();
    this.shipVel = new THREE.Vector3();
    this.state = 'ready';      // ready|search|homing|hit|timeout
    this.time = 0;
    this.minDist = Infinity;
    this.N = 4.2;              // PN 导航比
    this.aMaxG = 17;
    this.vMax = 1020; this.vMin = 860;
    this.onHit = null; this.onStop = null;
  }
  reset(rng = Math.random) {
    const azDeg = (rng() * 44 - 22);                    // 舰船航向 ±22° 偏离 X 轴
    const spd = 13 + rng() * 6;
    this.shipPos.set(1500 + rng() * 800, 0, -650 + rng() * 300);
    const sAz = azDeg * Math.PI / 180;
    this.shipVel.set(Math.cos(sAz) * spd, 0, -Math.sin(sAz) * spd);
    // 导弹从高空侧翼进入，距离约 6 km
    const side = rng() < .5 ? 1 : -1;
    this.missilePos.set(this.shipPos.x - 4300, 3400 + rng() * 700, this.shipPos.z + side * (1600 + rng() * 600));
    const dir0 = new THREE.Vector3().subVectors(this.shipPos, this.missilePos).normalize();
    this.missileVel.copy(dir0).multiplyScalar(930);
    this.state = 'search'; this.searchT = 0;
    this.time = 0; this.minDist = Infinity;
    this.gCmd = 0; this.machNow = 0;
  }
  losRate(out) {
    // 视线角速度矢量 ω = (r × ṙ)/|r|²
    const r = _t1.subVectors(this.shipPos, this.missilePos);
    const rd = _t2.subVectors(this.shipVel, this.missileVel);
    out.crossVectors(r, rd).divideScalar(r.lengthSq());
    return r;   // 返回相对位置以便复用
  }
  step(dt) {
    if (this.state !== 'search' && this.state !== 'homing') return;
    this.time += dt;
    const vLen0 = this.missileVel.length();
    // 简化空气制动
    const alt = this.missilePos.y;
    const drag = -(vLen0 ** 2) * 0.0000068 * rho(alt);
    let vLen = vLen0 + (this.state === 'homing' ? 55 : 85) * dt;   // 发动机仍在加速
    vLen += drag / vLen0 * dt * vLen0;
    vLen = Math.min(vLen, this.vMax);

    if (this.state === 'search') {
      this.searchT += dt;
      if (this.searchT > .5) this.state = 'homing';
      this.gCmd = 0;
    }
    let aLateral = _t3.set(0, 0, 0);
    if (this.state === 'homing') {
      const r = this.losRate(_omega);
      const closing = -_t2.subVectors(this.shipPos, this.missilePos).normalize().dot(
        _t4.subVectors(this.shipVel, this.missileVel));
      // a = N·Vc·ω （限制在水平面内+垂直微调）
      aLateral.crossVectors(_omega, this.missileVel.clone().normalize()).multiplyScalar(this.N * closing);
      const aMag = aLateral.length();
      const aMax = this.aMaxG * G0;
      if (aMag > aMax) { aLateral.multiplyScalar(aMax / aMag); this.gCmd = this.aMaxG; }
      else this.gCmd = aMag / G0;
    } else {
      // 搜索段朝预测前置点缓慢修正
      const lead = _t5.copy(this.shipPos).addScaledVector(this.shipVel, 2.4);
      const dirLead = _t6.subVectors(lead, this.missilePos).normalize();
      aLateral.subVectors(dirLead.multiplyScalar(vLen0), this.missileVel).multiplyScalar(.55);
      aLateral.y *= .3;
    }
    // 积分：速度向新方向弯折并保持目标速率
    const newVel = _t7.copy(this.missileVel).addScaledVector(aLateral, dt);
    newVel.setLength(Math.max(this.vMin, Math.min(vLen, this.vMax)));
    // 掉高补偿：末段允许自然下沉
    this.missilePos.addScaledVector(newVel, dt);
    this.missileVel.copy(newVel);
    this.shipPos.addScaledVector(this.shipVel, dt);

    const d = _t8.subVectors(this.shipPos, this.missilePos).length();
    if (d < this.minDist) this.minDist = d;
    this.machNow = vLen / sos(alt);
    this.dist = d;
    this.closing = closingOf(this);
    // 命中判定: 进入杀伤半径, 或距离“先收缩后回升”(大步长穿透)即在该最近点起爆
    const penetrated = this._prevD !== undefined &&
      d > this._prevD + 40 && this._prevD < 420 && this.missilePos.y < this.shipPos.y + 90;
    if ((d < 34 || penetrated) && this.missilePos.y < this.shipPos.y + 90) {
      this.state = 'hit';
      this.hitPoint = this.shipPos.clone().setY(this.shipPos.y + 12);
      this.onHit && this.onHit(this);
    }
    this._prevD = d;
    if (this.time > 26) {
      this.state = 'timeout';
      this.onStop && this.onStop(this);
    }
  }
}
function closingOf(s) { return -_t9.subVectors(s.shipPos, s.missilePos).normalize().dot(_ta.subVectors(s.shipVel, s.missileVel)); }

/* 预测命中点(平面匀速直线近似)：解 |Δp + Δv·t| 最小 */
export function predictedIntercept(sim, outVec) {
  const rp = _tb.subVectors(sim.missilePos, sim.shipPos);
  const rv = _tc.subVectors(sim.missileVel, sim.shipVel);
  const b = 2 * rp.dot(rv), a = rv.lengthSq();
  let t = -b / (2 * a);
  t = THREE.MathUtils.clamp(t, 0, 14);
  return outVec.copy(sim.shipPos).addScaledVector(sim.shipVel, t);
}

/* ============================================================
   B. 任务全弹道（预积分，可拖动时间轴回放）
   ============================================================ */
export class MissionSim {
  dt = .02; samples: any[] = []; meta: any = {}; params: any;

  constructor() {
    this.dt = .02;
    this.samples = [];
    this.meta = {};
    this.params = {
      m0: 1680, thrust: 248e3, burnT: 7.2, mdot: 37,
      cd: .12, area: .21, pitch0: 70, pitchEnd: 30,
      lockAt: 17.5, aimX: 27200, nMax: 12,
      // —— 钱学森弹道 · 跳跃滑翔 ——
      // 助推结束后不飞出大气层，而是在 8 km 上下的走廊里
      // 做幅度衰减的正弦"跳跃滑翔"，横向持续对准目标，末段再俯冲。
      glideAlt: 7800,       // 滑翔走廊基准高度 (m)
      skipAmp: 2300,        // 跳跃幅度 (m) —— 让"波浪"肉眼可见
      skipTau: 32,          // 跳跃衰减时间常数 (s)
      skipOm: .38,          // 跳跃角频率 (rad/s) → 周期约 16.5 s
      glideLockRange: 4200, // 水平距离进入此值后转入末段俯冲
      glideMaxT: 52,        // 滑翔最多持续这么久
      // 发射点：main.ts 按"弹尾停在发射架导轨上"反解后覆盖这两项。
      // 默认值仅供无头自检/相机审计使用（不影响相对构图验证）。
      x0: 0, y0: 4,
    };
  }
  /* 积分一次完整弹道 */
  launch() {
    const P = this.params, dt = this.dt;
    let t = 0, m = P.m0, burnLeft = P.burnT;
    let pos = new THREE.Vector3(P.x0 || 0, P.y0 || 4, 0), vel = new THREE.Vector3();
    let phase = 0;                     // 0 助推 1 中段 2 末段 3 命中
    const S = this.samples = [];
    const push = (g, ph, gl = 0) => S.push({
      t, px: pos.x, py: pos.y, pz: pos.z, v: vel.length(),
      mach: vel.length() / sos(pos.y), g, gl, ph,
    });
    push(0, 0);
    let gLoad = 0, gLat = 0, gPeak = 0, gLatPeak = 0;
    const MAXT = 120;
    while (t < MAXT) {
      const v = vel.length(), h = Math.max(pos.y, 0);
      const F = new THREE.Vector3(0, -G0 * m, 0);   // 重力
      // 气动阻力
      if (v > 1) {
        const D = .5 * rho(h) * v * v * P.cd * P.area;
        F.addScaledVector(vel, -D / v);
      }
      // 推力沿弹轴(速度方向+程序角)
      if (burnLeft > 0) {
        const prog = 1 - Math.pow(burnLeft / P.burnT, .8);
        const pitchDeg = THREE.MathUtils.lerp(P.pitch0, P.pitchEnd, Math.min(prog, 1));
        const pitch = pitchDeg * Math.PI / 180;
        const horiz = new THREE.Vector3(Math.cos(pitch), Math.sin(pitch), 0);
        // 保持初始方位 +X；方向从“上仰”平滑由程序角控制
        const dirThrust = v > 20 ? _td.copy(vel).normalize().lerp(horiz, .16).normalize() : horiz;
        F.addScaledVector(dirThrust, P.thrust);
        m -= P.mdot * dt;
        burnLeft -= dt;
        phase = 0;
      } else if (phase === 0) { phase = 1; }

      const acc = F.divideScalar(m);
      if (phase === 1) {
        /* —— 钱学森弹道 · 跳跃滑翔 ——
           沿一条"幅度衰减的正弦高度走廊"飞行（跳跃式滑翔，是钱学森弹道
           最直观的特征），横向持续对准目标。纵向用 PD 把高度/爬升率钉在
           走廊上；横向把速度方向掰向目标方位。 */
        const tG = t - P.burnT;
        const skipAmp = P.skipAmp * Math.exp(-tG / P.skipTau);
        const hRef = P.glideAlt + skipAmp * Math.sin(P.skipOm * tG);
        const hRefDot = skipAmp * P.skipOm * Math.cos(P.skipOm * tG)
          - skipAmp / P.skipTau * Math.sin(P.skipOm * tG);
        const gammaRef = Math.atan2(hRefDot - (pos.y - hRef) * .09, Math.max(vel.length(), 60));
        const aim = _te.set(P.aimX, 0, 0);
        const toAim = _tf.subVectors(aim, pos);
        const azAim = Math.atan2(toAim.z, toAim.x);
        const want = _tg.set(
          Math.cos(azAim) * Math.cos(gammaRef),
          Math.sin(gammaRef),
          Math.sin(azAim) * Math.cos(gammaRef));
        const corr = _ti.subVectors(want.multiplyScalar(vel.length()), vel);
        const clamped = Math.min(P.nMax * G0, corr.length() * 1.5);
        corr.normalize().multiplyScalar(clamped);
        acc.add(corr);
        // 到目标水平距离够近（或滑翔超时）→ 转入末段俯冲
        if (Math.hypot(toAim.x, toAim.z) < P.glideLockRange || tG > P.glideMaxT) phase = 2;
        // 滑翔段也是机动段：感受加速度 = 合加速度扣掉重力
        const ag = _tk.copy(acc).sub(_GRAV);
        gLoad = ag.length() / G0;
        const vhat = _tl.copy(vel).normalize();
        gLat = _tm.copy(ag).addScaledVector(vhat, -ag.dot(vhat)).length() / G0;
      } else if (phase === 2) {
        const aim = _te.set(P.aimX, 4, 0);
        const rel = _tf.subVectors(aim, pos);
        const distH = Math.hypot(rel.x, rel.z);
        // 期望速度方向指向目标前方压低点
        const want = _tg.copy(rel).normalize();
        const cur = _th.copy(vel).normalize();
        const corr = _ti.subVectors(want.multiplyScalar(vel.length()), vel);
        const clamped = Math.min(P.nMax * G0, corr.length() * 2.2);
        corr.normalize().multiplyScalar(clamped);
        acc.add(corr);
        // 末段总过载 = 扣除重力后的合加速度 / g0（含阻力与机动修正）
        const ag = _tk.copy(acc).sub(_GRAV);
        gLoad = ag.length() / G0;
        // 横向（机动）过载：垂直于速度的分量，受气动舵能力 nMax 约束
        const vhat = _tl.copy(vel).normalize();
        gLat = _tm.copy(ag).addScaledVector(vhat, -ag.dot(vhat)).length() / G0;
        void distH; void cur;
      } else {
        // 过载 = 扣除重力后弹体"感受到"的加速度 / g0
        const ag = _tk.copy(acc).sub(_GRAV);
        gLoad = ag.length() / G0;
        // 横向（机动）过载：感受加速度垂直于速度的分量
        if (v > 1) {
          const vhat = _tl.copy(vel).normalize();
          gLat = _tm.copy(ag).addScaledVector(vhat, -ag.dot(vhat)).length() / G0;
        } else gLat = 0;
      }
      vel.addScaledVector(acc, dt);
      pos.addScaledVector(vel, dt);
      t += dt;
      gPeak = Math.max(gPeak, gLoad); gLatPeak = Math.max(gLatPeak, gLat);
      if (pos.y <= 6 && vel.y < 0) { phase = 3; push(gLoad, 3, gLat); break; }
      if (Math.floor(t / dt) % 1 === 0) push(gLoad, phase, gLat);
    }
    // 元信息
    let apex = 0, maxV = 0, maxMach = 0;
    for (const s of S) { apex = Math.max(apex, s.py); maxV = Math.max(maxV, s.v); maxMach = Math.max(maxMach, s.mach); }
    this.meta = {
      duration: S[S.length - 1].t, range: S[S.length - 1].px / 1000, apex, maxV, maxMach,
      gPeak, gLatPeak, missBy: Math.abs(pos.x - P.aimX),
    };
    return this.samples;
  }
  sampleAt(tt) {
    const S = this.samples;
    if (!S.length) return null;
    const i = THREE.MathUtils.clamp(Math.round(tt / this.dt), 0, S.length - 1);
    return S[i];
  }
}

/* 共享临时向量 */
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(),
  _t4 = new THREE.Vector3(), _t5 = new THREE.Vector3(), _t6 = new THREE.Vector3(),
  _t7 = new THREE.Vector3(), _t8 = new THREE.Vector3(), _t9 = new THREE.Vector3(),
  _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3(),
  _td = new THREE.Vector3(), _te = new THREE.Vector3(), _tf = new THREE.Vector3(),
  _tg = new THREE.Vector3(), _th = new THREE.Vector3(), _ti = new THREE.Vector3(),
  _tk = new THREE.Vector3(), _tl = new THREE.Vector3(), _tm = new THREE.Vector3(),
  _GRAV = new THREE.Vector3(0, -G0, 0),
  _omega = new THREE.Vector3();
