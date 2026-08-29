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

/** 不规则多边形：漆面剥落块 / 划痕块 */
function chipPoly(ctx, cx, cy, r, n = 7) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ang = i / n * Math.PI * 2;
    const rr = r * (.52 + Math.random() * .58);
    const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}

function makeBodyMaps() {
  /* ---------- 四张画布：albedo / height / metalness / roughness ---------- */
  const alb = document.createElement('canvas'); alb.width = TW; alb.height = TH;
  const a = alb.getContext('2d');
  const hcv = document.createElement('canvas'); hcv.width = TW; hcv.height = TH;
  const h = hcv.getContext('2d');
  const mcv = document.createElement('canvas'); mcv.width = TW; mcv.height = TH;
  const mm = mcv.getContext('2d');
  const rw = 512, rh = 1024;
  const rgh = document.createElement('canvas'); rgh.width = rw; rgh.height = rh;
  const g = rgh.getContext('2d');

  /* ---------- 基底：冷灰军械漆 ---------- */
  a.fillStyle = '#8e969d'; a.fillRect(0, 0, TW, TH);
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, TW, TH);
  mm.fillStyle = 'rgb(24,24,24)'; mm.fillRect(0, 0, TW, TH);      // 漆面≈非金属
  g.fillStyle = 'rgb(112,112,112)'; g.fillRect(0, 0, rw, rh);     // 基础粗糙度 .44

  /* ---------- 整体明暗：前端受光、尾部烟熏 ---------- */
  {
    const lg = a.createLinearGradient(0, 0, 0, TH);
    lg.addColorStop(0, 'rgba(255,255,255,.09)');
    lg.addColorStop(.42, 'rgba(255,255,255,0)');
    lg.addColorStop(.80, 'rgba(26,30,36,.10)');
    lg.addColorStop(1, 'rgba(14,17,22,.30)');
    a.fillStyle = lg; a.fillRect(0, 0, TW, TH);
  }

  /* ---------- 板件级明暗扰动（破除“塑料均质感”） ---------- */
  {
    const bands = Array.from(new Set(SEAMS)).sort((p, q) => q - p);
    const cols = 6;
    for (let bi = 0; bi < bands.length - 1; bi++) {
      const yTop = worldYToCanvasY(bands[bi]);
      const yBot = worldYToCanvasY(bands[bi + 1]);
      if (yBot - yTop < 4) continue;
      for (let ci = 0; ci < cols; ci++) {
        const x0 = ci / cols * TW, x1 = (ci + 1) / cols * TW;
        const d = (Math.random() - .46) * 22;
        a.fillStyle = d > 0 ? `rgba(255,255,255,${d / 255})` : `rgba(0,0,0,${-d / 255})`;
        a.fillRect(x0, yTop, x1 - x0, yBot - yTop);
        const dr = (Math.random() - .5) * 30;
        g.fillStyle = dr > 0 ? `rgba(255,255,255,${dr / 255})` : `rgba(0,0,0,${-dr / 255})`;
        g.fillRect(x0 / 2, yTop / 2, (x1 - x0) / 2, (yBot - yTop) / 2);
      }
    }
  }

  /* ---------- 磨损 / 流痕 / 划痕 ---------- */
  for (let i = 0; i < 2600; i++) {
    a.fillStyle = `rgba(${96 + Math.random() * 58 | 0},${102 + Math.random() * 58 | 0},${110 + Math.random() * 58 | 0},${.03 + Math.random() * .1})`;
    a.beginPath(); a.arc(Math.random() * TW, Math.random() * TH, .4 + Math.random() * 2.4, 0, 7); a.fill();
  }
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * TW, y0 = Math.random() * TH * .55;
    a.strokeStyle = `rgba(68,76,88,${.03 + Math.random() * .07})`;
    a.lineWidth = .8 + Math.random() * 2.6;
    a.beginPath(); a.moveTo(x, y0);
    a.bezierCurveTo(x + (Math.random() - .5) * 14, y0 + TH * .18,
      x + (Math.random() - .5) * 20, y0 + TH * .45,
      x + (Math.random() - .5) * 8, y0 + TH * (.35 + Math.random() * .5));
    a.stroke();
  }
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * TW, y = Math.random() * TH, L = 6 + Math.random() * 44;
    a.strokeStyle = `rgba(234,239,244,${.05 + Math.random() * .13})`; a.lineWidth = .7;
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + (Math.random() - .5) * L * .28, y + L); a.stroke();
  }

  /* ---------- 漆面剥落：露出裸金属（albedo + metalness + roughness 同步） ---------- */
  for (let i = 0; i < 320; i++) {
    const cx = Math.random() * TW, cy = Math.random() * TH;
    const r = 1.3 + Math.random() * 5.6;
    a.fillStyle = 'rgba(50,56,64,.92)'; chipPoly(a, cx, cy, r * 1.32);          // 漆层断面暗边
    a.fillStyle = 'rgba(204,210,217,.95)'; chipPoly(a, cx, cy, r * .78);         // 亮金属芯
    mm.fillStyle = 'rgb(234,234,234)'; chipPoly(mm, cx, cy, r * .78);            // 裸金属
    g.fillStyle = 'rgb(72,72,72)'; chipPoly(g, cx / 2, cy / 2, r * .78 / 2);     // 磨得更光
    h.fillStyle = 'rgb(102,102,102)'; chipPoly(h, cx, cy, r * .8);               // 凹坑
  }

  /* ---------- 舱段缝 + 双排铆钉 ---------- */
  for (const yw of SEAMS) {
    const y = worldYToCanvasY(yw);
    a.fillStyle = 'rgba(0,0,0,.18)'; a.fillRect(0, y - 6, TW, 4);                // 缝周 AO
    a.fillStyle = 'rgba(36,42,50,.94)'; a.fillRect(0, y - 2, TW, 4);             // 缝
    a.fillStyle = 'rgba(255,255,255,.24)'; a.fillRect(0, y + 2.4, TW, 1.6);      // 下缘高光
    h.fillStyle = 'rgb(64,64,64)'; h.fillRect(0, y - 3, TW, 6);
    h.fillStyle = 'rgb(154,154,154)'; h.fillRect(0, y - 5, TW, 2); h.fillRect(0, y + 3, TW, 2);
    g.fillStyle = 'rgb(200,200,200)'; g.fillRect(0, y / 2 - 2, rw, 4);           // 缝内更粗糙
    for (const dy of [-10, 10]) {
      for (let x = 6; x < TW; x += 13) {
        if (Math.random() < .2) continue;
        const px = x + Math.random() * 2, py = y + dy;
        a.fillStyle = 'rgba(44,50,58,.88)'; a.beginPath(); a.arc(px, py, 2.1, 0, 7); a.fill();
        a.fillStyle = 'rgba(226,232,238,.62)'; a.beginPath(); a.arc(px - .6, py - .8, 1.0, 0, 7); a.fill();
        a.fillStyle = 'rgba(0,0,0,.22)'; a.beginPath(); a.arc(px + .7, py + .9, 1.0, 0, 7); a.fill();
        mm.fillStyle = 'rgb(214,214,214)'; a.beginPath(); mm.arc(px, py, 1.5, 0, 7); mm.fill();
        const rg = h.createRadialGradient(px, py, 0, px, py, 3.2);
        rg.addColorStop(0, 'rgb(218,218,218)'); rg.addColorStop(.7, 'rgb(150,150,150)'); rg.addColorStop(1, 'rgb(128,128,128)');
        h.fillStyle = rg; h.beginPath(); h.arc(px, py, 3.2, 0, 7); h.fill();
      }
    }
  }
  /* ---------- 纵向检修口盖 ×4（含内凹面 + 螺钉 + 拆装痕迹） ---------- */
  for (const [u0, yw, w, hh] of [[.12, 1.45, 70, 120], [.55, .05, 84, 150], [.78, -1.45, 70, 120], [.3, -2.0, 60, 90]]) {
    const x0 = u0 * TW, y = worldYToCanvasY(yw) - hh / 2;
    a.fillStyle = 'rgba(0,0,0,.20)'; a.fillRect(x0 - 2, y - 2, w + 4, hh + 4);        // 外阴影
    a.fillStyle = 'rgba(158,166,174,1)'; a.fillRect(x0, y, w, hh);                     // 盖板面
    const lg = a.createLinearGradient(x0, y, x0 + w, y + hh);
    lg.addColorStop(0, 'rgba(255,255,255,.16)'); lg.addColorStop(1, 'rgba(0,0,0,.14)');
    a.fillStyle = lg; a.fillRect(x0, y, w, hh);
    a.strokeStyle = 'rgba(34,40,48,.85)'; a.lineWidth = 2; a.strokeRect(x0, y, w, hh);
    h.fillStyle = 'rgb(112,112,112)'; h.fillRect(x0, y, w, hh);
    h.strokeStyle = 'rgb(76,76,76)'; h.lineWidth = 2; h.strokeRect(x0, y, w, hh);
    g.fillStyle = 'rgb(126,126,126)'; g.fillRect(x0 / 2, y / 2, w / 2, hh / 2);
    for (const [cx, cy] of [[x0 + 7, y + 7], [x0 + w - 7, y + 7], [x0 + 7, y + hh - 7], [x0 + w - 7, y + hh - 7],
    [x0 + w / 2, y + 7], [x0 + w / 2, y + hh - 7], [x0 + 7, y + hh / 2], [x0 + w - 7, y + hh / 2]]) {
      a.fillStyle = 'rgba(40,46,54,.9)'; a.beginPath(); a.arc(cx, cy, 2.6, 0, 7); a.fill();
      a.fillStyle = 'rgba(220,226,232,.7)'; a.beginPath(); a.arc(cx - .7, cy - .8, 1.1, 0, 7); a.fill();
      mm.fillStyle = 'rgb(220,220,220)'; a.beginPath(); mm.arc(cx, cy, 1.9, 0, 7); mm.fill();
      const rg = h.createRadialGradient(cx, cy, 0, cx, cy, 3);
      rg.addColorStop(0, 'rgb(206,206,206)'); rg.addColorStop(1, 'rgb(112,112,112)');
      h.fillStyle = rg; h.beginPath(); h.arc(cx, cy, 3, 0, 7); h.fill();
    }
    // 拆装造成的漆面磨损（口盖周围）
    for (let i = 0; i < 26; i++) {
      const ex = Math.random() < .5 ? x0 - 6 - Math.random() * 8 : x0 + w + 6 + Math.random() * 8;
      const ey = y + Math.random() * hh;
      a.fillStyle = `rgba(206,212,219,${.25 + Math.random() * .4})`;
      chipPoly(a, ex, ey, 1 + Math.random() * 2.4, 5);
      mm.fillStyle = 'rgb(220,220,220)'; chipPoly(mm, ex, ey, 1 + Math.random() * 2, 5);
    }
  }
  /* ---- 喷涂标识 ---- */
  function stamp(text, uFrac, yWorld, px, color, font = 'bold') {
    const x = uFrac * TW, y = worldYToCanvasY(yWorld);
    a.save(); a.translate(x, y); a.rotate(-Math.PI / 2);
    a.scale(2.0, 1);                       // 修正 u/v 像素纵横比
    a.fillStyle = color;
    a.font = `${font} ${px}px 'Arial', sans-serif`;
    a.textAlign = 'center'; a.textBaseline = 'middle';
    a.fillText(text, 0, 0); a.restore();
  }
  stamp('MLAB-02', .30, -.6, 34, 'rgba(28,38,50,.9)');
  stamp('POP-UP TEXTBOOK · INTERACTIVE LAB', .30, -1.15, 15, 'rgba(44,54,66,.75)');
  stamp('LIFT HERE', .62, .05, 20, 'rgba(24,30,38,.82)');
  stamp('↑ FWD', .30, .95, 15, 'rgba(28,38,50,.8)');
  // 吊装三角
  for (const u of [.60, .64]) {
    a.save(); a.translate(u * TW, worldYToCanvasY(.28)); a.rotate(-Math.PI / 2);
    a.fillStyle = 'rgba(18,24,32,.88)';
    a.beginPath(); a.moveTo(0, -9); a.lineTo(8, 6); a.lineTo(-8, 6); a.closePath(); a.fill();
    a.restore();
  }
  // NO STEP 警示框（尾部 ×2）
  for (const u of [.18, .68]) {
    const x = u * TW, y = worldYToCanvasY(-1.95);
    a.save(); a.translate(x, y); a.rotate(-Math.PI / 2);
    a.strokeStyle = 'rgba(168,30,30,.9)'; a.lineWidth = 3;
    a.strokeRect(-44, -13, 88, 26);
    a.fillStyle = 'rgba(168,30,30,.9)';
    a.font = 'bold 17px Arial'; a.textAlign = 'center'; a.textBaseline = 'middle';
    a.fillText('NO STEP', 0, 1);
    a.restore();
  }
  // 战斗部警示
  stamp('HIGH EXPLOSIVE', .5, 1.5, 13, 'rgba(160,34,34,.85)');
  stamp('EXERCISE', .82, 1.68, 13, 'rgba(44,80,56,.85)');
  // 中性机徽（圆环+三角标）
  {
    const x = .5 * TW, y = worldYToCanvasY(1.62);
    a.save(); a.translate(x, y); a.rotate(-Math.PI / 2); a.scale(2, 1);
    a.strokeStyle = 'rgba(30,40,52,.9)'; a.lineWidth = 4;
    a.beginPath(); a.arc(0, 0, 22, 0, 7); a.stroke();
    a.fillStyle = 'rgba(30,40,52,.9)';
    a.beginPath(); a.moveTo(0, -13); a.lineTo(12, 9); a.lineTo(-12, 9); a.closePath(); a.fill();
    a.restore();
  }
  // 静压孔 + 天线窗
  a.fillStyle = 'rgba(24,28,34,.92)';
  a.beginPath(); a.arc(.42 * TW, worldYToCanvasY(1.02), 3.5, 0, 7); a.fill();
  a.beginPath(); a.arc(.44 * TW, worldYToCanvasY(1.02), 3.5, 0, 7); a.fill();
  mm.fillStyle = 'rgb(180,180,180)';
  a.beginPath(); a.arc(.42 * TW, worldYToCanvasY(1.02), 3.5, 0, 7);
  mm.beginPath(); mm.arc(.42 * TW, worldYToCanvasY(1.02), 3, 0, 7); mm.fill();

  /* ---------- 数据铭牌 + 条码 ---------- */
  {
    const u = .30, y = worldYToCanvasY(-.05);
    a.save(); a.translate(u * TW, y); a.rotate(-Math.PI / 2);
    a.fillStyle = 'rgba(226,229,232,.92)'; a.fillRect(-58, -46, 116, 92);
    a.strokeStyle = 'rgba(30,36,44,.9)'; a.lineWidth = 2; a.strokeRect(-58, -46, 116, 92);
    a.fillStyle = 'rgba(28,34,42,.92)';
    a.font = 'bold 15px Arial'; a.textAlign = 'center'; a.textBaseline = 'middle';
    a.fillText('AAM / TRAINER', 0, -32);
    a.font = '11px Arial';
    a.fillText('S/N  ML-0207-EXP', 0, -14);
    a.fillText('LOT  2026-08', 0, -1);
    a.fillText('MFD  DAP-PAP LAB', 0, 12);
    for (let i = 0, x = -50; x < 50; x += 3 + Math.random() * 3, i++) {
      a.fillStyle = i % 3 === 0 ? 'rgba(20,24,30,.95)' : 'rgba(20,24,30,.6)';
      a.fillRect(x, 22, 1 + Math.random() * 2, 18);
    }
    a.restore();
    h.save(); h.translate(u * TW, y); h.rotate(-Math.PI / 2);
    h.fillStyle = 'rgb(146,146,146)'; h.fillRect(-58, -46, 116, 92);
    h.restore();
    g.save(); g.translate(u * TW / 2, y / 2); g.rotate(-Math.PI / 2);
    g.fillStyle = 'rgb(74,74,74)'; g.fillRect(-29, -23, 58, 46);
    g.restore();
  }

  /* ---------- 尾部燃气烟熏 + 流挂 ---------- */
  {
    const lg = a.createLinearGradient(0, TH * .70, 0, TH);
    lg.addColorStop(0, 'rgba(28,25,22,0)');
    lg.addColorStop(1, 'rgba(20,18,16,.52)');
    a.fillStyle = lg; a.fillRect(0, TH * .70, TW, TH * .30);
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * TW, y = TH * (.72 + Math.random() * .28);
      a.fillStyle = `rgba(18,16,14,${.04 + Math.random() * .18})`;
      a.fillRect(x, y, 1 + Math.random() * 3.5, 18 + Math.random() * 100);
    }
    g.fillStyle = 'rgba(208,208,208,.45)'; g.fillRect(0, rh * .70, rw, rh * .30);
    const lg2 = g.createLinearGradient(0, rh * .70, 0, rh);
    lg2.addColorStop(0, 'rgba(210,210,210,0)'); lg2.addColorStop(1, 'rgba(210,210,210,.6)');
    g.fillStyle = lg2; g.fillRect(0, rh * .70, rw, rh * .30);
  }

  /* ---------- roughness 细节：磨光斑 / 污渍 ---------- */
  for (let i = 0; i < 1100; i++) {
    g.fillStyle = Math.random() < .5
      ? `rgba(66,66,66,${.1 + Math.random() * .2})`
      : `rgba(168,168,168,${.06 + Math.random() * .14})`;
    g.beginPath(); g.arc(Math.random() * rw, Math.random() * rh, 1 + Math.random() * 8, 0, 7); g.fill();
  }
  for (let i = 0; i < 60; i++) {                                   // 油渍/手印
    const x = Math.random() * rw, y = Math.random() * rh, r = 6 + Math.random() * 26;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(48,48,48,.35)'); rg.addColorStop(1, 'rgba(48,48,48,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }

  /* ---------- height 细节：蒙皮凹坑 / 波纹 ---------- */
  for (let i = 0; i < 700; i++) {
    h.fillStyle = Math.random() < .5 ? 'rgba(104,104,104,.22)' : 'rgba(152,152,152,.18)';
    h.beginPath(); h.arc(Math.random() * TW, Math.random() * TH, 1 + Math.random() * 4.5, 0, 7); h.fill();
  }
  for (let i = 0; i < 40; i++) {                                   // 轻微蒙皮波纹（环向）
    const y = Math.random() * TH;
    h.strokeStyle = `rgba(${Math.random() < .5 ? 118 : 140},${Math.random() < .5 ? 118 : 140},${Math.random() < .5 ? 118 : 140},.25)`;
    h.lineWidth = 2 + Math.random() * 4;
    h.beginPath(); h.moveTo(0, y);
    h.bezierCurveTo(TW * .3, y + (Math.random() - .5) * 10, TW * .7, y + (Math.random() - .5) * 10, TW, y);
    h.stroke();
  }
  const nrm = heightToNormal(hcv, 2.6);

  const mkTex = (cv, srgb = false) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  return {
    map: mkTex(alb, true),
    roughnessMap: mkTex(rgh),
    metalnessMap: mkTex(mcv),
    normalMap: mkTex(nrm),
  };
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
  const M: any = {};
  // 主蒙皮：冷灰军械漆 + 清漆；metalness/roughness 由贴图驱动（剥落处露裸金属）
  M.paint = new THREE.MeshPhysicalMaterial({
    name: 'paint', map: maps.map, roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
    metalnessMap: maps.metalnessMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    metalness: 1, roughness: 1, clearcoat: .32, clearcoatRoughness: .26,
    envMapIntensity: 1.05, side: THREE.DoubleSide,
  });
  // 天线罩：微透陶瓷漆
  M.radome = new THREE.MeshPhysicalMaterial({
    name: 'radome', map: maps.map, roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
    metalnessMap: maps.metalnessMap,
    normalScale: new THREE.Vector2(.8, .8),
    metalness: .35, roughness: .78, clearcoat: .7, clearcoatRoughness: .18,
    transparent: true, opacity: .82, envMapIntensity: 1.2, side: THREE.DoubleSide,
  });
  // 弹翼/舵面漆面（薄锐缘、低清漆，避免“厚塑料片”）
  M.fin = new THREE.MeshPhysicalMaterial({
    name: 'fin', color: 0x767e86, metalness: .5, roughness: .4,
    clearcoat: .28, clearcoatRoughness: .34, envMapIntensity: 1.1, side: THREE.DoubleSide,
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

/* 对称翼型厚度分布（NACA 4 位系列，尖锐后缘） */
function nacaYt(xc, tc) {
  return 5 * tc * (0.2969 * Math.sqrt(xc) - 0.1260 * xc - 0.3516 * xc * xc
    + 0.2843 * xc * xc * xc - 0.1015 * xc * xc * xc * xc);
}
/* 真实翼型舵面：沿展向放样，弦长/厚度线性收缩、前缘后掠
   局部坐标：X=展向（0 为根），Y=弦向（+ 为前缘），Z=厚度 */
function airfoilFinGeometry(opt: any = {}) {
  const {
    b = .50, cr = .64, ct = .32, leRoot = .34, leTip = -.04,
    tRoot = .045, tTip = .030, xRoot = -.02, nSpan = 16, nChord = 26,
  } = opt;
  const rows = [];
  for (let i = 0; i <= nSpan; i++) {
    const s = i / nSpan;
    const X = xRoot + s * (b - xRoot);
    const c = cr + (ct - cr) * s;
    const le = leRoot + (leTip - leRoot) * s;
    const tc = tRoot + (tTip - tRoot) * s;
    const pts = [];
    for (let k = 0; k <= nChord; k++) {                  // 下表面：前缘 → 后缘
      const xc = k / nChord;
      pts.push([le - xc * c, -nacaYt(xc, tc) * c]);
    }
    for (let k = nChord - 1; k >= 1; k--) {              // 上表面：后缘 → 前缘
      const xc = k / nChord;
      pts.push([le - xc * c, +nacaYt(xc, tc) * c]);
    }
    rows.push({ X, pts });
  }
  const ring = rows[0].pts.length;                        // 2 * nChord
  const pos = [], uv = [], idx = [];
  for (const row of rows) for (let j = 0; j < ring; j++) {
    pos.push(row.X, row.pts[j][0], row.pts[j][1]);
    uv.push((row.X - xRoot) / (b - xRoot), j / ring);
  }
  for (let i = 0; i < nSpan; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b2 = i * ring + (j + 1) % ring;
    const c2 = (i + 1) * ring + j, d = (i + 1) * ring + (j + 1) % ring;
    idx.push(a, c2, b2, b2, c2, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ============================================================
   主构建
   ============================================================ */
/* ============================================================
   科幻细节层
   整机视图里弹体只有几十像素宽，这些细节是给「部件特写」和
   「拆解视图」准备的——相机飞近或舱段散开后，它们才真正被看见。
   ============================================================ */
function addSciFiDetails(root, mats, R) {
  const byName: any = {};
  root.children.forEach(c => { if (c.name) byName[c.name] = c; });
  /** 某舱段相对自身原点的轴向范围与实际半径（自动适配，不写死尺寸）。
      只统计实体网格：粒子系统会把未激活的粒子停在极远处占位，
      用 setFromObject 会把包围盒撑爆，细节尺寸随之失真。 */
  function spanOf(grp) {
    const box = new THREE.Box3(); box.makeEmpty();
    const tmp = new THREE.Box3();
    grp.updateMatrixWorld(true);
    grp.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.attributes && o.geometry.attributes.position;
      if (!pos) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    });
    if (box.isEmpty()) return { y0: 0, y1: .1, r: R };
    const dy = grp.position.y;
    return {
      y0: box.min.y - dy, y1: box.max.y - dy,
      r: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * .5,
    };
  }

  /* 1) 制导舱：四条能量导管 —— 沿轴向嵌在蒙皮里的发光条 */
  const av = byName['avionics'];
  if (av) {
    const sp = spanOf(av), len = Math.max(sp.y1 - sp.y0, .05) * .78;
    const glowMat = new THREE.MeshStandardMaterial({
      name: 'energyLine', color: 0x0d2b3a, metalness: .2, roughness: .35,
      emissive: 0x2ea8d8, emissiveIntensity: 2.4,
    });
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const line = new THREE.Mesh(new THREE.BoxGeometry(.014, len, .009), glowMat);
      line.position.set(Math.cos(a) * (sp.r - .002), (sp.y0 + sp.y1) * .5, Math.sin(a) * (sp.r - .002));
      line.rotation.y = -a;
      line.name = 'energyLine';
      av.add(line);
    }
    // 环形集束箍：把四条导管在两端收口
    const collarMat = new THREE.MeshStandardMaterial({ name: 'collar', color: 0x2b3138, metalness: .9, roughness: .32 });
    [sp.y0 + len * .12, sp.y1 - len * .12].forEach(y => {
      const c = new THREE.Mesh(new THREE.TorusGeometry(sp.r * .99, .012, 8, 40), collarMat);
      c.rotation.x = Math.PI / 2; c.position.y = y;
      av.add(c);
    });
  }

  /* 2) 战斗部：黄黑警示环带 + 危险标识块 */
  const wh = byName['warhead'];
  if (wh) {
    const sp = spanOf(wh), len = sp.y1 - sp.y0;
    const warnMat = new THREE.MeshStandardMaterial({ name: 'warn', color: 0xd8a326, metalness: .25, roughness: .55 });
    const darkMat = new THREE.MeshStandardMaterial({ name: 'warnDark', color: 0x1b1a17, metalness: .3, roughness: .6 });
    // 斜纹用若干薄片拼出螺旋感，比贴图更有体积
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const y = sp.y0 + len * .18 + t * len * .64;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(sp.r * 1.012, sp.r * 1.012, len * .64 / N * .52, 28, 1, true, t * 2.4, 1.1),
        i % 2 ? darkMat : warnMat);
      stripe.position.y = y;
      stripe.rotation.y = t * .5;
      wh.add(stripe);
    }
  }

  /* 3) 发动机舱：外部推进剂管路 + 卡箍 + 刀状天线 */
  const mt = byName['motor'];
  if (mt) {
    const sp = spanOf(mt), len = Math.max(sp.y1 - sp.y0, .05) * .8;
    const pipeMat = new THREE.MeshStandardMaterial({ name: 'pipe', color: 0x8d99a6, metalness: .95, roughness: .26 });
    const clampMat = new THREE.MeshStandardMaterial({ name: 'clamp', color: 0x333a43, metalness: .8, roughness: .45 });
    // 两条对称管路：一根输送、一根回流
    [1, -1].forEach(sgn => {
      const a = sgn > 0 ? .55 : Math.PI - .55;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, len, 10), pipeMat);
      pipe.position.set(Math.cos(a) * (sp.r + .012), (sp.y0 + sp.y1) * .5, Math.sin(a) * (sp.r + .012));
      mt.add(pipe);
      // 沿途卡箍
      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        const cl = new THREE.Mesh(new THREE.TorusGeometry(.016, .005, 6, 14), clampMat);
        cl.position.set(Math.cos(a) * (sp.r + .012), sp.y0 + len * .1 + t * len * .8, Math.sin(a) * (sp.r + .012));
        cl.rotation.x = Math.PI / 2;
        mt.add(cl);
      }
    });
  }

  /* 4) 全弹通用：蒙皮散热槽（细密横向沟槽，近看才有的层次） */
  ['avionics', 'motor'].forEach(k => {
    const g = byName[k]; if (!g) return;
    const sp = spanOf(g);
    const slotMat = new THREE.MeshStandardMaterial({ name: 'slot', color: 0x161b21, metalness: .5, roughness: .7 });
    const n = Math.floor((sp.y1 - sp.y0) / .085);
    for (let i = 0; i < n; i++) {
      const y = sp.y0 + (i + .5) * (sp.y1 - sp.y0) / n;
      const slot = new THREE.Mesh(new THREE.TorusGeometry(sp.r * .995, .0045, 5, 26), slotMat);
      slot.rotation.x = Math.PI / 2; slot.position.y = y;
      g.add(slot);
    }
  });

  void mats; void R;
}

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
    // 放样翼型：局部 X=展向（0 为翼根）、Y=弦向（+ 为前缘）、Z=厚度
    const finGeo = airfoilFinGeometry();
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      const ang = i * 90 * DEG + 45 * DEG;
      const fin = new THREE.Mesh(finGeo, mats.fin);
      holder.add(fin);
      // 翼根整流鼓包（包裹舵轴与作动器）
      const fair = new THREE.Mesh(new THREE.SphereGeometry(.05, 18, 14), mats.panel);
      fair.scale.set(1.15, 1.7, .44); fair.position.set(.03, .02, 0);
      holder.add(fair);
      // 翼尖滚转舵（rolleron 小轮）
      const roller = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(.042, .012, 10, 28), mats.steelDark);
      roller.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .026, 12), mats.copper);
      hub.rotation.x = Math.PI / 2; roller.add(hub);
      roller.position.set(.43, -.27, 0);
      holder.add(roller);
      // 舵轴（沿展向贯穿翼根）
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, .17, 12), mats.steel);
      axle.rotation.z = Math.PI / 2; axle.position.set(.07, .02, 0);
      holder.add(axle);
      holder.position.set(Math.cos(ang) * R * .95, -2.28, Math.sin(ang) * R * .95);
      holder.rotation.y = -ang;                    // 局部 +X → 弹体外法向（展向）
      holder.userData.hingeAxis = new THREE.Vector3(1, 0, 0);   // 绕展向偏转 = 舵偏
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
    grp.userData.explodeDir = new THREE.Vector3(conf.dir[0], conf.dir[1], conf.dir[2]);
    const anchor = new THREE.Object3D();
    anchor.position.set(conf.anchor[0], conf.anchor[1], conf.anchor[2]);
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

  addSciFiDetails(root, mats, R);

  const order = ['radome', 'seeker', 'warhead', 'fuze', 'avionics', 'motor', 'nozzle', 'fins'];
  const updateBurn = gMotor.userData.updateBurn;

  /* ---------- 装配关系能量线 ----------
     拆解时相邻舱段之间拉出一条发光连线，表明"这两段是装在一起的"。
     没有它，散开的部件只是一堆悬浮零件，看不出装配顺序。        */
  const linkSegs = order.length - 1;
  const linkPos = new Float32Array(linkSegs * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  const linkMat = new THREE.LineBasicMaterial({
    color: 0x6fc7e8, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const links = new THREE.LineSegments(linkGeo, linkMat);
  links.frustumCulled = false;
  links.visible = false;
  links.name = 'assemblyLinks';
  root.add(links);
  const _lk1 = new THREE.Vector3(), _lk2 = new THREE.Vector3();
  function updateLinks(e) {
    if (e <= .015) { links.visible = false; return; }
    root.updateMatrixWorld(true);      // 刚改过部件位置，必须刷新才能取到正确世界坐标
    for (let i = 0; i < linkSegs; i++) {
      P[order[i]].anchor.getWorldPosition(_lk1);
      P[order[i + 1]].anchor.getWorldPosition(_lk2);
      root.worldToLocal(_lk1); root.worldToLocal(_lk2);
      linkPos[i * 6] = _lk1.x; linkPos[i * 6 + 1] = _lk1.y; linkPos[i * 6 + 2] = _lk1.z;
      linkPos[i * 6 + 3] = _lk2.x; linkPos[i * 6 + 4] = _lk2.y; linkPos[i * 6 + 5] = _lk2.z;
    }
    linkGeo.attributes.position.needsUpdate = true;
    linkMat.opacity = Math.min(e * 1.25, .5);
    links.visible = true;
  }

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
      updateLinks(e);
      const outw = 1 + e * .5;
      finDirs.forEach(({ ang, holder }) => {
        holder.position.set(
          Math.cos(ang) * (R * .95) * outw,
          -2.28 - e * .35,
          Math.sin(ang) * (R * .95) * outw);
      });
    },

    finDirs,
    /* 舵偏：四片舵面各自绕“展向轴”同向偏转 —— 十字尾控的滚转通道 */
    finAngle(v) {
      const dirs = (this && this.finDirs) || finDirs;
      dirs.forEach(({ holder }) => {
        holder.quaternion.copy(holder.userData.baseQuat);
        holder.rotateX(v);
      });
    },

    /* 剖视: 只裁剪外壳蒙皮材质 */
    shellMats: [mats.paint, mats.radome, mats.fin],
    allMats: Object.values(mats),

    disposeAll() { root.traverse(o => { const m = o as any; if (m.geometry) m.geometry.dispose(); }); },
  };

  api.setExplode(0);
  return api;
}
