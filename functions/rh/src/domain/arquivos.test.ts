import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  TAMANHO_MAXIMO_DO_ARQUIVO,
  caminhoDoArquivo,
  conferirArquivoNoBucket,
  entradaDaAbertura,
  entradaDoAnexo,
  entradaDoEnvio,
  novoIdDeArquivo,
  registroComArquivo,
} from "./arquivos.js";
import { buildRhEvent } from "./events.js";
import type { RegistroGravado } from "./ficha.js";

/**
 * Os arquivos da ficha (parte 8.2b), sem o Storage: o caminho, a entrada, a
 * conferência do bucket, a troca do arquivo e quem grava cada evento.
 */

const REG = "reg_aaaaaaaaaaaaaaaa";
const COL = "col_0123456789abcdef";
const ARQ = "arq_0123456789abcdef";

function recusa(fn: () => unknown, mensagem: string, codigo = "invalid-argument") {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.deepEqual([error.code, error.message], [codigo, mensagem]);
    return true;
  });
}

const registro: RegistroGravado = {
  id: REG,
  colaborador_id: COL,
  categoria: "exame",
  tipo: "periodico",
  descricao: null,
  emitido_em: "2025-11-01",
  vence_em: "2026-11-01",
  resultado: "apto",
  situacao: "vigente",
  substituido_por: null,
  arquivo: null,
  criado_em: "2026-01-01T12:00:00.000Z",
  edicao: 1,
};

describe("o arquivo do registro", () => {
  it("o caminho é do colaborador, do registro e do arquivo, com a extensão do tipo", () => {
    assert.match(novoIdDeArquivo(), /^arq_[a-f0-9]{16}$/);
    assert.equal(caminhoDoArquivo(registro, ARQ, "application/pdf"), `rh/${COL}/${REG}/${ARQ}.pdf`);
    assert.equal(caminhoDoArquivo(registro, ARQ, "image/jpeg"), `rh/${COL}/${REG}/${ARQ}.jpg`);
  });

  it("só PDF ou imagem, até 10 MB, e os ids no formato", () => {
    assert.deepEqual(entradaDoEnvio({ registro_id: REG, content_type: "image/png", tamanho: 1200 }), { registro_id: REG, content_type: "image/png", tamanho: 1200 });
    recusa(() => entradaDoEnvio({ registro_id: REG, content_type: "text/html", tamanho: 10 }), "Envie PDF, JPG, PNG ou WebP.");
    recusa(() => entradaDoEnvio({ registro_id: REG, content_type: "application/pdf", tamanho: TAMANHO_MAXIMO_DO_ARQUIVO + 1 }), "O arquivo passa de 10 MB.");
    recusa(() => entradaDoEnvio({ registro_id: REG, content_type: "application/pdf", tamanho: 0 }), "O arquivo está vazio.");
    recusa(() => entradaDoEnvio({ registro_id: "reg-1", content_type: "application/pdf", tamanho: 10 }), "Registro inválido.");
    recusa(() => entradaDoAnexo({ idempotency_key: "k", registro_id: REG, arquivo_id: "../x", content_type: "application/pdf", expected_edicao: 1 }), "Arquivo inválido.");
    recusa(() => entradaDaAbertura({ registro_id: REG, caminho: "rh/x" }), "Campo não aceito: caminho.");
  });

  it("o bucket confere: o arquivo existe, é do tipo informado e cabe", () => {
    assert.equal(conferirArquivoNoBucket({ contentType: "application/pdf", size: 2048 }, "application/pdf"), 2048);
    recusa(() => conferirArquivoNoBucket(null, "application/pdf"), "O arquivo não chegou. Envie de novo.", "failed-precondition");
    recusa(() => conferirArquivoNoBucket({ contentType: "text/html", size: 10 }, "application/pdf"), "O arquivo enviado não é do tipo informado. Envie de novo.", "failed-precondition");
    recusa(() => conferirArquivoNoBucket({ contentType: "application/pdf", size: TAMANHO_MAXIMO_DO_ARQUIVO + 1 }, "application/pdf"), "O arquivo passa de 10 MB.", "failed-precondition");
  });

  it("trocar o arquivo sobe a edição; a edição velha e o arquivado recusam", () => {
    const arquivo = { id: ARQ, caminho: caminhoDoArquivo(registro, ARQ, "application/pdf"), content_type: "application/pdf" as const, tamanho: 2048 };
    const anexado = registroComArquivo(registro, 1, arquivo);
    assert.deepEqual([anexado.edicao, anexado.arquivo], [2, arquivo]);
    recusa(() => registroComArquivo(registro, 2, arquivo), "O registro foi atualizado. Recarregue e tente de novo.", "failed-precondition");
    recusa(() => registroComArquivo({ ...registro, situacao: "arquivado" }, 1, arquivo), "O registro está arquivado.", "failed-precondition");
  });

  it("a abertura é de quem lê o RH; o anexo, só do rh", () => {
    const base = { id: REG, colaborador_id: COL, categoria: "exame", tipo: "periodico" } as const;
    for (const role of ["owner", "admin", "rh"]) {
      assert.equal(buildRhEvent({ operation_id: "abertura:1", type: "rh.file_opened", entity_id: REG, payload: base, actor: { uid: `${role}-1`, role } }).actor.role, role);
    }
    assert.throws(() => buildRhEvent({ operation_id: "abertura:2", type: "rh.file_opened", entity_id: REG, payload: base, actor: { uid: "interno-1", role: "interno" } }), /quem grava no RH/);
    assert.throws(() => buildRhEvent({ operation_id: "op", type: "rh.file_attached", entity_id: REG, payload: { ...base, substituiu: false }, actor: { uid: "owner-1", role: "owner" } }), /quem grava no RH/);
  });
});
