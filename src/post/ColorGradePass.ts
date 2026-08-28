import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* 电影级色彩分级后处理：色差 + 暗角 + 胶片颗粒 + 对比度/饱和度 */
const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uChromaticAberration: { value: 0.0032 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uContrast: { value: 1.08 },
    uSaturation: { value: 1.12 },
    uLift: { value: 0.02 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uChromaticAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uLift;
    varying vec2 vUv;

    // pseudo-random
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float radius = length(center);

      // 径向色差：R/B 通道按半径反向偏移
      vec2 dir = normalize(center + 1e-5);
      vec2 offset = dir * uChromaticAberration * radius;
      float r = texture2D(tDiffuse, uv + offset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - offset * 0.7).b;
      vec3 col = vec3(r, g, b);

      // 暗角
      float vign = 1.0 - uVignette * smoothstep(0.35, 1.15, radius);
      col *= vign;

      // 胶片颗粒
      float grain = (hash(uv * uResolution + fract(uTime * 0.0001)) - 0.5) * uGrain;
      col += grain;

      // 对比度
      col = (col - 0.5) * uContrast + 0.5;

      // 饱和度
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, uSaturation);

      // 暗部提亮（lift）
      col += uLift * (1.0 - luma);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class ColorGradePass extends ShaderPass {
  constructor() {
    super(ColorGradeShader);
  }
}
