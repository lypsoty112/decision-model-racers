/*
 * Sky, sunlight, and atmosphere, with three time-of-day presets.
 *
 * `Environment` adds a gradient sky dome with a soft sun glow (a small ShaderMaterial drawn at
 * the far plane and kept centred on the camera), a hemisphere fill light, a shadow-casting sun,
 * and distance fog tinted to the horizon so far scenery melts into the sky. `setTimeOfDay`
 * applies a `TIME_PRESETS` entry to every colour, intensity, and the sun direction. `follow`
 * keeps the sun's shadow frustum centred on the focused car so nearby shadows stay crisp.
 */
import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

export type TimeOfDay = 'morning' | 'golden' | 'dusk';

type Preset = {
  label: string;
  zenith: string;
  horizon: string;
  sun: string;
  sunIntensity: number;
  sky: string;
  ground: string;
  fill: number;
  sunDirection: [number, number, number];
  fogFar: number;
};

export const TIME_PRESETS: Record<TimeOfDay, Preset> = {
  morning: {
    label: 'Morning',
    zenith: '#3b8ad8',
    horizon: '#c8eef7',
    sun: '#fff1d2',
    sunIntensity: 2.7,
    sky: '#d8f0ff',
    ground: '#86a65e',
    fill: 1.6,
    sunDirection: [0.45, 0.75, 0.35],
    fogFar: 1700,
  },
  golden: {
    label: 'Golden hour',
    zenith: '#4c79c2',
    horizon: '#ffd3a0',
    sun: '#ffbf6e',
    sunIntensity: 3,
    sky: '#ffe2c2',
    ground: '#76784a',
    fill: 1.3,
    sunDirection: [-0.7, 0.3, 0.45],
    fogFar: 1500,
  },
  dusk: {
    label: 'Dusk',
    zenith: '#1e2a66',
    horizon: '#f29a7c',
    sun: '#ff9672',
    sunIntensity: 1.9,
    sky: '#a493e6',
    ground: '#3e4a3c',
    fill: 1.1,
    sunDirection: [0.75, 0.17, -0.45],
    fogFar: 1300,
  },
};

const SHADOW_EXTENT = 70;

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;

const skyFragmentShader = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.55, height), 0.7));
    float toSun = max(dot(direction, sunDirection), 0.0);
    color += sunColor * (smoothstep(0.9975, 0.999, toSun) * 1.4 + pow(toSun, 24.0) * 0.35);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Environment {
  private readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly sun = new DirectionalLight();
  private readonly fill = new HemisphereLight();
  private readonly fog = new Fog('#ffffff', 160, 1700);
  private readonly sunDirection = new Vector3();

  constructor(scene: Scene) {
    const skyMaterial = new ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      uniforms: {
        zenith: { value: new Color() },
        horizon: { value: new Color() },
        sunColor: { value: new Color() },
        sunDirection: { value: this.sunDirection },
      },
      side: BackSide,
      depthWrite: false,
    });
    skyMaterial.userData.outlineParameters = { visible: false };
    this.sky = new Mesh(new SphereGeometry(3000, 32, 16), skyMaterial);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;

    scene.fog = this.fog;
    scene.add(this.sky, this.sun, this.sun.target, this.fill);
  }

  setTimeOfDay(time: TimeOfDay): void {
    const preset = TIME_PRESETS[time];
    const uniforms = this.sky.material.uniforms;
    uniforms.zenith.value.set(preset.zenith);
    uniforms.horizon.value.set(preset.horizon);
    uniforms.sunColor.value.set(preset.sun);
    this.sunDirection.set(...preset.sunDirection).normalize();
    this.sun.color.set(preset.sun);
    this.sun.intensity = preset.sunIntensity;
    this.fill.color.set(preset.sky);
    this.fill.groundColor.set(preset.ground);
    this.fill.intensity = preset.fill;
    this.fog.color.set(preset.horizon);
    this.fog.far = preset.fogFar;
  }

  follow(focus: Vector3, cameraPosition: Vector3): void {
    this.sky.position.copy(cameraPosition);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDirection, 300);
  }
}
