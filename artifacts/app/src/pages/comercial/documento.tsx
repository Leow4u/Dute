import { useEffect, useMemo, useRef } from "react";
import { useSearch } from "wouter";

import { contatoDoDocumento, contratoDoDocumento, localDoDocumento } from "@/lib/comercial/clientes";
import {
  deveImprimir,
  documentoDoOrcamento,
  fonteDoDocumento,
  parametrosDoDocumento,
  referenciasDoDocumento,
  type DocumentoDoOrcamento,
} from "@/lib/comercial/documento";
import { useDocumento, useNomes } from "@/lib/comercial/leitura";
import { hrefDoOrcamento } from "@/lib/comercial/orcamentos";

import { DocumentoView } from "./documento-view";

/**
 * Comercial › Orçamento › documento A4 (docs/mockups/ComDocumento.dc.html;
 * parte 12a de docs/plataforma/fase-6-comercial.md), com
 * ?numero=10045&rv=1. Até o envio, a prévia do orçamento ao vivo, com a
 * marca; depois, a cópia congelada em `quotes/{numero}/revisoes/{rv}`. O
 * document.title é o nome do PDF. Com &imprimir=1 (o "Enviar" da fila, da
 * montagem e da aprovação, depois de gravar), a impressão abre sozinha quando
 * a cópia congelada chega. Só lê: nada se grava aqui.
 */

type Registro = Record<string, unknown>;

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function Documento({ numero, rv: rvPedida, imprimir }: { numero: string; rv: number | null; imprimir: boolean }) {
  const quote = useDocumento(`quotes/${numero}`);
  const quoteDoc = quote.dados as Registro | null | undefined;
  const rvAtual = quoteDoc && typeof quoteDoc.rv === "number" ? quoteDoc.rv : null;
  const rv = rvPedida ?? rvAtual;
  const revisao = useDocumento(rv !== null ? `quotes/${numero}/revisoes/${rv}` : null);
  const demanda = useDocumento(`demands/${numero}`);

  const fonte = fonteDoDocumento({
    rv: rvPedida,
    quote: quoteDoc,
    demanda: demanda.dados as Registro | null | undefined,
    revisao: revisao.dados as Registro | null | undefined,
  });
  const referencias = referenciasDoDocumento(fonte);
  const contato = useDocumento(referencias.contatoId ? `customer_contacts/${referencias.contatoId}` : null);
  const origem = useDocumento(referencias.origemLocalId ? `customer_locations/${referencias.origemLocalId}` : null);
  const destino = useDocumento(referencias.destinoLocalId ? `customer_locations/${referencias.destinoLocalId}` : null);
  const contrato = useDocumento(referencias.contratoId ? `contracts/${referencias.contratoId}` : null);
  // O orçamento gravado antes de autor_nome: o nome pelo perfil, quando quem lê pode (owner, admin ou o próprio).
  const autorUid =
    fonte.estado === "pronto" && !texto(fonte.orcamento.autor_nome) ? texto(fonte.orcamento.autor_uid) || null : null;
  const nomeDe = useNomes([autorUid]);

  const documento = useMemo<DocumentoDoOrcamento | null>(() => {
    if (fonte.estado !== "pronto") return null;
    const contatoLido = referencias.contatoId && contato.dados ? contatoDoDocumento(referencias.contatoId, contato.dados) : null;
    const origemLida = referencias.origemLocalId && origem.dados ? localDoDocumento(referencias.origemLocalId, origem.dados) : null;
    const destinoLido = referencias.destinoLocalId && destino.dados ? localDoDocumento(referencias.destinoLocalId, destino.dados) : null;
    const contratoLido = referencias.contratoId && contrato.dados ? contratoDoDocumento(referencias.contratoId, contrato.dados) : null;
    return documentoDoOrcamento(fonte, {
      numero,
      agora: new Date(),
      contato: contatoLido ? { nome: contatoLido.nome, empresa: contatoLido.empresa } : null,
      origem: origemLida?.nome ?? null,
      destino: destinoLido?.nome ?? null,
      contrato: contratoLido ? { nome: contratoLido.nome, numeros: contratoLido.numeros } : null,
      autorNome: nomeDe(autorUid),
    });
    // A fonte muda com os documentos lidos; o resto, com as leituras de apoio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.dados, demanda.dados, revisao.dados, contato.dados, origem.dados, destino.dados, contrato.dados, nomeDe, autorUid, numero]);

  // O nome do arquivo que o navegador sugere ao salvar o PDF; ao sair, o título do app volta.
  useEffect(() => {
    if (!documento) return undefined;
    const anterior = document.title;
    document.title = documento.nomeDoArquivo;
    return () => {
      document.title = anterior;
    };
  }, [documento?.nomeDoArquivo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Depois do envio, a impressão abre uma vez, quando a cópia congelada chega (com os nomes lidos).
  const jaAbriu = useRef(false);
  const apoioPronto =
    (!referencias.contatoId || contato.dados !== undefined) &&
    (!referencias.origemLocalId || origem.dados !== undefined) &&
    (!referencias.destinoLocalId || destino.dados !== undefined) &&
    (!referencias.contratoId || contrato.dados !== undefined);
  const congelada = fonte.estado === "pronto" && fonte.congelada;
  useEffect(() => {
    if (!documento || !apoioPronto) return;
    if (!deveImprimir({ pedido: imprimir, congelada, jaAbriu: jaAbriu.current })) return;
    jaAbriu.current = true;
    // Um quadro depois do render, para o título e o papel já estarem na página.
    window.setTimeout(() => window.print(), 300);
  }, [documento, apoioPronto, imprimir, congelada]);

  const estado = quote.erro || demanda.erro || revisao.erro ? "erro" : fonte.estado;
  return (
    <DocumentoView
      estado={estado}
      documento={documento}
      voltarHref={hrefDoOrcamento(numero)}
      onImprimir={() => window.print()}
    />
  );
}

export default function ComercialDocumentoPage() {
  const parametros = parametrosDoDocumento(useSearch());
  if (!parametros) return <DocumentoView estado="nao_encontrado" documento={null} voltarHref={null} onImprimir={() => undefined} />;
  return (
    <Documento
      key={`${parametros.numero}-${parametros.rv ?? "atual"}`}
      numero={parametros.numero}
      rv={parametros.rv}
      imprimir={parametros.imprimir}
    />
  );
}
