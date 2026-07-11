import { type RefObject, useLayoutEffect, useRef, useState } from "react";

export function useCommittedRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useCommittedValue<T>(value: T): () => T {
  const ref = useCommittedRef(value);
  const [read] = useState<() => T>(() => () => ref.current);
  return read;
}
