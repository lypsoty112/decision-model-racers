/*
 * A rounded cartoon kart for one racer, animated from its `CarState`.
 *
 * `CarModel` assembles the kart from rounded boxes, spheres, and cylinders: a chassis group
 * (body, nose, wing, seat, driver, spoiler) that rolls, pitches, and kicks out sideways under
 * load, plus wheels that spin with speed while the front pair steers, and a camera-facing
 * `label` sprite showing the racer's name in a pill outlined with their colour, drawn by
 * `nameTag`. `setDisplayScale` enlarges the kart and, separately, its name tag so both stay legible
 * from the overhead camera. `update` places the kart
 * on the track, eases the body towards poses derived from lateral and longitudinal acceleration,
 * slip, and road grade, and adds a speed-dependent shimmer that grows on grass. When the car's
 * health changes, `showDamage` darkens the paint towards CHAR as health falls, bends the spoiler
 * below DAMAGE_STAGES.bent, drops the spoiler and front wing below DAMAGE_STAGES.shed, and chars
 * the whole kart at zero, where `update` also lets the body sag. `dispose` frees the kart's
 * geometries and materials.
 */
import { BoxGeometry, Color, CylinderGeometry, Group, type Material, Mesh, type MeshToonMaterial, SphereGeometry, Sprite, SpriteMaterial, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CAR_SPEC, type CarState, MAX_HEALTH } from '../sim/car';
import { toonMaterial } from './toon';
import { canvasTexture } from './trackMesh';

const OUTLINE = 0.0035;
const LABEL_WIDTH = 3.2;
const LABEL_HEIGHT = 0.8;
const CHAR = new Color('#26221f');

export const DAMAGE_STAGES = { bent: 70, shed: 45, burning: 20 };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function nameTag(name: string, color: string): SpriteMaterial {
  const map = canvasTexture(512, 128, (context) => {
    context.font = '800 60px ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif';
    const width = Math.min(500, context.measureText(name).width + 80);
    context.beginPath();
    context.roundRect((512 - width) / 2, 22, width, 84, 42);
    context.fillStyle = 'rgba(16, 24, 44, 0.72)';
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = color;
    context.stroke();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 256, 66, 440);
  });
  return new SpriteMaterial({ map, depthWrite: false });
}

export class CarModel {
  readonly root = new Group();
  readonly label: Sprite;
  private readonly chassis = new Group();
  private readonly spoiler = new Group();
  private readonly frontWing: Mesh;
  private readonly paint: { material: MeshToonMaterial; base: Color }[];
  private shownHealth = MAX_HEALTH;
  private readonly spinners: Group[] = [];
  private readonly frontMounts: Group[] = [];
  private roll = 0;
  private pitch = 0;
  private kick = 0;
  private wheelTurn = 0;
  private shimmer = 0;

  constructor(color: string, name: string) {
    const body = toonMaterial({ color }, OUTLINE);
    const accent = toonMaterial({ color: new Color(color).multiplyScalar(0.62) }, OUTLINE);
    const dark = toonMaterial({ color: '#2b2f45' }, OUTLINE);
    const white = toonMaterial({ color: '#f7f5ef' }, OUTLINE);
    const visor = toonMaterial({ color: '#1b2a4a', emissive: '#3a6ea5', emissiveIntensity: 0.35 }, OUTLINE);
    const tyre = toonMaterial({ color: '#2a2a33' }, OUTLINE);
    const hub = toonMaterial({ color: '#d9dde6' });

    const part = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };
    const visorMesh = part(new SphereGeometry(0.3, 14, 10), visor, 0, 1.62, 0.02);
    visorMesh.scale.set(1.05, 0.55, 1);
    this.paint = [body, accent].map((material) => ({ material, base: material.color.clone() }));
    this.frontWing = part(new RoundedBoxGeometry(1.95, 0.2, 0.55, 2, 0.09), accent, 0, 0.4, 2.25);
    this.spoiler.position.set(0, 1.08, -1.5);
    this.spoiler.add(
      part(new RoundedBoxGeometry(2.0, 0.12, 0.6, 2, 0.05), body, 0, 0.3, -0.05),
      part(new RoundedBoxGeometry(0.1, 0.55, 0.14, 1, 0.04), dark, -0.55, 0, 0),
      part(new RoundedBoxGeometry(0.1, 0.55, 0.14, 1, 0.04), dark, 0.55, 0, 0),
    );

    this.chassis.add(
      part(new RoundedBoxGeometry(1.7, 0.5, 3.1, 3, 0.22), body, 0, 0.55, 0),
      part(new RoundedBoxGeometry(1.25, 0.38, 1.0, 3, 0.17), body, 0, 0.5, 1.75),
      this.frontWing,
      part(new RoundedBoxGeometry(1.1, 0.6, 0.8, 3, 0.25), dark, 0, 1.0, -0.6),
      part(new RoundedBoxGeometry(0.75, 0.55, 0.55, 3, 0.22), accent, 0, 1.12, -0.15),
      part(new SphereGeometry(0.38, 16, 12), white, 0, 1.6, -0.15),
      visorMesh,
      this.spoiler,
    );
    this.root.add(this.chassis);

    const addWheel = (radius: number, width: number, x: number, z: number, steers: boolean) => {
      const spinner = new Group();
      const tyreMesh = part(new CylinderGeometry(radius, radius, width, 18), tyre, 0, 0, 0);
      const hubMesh = part(new CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.02, 10), hub, 0, 0, 0);
      tyreMesh.rotation.z = Math.PI / 2;
      hubMesh.rotation.z = Math.PI / 2;
      spinner.add(tyreMesh, hubMesh, part(new BoxGeometry(width + 0.04, radius * 1.3, 0.12), hub, 0, 0, 0));
      const mount = new Group();
      mount.position.set(x, radius, z);
      mount.add(spinner);
      this.root.add(mount);
      this.spinners.push(spinner);
      if (steers) this.frontMounts.push(mount);
    };
    for (const side of [-1, 1]) {
      addWheel(0.5, 0.5, side * 1.02, -1.05, false);
      addWheel(0.42, 0.4, side * 0.98, 1.2, true);
    }

    this.label = new Sprite(nameTag(name, color));
    this.label.position.y = 2.7;
    this.root.add(this.label);
    this.setDisplayScale(1, 1);
  }

  setDisplayScale(body: number, label: number): void {
    this.root.scale.setScalar(body);
    this.label.scale.set((LABEL_WIDTH * label) / body, (LABEL_HEIGHT * label) / body, 1);
  }

  update(car: CarState, dt: number): void {
    this.root.position.set(car.x, car.y, car.z);
    this.root.rotation.set(-Math.atan(car.grade), car.yaw, 0, 'YXZ');
    if (car.health !== this.shownHealth) this.showDamage(car.health);
    const ease = 1 - Math.exp(-dt * 8);
    const sag = car.health <= 0 ? 0.2 : 0;
    this.roll += (clamp(-car.latAccel * 0.01, -0.14, 0.14) + sag - this.roll) * ease;
    this.pitch += (clamp(-car.longAccel * 0.006, -0.08, 0.1) - this.pitch) * ease;
    this.kick += (-Math.sign(car.latAccel) * car.slip * 0.35 - this.kick) * ease;
    this.chassis.rotation.set(this.pitch, this.kick, this.roll, 'YXZ');

    this.wheelTurn += (car.speed * dt) / 0.45;
    for (const spinner of this.spinners) spinner.rotation.x = this.wheelTurn;
    for (const mount of this.frontMounts) mount.rotation.y = -car.steer * 0.45;

    const speedRatio = Math.min(1, Math.abs(car.speed) / CAR_SPEC.maxSpeed);
    this.shimmer += dt * 45;
    this.chassis.position.y = Math.sin(this.shimmer) * speedRatio * (car.onRoad ? 0.012 : 0.06);
  }

  private showDamage(health: number): void {
    this.shownHealth = health;
    const scorch = health > 0 ? (1 - health / MAX_HEALTH) * 0.5 : 0.85;
    for (const { material, base } of this.paint) material.color.copy(base).lerp(CHAR, scorch);
    const bend = health < DAMAGE_STAGES.bent ? 1 : 0;
    this.spoiler.rotation.set(0.35 * bend, 0, 0.3 * bend);
    this.spoiler.visible = this.frontWing.visible = health >= DAMAGE_STAGES.shed;
  }

  dispose(): void {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      (object.material as Material).dispose();
    });
  }
}
