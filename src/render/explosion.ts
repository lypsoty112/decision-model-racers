/*
 * Crash effects: the explosion when a kart is wrecked and the parts it sheds on the way there.
 *
 * `Explosions` keeps a fixed ring of CHUNK_COUNT tumbling chunks and one flash light. `burst`
 * throws fire and soot into the shared `Particles`, flings BURST_CHUNKS chunks in the kart's colour
 * and dark metal, and fires the flash; `shed` flings SHED_CHUNKS chunks and a puff of soot when a
 * kart loses its wings. `fling` launches chunks from the kart, carrying some of its speed. `update`
 * moves chunks under gravity, bounces them off the height they started from, shrinks them away at
 * the end of their life, and fades the flash.
 */
import { BoxGeometry, Color, Group, Mesh, type MeshToonMaterial, PointLight } from 'three';
import type { CarState } from '../sim/car';
import type { Particles } from './speedEffects';
import { toonMaterial } from './toon';

type Chunk = { mesh: Mesh<BoxGeometry, MeshToonMaterial>; vx: number; vy: number; vz: number; spin: number; floor: number; size: number; life: number };

const CHUNK_COUNT = 48;
const BURST_CHUNKS = 14;
const SHED_CHUNKS = 3;
const CHUNK_LIFE = 2.5;
const GRAVITY = 18;
const FLASH = 150;
const FIRE = [new Color('#ffd166'), new Color('#ff8c42'), new Color('#ff5d3a')];
const SOOT = new Color('#3a3a44');
const METAL = new Color('#2b2f45');

export class Explosions {
  readonly group = new Group();
  private readonly particles: Particles;
  private readonly chunks: Chunk[];
  private readonly flash = new PointLight('#ffb347', 0, 40, 2);
  private next = 0;

  constructor(particles: Particles) {
    this.particles = particles;
    const geometry = new BoxGeometry(0.45, 0.2, 0.35);
    this.chunks = Array.from({ length: CHUNK_COUNT }, () => {
      const mesh = new Mesh(geometry, toonMaterial({ color: METAL }, 0.003));
      mesh.visible = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      return { mesh, vx: 0, vy: 0, vz: 0, spin: 0, floor: 0, size: 1, life: 0 };
    });
    this.group.add(this.flash);
  }

  burst(car: CarState, color: Color): void {
    for (let i = 0; i < 60; i++) {
      const fire = i < 36;
      const angle = Math.random() * 2 * Math.PI;
      const out = Math.random() * (fire ? 6 : 3);
      this.particles.emit(
        car.x,
        car.y + 0.8,
        car.z,
        Math.cos(angle) * out,
        (fire ? 3 : 1.5) + Math.random() * 4,
        Math.sin(angle) * out,
        fire ? FIRE[i % FIRE.length] : SOOT,
        fire ? 1.4 : 1.6,
        fire ? 0.95 : 0.55,
        fire ? 0.6 + Math.random() * 0.5 : 1.6 + Math.random(),
      );
    }
    this.fling(car, color, BURST_CHUNKS, 10);
    this.flash.position.set(car.x, car.y + 2, car.z);
    this.flash.intensity = FLASH;
  }

  shed(car: CarState, color: Color): void {
    for (let i = 0; i < 8; i++) this.particles.emit(car.x, car.y + 1, car.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, SOOT, 1.6, 0.6, 1.2);
    this.fling(car, color, SHED_CHUNKS, 4);
  }

  update(dt: number): void {
    for (const chunk of this.chunks) {
      if (chunk.life <= 0) continue;
      chunk.life -= dt;
      chunk.vy -= GRAVITY * dt;
      const { position, rotation, scale } = chunk.mesh;
      position.set(position.x + chunk.vx * dt, position.y + chunk.vy * dt, position.z + chunk.vz * dt);
      if (position.y < chunk.floor) {
        position.y = chunk.floor;
        chunk.vy *= -0.35;
        chunk.vx *= 0.7;
        chunk.vz *= 0.7;
        chunk.spin *= 0.7;
      }
      rotation.x += chunk.spin * dt;
      rotation.z += chunk.spin * 0.7 * dt;
      scale.setScalar(chunk.size * Math.min(1, chunk.life / 0.5));
      chunk.mesh.visible = chunk.life > 0;
    }
    this.flash.intensity *= Math.exp(-dt * 6);
  }

  private fling(car: CarState, color: Color, count: number, force: number): void {
    const carryX = Math.sin(car.yaw) * car.speed * 0.5;
    const carryZ = Math.cos(car.yaw) * car.speed * 0.5;
    for (let i = 0; i < count; i++) {
      const chunk = this.chunks[this.next];
      this.next = (this.next + 1) % this.chunks.length;
      const angle = Math.random() * 2 * Math.PI;
      chunk.mesh.material.color.copy(i % 2 === 0 ? color : METAL);
      chunk.mesh.position.set(car.x, car.y + 0.8, car.z);
      chunk.mesh.visible = true;
      chunk.vx = carryX + Math.cos(angle) * force * Math.random();
      chunk.vy = 4 + Math.random() * force;
      chunk.vz = carryZ + Math.sin(angle) * force * Math.random();
      chunk.spin = (Math.random() - 0.5) * 20;
      chunk.floor = car.y + 0.12;
      chunk.size = 0.6 + Math.random() * 0.8;
      chunk.life = CHUNK_LIFE;
    }
  }
}
