import { useMemo, useRef, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { formatarReais } from "@workspace/dominio";

import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import {
  confirmacaoDaAcao,
  filaDeAprovacao,
  linhasCompactas,
  numeroDaBusca,
  pontosDeConferir,
  posicaoNaFila,
  proximoDepois,
  quemOrcou,
  type AcaoDaAprovacao,
  type OrcamentoParaAprovar,
} from "@/lib/comercial/aprovar";
import { contatoDoDocumento, dataBr, localDoDocumento } from "@/lib/comercial/clientes";
import { hrefDoDocumento } from "@/lib/comercial/documento";
import { enviarEAbrirDocumento, type ResultadoDoEnvio } from "@/lib/comercial/envio";
import { useDocumento, useLeitura, useNomes } from "@/lib/comercial/leitura";
import { classificarErro, payloadAvancar } from "@/lib/comercial/montar";
import { TIPO_RV_ROTULO, hrefDoOrcamento, type EtapaDemanda } from "@/lib/comercial/orcamentos";

import { AprovarView, type CartaoDaAprovacao } from "./aprovar-view";
import { DevolverDialog } from "./devolver-dialog";

/**
 * Comercial › Aprovar (docs/mockups/ComAprovarCelular.dc.html; parte 12a de
 * docs/plataforma/fase-6-comercial.md). Só o owner chega aqui (a rota tem
 * papel próprio em lib/modules.ts). Lê pelo Firestore as demandas em "Para
 * aprovar" e os orçamentos "para aprovar", e grava só por advanceQuote
 * (approve, return com a nota, approve_and_send), com a chave de
 * idempotência, a situação e a edição que a tela mostrou. Recusa de
 * concorrência mostra a mensagem do servidor; a fila já está ao vivo.
 * "Aprovar e enviar" grava e só então abre o documento para o PDF.
 */

type Registro = Record<string, unknown>;
type Documento = { id: string; data: Registro };

const comoDocumento = (id: string, data: Registro): Documento => ({ id, data });

type Decidido = {
  orcamento: OrcamentoParaAprovar;
  acao: AcaoDaAprovacao;
  em: string;
  etapa: EtapaDemanda;
  /** A fila e a posição que a pessoa via na hora da ação. */
  naHora: string[];
  indice: number;
  total: number;
};

type ResultadoDoAvanco = { status: string; etapa: EtapaDemanda; edicao: number; rv: number };

export default function ComercialAprovarPage() {
  const { toast } = useToast();
  const { user } = useAppUser();
  const [, navegar] = useLocation();
  const inicial = numeroDaBusca(useSearch());

  const demandas = useLeitura(
    "aprovar:demands",
    (db) => query(collection(db, "demands"), where("etapa", "==", "para_aprovar")),
    comoDocumento,
  );
  const orcamentos = useLeitura(
    "aprovar:quotes",
    (db) => query(collection(db, "quotes"), where("status", "==", "para_aprovar")),
    comoDocumento,
  );
  const fila = useMemo(
    () => (demandas.itens && orcamentos.itens ? filaDeAprovacao(demandas.itens, orcamentos.itens) : []),
    [demandas.itens, orcamentos.itens],
  );
  const numeros = useMemo(() => fila.map((orcamento) => orcamento.item.numero), [fila]);

  const [escolhido, setEscolhido] = useState<string | null>(inicial);
  const [decidido, setDecidido] = useState<Decidido | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState(false);
  /** A chave da intenção: repetir a mesma chamada (rede caiu) reaproveita a chave; outra chamada, chave nova. */
  const tentativa = useRef<{ assinatura: string; chave: string } | null>(null);

  const posicao = posicaoNaFila(numeros, escolhido);
  const atual = decidido?.orcamento ?? fila.find((orcamento) => orcamento.item.numero === posicao.atual) ?? null;
  const item = atual?.item ?? null;

  const contato = useDocumento(item?.contatoId ? `customer_contacts/${item.contatoId}` : null);
  const origem = useDocumento(item?.origemLocalId ? `customer_locations/${item.origemLocalId}` : null);
  const destino = useDocumento(item?.destinoLocalId ? `customer_locations/${item.destinoLocalId}` : null);
  // O orçamento gravado antes de autor_nome: o nome pelo perfil (o owner lê `users`).
  const nomeDe = useNomes(item && !item.autorNome ? [item.autorUid] : []);
  const autor = item ? (item.autorNome ?? nomeDe(item.autorUid)) : null;

  function chave(assinatura: string): string {
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { assinatura, chave: novaChave() };
    return tentativa.current.chave;
  }

  function falhou(error: unknown) {
    setAviso(classificarErro(error).mensagem);
  }

  async function avancar(acao: "approve" | "return", nota?: string) {
    if (!atual || !item) return;
    const esperado = { numero: item.numero, status: item.status, edicao: item.edicao };
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await chamarComercial<ResultadoDoAvanco>(
        "advanceQuote",
        payloadAvancar(acao, esperado, chave(`${acao}:${item.numero}:${item.edicao}:${nota ?? ""}`), nota),
      );
      tentativa.current = null;
      setDevolvendo(false);
      setDecidido({
        orcamento: atual,
        acao,
        em: new Date().toISOString(),
        etapa: resultado.etapa,
        naHora: numeros,
        indice: posicao.indice,
        total: posicao.total,
      });
    } catch (error) {
      falhou(error);
    } finally {
      setOcupado(false);
    }
  }

  async function aprovarEEnviar() {
    if (!item) return;
    setOcupado(true);
    setAviso(null);
    try {
      await enviarEAbrirDocumento({
        acao: "approve_and_send",
        orcamento: { numero: item.numero, status: item.status, edicao: item.edicao },
        chave: chave(`approve_and_send:${item.numero}:${item.edicao}`),
        chamar: (payload) => chamarComercial<ResultadoDoEnvio>("advanceQuote", payload),
        abrir: navegar,
      });
      tentativa.current = null;
      toast({ title: "Aprovado e enviado" });
    } catch (error) {
      falhou(error);
    } finally {
      setOcupado(false);
    }
  }

  function irPara(numero: string | null) {
    setDecidido(null);
    setAviso(null);
    setEscolhido(numero);
  }

  const proximo = decidido ? proximoDepois(numeros, decidido.naHora, decidido.orcamento.item.numero) : posicao.proximo;

  let cartao: CartaoDaAprovacao | null = null;
  if (item) {
    const contatoLido = item.contatoId && contato.dados ? contatoDoDocumento(item.contatoId, contato.dados) : null;
    const origemNome = item.origemLocalId && origem.dados ? localDoDocumento(item.origemLocalId, origem.dados)?.nome ?? null : null;
    const destinoNome = item.destinoLocalId && destino.dados ? localDoDocumento(item.destinoLocalId, destino.dados)?.nome ?? null : null;
    cartao = {
      numero: item.numero,
      rotulo: item.rotulo,
      tipo: TIPO_RV_ROTULO[item.tipoRv],
      etapa: decidido?.etapa ?? item.etapa,
      titulo: item.titulo,
      cliente: item.cliente,
      para: contatoLido ? [contatoLido.nome, item.empresa ?? contatoLido.empresa].filter(Boolean).join(" · ") : item.empresa,
      refCliente: item.refCliente,
      local: origemNome && destinoNome && destinoNome !== origemNome ? `${origemNome} → ${destinoNome}` : (origemNome ?? destinoNome),
      orcou: quemOrcou(autor, item.passoEm),
      total: item.totalCents === null ? "—" : formatarReais(item.totalCents),
      tabela: item.tabelaNome ? [item.tabelaNome, item.variante].filter(Boolean).join(" · ") : null,
      dataBase: item.dataBase ? dataBr(item.dataBase) : null,
      quantidadeDeLinhas: atual?.linhas.length ?? 0,
      pdfHref: hrefDoDocumento(item.numero, item.rv),
      orcamentoHref: hrefDoOrcamento(item.numero),
    };
  }

  const estado =
    demandas.erro || orcamentos.erro
      ? "erro"
      : demandas.itens === null || orcamentos.itens === null
        ? "carregando"
        : cartao
          ? "pronto"
          : "vazio";

  return (
    <>
      <AprovarView
        estado={estado}
        posicao={decidido ? { indice: decidido.indice, total: decidido.total } : { indice: posicao.indice, total: posicao.total }}
        podeAnterior={!decidido && posicao.anterior !== null && !ocupado}
        podeProximo={proximo !== null && !ocupado}
        cartao={cartao}
        conferir={atual ? pontosDeConferir(atual.linhas, atual.item.marcas) : []}
        linhas={atual ? linhasCompactas(atual.linhas) : []}
        confirmacao={decidido ? confirmacaoDaAcao(decidido.acao, decidido.em, autor) : null}
        ocupado={ocupado}
        aviso={aviso}
        handlers={{
          anterior: () => irPara(posicao.anterior),
          proximo: () => irPara(proximo),
          aprovar: () => void avancar("approve"),
          devolver: () => setDevolvendo(true),
          aprovarEEnviar: () => void aprovarEEnviar(),
        }}
      />
      <DevolverDialog
        aberto={devolvendo}
        ocupado={ocupado}
        // Quem devolve o que ele mesmo montou não precisa de nota (o servidor confere igual).
        notaObrigatoria={user?.uid !== item?.autorUid}
        onCancelar={() => setDevolvendo(false)}
        onDevolver={(nota) => void avancar("return", nota)}
      />
    </>
  );
}
