/*
 * A rounded cartoon kart for one racer, animated from its `CarState`.
 *
 * `CarModel` assembles the kart from rounded boxes, spheres, and cylinders: a chassis group
 * (body, nose, wing, seat, driver, spoiler) that rolls, pitches, and kicks out sideways under
 * load, plus wheels that spin with speed while the front pair steers. `update` places the kart
 * on the track, eases the body towards poses derived from lateral and longitudinal acceleration,
 * slip, and road grade, and adds a speed-dependent shimmer that grows on grass. `dispose` frees
 * the kart's geometries and materials.
 */
import { BoxGeometry, Color, CylinderGeometry, Group, type Material, Mesh, SphereGeometry, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CAR_SPEC, type CarState } from '../sim/car';
import { toonMaterial } from './toon';

const OUTLINE = 0.0035;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class CarModel {
  readonly root = new Group();
  private readonly chassis = new Group();
  private readonly spinners: Group[] = [];
  private readonly frontMounts: Group[] = [];
  private roll = 0;
  private pitch = 0;
  private kick = 0;
  private wheelTurn = 0;
  private shimmer = 0;

  constructor(color: string) {
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

    this.chassis.add(
      part(new RoundedBoxGeometry(1.7, 0.5, 3.1, 3, 0.22), body, 0, 0.55, 0),
      part(new RoundedBoxGeometry(1.25, 0.38, 1.0, 3, 0.17), body, 0, 0.5, 1.75),
      part(new RoundedBoxGeometry(1.95, 0.2, 0.55, 2, 0.09), accent, 0, 0.4, 2.25),
      part(new RoundedBoxGeometry(1.1, 0.6, 0.8, 3, 0.25), dark, 0, 1.0, -0.6),
      part(new RoundedBoxGeometry(0.75, 0.55, 0.55, 3, 0.22), accent, 0, 1.12, -0.15),
      part(new SphereGeometry(0.38, 16, 12), white, 0, 1.6, -0.15),
      visorMesh,
      part(new RoundedBoxGeometry(2.0, 0.12, 0.6, 2, 0.05), body, 0, 1.38, -1.55),
      part(new RoundedBoxGeometry(0.1, 0.55, 0.14, 1, 0.04), dark, -0.55, 1.08, -1.5),
      part(new RoundedBoxGeometry(0.1, 0.55, 0.14, 1, 0.04), dark, 0.55, 1.08, -1.5),
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
  }

  update(car: CarState, dt: number): void {
    this.root.position.set(car.x, car.y, car.z);
    this.root.rotation.set(-Math.atan(car.grade), car.yaw, 0, 'YXZ');
    const ease = 1 - Math.exp(-dt * 8);
    this.roll += (clamp(-car.latAccel * 0.01, -0.14, 0.14) - this.roll) * ease;
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

  dispose(): void {
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      (object.material as Material).dispose();
    });
  }
}
