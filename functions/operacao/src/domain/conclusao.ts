import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  ETAPA_ROTULO,
  chave,
  falha,
  informadoPor,
  instante,
  instanteDoRegistro,
  interpretar,
  invalid,
  meio,
  numero,
  origemDoRegistro,
  problemaParaRegistrar,
  registroLido,
  type ContextoDoRegistro,
  type EtapaRegistrada,
  type RegistroDaExecucao,
} from "./execucao.js";
import { TIPOS_DE_FOTO, type ArquivoNoStorage, type FotoRegistrada } from "./fotos.js";
import { previsto, type ItemEmExecucao } from "./itens-executados.js";
import { deMilesimos, emMilesimos, type OsGravada } from "./os.js";

/**
 * A conclusão da OS (docs/plataforma/fase-3-operacao.md, parte 3.9a): o fim
 * no local, com o aceite do cliente. Com assinatura, o responsável do cliente
 * (nome, cargo e documento) assina no celular e a imagem sobe ao Storage em
 * `os/{numero}/assinatura/as_<16 hex>.png` antes da conclusão. Sem
 * responsável, a OS conclui "sem aceite no local", com o nome de quem
 * recebeu, e o aceite vem pela validação do cliente no Comercial (resposta 4).
 *
 * Nos dois casos, ao menos uma foto do final (as fotos da etapa Fim) e o
 * motivo de cada item feito a menos que o previsto (o motivo de item sem
 * diferença fica de fora). Concluir põe a OS Em
 * revisão; a revisão (parte 3.10) decide as divergências. A conclusão
 * registra a etapa Fim quando ela ainda não foi registrada. Nenhum campo de
 * valor; o evento não leva nome nem documento.
 */

export const ACEITES = ["assinatura", "sem_aceite"] as const;
export type AceiteDaConclusao = (typeof ACEITES)[number];

export const MAX_MOTIVO_DA_DIFERENCA = 300;

const ARQUIVO_DA_ASSINATURA = /^as_[a-f0-9]{16}\.(jpg|png|webp)$/;

export type ResponsavelDoCliente = { nome: string; cargo: string | null; documento: string | null };

/** O item feito a menos que o previsto, com o motivo dito no local. */
export type DiferencaNaConclusao = { linha: string; previsto: string; executado: string; motivo: string };

export type ConclusaoDaOs = RegistroDaExecucao & {
  aceite: AceiteDaConclusao;
  /** Com assinatura, quem assinou; sem aceite, quem recebeu. */
  responsavel: ResponsavelDoCliente;
  /** O caminho da assinatura no Storage, ou null sem aceite. */
  assinatura: string | null;
  diferencas: DiferencaNaConclusao[];
  /**
   * Os arquivos das fotos do final ("ft_….jpg"), que vão ao comprovante do
   * cliente (parte 4.3c). A regra do Storage abre ao cliente só estes e a
   * assinatura; as fotos das ocorrências e das outras etapas ficam internas.
   */
  arquivos_do_final: string[];
};

// --- Entrada ------------------------------------------------------------------------------

const opcional = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullable()
    .optional()
    .transform((valor: z.infer<T> | null | undefined) => valor ?? null);

const Concluir = z
  .object({
    idempotency_key: chave,
    numero,
    instante,
    aceite: z.enum(ACEITES),
    responsavel: z
      .object({
        nome: z.string().trim().min(2, "Informe o nome do responsável.").max(120, "Use até 120 caracteres no nome."),
        cargo: opcional(z.string().trim().min(1).max(80, "Use até 80 caracteres no cargo.")),
        documento: opcional(z.string().trim().min(3, "Documento inválido.").max(30, "Use até 30 caracteres no documento.")),
      })
      .strict(),
    assinatura: opcional(z.string().trim().regex(ARQUIVO_DA_ASSINATURA, "Arquivo da assinatura inválido.")),
    diferencas: z
      .array(
        z
          .object({
            linha: z.string().trim().min(1, "Informe a linha.").max(64),
            motivo: z
              .string()
              .trim()
              .min(3, "Informe o motivo da diferença.")
              .max(MAX_MOTIVO_DA_DIFERENCA, `Use até ${MAX_MOTIVO_DA_DIFERENCA} caracteres no motivo.`),
          })
          .strict(),
      )
      .max(300)
      .optional()
      .transform((valor) => valor ?? []),
    informado_por: informadoPor,
    meio,
  })
  .strict()
  .refine((valor) => valor.aceite !== "assinatura" || Boolean(valor.assinatura), "Colha a assinatura do responsável.")
  .refine((valor) => valor.aceite !== "sem_aceite" || !valor.assinatura, "Sem aceite no local não leva assinatura.");

export type PedidoDeConclusao = z.infer<typeof Concluir>;

export function interpretarConclusao(data: unknown): PedidoDeConclusao {
  return interpretar(Concluir, data);
}

/** Onde o navegador sobe a assinatura (o mesmo caminho do storage.rules). */
export function caminhoDaAssinatura(numeroDaOs: string, arquivo: string): string {
  return `os/${numeroDaOs}/assinatura/${arquivo}`;
}

// --- Regras -------------------------------------------------------------------------------

function horaEmSaoPaulo(instanteUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instanteUtc));
}

function nomeDa(item: Pick<ItemEmExecucao, "item" | "descricao">): string {
  return item.item || item.descricao;
}

/** Cada item feito a menos que o previsto, com o previsto e o feito (o que não foi informado conta zero). */
export function itensAMenos(itens: readonly ItemEmExecucao[]): Array<{ item: ItemEmExecucao; previsto: number; executado: number }> {
  return itens.flatMap((item) => {
    const limite = previsto(item);
    const feito = emMilesimos(item.executado ?? "0") ?? 0;
    return feito < limite ? [{ item, previsto: limite, executado: feito }] : [];
  });
}

/** O nome do arquivo no fim do caminho ("os/10045-01/fotos/ft_….jpg" dá "ft_….jpg"). */
export function arquivoDaFoto(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf("/") + 1);
}

/** As fotos do final: as da etapa Fim. */
export function fotosDoFinal(fotos: readonly FotoRegistrada[]): FotoRegistrada[] {
  return fotos.filter((foto) => foto.etapa === "fim");
}

export type ConclusaoNaOs = {
  conclusao: ConclusaoDaOs;
  etapas: EtapaRegistrada[];
  /** A etapa Fim que a conclusão registrou (null quando ela já estava registrada). */
  fim: EtapaRegistrada | null;
  fotosDoFinal: number;
};

/**
 * Conclui a OS em execução: o motivo de cada item a menos, ao menos uma foto
 * do final e, com assinatura, o arquivo conferido no Storage. A hora não vem
 * antes da última etapa. No celular, quando a OS tem líder, só ele conclui.
 */
export function concluirOs(
  os: OsGravada,
  entrada: {
    etapas: readonly EtapaRegistrada[];
    itens: readonly ItemEmExecucao[];
    fotos: readonly FotoRegistrada[];
    /** A assinatura no Storage (null quando não chegou ou sem aceite). */
    assinatura: ArquivoNoStorage | null;
  },
  pedido: PedidoDeConclusao,
  contexto: ContextoDoRegistro,
): ConclusaoNaOs {
  if (os.tipo === "vistoria") falha("A vistoria não se conclui com aceite: envie a vistoria ao Comercial.");
  const problema = problemaParaRegistrar(os);
  if (problema) falha(problema);
  if (os.status === "agendada") falha("Registre a primeira etapa antes de concluir.");

  if (contexto.canal === "celular") {
    const lideres = os.equipe.filter((pessoa) => pessoa.papel === "lider").map((pessoa) => pessoa.colaborador_id);
    if (lideres.length > 0 && !lideres.includes(contexto.informante ?? "")) {
      throw new HttpsError("permission-denied", "Só o líder conclui a OS pelo celular.");
    }
  }

  const quando = instanteDoRegistro(pedido.instante, os, contexto.agora);
  const ultima = entrada.etapas.at(-1);
  if (ultima && quando < ultima.instante) {
    falha(`A hora vem antes de ${ETAPA_ROTULO[ultima.etapa]} (${horaEmSaoPaulo(ultima.instante)}).`);
  }

  // O motivo de cada item a menos. O motivo de um item que já não tem
  // diferença (o feito chegou por outro aparelho antes) fica de fora: recusar
  // faria o responsável assinar de novo.
  const aMenos = itensAMenos(entrada.itens);
  const vistos = new Set<string>();
  for (const informado of pedido.diferencas) {
    if (vistos.has(informado.linha)) invalid("Informe o motivo de cada item uma vez só.");
    vistos.add(informado.linha);
    if (!entrada.itens.some((existente) => existente.id === informado.linha)) invalid("O item não está na OS.");
  }
  const diferencas = aMenos.map(({ item, previsto: limite, executado }): DiferencaNaConclusao => {
    const motivo = pedido.diferencas.find((informado) => informado.linha === item.id)?.motivo;
    if (!motivo) {
      invalid(`${nomeDa(item)}: feito ${deMilesimos(executado)} de ${deMilesimos(limite)}. Informe o motivo da diferença.`);
    }
    return { linha: item.id, previsto: deMilesimos(limite), executado: deMilesimos(executado), motivo };
  });

  const doFinal = fotosDoFinal(entrada.fotos);
  if (doFinal.length === 0) falha("Tire ao menos uma foto do final.");

  let assinatura: string | null = null;
  if (pedido.aceite === "assinatura" && pedido.assinatura) {
    if (!entrada.assinatura) falha("A assinatura não chegou ao armazenamento. Envie de novo.");
    if (!(TIPOS_DE_FOTO as readonly string[]).includes(entrada.assinatura.contentType)) falha("O arquivo da assinatura não é uma imagem.");
    assinatura = caminhoDaAssinatura(os.numero, pedido.assinatura);
  }

  const origem = origemDoRegistro(os, pedido, contexto);
  const registro: RegistroDaExecucao = {
    instante: quando,
    canal: contexto.canal,
    ...origem,
    registrado_por: contexto.registrado_por,
    registrado_em: contexto.agora.toISOString(),
  };
  const jaTemFim = entrada.etapas.some((etapa) => etapa.etapa === "fim");
  const fim: EtapaRegistrada | null = jaTemFim ? null : { ...registro, etapa: "fim" };
  const conclusao: ConclusaoDaOs = {
    ...registro,
    aceite: pedido.aceite,
    responsavel: { nome: pedido.responsavel.nome, cargo: pedido.responsavel.cargo, documento: pedido.responsavel.documento },
    assinatura,
    diferencas,
    arquivos_do_final: doFinal.map((foto) => arquivoDaFoto(foto.caminho)),
  };
  return { conclusao, etapas: fim ? [...entrada.etapas, fim] : [...entrada.etapas], fim, fotosDoFinal: doFinal.length };
}

// --- Leitura ------------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A conclusão gravada na OS, ou null. */
export function conclusaoLida(data: Record<string, unknown>): ConclusaoDaOs | null {
  const bruto = data.conclusao;
  if (!bruto || typeof bruto !== "object") return null;
  const conclusao = bruto as Record<string, unknown>;
  const registro = registroLido(conclusao);
  const aceite = texto(conclusao.aceite);
  if (!registro || !(ACEITES as readonly string[]).includes(aceite)) return null;
  const responsavel = conclusao.responsavel && typeof conclusao.responsavel === "object" ? (conclusao.responsavel as Record<string, unknown>) : {};
  const diferencas = Array.isArray(conclusao.diferencas) ? conclusao.diferencas : [];
  return {
    ...registro,
    aceite: aceite as AceiteDaConclusao,
    responsavel: { nome: texto(responsavel.nome), cargo: texto(responsavel.cargo) || null, documento: texto(responsavel.documento) || null },
    assinatura: texto(conclusao.assinatura) || null,
    diferencas: diferencas.flatMap((cru): DiferencaNaConclusao[] => {
      if (!cru || typeof cru !== "object") return [];
      const diferenca = cru as Record<string, unknown>;
      const linha = texto(diferenca.linha);
      return linha
        ? [{ linha, previsto: texto(diferenca.previsto), executado: texto(diferenca.executado), motivo: texto(diferenca.motivo) }]
        : [];
    }),
    // A OS concluída antes da parte 4.3c não tem a lista: o comprovante sai sem as fotos.
    arquivos_do_final: (Array.isArray(conclusao.arquivos_do_final) ? conclusao.arquivos_do_final : []).map(texto).filter(Boolean),
  };
}
