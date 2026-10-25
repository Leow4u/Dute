import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import {
  buscarNoCatalogo,
  formularioVazio,
  itemDoCatalogo,
  pedidoDaDemanda,
  problemasDoFormulario,
  type FormularioDaDemanda,
} from "@/lib/operacao/demanda-direta";
import { clienteDaLeitura } from "@/lib/operacao/fila";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { ROTA_HOJE, hrefDaDemanda } from "@/lib/operacao/navegacao";
import { formularioDaSolicitacao, problemaDoMotivo, solicitacaoDaBusca, solicitacaoDaOperacao, solicitacaoResolvida } from "@/lib/operacao/solicitacoes";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";

import { DemandaNovaView } from "./demanda-nova-view";

/**
 * Operação › Nova demanda direta (parte 3.5c): o formulário e openDirectDemand.
 * Com `?solicitacao=` (parte 4.4c), o formulário vem preenchido pela
 * solicitação do portal (uma vez, quando ela chega), a demanda sai com ela,
 * e a solicitação pode ser recusada com o motivo (declineServiceRequest).
 */

type Recusa = { aberta: boolean; motivo: string; tentou: boolean; ocupado: boolean; erro: string | null };
const RECUSA_FECHADA: Recusa = { aberta: false, motivo: "", tentou: false, ocupado: false, erro: null };

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export default function PaginaDemandaNova() {
  const [, navegar] = useLocation();
  const agora = new Date();
  const [form, setForm] = useState<FormularioDaDemanda>(() => formularioVazio(new Date()));
  const [busca, setBusca] = useState("");
  const [corrigindo, setCorrigindo] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef<string | null>(null);
  const contador = useRef(0);
  const [recusa, setRecusa] = useState<Recusa>(RECUSA_FECHADA);
  const chaveDaRecusa = useRef<string | null>(null);

  const pedidaId = solicitacaoDaBusca(useSearch());
  const leituraDaSolicitacao = useDocumento(
    pedidaId ? `service_requests/${pedidaId}` : null,
    (db) => doc(db, "service_requests", pedidaId ?? "-"),
    solicitacaoDaOperacao,
  );
  const solicitacao = leituraDaSolicitacao.item ?? null;
  const resolvida = solicitacao ? solicitacaoResolvida(solicitacao) : null;
  const ativa = solicitacao && !resolvida ? solicitacao : null;
  const urls = useUrlsDasFotos(solicitacao?.anexos.map((anexo) => anexo.caminho) ?? []);

  // Preenche o formulário uma vez por solicitação, quando ela chega ainda recebida.
  const preenchida = useRef<string | null>(null);
  useEffect(() => {
    if (!ativa || preenchida.current === ativa.id) return;
    preenchida.current = ativa.id;
    setForm(formularioDaSolicitacao(ativa, new Date()));
    chave.current = null;
  }, [ativa]);

  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const catalogo = useLeitura("lpu_items", (db) => collection(db, "lpu_items"), itemDoCatalogo);
  const locais = useLeitura(
    form.customerCode ? `customer_locations:${form.customerCode}` : null,
    (db) => query(collection(db, "customer_locations"), where("customer_code", "==", form.customerCode)),
    (id, data) => (data.ativo === false ? null : { valor: id, rotulo: texto(data.nome) || id }),
  );

  const opcoesDeClientes = useMemo(
    () =>
      (clientes.itens ?? [])
        .map((cliente) => ({ valor: cliente.code, rotulo: cliente.nome }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
    [clientes.itens],
  );
  const problemas = problemasDoFormulario(form, agora);

  function mudar(novo: FormularioDaDemanda) {
    setForm(novo);
    // Mudou o pedido: a próxima tentativa é outra chamada.
    chave.current = null;
  }

  async function abrir() {
    setTentou(true);
    setErro(null);
    if (problemas.length) return;
    setOcupado(true);
    chave.current ??= novaChave();
    // A solicitação de que o formulário saiu vai junto mesmo depois de
    // resolvida em outra tela: o servidor recusa ("já virou a demanda",
    // "recusada") em vez de abrir uma segunda demanda solta, e a nova
    // tentativa leva o mesmo pedido, que a chave repete.
    const solicitacaoDoFormulario = pedidaId && preenchida.current === pedidaId ? pedidaId : null;
    try {
      const resultado = await chamarOperacao<{ numero: string }>("openDirectDemand", pedidoDaDemanda(form, chave.current, solicitacaoDoFormulario));
      chave.current = null;
      navegar(hrefDaDemanda(resultado.numero));
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  async function recusar() {
    if (!ativa) return;
    setRecusa((atual) => ({ ...atual, tentou: true, erro: null }));
    if (problemaDoMotivo(recusa.motivo)) return;
    setRecusa((atual) => ({ ...atual, ocupado: true }));
    chaveDaRecusa.current ??= novaChave();
    try {
      await chamarOperacao("declineServiceRequest", { idempotency_key: chaveDaRecusa.current, solicitacao_id: ativa.id, motivo: recusa.motivo.trim() });
      chaveDaRecusa.current = null;
      navegar(ROTA_HOJE);
    } catch (error) {
      setRecusa((atual) => ({ ...atual, ocupado: false, erro: mensagemDoErro(error) }));
    }
  }

  return (
    <DemandaNovaView
      agora={agora}
      form={form}
      onForm={mudar}
      clientes={opcoesDeClientes}
      locais={(locais.itens ?? []).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"))}
      busca={busca}
      onBusca={setBusca}
      resultados={buscarNoCatalogo(catalogo.itens ?? [], busca).filter((item) => !form.linhas.some((linha) => linha.lpuItemId === item.id))}
      onAdicionar={(item) => {
        contador.current += 1;
        mudar({ ...form, linhas: [...form.linhas, { chave: `c${contador.current}`, lpuItemId: item.id, item: item.item, unidade: item.unidade ?? "", quantidade: "" }] });
        setBusca("");
      }}
      onAvulso={() => {
        contador.current += 1;
        mudar({ ...form, linhas: [...form.linhas, { chave: `c${contador.current}`, lpuItemId: null, item: "", unidade: "", quantidade: "" }] });
      }}
      corrigindo={corrigindo}
      onCorrigir={setCorrigindo}
      problemas={tentou ? problemas : []}
      ocupado={ocupado}
      erro={erro}
      onAbrir={() => void abrir()}
      solicitacao={
        solicitacao
          ? {
              solicitacao,
              urls,
              resolvida,
              recusa: { aberta: recusa.aberta, motivo: recusa.motivo, problema: recusa.tentou ? problemaDoMotivo(recusa.motivo) : null, ocupado: recusa.ocupado, erro: recusa.erro },
              onRecusar: () => setRecusa({ ...RECUSA_FECHADA, aberta: true }),
              onMotivo: (motivo) => {
                setRecusa((atual) => ({ ...atual, motivo, erro: null }));
                chaveDaRecusa.current = null;
              },
              onConfirmarRecusa: () => void recusar(),
              onVoltar: () => setRecusa(RECUSA_FECHADA),
            }
          : null
      }
    />
  );
}
