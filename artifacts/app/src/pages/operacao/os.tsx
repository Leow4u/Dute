import { useRef, useState } from "react";
import { ClipboardPen, ImagePlus } from "lucide-react";
import { collection, doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { Button } from "@/components/ui/button";
import {
  andamentoInicial,
  nomeDaAssinaturaDoArquivo,
  pedidosDoAndamento,
  problemaDaFoto,
  problemasDoAndamento,
  type AnexosDaConclusao,
  type FormularioDeAndamento,
} from "@/lib/operacao/andamento";
import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import { enviarAssinatura, enviarFoto, escolherFotos, type FotoEscolhida } from "@/lib/operacao/enviar-foto";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { clienteDaLeitura, hojeIso, nomesPorCodigo } from "@/lib/operacao/fila";
import { demandaDoHoje } from "@/lib/operacao/hoje";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";
import { fichaDaBusca } from "@/lib/operacao/navegacao";

import { AndamentoView } from "./andamento-view";
import { OsView, type EstadoDaFicha } from "./os-view";

/**
 * Operação › OS (partes 3.7d, 3.7e e 3.9c): a OS da URL (?numero=), a
 * demanda, o cliente e as fotos sobre OsView, e o painel de Registrar
 * andamento, que chama as callables em ordem e depois sobe as fotos da
 * ocorrência. Na conclusão, sobem antes as fotos do final (etapa Fim) e a
 * foto da via assinada; completeServiceOrder vem por último.
 */

export default function PaginaOs() {
  const numero = fichaDaBusca(useSearch()) ?? "";
  const os = useDocumento(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const demandaNumero = os.item?.demanda ?? null;
  const demanda = useDocumento(demandaNumero ? `demands/${demandaNumero}` : null, (db) => doc(db, "demands", demandaNumero ?? "-"), demandaDoHoje);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  // As fotos e a assinatura da conclusão (as regras liberam a leitura a quem coordena).
  const urls = useUrlsDasFotos([...(os.item?.fotos ?? []).map((foto) => foto.caminho), ...(os.item?.conclusao?.assinatura ? [os.item.conclusao.assinatura] : [])]);

  const estado: EstadoDaFicha = !numero || os.item === null ? "nao_encontrada" : os.erro ? "erro" : os.item === undefined ? "carregando" : "pronto";
  const ficha = os.item ?? null;

  const [form, setForm] = useState<FormularioDeAndamento | null>(null);
  const [tentou, setTentou] = useState(false);
  const [fotos, setFotos] = useState<FotoEscolhida[]>([]);
  const [fotosDoFinal, setFotosDoFinal] = useState<FotoEscolhida[]>([]);
  const [assinatura, setAssinatura] = useState<{ arquivo: File; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDasFotos, setErroDasFotos] = useState<string | null>(null);
  const [enviandoFotos, setEnviandoFotos] = useState(false);
  const chave = useRef<string>("");

  function abrir() {
    if (!ficha) return;
    chave.current = novaChave();
    setForm(andamentoInicial(ficha, new Date()));
    setTentou(false);
    setFotos([]);
    setFotosDoFinal([]);
    setAssinatura(null);
    setErro(null);
  }

  function fechar() {
    setForm(null);
    setFotos([]);
    setFotosDoFinal([]);
    setAssinatura(null);
    setErro(null);
  }

  const anexos: AnexosDaConclusao = { fotosDoFinal: fotosDoFinal.length, assinatura: assinatura?.nome ?? null };

  async function registrar() {
    if (!ficha || !form) return;
    setTentou(true);
    const agora = new Date();
    if (problemasDoAndamento(form, ficha, agora, anexos).length) return;
    setOcupado(true);
    setErro(null);
    try {
      if (form.tipo === "conclusao") {
        // A conclusão confere as fotos do final e a assinatura: elas sobem antes.
        for (const foto of fotosDoFinal) await enviarFoto(ficha.numero, foto, { chave: `${chave.current}:fim:${foto.nome}`, etapa: "fim" });
        if (form.aceite === "assinatura" && assinatura) await enviarAssinatura(ficha.numero, { arquivo: assinatura.arquivo, nome: assinatura.nome, contentType: assinatura.arquivo.type });
      }
      let ocorrencia: string | null = null;
      for (const pedido of pedidosDoAndamento(form, ficha, chave.current, agora, assinatura?.nome ?? null)) {
        const resultado = await chamarOperacao<{ ocorrencia?: string }>(pedido.callable, pedido.dados);
        ocorrencia = resultado.ocorrencia ?? ocorrencia;
      }
      for (const foto of fotos) {
        await enviarFoto(ficha.numero, foto, { chave: `${chave.current}:foto:${foto.nome}`, ocorrencia });
      }
      fechar();
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  async function anexar(arquivos: File[]) {
    if (!ficha || !arquivos.length) return;
    const escolha = escolherFotos(arquivos, ficha.janela?.data ?? null);
    setErroDasFotos(escolha.problema);
    if (escolha.problema) return;
    setEnviandoFotos(true);
    try {
      for (const foto of escolha.fotos) await enviarFoto(ficha.numero, foto, { chave: `foto:${foto.nome}` });
    } catch (error) {
      setErroDasFotos(mensagemDoErro(error));
    } finally {
      setEnviandoFotos(false);
    }
  }

  const recebeAndamento = ficha?.status === "agendada" || ficha?.status === "em_execucao";
  return (
    <OsView
      estado={estado}
      numero={numero}
      ficha={ficha}
      cabecalho={{
        cliente: ficha ? nomesPorCodigo(clientes.itens ?? [])[ficha.customerCode] || ficha.customerCode : "",
        titulo: demanda.item?.titulo ?? null,
        tipo: demanda.item?.tipo ?? null,
      }}
      hoje={hojeIso()}
      urls={urls}
      acoes={
        recebeAndamento && !form ? (
          <Button type="button" onClick={abrir}>
            <ClipboardPen aria-hidden="true" className="size-4" />
            Registrar andamento
          </Button>
        ) : null
      }
      painel={
        ficha && form ? (
          <AndamentoView
            ficha={ficha}
            form={form}
            onForm={setForm}
            problemas={tentou ? problemasDoAndamento(form, ficha, new Date(), anexos) : []}
            erro={erro}
            ocupado={ocupado}
            fotos={fotos.map((foto) => foto.arquivo.name)}
            onFotos={(arquivos) => {
              const escolha = escolherFotos(arquivos, ficha.janela?.data ?? null);
              setErro(escolha.problema);
              setFotos([...fotos, ...escolha.fotos]);
            }}
            onTirarFoto={(indice) => setFotos(fotos.filter((_, atual) => atual !== indice))}
            anexos={{
              fotosDoFinal: fotosDoFinal.map((foto) => foto.arquivo.name),
              assinatura: assinatura?.arquivo.name ?? null,
              onFotosDoFinal: (arquivos) => {
                const escolha = escolherFotos(arquivos, ficha.janela?.data ?? null);
                setErro(escolha.problema);
                setFotosDoFinal([...fotosDoFinal, ...escolha.fotos]);
              },
              onTirarFotoDoFinal: (indice) => setFotosDoFinal(fotosDoFinal.filter((_, atual) => atual !== indice)),
              onAssinatura: (arquivo) => {
                if (!arquivo) return setAssinatura(null);
                const problema = problemaDaFoto(arquivo);
                const nome = nomeDaAssinaturaDoArquivo(arquivo.type);
                setErro(problema ? `${arquivo.name}: ${problema}` : null);
                setAssinatura(problema || !nome ? null : { arquivo, nome });
              },
            }}
            onCancelar={fechar}
            onRegistrar={() => void registrar()}
          />
        ) : null
      }
      anexarFotos={
        recebeAndamento ? (
          <span className="flex items-center gap-3">
            {erroDasFotos ? (
              <span role="alert" className="text-sm text-destructive">
                {erroDasFotos}
              </span>
            ) : null}
            <label
              aria-disabled={enviandoFotos}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring/40 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              <ImagePlus aria-hidden="true" className="size-4" />
              {enviandoFotos ? "Enviando" : "Anexar"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={enviandoFotos}
                onChange={(event) => {
                  void anexar(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
          </span>
        ) : null
      }
    />
  );
}
