import { useEffect, useMemo, useState } from "react";
import { collection } from "firebase/firestore";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import {
  cadastroDoDocumento,
  contatoDoDocumento,
  contratoDoDocumento,
  hojeLocal,
  localDoDocumento,
  payloadNovoProspect,
} from "@/lib/comercial/clientes";
import { useLeitura, useNomes } from "@/lib/comercial/leitura";
import { payloadCriar } from "@/lib/comercial/montar";
import {
  contarSegmentos,
  filtrarFila,
  hrefDoOrcamento,
  itemDaFila,
  segmentoInicial,
  type ItemDaFila,
  type SegmentoDaFila,
} from "@/lib/comercial/orcamentos";
import { useAppUser } from "@/lib/auth";

import { NovoOrcamentoDialog, type NovoOrcamento } from "./novo-orcamento-dialog";
import { FilaView, type ContextoDaFila } from "./orcamentos-view";

/**
 * Comercial › Orçamentos (docs/mockups/ComFila.dc.html; parte 11 de
 * docs/plataforma/fase-6-comercial.md). Lê pelo Firestore, como as regras
 * permitem a owner, admin e comercial (`demands`, `quotes`, `customers`,
 * `customer_contacts`, `customer_locations` e `contracts`), e cria o
 * orçamento só pela callable saveQuote (functions/comercial), com a chave de
 * idempotência em `request_id`.
 */

type Documento = { id: string; data: Record<string, unknown> };

const comoDocumento = (id: string, data: Record<string, unknown>): Documento => ({ id, data });

/** O relógio da fila: o tempo na etapa anda sem recarregar. */
function useAgora(intervaloMs = 60_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

type Dialogo = { chave: string; prospectChave: string };

/** Abaixo do lg a ficha toma o lugar da fila (FilaView). */
const TELA_ESTREITA = "(max-width: 1023px)";

export default function ComercialOrcamentosPage() {
  const { toast } = useToast();
  const { user } = useAppUser();
  const [, navegar] = useLocation();
  const role = user?.publicMetadata.role ?? null;
  const agora = useAgora();
  const [segmento, setSegmento] = useState<SegmentoDaFila | null>(null);
  const [busca, setBusca] = useState("");
  const [selecionadoNumero, setSelecionadoNumero] = useState<string | null>(null);
  const [fichaAberta, setFichaAberta] = useState(false);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const demandas = useLeitura("demands", (db) => collection(db, "demands"), comoDocumento);
  const orcamentos = useLeitura("quotes", (db) => collection(db, "quotes"), comoDocumento);
  const cadastros = useLeitura("customers", (db) => collection(db, "customers"), cadastroDoDocumento);
  const contatos = useLeitura("contatos:todos", (db) => collection(db, "customer_contacts"), contatoDoDocumento);
  const locais = useLeitura("locais:todos", (db) => collection(db, "customer_locations"), localDoDocumento);
  const contratos = useLeitura("contracts", (db) => collection(db, "contracts"), contratoDoDocumento);

  const estado = demandas.erro || orcamentos.erro ? "erro" : demandas.itens === null || orcamentos.itens === null ? "carregando" : "pronto";

  const itens = useMemo<ItemDaFila[]>(() => {
    if (!demandas.itens || !orcamentos.itens) return [];
    const porNumero = new Map(orcamentos.itens.map((quote) => [quote.id, quote.data]));
    return demandas.itens
      .map((demanda) => itemDaFila(demanda.id, demanda.data, porNumero.get(demanda.id) ?? null))
      .filter((item): item is ItemDaFila => item !== null);
  }, [demandas.itens, orcamentos.itens]);

  // A fila abre no segmento do papel, uma vez, quando os orçamentos chegam.
  useEffect(() => {
    if (segmento === null && estado === "pronto") setSegmento(segmentoInicial(role, contarSegmentos(itens)));
  }, [segmento, estado, role, itens]);
  const segmentoAtual: SegmentoDaFila = segmento ?? "todas";

  const visiveis = useMemo(
    () => filtrarFila(itens, segmentoAtual, busca).flatMap((grupo) => grupo.itens),
    [itens, segmentoAtual, busca],
  );
  const selecionado = visiveis.find((item) => item.numero === selecionadoNumero) ?? visiveis[0] ?? null;

  const nomeDe = useNomes(
    selecionado
      ? [selecionado.autorUid, selecionado.aprovacao?.porUid, selecionado.devolucao?.porUid, ...selecionado.marcos.map((marco) => marco.porUid)]
      : [],
  );

  const contexto = useMemo<ContextoDaFila>(
    () => ({
      prospects: new Set((cadastros.itens ?? []).filter((cadastro) => cadastro.estagio === "prospect").map((cadastro) => cadastro.code)),
      contatos: new Map((contatos.itens ?? []).map((contato) => [contato.id, { nome: contato.nome, empresa: contato.empresa }])),
      locais: new Map((locais.itens ?? []).map((local) => [local.id, local.nome])),
      contratos: new Map((contratos.itens ?? []).map((contrato) => [contrato.id, contrato])),
      nomeDe,
    }),
    [cadastros.itens, contatos.itens, locais.itens, contratos.itens, nomeDe],
  );

  const abrirNovo = () => {
    setErro(null);
    setDialogo({ chave: novaChave(), prospectChave: novaChave() });
  };

  async function criar(novo: NovoOrcamento) {
    if (!dialogo) return;
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await chamarComercial<{ numero: string; rotulo: string }>("saveQuote", payloadCriar(novo, dialogo.chave));
      setDialogo(null);
      toast({ title: `Orçamento ${resultado.rotulo ?? resultado.numero} criado` });
      navegar(hrefDoOrcamento(resultado.numero));
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível criar o orçamento.");
    } finally {
      setOcupado(false);
    }
  }

  async function criarProspect(prospect: { nome: string; cnpj: string }): Promise<string | null> {
    if (!dialogo) return null;
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await chamarComercial<{ customer_code: string }>(
        "saveCommercialCustomer",
        payloadNovoProspect({ nome: prospect.nome, codigo: "", cnpj: prospect.cnpj, cidade: "", uf: "" }, dialogo.prospectChave),
      );
      // Outro prospect no mesmo diálogo é outra intenção: chave nova.
      setDialogo((atual) => (atual ? { ...atual, prospectChave: novaChave() } : atual));
      toast({ title: "Prospect criado" });
      return resultado.customer_code;
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível criar o prospect.");
      return null;
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <FilaView
        estado={estado}
        itens={itens}
        agora={agora}
        segmento={segmentoAtual}
        onSegmento={(proximo) => {
          setSegmento(proximo);
          setFichaAberta(false);
        }}
        busca={busca}
        onBusca={setBusca}
        selecionado={selecionado}
        onSelecionar={(numero) => {
          setSelecionadoNumero(numero);
          // No celular, a fila abre a ficha (no computador, ela já está ao lado).
          setFichaAberta(true);
          if (typeof window !== "undefined" && window.matchMedia?.(TELA_ESTREITA).matches) {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
        fichaAberta={fichaAberta}
        onVoltar={() => setFichaAberta(false)}
        contexto={contexto}
        onNovo={abrirNovo}
      />
      <NovoOrcamentoDialog
        aberto={dialogo !== null}
        ocupado={ocupado}
        erro={erro}
        onCancelar={() => {
          if (!ocupado) setDialogo(null);
        }}
        cadastros={cadastros.itens ?? []}
        contratos={contratos.itens ?? []}
        hoje={hojeLocal()}
        onCriar={(novo) => void criar(novo)}
        onCriarProspect={criarProspect}
      />
    </>
  );
}
