import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppUser } from "@/lib/auth";
import { baixarCsv } from "@/lib/comercial/diario";
import { chamarRh, novaChave } from "@/lib/rh/api";
import { arquivoLido, competenciaPadrao, diaEmSaoPaulo, resultadoLido, textoDoResultado, type ArquivoDaExportacao } from "@/lib/rh/exportacao";
import { gravaNoRh } from "@/lib/rh/navegacao";
import { CHAVE_DAS_EXPORTACOES, useExportacoesDoRh } from "@/lib/rh/use-rh";

import { ExportacaoView, type AcoesDaExportacao, type EstadoDaLista } from "./exportacao-view";

/**
 * /rh/exportacao: a exportação da competência para a contabilidade, pelas
 * callables exportRhMonth (gera; sem mudança, devolve a versão de antes),
 * listRhExports e downloadRhExport (a planilha da versão guardada, com o
 * download registrado). A chave de idempotência é uma por intenção: troca
 * com a competência e depois de cada geração; a falha mantém a chave, e a
 * nova tentativa repete o resultado se a primeira chegou a gravar.
 */
export default function RhExportacao() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const leitura = useExportacoesDoRh(role);
  const queryClient = useQueryClient();
  const [hoje] = useState(() => diaEmSaoPaulo());
  const [competencia, setCompetencia] = useState(() => competenciaPadrao(hoje));
  const [chave, setChave] = useState(novaChave);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    setAviso(null);
    setFalha(null);
    try {
      await acao();
    } catch (error) {
      setFalha(error instanceof Error ? error.message : "Falha na exportação.");
    } finally {
      setOcupado(false);
    }
  }

  const acoes: AcoesDaExportacao = {
    mudarCompetencia: (valor) => {
      setCompetencia(valor);
      setChave(novaChave());
      setAviso(null);
      setFalha(null);
    },
    gerar: () =>
      void executar(async () => {
        try {
          const resultado = resultadoLido(await chamarRh("exportRhMonth", { idempotency_key: chave, competencia }));
          if (!resultado) throw new Error("Resposta da exportação ilegível.");
          setChave(novaChave());
          setAviso(textoDoResultado(resultado, competencia));
        } finally {
          await queryClient.invalidateQueries({ queryKey: CHAVE_DAS_EXPORTACOES });
        }
      }),
    baixar: (id: string, arquivo: ArquivoDaExportacao) =>
      void executar(async () => {
        const baixado = arquivoLido(await chamarRh("downloadRhExport", { id, arquivo }));
        if (!baixado) throw new Error("Planilha ilegível.");
        baixarCsv(baixado.nome, baixado.conteudo);
      }),
  };

  const estado: EstadoDaLista = leitura.erro ? "erro" : leitura.exportacoes ? "pronto" : "carregando";
  return (
    <ExportacaoView
      estado={estado}
      exportacoes={leitura.exportacoes ?? []}
      grava={gravaNoRh(role)}
      hoje={hoje}
      competencia={competencia}
      ocupado={ocupado}
      aviso={aviso}
      falha={falha}
      acoes={acoes}
    />
  );
}
