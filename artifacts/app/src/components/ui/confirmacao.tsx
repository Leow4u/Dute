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
import { Spinner } from "@/components/ui/spinner";

/**
 * A confirmação que espera a resposta (docs/plataforma/diagnostico-carregamento.md,
 * decisão 6 de 06/11/2026; mockup docs/mockups/WmsCarregandoEmitir.dc.html).
 *
 * O clique em confirmar não fecha o diálogo: quem chama fecha no sucesso da
 * ação, e no erro ele fica aberto, com o aviso da tela. Enquanto a ação roda,
 * o botão gira e diz o gerúndio, o Cancelar fica desligado e o Esc não fecha.
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
}) {
  return (
    <AlertDialog open={aberta} onOpenChange={(open) => { if (!open && !ocupada) onFechar(); }}>
      <AlertDialogContent aria-busy={ocupada || undefined} {...(descricao ? {} : { "aria-describedby": undefined })}>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descricao ? <AlertDialogDescription>{descricao}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ocupada}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={classeDoConfirmar}
            disabled={ocupada}
            aria-busy={ocupada || undefined}
            onClick={(event) => {
              // O Radix fecha no clique; aqui quem fecha é o sucesso da ação.
              event.preventDefault();
              if (!ocupada) onConfirmar();
            }}
          >
            {ocupada ? <Spinner /> : null}
            {ocupada ? confirmando : confirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
