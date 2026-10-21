/*
 * The three.js side of the game: renderer, scene, and the per-frame loop.
 *
 * `GameEngine` builds the environment once and swaps the karts whenever `setRace` receives a new
 * race. `buildWorld` makes the track-dependent part (landscape, track meshes, and the overhead
 * and TV cameras) and `setRace` rebuilds it, freeing the old meshes, when the new race runs on a
 * different track. Each animation frame advances the race unless
 * `paused`, poses every `CarModel`, kicks up dust and tyre smoke in `emitTrail`, trails soot and
 * flames from damaged karts in `emitDamage`, throws `Debris` when `reactToDamage` sees a kart shed
 * its wings or `reactToCrash` sees a kart crash or its tumbling body slam into something (jolting
 * the chase camera when it is the followed kart), and films the
 * race with the camera chosen by `setCameraMode`: the chase camera behind the focused racer
 * (`setFocus`; the leader when the id is unknown), the whole-track overhead view (karts and
 * name tags enlarged by `applyDisplayScale`, fog pushed back by the camera's distance), or the
 * TV director, whose choice of racer is
 * reported through `onFocusChange`. It renders through three's OutlineEffect for ink lines and,
 * in chase view only, draws the speed-line overlay on top. `setTimeOfDay` re-lights the scene;
 * `dispose` stops the loop and frees the WebGL context.
 */
import { Color, Group, Mesh, type MeshToonMaterial, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { CAR_SPEC, type CarState, MAX_HEALTH } from '../sim/car';
import { liftOf } from '../sim/crash';
import type { Race, Racer } from '../sim/race';
import type { Track } from '../sim/track';
import { CarModel, DAMAGE_STAGES } from './carModel';
import { ChaseCamera } from './chaseCamera';
import { Debris } from './debris';
import { Environment, type TimeOfDay } from './environment';
import { buildLandscape } from './landscape';
import { OverheadCamera, TvCamera } from './spectatorCameras';
import { Particles, SpeedLines } from './speedEffects';
import { buildTrackMesh } from './trackMesh';

const DUST = new Color('#cdb98c');
const SMOKE = new Color('#eef1f6');
const SOOT = new Color('#4a4650');
const FLAME = new Color('#ff8c42');
const OVERHEAD_KART_SCALE = 4;
const OVERHEAD_LABEL_SCALE = 14;
const CRASH_START_STRENGTH = 10;

export type CameraMode = 'chase' | 'overhead' | 'tv';

export class GameEngine {
  paused = false;
  onFocusChange: ((id: string) => void) | null = null;
  private cameraMode: CameraMode = 'chase';
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly scene = new Scene();
  private readonly outline: OutlineEffect;
  private readonly chase = new ChaseCamera();
  private readonly world = new Group();
  private readonly container: HTMLElement;
  private overhead!: OverheadCamera;
  private tv!: TvCamera;
  private readonly focusPoint = new Vector3();
  private readonly environment: Environment;
  private readonly speedLines = new SpeedLines();
  private readonly particles = new Particles(1500);
  private readonly debris = new Debris(this.particles);
  private readonly models = new Map<string, CarModel>();
  private readonly health = new Map<string, number>();
  private readonly crashHits = new Map<string, number>();
  private readonly resizeObserver: ResizeObserver;
  private race: Race;
  private focusId = '';
  private frameHandle = 0;
  private lastTime = performance.now();

  constructor(container: HTMLElement, race: Race) {
    this.container = container;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.outline = new OutlineEffect(this.renderer, { defaultThickness: 0.003, defaultColor: [0.09, 0.1, 0.16] });
    this.outline.autoClear = true;
    this.environment = new Environment(this.scene);
    this.scene.add(this.world, this.particles.points, this.debris.group);
    this.buildWorld(race.track);
    this.race = race;
    this.setRace(race);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  setRace(race: Race): void {
    if (race.track !== this.race.track) {
      this.buildWorld(race.track);
      this.resize();
    }
    for (const model of this.models.values()) {
      this.scene.remove(model.root);
      model.dispose();
    }
    this.models.clear();
    this.health.clear();
    this.crashHits.clear();
    for (const racer of race.racers) {
      const model = new CarModel(racer.color, racer.name);
      this.applyDisplayScale(model);
      this.models.set(racer.id, model);
      this.scene.add(model.root);
    }
    this.race = race;
    this.chase.snap();
  }

  setFocus(id: string): void {
    if (id === this.focusId) return;
    this.focusId = id;
    this.chase.snap();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    for (const model of this.models.values()) this.applyDisplayScale(model);
    this.chase.snap();
  }

  setTimeOfDay(time: TimeOfDay): void {
    this.environment.setTimeOfDay(time);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    for (const model of this.models.values()) model.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private buildWorld(track: Track): void {
    this.world.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of [object.material].flat() as MeshToonMaterial[]) {
        material.map?.dispose();
        material.dispose();
      }
    });
    this.world.clear();
    this.world.add(buildLandscape(track), buildTrackMesh(track));
    this.overhead = new OverheadCamera(track);
    this.tv = new TvCamera(track);
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container;
    this.renderer.setSize(clientWidth, clientHeight);
    for (const view of [this.chase, this.overhead, this.tv]) view.resize(clientWidth, clientHeight);
  }

  private applyDisplayScale(model: CarModel): void {
    if (this.cameraMode === 'overhead') model.setDisplayScale(OVERHEAD_KART_SCALE, OVERHEAD_LABEL_SCALE);
    else model.setDisplayScale(1, 1);
  }

  private readonly frame = (now: number) => {
    this.frameHandle = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.paused) this.race.update(dt);
    for (const racer of this.race.racers) {
      this.models.get(racer.id)?.update(racer.car, dt);
      this.reactToDamage(racer);
      this.reactToCrash(racer);
      if (!this.paused) {
        this.emitTrail(racer.car, dt);
        this.emitDamage(racer.car, dt);
      }
    }
    this.debris.update(this.paused ? 0 : dt);
    if (this.cameraMode === 'tv') {
      const subjectId = this.tv.update(this.race, dt);
      if (subjectId !== this.focusId) {
        this.focusId = subjectId;
        this.onFocusChange?.(subjectId);
      }
    }
    const focused = this.race.racers.find((racer) => racer.id === this.focusId) ?? this.race.standings()[0];
    if (this.cameraMode === 'chase') this.chase.follow(focused.car, dt);
    const camera = { chase: this.chase.camera, overhead: this.overhead.camera, tv: this.tv.camera }[this.cameraMode];
    this.environment.follow(this.focusPoint.set(focused.car.x, focused.car.y, focused.car.z), camera.position);
    this.environment.setFogOffset(this.cameraMode === 'overhead' ? this.overhead.distance : 0);
    this.particles.update(this.paused ? 0 : dt, camera, this.renderer.domElement.height);
    this.outline.render(this.scene, camera);
    const speedRatio = Math.abs(focused.car.speed) / CAR_SPEC.maxSpeed;
    const intensity = Math.max(0, Math.min(1, (speedRatio - 0.4) / 0.45)) + focused.car.draft * 0.3;
    this.speedLines.render(this.renderer, this.paused || this.cameraMode !== 'chase' ? 0 : intensity, dt, camera.aspect);
  };

  private reactToDamage({ id, car, color }: Racer): void {
    const previous = this.health.get(id) ?? MAX_HEALTH;
    this.health.set(id, car.health);
    if (previous >= DAMAGE_STAGES.shed && car.health < DAMAGE_STAGES.shed) this.debris.shed(car, new Color(color));
  }

  private reactToCrash({ id, car, color }: Racer): void {
    const hits = car.crash ? car.crash.hits : -1;
    if (car.crash && hits > (this.crashHits.get(id) ?? -1)) {
      const strength = Math.max(car.crash.impact, CRASH_START_STRENGTH);
      this.debris.impact(car.crash, car.y, new Color(color), strength);
      if (id === this.focusId) this.chase.jolt(Math.min(0.5, strength * 0.025));
    }
    this.crashHits.set(id, hits);
  }

  private emitDamage(car: CarState, dt: number): void {
    if (car.health >= DAMAGE_STAGES.shed || Math.random() > dt * 18) return;
    const flame = car.health < DAMAGE_STAGES.burning && Math.random() < 0.5;
    const sin = Math.sin(car.yaw);
    const cos = Math.cos(car.yaw);
    this.particles.emit(
      car.x - sin * 1.3,
      car.y + liftOf(car) + 1.1,
      car.z - cos * 1.3,
      -sin * car.speed * 0.2 + (Math.random() - 0.5),
      1.5 + Math.random(),
      -cos * car.speed * 0.2 + (Math.random() - 0.5),
      flame ? FLAME : SOOT,
      flame ? 0.6 : 0.8,
      flame ? 0.9 : 0.5,
      flame ? 0.4 : 1.4,
    );
  }

  private emitTrail(car: CarState, dt: number): void {
    const speed = Math.abs(car.speed);
    const dusty = !car.onRoad && speed > 4;
    const smoky = car.onRoad && car.slip > 0.25 && speed > 12;
    if (car.crash || (!dusty && !smoky) || Math.random() > dt * (dusty ? 70 : 45)) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const sin = Math.sin(car.yaw);
    const cos = Math.cos(car.yaw);
    const carry = car.speed * 0.25;
    this.particles.emit(
      car.x - cos * side - sin * 1.2,
      car.y + 0.35,
      car.z + sin * side - cos * 1.2,
      sin * carry + (Math.random() - 0.5) * 2,
      0.8 + Math.random() * 1.2,
      cos * carry + (Math.random() - 0.5) * 2,
      dusty ? DUST : SMOKE,
      dusty ? 1.3 : 1,
      dusty ? 0.8 : 0.55,
      dusty ? 1 : 0.8,
    );
  }
}
