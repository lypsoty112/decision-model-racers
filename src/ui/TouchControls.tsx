/*
 * On-screen controls for touch screens; CSS shows them only where the main pointer is coarse.
 *
 * `TouchControls` shows steer left and right under the left thumb and brake and gas under the
 * right while the player races, plus a row of race buttons: Menu always, Reset while racing, and
 * Camera and Next racer while spectating (Next racer is hidden while the TV director picks the
 * racer). `HoldButton` holds its key code on the shared `Keyboard` while a finger rests on it, so
 * `KeyboardDriver` drives the kart unchanged. It releases pointer capture so a thumb can slide
 * from one button to the next, and every drive key is released when the controls unmount.
 */
import { type ReactNode, useEffect } from 'react';
import type { Keyboard } from '../input/keyboard';
import type { CameraMode } from '../render/engine';

type TouchControlsProps = {
  keyboard: Keyboard;
  spectating: boolean;
  cameraMode: CameraMode;
  onMenu: () => void;
  onCamera: () => void;
  onNextRacer: () => void;
  onReset: () => void;
};

type HoldButtonProps = { keyboard: Keyboard; code: string; label: string; children: ReactNode };

const DRIVE_CODES = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'];

function HoldButton({ keyboard, code, label, children }: HoldButtonProps) {
  const release = () => keyboard.hold(code, false);
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        keyboard.hold(code, true);
      }}
      onPointerEnter={(event) => {
        if (event.buttons > 0) keyboard.hold(code, true);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  );
}

export function TouchControls({ keyboard, spectating, cameraMode, onMenu, onCamera, onNextRacer, onReset }: TouchControlsProps) {
  useEffect(() => () => DRIVE_CODES.forEach((code) => keyboard.hold(code, false)), [keyboard]);

  return (
    <div className="touch-controls">
      <div className="touch-actions">
        <button type="button" onClick={onMenu}>
          Menu
        </button>
        {spectating ? (
          <>
            <button type="button" onClick={onCamera}>
              Camera
            </button>
            {cameraMode !== 'tv' && (
              <button type="button" onClick={onNextRacer}>
                Next
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
      {!spectating && (
        <>
          <div className="touch-pad steer">
            <HoldButton keyboard={keyboard} code="ArrowLeft" label="Steer left">
              ◀
            </HoldButton>
            <HoldButton keyboard={keyboard} code="ArrowRight" label="Steer right">
              ▶
            </HoldButton>
          </div>
          <div className="touch-pad pedals">
            <HoldButton keyboard={keyboard} code="ArrowDown" label="Brake">
              Brake
            </HoldButton>
            <HoldButton keyboard={keyboard} code="ArrowUp" label="Accelerate">
              Gas
            </HoldButton>
          </div>
        </>
      )}
    </div>
  );
}
