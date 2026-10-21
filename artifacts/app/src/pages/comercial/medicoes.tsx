import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import { cadastroDoDocumento, hojeLocal } from "@/lib/comercial/clientes";
import { contratoDoRegistro, nomeDoCliente, nomesDosClientes } from "@/lib/comercial/contratos";
import { baixarCsv, csvDoDiario, exportarDiarioDeBordo, nomeDoArquivoDoDiario } from "@/lib/comercial/diario";
import { chaveDaIntencao, type TentativaDeChamada } from "@/lib/comercial/envio";
import { carga, useLeitura } from "@/lib/comercial/leitura";
import {
  classificarErroDaMedicao,
  competenciaAtual,
  competenciaEscolhida,
  competenciasDoContrato,
  contratosDeMedicao,
  formDaLinha,
  formNovaLinha,
  medicaoDoRegistro,
  payloadAnexar,
  payloadAplicarTarifa,
  payloadAvancar,
  payloadCriar,
  payloadRetirarLinha,
  payloadSalvarLinha,
  tabelaDaLinhaDoRegistro,
  type AcaoDeAvanco,
  type Anexo,
  type FormLinha,
  type Medicao,
} from "@/lib/comercial/medicoes";
import { itemDoCatalogoDoDocumento, type ItemDoCatalogoDoc } from "@/lib/comercial/montar";
import { hrefDaMedicao, medicaoDaBusca } from "@/lib/comercial/navegacao";
import { firestore } from "@/lib/firebase";

import { AnexoDialog, AprovarDialog, ContestarDialog, LinhaDialog } from "./medicoes-dialogos";
import { MedicoesView } from "./medicoes-view";

/**
 * Comercial › Medições (docs/mockups/ComMedicaoMensal.dc.html; parte 16b de
 * docs/plataforma/fase-6-comercial.md). Lê pelo Firestore, como as regras
 * permitem a owner, admin e comercial (`medicoes`, `contracts`,
 * `price_tables`, `lpu_items` e `customers`), ao vivo: o que a callable gravou
 * aparece sem recarregar, e o valor que vale é sempre o do servidor. Grava só
 * pelas callables saveMedicao (create, upsert_line, remove_line) e
 * advanceMedicao (send, approve, contest, reopen), cada uma com chave de
 * idempotência (`request_id`) e a situação e a edição que a tela viu. Medição
 * que mudou no meio do caminho (situação ou edição diferente) mostra a
 * mensagem do servidor e descarta o que estava aberto: a tela já está com a
 * versão nova.
 */

/** Cada diálogo guarda a medição de quando abriu: a edição dela é a que a callable confere. */
type Dialogo =
  | { tipo: "linha"; base: Medicao; inicial: FormLinha }
  | { tipo: "anexo"; base: Medicao; linhaId: string }
  | { tipo: "aprovar"; base: Medicao }
  | { tipo: "contestar"; base: Medicao };

/** Os itens do catálogo (lpu_items), lidos uma vez quando a linha vai ser montada. */
function useItensDoCatalogo(ativo: boolean): Map<string, ItemDoCatalogoDoc> | "carregando" | "erro" {
  const [estado, setEstado] = useState<Map<string, ItemDoCatalogoDoc> | "carregando" | "erro">("carregando");
  useEffect(() => {
    if (!ativo) return undefined;
    if (!firestore) {
      setEstado("erro");
      return undefined;
    }
    let vivo = true;
    getDocs(collection(firestore, "lpu_items"))
      .then((snapshot) => {
        if (vivo) setEstado(new Map(snapshot.docs.map((row) => [row.id, itemDoCatalogoDoDocumento(row.data())])));
      })
      .catch(() => {
        if (vivo) setEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return estado;
}

export default function ComercialMedicoesPage() {
  const { toast } = useToast();
  const busca = useSearch();
  const [, navegar] = useLocation();
  const hoje = hojeLocal();
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const tentativa = useRef<TentativaDeChamada | null>(null);

  const contratosLidos = useLeitura("contracts", (db) => collection(db, "contracts"), contratoDoRegistro);
  const cadastros = useLeitura("customers", (db) => collection(db, "customers"), cadastroDoDocumento);
  const clientes = cadastros.itens ?? [];
  const nomes = useMemo(() => nomesDosClientes(clientes), [clientes]);
  const contratos = useMemo(() => contratosDeMedicao(contratosLidos.itens ?? [], nomes), [contratosLidos.itens, nomes]);

  const { contrato: contratoDaUrl, competencia: competenciaDaUrl } = medicaoDaBusca(busca);
  const contrato = contratos.find((candidato) => candidato.id === contratoDaUrl) ?? contratos[0] ?? null;
  const contratoId = contrato?.id ?? null;

  const medicoes = useLeitura(
    contratoId ? `medicoes:${contratoId}` : null,
    (db) => query(collection(db, "medicoes"), where("contrato_id", "==", contratoId)),
    medicaoDoRegistro,
  );
  const tabelas = useLeitura(
    contratoId ? `tabelas-da-medicao:${contratoId}` : null,
    (db) => query(collection(db, "price_tables"), where("contract_id", "==", contratoId)),
    tabelaDaLinhaDoRegistro,
  );
  const catalogo = useItensDoCatalogo(dialogo?.tipo === "linha");

  // Enquanto as medições não chegam, nem os chips nem a medição se afirmam.
  const chips = useMemo(() => (medicoes.itens ? competenciasDoContrato(medicoes.itens, hoje) : []), [medicoes.itens, hoje]);
  const competencia = chips.length ? competenciaEscolhida(chips, competenciaDaUrl, hoje) : (competenciaDaUrl ?? competenciaAtual(hoje));
  const medicao: Medicao | null | "carregando" | "erro" = medicoes.erro
    ? "erro"
    : medicoes.itens === null
      ? "carregando"
      : (medicoes.itens.find((candidata) => candidata.competencia === competencia) ?? null);
  const viva = typeof medicao === "object" && medicao !== null ? medicao : null;
  const cliente = contrato ? nomeDoCliente(nomes, contrato.dados.customer_code) : "";

  // Trocou de contrato ou de competência: o que estava aberto e o aviso ficam para trás.
  const alvo = `${contratoId ?? ""}|${competencia}`;
  useEffect(() => {
    setDialogo(null);
    setErro(null);
    setAviso(null);
  }, [alvo]);

  /**
   * Grava pela callable. A chave é a mesma enquanto a intenção é a mesma
   * (clicar de novo depois de uma falha de rede leva a mesma chave e o
   * servidor devolve o que já gravou). Erro de medição que mudou descarta o
   * que estava aberto e avisa; as outras recusas ficam no diálogo (ou em um
   * aviso, quando a ação não tem diálogo).
   */
  async function gravar(
    nome: "saveMedicao" | "advanceMedicao",
    montar: (chave: string) => Record<string, unknown>,
    sucesso: (resultado: Record<string, unknown>) => string,
  ) {
    const assinatura = `${nome}:${JSON.stringify(montar(""))}`;
    tentativa.current = chaveDaIntencao(tentativa.current, assinatura, novaChave);
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await chamarComercial(nome, montar(tentativa.current.chave));
      tentativa.current = null;
      setDialogo(null);
      setAviso(null);
      toast({ title: sucesso(resultado) });
    } catch (error) {
      const { mensagem, recarregar } = classificarErroDaMedicao(error);
      if (recarregar) {
        tentativa.current = null;
        setDialogo(null);
        setAviso(mensagem);
      } else if (dialogo) {
        setErro(mensagem);
      } else {
        toast({ title: mensagem, variant: "destructive" });
      }
    } finally {
      setOcupado(false);
    }
  }

  const avancar = (base: Medicao, acao: AcaoDeAvanco, extra: { link?: string; em?: string; nota?: string } = {}, sucesso: string) =>
    gravar("advanceMedicao", (chave) => payloadAvancar(base, acao, chave, extra), (resultado) => {
      const pendentes = Array.isArray(resultado.demandas_pendentes) ? resultado.demandas_pendentes.length : 0;
      return acao === "approve" && pendentes > 0 ? `${sucesso} (${pendentes} ${pendentes === 1 ? "demanda pendente" : "demandas pendentes"})` : sucesso;
    });

  const abrirDialogo = (proximo: Dialogo) => {
    setErro(null);
    setDialogo(proximo);
  };
  const fechar = () => {
    if (!ocupado) setDialogo(null);
  };

  const linhaDoDialogo = dialogo?.tipo === "anexo" ? (dialogo.base.linhas.find((linha) => linha.id === dialogo.linhaId) ?? null) : null;

  return (
    <>
      <MedicoesView
        estado={contratosLidos.erro ? "erro" : contratosLidos.itens === null ? "carregando" : "pronto"}
        contratos={contratos}
        clientes={clientes}
        contrato={contrato}
        onContrato={(id) => {
          const href = hrefDaMedicao(id);
          if (href) navegar(href, { replace: true });
        }}
        hoje={hoje}
        chips={chips}
        competencia={competencia}
        onCompetencia={(proxima) => {
          const href = contrato ? hrefDaMedicao(contrato.id, proxima) : null;
          if (href) navegar(href, { replace: true });
        }}
        medicao={medicao}
        tabelas={carga(tabelas)}
        ocupado={ocupado}
        aviso={aviso}
        acoes={{
          abrir: () => {
            if (!contratoId) return;
            void gravar("saveMedicao", (chave) => payloadCriar(contratoId, competencia, chave), () => "Medição aberta");
          },
          enviar: () => viva && void avancar(viva, "send", {}, "Medição enviada ao cliente"),
          aprovar: () => viva && abrirDialogo({ tipo: "aprovar", base: viva }),
          contestar: () => viva && abrirDialogo({ tipo: "contestar", base: viva }),
          reabrir: () => viva && void avancar(viva, "reopen", {}, "Medição reaberta"),
          exportar: () => {
            if (!viva) return;
            baixarCsv(nomeDoArquivoDoDiario(cliente, viva.competencia), csvDoDiario(exportarDiarioDeBordo(viva)));
          },
          novaLinha: () => viva && abrirDialogo({ tipo: "linha", base: viva, inicial: formNovaLinha(viva.competencia, novaChave()) }),
          editarLinha: (linhaId) => {
            const linha = viva?.linhas.find((candidata) => candidata.id === linhaId);
            if (viva && linha) abrirDialogo({ tipo: "linha", base: viva, inicial: formDaLinha(linha, novaChave()) });
          },
          aplicar: (linhaId, lpuItemId) => {
            const linha = viva?.linhas.find((candidata) => candidata.id === linhaId);
            if (!viva || !linha) return;
            const base = viva;
            void gravar("saveMedicao", (chave) => payloadAplicarTarifa(base, linha, lpuItemId, chave), () => "Tarifa aplicada");
          },
          anexar: (linhaId) => viva && abrirDialogo({ tipo: "anexo", base: viva, linhaId }),
        }}
      />

      <LinhaDialog
        aberto={dialogo?.tipo === "linha"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        inicial={dialogo?.tipo === "linha" ? dialogo.inicial : null}
        competencia={competencia}
        hoje={hoje}
        variante={dialogo?.tipo === "linha" ? dialogo.base.variante : "Comercial"}
        tabelas={carga(tabelas)}
        catalogo={catalogo}
        onSalvar={(form) => {
          if (dialogo?.tipo !== "linha") return;
          const base = dialogo.base;
          void gravar("saveMedicao", (chave) => payloadSalvarLinha(base, form, chave), () => (form.id ? "Linha salva" : "Linha incluída"));
        }}
        onRetirar={
          dialogo?.tipo === "linha" && dialogo.inicial.id
            ? () => {
                const base = dialogo.base;
                const linhaId = dialogo.inicial.id as string;
                void gravar("saveMedicao", (chave) => payloadRetirarLinha(base, linhaId, chave), () => "Linha retirada");
              }
            : undefined
        }
      />
      <AnexoDialog
        aberto={dialogo?.tipo === "anexo"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        linha={linhaDoDialogo}
        onSalvar={(anexo: Anexo) => {
          if (dialogo?.tipo !== "anexo" || !linhaDoDialogo) return;
          const base = dialogo.base;
          const linha = linhaDoDialogo;
          void gravar("saveMedicao", (chave) => payloadAnexar(base, linha, anexo, chave), () => "Pedido anexado");
        }}
      />
      <AprovarDialog
        aberto={dialogo?.tipo === "aprovar"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        onConfirmar={({ link, em }) => {
          if (dialogo?.tipo === "aprovar") void avancar(dialogo.base, "approve", { link, em }, "Aprovação registrada");
        }}
      />
      <ContestarDialog
        aberto={dialogo?.tipo === "contestar"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        onConfirmar={({ nota, em }) => {
          if (dialogo?.tipo === "contestar") void avancar(dialogo.base, "contest", { nota, em }, "Contestação registrada");
        }}
      />
    </>
  );
}
