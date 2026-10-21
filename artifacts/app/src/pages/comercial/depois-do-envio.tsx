import { useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import { hojeLocal, type ContatoResumo } from "@/lib/comercial/clientes";
import {
  chaveDoPedido,
  classificarErroDepoisDoEnvio,
  pedidoDaAcao,
  type AcaoDepoisDoEnvio,
  type PedidoDaAcao,
  type ValoresDaAcao,
} from "@/lib/comercial/depois-do-envio";
import type { TentativaDeChamada } from "@/lib/comercial/envio";
import { hrefDoOrcamento, type ItemDaFila } from "@/lib/comercial/orcamentos";

import { DialogoDepoisDoEnvio } from "./depois-do-envio-dialogos";

/**
 * As ações depois do envio na fila e na montagem (parte 12b): abre o diálogo
 * da ação, grava pela callable certa (advanceDemand ou advanceQuote) com a
 * etapa e a RV, ou a situação e a edição, que a tela viu quando a pessoa abriu
 * o diálogo, e a chave de idempotência da intenção (a mesma se a pessoa clica
 * de novo no mesmo pedido). A recusa de concorrência fecha o diálogo e mostra
 * a mensagem do servidor: as telas são ao vivo e já mostram o orçamento como
 * está. O valor que vale é o do servidor.
 */

type Aberta = { acao: AcaoDepoisDoEnvio; item: ItemDaFila };

export type ResultadoDaGravacao = { edicao?: number; status?: string };

export function useDepoisDoEnvio(entrada: {
  /** Os contatos do cliente (de qualquer cliente: o hook filtra pelo do orçamento aberto). */
  contatos: readonly ContatoResumo[];
  /** Depois de gravar uma ação do orçamento (advanceQuote): a montagem espera a gravação chegar. */
  aoGravar?: (pedido: PedidoDaAcao, resultado: ResultadoDaGravacao) => void;
}): {
  abrir: (acao: AcaoDepoisDoEnvio, item: ItemDaFila) => void;
  ocupado: boolean;
  /** A recusa que fechou o diálogo (etapa que mudou...), para a tela mostrar. */
  aviso: { numero: string; mensagem: string } | null;
  limparAviso: () => void;
  dialogo: ReactNode;
} {
  const { toast } = useToast();
  const [, navegar] = useLocation();
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ numero: string; mensagem: string } | null>(null);
  const tentativa = useRef<TentativaDeChamada | null>(null);

  const contatosDoCliente = useMemo(
    () => (aberta ? entrada.contatos.filter((contato) => contato.customerCode === aberta.item.customerCode && contato.ativo) : []),
    [entrada.contatos, aberta],
  );

  async function confirmar(acao: AcaoDepoisDoEnvio, valores: ValoresDaAcao) {
    if (!aberta) return;
    const { item } = aberta;
    const sem = pedidoDaAcao(acao, item, valores, "");
    tentativa.current = chaveDoPedido(tentativa.current, sem, novaChave);
    const pedido = pedidoDaAcao(acao, item, valores, tentativa.current.chave);
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await chamarComercial<ResultadoDaGravacao>(pedido.callable, pedido.payload);
      tentativa.current = null;
      setAberta(null);
      setAviso(null);
      toast({ title: pedido.sucesso });
      entrada.aoGravar?.(pedido, resultado);
      if (pedido.abreMontagem) navegar(hrefDoOrcamento(item.numero));
    } catch (error) {
      const { mensagem, recarregar } = classificarErroDepoisDoEnvio(error);
      if (recarregar) {
        tentativa.current = null;
        setAberta(null);
        setAviso({ numero: item.numero, mensagem: `${mensagem} O orçamento foi recarregado.` });
      } else {
        setErro(mensagem);
      }
    } finally {
      setOcupado(false);
    }
  }

  const dialogo = (
    <DialogoDepoisDoEnvio
      acao={aberta?.acao ?? null}
      rotulo={aberta?.item.rotulo ?? ""}
      etapa={aberta?.item.etapa ?? "em_montagem"}
      contatoId={aberta?.item.contatoId ?? null}
      contatos={contatosDoCliente}
      envioEm={aberta?.item.envio?.em ?? null}
      agora={new Date()}
      hoje={hojeLocal()}
      ocupado={ocupado}
      erro={erro}
      onCancelar={() => {
        if (!ocupado) setAberta(null);
      }}
      onConfirmar={(acao, valores) => void confirmar(acao, valores)}
    />
  );

  return {
    abrir: (acao, item) => {
      setErro(null);
      setAviso(null);
      setAberta({ acao, item });
    },
    ocupado,
    aviso,
    limparAviso: () => setAviso(null),
    dialogo,
  };
}
