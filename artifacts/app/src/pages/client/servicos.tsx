import { useState } from "react";
import { useLocation, useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { OPERACAO_LIBERADO } from "@/lib/liberacao";
import { novaChave } from "@/lib/operacao/api";
import { osDaBusca } from "@/lib/operacao/navegacao";
import { hojeIso } from "@/lib/operacao/fila";
import { useOperationProfile } from "@/lib/operation-profile";
import { leiturasDoPortal } from "@/lib/operations";
import { enviarSolicitacao } from "@/lib/portal/enviar-solicitacao";
import { aPagar, cobrancaPorDemanda, numerosDasOs, ordenarOs, osDoPortal } from "@/lib/portal/servicos";
import { escolherAnexos, formularioInicial, pedidoDaSolicitacao, problemasDaSolicitacao, solicitacoesEmAberto, type FormularioDaSolicitacao } from "@/lib/portal/solicitacao";
import { useNfsDoCliente, useOsDoCliente, useSolicitacoesDoCliente } from "@/lib/portal/use-servicos";

import { ServicosView } from "./servicos-view";

type EstadoDoPedido = {
  aberto: boolean;
  form: FormularioDaSolicitacao;
  /**
   * A chave de cada pedido já tentado, até a solicitação sair: repetir o
   * mesmo pedido não cria outro, e o pedido editado é outro envio.
   */
  chaves: Record<string, string>;
  tentou: boolean;
  enviando: boolean;
  erro: string | null;
  problemaDoAnexo: string | null;
  enviada: boolean;
};

function pedidoNovo(hoje: string): EstadoDoPedido {
  return { aberto: false, form: formularioInicial(hoje), chaves: {}, tentou: false, enviando: false, erro: null, problemaDoAnexo: null, enviada: false };
}

/**
 * Portal › Minhas OS (parte 4.3b): as OS do cliente da conta, com a NF da
 * demanda de cada uma quando o contrato tem as faturas. Só lê o que o
 * contrato deixa (leiturasDoPortal, a mesma régua das regras); a OS aberta
 * fica na URL (`?os=`). Com a Operação liberada no ambiente, o cliente pede
 * a OS por aqui (parte 4.4b): os anexos sobem ao Storage e `requestService`
 * grava a solicitação, que aparece em Solicitações até virar OS.
 */
export function ClienteServicos() {
  const { user } = useAppUser();
  const { profile } = useOperationProfile();
  const [, navegar] = useLocation();
  const [busca, setBusca] = useState("");
  const hoje = hojeIso(new Date());
  const leituras = profile ? leiturasDoPortal(profile.modules) : null;
  const codigo = user?.publicMetadata.customer_code;
  const leituraDasOs = useOsDoCliente(codigo, Boolean(leituras?.servicos));
  const leituraDasNfs = useNfsDoCliente(codigo, Boolean(leituras?.faturas));
  const leituraDasSolicitacoes = useSolicitacoesDoCliente(codigo, Boolean(leituras?.servicos));
  const pedida = osDaBusca(useSearch());
  const podeSolicitar = OPERACAO_LIBERADO && Boolean(leituras?.servicos) && Boolean(codigo);
  const [pedido, setPedido] = useState<EstadoDoPedido>(() => pedidoNovo(hoje));
  const mudar = (mudanca: Partial<EstadoDoPedido>) => setPedido((atual) => ({ ...atual, ...mudanca }));

  async function enviar() {
    if (!codigo || pedido.enviando) return;
    const problemas = problemasDaSolicitacao(pedido.form, new Date());
    if (Object.keys(problemas).length) {
      mudar({ tentou: true });
      return;
    }
    const conteudo = JSON.stringify(pedidoDaSolicitacao(pedido.form, ""));
    const chave = pedido.chaves[conteudo] ?? novaChave();
    mudar({ tentou: true, enviando: true, erro: null, chaves: { ...pedido.chaves, [conteudo]: chave } });
    try {
      await enviarSolicitacao(codigo, pedido.form, chave);
      setPedido({ ...pedidoNovo(hoje), enviada: true });
    } catch (error) {
      mudar({ enviando: false, erro: error instanceof Error ? error.message : "Não foi possível enviar a solicitação." });
    }
  }

  const os = ordenarOs((leituraDasOs.os ?? []).map((ficha) => osDoPortal(ficha, hoje)));
  const demandasComOs = new Set((leituraDasOs.os ?? []).map((ficha) => ficha.demanda));
  const nfs = leituraDasNfs.nfs ?? [];
  const estado = leituraDasOs.erro ? "erro" : leituras && leituraDasOs.os ? "pronto" : "carregando";
  // A rolagem é da tela, como nas outras do portal.
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto">
      <ServicosView
        estado={estado}
        os={os}
        numeros={numerosDasOs(os)}
        aPagarCents={leituras?.faturas && leituraDasNfs.nfs ? aPagar(nfs, hoje) : null}
        cobrancas={cobrancaPorDemanda(nfs, hoje)}
        busca={busca}
        aberta={(pedida && os.find((item) => item.numero === pedida)) || null}
        solicitacoes={solicitacoesEmAberto(leituraDasSolicitacoes.solicitacoes ?? [], demandasComOs, hoje)}
        pedido={
          podeSolicitar
            ? {
                aberto: pedido.aberto,
                form: pedido.form,
                problemas: pedido.tentou ? problemasDaSolicitacao(pedido.form, new Date()) : {},
                enviando: pedido.enviando,
                erro: pedido.erro,
                problemaDoAnexo: pedido.problemaDoAnexo,
                enviada: pedido.enviada,
                hoje,
              }
            : null
        }
        acoes={{
          buscar: setBusca,
          abrir: (numero) => {
            mudar({ aberto: false, enviada: false });
            navegar(`/portal/servicos?os=${encodeURIComponent(numero)}`);
          },
          fechar: () => navegar("/portal/servicos"),
          solicitar: () => {
            mudar({ aberto: true, enviada: false });
            navegar("/portal/servicos");
          },
          mudar: (form) => mudar({ form, erro: null }),
          anexar: (arquivos) => {
            const escolha = escolherAnexos(arquivos, pedido.form.anexos);
            mudar({ form: { ...pedido.form, anexos: escolha.anexos }, problemaDoAnexo: escolha.problema });
          },
          removerAnexo: (indice) => mudar({ form: { ...pedido.form, anexos: pedido.form.anexos.filter((_, posicao) => posicao !== indice) }, problemaDoAnexo: null }),
          enviar: () => void enviar(),
          cancelar: () => mudar({ aberto: false }),
        }}
      />
    </main>
  );
}
