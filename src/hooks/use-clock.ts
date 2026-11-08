import { useEffect, useState } from 'react';

/**
 * A clock that re-renders the caller on every interval tick.
 *
 * Used to advance uptimes and relative timestamps without asking the Rust core
 * for a new `ServerState` every second.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
