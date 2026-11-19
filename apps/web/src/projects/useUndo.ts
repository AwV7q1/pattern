import { useCallback, useEffect, useRef, useState } from 'react';

const LIMIT = 100;
/** A drag fires many changes; one quiet period = one undo step. */
const SETTLE_MS = 400;

/**
 * Undo/redo over serialized designs. `json` is the current canvas; every
 * settled change becomes a step. `apply` puts an older design back on the
 * canvas. History resets when `key` (the open project) changes.
 */
export function useUndo(key: string | null, json: string | null, apply: (json: string) => void) {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const stable = useRef<string | null>(null);
  /** Set while the canvas re-renders a design we applied: that change is not a new step. */
  const applying = useRef(false);
  const [, rerender] = useState(0);
  const bump = () => rerender((x) => x + 1);
  const [epoch, setEpoch] = useState(0);

  /** Forget everything: the canvas after the next render is the new starting point. */
  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    stable.current = null;
    applying.current = false;
    setEpoch((e) => e + 1);
  }, []);
  useEffect(reset, [key, reset]);

  const latest = useRef(json);
  latest.current = json;

  // a reload with an identical design does not change `json`, so the effect
  // below would not run and the first edit would become the starting point
  useEffect(() => {
    if (stable.current === null && latest.current !== null) stable.current = latest.current;
  }, [epoch]);

  const record = useCallback((next: string) => {
    if (stable.current !== null && next !== stable.current) {
      past.current.push(stable.current);
      if (past.current.length > LIMIT) past.current.shift();
      future.current = [];
      bump();
    }
    stable.current = next;
  }, []);

  useEffect(() => {
    if (json === null) return;
    if (stable.current === null || applying.current) {
      applying.current = false;
      stable.current = json;
      return;
    }
    const t = setTimeout(() => record(json), SETTLE_MS);
    return () => clearTimeout(t);
  }, [json, record]);

  const go = useCallback(
    (from: React.MutableRefObject<string[]>, to: React.MutableRefObject<string[]>) => {
      // an edit still settling counts as a step of its own
      if (latest.current !== null) record(latest.current);
      const target = from.current.pop();
      if (target === undefined || stable.current === null) return;
      to.current.push(stable.current);
      stable.current = target;
      applying.current = true;
      apply(target);
      bump();
    },
    [apply, record],
  );

  return {
    undo: useCallback(() => go(past, future), [go]),
    redo: useCallback(() => go(future, past), [go]),
    canUndo: past.current.length > 0 || (latest.current !== null && stable.current !== null && latest.current !== stable.current),
    canRedo: future.current.length > 0,
    reset,
  };
}
