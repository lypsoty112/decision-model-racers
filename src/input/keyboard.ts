/*
 * Keyboard input for the human racer.
 *
 * `Keyboard` tracks held key codes through window listeners that `attach` installs and the
 * returned function removes; it stops arrow keys and Space from scrolling unless the event
 * comes from a form field. `hold` presses or releases a code directly, which is how the
 * on-screen touch buttons drive the same keys. `KeyboardDriver` maps WASD or the arrow keys
 * (Space also brakes) to raw -1/0/1 `Controls`; the car model smooths steering itself. Once the
 * racer has finished, it hands the car to its `autopilot` for the cool-down.
 */
import type { Controls, Driver, RacerObservation } from '../sim/types';

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Keyboard {
  private readonly held = new Set<string>();

  attach(target: Window): () => void {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (SCROLL_KEYS.has(event.code)) event.preventDefault();
      this.held.add(event.code);
    };
    const up = (event: KeyboardEvent) => this.held.delete(event.code);
    const clear = () => this.held.clear();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', clear);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', clear);
    };
  }

  hold(code: string, held: boolean): void {
    if (held) this.held.add(code);
    else this.held.delete(code);
  }

  isHeld(...codes: string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }
}

export class KeyboardDriver implements Driver {
  readonly kind = 'human';
  private readonly keyboard: Keyboard;
  private readonly autopilot: Driver;

  constructor(keyboard: Keyboard, autopilot: Driver) {
    this.keyboard = keyboard;
    this.autopilot = autopilot;
  }

  decide(observation: RacerObservation, dt: number): Controls {
    if (observation.finished) return this.autopilot.decide(observation, dt);
    const keys = this.keyboard;
    return {
      throttle: keys.isHeld('KeyW', 'ArrowUp') ? 1 : 0,
      brake: keys.isHeld('KeyS', 'ArrowDown', 'Space') ? 1 : 0,
      steer: (keys.isHeld('KeyD', 'ArrowRight') ? 1 : 0) - (keys.isHeld('KeyA', 'ArrowLeft') ? 1 : 0),
    };
  }
}
