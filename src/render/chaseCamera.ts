/*
 * Mario Kart-style over-the-shoulder chase camera that sells speed.
 *
 * `ChaseCamera.follow` trails the focused car low and close: its yaw lags the car's yaw so
 * turns show the kart's flank, and its position eases towards a point behind and above the car.
 * As speed rises the field of view widens, the camera drops back and down, and a shake grows
 * with speed and grass. `snap` jumps straight to the target, used when the focus changes.
 * `resize` keeps the aspect ratio in sync with the viewport.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { CAR_SPEC, type CarState } from '../sim/car';
import { wrapAngle } from '../sim/track';

const BASE_FOV = 62;
const SPEED_FOV = 30;

export class ChaseCamera {
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 5000);
  readonly focus = new Vector3();
  private readonly position = new Vector3();
  private readonly desired = new Vector3();
  private yaw = 0;
  private fov = BASE_FOV;
  private time = 0;
  private snapNext = true;

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  snap(): void {
    this.snapNext = true;
  }

  follow(car: CarState, dt: number): void {
    this.time += dt;
    const speedRatio = Math.min(1.1, Math.abs(car.speed) / CAR_SPEC.maxSpeed);
    if (this.snapNext) this.yaw = car.yaw;
    this.yaw += wrapAngle(car.yaw - this.yaw) * (1 - Math.exp(-dt * 4.5));

    const distance = 6.2 + speedRatio * 1.6;
    const height = 2.5 - speedRatio * 0.35;
    this.desired.set(car.x - Math.sin(this.yaw) * distance, car.y + height, car.z - Math.cos(this.yaw) * distance);
    if (this.snapNext) this.position.copy(this.desired);
    this.position.lerp(this.desired, 1 - Math.exp(-dt * 12));
    this.snapNext = false;

    const shake = speedRatio ** 3 * 0.05 + (car.onRoad ? 0 : speedRatio * 0.14);
    this.camera.position.set(
      this.position.x + Math.sin(this.time * 41) * shake,
      this.position.y + Math.sin(this.time * 53 + 1.7) * shake,
      this.position.z + Math.cos(this.time * 37) * shake,
    );
    this.focus.set(car.x + Math.sin(car.yaw) * 5, car.y + 1.3, car.z + Math.cos(car.yaw) * 5);
    this.camera.lookAt(this.focus);

    const targetFov = BASE_FOV + SPEED_FOV * speedRatio ** 1.6 + car.draft * 4;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}
