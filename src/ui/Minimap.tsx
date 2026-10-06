/*
 * Top-down minimap drawn on a canvas every animation frame.
 *
 * `Minimap` fits the track into the canvas, then each frame paints the circuit as a heatmap of
 * the focused racer's recorded speed per PROFILE_BIN segment (grey where they have not driven
 * yet), the start line, and a dot per racer, drawing the focused racer larger with a heading
 * arrow. `speedColor` maps speed to a red (slow) to cyan (fast) hue. The canvas follows the
 * device pixel ratio so lines stay crisp.
 */
import { useEffect, useRef } from 'react';
import { CAR_SPEC } from '../sim/car';
import { PROFILE_BIN, type Race } from '../sim/race';

type MinimapProps = { race: Race; focusId: string };

const SIZE = 230;
const PADDING = 16;

function speedColor(speed: number): string {
  const t = Math.max(0, Math.min(1, (speed - 15) / (CAR_SPEC.maxSpeed - 20)));
  return `hsl(${Math.round(t * 185)}, 85%, ${58 + t * 6}%)`;
}

export function Minimap({ race, focusId }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = SIZE * ratio;
    canvas.height = SIZE * ratio;
    const { track } = race;
    const xs = track.samples.map((sample) => sample.x);
    const zs = track.samples.map((sample) => sample.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const scale = (SIZE - PADDING * 2) / Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
    const offsetX = (SIZE - (Math.max(...xs) - minX) * scale) / 2;
    const offsetY = (SIZE - (Math.max(...zs) - minZ) * scale) / 2;
    const toMap = (x: number, z: number): [number, number] => [offsetX + (x - minX) * scale, offsetY + (z - minZ) * scale];
    const bins = Math.ceil(track.length / PROFILE_BIN);
    const binPaths = Array.from({ length: bins }, (_, bin) =>
      [0, 0.5, 1].map((t) => {
        const sample = track.sampleAt(Math.min(track.length, (bin + t) * PROFILE_BIN));
        return toMap(sample.x, sample.z);
      }),
    );
    const start = track.sampleAt(0);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, SIZE, SIZE);
      context.lineCap = 'round';
      context.lineJoin = 'round';

      context.beginPath();
      binPaths.forEach((points) => points.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y))));
      context.strokeStyle = 'rgba(12, 18, 38, 0.75)';
      context.lineWidth = 11;
      context.stroke();

      const focused = race.racers.find((racer) => racer.id === focusId) ?? race.standings()[0];
      context.lineWidth = 5;
      binPaths.forEach((points, bin) => {
        const speed = focused?.speedProfile[bin] ?? 0;
        context.beginPath();
        points.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
        context.strokeStyle = speed > 0 ? speedColor(speed) : 'rgba(220, 228, 240, 0.55)';
        context.stroke();
      });

      const [startX, startY] = toMap(start.x, start.z);
      context.save();
      context.translate(startX, startY);
      context.rotate(Math.atan2(start.tz, start.tx) + Math.PI / 2);
      context.fillStyle = '#ffffff';
      context.fillRect(-8, -1.5, 16, 3);
      context.restore();

      for (const racer of [...race.racers.filter((racer) => racer !== focused), focused]) {
        const [x, y] = toMap(racer.car.x, racer.car.z);
        const isFocused = racer === focused;
        context.beginPath();
        context.arc(x, y, isFocused ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = racer.color;
        context.fill();
        context.lineWidth = isFocused ? 2.5 : 1.5;
        context.strokeStyle = '#ffffff';
        context.stroke();
        if (!isFocused) continue;
        const headingX = Math.sin(racer.car.yaw);
        const headingY = Math.cos(racer.car.yaw);
        context.beginPath();
        context.moveTo(x + headingX * 13, y + headingY * 13);
        context.lineTo(x + headingX * 7 - headingY * 4, y + headingY * 7 + headingX * 4);
        context.lineTo(x + headingX * 7 + headingY * 4, y + headingY * 7 - headingX * 4);
        context.closePath();
        context.fillStyle = '#ffffff';
        context.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [race, focusId]);

  return (
    <div className="panel minimap">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} aria-label="Track map with racer positions and speed heatmap" />
      <div className="minimap-legend">
        <span>slow</span>
        <span className="minimap-scale" />
        <span>fast</span>
      </div>
    </div>
  );
}
