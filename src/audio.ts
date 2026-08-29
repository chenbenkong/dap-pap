// ============================================================
// 立体课本 · 导弹实验台 — 程序化音效
// 全部用 Web Audio 实时合成，不加载任何音频文件（与"零外部资源"一致）
//   · 火箭轰鸣：低频锯齿 + 低通噪声，随推力变调
//   · 飞行破空：带通噪声，中心频率随马赫数上移
//   · 超声速音爆 / 导引头锁定告警 / 爆炸 / UI 交互
// 浏览器策略要求首次发声必须来自用户手势，故 unlock() 挂在首次点击上。
// ============================================================

function makeNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class Sfx {
  ctx: any = null;
  master: any = null;
  noise: any = null;
  enabled = true;
  ready = false;
  unlocked = false;
  // 持续音（火箭/风噪）句柄
  private rocket: any = null;
  private wind: any = null;

  constructor() {
    // 构造期不创建 AudioContext——避免某些浏览器报 "not allowed to start"
  }

  /* ---------- 生命周期 ---------- */
  /** 必须在真实用户手势里调用一次 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.unlocked = true;
      return true;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? .85 : 0;
      this.master.connect(this.ctx.destination);
      this.noise = makeNoiseBuffer(this.ctx, 3);
      this.ready = true;
      this.unlocked = true;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (_) {
      this.ready = false;
      return false;
    }
  }
  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.enabled ? .85 : 0, t, .06);
    }
    if (!on) { this.rocketOff(); this.windOff(); }
  }
  private ok() { return this.ready && this.enabled && this.ctx && this.ctx.state === 'running'; }

  /* ---------- 持续音 1：火箭轰鸣 ---------- */
  /** power 0..1：推力档，越高越响、越亮 */
  rocketOn(power = 1) {
    if (!this.ok()) return;
    if (!this.rocket) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = .9;
      // 低频锯齿：给轰鸣一个明确的"基音"，纯噪声会显得像风
      const osc = c.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = 58;
      const olp = c.createBiquadFilter();
      olp.type = 'lowpass'; olp.frequency.value = 180;
      // 次谐波轰隆：制造胸腔共振感
      const sub = c.createOscillator();
      sub.type = 'sine'; sub.frequency.value = 29;
      const gN = c.createGain(); gN.gain.value = 0;
      const gO = c.createGain(); gO.gain.value = 0;
      const gS = c.createGain(); gS.gain.value = 0;
      src.connect(lp).connect(gN).connect(this.master);
      osc.connect(olp).connect(gO).connect(this.master);
      sub.connect(gS).connect(this.master);
      src.start(); osc.start(); sub.start();
      this.rocket = { src, osc, sub, lp, olp, gN, gO, gS };
    }
    const r = this.rocket, t = this.ctx.currentTime, p = Math.max(0, Math.min(1, power));
    // 推力越大 → 越响、低通越开、基音越高
    r.gN.gain.setTargetAtTime(.30 * p, t, .09);
    r.gO.gain.setTargetAtTime(.16 * p, t, .09);
    r.gS.gain.setTargetAtTime(.22 * p, t, .12);
    r.lp.frequency.setTargetAtTime(300 + 900 * p, t, .12);
    r.olp.frequency.setTargetAtTime(160 + 260 * p, t, .12);
    r.osc.frequency.setTargetAtTime(54 + 34 * p, t, .12);
  }
  rocketOff() {
    const r = this.rocket; if (!r || !this.ctx) return;
    const t = this.ctx.currentTime;
    r.gN.gain.setTargetAtTime(0, t, .18);
    r.gO.gain.setTargetAtTime(0, t, .18);
    r.gS.gain.setTargetAtTime(0, t, .22);
  }

  /* ---------- 持续音 2：飞行破空 ---------- */
  /** mach：马赫数，决定带通中心频率与音量 */
  windOn(mach = 0) {
    if (!this.ok()) return;
    if (!this.wind) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = .7;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 260;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(hp).connect(bp).connect(g).connect(this.master);
      src.start();
      this.wind = { src, bp, hp, g };
    }
    const w = this.wind, t = this.ctx.currentTime;
    const m = Math.max(0, Math.min(5, mach));
    // 亚音速时很轻，跨音速后明显增强，高超音速时频率上移
    const vol = m < .35 ? m * .028 : .012 + Math.min(m, 3.4) * .026;
    w.g.gain.setTargetAtTime(vol, t, .14);
    w.bp.frequency.setTargetAtTime(600 + 520 * Math.min(m, 4), t, .18);
    w.bp.Q.setTargetAtTime(.6 + .3 * Math.min(m, 3), t, .18);
  }
  windOff() {
    const w = this.wind; if (!w || !this.ctx) return;
    w.g.gain.setTargetAtTime(0, this.ctx.currentTime, .25);
  }

  /* ---------- 一次性音效 ---------- */
  /** 超声速音爆：噪声爆发 + 快速下扫的低通 + 低频冲击 */
  sonicBoom() {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + .75);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(.55, t + .012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.2);
    // 低频"砰"
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(28, t + .5);
    const og = c.createGain();
    og.gain.setValueAtTime(.0001, t);
    og.gain.exponentialRampToValueAtTime(.5, t + .02);
    og.gain.exponentialRampToValueAtTime(.0001, t + .8);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + .85);
  }
  /** 爆炸：噪声爆发 + 下扫低通 + 次低频冲击 + 碎片回响 */
  explosion(scale = 1) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const s = Math.max(.4, Math.min(2, scale));
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = .7 + .3 * s;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3600 * s, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.8 * s);
    const g = c.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.72, t + .02);
    g.gain.exponentialRampToValueAtTime(.18, t + .35 * s);
    g.gain.exponentialRampToValueAtTime(.0001, t + 2.4 * s);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 2.5 * s);
    // 冲击波次低频
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(18, t + .9 * s);
    const og = c.createGain();
    og.gain.setValueAtTime(.0001, t);
    og.gain.exponentialRampToValueAtTime(.6, t + .015);
    og.gain.exponentialRampToValueAtTime(.0001, t + 1.6 * s);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 1.7 * s);
  }
  /** 导引头锁定：两声上行电子哔 */
  lock() {
    if (!this.ok()) return;
    const c = this.ctx, t0 = c.currentTime;
    [0, .13].forEach((off, i) => {
      const t = t0 + off;
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.value = i === 0 ? 880 : 1320;
      const g = c.createGain();
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(.12, t + .008);
      g.gain.exponentialRampToValueAtTime(.0001, t + .11);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      o.connect(lp).connect(g).connect(this.master);
      o.start(t); o.stop(t + .13);
    });
  }
  /** 通用短音：UI 点击 / 选中 / 转场 */
  blip(freq = 1100, dur = .07, type = 'triangle', vol = .1) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .006);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + .02);
  }
  click() { this.blip(1250, .05, 'triangle', .07); }
  select() { this.blip(760, .09, 'sine', .09); }
  /** 工位/视角转场：一段短促的上行扫频气流声 */
  whoosh(up = true) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(up ? 420 : 2400, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 2400 : 420, t + .34);
    const g = c.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.11, t + .05);
    g.gain.exponentialRampToValueAtTime(.0001, t + .38);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + .42);
  }
  /** 点火瞬间的爆燃 */
  ignition() {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + .18);
    lp.frequency.exponentialRampToValueAtTime(500, t + .9);
    const g = c.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.5, t + .03);
    g.gain.exponentialRampToValueAtTime(.0001, t + 1.0);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.1);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(180, t + .25);
    const og = c.createGain();
    og.gain.setValueAtTime(.0001, t);
    og.gain.exponentialRampToValueAtTime(.22, t + .04);
    og.gain.exponentialRampToValueAtTime(.0001, t + .7);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + .75);
  }
}

export const sfx = new Sfx();
