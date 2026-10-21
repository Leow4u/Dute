import { useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { formatarReais } from "@workspace/dominio";

import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import {
  acompanharAprovacao,
  avisoDoCartaoParado,
  confirmacaoDaAcao,
  filaDeAprovacao,
  hrefDaAprovacao,
  hrefParaGuardarPosicao,
  linhasCompactas,
  numeroDaBusca,
  pontosDeConferir,
  proximoDepois,
  quemOrcou,
  type AcaoDaAprovacao,
  type OrcamentoParaAprovar,
  type VistoNaAprovacao,
} from "@/lib/comercial/aprovar";
import { contatoDoDocumento, dataBr, localDoDocumento } from "@/lib/comercial/clientes";
import { hrefDoDocumento } from "@/lib/comercial/documento";
import { chaveDaIntencao, enviarEAbrirDocumento, type ResultadoDoEnvio, type TentativaDeChamada } from "@/lib/comercial/envio";
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
 *
 * O orçamento da tela fica na URL (?numero=), para que voltar do PDF ou do
 * orçamento caia nele, e não troca sozinho: se ele sai da fila ou volta com
 * outra edição, o cartão para no que a pessoa viu e nada se grava sobre ele
 * (lib/comercial/aprovar.ts, acompanharAprovacao).
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
  const busca = useSearch();
  const escolhido = numeroDaBusca(busca);

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
  const carregado = demandas.itens !== null && orcamentos.itens !== null;

  const [visto, setVisto] = useState<VistoNaAprovacao | null>(null);
  const [decidido, setDecidido] = useState<Decidido | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState(false);
  /** A chave da intenção: repetir a mesma chamada (rede caiu) reaproveita a chave; outra chamada, chave nova. */
  const tentativa = useRef<TentativaDeChamada | null>(null);

  const acompanhado = acompanharAprovacao(fila, escolhido, visto);
  // A tela lembra o orçamento como a pessoa o viu: se ele sair da fila, o cartão para nele.
  useEffect(() => {
    if (carregado && acompanhado.visto !== visto) setVisto(acompanhado.visto);
  }, [carregado, acompanhado.visto, visto]);
  const parado = decidido ? null : avisoDoCartaoParado(acompanhado);
  const naFila = !decidido && acompanhado.situacao === "na_fila";
  const posicao = acompanhado.posicao;
  const atual = decidido?.orcamento ?? acompanhado.orcamento;
  const item = atual?.item ?? null;

  // A URL guarda o orçamento da tela (inclusive o primeiro, mostrado sem escolha).
  const numeroNaTela = decidido?.orcamento.item.numero ?? acompanhado.numero;
  useEffect(() => {
    if (!carregado) return;
    const href = hrefParaGuardarPosicao(busca, numeroNaTela);
    if (href) navegar(href, { replace: true });
  }, [carregado, busca, numeroNaTela, navegar]);

  const contato = useDocumento(item?.contatoId ? `customer_contacts/${item.contatoId}` : null);
  const origem = useDocumento(item?.origemLocalId ? `customer_locations/${item.origemLocalId}` : null);
  const destino = useDocumento(item?.destinoLocalId ? `customer_locations/${item.destinoLocalId}` : null);
  // O orçamento gravado antes de autor_nome: o nome pelo perfil (o owner lê `users`).
  const nomeDe = useNomes(item && !item.autorNome ? [item.autorUid] : []);
  const autor = item ? (item.autorNome ?? nomeDe(item.autorUid)) : null;

  function chave(assinatura: string): string {
    tentativa.current = chaveDaIntencao(tentativa.current, assinatura, novaChave);
    return tentativa.current.chave;
  }

  function falhou(error: unknown) {
    setAviso(classificarErro(error).mensagem);
  }

  async function avancar(acao: "approve" | "return", nota?: string) {
    // Só sobre o orçamento que está na fila e na tela, como a pessoa o viu.
    if (!naFila || !atual || !item) return;
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
    if (!naFila || !item) return;
    setOcupado(true);
    setAviso(null);
    try {
      await enviarEAbrirDocumento({
        acao: "approve_and_send",
        orcamento: { numero: item.numero, status: item.status, edicao: item.edicao },
        chave: chave(`approve_and_send:${item.numero}:${item.edicao}`),
        chamar: (payload) => chamarComercial<ResultadoDoEnvio>("advanceQuote", payload),
        abrir: navegar,
        // O documento volta à fila de aprovação, não à montagem.
        de: "aprovar",
      });
      tentativa.current = null;
      toast({ title: "Aprovado e enviado" });
    } catch (error) {
      falhou(error);
    } finally {
      setOcupado(false);
    }
  }

  /** Outro orçamento (ou o mesmo, recarregado): a URL guarda a escolha, e a tela esquece o que tinha visto. */
  function irPara(numero: string | null) {
    if (!numero) return;
    setDecidido(null);
    setAviso(null);
    setDevolvendo(false);
    setVisto(null);
    tentativa.current = null;
    navegar(hrefDaAprovacao(numero), { replace: true });
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
      pdfHref: hrefDoDocumento(item.numero, item.rv, { de: "aprovar" }),
      orcamentoHref: hrefDoOrcamento(item.numero),
    };
  }

  const estado = demandas.erro || orcamentos.erro ? "erro" : !carregado ? "carregando" : cartao ? "pronto" : "vazio";

  return (
    <>
      <AprovarView
        estado={estado}
        posicao={decidido ? { indice: decidido.indice, total: decidido.total } : { indice: posicao.indice, total: posicao.total }}
        podeAnterior={naFila && posicao.anterior !== null && !ocupado}
        podeProximo={proximo !== null && !ocupado}
        cartao={cartao}
        conferir={atual ? pontosDeConferir(atual.linhas, atual.item.marcas) : []}
        linhas={atual ? linhasCompactas(atual.linhas) : []}
        confirmacao={decidido ? confirmacaoDaAcao(decidido.acao, decidido.em, autor) : null}
        parado={parado}
        ocupado={ocupado}
        aviso={aviso}
        handlers={{
          anterior: () => irPara(posicao.anterior),
          proximo: () => irPara(proximo),
          recarregar: () => irPara(acompanhado.numero),
          aprovar: () => void avancar("approve"),
          devolver: () => setDevolvendo(true),
          aprovarEEnviar: () => void aprovarEEnviar(),
        }}
      />
      <DevolverDialog
        aberto={devolvendo && naFila}
        ocupado={ocupado}
        // Quem devolve o que ele mesmo montou não precisa de nota (o servidor confere igual).
        notaObrigatoria={user?.uid !== item?.autorUid}
        onCancelar={() => setDevolvendo(false)}
        onDevolver={(nota) => void avancar("return", nota)}
      />
    </>
  );
}
