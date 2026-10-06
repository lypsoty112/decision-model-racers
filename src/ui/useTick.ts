/*
 * `useTick` re-renders the calling component every `intervalMs`, so HUD panels can read the
 * mutable race directly instead of pushing simulation state through React on every frame.
 */
import { useEffect, useState } from 'react';

export function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
