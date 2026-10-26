import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MESES_DAS_FOTOS, limiteDasFotos, revisadaEm, separarFotos, teveCobranca } from "./retencao-das-fotos.js";

/** A regra da retenção das fotos da OS (LGPD, decisão 2), sem o banco. */

const foto = (id: string, extra: Record<string, unknown> = {}) => ({ id, caminho: `os/10050-01/fotos/${id}.jpg`, etapa: null, ocorrencia: null, legenda: null, ...extra });
const ids = (fotos: ReadonlyArray<Record<string, unknown>>) => fotos.map((item) => item.id);

const revisada = { status: "revisada", tipo: "servico", revisao: { instante: "2025-09-20T15:00:00.000Z", linhas: [], aditivo: [] } };

describe("a retenção das fotos da OS", () => {
  it("o prazo é de 12 meses, no mesmo dia do ano anterior", () => {
    assert.equal(MESES_DAS_FOTOS, 12);
    assert.equal(limiteDasFotos(new Date("2026-10-26T06:20:00.000Z")).toISOString(), "2025-10-26T06:20:00.000Z");
  });

  it("a OS de serviço conta da revisão, a vistoria do envio ao Comercial, e a que não está revisada não conta", () => {
    assert.equal(revisadaEm(revisada), "2025-09-20T15:00:00.000Z");
    assert.equal(revisadaEm({ status: "revisada", tipo: "vistoria", vistoria: { registrado_em: "2025-08-01T12:00:00.000Z", instante: "2025-07-31T12:00:00.000Z" } }), "2025-08-01T12:00:00.000Z");
    assert.equal(revisadaEm({ ...revisada, status: "em_execucao" }), null);
    assert.equal(revisadaEm({ ...revisada, revisao: {} }), null);
    assert.equal(revisadaEm({ ...revisada, revisao: { instante: "ontem" } }), null);
  });

  it("a divergência cobrada e o aditivo, nesta revisão ou numa de antes da reabertura, seguram as fotos", () => {
    const linha = (decisao: string) => ({ revisao: { linhas: [{ linha: "l1", decisao }] } });
    assert.equal(teveCobranca(linha("cobrar")), true);
    assert.equal(teveCobranca(linha("aditivo")), true);
    assert.equal(teveCobranca({ revisao: { linhas: [], aditivo: [{ os: "10050-01", linha: "l1" }] } }), true);
    assert.equal(teveCobranca({ revisao: { linhas: [] }, revisoes_anteriores: [{ revisao: { linhas: [{ decisao: "cobrar" }] } }] }), true);
    for (const decisao of ["absorver", "proxima_os", "encerrar", "igual"]) assert.equal(teveCobranca(linha(decisao)), false, decisao);
    assert.equal(teveCobranca({}), false);
  });

  it("na OS de serviço, saem as fotos das etapas e das ocorrências; ficam as do final e o que não é foto desta OS", () => {
    const os = {
      ...revisada,
      conclusao: { arquivos_do_final: ["ft_0000000000000003.jpg"] },
      fotos: [
        foto("ft_0000000000000001", { etapa: "saida_patio" }),
        foto("ft_0000000000000002", { ocorrencia: "oc_01", legenda: "Porta riscada" }),
        // A do comprovante, mesmo sem a etapa marcada.
        foto("ft_0000000000000003"),
        foto("ft_0000000000000004", { etapa: "fim" }),
        foto("ft_0000000000000005"),
        { id: "ft_0000000000000006", caminho: "os/10099-01/fotos/ft_0000000000000006.jpg" },
        { id: "as_0000000000000007", caminho: "os/10050-01/assinatura/as_0000000000000007.png" },
      ],
    };
    const { saem, ficam, protegida } = separarFotos(os, "10050-01");
    assert.equal(protegida, false);
    assert.deepEqual(ids(saem), ["ft_0000000000000001", "ft_0000000000000002", "ft_0000000000000005"]);
    assert.deepEqual(ids(ficam), ["ft_0000000000000003", "ft_0000000000000004", "ft_0000000000000006", "as_0000000000000007"]);
  });

  it("a OS com cobrança fica com todas, e a vistoria perde todas, até a de etapa fim", () => {
    const fotos = [foto("ft_0000000000000001", { etapa: "montagem" }), foto("ft_0000000000000002", { etapa: "fim" })];
    const cobrada = separarFotos({ ...revisada, revisao: { ...revisada.revisao, linhas: [{ linha: "l1", decisao: "cobrar" }] }, fotos }, "10050-01");
    assert.deepEqual([cobrada.saem.length, cobrada.ficam.length, cobrada.protegida], [0, 2, true]);
    const vistoria = separarFotos({ status: "revisada", tipo: "vistoria", fotos }, "10050-01");
    assert.deepEqual([ids(vistoria.saem), vistoria.ficam.length, vistoria.protegida], [["ft_0000000000000001", "ft_0000000000000002"], 0, false]);
  });
});
