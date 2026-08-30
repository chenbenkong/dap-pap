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
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;

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
  {
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
    // 地面（米制）—— 海面之外露出的底色也按深海处理
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000),
      new THREE.MeshStandardMaterial({ color: 0x0a2733, metalness: .1, roughness: .95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = false;
    ground.name = 'ground';
    world.add(ground);

    /* ---------- 天空穹顶：Canvas 渐变（天顶深蓝 → 暖色地平霾 + 太阳光晕 + 高云） ---------- */
    const skyW = 1024, skyH = 512;
    const scv = document.createElement('canvas'); scv.width = skyW; scv.height = skyH;
    const sctx = scv.getContext('2d');
    const skyGrad = sctx.createLinearGradient(0, 0, 0, skyH);
    skyGrad.addColorStop(0, '#1c4e86');
    skyGrad.addColorStop(.38, '#5f9bc4');
    skyGrad.addColorStop(.62, '#a8c8da');
    skyGrad.addColorStop(.78, '#e8d9b8');
    skyGrad.addColorStop(1, '#c4b39a');
    sctx.fillStyle = skyGrad; sctx.fillRect(0, 0, skyW, skyH);
    // 太阳（方位与主光方向一致：世界方向 (6,9,5) → 球面 u≈0.11, v≈0.24）
    const su = .11 * skyW, sv = .24 * skyH;
    const sg = sctx.createRadialGradient(su, sv, 0, su, sv, 170);
    sg.addColorStop(0, 'rgba(255,253,240,1)');
    sg.addColorStop(.1, 'rgba(255,241,208,.95)');
    sg.addColorStop(.34, 'rgba(255,226,175,.42)');
    sg.addColorStop(1, 'rgba(255,220,170,0)');
    sctx.fillStyle = sg; sctx.fillRect(su - 180, sv - 180, 360, 360);
    // 稀薄高云（几条横向柔光涂抹）
    sctx.fillStyle = 'rgba(255,255,255,.15)';
    for (let i = 0; i < 9; i++) {
      const cy = 60 + Math.random() * 150, cx = Math.random() * skyW, w = 130 + Math.random() * 280;
      sctx.beginPath(); sctx.ellipse(cx, cy, w, 9 + Math.random() * 11, 0, 0, Math.PI * 2); sctx.fill();
    }
    const skyTex = new THREE.CanvasTexture(scv);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.name = 'skyDome';
    world.add(sky);

    // 近岸发射岛：暗色岩土盘，发射台立其上（岛顶 y=0 与基座底齐平）
    const land = new THREE.Mesh(new THREE.CylinderGeometry(2600, 3400, 2, 64),
      new THREE.MeshStandardMaterial({ color: 0x2c3338, metalness: .15, roughness: .92 }));
    land.position.y = -1;
    world.add(land);

    // 海面：半透明深蓝反射水，让下方网格透出做"战术海图"深度参考线
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(50000, 50000),
      new THREE.MeshPhysicalMaterial({
        color: 0x0b425c, metalness: .6, roughness: .34,
        transparent: true, opacity: .82, depthWrite: false, envMapIntensity: .35,
      }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = .16;
    world.add(ocean);

    // 漂浮云层：扁平柔光云片（低空稀薄，不挡视线）
    const cloudCv = document.createElement('canvas'); cloudCv.width = cloudCv.height = 128;
    const cg = cloudCv.getContext('2d');
    const crg = cg.createRadialGradient(64, 64, 4, 64, 64, 62);
    crg.addColorStop(0, 'rgba(255,255,255,.8)'); crg.addColorStop(.5, 'rgba(255,255,255,.32)'); crg.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = crg; cg.fillRect(0, 0, 128, 128);
    const cloudTex = new THREE.CanvasTexture(cloudCv);
    const clouds = new THREE.Group(); clouds.name = 'clouds';
    const cMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: .5, fog: false, depthWrite: false });
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
    // 两条网格都压到海面下（y≈0.06/0.08），透过半透明海面读出"海图深度线"。
    const gridPts = [], EXT = 60000, STEP = 2000;
    const mat = new THREE.LineBasicMaterial({ color: 0x16304f, transparent: true, opacity: .34 });
    for (let x = -EXT; x <= EXT; x += STEP) {
      gridPts.push(x, .06, -EXT, x, .06, EXT);
      gridPts.push(-EXT, .06, x, EXT, .06, x);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    world.add(new THREE.LineSegments(gg, mat));

    const finePts = [], FEXT = 9000, FSTEP = 250;
    const fineMat = new THREE.LineBasicMaterial({ color: 0x1d4a78, transparent: true, opacity: .2 });
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
    get camAuto() { return camAuto; },
    setWorldMode(on) {
      hangar.visible = !on; world.visible = !!on;
      // 世界=近海晴空：雾改成地平线霾色、浓度压到可透视量级；
      // 机库=暗室：浓黑雾
      const fog = scene.fog as THREE.FogExp2;
      fog.density = on ? 0.000045 : 0.012;
      fog.color.set(on ? 0xa9bfd2 : 0x04070d);
      key.castShadow = !on;
      if (!on) { hemi.intensity = .55; rim.intensity = 1.15; }
      else { hemi.intensity = .45; rim.intensity = .6; }
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
