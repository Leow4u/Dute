import { cn } from "@/lib/utils";

/**
 * Os arcos do Wi-Fi de "Reconectando…" (carregamento v2, momento 8): acendem
 * um a um, 300 ms cada, em ciclo de 1,2 s, e param acesos aos 5 s; no
 * movimento reduzido ficam acesos e parados (index.css, `.carregando-arcos`).
 * Em tinta, nunca no âmbar, que é do "Sem conexão". Decorativo: quem informa é
 * o texto ao lado.
 */
export function ArcosDoWifi({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-arcos=""
      className={cn("carregando-arcos size-4 shrink-0", className)}
    >
      <path d="M12 20h.01" strokeWidth="3" />
      <path className="arco-1" d="M8.5 16.429a5 5 0 0 1 7 0" />
      <path className="arco-2" d="M5 12.859a10 10 0 0 1 14 0" />
      <path className="arco-3" d="M2 8.82a15 15 0 0 1 20 0" />
    </svg>
  );
}
