import { useId, useLayoutEffect, useRef } from "react";

import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { DialogCancelar } from "@/components/ui/dialog";
import { vigiarFocoDeVolta } from "@/lib/foco-de-volta";
import { cn } from "@/lib/utils";

/**
 * O toque do gatilho de texto ("Cancelar pedido") no celular: a área de 48 px
 * das ações de linha (seção 7), estendida pelo `::before`, sem mudar a linha.
 */
const ALVO_DO_GATILHO =
  "relative max-md:before:absolute max-md:before:-inset-x-2 max-md:before:-inset-y-4 max-md:before:content-['']";

/**
 * A confirmação na linha do portal ("Cancelar PED-0001?", com o confirmar e o
 * "Manter"; carregamento v2, parte 13f). O confirmar é o `BotaoDeAcao`, com o
 * gerúndio aos 300 ms, e o "Manter" fica travado no código enquanto ele grava,
 * esmaecido junto com o gerúndio. No celular, os dois têm 48 px.
 *
 * O foco nunca cai no `body` (WCAG 2.4.3): ao abrir, vai ao "Manter" (a
 * escolha que não muda nada), dentro do grupo que tem a pergunta como nome;
 * ao manter, volta ao gatilho; no sucesso, ao gatilho que volta à tela e, se
 * ele sair depois (a releitura tirou a ação da linha), ao `lugarDepois`, ao
 * vizinho dele ou ao título da página.
 */
export function ConfirmacaoNaLinha({
  aberta,
  ocupada,
  gatilho,
  pergunta,
  confirmar,
  andamento,
  onAbrir,
  onManter,
  onConfirmar,
  classeDoGatilho,
  className,
  lugarDepois,
}: {
  aberta: boolean;
  ocupada: boolean;
  /** O texto do gatilho: "Cancelar pedido". */
  gatilho: string;
  /** "Cancelar PED-0001?" */
  pergunta: string;
  confirmar: string;
  /** O gerúndio do confirmar: "Cancelando…". */
  andamento: string;
  onAbrir: () => void;
  onManter: () => void;
  onConfirmar: () => void;
  classeDoGatilho?: string;
  className?: string;
  /** Onde o foco fica se o gatilho sair da tela depois do sucesso (a linha que mudou de lugar). */
  lugarDepois?: () => HTMLElement | null | undefined;
}) {
  const nome = useId();
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const manterRef = useRef<HTMLButtonElement>(null);
  const abertaAntes = useRef(aberta);
  useLayoutEffect(() => {
    if (abertaAntes.current === aberta) return;
    abertaAntes.current = aberta;
    if (aberta) {
      manterRef.current?.focus();
      return;
    }
    // A confirmação saiu: o foco que estava nela caiu no body. O que a pessoa levou a outro lugar fica lá.
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && ativo.isConnected) return;
    const alvo = gatilhoRef.current;
    if (!alvo) return;
    alvo.focus();
    vigiarFocoDeVolta(alvo, lugarDepois);
  }, [aberta, lugarDepois]);

  if (!aberta) {
    return (
      <button ref={gatilhoRef} type="button" className={cn(ALVO_DO_GATILHO, classeDoGatilho)} onClick={onAbrir}>
        {gatilho}
      </button>
    );
  }
  return (
    <span role="group" aria-labelledby={nome} className={cn("inline-flex items-center gap-2", className)}>
      <span id={nome}>{pergunta}</span>
      <BotaoDeAcao
        size="sm"
        variant="destructive"
        className="max-md:min-h-12"
        estado={ocupada ? "andamento" : "repouso"}
        rotulo={confirmar}
        andamento={andamento}
        onClick={onConfirmar}
      />
      <DialogCancelar ref={manterRef} size="sm" variant="ghost" className="max-md:min-h-12" ocupado={ocupada} onClick={onManter}>
        Manter
      </DialogCancelar>
    </span>
  );
}
