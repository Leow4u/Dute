import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import type { ContextoDoRegistro } from "./execucao.js";
import { MAX_FOTOS_POR_OS, caminhoDaFoto, fotosLidas, interpretarFoto, registrarFoto, type FotoRegistrada } from "./fotos.js";
import type { OsGravada } from "./os.js";

/**
 * As fotos da OS (parte 3.7c): a foto só vale na OS depois de conferido o
 * arquivo no Storage, no caminho que o storage.rules libera.
 */

const AGORA = new Date("2026-10-22T15:00:00.000Z");
const ESCRITORIO: ContextoDoRegistro = { agora: AGORA, canal: "escritorio", registrado_por: { uid: "u-paula", role: "interno" } };
const JPEG = { contentType: "image/jpeg", size: 240_000 };
const NA_OS = { ocorrencias: ["oc_01"], linhas: ["ln_1"] };

const OS = {
  numero: "10045-01",
  demanda: "10045",
  customer_code: "ITAU",
  status: "em_execucao",
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [],
  edicao: 4,
} as unknown as OsGravada;

function pedido(extra: Record<string, unknown> = {}) {
  return interpretarFoto({ idempotency_key: "k", numero: "10045-01", arquivo: "ft_0123456789abcdef.jpg", instante: "2026-10-22T07:52-03:00", ...extra });
}

function recusa(fn: () => unknown, codigo: string, mensagem: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

describe("fotos da OS", () => {
  it("o caminho é o do storage.rules e o arquivo segue o nome ft_ com 16 hex", () => {
    assert.equal(caminhoDaFoto("10045-01", "ft_0123456789abcdef.jpg"), "os/10045-01/fotos/ft_0123456789abcdef.jpg");
    recusa(() => pedido({ arquivo: "../outra/ft_0123456789abcdef.jpg" }), "invalid-argument", "Arquivo da foto inválido.");
    recusa(() => pedido({ arquivo: "ft_0123456789abcdef.gif" }), "invalid-argument", "Arquivo da foto inválido.");
    recusa(() => pedido({ legenda: "x".repeat(61) }), "invalid-argument", "Use até 60 caracteres na legenda.");
  });

  it("grava com a etapa, a ocorrência, o item, a legenda e o instante, depois de conferir o arquivo", () => {
    const { fotos, registro } = registrarFoto(OS, [], pedido({ etapa: "carregamento", ocorrencia: "oc_01", linha: "ln_1", legenda: "Carga" }), ESCRITORIO, { arquivo: JPEG, ...NA_OS });
    assert.deepEqual(registro, {
      id: "ft_0123456789abcdef",
      caminho: "os/10045-01/fotos/ft_0123456789abcdef.jpg",
      etapa: "carregamento",
      ocorrencia: "oc_01",
      linha: "ln_1",
      legenda: "Carga",
      instante: "2026-10-22T10:52:00.000Z",
      canal: "escritorio",
      meio: null,
      informado_por: null,
      registrado_por: { uid: "u-paula", role: "interno" },
      registrado_em: "2026-10-22T15:00:00.000Z",
    });
    assert.equal(fotos.length, 1);
  });

  it("arquivo que não chegou ou não é foto, repetida, ocorrência ou item de fora e excesso são recusados", () => {
    recusa(() => registrarFoto(OS, [], pedido(), ESCRITORIO, { arquivo: null, ...NA_OS }), "failed-precondition", "A foto não chegou ao armazenamento. Envie de novo.");
    recusa(() => registrarFoto(OS, [], pedido(), ESCRITORIO, { arquivo: { contentType: "application/pdf", size: 10 }, ...NA_OS }), "failed-precondition", "O arquivo enviado não é uma foto.");
    const uma = registrarFoto(OS, [], pedido(), ESCRITORIO, { arquivo: JPEG, ...NA_OS }).fotos;
    recusa(() => registrarFoto(OS, uma, pedido(), ESCRITORIO, { arquivo: JPEG, ...NA_OS }), "failed-precondition", "A foto já está na OS.");
    recusa(() => registrarFoto(OS, [], pedido({ ocorrencia: "oc_09" }), ESCRITORIO, { arquivo: JPEG, ...NA_OS }), "invalid-argument", "A ocorrência não está na OS.");
    recusa(() => registrarFoto(OS, [], pedido({ linha: "ln_9" }), ESCRITORIO, { arquivo: JPEG, ...NA_OS }), "invalid-argument", "O item não está na OS.");
    const cheias = Array.from({ length: MAX_FOTOS_POR_OS }, (_, indice) => ({ id: `ft_${String(indice).padStart(16, "0")}` }) as FotoRegistrada);
    recusa(() => registrarFoto(OS, cheias, pedido(), ESCRITORIO, { arquivo: JPEG, ...NA_OS }), "failed-precondition", "A OS já tem 200 fotos.");
    recusa(() => registrarFoto({ ...OS, status: "cancelada" }, [], pedido(), ESCRITORIO, { arquivo: JPEG, ...NA_OS }), "failed-precondition", "A OS está cancelada.");
  });

  it("lê as fotos gravadas e deixa de fora o que não se lê", () => {
    const lidas = fotosLidas({
      fotos: [
        { id: "ft_0123456789abcdef", caminho: "os/10045-01/fotos/ft_0123456789abcdef.jpg", etapa: "fim", instante: "2026-10-22T10:52:00.000Z", legenda: "Destino" },
        { id: "ft_x", instante: "2026-10-22T10:52:00.000Z" },
        null,
      ],
    });
    assert.deepEqual(lidas.map((foto) => [foto.id, foto.etapa, foto.legenda]), [["ft_0123456789abcdef", "fim", "Destino"]]);
  });
});
