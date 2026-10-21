/*
 * Crash debris: the parts a kart sheds when it is badly damaged and when it slams into something.
 *
 * `Debris` keeps a fixed ring of CHUNK_COUNT tumbling chunks. `shed` flings SHED_CHUNKS chunks and
 * a puff of soot when a kart loses its wings; `impact` flings up to IMPACT_CHUNKS chunks and a
 * burst of dust from a crashed kart's body, more for a harder hit. `fling` launches chunks from a
 * point, carrying some of the kart's velocity. `update` moves chunks under gravity, bounces them
 * off the height they started from, and shrinks them away at the end of their life.
 */
import { BoxGeometry, Color, Group, Mesh, type MeshToonMaterial, Vector3 } from 'three';
import type { CarState } from '../sim/car';
import type { CrashBody } from '../sim/crash';
import type { Particles } from './speedEffects';
import { toonMaterial } from './toon';

type Chunk = { mesh: Mesh<BoxGeometry, MeshToonMaterial>; vx: number; vy: number; vz: number; spin: number; floor: number; size: number; life: number };

const CHUNK_COUNT = 48;
const SHED_CHUNKS = 3;
const IMPACT_CHUNKS = 4;
const CHUNK_LIFE = 2.5;
const GRAVITY = 18;
const SOOT = new Color('#3a3a44');
const DUST = new Color('#cdb98c');
const METAL = new Color('#2b2f45');

export class Debris {
  readonly group = new Group();
  private readonly particles: Particles;
  private readonly chunks: Chunk[];
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
  }

  shed(car: CarState, color: Color): void {
    for (let i = 0; i < 8; i++) this.particles.emit(car.x, car.y + 1, car.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, SOOT, 1.6, 0.6, 1.2);
    const carry = new Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw)).multiplyScalar(car.speed * 0.5);
    this.fling(new Vector3(car.x, car.y + 0.8, car.z), carry, car.y + 0.12, color, SHED_CHUNKS, 4);
  }

  impact(body: CrashBody, floor: number, color: Color, strength: number): void {
    const { x, y, z } = body.position;
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const out = Math.random() * strength * 0.3;
      this.particles.emit(x, y, z, Math.cos(angle) * out, 1 + Math.random() * 3, Math.sin(angle) * out, i % 3 ? DUST : SOOT, 1.6, 0.7, 0.8 + Math.random() * 0.6);
    }
    const count = Math.min(IMPACT_CHUNKS, Math.ceil(strength / 6));
    this.fling(body.position, body.velocity.clone().multiplyScalar(0.5), floor + 0.12, color, count, strength * 0.4);
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
  }

  private fling(origin: Vector3, carry: Vector3, floor: number, color: Color, count: number, force: number): void {
    for (let i = 0; i < count; i++) {
      const chunk = this.chunks[this.next];
      this.next = (this.next + 1) % this.chunks.length;
      const angle = Math.random() * 2 * Math.PI;
      chunk.mesh.material.color.copy(i % 2 === 0 ? color : METAL);
      chunk.mesh.position.copy(origin);
      chunk.mesh.visible = true;
      chunk.vx = carry.x + Math.cos(angle) * force * Math.random();
      chunk.vy = 4 + Math.random() * force;
      chunk.vz = carry.z + Math.sin(angle) * force * Math.random();
      chunk.spin = (Math.random() - 0.5) * 20;
      chunk.floor = floor;
      chunk.size = 0.6 + Math.random() * 0.8;
      chunk.life = CHUNK_LIFE;
    }
  }
}
