import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { chamarRh, novaChave } from "@/lib/rh/api";
import type { RegistroDoRh } from "@/lib/rh/ficha";
import {
  formularioDoRegistro,
  formularioDoVinculo,
  formularioNovo,
  pedidoDoFormulario,
  pedidoDoVinculo,
  problemaDoArquivo,
  type FormularioDoRegistro,
  type FormularioDoVinculo,
} from "@/lib/rh/formulario";
import { colaboradorDaBusca, gravaNoRh } from "@/lib/rh/navegacao";
import { CHAVE_DO_PAINEL, chaveDaFicha, useFichaDoRh } from "@/lib/rh/use-rh";

import { FichaView, type AcoesDaFicha, type EstadoDaFicha } from "./ficha-view";

type Envio = { arquivo_id: string; upload_url: string; upload_headers: Record<string, string> };
type Abertura = { url: string };

/**
 * /rh/ficha?colaborador=col_...: a ficha da pessoa, pela callable getRhFicha.
 * Cada gravação passa pela callable e, depois, a ficha e o painel do RH são
 * lidos de novo. O arquivo sobe pela URL assinada que requestRhUpload dá e só
 * vale na ficha depois de attachRhFile; abre pela URL de openRhFile, que
 * registra a abertura. As datas do vínculo (parte 8.4b) gravam por
 * saveRhVinculo, com a edição que a ficha leu.
 */
export default function RhFicha() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const colaboradorId = colaboradorDaBusca(useSearch());
  const leitura = useFichaDoRh(role, colaboradorId);
  const queryClient = useQueryClient();
  const [formulario, setFormulario] = useState<FormularioDoRegistro | null>(null);
  const [vinculo, setVinculo] = useState<FormularioDoVinculo | null>(null);
  const [arquivando, setArquivando] = useState<{ id: string; chave: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  async function gravar(acao: () => Promise<unknown>, depois: () => void = () => undefined) {
    setOcupado(true);
    setFalha(null);
    try {
      await acao();
      depois();
    } catch (error) {
      setFalha(error instanceof Error ? error.message : "Falha ao gravar.");
    } finally {
      // Lê de novo também depois da falha: a edição que a recusou (outra pessoa,
      // o anexo de agora) vale na próxima tentativa.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chaveDaFicha(colaboradorId ?? "") }),
        queryClient.invalidateQueries({ queryKey: CHAVE_DO_PAINEL }),
      ]);
      setOcupado(false);
    }
  }

  const acoes: AcoesDaFicha = {
    novo: () => {
      setFalha(null);
      setArquivando(null);
      setVinculo(null);
      setFormulario(formularioNovo(novaChave()));
    },
    alterar: (registro: RegistroDoRh) => {
      setFalha(null);
      setArquivando(null);
      setVinculo(null);
      setFormulario(formularioDoRegistro(novaChave(), registro));
    },
    editar: setFormulario,
    salvar: () => {
      if (!formulario || !colaboradorId) return;
      void gravar(() => chamarRh("saveRhRecord", pedidoDoFormulario(formulario, colaboradorId)), () => setFormulario(null));
    },
    fechar: () => {
      setFalha(null);
      setFormulario(null);
    },
    pedirArquivamento: (registroId: string) => {
      setFalha(null);
      setFormulario(null);
      setVinculo(null);
      setArquivando({ id: registroId, chave: novaChave() });
    },
    confirmarArquivamento: () => {
      const registro = leitura.ficha?.registros.find((item) => item.id === arquivando?.id);
      if (!registro || !arquivando) return;
      void gravar(
        () => chamarRh("archiveRhRecord", { idempotency_key: arquivando.chave, id: registro.id, expected_edicao: registro.edicao }),
        () => setArquivando(null),
      );
    },
    desistir: () => setArquivando(null),
    anexar: (registro: RegistroDoRh, arquivo: File) => {
      const problema = problemaDoArquivo(arquivo);
      if (problema) {
        setFalha(problema);
        return;
      }
      void gravar(async () => {
        const envio = await chamarRh<Envio>("requestRhUpload", { registro_id: registro.id, content_type: arquivo.type, tamanho: arquivo.size });
        const resposta = await fetch(envio.upload_url, { method: "PUT", headers: envio.upload_headers, body: arquivo });
        if (!resposta.ok) throw new Error("O arquivo não subiu. Tente de novo.");
        await chamarRh("attachRhFile", {
          idempotency_key: novaChave(),
          registro_id: registro.id,
          arquivo_id: envio.arquivo_id,
          content_type: arquivo.type,
          expected_edicao: registro.edicao,
        });
      });
    },
    abrirArquivo: (registro: RegistroDoRh) => {
      // A aba abre no clique (o navegador bloqueia a que abre depois da espera) e recebe a URL quando ela chega.
      const aba = window.open("", "_blank");
      if (aba) aba.opener = null;
      setFalha(null);
      void chamarRh<Abertura>("openRhFile", { registro_id: registro.id })
        .then((abertura) => {
          if (aba) aba.location.href = abertura.url;
          else window.location.assign(abertura.url);
        })
        .catch((error: unknown) => {
          aba?.close();
          setFalha(error instanceof Error ? error.message : "Falha ao abrir o arquivo.");
        });
    },
    abrirVinculo: () => {
      setFalha(null);
      setArquivando(null);
      setFormulario(null);
      setVinculo(formularioDoVinculo(novaChave(), leitura.ficha?.datas_do_vinculo ?? null));
    },
    editarVinculo: setVinculo,
    salvarVinculo: () => {
      if (!vinculo || !colaboradorId) return;
      void gravar(() => chamarRh("saveRhVinculo", pedidoDoVinculo(vinculo, colaboradorId)), () => setVinculo(null));
    },
    fecharVinculo: () => {
      setFalha(null);
      setVinculo(null);
    },
  };

  const estado: EstadoDaFicha = !colaboradorId || leitura.erro ? "erro" : leitura.ficha ? "pronto" : "carregando";
  return (
    <FichaView
      estado={estado}
      ficha={leitura.ficha}
      erro={colaboradorId ? leitura.erro : "Pessoa não encontrada."}
      grava={gravaNoRh(role)}
      formulario={formulario}
      vinculo={vinculo}
      arquivando={arquivando?.id ?? null}
      ocupado={ocupado}
      falha={falha}
      acoes={acoes}
    />
  );
}
