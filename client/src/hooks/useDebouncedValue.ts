import { useEffect, useState } from "react";
/** Coalesce typing into one query after a short pause; URL and inputs stay immediate. */
export function useDebouncedValue<T>(value: T, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
