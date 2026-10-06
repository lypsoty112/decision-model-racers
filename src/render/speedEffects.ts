/*
 * Screen and world effects that make speed visible.
 *
 * `SpeedLines` draws a full-screen overlay after the scene: radial anime-style streaks that rush
 * outwards from the vanishing point, plus a dark-blue vignette, both scaled by `intensity`.
 * `Particles` is a fixed pool of soft, camera-facing puffs (dust off the grass, tyre smoke when
 * sliding) recycled as a ring buffer. `emit` spawns one puff, and `update` moves, grows, and
 * fades every live puff and keeps the point size correct for the current camera and viewport.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  Mesh,
  NormalBlending,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  type WebGLRenderer,
} from 'three';

const linesVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const linesFragmentShader = /* glsl */ `
  uniform float time;
  uniform float intensity;
  uniform float aspect;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    vec2 p = (vUv - vec2(0.5, 0.47)) * vec2(aspect, 1.0);
    float radius = length(p);
    float angle = atan(p.y, p.x) / 6.2831853 + 0.5;
    float lane = floor(angle * 220.0);
    float across = abs(fract(angle * 220.0) - 0.5) * 2.0;
    float seed = hash(lane);
    float shown = step(0.5, hash(lane + floor(time * (5.0 + seed * 7.0))));
    float travel = fract(radius * 0.9 - time * (1.8 + seed * 2.0) + seed * 7.0);
    float streak = smoothstep(0.0, 0.06, travel) * smoothstep(0.5, 0.1, travel);
    float line = smoothstep(0.5, 0.0, across) * shown * streak * smoothstep(0.2, 0.75, radius);
    float alpha = line * intensity * 0.85;
    float vignette = smoothstep(0.5, 1.1, radius) * intensity * 0.32;
    vec3 color = mix(vec3(0.04, 0.07, 0.18), vec3(1.0), alpha / max(alpha + vignette, 0.0001));
    gl_FragColor = vec4(color, max(alpha, vignette));
  }
`;

export class SpeedLines {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material = new ShaderMaterial({
    vertexShader: linesVertexShader,
    fragmentShader: linesFragmentShader,
    uniforms: { time: { value: 0 }, intensity: { value: 0 }, aspect: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: NormalBlending,
  });

  constructor() {
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(renderer: WebGLRenderer, intensity: number, dt: number, aspect: number): void {
    const uniforms = this.material.uniforms;
    uniforms.time.value += dt;
    uniforms.intensity.value += (intensity - uniforms.intensity.value) * Math.min(1, dt * 4);
    uniforms.aspect.value = aspect;
    if (uniforms.intensity.value < 0.01) return;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}

const particleVertexShader = /* glsl */ `
  uniform float scale;
  attribute float size;
  attribute vec4 tint;
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const particleFragmentShader = /* glsl */ `
  varying vec4 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vTint.rgb, vTint.a * smoothstep(0.5, 0.15, d));
    #include <colorspace_fragment>
  }
`;

export class Particles {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly tint: Float32Array;
  private readonly size: Float32Array;
  private readonly startSize: Float32Array;
  private readonly startAlpha: Float32Array;
  private readonly life: Float32Array;
  private readonly lifetime: Float32Array;
  private next = 0;

  constructor(capacity: number) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.tint = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.startSize = new Float32Array(capacity);
    this.startAlpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.lifetime = new Float32Array(capacity).fill(1);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    geometry.setAttribute('tint', new BufferAttribute(this.tint, 4));
    geometry.setAttribute('size', new BufferAttribute(this.size, 1));
    const material = new ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      uniforms: { scale: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: Color, size: number, alpha: number, lifetime: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.life.length;
    this.position.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.tint.set([color.r, color.g, color.b, alpha], i * 4);
    this.startSize[i] = size;
    this.startAlpha[i] = alpha;
    this.life[i] = lifetime;
    this.lifetime[i] = lifetime;
  }

  update(dt: number, camera: PerspectiveCamera, viewportHeight: number): void {
    const drag = Math.exp(-dt * 2);
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] <= 0) {
        this.tint[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const remaining = Math.max(0, this.life[i] / this.lifetime[i]);
      for (let axis = 0; axis < 3; axis++) {
        this.position[i * 3 + axis] += this.velocity[i * 3 + axis] * dt;
        this.velocity[i * 3 + axis] *= drag;
      }
      this.velocity[i * 3 + 1] += 0.8 * dt;
      this.size[i] = this.startSize[i] * (1 + (1 - remaining) * 2.2);
      this.tint[i * 4 + 3] = this.startAlpha[i] * remaining;
    }
    const geometry = this.points.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('tint').needsUpdate = true;
    geometry.getAttribute('size').needsUpdate = true;
    this.points.material.uniforms.scale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
}
