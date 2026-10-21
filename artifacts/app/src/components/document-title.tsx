import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

import { documentTitleForPath } from "@/lib/document-title";

/** A aba acompanha a tela. O nome fixo do HTML é só o que aparece antes do app. */
export function DocumentTitle() {
  const [location] = useLocation();

  useLayoutEffect(() => {
    document.title = documentTitleForPath(location);
  }, [location]);

  return null;
}
