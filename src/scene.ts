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
    // 地面（米制）
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000),
      new THREE.MeshStandardMaterial({ color: 0x06101d, metalness: .1, roughness: .95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = false;
    ground.name = 'ground';
    world.add(ground);
    // 网格分两级：粗网格 2 km 一根看战略尺度，
    // 细网格 250 m 一根覆盖弹道走廊——跟拍距离只有几十米时，
    // 没有近处参照物就完全感觉不到速度。
    const gridPts = [], EXT = 60000, STEP = 2000;
    const mat = new THREE.LineBasicMaterial({ color: 0x16304f, transparent: true, opacity: .34 });
    for (let x = -EXT; x <= EXT; x += STEP) {
      gridPts.push(x, .5, -EXT, x, .5, EXT);
      gridPts.push(-EXT, .5, x, EXT, .5, x);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    world.add(new THREE.LineSegments(gg, mat));

    const finePts = [], FEXT = 9000, FSTEP = 250;
    const fineMat = new THREE.LineBasicMaterial({ color: 0x1d4a78, transparent: true, opacity: .22 });
    for (let x = -FEXT; x <= FEXT; x += FSTEP) {
      finePts.push(x, .6, -FEXT, x, .6, FEXT);
      finePts.push(-FEXT, .6, x, FEXT, .6, x);
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
    // 塔顶(-8,*,6.5) → 弹轴上(≈1.2,10,0)，长度 ≈ 11.2，绕 Y 轴对准弹体
    const arm = new THREE.Mesh(new THREE.BoxGeometry(11.2, .7, 1.0), strutMat);
    arm.position.set(-3.4, 10, 3.25);
    arm.rotation.y = Math.atan2(0 - 6.5, 1.2 - (-8));      // ≈ -0.62 rad，指向弹体
    arm.userData.armBase = arm.rotation.y;
    arm.name = 'towerArm';
    world.add(arm);
    // 持垂夹持 ×2：点火时夹住弹体尾部承受推力（导弹不上飞），
    // T-0 爆炸螺栓释放、向两侧张开——由 main 按名称驱动开合
    const clampMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, metalness: .62, roughness: .42 });
    for (const s of [-1, 1]) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.6, 1.4), clampMat);
      clamp.position.set(-.7, 1.8, s * 1.6);   // 弹尾两侧（弹体世界半径 ≈1.3）
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
      (scene.fog as THREE.FogExp2).density = on ? 0.000016 : 0.012;
      key.castShadow = !on;
      if (!on) { hemi.intensity = .55; rim.intensity = 1.15; }
      else { hemi.intensity = .32; rim.intensity = .5; }
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
