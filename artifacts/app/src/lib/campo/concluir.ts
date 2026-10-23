import { ETAPA_ROTULO, horaDe, type FichaDaOs } from "../operacao/ficha-da-os";
import type { NovoRegistro, RegistroNaFila } from "./fila";
import { euNaEquipe, itensNoCampo, quantidadeEmTexto } from "./os-no-campo";

/**
 * Concluir a OS no celular (docs/plataforma/fase-3-operacao.md, parte 3.9b;
 * docs/mockups/Campo2Concluir.dc.html): os itens com o feito e o previsto
 * (o guardado na fila por cima), o motivo de cada item a menos, as fotos do
 * final, o responsável do cliente e a assinatura, ou "sem aceite no local"
 * com o nome de quem recebeu. A tela confere antes; completeServiceOrder
 * confere de novo (parte 3.9a). A conclusão vai pela fila, depois das fotos
 * e dos feitos tocados antes. Sem valor.
 */

export type AceiteNoCampo = "assinatura" | "sem_aceite";

export type ItemParaConcluir = {
  id: string;
  item: string;
  codigo: string | null;
  unidade: string;
  feito: string;
  previsto: string;
  /** Quanto falta em milésimos (zero quando o feito chegou ao previsto). */
  falta: number;
  /** "−2". */
  diferenca: string | null;
  /** "+10 incluídas em campo · Carlos Silva · 09:32". */
  incluidos: string[];
};

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function nomeNaEquipe(ficha: Pick<FichaDaOs, "equipe">, id: string | null): string | null {
  return id ? (ficha.equipe.find((pessoa) => pessoa.id === id)?.nome ?? null) : null;
}

/** Os itens como vão na conclusão: o feito (com o guardado por cima) contra o previsto. */
export function itensParaConcluir(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[]): ItemParaConcluir[] {
  return itensNoCampo(ficha, pendentes).map((item) => {
    const falta = Math.max(0, item.previsto - item.feito);
    const gravado = ficha.itens.find((linha) => linha.id === item.id);
    return {
      id: item.id,
      item: item.item,
      codigo: item.codigo,
      unidade: item.unidade,
      feito: quantidadeEmTexto(item.feito),
      previsto: quantidadeEmTexto(item.previsto),
      falta,
      diferenca: falta ? `−${quantidadeEmTexto(falta)}` : null,
      incluidos: (gravado?.incluidos ?? []).map((inclusao) =>
        [`+${inclusao.quantidade} incluídas em campo`, nomeNaEquipe(ficha, inclusao.informadoPor), horaDe(inclusao.instante)].filter(Boolean).join(" · "),
      ),
    };
  });
}

/** Quantas fotos do final (etapa Fim) a OS tem, gravadas e guardadas na fila. */
export function fotosDoFinal(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[]): { gravadas: FichaDaOs["fotos"]; guardadas: RegistroNaFila[] } {
  return {
    gravadas: ficha.fotos.filter((foto) => foto.etapa === "fim"),
    guardadas: pendentes.filter((registro) => registro.callable === "attachPhoto" && registro.dados.numero === ficha.numero && registro.dados.etapa === "fim"),
  };
}

/** A última etapa, para o cabeçalho: "Montagem" · "13:00". */
export function ultimaEtapa(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[]): { rotulo: string; hora: string } | null {
  const guardada = [...pendentes].reverse().find((registro) => registro.callable === "registerStep" && registro.dados.numero === ficha.numero);
  if (guardada) {
    const etapa = textoDe(guardada.dados.etapa) as keyof typeof ETAPA_ROTULO;
    if (ETAPA_ROTULO[etapa]) return { rotulo: ETAPA_ROTULO[etapa], hora: horaDe(textoDe(guardada.dados.instante)) };
  }
  const gravada = ficha.etapas.at(-1);
  return gravada ? { rotulo: ETAPA_ROTULO[gravada.etapa], hora: horaDe(gravada.instante) } : null;
}

/** O contato no local que costuma assinar: o do destino, senão o da origem. */
export function responsavelSugerido(ficha: Pick<FichaDaOs, "locais">): string {
  return ficha.locais.destino?.contato?.nome ?? ficha.locais.origem?.contato?.nome ?? "";
}

/** A conclusão guardada na fila desta OS, se há: a tela da OS para de receber registros. */
export function conclusaoGuardada(ficha: Pick<FichaDaOs, "numero">, pendentes: readonly RegistroNaFila[]): RegistroNaFila | null {
  return pendentes.find((registro) => registro.callable === "completeServiceOrder" && registro.dados.numero === ficha.numero) ?? null;
}

/** Por que quem está no celular não conclui, ou null: só a OS em execução, e só o líder quando a OS tem um. */
export function problemaParaConcluir(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[], uid: string | null | undefined): string | null {
  if (conclusaoGuardada(ficha, pendentes)) return "A conclusão já está guardada.";
  if (ficha.status === "em_revisao" || ficha.status === "revisada") return "OS concluída";
  if (ficha.status === "cancelada") return "OS cancelada";
  const iniciada = ficha.status === "em_execucao" || pendentes.some((registro) => registro.callable === "registerStep" && registro.dados.numero === ficha.numero);
  if (!iniciada) return "Registre a primeira etapa antes de concluir.";
  const temLider = ficha.equipe.some((pessoa) => pessoa.papel === "lider");
  if (temLider && euNaEquipe(ficha, uid)?.papel !== "lider") return "Só o líder conclui a OS.";
  return null;
}

export type FormularioDaConclusao = {
  aceite: AceiteNoCampo;
  nome: string;
  cargo: string;
  documento: string;
  /** O motivo por linha a menos. */
  motivos: Readonly<Record<string, string>>;
};

export function problemasDaConclusao(
  formulario: FormularioDaConclusao,
  itens: readonly ItemParaConcluir[],
  fotosDoFinalNaOs: number,
  assinada: boolean,
): string[] {
  const problemas: string[] = [];
  for (const item of itens) {
    if (item.falta > 0 && (formulario.motivos[item.id] ?? "").trim().length < 3) problemas.push(`Informe o motivo da diferença em ${item.item}.`);
  }
  if (fotosDoFinalNaOs === 0) problemas.push("Tire ao menos uma foto do final.");
  if (formulario.nome.trim().length < 2) problemas.push(formulario.aceite === "assinatura" ? "Informe o nome do responsável." : "Informe quem recebeu.");
  if (formulario.aceite === "assinatura" && !assinada) problemas.push("Colha a assinatura do responsável.");
  return problemas;
}

/** "as_<16 hex>.png": o nome da assinatura no Storage (storage.rules). */
export function nomeDaAssinatura(aleatorio: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(8))): string {
  return `as_${Array.from(aleatorio(), (byte) => byte.toString(16).padStart(2, "0")).join("")}.png`;
}

/**
 * O registro da conclusão, no formato de completeServiceOrder. Com
 * assinatura, a imagem vai junto e sobe ao Storage antes da callable.
 */
export function registroDeConclusao(
  ficha: Pick<FichaDaOs, "numero">,
  formulario: FormularioDaConclusao,
  itens: readonly ItemParaConcluir[],
  assinatura: { arquivo: Blob; nome: string } | null,
  agora: Date,
): NovoRegistro {
  const cargo = formulario.cargo.trim();
  const documento = formulario.documento.trim();
  const comAssinatura = formulario.aceite === "assinatura" && assinatura;
  return {
    callable: "completeServiceOrder",
    dados: {
      numero: ficha.numero,
      instante: agora.toISOString(),
      aceite: formulario.aceite,
      responsavel: {
        nome: formulario.nome.trim(),
        ...(formulario.aceite === "assinatura" && cargo ? { cargo } : {}),
        ...(formulario.aceite === "assinatura" && documento ? { documento } : {}),
      },
      ...(comAssinatura ? { assinatura: assinatura.nome } : {}),
      diferencas: itens.filter((item) => item.falta > 0).map((item) => ({ linha: item.id, motivo: (formulario.motivos[item.id] ?? "").trim() })),
    },
    ...(comAssinatura ? { foto: { caminho: `os/${ficha.numero}/assinatura/${assinatura.nome}`, arquivo: assinatura.arquivo, contentType: "image/png" } } : {}),
    rotulo: "Conclusão",
  };
}
