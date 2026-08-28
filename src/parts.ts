// ============================================================
// 立体课本 · 导弹实验台 — 弹体建模 v2（高精度重构版）
// 程序化装配一枚通用战术导弹（教学示意布局，Y 轴朝上为“前”）
//   · 全弹蒙皮共享一张程序化 PBR 贴图（舱段缝/铆钉/喷涂标识/磨损）
//   · 切线卵形天线罩 + 空速管，真实翼型弹翼 + 翼尖滚转舵
//   · 星型内燃药柱（燃烧退移动态重建）、拉瓦尔喷管 + 推力构架
//   · 剖视可见：导引头万向位标器 / 预制破片环 / 电路板组 / 药柱
// 布局自下而上：喷管 → 发动机 → 制导舱 → 引信环 → 战斗部 → 导引头 → 天线罩
// ============================================================
import * as THREE from 'three';

const DEG = Math.PI / 180;
const R = .24;                       // 弹体半径（保持与整弹尺寸一致）

/* ============================================================
   程序化贴图：一张全局蒙皮（albedo / roughness / normal）
   UV 约定：lathe 的 u=环向 0..1，v 由“世界 Y”线性映射（跨部件连续）
   ============================================================ */
const BODY_Y0 = -2.85, BODY_Y1 = 3.06;          // 蒙皮覆盖的世界 Y 范围
const TW = 1024, TH = 2048;                       // albedo/normal 画布
const worldYToCanvasY = y => (1 - (y - BODY_Y0) / (BODY_Y1 - BODY_Y0)) * TH;

// 主体标注（与 v 对齐的环缝位置，用于画缝线+铆钉）
const SEAMS = [2.18, 1.84, 1.22, 1.245, 1.13, 1.19, .61, .58, .54, -.95, -2.44, -2.60];

function makeBodyMaps() {
  /* ---- albedo ---- */
  const alb = document.createElement('canvas'); alb.width = TW; alb.height = TH;
  const a = alb.getContext('2d');
  a.fillStyle = '#ccd3da'; a.fillRect(0, 0, TW, TH);
  // 磨损斑点
  for (let i = 0; i < 2200; i++) {
    a.fillStyle = `rgba(${118 + Math.random() * 44 | 0},${124 + Math.random() * 44 | 0},${132 + Math.random() * 44 | 0},${.04 + Math.random() * .09})`;
    a.beginPath(); a.arc(Math.random() * TW, Math.random() * TH, .4 + Math.random() * 2.2, 0, 7); a.fill();
  }
  // 气流方向流痕
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * TW;
    a.strokeStyle = `rgba(96,104,116,${.03 + Math.random() * .05})`;
    a.lineWidth = 1 + Math.random() * 2;
    a.beginPath(); a.moveTo(x, Math.random() * TH * .35);
    a.lineTo(x + (Math.random() - .5) * 10, TH); a.stroke();
  }
  // 舱段缝（深色线）+ 铆钉排
  for (const yw of SEAMS) {
    const y = worldYToCanvasY(yw);
    a.strokeStyle = 'rgba(52,60,70,.85)'; a.lineWidth = 3;
    a.beginPath(); a.moveTo(0, y); a.lineTo(TW, y); a.stroke();
    a.strokeStyle = 'rgba(255,255,255,.28)'; a.lineWidth = 1;
    a.beginPath(); a.moveTo(0, y + 2.5); a.lineTo(TW, y + 2.5); a.stroke();
    // 双排铆钉
    for (const dy of [-9, 9]) {
      for (let x = 6; x < TW; x += 14) {
        if (Math.random() < .28) continue;
        a.fillStyle = 'rgba(70,78,88,.8)';
        a.beginPath(); a.arc(x + Math.random() * 2, y + dy, 1.6, 0, 7); a.fill();
        a.fillStyle = 'rgba(240,244,248,.5)';
        a.beginPath(); a.arc(x + Math.random() * 2 - .5, y + dy - .6, .7, 0, 7); a.fill();
      }
    }
  }
  // 纵向口盖（检修盖板矩形 ×4）
  for (const [x0, yw, w, h] of [[.12, 1.45, 70, 120], [.55, .05, 84, 150], [.78, -1.45, 70, 120], [.3, -2.0, 60, 90]]) {
    const y = worldYToCanvasY(yw);
    a.strokeStyle = 'rgba(60,68,78,.7)'; a.lineWidth = 2;
    a.strokeRect(x0 * TW, y - h / 2, w, h);
    a.fillStyle = 'rgba(255,255,255,.05)'; a.fillRect(x0 * TW + 2, y - h / 2 + 2, w - 4, h - 4);
    for (const [cx, cy] of [[x0 * TW + 6, y - h / 2 + 6], [x0 * TW + w - 6, y - h / 2 + 6], [x0 * TW + 6, y + h / 2 - 6], [x0 * TW + w - 6, y + h / 2 - 6]]) {
      a.fillStyle = 'rgba(70,78,88,.85)'; a.beginPath(); a.arc(cx, cy, 2, 0, 7); a.fill();
    }
  }
  // ---- 喷涂标识 ----
  function stamp(text, uFrac, yWorld, px, color, font = 'bold') {
    const x = uFrac * TW, y = worldYToCanvasY(yWorld);
    a.save(); a.translate(x, y); a.rotate(-Math.PI / 2);
    a.scale(2.0, 1);                       // 修正 u/v 像素纵横比
    a.fillStyle = color;
    a.font = `${font} ${px}px 'Arial', sans-serif`;
    a.textAlign = 'center'; a.textBaseline = 'middle';
    a.fillText(text, 0, 0); a.restore();
  }
  stamp('MLAB-02', .30, -.6, 34, 'rgba(40,52,66,.9)');
  stamp('POP-UP TEXTBOOK · INTERACTIVE LAB', .30, -1.15, 15, 'rgba(60,72,86,.75)');
  stamp('LIFT HERE', .62, .05, 20, 'rgba(30,36,44,.8)');
  // 吊装三角
  for (const u of [.60, .64]) {
    a.save(); a.translate(u * TW, worldYToCanvasY(.28)); a.rotate(-Math.PI / 2);
    a.fillStyle = 'rgba(20,26,34,.85)';
    a.beginPath(); a.moveTo(0, -9); a.lineTo(8, 6); a.lineTo(-8, 6); a.closePath(); a.fill();
    a.restore();
  }
  // NO STEP 警示框（尾部 ×2）
  for (const u of [.18, .68]) {
    const x = u * TW, y = worldYToCanvasY(-1.95);
    a.save(); a.translate(x, y); a.rotate(-Math.PI / 2);
    a.strokeStyle = 'rgba(178,32,32,.9)'; a.lineWidth = 3;
    a.strokeRect(-44, -13, 88, 26);
    a.fillStyle = 'rgba(178,32,32,.9)';
    a.font = 'bold 17px Arial'; a.textAlign = 'center'; a.textBaseline = 'middle';
    a.fillText('NO STEP', 0, 1);
    a.restore();
  }
  // 战斗部警示
  stamp('HIGH EXPLOSIVE', .5, 1.5, 13, 'rgba(170,36,36,.85)');
  stamp('EXERCISE', .82, 1.68, 13, 'rgba(48,88,60,.85)');
  // 中性机徽（圆环+三角标）
  {
    const x = .5 * TW, y = worldYToCanvasY(1.62);
    a.save(); a.translate(x, y); a.rotate(-Math.PI / 2); a.scale(2, 1);
    a.strokeStyle = 'rgba(38,50,64,.9)'; a.lineWidth = 4;
    a.beginPath(); a.arc(0, 0, 22, 0, 7); a.stroke();
    a.fillStyle = 'rgba(38,50,64,.9)';
    a.beginPath(); a.moveTo(0, -13); a.lineTo(12, 9); a.lineTo(-12, 9); a.closePath(); a.fill();
    a.restore();
  }
  // 静压孔
  a.fillStyle = 'rgba(30,34,40,.9)';
  a.beginPath(); a.arc(.42 * TW, worldYToCanvasY(1.02), 3.5, 0, 7); a.fill();
  a.beginPath(); a.arc(.44 * TW, worldYToCanvasY(1.02), 3.5, 0, 7); a.fill();

  /* ---- roughness ---- */
  const rw = 512, rh = 1024;
  const rgh = document.createElement('canvas'); rgh.width = rw; rgh.height = rh;
  const g = rgh.getContext('2d');
  g.fillStyle = 'rgb(112,112,112)'; g.fillRect(0, 0, rw, rh);       // 基础 .44
  for (let i = 0; i < 900; i++) {                                    // 磨光磨损斑
    g.fillStyle = `rgba(${64 + Math.random() * 40 | 0},0,0,${.1 + Math.random() * .15})`;
    g.fillStyle = `rgba(70,70,70,${.1 + Math.random() * .18})`;
    g.beginPath(); g.arc(Math.random() * rw, Math.random() * rh, 1 + Math.random() * 7, 0, 7); g.fill();
  }
  for (const yw of SEAMS) {                                          // 缝隙更粗糙
    const y = worldYToCanvasY(yw) / 2;
    g.fillStyle = 'rgb(196,196,196)'; g.fillRect(0, y - 2, rw, 4);
  }

  /* ---- height → normal ---- */
  const hcv = document.createElement('canvas'); hcv.width = TW; hcv.height = TH;
  const h = hcv.getContext('2d');
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, TW, TH);
  for (const yw of SEAMS) {                                          // 缝=凹槽
    const y = worldYToCanvasY(yw);
    h.fillStyle = 'rgb(70,70,70)'; h.fillRect(0, y - 3, TW, 6);
    h.fillStyle = 'rgb(150,150,150)'; h.fillRect(0, y - 5, TW, 2); h.fillRect(0, y + 3, TW, 2);
  }
  for (const yw of SEAMS) {                                          // 铆钉=凸点
    const y = worldYToCanvasY(yw);
    for (const dy of [-9, 9]) for (let x = 6; x < TW; x += 14) {
      if ((x / 14 | 0) % 7 === 3) continue;
      const rg = h.createRadialGradient(x, y + dy, 0, x, y + dy, 3);
      rg.addColorStop(0, 'rgb(215,215,215)'); rg.addColorStop(1, 'rgb(128,128,128)');
      h.fillStyle = rg; h.beginPath(); h.arc(x, y + dy, 3, 0, 7); h.fill();
    }
  }
  for (let i = 0; i < 500; i++) {                                  // 蒙皮凹坑
    h.fillStyle = 'rgba(110,110,110,.2)';
    h.beginPath(); h.arc(Math.random() * TW, Math.random() * TH, 1 + Math.random() * 4, 0, 7); h.fill();
  }
  const nrm = heightToNormal(hcv, 2.2);

  const mkTex = cv => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
    t.colorSpace = (cv === alb) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  return { map: mkTex(alb), roughnessMap: mkTex(rgh), normalMap: mkTex(nrm) };
}

/* 高度图 → 切线空间法线图 */
function heightToNormal(hCanvas, strength = 2) {
  const w = hCanvas.width, hh = hCanvas.height;
  const src = hCanvas.getContext('2d').getImageData(0, 0, w, hh).data;
  const out = document.createElement('canvas'); out.width = w; out.height = hh;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, hh), d = img.data;
  const hAt = (x, y) => { x = (x + w) % w; y = (y + hh) % hh; return src[(y * w + x) * 4] / 255; };
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const dx = (hAt(x - 1, y) - hAt(x + 1, y)) * strength;
    const dy = (hAt(x, y - 1) - hAt(x, y + 1)) * strength;
    const len = Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * w + x) * 4;
    d[i] = ((dx / len) * .5 + .5) * 255;
    d[i + 1] = ((dy / len) * .5 + .5) * 255;
    d[i + 2] = (1 / len) * .5 * 255 + 127.5;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ============================================================
   材质库
   ============================================================ */
function makeMats(maps) {
  const M = {};
  // 主蒙皮：冷灰漆面 + 清漆 + 全套贴图
  M.paint = new THREE.MeshPhysicalMaterial({
    name: 'paint', map: maps.map, roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(.65, .65),
    metalness: .22, roughness: 1, clearcoat: .55, clearcoatRoughness: .38,
    envMapIntensity: 1.25, side: THREE.DoubleSide,
  });
  // 天线罩：微透陶瓷漆
  M.radome = new THREE.MeshPhysicalMaterial({
    name: 'radome', map: maps.map, roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
    metalness: .12, roughness: .9, clearcoat: .8, clearcoatRoughness: .2,
    transparent: true, opacity: .82, envMapIntensity: 1.4, side: THREE.DoubleSide,
  });
  // 弹翼漆面
  M.fin = new THREE.MeshPhysicalMaterial({
    name: 'fin', color: 0x99a3ad, metalness: .3, roughness: .34,
    clearcoat: .6, clearcoatRoughness: .3, envMapIntensity: 1.3, side: THREE.DoubleSide,
  });
  M.steel = new THREE.MeshStandardMaterial({ name: 'steel', color: 0xaebccb, metalness: .85, roughness: .3, side: THREE.DoubleSide });
  M.steelDark = new THREE.MeshStandardMaterial({ name: 'steelDark', color: 0x232a33, metalness: .7, roughness: .45, side: THREE.DoubleSide });
  M.panel = new THREE.MeshStandardMaterial({ name: 'panel', color: 0x39424e, metalness: .62, roughness: .42, side: THREE.DoubleSide });
  M.accent = new THREE.MeshStandardMaterial({ name: 'accent', color: 0xffab3f, metalness: .3, roughness: .42, emissive: 0x593407, emissiveIntensity: .4 });
  M.radomeGlass = new THREE.MeshPhysicalMaterial({ name: 'radomeGlass', color: 0x9fd8ef, metalness: .1, roughness: .08, clearcoat: 1, transparent: true, opacity: .55 });
  M.glass = new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x6fc7e8, metalness: .9, roughness: .1, clearcoat: 1 });
  M.grain = new THREE.MeshStandardMaterial({ name: 'grain', color: 0x9b8570, metalness: .02, roughness: .93, side: THREE.DoubleSide });
  M.ablative = new THREE.MeshStandardMaterial({ name: 'ablative', color: 0x181c22, metalness: .25, roughness: .72, side: THREE.DoubleSide });
  M.copper = new THREE.MeshStandardMaterial({ name: 'copper', color: 0xc98b46, metalness: .95, roughness: .28 });
  M.innerDark = new THREE.MeshStandardMaterial({ name: 'innerDark', color: 0x11161d, metalness: .35, roughness: .68, side: THREE.DoubleSide });
  M.pcboard = new THREE.MeshStandardMaterial({ name: 'pcboard', color: 0x2f6e4f, metalness: .15, roughness: .58, side: THREE.DoubleSide });
  M.charge = new THREE.MeshStandardMaterial({ name: 'charge', color: 0xc9a86a, metalness: .05, roughness: .8 });
  M.frag = new THREE.MeshStandardMaterial({ name: 'frag', color: 0x8f98a2, metalness: .9, roughness: .35 });
  M.rubber = new THREE.MeshStandardMaterial({ name: 'rubber', color: 0x1a1e24, metalness: .1, roughness: .92 });
  for (const k in M) if (!('envMapIntensity' in M[k])) M[k].envMapIntensity = 1.2;
  return M;
}

/* ============================================================
   几何工具
   ============================================================ */
function lathePts(pts, seg = 72) {
  return new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
}
// 蒙皮 lathe：按“世界 Y”重映射 v（跨部件贴图连续），并整体启用贴图
function skinLathe(pts, mat, seg = 72) {
  const geo = lathePts(pts, seg);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const wy = pos.getY(i);
    uv.setXY(i, uv.getX(i), (wy - BODY_Y0) / (BODY_Y1 - BODY_Y0));
  }
  uv.needsUpdate = true;
  return new THREE.Mesh(geo, mat);
}
// 切线卵形（tangent ogive）轮廓：s=0 底部 → 1 尖端
function tangentOgivePts(R, L, n = 48) {
  const rho = (R * R + L * L) / (2 * R);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;                           // s=0 底部 → 1 尖端
    const r = Math.max(Math.sqrt(rho * rho - L * L * s * s) - (rho - R), .013);
    pts.push([r, L * s]);
  }
  return pts;
}
// 星型药柱截面 Shape（内燃星孔）
function starGrainShape(rValley, rTip, n = 8) {
  const s = new THREE.Shape();
  const step = Math.PI / n;
  for (let i = 0; i < n; i++) {
    const aT = i * 2 * step;                        // 星尖角
    const aV1 = aT - step * .55, aV2 = aT + step * .55;   // 谷底两侧
    if (i === 0) s.moveTo(Math.cos(aV1) * rValley, Math.sin(aV1) * rValley);
    else s.lineTo(Math.cos(aV1) * rValley, Math.sin(aV1) * rValley);
    s.lineTo(Math.cos(aT - step * .16) * rTip, Math.sin(aT - step * .16) * rTip);
    s.lineTo(Math.cos(aT + step * .16) * rTip, Math.sin(aT + step * .16) * rTip);
    s.lineTo(Math.cos(aV2) * rValley, Math.sin(aV2) * rValley);
  }
  s.closePath();
  return s;
}
// 沿路径的管线（线缆）
function cableTube(points, r, mat, seg = 32) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8), mat);
}

/* ============================================================
   主构建
   ============================================================ */
export function buildMissile() {
  const maps = makeBodyMaps();
  const mats = makeMats(maps);
  const root = new THREE.Group();
  root.name = 'MISSILE';
  let nozzleTip = null;

  /* ====== P1 天线罩（切线卵形 + 空速管）====== */
  const gRadome = new THREE.Group(); gRadome.name = 'radome';
  {
    const shell = skinLathe(tangentOgivePts(R, .88).map(([r, y]) => [r, y + 2.18]), mats.radome, 84);
    gRadome.add(shell);
    // 罩基座金属环
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.015, R * 1.015, .05, 72, 1, true), mats.steel);
    base.position.y = 2.2; gRadome.add(base);
    // 空速管
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(.008, .011, .16, 12), mats.steel);
    pitot.position.y = 3.10; gRadome.add(pitot);
    const tipCap = new THREE.Mesh(new THREE.SphereGeometry(.013, 16, 12), mats.steelDark);
    tipCap.position.y = 3.045; gRadome.add(tipCap);
  }

  /* ====== P2 导引头位标器（罩内，剖视可见）====== */
  const gSeeker = new THREE.Group(); gSeeker.name = 'seeker';
  {
    const bay = new THREE.Mesh(new THREE.CylinderGeometry(R * .97, R * .97, .3, 48, 1, true), mats.innerDark);
    bay.position.y = 2.03; gSeeker.add(bay);
    const bayPlate = new THREE.Mesh(new THREE.CylinderGeometry(R * .97, R * .97, .015, 48), mats.panel);
    bayPlate.position.y = 1.885; gSeeker.add(bayPlate);
    // 万向环 + 随动架
    const gimbal = new THREE.Mesh(new THREE.TorusGeometry(.135, .016, 12, 48), mats.copper);
    gimbal.rotation.x = Math.PI / 2; gimbal.position.y = 2.07; gSeeker.add(gimbal);
    const gimbal2 = new THREE.Mesh(new THREE.TorusGeometry(.10, .011, 10, 40), mats.steel);
    gimbal2.rotation.x = Math.PI / 2; gimbal2.position.y = 2.10; gSeeker.add(gimbal2);
    for (let i = 0; i < 4; i++) {          // 万向支架耳
      const lug = new THREE.Mesh(new THREE.BoxGeometry(.02, .05, .02), mats.copper);
      const a = i * 90 * DEG + 45 * DEG;
      lug.position.set(Math.cos(a) * .135, 2.075, Math.sin(a) * .135);
      gSeeker.add(lug);
    }
    // 抛物面天线 + 馈源
    const dish = new THREE.Mesh(new THREE.SphereGeometry(.125, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2.8), mats.glass);
    dish.scale.y = .5; dish.position.y = 2.10; gSeeker.add(dish);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(.014, .028, .07, 12), mats.copper);
    feed.position.y = 2.155; gSeeker.add(feed);
    const feedTip = new THREE.Mesh(new THREE.SphereGeometry(.016, 12, 10), mats.copper);
    feedTip.position.y = 2.19; gSeeker.add(feedTip);
    gSeeker.add(cableTube([[0, 1.9, .1], [.06, 1.98, .12], [.03, 2.05, .14]], .008, mats.rubber));
  }

  /* ====== P3 战斗部舱（壳体 + 预制破片芯）====== */
  const gWar = new THREE.Group(); gWar.name = 'warhead';
  {
    const shell = skinLathe([[R * 1.03, 1.225], [R * 1.03, 1.815], [R * 1.0, 1.84]], mats.paint, 72);
    gWar.add(shell);
    const shellTop = skinLathe([[R * 1.0, 1.84], [R * .985, 1.855], [R * .9, 1.865]], mats.paint, 72);
    gWar.add(shellTop);
    // 端框
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(R * 1.03, .012, 10, 64), mats.steel);
    ring1.rotation.x = Math.PI / 2; ring1.position.y = 1.23; gWar.add(ring1);
    // 主装药柱
    const charge = new THREE.Mesh(new THREE.CylinderGeometry(R * .62, R * .62, .54, 40), mats.charge);
    charge.position.y = 1.53; gWar.add(charge);
    // 预制破片环（立方体阵）
    const fragGeo = new THREE.BoxGeometry(.036, .03, .036);
    const fragCnt = 3 * 44;
    const frags = new THREE.InstancedMesh(fragGeo, mats.frag, fragCnt);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let idx = 0;
    for (let ring = 0; ring < 3; ring++) {
      const yy = 1.38 + ring * .15, rr = R * .78 + (ring % 2) * .02;
      for (let i = 0; i < 44; i++) {
        const a = i / 44 * Math.PI * 2 + ring * .12;
        e.set(Math.random() * .3, a, Math.random() * .3); q.setFromEuler(e);
        m4.compose(new THREE.Vector3(Math.cos(a) * rr, yy, Math.sin(a) * rr), q, new THREE.Vector3(1, 1, 1));
        frags.setMatrixAt(idx++, m4);
      }
    }
    gWar.add(frags);
  }

  /* ====== P4 近炸引信环 ====== */
  const gFuze = new THREE.Group(); gFuze.name = 'fuze';
  {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.055, R * 1.055, .115, 72, 1, true), mats.accent);
    band.position.y = 1.187; gFuze.add(band);
    for (let i = 0; i < 4; i++) {          // 激光窗口
      const a = i * 90 * DEG + 45 * DEG;
      const win = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .012), mats.radomeGlass);
      win.position.set(Math.cos(a) * R * 1.055, 1.187, Math.sin(a) * R * 1.055);
      win.rotation.y = -a; gFuze.add(win);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.055, .01, 8, 64), mats.steelDark);
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.245; gFuze.add(ring);
  }

  /* ====== P5 制导控制舱（含线缆/电路板/IMU）====== */
  const gAvio = new THREE.Group(); gAvio.name = 'avionics';
  {
    const shell = skinLathe([[R, .615], [R, 1.19], [R * 1.0, 1.21]], mats.paint, 72);
    gAvio.add(shell);
    // 线缆槽（跨部件连续，同在 +Z）
    const race = new THREE.Mesh(new THREE.BoxGeometry(.05, .56, .028), mats.panel);
    race.position.set(0, .9, R * .99); gAvio.add(race);
    // 脱落连接器
    const umb = new THREE.Mesh(new THREE.BoxGeometry(.09, .07, .03), mats.steelDark);
    umb.position.set(0, .68, R * 1.0); gAvio.add(umb);
    for (let i = 0; i < 3; i++) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .012, 8), mats.copper);
      pin.rotation.x = Math.PI / 2; pin.position.set(-.025 + i * .025, .68, R * 1.016);
      gAvio.add(pin);
    }
    // 内部：四层电路板 + 元件（板宽取内接方形，避免角穿出壳体）
    const bdW = R * 1.26;
    for (let i = 0; i < 4; i++) {
      const bd = new THREE.Mesh(new THREE.BoxGeometry(bdW, .014, bdW), mats.pcboard);
      bd.position.y = .70 + i * .13; gAvio.add(bd);
      for (let c = 0; c < 3; c++) {
        const chip = new THREE.Mesh(new THREE.BoxGeometry(.04 + Math.random() * .04, .014, .04 + Math.random() * .04), mats.innerDark);
        chip.position.set((Math.random() - .5) * bdW * .8, .016, (Math.random() - .5) * bdW * .8);
        bd.add(chip);
      }
    }
    const imu = new THREE.Mesh(new THREE.BoxGeometry(.16, .12, .16), mats.copper);
    imu.position.set(.05, 1.06, 0); gAvio.add(imu);
    const batt = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .1, 24), mats.steelDark);
    batt.position.set(-.08, 1.06, .04); gAvio.add(batt);
    gAvio.add(cableTube([[-.05, .66, .1], [.09, .78, .1], [.02, .95, .12], [-.09, 1.1, .06]], .008, mats.rubber));
  }

  /* ====== P6 固体发动机（壳体 + 星型药柱 + 点火器）====== */
  const gMotor = new THREE.Group(); gMotor.name = 'motor';
  let grainMesh = null;
  {
    // 壳体（含船尾收锥）
    const shell = skinLathe([
      [.19, -2.85], [.21, -2.80], [R, -2.70], [R, .56], [R * .99, .60],
    ], mats.paint, 84);
    gMotor.add(shell);
    const race = new THREE.Mesh(new THREE.BoxGeometry(.05, 3.1, .028), mats.panel);
    race.position.set(0, -1.0, R * .99); gMotor.add(race);
    // 焊缝环
    for (const yy of [.54, -.95, -2.44]) {
      const weld = new THREE.Mesh(new THREE.TorusGeometry(R * 1.004, .011, 10, 72), mats.steelDark);
      weld.rotation.x = Math.PI / 2; weld.position.y = yy; gMotor.add(weld);
    }
    // 前封头（椭球）
    const fwdDome = new THREE.Mesh(new THREE.SphereGeometry(R * .99, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mats.steel);
    fwdDome.scale.y = .5; fwdDome.position.y = .56; gMotor.add(fwdDome);
    // 星型药柱（可燃退移）
    const GRAIN_H = 2.9, R_OUT = R * .965;
    function grainGeo(rValley, rTip) {
      const geo = new THREE.ExtrudeGeometry(starGrainShape(rValley, rTip), { depth: GRAIN_H, bevelEnabled: false, curveSegments: 6 });
      geo.rotateX(-Math.PI / 2);            // z→y
      return geo;
    }
    const R_TIP0 = .17;
    grainMesh = new THREE.Mesh(grainGeo(.08, R_TIP0), mats.grain);
    grainMesh.position.y = -.95; gMotor.add(grainMesh);
    gMotor.userData.updateBurn = function (frac) {  // frac 0..1
      const rv = .08 + frac * (R_TIP0 - .015 - .08);
      grainMesh.geometry.dispose();
      grainMesh.geometry = grainGeo(rv, R_TIP0);
    };
    // 点火器
    const igniter = new THREE.Mesh(new THREE.CylinderGeometry(.03, .035, .3, 16), mats.steelDark);
    igniter.position.y = .42; gMotor.add(igniter);
    const ignHead = new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 12), mats.copper);
    ignHead.position.y = .58; gMotor.add(ignHead);
    // 尾封收口
    const aftRing = new THREE.Mesh(new THREE.TorusGeometry(.19, .014, 10, 48), mats.steel);
    aftRing.rotation.x = Math.PI / 2; aftRing.position.y = -2.85; gMotor.add(aftRing);
  }

  /* ====== P7 喷管组件（拉瓦尔 + 推力构架）====== */
  const gNozzle = new THREE.Group(); gNozzle.name = 'nozzle';
  {
    const prof = [
      [.218, -3.66], [.195, -3.5], [.16, -3.3], [.125, -3.12], [.098, -3.0], [.092, -2.945],
      [.098, -2.90], [.14, -2.78], [.19, -2.66], [.215, -2.60],
    ];
    const curve = new THREE.CatmullRomCurve3(prof.map(p => new THREE.Vector3(p[0], p[1], 0)));
    const sm = curve.getPoints(60).map(p => [Math.max(p.x, .02), p.y]);
    const bell = skinLathe(sm, mats.ablative, 72);
    gNozzle.add(bell);
    // 喉衬
    const throat = new THREE.Mesh(new THREE.TorusGeometry(.096, .02, 12, 48), mats.copper);
    throat.rotation.x = Math.PI / 2; throat.position.y = -2.945; gNozzle.add(throat);
    // 出口加强缘
    const lip = new THREE.Mesh(new THREE.TorusGeometry(.218, .012, 10, 56), mats.steelDark);
    lip.rotation.x = Math.PI / 2; lip.position.y = -3.66; gNozzle.add(lip);
    // 推力构架：6 根撑杆 + 承力环
    const thrustRing = new THREE.Mesh(new THREE.TorusGeometry(.19, .013, 10, 48), mats.steel);
    thrustRing.rotation.x = Math.PI / 2; thrustRing.position.y = -2.63; gNozzle.add(thrustRing);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 15 * DEG;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .28, 8), mats.steel);
      strut.position.set(Math.cos(a) * .185, -2.75, Math.sin(a) * .185);
      strut.rotation.x = Math.sin(a) * .35; strut.rotation.z = -Math.cos(a) * .35;
      gNozzle.add(strut);
    }
    // TVC 作动器支座 ×2
    for (const s of [-1, 1]) {
      const act = new THREE.Mesh(new THREE.BoxGeometry(.06, .09, .08), mats.steelDark);
      act.position.set(0, -2.66, s * .21); gNozzle.add(act);
    }
    nozzleTip = new THREE.Object3D(); nozzleTip.position.y = -3.7;
    nozzleTip.name = 'nozzleTip'; gNozzle.add(nozzleTip);
  }

  /* ====== P8 尾部空气舵 ×4（翼型剖面 + 滚转舵）====== */
  const gFins = new THREE.Group(); gFins.name = 'fins';
  const finDirs = [];
  {
    // 平面形状：后掠梯形（x=展向, y=弦向）
    const shape = new THREE.Shape();
    shape.moveTo(0, .30); shape.lineTo(.40, .10); shape.lineTo(.52, -.06);
    shape.lineTo(.52, -.20); shape.lineTo(0, -.30); shape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(shape, {
      depth: .012, bevelEnabled: true, bevelThickness: .011, bevelSize: .014, bevelSegments: 3,
    });
    finGeo.translate(0, 0, -.006);
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      const ang = i * 90 * DEG + 45 * DEG;
      const fin = new THREE.Mesh(finGeo, mats.fin);
      holder.add(fin);
      // 根部整流罩
      const fair = new THREE.Mesh(new THREE.CylinderGeometry(.035, .05, .55, 12), mats.panel);
      fair.rotation.x = Math.PI / 2; fair.position.set(-.01, 0, 0);
      holder.add(fair);
      // 翼尖滚转舵（robust 小轮）
      const roller = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(.045, .014, 10, 28), mats.steelDark);
      roller.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .03, 12), mats.copper);
      hub.rotation.x = Math.PI / 2; roller.add(hub);
      roller.position.set(.46, -.02, 0);
      holder.add(roller);
      // 舵轴
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .07, 10), mats.steel);
      axle.rotation.x = Math.PI / 2; axle.position.set(.02, .02, 0);
      holder.add(axle);
      holder.position.set(Math.cos(ang) * R * .95, -2.28, Math.sin(ang) * R * .95);
      holder.rotation.y = -ang + Math.PI / 2;
      holder.userData.hingeAxis = new THREE.Vector3(0, 1, 0);
      holder.userData.baseQuat = holder.quaternion.clone();
      gFins.add(holder);
      finDirs.push({ ang, holder });
    }
  }

  /* ---------- 注册部件（锚点/爆炸方向/文案沿用 v1）---------- */
  const P = {};
  function reg(key, conf) {
    const grp = conf.grp;
    grp.userData.partKey = key;
    grp.userData.basePos = grp.position.clone();
    grp.userData.explodeDir = new THREE.Vector3(...conf.dir);
    const anchor = new THREE.Object3D();
    anchor.position.set(...conf.anchor);
    grp.add(anchor);
    P[key] = Object.assign({ key, anchor, basePos: grp.position.clone(), curOffset: new THREE.Vector3() }, conf.meta);
    root.add(grp);
    grp.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
  }

  reg('radome', { grp: gRadome, dir: [0, 2.2, 0], anchor: [0, 2.8, 0], meta: {
    name: '天线罩', en: 'RADOME',
    note: '透波夹层材料制成，既保护导引头，又让雷达波/红外信号以最小损耗穿过。',
    specs: [['结构', '复合材料薄壁'], ['气动', '切线卵形减阻'], ['损耗', '< 1 dB(示意)']],
    desc: '导弹最先接触空气的部分。<b>气动外形</b>决定阻力大小，<b>材料透波率</b>决定导引头能不能“看清”目标。',
  }});
  reg('seeker', { grp: gSeeker, dir: [0, 1.35, 0], anchor: [0, 2.16, 0.32], meta: {
    name: '导引头位标器', en: 'SEEKER',
    note: '测出“我→目标”视线转得多快，这就是比例导引需要的核心量。',
    specs: [['体制', '主动雷达(示教)'], ['视场', '±30°'], ['跟踪速率', '≥ 40°/s']],
    desc: '安装在万向支架上的天线/位标器始终盯着目标：<b>视线角速度 q̇</b> 由它实时测得，送给制导计算机解算舵令。',
  }});
  reg('warhead', { grp: gWar, dir: [0, .68, 0], anchor: [0, 1.62, 0.42], meta: {
    name: '战斗部舱', en: 'WARHEAD',
    note: '破片杀伤式：预制破片环+主装药，由引信在最佳时刻引爆。',
    specs: [['类型', '破片杀伤(科普)'], ['毁伤半径', '≈ 10 m(示意)'], ['起爆', '近炸 / 触发']],
    desc: '对付空中目标多采用<b>连续杆或破片</b>战斗部；命中时机由近炸引信测算，保证破片正好“泼”向目标。',
  }});
  reg('fuze', { grp: gFuze, dir: [0, .3, 0], anchor: [0, 1.19, 0.38], meta: {
    name: '近炸引信环', en: 'PROXIMITY FUZE',
    note: '测量弹目最近距离，在最佳脱靶点引爆战斗部；平时处于保险状态。',
    specs: [['原理', '激光/无线电'], ['作用半径', '约 8~12 m'], ['保险', '两级机械/电子']],
    desc: '导引头负责“看见”，引信负责“掐表”。当弹目距离进入威力范围且交会角合适，立刻给出<b>起爆脉冲</b>。',
  }});
  reg('avionics', { grp: gAvio, dir: [0, .02, 0], anchor: [0, .92, -0.42], meta: {
    name: '制导控制舱', en: 'GUIDANCE BAY',
    note: 'IMU+弹载计算机：解算姿态、积分导航、按制导律实时下达舵偏指令。',
    specs: [['惯导', 'IMU 三轴组合'], ['解算频率', '100 Hz'], ['供电', '热电池']],
    desc: '导弹的“大脑”。它把导引头的视线角速度和自身姿态合成为<b>过载指令</b>，再交给尾部舵机执行。',
  }});
  reg('motor', { grp: gMotor, dir: [0, -.42, 0], anchor: [0, -0.9, 0.45], meta: {
    name: '固体火箭发动机', en: 'SOLID MOTOR',
    note: '壳体即燃烧室：推进剂点燃后生成高温高压燃气，从喷管高速喷出产生推力。',
    specs: [['推进剂', '复合药(HTPB/AP)'], ['装药', '星型内燃'], ['压强', '≈ 7 MPa(示意)']],
    desc: '星型装药让燃面随燃烧稳定变化。点燃后无需氧泵——氧化剂就在药里，所以固体发动机<b>结构极简、随时待发</b>。',
  }});
  reg('nozzle', { grp: gNozzle, dir: [0, -1.15, 0], anchor: [0, -3.1, 0.3], meta: {
    name: '喷管组件', en: 'NOZZLE',
    note: '收敛–扩张造型将燃气加速到超声速；喉衬承受最猛烈的烧蚀。',
    specs: [['构型', '拉瓦尔喷管'], ['出口速度', '> 2000 m/s'], ['喉衬', '石墨/碳碳']],
    desc: '推力的真正来源：燃气动量在喷管里被换了个方向甩出去，反作用力就把导弹往前推。',
  }});
  reg('fins', { grp: gFins, dir: [0, 0, 0], anchor: [0, -2.42, 0.62], meta: {
    name: '空气舵 ×4 · 舵机', en: 'CONTROL FINS',
    note: '电动/液压舵机按指令驱动舵面偏转，产生气动力矩修正飞行方向。',
    specs: [['布置', '十字尾控'], ['舵偏范围', '±20°'], ['响应', '毫秒级']],
    desc: '飞机靠机翼升空，导弹靠尾舵“掰”自己。四个舵面协同差动，就能同时完成俯仰、偏航与滚转控制。',
  }});

  const order = ['radome', 'seeker', 'warhead', 'fuze', 'avionics', 'motor', 'nozzle', 'fins'];
  const updateBurn = gMotor.userData.updateBurn;

  /* ---------- 对外行为（API 与 v1 完全一致）---------- */
  const api = {
    root, parts: P, order,
    updateBurn, grainMesh, nozzleTip,

    setExplode(t) {
      const e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      for (const k of order) {
        const p = P[k]; const grp = p.anchor.parent;
        const target = grp.userData.basePos.clone().addScaledVector(grp.userData.explodeDir, e);
        grp.position.copy(target);
      }
      const outw = 1 + e * .5;
      finDirs.forEach(({ ang, holder }) => {
        holder.position.set(
          Math.cos(ang) * (R * .95) * outw,
          -2.28 - e * .35,
          Math.sin(ang) * (R * .95) * outw);
      });
    },

    finDirs,
    finAngle(v) {
      const dirs = (this && this.finDirs) || finDirs;
      dirs.forEach(({ holder }) => {
        holder.quaternion.copy(holder.userData.baseQuat);
        holder.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), v);
      });
    },

    /* 剖视: 只裁剪外壳蒙皮材质 */
    shellMats: [mats.paint, mats.radome, mats.fin],
    allMats: Object.values(mats),

    disposeAll() { root.traverse(o => { o.geometry && o.geometry.dispose(); }); },
  };

  api.setExplode(0);
  return api;
}
