import { useEffect, useState } from 'react';
export const parseIsoToMs = (value: string | null | undefined): number | null => {
  const result = value ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : null;
};
export const formatInstantShort = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export function useMutationNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
