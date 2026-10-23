import { describe, expect, it } from "vitest";

import { fichaLida } from "./ficha";
import { comCategoria, formularioDoRegistro, formularioNovo, pedidoDoFormulario, problemaDoArquivo, rotuloDaData } from "./formulario";

/**
 * O formulário do registro (parte 8.2d): o pedido leva só o que o tipo
 * pede, e alterar leva o registro e a edição. O resto quem confere é a
 * callable.
 */

const COL = "col_aaaaaaaaaaaaaaaa";

describe("o formulário do registro da ficha", () => {
  it("incluir: o exame leva o resultado; o treinamento, não; o vencimento vazio vai como null", () => {
    const exame = { ...comCategoria(formularioNovo("k-1"), "exame"), emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto" as const };
    expect(exame.tipo).toBe("admissional");
    expect(pedidoDoFormulario({ ...exame, tipo: "periodico" }, COL)).toEqual({
      idempotency_key: "k-1",
      colaborador_id: COL,
      categoria: "exame",
      tipo: "periodico",
      emitido_em: "2025-11-01",
      vence_em: "2026-11-01",
      resultado: "apto",
    });
    const treinamento = { ...comCategoria(formularioNovo("k-2"), "treinamento"), tipo: "nr35", emitido_em: "2025-11-01" };
    expect(pedidoDoFormulario(treinamento, COL)).toEqual({ idempotency_key: "k-2", colaborador_id: COL, categoria: "treinamento", tipo: "nr35", emitido_em: "2025-11-01", vence_em: null });
  });

  it("o tipo outro leva o nome; trocar a categoria leva o primeiro tipo dela", () => {
    const outro = { ...formularioNovo("k-3"), tipo: "outro", descricao: "Certificado de vacinação", emitido_em: "2024-05-10" };
    expect(pedidoDoFormulario(outro, COL)).toMatchObject({ tipo: "outro", descricao: "Certificado de vacinação" });
    expect(comCategoria(outro, "treinamento")).toMatchObject({ categoria: "treinamento", tipo: "nr06", descricao: "" });
  });

  it("alterar leva o registro e a edição, e a categoria não muda", () => {
    const ficha = fichaLida({
      hoje: "2026-10-23",
      colaborador: { id: COL, nome: "Ana", funcao: "", vinculo: "proprio", ativo: true },
      registros: [{ id: "reg_aaaaaaaaaaaaaaaa", colaborador_id: COL, categoria: "exame", tipo: "periodico", descricao: null, emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto", situacao: "vigente", substituido_por: null, arquivo: null, edicao: 3 }],
    })!;
    const formulario = formularioDoRegistro("k-4", ficha.registros[0]);
    expect(comCategoria(formulario, "documento")).toBe(formulario);
    expect(pedidoDoFormulario(formulario, COL)).toMatchObject({ id: "reg_aaaaaaaaaaaaaaaa", expected_edicao: 3, resultado: "apto" });
    expect(rotuloDaData("documento")).toBe("Emitido em");
    expect(rotuloDaData("exame")).toBe("Feito em");
  });

  it("o arquivo: PDF ou imagem, até 10 MB", () => {
    expect(problemaDoArquivo({ type: "application/pdf", size: 2048 })).toBeNull();
    expect(problemaDoArquivo({ type: "text/html", size: 10 })).toBe("Envie PDF, JPG, PNG ou WebP.");
    expect(problemaDoArquivo({ type: "image/png", size: 0 })).toBe("O arquivo está vazio.");
    expect(problemaDoArquivo({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBe("O arquivo passa de 10 MB.");
  });
});
