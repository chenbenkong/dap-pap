// ============================================================
// 立体课本 · 导弹实验台 — 特效
// 羽流 (火焰/火花/烟) · 弹道拖尾 · 命中爆炸 · 目标舰 · 视线线
// ============================================================
import * as THREE from 'three';

const _v = new THREE.Vector3();

/* ================= 发动机羽流（挂在任意锚点上）================= */
export class Plume {
  constructor(anchor) {
    this.anchor = anchor;
    this.group = new THREE.Group();
    anchor.add(this.group);
    // 单位长度沿 -Y 的锥形焰
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff9a3c, transparent: true, opacity: .85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.flameOuter = new THREE.Mesh(new THREE.ConeGeometry(.16, 1.55, 24, 1, true), flameMat);
    this.flameOuter.rotation.x = Math.PI;               // 指向 -Y
    this.flameOuter.position.y = -.78;
    const coreMat = flameMat.clone(); coreMat.color = new THREE.Color(0xfff6e0);
    this.flameCore = new THREE.Mesh(new THREE.ConeGeometry(.085, .95, 18, 1, true), coreMat);
    this.flameCore.rotation.x = Math.PI;
    this.flameCore.position.y = -.48;
    this.group.add(this.flameOuter, this.flameCore);
    // 马赫环(亮斑串)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false });
    this.diamonds = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(.05 - i * .006, 10, 10), ringMat);
      d.position.y = -.34 - i * .27;
      this.group.add(d); this.diamonds.push(d);
    }
    // 光
    this.light = new THREE.PointLight(0xffa64d, 0, 12, 1.8);
    this.light.position.y = -.5;
    this.group.add(this.light);
    // 火花粒子
    const N = 130;
    this.sparkN = N;
    const pts = new Float32Array(N * 3);
    this.sparkVel = [];
    for (let i = 0; i < N; i++) { this.sparkVel.push({ x: 0, y: 0, z: 0, life: 0 }); pts.set([0, 9999, 0], i * 3); }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      color: 0xffc37a, size: .045, transparent: true, opacity: .95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.group.add(this.sparks);

    // 马赫盘（激波菱形）
    this.diamonds = [];
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(
        new THREE.CircleGeometry(.055 - i * .009, 20),
        new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      d.rotation.x = Math.PI / 2;
      d.position.y = -.36;
      this.group.add(d);
      this.diamonds.push(d);
    }

    this.power = 0;         // 0..1 当前推力档
    this.time = 0;
    this.scale = 1;         // 世界尺度适配（机库=1）
  }
  setPower(p) { this.power = p; this.group.visible = p > 0.01; }
  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;
    const flick = .82 + .18 * Math.sin(this.time * 47) + .1 * Math.sin(this.time * 91 + 1.3);
    const L = this.power * this.scale * (1.5 + .5 * flick) * 1.35;
    const W = (.16 + .05 * flick) * (.5 + this.power * .75);
    this.flameOuter.scale.set(W / .16, this.power * flick * 1.5, W / .16);
    this.flameCore.scale.setScalar(.72 + .28 * flick);
    this.light.intensity = 240 * Math.pow(this.scale, 2) * this.power;   // 米制世界按面积补偿
    this.diamonds.forEach((d, i) => {
      d.material.opacity = this.power > .25 ? .78 : 0;
      d.position.y = (-.36 - i * .30) * this.power * flick;
      d.visible = this.power > .22;
    });
    // 火花再生
    const arr = this.sparks.geometry.attributes.position.array;
    for (let i = 0; i < this.sparkN; i++) {
      const s = this.sparkVel[i];
      s.life -= dt;
      if (s.life <= 0 && Math.random() < this.power * .55) {
        s.life = .3 + Math.random() * .5;
        const a = Math.random() * Math.PI * 2, r = .03;
        arr[i * 3] = Math.cos(a) * r; arr[i * 3 + 1] = -.15; arr[i * 3 + 2] = Math.sin(a) * r;
        const sp = (4.4 + Math.random() * 4) * this.scale * (0.4 + this.power);
        s.x = Math.cos(a) * sp * .16; s.z = Math.sin(a) * sp * .16; s.y = -sp;
      } else if (s.life > 0) {
        arr[i * 3] += s.x * dt; arr[i * 3 + 1] += s.y * dt; arr[i * 3 + 2] += s.z * dt;
        s.y -= 9.8 * dt * this.scale;
      }
      if (s.life <= 0) arr[i * 3 + 1] = 9999;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.material.opacity = .9 * this.power;
  }
}

/* ================= 弹道拖尾（速度→颜色渐变）================= */
export class Trail {
  constructor(sceneWorld, maxPts = 5200) {
    this.max = maxPts; this.n = 0;
    this.positions = new Float32Array(maxPts * 3);
    this.colors = new Float32Array(maxPts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: .9, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.line.frustumCulled = false;
    sceneWorld.add(this.line);
    this._minV = 260; this._maxV = 1250;
  }
  speedColor(v, out) {
    const t = THREE.MathUtils.clamp((v - this._minV) / (this._maxV - this._minV), 0, 1);
    // 青 -> 白 -> 琥珀
    if (t < .5) out.setRGB(.43 + t * .74, .78 + t * .35, .91 - t * .42);
    else { const u = (t - .5) / .5; out.setRGB(1, 1.13 * .88 + u * .16, .70 - u * .40); }
    return out;
  }
  push(x, y, z, v) {
    if (this.n >= this.max) {           // 平移压缩缓冲
      this.positions.copyWithin(0, 3);
      this.colors.copyWithin(0, 3);
      this.n--;
    }
    const i = this.n++;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    const c = new THREE.Color(); this.speedColor(v, c);
    this.colors[i * 3] = c.r; this.colors[i * 3 + 1] = c.g; this.colors[i * 3 + 2] = c.b;
    const g = this.line.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
  reset() { this.n = 0; this.line.geometry.setDrawRange(0, 0); }
}

/* ================= 命中爆炸 ================= */
export class Boom {
  constructor(parentScene) {
    this.scene = parentScene;
    this.parts = [];
    // 共享贴图: 径向渐变光斑
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(.35, 'rgba(255,214,140,.9)');
    gr.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(cv);

    this.N = 900;
    const pos = new Float32Array(this.N * 3);
    const vel = [];   // {p:Vector3,v:Vector3,life,max,sz}
    for (let i = 0; i < this.N; i++) vel.push(null);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 26, map: this.tex, transparent: true, opacity: .96, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffffff, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false; this.points.visible = false;
    parentScene.add(this.points);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(.85, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0xffc98c, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false;
    parentScene.add(this.ring);

    this.flash = new THREE.PointLight(0xffb46a, 0, 2600, 1.6);
    parentScene.add(this.flash);

    this.active = false; this.t = 0;
  }
  fire(center, scaleMeters = 90) {
    this.center = center.clone();
    this.t = 0; this.active = true;
    const arr = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.N; i++) arr.set([center.x, center.y, center.z], i * 3);
    // 重置粒子球
    const dir = new THREE.Vector3(), ref = new THREE.Vector3();
    this.vel = [];
    for (let i = 0; i < this.N; i++) {
      do { dir.set(Math.random() * 2 - 1, Math.random() * 1.4 - .1, Math.random() * 2 - 1); } while (dir.lengthSq() < .05 || dir.lengthSq() > 1);
      dir.normalize();
      // 更快的核心 + 较慢的边缘火团
      const sp = scaleMeters * (.25 + Math.random() * .82) * (Math.random() < .3 ? 1.7 : 1);
      this.vel.push({
        v: dir.multiplyScalar(sp),
        life: .7 + Math.random() * 1.5 * (scaleMeters / 60),
        max: 2.2 * (scaleMeters / 60),
        rise: scaleMeters * (.12 + Math.random() * .2),
      });
      void ref;
    }
    this.size = scaleMeters;
    this.points.geometry.setDrawRange(0, this.N);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.size = scaleMeters * .5;
    this.points.visible = true;
    this.ring.position.set(center.x, 3.0, center.z);
    this.ring.visible = true; this.ring.scale.setScalar(scaleMeters * .25);
    this.flash.position.copy(center);
    this.flash.intensity = 24000 * scaleMeters * scaleMeters;   // 米制世界物理量级
  }
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const arr = this.points.geometry.attributes.position.array;
    let aliveCnt = 0;
    for (let i = 0; i < this.N; i++) {
      const p = this.vel[i];
      if (!p || p.life <= 0) continue;
      aliveCnt++;
      p.life -= dt;
      p.v.y = p.v.y * (1 - dt * 1.4) + p.rise * dt;   // 上浮火球
      p.v.multiplyScalar(1 - dt * 1.15);
      arr[i * 3] += p.v.x * dt;
      arr[i * 3 + 1] = Math.max(arr[i * 3 + 1] + p.v.y * dt, 1.5);
      arr[i * 3 + 2] += p.v.z * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    const k = this.t / (this.size / 45);
    this.points.material.opacity = Math.max(0, .96 * (1 - k) ** 1.4);
    const s = this.size * (0.3 + k * 1.5);
    this.ring.scale.set(s, s, s);
    this.ring.material.opacity = Math.max(0, .78 * (1 - k * 1.5));
    this.flash.intensity *= Math.exp(-dt * 5.5);
    if (k > 2.2 && aliveCnt === 0) { this.active = false; this.points.visible = false; this.ring.visible = false; }
  }
}

/* ================= 迷你驱逐舰（拦截目标）================= */
export function buildShip(lenM = 150) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x51403a, metalness: .25, roughness: .7 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0x665650, metalness: .2, roughness: .78 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(lenM, lenM * .07, lenM * .155), hullMat);
  hull.position.y = lenM * .035;
  hull.rotation.x = 0;
  g.add(hull);
  const deckStrip = new THREE.Mesh(new THREE.BoxGeometry(lenM * .94, lenM * .008, lenM * .125),
    new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: .85 }));
  deckStrip.position.y = lenM * .078; g.add(deckStrip);
  const super1 = new THREE.Mesh(new THREE.BoxGeometry(lenM * .17, lenM * .09, lenM * .11), topMat);
  super1.position.set(-lenM * .06, lenM * .13, 0); g.add(super1);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(lenM * .007, lenM * .01, lenM * .12, 10), topMat);
  mast.position.set(-lenM * .06, lenM * .23, 0); g.add(mast);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(lenM * .078, lenM * .18, 4), hullMat);
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;
  bow.position.set(lenM * .58, lenM * .035, 0);
  g.add(bow);
  return g;
}
