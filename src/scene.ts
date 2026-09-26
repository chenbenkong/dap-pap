// ============================================================
// 立体课本 · 导弹实验台 — 场景与渲染
// 一个 Scene 两个舞台：hangar(解剖试车) 与 world(飞行弹道)
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { ColorGradePass } from './post/ColorGradePass.js';

export function createScene(container) {
  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04070d);
  scene.fog = new THREE.FogExp2(0x04070d, 0.012);   // 机库浓度；飞行阶段调低

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 60000);
  camera.position.set(4.6, 1.6, 6.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .07;
  controls.target.set(0, -.2, 0);
  controls.minDistance = .4;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * .58;
  controls.autoRotateSpeed = .9;

  /* ---------- 环境 IBL ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hangarEnv = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;
  scene.environment = hangarEnv;
  /* 夜间试验场专用 IBL：暗夜空 + 月光亮斑（方位与主光一致 (6,9,5)）。
     否则白昼级 RoomEnvironment 会让深夜场景金属件泛白、失去夜间观测对比度。 */
  const nightEnv = (() => {
    const es = new THREE.Scene();
    es.background = new THREE.Color(0x04070e);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(4, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xbdd3f6 })
    );
    moon.position.set(30, 45, 25); es.add(moon);
    // 地平线一圈极弱的冷色微光（模拟海面散射），让金属下缘不死黑
    const haze = new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0x0c1a2c, side: THREE.BackSide })
    );
    es.add(haze);
    return pmrem.fromScene(es, .05).texture;
  })();

  /* ---------- 后期处理链：Bloom（尾焰/琥珀辉光）+ 输出变换 + FXAA ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .38, .5, 1.05);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const colorGradePass = new ColorGradePass();
  composer.addPass(colorGradePass);
  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);
  function syncPost() {
    const pr = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
    colorGradePass.material.uniforms['uResolution'].value.set(innerWidth * pr, innerHeight * pr);
  }
  syncPost();

  /* ---------- 灯光 ---------- */
  const hemi = new THREE.HemisphereLight(0x93b3d8, 0x141d2c, .55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe7c2, 1.75);
  key.position.set(6, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 24;
  key.shadow.camera.left = -5.5; key.shadow.camera.right = 5.5;
  key.shadow.camera.top = 6.5; key.shadow.camera.bottom = -6.5;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fc7e8, 1.15);
  rim.position.set(-7, 3.4, -6);
  scene.add(rim);
  const fill = new THREE.PointLight(0xffb454, .5, 18, 1.6);
  fill.position.set(-3, -1.6, 4);
  scene.add(fill);

  /* ================= 机库展台 ================= */
  const hangar = new THREE.Group(); hangar.visible = true; scene.add(hangar);
  let hDomeMat: any = null;          // 穹顶材质（函数级：setHangarBackdrop 需要）
  let ASSEMBLY_TEX: any = null, BENCH_TEX: any = null;
  {
    /* 背景穹顶：按工位切换风格化贴图（科幻风，不必写实）
       装配台 = 星空实验室（靛紫星云 + 星点 + 中心柔光）
       试车台 = 熔炉试车舱（炭黑 → 炉火橙红 + 火星 + 蒸汽带） */
    const domeW = 1024, domeH = 512;
    const mkDome = (draw) => {
      const cv = document.createElement('canvas'); cv.width = domeW; cv.height = domeH;
      const c = cv.getContext('2d');
      draw(c);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    ASSEMBLY_TEX = mkDome((c) => {
      const g = c.createLinearGradient(0, 0, 0, domeH);
      g.addColorStop(0, '#0a081d'); g.addColorStop(.5, '#241b4d'); g.addColorStop(.82, '#4b2f74'); g.addColorStop(1, '#14102c');
      c.fillStyle = g; c.fillRect(0, 0, domeW, domeH);
      const neb = (x, y, r, col) => {
        const rg = c.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2);
      };
      neb(domeW * .2, domeH * .42, 190, 'rgba(120,90,255,.20)');
      neb(domeW * .75, domeH * .30, 240, 'rgba(60,190,255,.14)');
      neb(domeW * .55, domeH * .62, 170, 'rgba(255,120,220,.10)');
      neb(domeW * .38, domeH * .22, 150, 'rgba(90,140,255,.12)');
      // 斜向银河带：让星空有纵深与方向感
      const band = c.createLinearGradient(0, domeH * .8, domeW, domeH * .08);
      band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(.28, 'rgba(130,140,255,.05)');
      band.addColorStop(.5, 'rgba(185,205,255,.10)'); band.addColorStop(.72, 'rgba(130,140,255,.05)');
      band.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = band; c.fillRect(0, 0, domeW, domeH);
      // 星点三档：远景微星 / 中景星 / 近景亮星带十字星芒与色温差
      const starCols = ['255,255,255', '190,214,255', '255,226,188', '188,255,238'];
      for (let i = 0; i < 300; i++) {
        const x = Math.random() * domeW, y = Math.random() * domeH * .88;
        c.fillStyle = `rgba(255,255,255,${.10 + Math.random() * .30})`;
        c.beginPath(); c.arc(x, y, .55, 0, 7); c.fill();
      }
      for (let i = 0; i < 110; i++) {
        const x = Math.random() * domeW, y = Math.random() * domeH * .85;
        const col = starCols[(Math.random() * starCols.length) | 0];
        c.fillStyle = `rgba(${col},${.45 + Math.random() * .4})`;
        c.beginPath(); c.arc(x, y, .8 + Math.random() * .5, 0, 7); c.fill();
      }
      for (let i = 0; i < 22; i++) {
        const x = Math.random() * domeW, y = Math.random() * domeH * .8;
        const col = starCols[(Math.random() * starCols.length) | 0];
        c.save();
        c.shadowBlur = 7; c.shadowColor = `rgba(${col},.9)`;
        c.fillStyle = `rgba(${col},.95)`;
        c.beginPath(); c.arc(x, y, 1.3 + Math.random() * .6, 0, 7); c.fill();
        c.restore();
        // 十字星芒（只给最亮的几颗）
        if (i % 3 === 0) {
          c.strokeStyle = `rgba(${col},.32)`; c.lineWidth = .7;
          c.beginPath();
          c.moveTo(x - 4.6, y); c.lineTo(x + 4.6, y);
          c.moveTo(x, y - 4.6); c.lineTo(x, y + 4.6);
          c.stroke();
        }
      }
      const gl = c.createRadialGradient(domeW * .5, domeH * .66, 0, domeW * .5, domeH * .66, 260);
      gl.addColorStop(0, 'rgba(150,190,255,.16)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gl; c.fillRect(0, 0, domeW, domeH);
    });
    BENCH_TEX = mkDome((c) => {
      const g = c.createLinearGradient(0, 0, 0, domeH);
      g.addColorStop(0, '#0e0906'); g.addColorStop(.6, '#2a1208'); g.addColorStop(.88, '#61280f'); g.addColorStop(1, '#180b05');
      c.fillStyle = g; c.fillRect(0, 0, domeW, domeH);
      // 炉心辉光：双层（内白热 / 外橙红）
      const fg = c.createRadialGradient(domeW * .5, domeH * .98, 0, domeW * .5, domeH * .98, 300);
      fg.addColorStop(0, 'rgba(255,168,72,.40)'); fg.addColorStop(.5, 'rgba(255,90,30,.15)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = fg; c.fillRect(0, 0, domeW, domeH);
      const fg2 = c.createRadialGradient(domeW * .5, domeH * 1.04, 0, domeW * .5, domeH * 1.04, 150);
      fg2.addColorStop(0, 'rgba(255,228,180,.30)'); fg2.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = fg2; c.fillRect(0, 0, domeW, domeH);
      // 两侧远处结构剪影：竖向热流暗带，给机库纵深
      for (let i = 0; i < 7; i++) {
        const x = Math.random() * domeW, w = 26 + Math.random() * 60;
        const vg = c.createLinearGradient(0, domeH * .35, 0, domeH);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,4,2,.42)');
        c.fillStyle = vg;
        c.fillRect(x, domeH * .35, w, domeH * .65);
      }
      // 火星：带辉光的暖色粒子，上密下疏
      c.save();
      for (let i = 0; i < 230; i++) {
        const x = Math.random() * domeW, y = domeH * (.5 + Math.random() * .5);
        const hot = Math.random();
        c.shadowBlur = hot > .8 ? 6 : 0;
        c.shadowColor = 'rgba(255,170,60,.9)';
        c.fillStyle = `rgba(255,${120 + hot * 120 | 0},40,${.25 + hot * .55})`;
        c.beginPath(); c.arc(x, y, .5 + hot * 1.2, 0, 7); c.fill();
      }
      c.restore();
      // 蒸汽带
      c.fillStyle = 'rgba(255,200,150,.05)';
      for (let i = 0; i < 5; i++) { const y = Math.random() * domeH * .5; c.fillRect(0, y, domeW, 14 + Math.random() * 26); }
    });
    hDomeMat = new THREE.MeshBasicMaterial({ map: ASSEMBLY_TEX, side: THREE.BackSide, fog: false, depthWrite: false });
    const hDome = new THREE.Mesh(new THREE.SphereGeometry(60, 40, 20), hDomeMat);
    hDome.renderOrder = -8; hDome.name = 'hangarDome';
    hangar.add(hDome);

    // 地盘：深色亚光混凝土/树脂地面，弱化高光，避免喧宾夺主
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(11, 96),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a1017, metalness: .12, roughness: .92,
        clearcoat: .04, clearcoatRoughness: .85, envMapIntensity: .18,
      })
    );
    disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true;
    hangar.add(disc);
    // 接触阴影：让导弹"坐"在地面上
    const csCanvas = document.createElement('canvas'); csCanvas.width = csCanvas.height = 256;
    const csc = csCanvas.getContext('2d');
    const csg = csc.createRadialGradient(128, 128, 0, 128, 128, 128);
    csg.addColorStop(0, 'rgba(0,0,0,.55)'); csg.addColorStop(.55, 'rgba(0,0,0,.18)'); csg.addColorStop(1, 'rgba(0,0,0,0)');
    csc.fillStyle = csg; csc.fillRect(0, 0, 256, 256);
    const csTex = new THREE.CanvasTexture(csCanvas);
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.8, 5.8),
      new THREE.MeshBasicMaterial({ map: csTex, transparent: true, opacity: .55, depthWrite: false, blending: THREE.MultiplyBlending })
    );
    contactShadow.rotation.x = -Math.PI / 2; contactShadow.position.y = .02;
    contactShadow.name = 'contactShadow';
    hangar.add(contactShadow);
    // 同心刻度环
    const rings = new THREE.Group();
    const rMat = new THREE.LineBasicMaterial({ color: 0x22436b, transparent: true, opacity: .4 });
    for (let r = 1; r <= 10; r++) {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const a = i / 128 * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r * 1.05, .002, Math.sin(a) * r * 1.05));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      rings.add(new THREE.Line(g, rMat));
    }
    // 十字放射线
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(Math.cos(a) * 1.2, .002, Math.sin(a) * 1.2),
        new THREE.Vector3(Math.cos(a) * 10.5, .002, Math.sin(a) * 10.5)]);
      rings.add(new THREE.Line(g, rMat));
    }
    hangar.add(rings);
    // 中心高亮环
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: .12, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(new THREE.RingGeometry(.95, 1.02, 96), haloMat);
    halo.rotation.x = -Math.PI / 2; halo.position.y = .003;
    hangar.add(halo);
    // 尘埃粒子
    const N = 340, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - .5) * 17;
      pos[i * 3 + 1] = Math.random() * 8 - .5;
      pos[i * 3 + 2] = (Math.random() - .5) * 17;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0x9db8de, size: .02, transparent: true, opacity: .34,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    dust.name = 'dust';
    hangar.add(dust);

    // 全息投影基座：从地面投向弹体的光锥 + 投射盘（刻意压暗，避免抢弹体主体戏）
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb454, transparent: true, opacity: .028,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.42, 1.15, 1.5, 40, 1, true), beamMat);
    beam.position.y = .75; beam.name = 'holoBeam';
    hangar.add(beam);
    const projBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.18, 1.34, .1, 48),
      new THREE.MeshPhysicalMaterial({ color: 0x0d131c, metalness: .28, roughness: .58, clearcoat: .18, envMapIntensity: .3 })
    );
    projBase.position.y = .05; hangar.add(projBase);
    const projGlow = new THREE.Mesh(
      new THREE.RingGeometry(.5, 1.12, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: .075, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    projGlow.rotation.x = -Math.PI / 2; projGlow.position.y = .11; projGlow.name = 'projGlow';
    hangar.add(projGlow);
  }

  /* ================= 飞行世界 ================= */
  const world = new THREE.Group(); world.visible = false; scene.add(world);
  {
    // 地面（米制）—— 海面之外露出的底色也按深夜海床处理
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000),
      new THREE.MeshStandardMaterial({ color: 0x081b26, metalness: .1, roughness: .95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = false;
    ground.name = 'ground';
    world.add(ground);

    /* ---------- 天空穹顶：深夜试验场（月光 + 星空 + 暗霾地平线） ----------
       夜暗环境 = 高对比背景，白色羽流/尾迹与弹道一目了然，
       符合真实夜间靶试的仪器化观测条件。 */
    const skyW = 1024, skyH = 512;
    const scv = document.createElement('canvas'); scv.width = skyW; scv.height = skyH;
    const sctx = scv.getContext('2d');
    const skyGrad = sctx.createLinearGradient(0, 0, 0, skyH);
    skyGrad.addColorStop(0, '#040a14');
    skyGrad.addColorStop(.42, '#0a1830');
    skyGrad.addColorStop(.68, '#122a44');
    skyGrad.addColorStop(.84, '#1b3a56');
    skyGrad.addColorStop(1, '#0d1e30');
    sctx.fillStyle = skyGrad; sctx.fillRect(0, 0, skyW, skyH);
    // 地平线上一线极淡的月光霾（区分海天边界，不抬高整体亮度）
    const hzg = sctx.createLinearGradient(0, skyH * .74, 0, skyH);
    hzg.addColorStop(0, 'rgba(90,130,170,0)'); hzg.addColorStop(.82, 'rgba(90,130,170,.10)'); hzg.addColorStop(1, 'rgba(90,130,170,0)');
    sctx.fillStyle = hzg; sctx.fillRect(0, skyH * .74, skyW, skyH * .26);
    // 斜向银河淡带（远景纵深）
    const band = sctx.createLinearGradient(0, skyH * .8, skyW, skyH * .1);
    band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(.3, 'rgba(110,140,190,.045)');
    band.addColorStop(.55, 'rgba(140,165,205,.075)'); band.addColorStop(.8, 'rgba(110,140,190,.045)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = band; sctx.fillRect(0, 0, skyW, skyH);
    // 星点三档（夜间观测环境：星越多，"靶场深夜"氛围越足）
    const starCols = ['255,255,255', '185,212,255', '255,230,195'];
    for (let i = 0; i < 300; i++) {
      const sx = Math.random() * skyW, sy = Math.random() * skyH * .86;
      sctx.fillStyle = `rgba(255,255,255,${.08 + Math.random() * .22})`;
      sctx.beginPath(); sctx.arc(sx, sy, .55, 0, 7); sctx.fill();
    }
    for (let i = 0; i < 95; i++) {
      const sx = Math.random() * skyW, sy = Math.random() * skyH * .8;
      const col = starCols[(Math.random() * starCols.length) | 0];
      sctx.fillStyle = `rgba(${col},${.4 + Math.random() * .35})`;
      sctx.beginPath(); sctx.arc(sx, sy, .7 + Math.random() * .5, 0, 7); sctx.fill();
    }
    for (let i = 0; i < 18; i++) {
      const sx = Math.random() * skyW, sy = Math.random() * skyH * .72;
      const col = starCols[(Math.random() * starCols.length) | 0];
      sctx.save(); sctx.shadowBlur = 6; sctx.shadowColor = `rgba(${col},.85)`;
      sctx.fillStyle = `rgba(${col},.95)`;
      sctx.beginPath(); sctx.arc(sx, sy, 1.1 + Math.random() * .5, 0, 7); sctx.fill();
      sctx.restore();
    }
    // 月亮：方位与主光方向一致（世界方向 (6,9,5) → u≈0.11, v≈0.24），冷白小盘 + 紧致月晕
    const mu = .11 * skyW, mv = .24 * skyH;
    const mg = sctx.createRadialGradient(mu, mv, 0, mu, mv, 110);
    mg.addColorStop(0, 'rgba(226,238,255,.95)');
    mg.addColorStop(.055, 'rgba(226,238,255,.9)');
    mg.addColorStop(.11, 'rgba(190,214,245,.30)');
    mg.addColorStop(.4, 'rgba(160,195,235,.10)');
    mg.addColorStop(1, 'rgba(150,190,235,0)');
    sctx.fillStyle = mg; sctx.fillRect(mu - 120, mv - 120, 240, 240);
    // 高空稀薄夜云（近地平线几缕暗纹，几乎不可见）
    sctx.fillStyle = 'rgba(120,150,190,.05)';
    for (let i = 0; i < 8; i++) {
      const cy = skyH * (.6 + Math.random() * .22), cx = Math.random() * skyW, w = 140 + Math.random() * 260;
      sctx.beginPath(); sctx.ellipse(cx, cy, w, 6 + Math.random() * 8, 0, 0, Math.PI * 2); sctx.fill();
    }
    const skyTex = new THREE.CanvasTexture(scv);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.name = 'skyDome';
    world.add(sky);

    // 近岸发射岛：深夜岩土盘（剪影级暗度，月光下略可辨），发射台立其上（岛顶 y=0 与基座底齐平）
    const land = new THREE.Mesh(new THREE.CylinderGeometry(2600, 3400, 2, 64),
      new THREE.MeshStandardMaterial({ color: 0x141a21, metalness: .15, roughness: .92 }));
    land.position.y = -1;
    world.add(land);

    // 海面：深夜墨蓝反射水，让下方网格透出做"海图深度线"
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(50000, 50000),
      new THREE.MeshPhysicalMaterial({
        color: 0x092338, metalness: .55, roughness: .34,
        transparent: true, opacity: .84, depthWrite: false, envMapIntensity: .3,
      }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = .16;
    world.add(ocean);

    // 月光碎辉：沿月亮方位铺一条很弱的冷色光带（仪器化夜试氛围，
    // 亮度刻意压低——绝不能干扰弹道/尾迹观察）
    {
      const gzCv = document.createElement('canvas'); gzCv.width = gzCv.height = 256;
      const gzc = gzCv.getContext('2d');
      const gzg = gzc.createRadialGradient(128, 128, 6, 128, 128, 126);
      gzg.addColorStop(0, 'rgba(205,225,252,.55)');
      gzg.addColorStop(.4, 'rgba(185,210,245,.18)');
      gzg.addColorStop(1, 'rgba(175,205,245,0)');
      gzc.fillStyle = gzg; gzc.fillRect(0, 0, 256, 256);
      const gzTex = new THREE.CanvasTexture(gzCv);
      // 月亮方位：穹顶贴图 u≈0.11 → 世界方位角 atan2(z,x)≈0.695 rad
      const az = .695, gzDist = 13000;
      const glitter = new THREE.Mesh(
        new THREE.PlaneGeometry(3400, 30000),
        new THREE.MeshBasicMaterial({
          map: gzTex, color: 0xcfe2ff, transparent: true, opacity: .11,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        })
      );
      glitter.rotation.x = -Math.PI / 2;
      glitter.rotation.z = -az;   // 平面长轴对准月亮方位
      glitter.position.set(Math.cos(az) * gzDist, .3, Math.sin(az) * gzDist);
      glitter.renderOrder = 2;    // 画在海面之后
      world.add(glitter);
    }

    // 漂浮云层：扁平柔光夜云（月光下极淡，绝不遮挡弹道视线）
    const cloudCv = document.createElement('canvas'); cloudCv.width = cloudCv.height = 128;
    const cg = cloudCv.getContext('2d');
    const crg = cg.createRadialGradient(64, 64, 4, 64, 64, 62);
    crg.addColorStop(0, 'rgba(255,255,255,.8)'); crg.addColorStop(.5, 'rgba(255,255,255,.32)'); crg.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = crg; cg.fillRect(0, 0, 128, 128);
    const cloudTex = new THREE.CanvasTexture(cloudCv);
    const clouds = new THREE.Group(); clouds.name = 'clouds';
    const cMat = new THREE.MeshBasicMaterial({ map: cloudTex, color: 0x9db4d6, transparent: true, opacity: .15, fog: false, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const s = 1400 + Math.random() * 2400;
      const cl = new THREE.Mesh(new THREE.PlaneGeometry(s, s * .4), cMat);
      cl.rotation.x = -Math.PI / 2; cl.rotation.z = Math.random() * Math.PI;
      cl.position.set((Math.random() * 2 - 1) * 22000, 2800 + Math.random() * 4200, (Math.random() * 2 - 1) * 22000);
      clouds.add(cl);
    }
    world.add(clouds);

    // 网格分两级：粗网格 2 km 一根看战略尺度，
    // 细网格 250 m 一根覆盖弹道走廊——跟拍距离只有几十米时，
    // 没有近处参照物就完全感觉不到速度。
    // 两条网格都压到海面下（y≈0.06/0.08），透过半透明海面读出"仪器化靶场海图线"；
    // 夜试环境下略提亮度：网格是深度参照，不是装饰。
    const gridPts = [], EXT = 60000, STEP = 2000;
    const mat = new THREE.LineBasicMaterial({ color: 0x1c3c62, transparent: true, opacity: .42 });
    for (let x = -EXT; x <= EXT; x += STEP) {
      gridPts.push(x, .06, -EXT, x, .06, EXT);
      gridPts.push(-EXT, .06, x, EXT, .06, x);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    world.add(new THREE.LineSegments(gg, mat));

    const finePts = [], FEXT = 9000, FSTEP = 250;
    const fineMat = new THREE.LineBasicMaterial({ color: 0x24568c, transparent: true, opacity: .27 });
    for (let x = -FEXT; x <= FEXT; x += FSTEP) {
      finePts.push(x, .08, -FEXT, x, .08, FEXT);
      finePts.push(-FEXT, .08, x, FEXT, .08, x);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(finePts, 3));
    world.add(new THREE.LineSegments(fg, fineMat));
    // 发射台：加高基座 + A 形发射架（中央斜轨 79°）+ 脐带塔 + 警示灯 + 地面标线
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2c3745, metalness: .3, roughness: .78 });
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x1e2731, metalness: .55, roughness: .5 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x52677c, metalness: .72, roughness: .4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(17, 23, 7, 40), padMat);
    base.position.y = 3.5; world.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(17, 1.6, 10, 48), strutMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 7.4; world.add(rim);
    // 中央斜轨（79° 射角，起飞瞬间托住弹体；起飞后被弹体遮挡不穿模）
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 22, 1.4), railMat);
    rail.position.set(0, 11, 0); rail.rotation.z = -.19;
    world.add(rail);
    // A 形发射架支腿（在弹体两侧，不穿模）
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 13, 2), strutMat);
      leg.position.set(s * 5.6, 8.5, -1.4); leg.rotation.z = s * .13;
      world.add(leg);
    }
    // 脐带塔 + 红警示灯
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 16, 2.6), strutMat);
    tower.position.set(-8, 8, 6.5); world.add(tower);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5040, emissive: 0xff4030, emissiveIntensity: 2.6 }));
    beacon.position.set(-8, 16.6, 6.5); world.add(beacon);
    // 脐带臂：从脐带塔伸向弹体中段（供电/气液路），发射瞬间摆开脱离
    // 弹体立于发射架上（root≈(3.26,27.8,0)，79° 仰角，半径≈1.32），
    // 塔侧(-8,10,6.5) → 弹轴上(≈-0.2,10,0)，长度≈10.2，绕 Y 轴对准弹体
    const arm = new THREE.Mesh(new THREE.BoxGeometry(10.2, .7, 1.0), strutMat);
    arm.position.set(-4.1, 10, 3.25);
    arm.rotation.y = Math.atan2(-(0 - 6.5), -0.2 - (-8));  // ≈ .70 rad，指向弹轴
    arm.userData.armBase = arm.rotation.y;
    arm.name = 'towerArm';
    world.add(arm);
    // 持垂夹持 ×2：点火时夹住弹体发动机舱承受推力（导弹不上飞），
    // T-0 爆炸螺栓释放、向两侧张开——由 main 按名称驱动开合
    // 位置取弹轴在 y≈10.5 处（发动机舱，台面上方），x≈-0.1、抱住半径1.32的弹体
    const clampMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, metalness: .62, roughness: .42 });
    for (const s of [-1, 1]) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.6, 1.4), clampMat);
      clamp.position.set(-.1, 10.5, s * 2.02);
      clamp.name = s < 0 ? 'padClampL' : 'padClampR';
      world.add(clamp);
    }
    // 发射台地面标线环
    const padRing = new THREE.Mesh(new THREE.RingGeometry(20, 22, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: .35, side: THREE.DoubleSide }));
    padRing.rotation.x = -Math.PI / 2; padRing.position.y = .15; world.add(padRing);
  }

  /* ---------- 相机飞行动画 ---------- */
  let camTween = null;
  function flyCam(pos, tgt, dur = 1.15, ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) {
    if (!pos || !tgt) { camTween = null; return; }
    camTween = {
      t0: performance.now(), dur: dur * 1000, ease,
      p0: camera.position.clone(), p1: new THREE.Vector3(...pos),
      c0: controls.target.clone(), c1: new THREE.Vector3(...tgt),
    };
  }

  /* ---------- 相机接管 ----------
     飞行跟拍时由外部直接驱动相机：必须完全绕开 OrbitControls，
     否则 controls.update() 会用 target 反推球坐标、把手动设置的
     position 又改写回去，表现为镜头打滑、抖动、跟不住弹体。      */
  let camAuto = false;
  const autoPos = new THREE.Vector3(), autoLook = new THREE.Vector3(), autoUp = new THREE.Vector3(0, 1, 0);
  let autoFov = 0;
  function setCamAuto(on) {
    if (on === camAuto) return;
    camAuto = !!on;
    if (!camAuto) {
      // 交还给轨道相机：把当前朝向折算成 target，避免视角突跳
      camera.up.set(0, 1, 0);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      controls.target.copy(camera.position).addScaledVector(dir, Math.max(8, camera.position.distanceTo(controls.target)));
      camTween = null;
    }
  }
  /** 由 main 每帧写入目标机位；内部自带平滑，避免硬切 */
  function setCamRig(pos, look, up, fov) {
    camera.position.copy(pos);
    if (up) camera.up.copy(up); else camera.up.set(0, 1, 0);
    camera.lookAt(look);
    if (fov && Math.abs(camera.fov - fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    void autoFov;
  }

  /* ---------- 每帧更新 ---------- */
  const shake = { amp: 0 };
  /* ---------- 自适应像素比 ----------
     帧时间持续超限（低端机/开 bloom 的高分屏）时逐步下调渲染分辨率，
     流畅时再逐步回升；每 1.2s 才评估一次，避免来回抖动。 */
  const DPR_MAX = Math.min(devicePixelRatio || 1, 2), DPR_MIN = 1;
  let dprCur = DPR_MAX, _emaMs = 16.7, _dprAcc = 0;
  function adaptDpr(dtMs) {
    _emaMs = _emaMs * .94 + dtMs * .06;
    _dprAcc += dtMs;
    if (_dprAcc < 1200) return;
    _dprAcc = 0;
    if (_emaMs > 25 && dprCur > DPR_MIN) {
      dprCur = Math.max(DPR_MIN, dprCur - .25);
      renderer.setPixelRatio(dprCur);
      composer.setPixelRatio(dprCur);
      syncPost();
    } else if (_emaMs < 15 && dprCur < DPR_MAX) {
      dprCur = Math.min(DPR_MAX, dprCur + .25);
      renderer.setPixelRatio(dprCur);
      composer.setPixelRatio(dprCur);
      syncPost();
    }
  }
  function update(dt, controlsEnabled = true) {
    controls.enabled = !camAuto && controlsEnabled;
    if (camAuto) {
      // 接管态：相机已由 setCamRig 写好，只叠加震动，不再跑轨道控制
      if (shake.amp > .001) {
        const s = shake.amp;
        camera.position.x += (Math.random() - .5) * s;
        camera.position.y += (Math.random() - .5) * s;
        camera.position.z += (Math.random() - .5) * s;
        if (camera.position.y < 4) camera.position.y = 4;   // 兜底：抖动不许把相机抖进海面（黑屏元凶之一）
        shake.amp *= Math.exp(-dt * 4.2);
      }
      colorGradePass.material.uniforms['uTime'].value = performance.now() * 0.001;
      adaptDpr(dt * 1000);
      composer.render();
      return;
    }
    if (camTween) {
      const k = Math.min(1, (performance.now() - camTween.t0) / camTween.dur);
      const e = camTween.ease(k);
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.c0, camTween.c1, e);
      if (k >= 1) camTween = null;
    }
    controls.update();
    // 相机震动
    if (shake.amp > .001) {
      const s = shake.amp;
      camera.position.x += (Math.random() - .5) * s;
      camera.position.y += (Math.random() - .5) * s;
      camera.position.z += (Math.random() - .5) * s;
      shake.amp *= Math.exp(-dt * 4.2);
    }
    // 尘埃缓浮
    const dust = hangar.getObjectByName('dust');
    if (dust && dust.visible) {
      dust.rotation.y += dt * .014;
      dust.position.y = Math.sin(performance.now() * .00022) * .18;
    }
    colorGradePass.material.uniforms['uTime'].value = performance.now() * 0.001;
    adaptDpr(dt * 1000);
    composer.render();
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    syncPost();
  });

  return {
    renderer, scene, camera, controls, hangar, world,
    flyCam, update, keyLight: key,
    setCamAuto, setCamRig,
    /** 机库穹顶背景：装配台=星空实验室 / 试车台=熔炉试车舱 */
    setHangarBackdrop(kind) { hDomeMat.map = kind === 'bench' ? BENCH_TEX : ASSEMBLY_TEX; hDomeMat.needsUpdate = true; },
    get camAuto() { return camAuto; },
    setWorldMode(on) {
      hangar.visible = !on; world.visible = !!on;
      // 深夜试验场：雾改成暗海军蓝霾色、浓度压到可透视量级；
      // 机库=暗室：浓黑雾
      const fog = scene.fog as THREE.FogExp2;
      fog.density = on ? 0.000052 : 0.012;
      fog.color.set(on ? 0x0a1424 : 0x04070d);   // 世界=夜间月光霾（与天穹地平线同色系）
      scene.environment = on ? nightEnv : hangarEnv;   // IBL 同步切换：夜空月光 / 机库白光
      key.castShadow = !on;
      if (!on) {
        // 机库（白昼级工程照明）
        hemi.intensity = .55; rim.intensity = 1.15;
        key.intensity = 1.75; key.color.set(0xffe7c2);
        fill.intensity = .5;
        renderer.toneMappingExposure = 1.06;
      } else {
        // 世界（真实夜间靶试照明规格：弱月光环境光 + 冷色月面主光 + 较强冷色轮廓光）
        // 环境压暗 = 白色羽流/尾迹在暗背景上高对比，弹道一目了然
        hemi.intensity = .30; rim.intensity = 1.05;
        key.intensity = .52; key.color.set(0xbfd4ff);   // 主光转冷月光（方位不变，与天穹月亮对齐）
        fill.intensity = .0;
        renderer.toneMappingExposure = 1.0;
      }
      // 飞行世界尺度为公里级：放宽相机近/远面与轨道距离限制
      camera.near = on ? 2 : .05;
      camera.far = on ? 80000 : 400;
      camera.updateProjectionMatrix();
      controls.minDistance = on ? 8 : 1.6;
      controls.maxDistance = on ? 60000 : 40;
      controls.enablePan = !on ? true : true;
    },
    shakeAt(v = .28) { shake.amp = Math.max(shake.amp, v); },
    snapView(pos, tgt) {
      camera.position.set(pos[0], pos[1], pos[2]);
      controls.target.set(tgt[0], tgt[1], tgt[2]);
      camTween = null;
    },
  };
}
