import { useEffect, useState } from "react";

const getMatches = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

// Mesmos breakpoints do Tailwind (sm = 640px, lg = 1024px)
export const useIsMobile = () => useMediaQuery("(max-width: 639px)");
export const useIsBelowLg = () => useMediaQuery("(max-width: 1023px)");
