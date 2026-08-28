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
  controls.minDistance = .8;
  controls.maxDistance = 30;
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
  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);
  function syncPost() {
    const pr = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
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
    // 地盘：深色亚光实验室地板（轻微反射，避免环境反光过曝）
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(11, 96),
      new THREE.MeshPhysicalMaterial({
        color: 0x070d17, metalness: .35, roughness: .62,
        clearcoat: .15, clearcoatRoughness: .5, envMapIntensity: .5,
      })
    );
    disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true;
    hangar.add(disc);
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

    // 全息投影基座：从地面投向弹体的光锥 + 投射盘
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb454, transparent: true, opacity: .05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.42, 1.15, 1.5, 40, 1, true), beamMat);
    beam.position.y = .75; beam.name = 'holoBeam';
    hangar.add(beam);
    const projBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.18, 1.34, .1, 48),
      new THREE.MeshPhysicalMaterial({ color: 0x141d2b, metalness: .7, roughness: .3, clearcoat: .6 })
    );
    projBase.position.y = .05; hangar.add(projBase);
    const projGlow = new THREE.Mesh(
      new THREE.RingGeometry(.5, 1.12, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    projGlow.rotation.x = -Math.PI / 2; projGlow.position.y = .105; projGlow.name = 'projGlow';
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
    // 大网格线：每 2 km 一根，覆盖 [-60,60] km
    const gridPts = [], EXT = 60000, STEP = 2000;
    const mat = new THREE.LineBasicMaterial({ color: 0x16304f, transparent: true, opacity: .34 });
    for (let x = -EXT; x <= EXT; x += STEP) {
      gridPts.push(x, .5, -EXT, x, .5, EXT);
      gridPts.push(-EXT, .5, x, EXT, .5, x);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    world.add(new THREE.LineSegments(gg, mat));
    // 发射台（示意斜轨）
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 6, 28),
      new THREE.MeshStandardMaterial({ color: 0x1a2331, metalness: .3, roughness: .8 }));
    pad.position.y = 3; world.add(pad);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 16, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x39434f, metalness: .7, roughness: .4 }));
    rail.position.set(0, 10.4, 0); rail.rotation.z = -.19;   // ≈79° 初始射角
    world.add(rail);
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

  /* ---------- 每帧更新 ---------- */
  const shake = { amp: 0 };
  function update(dt, controlsEnabled = true) {
    controls.enabled = controlsEnabled;
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
    setWorldMode(on) {
      hangar.visible = !on; world.visible = !!on;
      scene.fog.density = on ? 0.000016 : 0.012;
      key.castShadow = !on;
      if (!on) { hemi.intensity = .55; rim.intensity = 1.15; }
      else { hemi.intensity = .32; rim.intensity = .5; }
      // 飞行世界尺度为公里级：放宽相机近/远面与轨道距离限制
      camera.near = on ? 2 : .05;
      camera.far = on ? 80000 : 400;
      camera.updateProjectionMatrix();
      controls.minDistance = on ? 8 : 3.4;
      controls.maxDistance = on ? 60000 : 30;
      controls.enablePan = !on ? true : true;
    },
    shakeAt(v = .28) { shake.amp = Math.max(shake.amp, v); },
    snapView(pos, tgt) {
      camera.position.set(...pos); controls.target.set(...tgt);
      camTween = null;
    },
  };
}
