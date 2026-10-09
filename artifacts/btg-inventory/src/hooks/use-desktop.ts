import { useEffect, useState } from "react";

/** Largura de desktop (lg, 1024px): ficha ao lado da lista em vez de sheet. */
export function useIsDesktop() {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return desktop;
}
