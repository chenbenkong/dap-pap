// ============================================================
// 立体课本 · 导弹实验台 — 特效
// 羽流 (火焰/火花/烟) · 弹道拖尾 · 命中爆炸 · 目标舰 · 视线线
// ============================================================
import * as THREE from 'three';

const _v = new THREE.Vector3();

/* ============================================================
   体积火焰材质（程序化湍流噪声 + 视线厚度近似）
   在圆锥表面用 |dot(N,V)| 近似“视线穿过火焰的光学厚度”，
   叠加多层滚动 FBM 噪声做湍流，得到白热核心 → 橙黄 → 暗红的径向分层。
   ============================================================ */
const FIRE_VERT = /* glsl */`
varying vec3 vLocal;
varying vec3 vNrmV;
varying vec3 vPosV;
void main(){
  vLocal = position;
  vNrmV  = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosV  = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FIRE_FRAG = /* glsl */`
precision highp float;
varying vec3 vLocal;
varying vec3 vNrmV;
varying vec3 vPosV;
uniform float uTime;
uniform float uPower;
uniform float uLen;
uniform float uScroll;
uniform float uDensity;
uniform float uSharp;
uniform vec3  uCore;
uniform vec3  uMid;
uniform vec3  uOuter;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++){ s += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
  return s;
}

void main(){
  float H = max(uLen, 0.0001);
  // s: 0 = 喷口，1 = 焰尖（锥体顶点在远端）
  float s = clamp((vLocal.y + H * 0.5) / H, 0.0, 1.0);

  // 视线穿过火焰的“光学厚度”：正对相机处最厚
  vec3 N = normalize(vNrmV);
  vec3 V = normalize(-vPosV);
  float thick = pow(clamp(abs(dot(N, V)), 0.0, 1.0), uSharp);

  // 湍流：绕轴环向 + 沿轴向快速下卷
  float ang = atan(vLocal.z, vLocal.x) * 1.9;
  vec2  np  = vec2(ang, s * 4.5 - uTime * uScroll);
  float n1  = fbm(np * 1.6);
  float n2  = fbm(np * 3.3 + vec2(17.0, -uTime * uScroll * 0.55));
  float turb = n1 * 0.62 + n2 * 0.38;

  // 轴向剖面：喷口起亮，中后段衰减散开
  float axial = smoothstep(0.0, 0.10, s) * (1.0 - smoothstep(0.72, 1.0, s));
  axial = pow(axial, 0.8);

  float a = thick * axial * (0.35 + 0.9 * turb) * uPower * uDensity;
  a = clamp(a, 0.0, 1.0);
  if (a < 0.0035) discard;

  // 径向分层：核心白热 → 中段橙黄 → 外缘暗红
  float heat = clamp(thick * 0.72 + turb * 0.38 - s * 0.30, 0.0, 1.0);
  vec3 col = mix(uOuter, uMid, smoothstep(0.12, 0.55, heat));
  col      = mix(col, uCore, smoothstep(0.58, 1.00, heat));
  col     *= (0.55 + 0.85 * uPower);

  gl_FragColor = vec4(col, a);
}
`;

/** 创建一层体积火焰材质（线性 HDR 配色，交给 Bloom 出光晕） */
function makeFireMaterial(opt: any = {}) {
  const {
    core = [5.2, 4.1, 2.6], mid = [2.6, 1.15, 0.26], outer = [1.05, 0.26, 0.05],
    len = 1.55, scroll = 6.0, density = 1.0, sharp = 1.35,
  } = opt;
  const c3 = a => new THREE.Color().setRGB(a[0], a[1], a[2]);
  return new THREE.ShaderMaterial({
    name: 'volumetricFire',
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uLen: { value: len },
      uScroll: { value: scroll },
      uDensity: { value: density },
      uSharp: { value: sharp },
      uCore: { value: c3(core) },
      uMid: { value: c3(mid) },
      uOuter: { value: c3(outer) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/* ================= 发动机羽流（挂在任意锚点上）================= */
export class Plume {
  // 字段声明（TS 不会从构造函数赋值反推属性）
  anchor: any; group: any; fireOuter: any; flameOuter: any; flameCore: any;
  fireLayers: any[]; diamonds: any[]; light: any;
  sparkN = 0; sparkVel: any[]; sparks: any;
  power = 0; time = 0; scale = 1;

  constructor(anchor) {
    this.anchor = anchor;
    this.group = new THREE.Group();
    anchor.add(this.group);
    // 三层体积火焰：外焰（宽而暗）/ 内焰（主体）/ 核心（白热）
    this.fireOuter = new THREE.Mesh(
      new THREE.ConeGeometry(.20, 1.85, 40, 20, true),
      makeFireMaterial({
        core: [2.2, 0.95, 0.28], mid: [1.5, 0.45, 0.09], outer: [0.55, 0.10, 0.02],
        len: 1.85, scroll: 4.2, density: .78, sharp: 1.7,
      }));
    this.fireOuter.rotation.x = Math.PI;              // 指向 -Y
    this.fireOuter.position.y = -.92;

    this.flameOuter = new THREE.Mesh(
      new THREE.ConeGeometry(.155, 1.55, 40, 20, true),
      makeFireMaterial({
        core: [5.2, 3.6, 2.1], mid: [2.6, 1.05, 0.22], outer: [1.00, 0.22, 0.04],
        len: 1.55, scroll: 6.4, density: 1.0, sharp: 1.35,
      }));
    this.flameOuter.rotation.x = Math.PI;
    this.flameOuter.position.y = -.78;

    this.flameCore = new THREE.Mesh(
      new THREE.ConeGeometry(.075, .92, 28, 16, true),
      makeFireMaterial({
        core: [8.5, 7.4, 5.6], mid: [5.0, 3.2, 1.3], outer: [2.4, 1.0, 0.22],
        len: .92, scroll: 9.5, density: 1.25, sharp: 1.05,
      }));
    this.flameCore.rotation.x = Math.PI;
    this.flameCore.position.y = -.46;

    this.fireLayers = [this.fireOuter, this.flameOuter, this.flameCore];
    this.group.add(this.fireOuter, this.flameOuter, this.flameCore);
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
  /** 世界尺度适配：光的作用半径必须跟着放大，
      否则强度按面积补偿了、半径却还停在机库的 12 m，
      近处会直接过曝成一团白光把弹体糊掉。 */
  setDistance(scale) { this.light.distance = 12 * Math.max(scale, 1); }
  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;
    const flick = .82 + .18 * Math.sin(this.time * 47) + .1 * Math.sin(this.time * 91 + 1.3);
    // 火焰外形：长度/宽度随推力增长，叠加高频抖动
    const grow = this.power * flick * 1.5;
    const W = (.16 + .05 * flick) * (.5 + this.power * .75);
    this.fireOuter.scale.set((W / .16) * 1.12, grow * 1.08, (W / .16) * 1.12);
    this.flameOuter.scale.set(W / .16, grow, W / .16);
    this.flameCore.scale.set((W / .16) * (.9 + .16 * flick), grow * .95, (W / .16) * (.9 + .16 * flick));
    // 体积火焰 shader：时间 + 推力档
    const pw = THREE.MathUtils.clamp(this.power * flick * 1.12, 0, 1.3);
    for (const m of this.fireLayers) {
      const u = m.material.uniforms;
      u.uTime.value = this.time;
      u.uPower.value = pw;
    }
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
  max = 0; n = 0; positions: Float32Array; colors: Float32Array;
  line: any; _minV = 260; _maxV = 1250;

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
  scene: any; parts: any[]; tex: any; N = 0; points: any; ring: any; flash: any;
  active = false; t = 0; center: any; vel: any[]; size = 1;

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
  const L = lenM;
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x46545f, metalness: .42, roughness: .55 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x313e49, metalness: .35, roughness: .7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222b33, metalness: .5, roughness: .5 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x8a99a6, metalness: .7, roughness: .35 });

  /* 船体：甲板轮廓挤出，尖艏方艉（不再是一块方盒子） */
  const shp = new THREE.Shape();
  shp.moveTo(-L * .5, 0);
  shp.quadraticCurveTo(-L * .10, -L * .135, L * .02, -L * .13);
  shp.quadraticCurveTo(L * .34, -L * .125, L * .5, 0);      // 艏侧
  shp.quadraticCurveTo(L * .34, L * .125, L * .02, L * .13);
  shp.quadraticCurveTo(-L * .10, L * .135, -L * .5, 0);     // 艉侧
  const hg = new THREE.ExtrudeGeometry(shp, { depth: L * .34, bevelEnabled: false, curveSegments: 24 });
  hg.rotateX(-Math.PI / 2);                                 // 挤出方向 → +Y
  const hull = new THREE.Mesh(hg, hullMat);
  hull.scale.set(1, .30, 1);                                // 压扁成船型（干舷高度）
  hull.position.y = L * .045;
  g.add(hull);

  // 甲板 + 两侧舷墙
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * .86, L * .012, L * .24), deckMat);
  deck.position.y = L * .075; g.add(deck);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L * .84, L * .018, L * .01), lightMat);
    rail.position.set(0, L * .088, s * L * .122); g.add(rail);
  }
  // 上层建筑：三级舰桥 + 前向舷窗（发光）
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(L * .16, L * .07, L * .10), deckMat);
  s1.position.set(-L * .05, L * .12, 0); g.add(s1);
  const s2 = new THREE.Mesh(new THREE.BoxGeometry(L * .10, L * .05, L * .07), darkMat);
  s2.position.set(-L * .04, L * .18, 0); g.add(s2);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(L * .055, L * .032, L * .05), lightMat);
  bridge.position.set(-L * .015, L * .215, 0); g.add(bridge);
  const win = new THREE.Mesh(new THREE.BoxGeometry(L * .003, L * .014, L * .045),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ef, emissive: 0x3a7a9a, emissiveIntensity: 1.6 }));
  win.position.set(L * .013, L * .215, 0); g.add(win);
  // 烟囱 + 排烟口
  const funnel = new THREE.Mesh(new THREE.BoxGeometry(L * .05, L * .085, L * .05), darkMat);
  funnel.position.set(L * .03, L * .15, 0); g.add(funnel);
  const smoke = new THREE.Mesh(new THREE.CylinderGeometry(L * .022, L * .026, L * .02, 12), darkMat);
  smoke.position.set(L * .03, L * .202, 0); g.add(smoke);
  // 雷达桅杆 + 横梁天线 + 红白航行灯
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(L * .006, L * .009, L * .10, 8), darkMat);
  mast.position.set(-L * .05, L * .245, 0); g.add(mast);
  const radarBar = new THREE.Mesh(new THREE.BoxGeometry(L * .012, L * .006, L * .075), lightMat);
  radarBar.position.set(-L * .05, L * .295, 0); g.add(radarBar);
  const redBeacon = new THREE.Mesh(new THREE.SphereGeometry(L * .008, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff5040, emissive: 0xff4030, emissiveIntensity: 3 }));
  redBeacon.position.set(-L * .05, L * .345, 0); g.add(redBeacon);
  // 舰艉直升机坪（带标识环）
  const heli = new THREE.Mesh(new THREE.CylinderGeometry(L * .11, L * .11, L * .008, 28), darkMat);
  heli.position.set(L * .30, L * .078, 0); g.add(heli);
  const heliRing = new THREE.Mesh(new THREE.RingGeometry(L * .10, L * .105, 32),
    new THREE.MeshBasicMaterial({ color: 0x7f8a94, transparent: true, opacity: .55, side: THREE.DoubleSide }));
  heliRing.rotation.x = -Math.PI / 2; heliRing.position.set(L * .30, L * .084, 0); g.add(heliRing);
  // 舰艏主炮（示意）
  const gun = new THREE.Mesh(new THREE.BoxGeometry(L * .045, L * .02, L * .045), darkMat);
  gun.position.set(L * .34, L * .088, 0); g.add(gun);
  return g;
}
