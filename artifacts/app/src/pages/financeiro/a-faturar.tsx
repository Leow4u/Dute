import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";

import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import {
  formComVencimento,
  formInicial,
  pagamentoDoContrato,
  pedidoDaEmissao,
  pedidoDaNf,
  podeMarcarNaNf,
  problemasDaNf,
  textoDaEmissao,
  textoDoRegistro,
  type FormDaNf,
} from "@/lib/financeiro/a-faturar";
import { chamarFinanceiro, novaChave } from "@/lib/financeiro/api";
import { useFilaDoFinanceiro } from "@/lib/financeiro/use-a-faturar";
import { firestore } from "@/lib/firebase";
import { OMIE_LIBERADA } from "@/lib/liberacao";
import { hojeIso } from "@/lib/operacao/fila";

import { AFaturarView } from "./a-faturar-view";

/**
 * Financeiro › A faturar (parte 4.1b de docs/plataforma/fase-4-financeiro.md).
 * Lê pelo Firestore, como as regras permitem a owner, admin e financeiro: as
 * demandas A faturar e as que esperam, as autorizações citadas e o valor de
 * cada uma (lib/financeiro/use-a-faturar.ts), e o contrato do cliente marcado
 * para sugerir o vencimento. Grava só pela callable registerNf, com chave de
 * idempotência; o servidor confere de novo cada demanda e calcula o valor.
 * A armazenagem emitida no WMS entra na mesma NF (parte 7.2b). Onde a
 * NFS-e sai pela Omie (OMIE_LIBERADA, parte 7.4e), o painel pede a emissão
 * pela callable emitNfOmie, e a NF emitida fora segue pelo registerNf.
 */

type ResultadoDoRegistro = { valor_cents?: unknown; demandas?: unknown; armazenagem?: unknown };

export default function FinanceiroAFaturarPage() {
  const { toast } = useToast();
  const { user } = useAppUser();
  const agora = new Date();
  const hoje = hojeIso(agora);
  const fila = useFilaDoFinanceiro(user?.publicMetadata.role);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [form, setForm] = useState<FormDaNf>(() => formInicial(hoje, null, OMIE_LIBERADA));
  // O vencimento segue o contrato até a pessoa mexer nele.
  const [vencimentoEditado, setVencimentoEditado] = useState(false);
  // Uma chave por intenção de registrar: a mesma no clique repetido, nova depois do registro.
  const [chave, setChave] = useState(novaChave);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const linhas = fila.linhas ?? [];
  const linhasMarcadas = linhas.filter((linha) => linha.situacao === "pronta" && marcadas.includes(linha.demanda.numero));
  // A armazenagem não tem contrato: o vencimento sai da primeira demanda que tem.
  const contratoId = linhasMarcadas.find((linha) => linha.demanda.contratoId)?.demanda.contratoId ?? null;
  const contrato = useQuery({
    queryKey: ["financeiro", "contrato", contratoId],
    queryFn: async () => {
      if (!firestore || !contratoId) return null;
      const snapshot = await getDoc(doc(firestore, "contracts", contratoId));
      return snapshot.exists() ? snapshot.data() : null;
    },
    enabled: aberto && Boolean(contratoId),
    staleTime: 60_000,
    retry: 1,
  });
  const formDoPainel = formComVencimento(form, vencimentoEditado, pagamentoDoContrato(contrato.data));

  const estado = fila.falhas.length ? "erro" : fila.linhas ? "pronto" : "carregando";

  function fecharPainel() {
    setAberto(false);
    setMarcadas([]);
    setErro(null);
  }

  async function registrar() {
    const problemas = problemasDaNf(formDoPainel, linhasMarcadas, hoje);
    if (problemas.length) {
      setErro(problemas.join(" "));
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      let texto: string;
      if (OMIE_LIBERADA && formDoPainel.via === "omie") {
        await chamarFinanceiro("emitNfOmie", pedidoDaEmissao(formDoPainel, linhasMarcadas, chave));
        texto = textoDaEmissao(linhasMarcadas);
      } else {
        const retorno = await chamarFinanceiro<ResultadoDoRegistro>("registerNf", pedidoDaNf(formDoPainel, linhasMarcadas, chave));
        texto = textoDoRegistro(formDoPainel, retorno);
      }
      setResultado(texto);
      toast({ title: texto });
      setMarcadas([]);
      setForm(formInicial(hoje, null, OMIE_LIBERADA));
      setVencimentoEditado(false);
      setChave(novaChave());
      setAberto(false);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível faturar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <AFaturarView
      estado={estado}
      linhas={linhas}
      busca={busca}
      painel={{ aberto, marcadas, form: formDoPainel, resultado, erro }}
      hoje={hoje}
      agora={agora}
      ocupado={ocupado}
      omie={OMIE_LIBERADA}
      acoes={{
        buscar: setBusca,
        abrirPainel: () => {
          setAberto(true);
          setResultado(null);
        },
        fecharPainel,
        marcar: (numero) => {
          setErro(null);
          setMarcadas((atuais) => {
            if (atuais.includes(numero)) return atuais.filter((item) => item !== numero);
            const linha = linhas.find((item) => item.demanda.numero === numero);
            const jaMarcadas = linhas.filter((item) => atuais.includes(item.demanda.numero));
            return linha && podeMarcarNaNf(linha, jaMarcadas) ? [...atuais, numero] : atuais;
          });
        },
        editar: (campo, valor) => {
          setErro(null);
          if (campo === "vencimento") setVencimentoEditado(true);
          // A chave é da intenção: trocar a via troca o pedido.
          if (campo === "via") setChave(novaChave());
          setForm((atual) => ({ ...formComVencimento(atual, vencimentoEditado, pagamentoDoContrato(contrato.data)), [campo]: valor }));
        },
        registrar: () => void registrar(),
      }}
    />
  );
}
