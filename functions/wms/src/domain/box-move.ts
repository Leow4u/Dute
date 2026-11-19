import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { prateleiraNoAlcance, type CaixaDaRodada, type RodadaLida } from "./count-rounds.js";

/**
 * Mover caixa entre prateleiras (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * decisões do Leonardo em 19/11/2026; mockup em docs/mockups/mover-caixa/).
 * Uma caixa por vez, de uma prateleira para outra da zona do cliente: a
 * coordenação e quem opera (owner, admin, interno e wms). O sistema sugere o
 * destino (o mesmo produto, depois a mais vazia: destinosDoMover, em
 * warehouse-boxes.ts) e a pessoa pode trocar à mão.
 *
 * Aqui ficam a entrada das callables, as frases das recusas e a contagem
 * aberta; a prévia e o mover, que leem e gravam, ficam abaixo delas.
 */

/** A origem do movimento do mover: fora da cobrança (billing-scope.ts) e do relógio dos parados. */
export const BOX_MOVE_SOURCE = "functions_box_move";
export const BOX_MOVED_EVENT_TYPE = "warehouse.box_moved";
/** O motivo gravado nos dois movimentos do mover. */
export const MOTIVO_DO_MOVER = "Mudança de prateleira";

const ENTRADA_INVALIDA = "Caixa inválida: confira o código e tente de novo.";

// ---------------------------------------------------------------- entrada

const CodigoDaCaixa = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CX-\d{6,}$/);
const Prateleira = z.string().trim().min(1).max(40);
const Cliente = z.string().trim().min(1).max(160);

export const PreviewBoxMoveSchema = z.object({ customer_code: Cliente, box_code: CodigoDaCaixa }).strict();

export const MoveWarehouseBoxSchema = z
  .object({
    customer_code: Cliente,
    box_code: CodigoDaCaixa,
    /** A prateleira em que a tela viu a caixa: a que mudou desde então recusa. */
    from_location_id: Prateleira,
    to_location_id: Prateleira,
    /** A sugestão que a tela mostrou: o evento diz se a pessoa a seguiu. */
    suggestion: z.object({ position: Prateleira, alternatives: z.array(Prateleira).max(5) }).strict().optional(),
    idempotency_key: z.string().trim().min(8).max(200),
  })
  .strict();

export type EntradaDaPreviaDoMover = z.output<typeof PreviewBoxMoveSchema>;
export type EntradaDoMover = z.output<typeof MoveWarehouseBoxSchema>;

function entradaValida<T>(parsed: z.SafeParseReturnType<unknown, T>): T {
  if (parsed.success) return parsed.data;
  // Fora do formato, a frase para quem opera; o ZodError cru viraria INTERNAL.
  throw new HttpsError("invalid-argument", ENTRADA_INVALIDA, { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
}

export function entradaDaPreviaDoMover(raw: unknown): EntradaDaPreviaDoMover {
  return entradaValida(PreviewBoxMoveSchema.safeParse(raw ?? {}));
}

export function entradaDoMover(raw: unknown): EntradaDoMover {
  return entradaValida(MoveWarehouseBoxSchema.safeParse(raw ?? {}));
}

// ---------------------------------------------------------------- recusas

/** Uma recusa do mover: o código (em `details.code`), a frase para quem opera e o tipo do erro. */
export type RecusaDoMover = {
  code: string;
  message: string;
  status: "failed-precondition" | "not-found";
  extra?: Record<string, unknown>;
};

const unidades = new Intl.NumberFormat("pt-BR");

const recusa = (code: string, message: string, extra?: Record<string, unknown>, status: RecusaDoMover["status"] = "failed-precondition"): RecusaDoMover => ({
  code,
  message,
  status,
  ...(extra ? { extra } : {}),
});

/** As frases das recusas: as mesmas na prévia (o bloqueio) e no mover (o erro). */
export const RECUSAS_DO_MOVER = {
  caixaNaoExiste: (caixa: string) => recusa("BOX_MOVE_BOX_NOT_FOUND", `A caixa ${caixa} não está cadastrada. Confira o código na etiqueta da caixa.`, undefined, "not-found"),
  caixaNaoGuardada: (caixa: string) => recusa("BOX_MOVE_BOX_NOT_STORED", `A caixa ${caixa} não está guardada numa prateleira: só a caixa guardada muda de prateleira.`),
  outraPrateleira: (caixa: string, atual: string, vista: string) =>
    recusa("BOX_MOVE_WRONG_SHELF", `A caixa ${caixa} está em ${atual || "nenhuma prateleira"}, não em ${vista}: atualize a tela.`, { location_id: atual || null }),
  prateleiraNaoExiste: (prateleira: string) => recusa("BOX_MOVE_SHELF_NOT_FOUND", `A prateleira ${prateleira} não está cadastrada em Estoque › Posições.`, undefined, "not-found"),
  areaDePassagem: (area: string) => recusa("BOX_MOVE_NOT_A_SHELF", `${area} é área de passagem, não prateleira: a caixa muda só entre prateleiras.`),
  mesmaPrateleira: (caixa: string, prateleira: string) => recusa("BOX_MOVE_SAME_SHELF", `A caixa ${caixa} já está em ${prateleira}.`),
  prateleiraIndisponivel: (prateleira: string, status: string) =>
    recusa("BOX_MOVE_SHELF_UNAVAILABLE", `A prateleira ${prateleira} está ${status === "blocked" ? "bloqueada" : "em verificação"}: escolha outra.`, { status }),
  outraZona: (prateleira: string, cliente: string) => recusa("BOX_MOVE_OTHER_ZONE", `A prateleira ${prateleira} não é da zona de ${cliente}.`),
  naoCabe: (caixa: string, prateleira: string) => recusa("BOX_MOVE_DOES_NOT_FIT", `A caixa ${caixa} não cabe em ${prateleira}: escolha outra prateleira.`),
  outraEmCima: (caixa: string, deCima: string) => recusa("BOX_MOVE_SUPPORTS_ANOTHER", `A caixa ${deCima} está em cima da ${caixa}: mova a de cima primeiro.`, { box_code: deCima }),
  reservadoNaOrigem: (item: string, origem: string, pedido: string) =>
    recusa(
      "BOX_MOVE_RESERVED",
      `${item} está reservado em ${origem}${pedido ? ` para o pedido ${pedido}` : ""}: mova a caixa depois da entrega.`,
      { order_number: pedido || null },
    ),
  reservadoNoDestino: (item: string, destino: string, pedido: string) =>
    recusa(
      "BOX_MOVE_DESTINATION_RESERVED",
      `${item} está reservado em ${destino}${pedido ? ` para o pedido ${pedido}` : ""}: escolha outra prateleira ou mova depois da entrega.`,
      { order_number: pedido || null },
    ),
  naContagem: (prateleira: string, titulo: string, roundId: string) =>
    recusa("BOX_MOVE_COUNT_ROUND_OPEN", `${prateleira} está na contagem «${titulo}»: conclua a contagem antes de mover.`, { round_id: roundId }),
  aberturaAberta: (cliente: string) => recusa("BOX_MOVE_OPENING_OPEN", `A abertura de ${cliente} está em andamento: na abertura, use Corrigir caixa.`),
  prateleiraComMenos: (origem: string, naPrateleira: number, item: string, caixa: string, naCaixa: number) =>
    recusa(
      "BOX_MOVE_SHELF_SHORT",
      `A prateleira ${origem} tem ${unidades.format(naPrateleira)} un. de ${item} e a caixa ${caixa} diz ${unidades.format(naCaixa)}: a prateleira precisa do acerto antes (Caixas × saldo, na Contagem).`,
    ),
  saldoDuplicado: (sku: string, prateleira: string) => recusa("BOX_MOVE_DUPLICATED_BALANCE", `Mais de um saldo existe para ${sku} em ${prateleira}.`, { sku_code: sku }),
} as const;

/** A recusa vira o erro da callable, com o código em `details.code`. */
export function recusar(recusaDoMover: RecusaDoMover): never {
  throw new HttpsError(recusaDoMover.status, recusaDoMover.message, { code: recusaDoMover.code, ...recusaDoMover.extra });
}

// ------------------------------------------------------ a contagem aberta

function chave(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * A origem e o destino na contagem aberta: a origem como está, com a caixa
 * nela; o destino como ficaria, com a caixa. Conferir a origem depois do
 * mover deixaria, numa contagem por rua, a última caixa de uma prateleira da
 * rua sair sem ter sido contada. `caixas` traz a caixa movida.
 */
export function prateleirasNaContagem(
  rodada: Pick<RodadaLida, "id" | "alcance"> | null,
  caixas: readonly CaixaDaRodada[],
  mover: { box_code: string; origem: string; destino: string },
): { origem: boolean; destino: boolean } {
  if (!rodada) return { origem: false, destino: false };
  const movida = chave(mover.box_code);
  const destino = chave(mover.destino);
  const depois = caixas.map((caixa) => (chave(caixa.code) === movida ? { ...caixa, location_id: destino } : caixa));
  return {
    origem: prateleiraNoAlcance(rodada.alcance, mover.origem, caixas, rodada.id),
    destino: prateleiraNoAlcance(rodada.alcance, destino, depois, rodada.id),
  };
}
