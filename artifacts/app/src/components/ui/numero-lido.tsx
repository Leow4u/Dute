import type { ReactNode } from "react";

import { Esqueleto } from "@/components/ui/esqueleto";

/** A leitura de onde vem o número: lendo, com a falha, ou lida. */
export type EstadoDoNumero = "carregando" | "erro" | "pronto";

/**
 * O número de uma contagem (o "Em aberto · 6" do segmentado, o contador da
 * aba) antes de a leitura chegar (carregamento v2, momento 2; parte 13g):
 * lendo, o bloco de 16 × 12 px no lugar do número; com a falha, "—"; nunca o
 * zero antes de ler. O bloco e o "—" ficam fora da árvore: o leitor de tela
 * ouve só o rótulo, e quem diz que lê ou que falhou é a tela.
 */
export function NumeroLido({ estado, children }: { estado: EstadoDoNumero; children: ReactNode }) {
  if (estado === "carregando") return <Esqueleto forma="contagem" />;
  if (estado === "erro") return <span aria-hidden="true">—</span>;
  return <>{children}</>;
}
