/*
 * Keyboard input for the human racer.
 *
 * `Keyboard` tracks held key codes through window listeners that `attach` installs and the
 * returned function removes; it stops arrow keys and Space from scrolling unless the event
 * comes from a form field. `KeyboardDriver` maps WASD or the arrow keys (Space also brakes) to
 * raw -1/0/1 `Controls`; the car model smooths steering itself.
 */
import type { Controls, Driver } from '../sim/types';

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

  isHeld(...codes: string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }
}

export class KeyboardDriver implements Driver {
  readonly kind = 'human';
  private readonly keyboard: Keyboard;

  constructor(keyboard: Keyboard) {
    this.keyboard = keyboard;
  }

  decide(): Controls {
    const keys = this.keyboard;
    return {
      throttle: keys.isHeld('KeyW', 'ArrowUp') ? 1 : 0,
      brake: keys.isHeld('KeyS', 'ArrowDown', 'Space') ? 1 : 0,
      steer: (keys.isHeld('KeyD', 'ArrowRight') ? 1 : 0) - (keys.isHeld('KeyA', 'ArrowLeft') ? 1 : 0),
    };
  }
}
