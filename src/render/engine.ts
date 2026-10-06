/*
 * The three.js side of the game: renderer, scene, and the per-frame loop.
 *
 * `GameEngine` builds the static world once (environment, landscape, track) and swaps the karts
 * whenever `setRace` receives a new race. Each animation frame advances the race unless
 * `paused`, poses every `CarModel`, kicks up dust and tyre smoke in `emitTrail`, and films the
 * race with the camera chosen by `setCameraMode`: the chase camera behind the focused racer
 * (`setFocus`; the leader when the id is unknown), the whole-track overhead view (karts and
 * name tags enlarged by `applyDisplayScale`), or the TV director, whose choice of racer is
 * reported through `onFocusChange`. It renders through three's OutlineEffect for ink lines and,
 * in chase view only, draws the speed-line overlay on top. `setTimeOfDay` re-lights the scene;
 * `dispose` stops the loop and frees the WebGL context.
 */
import { Color, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { CAR_SPEC, type CarState } from '../sim/car';
import type { Race } from '../sim/race';
import { CarModel } from './carModel';
import { ChaseCamera } from './chaseCamera';
import { Environment, type TimeOfDay } from './environment';
import { buildLandscape } from './landscape';
import { OverheadCamera, TvCamera } from './spectatorCameras';
import { Particles, SpeedLines } from './speedEffects';
import { buildTrackMesh } from './trackMesh';

const DUST = new Color('#cdb98c');
const SMOKE = new Color('#eef1f6');
const OVERHEAD_KART_SCALE = 4;
const OVERHEAD_LABEL_SCALE = 14;

export type CameraMode = 'chase' | 'overhead' | 'tv';

export class GameEngine {
  paused = false;
  onFocusChange: ((id: string) => void) | null = null;
  private cameraMode: CameraMode = 'chase';
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly scene = new Scene();
  private readonly outline: OutlineEffect;
  private readonly chase = new ChaseCamera();
  private readonly overhead: OverheadCamera;
  private readonly tv: TvCamera;
  private readonly focusPoint = new Vector3();
  private readonly environment: Environment;
  private readonly speedLines = new SpeedLines();
  private readonly particles = new Particles(1500);
  private readonly models = new Map<string, CarModel>();
  private readonly resizeObserver: ResizeObserver;
  private race: Race;
  private focusId = '';
  private frameHandle = 0;
  private lastTime = performance.now();

  constructor(container: HTMLElement, race: Race) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.outline = new OutlineEffect(this.renderer, { defaultThickness: 0.003, defaultColor: [0.09, 0.1, 0.16] });
    this.outline.autoClear = true;
    this.environment = new Environment(this.scene);
    this.overhead = new OverheadCamera(race.track);
    this.tv = new TvCamera(race.track);
    this.scene.add(buildLandscape(race.track), buildTrackMesh(race.track), this.particles.points);
    this.race = race;
    this.setRace(race);
    this.resizeObserver = new ResizeObserver(() => this.resize(container));
    this.resizeObserver.observe(container);
    this.resize(container);
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  setRace(race: Race): void {
    for (const model of this.models.values()) {
      this.scene.remove(model.root);
      model.dispose();
    }
    this.models.clear();
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

  private resize(container: HTMLElement): void {
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    for (const view of [this.chase, this.overhead, this.tv]) view.resize(container.clientWidth, container.clientHeight);
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
      if (!this.paused) this.emitTrail(racer.car, dt);
    }
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
    this.particles.update(this.paused ? 0 : dt, camera, this.renderer.domElement.height);
    this.outline.render(this.scene, camera);
    const speedRatio = Math.abs(focused.car.speed) / CAR_SPEC.maxSpeed;
    const intensity = Math.max(0, Math.min(1, (speedRatio - 0.4) / 0.45)) + focused.car.draft * 0.3;
    this.speedLines.render(this.renderer, this.paused || this.cameraMode !== 'chase' ? 0 : intensity, dt, camera.aspect);
  };

  private emitTrail(car: CarState, dt: number): void {
    const speed = Math.abs(car.speed);
    const dusty = !car.onRoad && speed > 4;
    const smoky = car.onRoad && car.slip > 0.25 && speed > 12;
    if ((!dusty && !smoky) || Math.random() > dt * (dusty ? 70 : 45)) return;
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
