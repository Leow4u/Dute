import type { ReactNode } from "react";
import { CalendarCheck, Check, FilePlus, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROTULO_DA_ACAO, type AcaoDepoisDoEnvio, type AcoesDaEtapa } from "@/lib/comercial/depois-do-envio";

/**
 * Os botões das ações depois do envio (parte 12b de
 * docs/plataforma/fase-6-comercial.md), na ficha da fila e na montagem: a
 * principal da etapa primeiro e as outras ao lado. `destaque` pinta a
 * principal como a ação da tela (a montagem de uma RV enviada não tem outra);
 * na fila, a ação principal da tela é "Novo orçamento", então a da ficha fica
 * no mesmo estilo das demais. Quem decide o que oferecer é
 * acoesDepoisDoEnvio (lib/comercial/depois-do-envio.ts).
 */

const ICONE: Record<AcaoDepoisDoEnvio, ReactNode> = {
  fechar: <Check aria-hidden="true" />,
  perder: <X aria-hidden="true" />,
  revisar: <RotateCcw aria-hidden="true" />,
  validar: <Check aria-hidden="true" />,
  recusar_aditivo: <X aria-hidden="true" />,
  registrar_execucao: <CalendarCheck aria-hidden="true" />,
  aditivo: <Plus aria-hidden="true" />,
  orcar_execucao: <FilePlus aria-hidden="true" />,
  reabrir: <Undo2 aria-hidden="true" />,
  descartar_rv: <Trash2 aria-hidden="true" />,
};

export function AcoesDepoisDoEnvio({
  acoes,
  onAcao,
  ocupado,
  destaque = false,
  ignorar = [],
  tamanho = "default",
}: {
  acoes: AcoesDaEtapa;
  onAcao: (acao: AcaoDepoisDoEnvio) => void;
  ocupado: boolean;
  destaque?: boolean;
  /** Ações que a tela já mostra em outro lugar (a montagem mostra Descartar RV no cabeçalho). */
  ignorar?: readonly AcaoDepoisDoEnvio[];
  tamanho?: "default" | "sm";
}) {
  const principal = acoes.principal && !ignorar.includes(acoes.principal) ? acoes.principal : null;
  const outras = acoes.secundarias.filter((acao) => !ignorar.includes(acao));
  if (!principal && outras.length === 0) return null;
  return (
    <>
      {principal ? (
        <Button type="button" variant={destaque ? "default" : "outline"} size={tamanho} onClick={() => onAcao(principal)} disabled={ocupado}>
          {ICONE[principal]}
          {ROTULO_DA_ACAO[principal]}
        </Button>
      ) : null}
      {outras.map((acao) => (
        <Button key={acao} type="button" variant="outline" size={tamanho} onClick={() => onAcao(acao)} disabled={ocupado}>
          {ICONE[acao]}
          {ROTULO_DA_ACAO[acao]}
        </Button>
      ))}
    </>
  );
}
