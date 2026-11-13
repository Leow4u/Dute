import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * A confirmação que espera a resposta (docs/plataforma/diagnostico-carregamento.md,
 * decisão 6 de 06/11/2026 e parte 13a do carregamento v2; mockup
 * docs/mockups/WmsCarregandoEmitir.dc.html).
 *
 * O clique em confirmar não fecha o diálogo: quem chama fecha no sucesso da
 * ação, e no erro ele fica aberto, com o aviso da tela. Enquanto a ação roda,
 * o confirmar é o `BotaoDeAcao` no gerúndio, o Cancelar fica `aria-disabled`
 * e o Esc não fecha; o foco fica onde estava, nunca no `body`.
 */
export function Confirmacao({
  aberta,
  ocupada,
  titulo,
  descricao,
  confirmar,
  confirmando,
  classeDoConfirmar,
  onConfirmar,
  onFechar,
  focoAoFechar,
}: {
  aberta: boolean;
  ocupada: boolean;
  titulo: ReactNode;
  descricao?: ReactNode;
  confirmar: string;
  confirmando: string;
  classeDoConfirmar?: string;
  onConfirmar: () => void;
  onFechar: () => void;
  /** O lugar do foco quando o controle que abriu a confirmação saiu da tela (a linha removida). */
  focoAoFechar?: () => HTMLElement | null | undefined;
}) {
  return (
    <AlertDialog
      open={aberta}
      ocupado={ocupada}
      onOpenChange={(open) => {
        if (!open) onFechar();
      }}
    >
      <AlertDialogContent focoAoFechar={focoAoFechar} {...(descricao ? {} : { "aria-describedby": undefined })}>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descricao ? <AlertDialogDescription>{descricao}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={classeDoConfirmar}
            estado={ocupada ? "andamento" : "repouso"}
            rotulo={confirmar}
            andamento={confirmando}
            onClick={() => {
              if (!ocupada) onConfirmar();
            }}
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
