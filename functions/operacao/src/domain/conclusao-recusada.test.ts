import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import type { PedidoDeConclusao } from "./conclusao.js";
import { conclusaoRecusadaLida, interpretarResolucao, recusaDaConclusao, recusaResolvida, type ConclusaoRecusada } from "./conclusao-recusada.js";

/**
 * A conclusão recusada do campo (pergunta 66): o que se guarda, de quem, e
 * como a coordenação anexa à conclusão ou dispensa. Dados sintéticos.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";
const OS = {
  equipe: [{ colaborador_id: ANA, nome: "Ana Lima", papel: "lider" as const, vinculo: "proprio" as const, empresa: null, no_app: true, usuario_uid: "uid-ana" }],
  equipe_uids: ["uid-ana"],
};
const PEDIDO: PedidoDeConclusao = {
  idempotency_key: "c-1",
  numero: "10045-01",
  instante: "2026-10-22T17:52-03:00",
  aceite: "assinatura",
  responsavel: { nome: "Renata Campos", cargo: "Facilities" },
  assinatura: "as_0123456789abcdef.png",
  diferencas: [],
  informado_por: null,
  meio: null,
};
const CAMINHO = "os/10045-01/assinatura/as_0123456789abcdef.png";
const AGORA = new Date("2026-10-22T21:04:00.000Z");
const MARCA = { instante: "2026-10-22T21:10:00.000Z", por: { uid: "interno-1", nome: "Mariana Lopes" } };

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError);
    return error;
  }
  throw new Error("esperava a recusa");
}

const recusa = (extra: Partial<ConclusaoRecusada> = {}): ConclusaoRecusada => ({
  ...recusaDaConclusao(OS, PEDIDO, { uid: "uid-ana", role: "campo" }, CAMINHO, "A OS já foi concluída.", AGORA)!,
  ...extra,
});

const concluidaSemAceite = {
  conclusao: {
    instante: "2026-10-22T20:50:00.000Z",
    canal: "escritorio",
    meio: "telefone",
    informado_por: ANA,
    registrado_por: { uid: "interno-1", role: "interno" },
    registrado_em: "2026-10-22T20:55:00.000Z",
    aceite: "sem_aceite",
    responsavel: { nome: "Portaria", cargo: null, documento: null },
    assinatura: null,
    diferencas: [],
    arquivos_do_final: ["ft_f000000000000001.jpg"],
  },
};

describe("a conclusão recusada do campo", () => {
  it("guarda a hora, quem concluiu, quem recebeu (sem o documento), a assinatura e o motivo", () => {
    assert.deepEqual(recusa(), {
      chave: "c-1",
      recusada_em: "2026-10-22T21:04:00.000Z",
      instante: "2026-10-22T20:52:00.000Z",
      informado_por: ANA,
      registrado_por: { uid: "uid-ana", role: "campo" },
      responsavel: { nome: "Renata Campos", cargo: "Facilities" },
      assinatura: CAMINHO,
      motivo: "A OS já foi concluída.",
      anexada: null,
      dispensada: null,
    });
  });

  it("sem a assinatura conferida, sem aceite ou de quem não está na equipe, não há o que guardar", () => {
    assert.equal(recusaDaConclusao(OS, PEDIDO, { uid: "uid-ana", role: "campo" }, null, "x", AGORA), null);
    assert.equal(recusaDaConclusao(OS, { ...PEDIDO, aceite: "sem_aceite", assinatura: null }, { uid: "uid-ana", role: "campo" }, CAMINHO, "x", AGORA), null);
    assert.equal(recusaDaConclusao(OS, PEDIDO, { uid: "uid-outro", role: "campo" }, CAMINHO, "x", AGORA), null);
  });

  it("anexar põe na conclusão sem aceite a assinatura e quem assinou, também na OS revisada", () => {
    for (const status of ["em_revisao", "revisada"] as const) {
      const { recusa: resolvida, conclusao } = recusaResolvida({ status }, { ...concluidaSemAceite, conclusao_recusada: recusa() }, interpretarResolucao({ idempotency_key: "r-1", numero: "10045-01", acao: "anexar", recusada_em: "2026-10-22T21:04:00.000Z" }), MARCA);
      assert.deepEqual(resolvida.anexada, MARCA);
      assert.equal(resolvida.dispensada, null);
      assert.equal(conclusao?.aceite, "assinatura");
      assert.deepEqual(conclusao?.responsavel, { nome: "Renata Campos", cargo: "Facilities" });
      assert.equal(conclusao?.assinatura, CAMINHO);
      // O resto da conclusão não muda: hora, quem informou, itens e fotos.
      assert.equal(conclusao?.instante, "2026-10-22T20:50:00.000Z");
      assert.deepEqual(conclusao?.arquivos_do_final, ["ft_f000000000000001.jpg"]);
    }
  });

  it("anexar recusa a OS não concluída e a conclusão já assinada; dispensar vale em qualquer uma", () => {
    const pedido = (acao: string) => interpretarResolucao({ idempotency_key: "r-1", numero: "10045-01", acao, recusada_em: "2026-10-22T21:04:00.000Z" });
    assert.equal(
      rejeita(() => recusaResolvida({ status: "em_execucao" }, { conclusao_recusada: recusa() }, pedido("anexar"), MARCA)).message,
      "Só a OS concluída recebe a assinatura do campo: conclua a OS com estes dados.",
    );
    const assinada = { conclusao: { ...concluidaSemAceite.conclusao, aceite: "assinatura", assinatura: "os/10045-01/assinatura/as_ffffffffffffffff.png" } };
    assert.equal(rejeita(() => recusaResolvida({ status: "em_revisao" }, { ...assinada, conclusao_recusada: recusa() }, pedido("anexar"), MARCA)).message, "A conclusão já tem a assinatura.");
    const dispensada = recusaResolvida({ status: "em_execucao" }, { conclusao_recusada: recusa() }, pedido("dispensar"), MARCA);
    assert.deepEqual(dispensada.recusa.dispensada, MARCA);
    assert.equal(dispensada.conclusao, null);
  });

  it("a recusa que a tela não viu, a já resolvida e a OS sem recusa, não", () => {
    const pedido = interpretarResolucao({ idempotency_key: "r-1", numero: "10045-01", acao: "dispensar", recusada_em: "2026-10-22T21:04:00.000Z" });
    assert.equal(rejeita(() => recusaResolvida({ status: "em_revisao" }, {}, pedido, MARCA)).message, "A OS não tem conclusão recusada do campo.");
    assert.equal(
      rejeita(() => recusaResolvida({ status: "em_revisao" }, { conclusao_recusada: recusa({ recusada_em: "2026-10-22T21:30:00.000Z" }) }, pedido, MARCA)).message,
      "A conclusão recusada mudou. Recarregue e tente de novo.",
    );
    assert.equal(rejeita(() => recusaResolvida({ status: "em_revisao" }, { conclusao_recusada: recusa({ dispensada: MARCA }) }, pedido, MARCA)).message, "A conclusão recusada já foi resolvida.");
    assert.equal(rejeita(() => interpretarResolucao({ ...pedido, acao: "apagar" })).code, "invalid-argument");
  });

  it("a leitura confere os campos; a incompleta é null", () => {
    assert.deepEqual(conclusaoRecusadaLida(recusa({ anexada: MARCA })), recusa({ anexada: MARCA }));
    assert.equal(conclusaoRecusadaLida({ ...recusa(), assinatura: "" }), null);
    assert.equal(conclusaoRecusadaLida(null), null);
  });
});
