import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STATUS_DA_EDICAO } from "./dominio.js";
import {
  AnexarDocumentoSchema,
  AnexarFotoSchema,
  TAMANHO_DA_FOTO,
  TAMANHO_DO_DOCUMENTO,
  TirarDocumentoSchema,
  caminhoDaFoto,
  caminhoDoDocumento,
  documentosLidos,
  fotosLidas,
  problemaDaFoto,
  problemaDoDocumento,
  problemaParaAnexarDocumento,
  problemaParaAnexarFoto,
  problemaParaTirarDocumento,
  type DocumentoDaEdicao,
} from "./arquivos.js";
import { entradaDe } from "./edicao.js";

/**
 * Os arquivos da edição do evento sem o banco (eventos, parte 3): os
 * caminhos do storage.rules, o que o bucket diz do arquivo, a janela de cada
 * status, quem tira cada documento e as entradas que dizem o campo.
 */

const BTG = "BTG Pactual";
const EDICAO = "ced_0123456789abcdef";
const PLANILHA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const cristiane = { uid: "cli-1", role: "cliente" };
const outraDaBtg = { uid: "cli-3", role: "cliente" };
const rafael = { uid: "rafael", role: "wms" };
const joana = { uid: "joana", role: "wms" };
const manoel = { uid: "manoel", role: "interno" };

function documento(origem: "cliente" | "dutelog", uid: string, role: string): DocumentoDaEdicao {
  return {
    id: origem === "cliente" ? "an_0123456789abcdef" : "dc_0123456789abcdef",
    caminho: "x",
    nome: "layout-necton.pdf",
    tipo: "application/pdf",
    tamanho: 1200,
    origem,
    momento_id: null,
    registrado_por: { uid, name: null, role },
    registrado_em: "2026-11-27T10:00:00.000Z",
  };
}

const doCliente = documento("cliente", "cli-1", "cliente");
const daDutelog = documento("dutelog", "rafael", "wms");

function recusa(chamada: () => unknown, mensagem: string | RegExp) {
  assert.throws(chamada, (erro: unknown) => {
    assert.equal((erro as { code?: string }).code, "invalid-argument");
    if (typeof mensagem === "string") assert.equal((erro as Error).message, mensagem);
    else assert.match((erro as Error).message, mensagem);
    return true;
  });
}

const FOTO = { edition_id: EDICAO, arquivo: "ft_0123456789abcdef.jpg", momento_id: "mo_0a1b2c3d", idempotency_key: "foto-0001" };
const ANEXO = { edition_id: EDICAO, arquivo: "an_0123456789abcdef.pdf", nome: "layout-necton.pdf", idempotency_key: "anexo-0001" };
const RETIRADA = { edition_id: EDICAO, documento_id: "an_0123456789abcdef", idempotency_key: "tirar-0001" };

describe("os arquivos da edição do evento", () => {
  it("os três caminhos", () => {
    assert.equal(caminhoDaFoto(BTG, EDICAO, "ft_0123456789abcdef.jpg"), "eventos/BTG Pactual/ced_0123456789abcdef/fotos/ft_0123456789abcdef.jpg");
    assert.equal(caminhoDoDocumento("cliente", BTG, EDICAO, "an_0123456789abcdef.pdf"), "portal/BTG Pactual/eventos/ced_0123456789abcdef/an_0123456789abcdef.pdf");
    assert.equal(caminhoDoDocumento("dutelog", BTG, EDICAO, "dc_0123456789abcdef.xlsx"), "eventos/BTG Pactual/ced_0123456789abcdef/docs/dc_0123456789abcdef.xlsx");
  });

  it("a foto: null não chegou (apagar false); image/gif não é foto (apagar true); 8 MiB passa; image/webp de 100 bytes vale", () => {
    assert.deepEqual(problemaDaFoto(null), { mensagem: "A foto não chegou ao armazenamento. Envie de novo.", apagar: false });
    assert.deepEqual(problemaDaFoto({ contentType: "image/gif", size: 100 }), { mensagem: "O arquivo enviado não é uma foto.", apagar: true });
    assert.deepEqual(problemaDaFoto({ contentType: "application/pdf", size: 100 }), { mensagem: "O arquivo enviado não é uma foto.", apagar: true });
    assert.deepEqual(problemaDaFoto({ contentType: "image/jpeg", size: TAMANHO_DA_FOTO }), { mensagem: "A foto passa de 8 MB.", apagar: true });
    assert.equal(problemaDaFoto({ contentType: "image/jpeg", size: TAMANHO_DA_FOTO - 1 }), null);
    assert.equal(problemaDaFoto({ contentType: "image/webp", size: 100 }), null);
  });

  it("o documento: a planilha de 10 MiB vale; 10 MiB + 1 passa; text/html não é PDF, imagem nem planilha", () => {
    assert.deepEqual(problemaDoDocumento(null), { mensagem: "O arquivo não chegou ao armazenamento. Envie de novo.", apagar: false });
    assert.equal(problemaDoDocumento({ contentType: PLANILHA, size: TAMANHO_DO_DOCUMENTO }), null);
    assert.equal(problemaDoDocumento({ contentType: "image/png", size: 100 }), null);
    assert.deepEqual(problemaDoDocumento({ contentType: "application/pdf", size: TAMANHO_DO_DOCUMENTO + 1 }), { mensagem: "O documento passa de 10 MB.", apagar: true });
    assert.deepEqual(problemaDoDocumento({ contentType: "text/html", size: 100 }), { mensagem: "O arquivo enviado não é PDF, imagem nem planilha.", apagar: true });
    assert.deepEqual(problemaDoDocumento({ contentType: "application/octet-stream", size: 100 }), { mensagem: "O arquivo enviado não é PDF, imagem nem planilha.", apagar: true });
  });

  it("os status: o documento vale em rascunho e em retornado e recusa em fechado e em cancelado; a foto em enviado recusa e em retornado vale", () => {
    for (const status of STATUS_DA_EDICAO) {
      const fechada = status === "fechado" || status === "cancelado";
      assert.equal(problemaParaAnexarDocumento(status), fechada ? "A edição já está fechada." : null, status);
      const antesDaConfirmacao = status === "rascunho" || status === "enviado";
      assert.equal(problemaParaAnexarFoto(status), fechada ? "A edição já está fechada." : antesDaConfirmacao ? "A edição ainda não foi confirmada." : null, status);
    }
    // O status que só o servidor grava e não se reconhece não abre nada.
    assert.equal(problemaParaAnexarDocumento("desconhecido"), "A edição já está fechada.");
    assert.equal(problemaParaAnexarFoto(""), "A edição já está fechada.");
  });

  it("tirar: as quatro recusas com o code de cada uma; o interno tira qualquer um; a colega do mesmo cliente tira o documento do cliente", () => {
    assert.deepEqual(problemaParaTirarDocumento("fechado", manoel, daDutelog), { code: "failed-precondition", mensagem: "A edição já está fechada." });
    assert.deepEqual(problemaParaTirarDocumento("cancelado", cristiane, doCliente), { code: "failed-precondition", mensagem: "A edição já está fechada." });
    assert.deepEqual(problemaParaTirarDocumento("confirmado", cristiane, doCliente), {
      code: "failed-precondition",
      mensagem: "Depois da confirmação, só a Dutelog retira documentos.",
    });
    assert.deepEqual(problemaParaTirarDocumento("enviado", cristiane, daDutelog), { code: "permission-denied", mensagem: "Só a Dutelog retira os documentos dela." });
    assert.deepEqual(problemaParaTirarDocumento("confirmado", joana, daDutelog), {
      code: "permission-denied",
      mensagem: "Só quem anexou o documento, ou a coordenação, o retira.",
    });
    // Do lado do cliente, quem anexou é a empresa: a colega tira o layout que a outra anexou.
    assert.equal(problemaParaTirarDocumento("rascunho", outraDaBtg, doCliente), null);
    assert.equal(problemaParaTirarDocumento("enviado", outraDaBtg, doCliente), null);
    assert.deepEqual(problemaParaTirarDocumento("enviado", outraDaBtg, daDutelog), { code: "permission-denied", mensagem: "Só a Dutelog retira os documentos dela." });
    assert.deepEqual(problemaParaTirarDocumento("enviado", rafael, doCliente), {
      code: "permission-denied",
      mensagem: "Só quem anexou o documento, ou a coordenação, o retira.",
    });
    assert.equal(problemaParaTirarDocumento("rascunho", cristiane, doCliente), null);
    assert.equal(problemaParaTirarDocumento("enviado", cristiane, doCliente), null);
    assert.equal(problemaParaTirarDocumento("retornado", rafael, daDutelog), null);
    for (const status of ["rascunho", "enviado", "confirmado", "separado", "no_evento", "retornado"]) {
      assert.equal(problemaParaTirarDocumento(status, manoel, doCliente), null, status);
      assert.equal(problemaParaTirarDocumento(status, manoel, daDutelog), null, status);
    }
  });

  it("as entradas dizem o campo: legenda de 61, nome de 121, sem arquivo ('Informe o arquivo'), arquivo 'foto.jpg' (invalid-argument com /arquivo/), campo extra", () => {
    recusa(() => entradaDe(AnexarFotoSchema, { ...FOTO, legenda: "x".repeat(61) }), "A legenda passa de 60 caracteres");
    recusa(() => entradaDe(AnexarDocumentoSchema, { ...ANEXO, nome: "x".repeat(121) }), "O nome do arquivo passa de 120 caracteres");
    const { arquivo: _semArquivo, ...semArquivo } = ANEXO;
    recusa(() => entradaDe(AnexarDocumentoSchema, semArquivo), "Informe o arquivo");
    recusa(() => entradaDe(AnexarFotoSchema, { ...FOTO, arquivo: "foto.jpg" }), /arquivo/);
    recusa(() => entradaDe(AnexarFotoSchema, { ...FOTO, arquivo: "dc_0123456789abcdef.jpg" }), /arquivo/);
    recusa(() => entradaDe(TirarDocumentoSchema, { ...RETIRADA, tipo: "application/pdf" }), "Campo não aceito: tipo");
    recusa(() => entradaDe(AnexarDocumentoSchema, { ...ANEXO, tamanho: 1200 }), "Campo não aceito: tamanho");
    const { momento_id: _semMomento, ...fotoSemMomento } = FOTO;
    recusa(() => entradaDe(AnexarFotoSchema, fotoSemMomento), "Informe o momento");
    recusa(() => entradaDe(AnexarFotoSchema, { ...FOTO, instante: "2027-01-27T05:00:00" }), "O instante da foto inválido");
    recusa(() => entradaDe(TirarDocumentoSchema, { ...RETIRADA, documento_id: "dc_x" }), "O documento inválido");
    const { edition_id: _semEdicao, ...retiradaSemEdicao } = RETIRADA;
    recusa(() => entradaDe(TirarDocumentoSchema, retiradaSemEdicao), "Informe a edição");
    recusa(() => entradaDe(AnexarDocumentoSchema, { ...ANEXO, momento_id: "evento" }), "O momento inválido");
  });

  it("as entradas válidas passam: o momento e a legenda são opcionais, o instante leva o fuso", () => {
    assert.deepEqual(entradaDe(AnexarDocumentoSchema, { ...ANEXO, nome: "  layout-necton.pdf  " }), ANEXO);
    assert.deepEqual(entradaDe(AnexarDocumentoSchema, { ...ANEXO, arquivo: "dc_0123456789abcdef.xlsx", momento_id: "mo_0a1b2c3d" }).momento_id, "mo_0a1b2c3d");
    const foto = entradaDe(AnexarFotoSchema, { ...FOTO, legenda: " Carga na doca ", instante: "2027-01-27T05:12:00-03:00" });
    assert.equal(foto.legenda, "Carga na doca");
    assert.equal(foto.instante, "2027-01-27T05:12:00-03:00");
    assert.deepEqual(entradaDe(TirarDocumentoSchema, { ...RETIRADA, customer_code: BTG }), { ...RETIRADA, customer_code: BTG });
  });

  it("o que se lê da edição: o registro sem id, caminho ou autor fica de fora", () => {
    const lidos = documentosLidos({ documentos: [doCliente, { id: "an_1111111111111111" }, null, "x", { ...daDutelog, registrado_por: null }] });
    assert.deepEqual(lidos, [doCliente]);
    const foto = { id: "ft_0123456789abcdef", caminho: "y", momento_id: "mo_0a1b2c3d", legenda: null, instante: "2027-01-27T08:12:00.000Z", registrado_por: { uid: "rafael", name: "Rafael", role: "wms" }, registrado_em: "2027-01-27T08:13:00.000Z" };
    assert.deepEqual(fotosLidas({ fotos: [foto, { ...foto, id: "" }, { ...foto, id: "ft_1111111111111111", momento_id: null }] }), [foto]);
    assert.deepEqual(documentosLidos({}), []);
    assert.deepEqual(fotosLidas({ fotos: "nenhuma" }), []);
  });
});
