import { useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { doc, type DocumentData } from "firebase/firestore";
import { useSearch } from "wouter";

import { faturaDoFinanceiro, type FaturaDoFinanceiro } from "@/lib/financeiro/faturas";
import { lerDocumento } from "@/lib/financeiro/ler-documento";
import { ROTA_FATURAS, hrefDaNf, nfDaBusca } from "@/lib/financeiro/navegacao";
import { chaveDaRevisao, demonstrativoDaNf, type FontesDoDemonstrativo } from "@/lib/financeiro/nf-documento";
import { useDocumento } from "@/lib/operacao/leitura";

import { NfView, type EstadoDaVia } from "./nf-view";

/**
 * Financeiro › via comercial da NF (parte 4.2d): a NF da URL (?nf=), ao vivo,
 * e o que ela cita, lido uma vez: as demandas, as RVs congeladas, as medições
 * e as autorizações. As regras abrem tudo isso a quem lê preço. Imprimir é o
 * do navegador (Imprimir → Salvar como PDF), como a OS e o orçamento.
 */

type Fonte = { chave: string; caminho: string; tipo: keyof FontesDoDemonstrativo };

function fontesDaNf(fatura: FaturaDoFinanceiro): Fonte[] {
  const fontes: Fonte[] = [];
  for (const demanda of fatura.demandas) {
    fontes.push({ chave: demanda.numero, caminho: `demands/${demanda.numero}`, tipo: "demandas" });
    if (demanda.medicaoId) fontes.push({ chave: demanda.medicaoId, caminho: `medicoes/${demanda.medicaoId}`, tipo: "medicoes" });
    else if (demanda.rv !== null) fontes.push({ chave: chaveDaRevisao(demanda.numero, demanda.rv), caminho: `quotes/${demanda.numero}/revisoes/${demanda.rv}`, tipo: "revisoes" });
    for (const id of demanda.autorizacaoIds) fontes.push({ chave: id, caminho: `client_authorizations/${id}`, tipo: "autorizacoes" });
  }
  // A medição sem demanda também tem linhas a mostrar (pergunta 64).
  for (const medicao of fatura.medicoes) {
    if (medicao.medicaoId) fontes.push({ chave: medicao.medicaoId, caminho: `medicoes/${medicao.medicaoId}`, tipo: "medicoes" });
  }
  return [...new Map(fontes.map((fonte) => [fonte.caminho, fonte])).values()];
}

export default function FinanceiroNfPage() {
  const id = nfDaBusca(useSearch());
  const leitura = useDocumento(id ? `faturas/${id}` : null, (db) => doc(db, "faturas", id ?? "-"), faturaDoFinanceiro);
  const fatura = leitura.item ?? null;
  const fontes = fatura ? fontesDaNf(fatura) : [];
  const lidas = useQueries({
    queries: fontes.map((fonte) => ({ queryKey: ["financeiro", "via-comercial", fonte.caminho], queryFn: () => lerDocumento(fonte.caminho), staleTime: 60_000, retry: 1 })),
  });

  const carregandoFontes = lidas.some((consulta) => consulta.isPending);
  const erroNasFontes = lidas.some((consulta) => consulta.isError);
  const estado: EstadoDaVia = !id || leitura.item === null ? "nao_encontrada" : leitura.erro || erroNasFontes ? "erro" : leitura.item === undefined || carregandoFontes ? "carregando" : "pronto";

  const mapas: FontesDoDemonstrativo = { demandas: new Map(), revisoes: new Map(), medicoes: new Map(), autorizacoes: new Map() };
  fontes.forEach((fonte, indice) => (mapas[fonte.tipo] as Map<string, DocumentData | null>).set(fonte.chave, lidas[indice]?.data ?? null));
  const documento = estado === "pronto" && fatura ? demonstrativoDaNf(fatura, mapas) : null;

  // O nome que o navegador sugere para o PDF; o título da aba volta ao sair.
  useEffect(() => {
    if (!documento) return undefined;
    const anterior = document.title;
    document.title = documento.nomeDoArquivo;
    return () => {
      document.title = anterior;
    };
  }, [documento?.nomeDoArquivo]);

  return <NfView estado={estado} documento={documento} voltar={id ? hrefDaNf(ROTA_FATURAS, id) : ROTA_FATURAS} onImprimir={() => window.print()} />;
}
