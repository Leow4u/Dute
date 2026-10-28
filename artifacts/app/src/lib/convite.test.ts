import { describe, expect, it } from "vitest";

import {
  conviteLido,
  mensagemDoConvite,
  mensagemDoEnvioDeConfirmacao,
  nomeDoAceite,
  perfilDoConvite,
} from "./convite";

const TOKEN = "3f9c2a7be1d04c58a6f1e2d3c4b5a69788aa";

describe("o convite lido pelo link (pergunta 68)", () => {
  it("lê o e-mail, o nome, o perfil e o cliente do lookupInvite", () => {
    expect(
      conviteLido(TOKEN, {
        email: " Ana.Ribeiro@Itau.com.br ",
        nome: "Ana Ribeiro",
        role: "cliente",
        customer_code: "ITAU",
        customer_name: "Itaú Unibanco",
        status: "pending",
      }),
    ).toEqual({ token: TOKEN, email: "ana.ribeiro@itau.com.br", nome: "Ana Ribeiro", role: "cliente", cliente: "Itaú Unibanco" });
    expect(conviteLido(TOKEN, { email: "rafa@dutelog.com.br", role: "wms", status: "pending" })).toEqual({
      token: TOKEN,
      email: "rafa@dutelog.com.br",
      nome: "",
      role: "wms",
      cliente: null,
    });
  });

  it("sem e-mail, sem perfil válido, fora de pendente ou sem token, não é convite", () => {
    expect(conviteLido(TOKEN, { role: "cliente", status: "pending" })).toBeNull();
    expect(conviteLido(TOKEN, { email: "a@b.com", role: "viewer", status: "pending" })).toBeNull();
    expect(conviteLido(TOKEN, { email: "a@b.com", role: "cliente", status: "used" })).toBeNull();
    expect(conviteLido("", { email: "a@b.com", role: "cliente", status: "pending" })).toBeNull();
    expect(conviteLido(TOKEN, null)).toBeNull();
  });

  it("o perfil do convite: o cliente com o nome dele, a equipe pelo papel", () => {
    expect(perfilDoConvite({ role: "cliente", cliente: "Itaú Unibanco" })).toBe("Cliente · Itaú Unibanco");
    expect(perfilDoConvite({ role: "cliente", cliente: null })).toBe("Cliente");
    expect(perfilDoConvite({ role: "interno", cliente: null })).toBe("Coordenação");
    expect(perfilDoConvite({ role: "wms", cliente: "Itaú Unibanco" })).toBe("Operação WMS");
  });

  it("o nome do aceite: o digitado, o da conta, o do convite ou o começo do e-mail", () => {
    const convite = { nome: "Ana", email: "ana.ribeiro@itau.com.br" };
    expect(nomeDoAceite("  Ana Ribeiro ", "Outro", convite)).toBe("Ana Ribeiro");
    expect(nomeDoAceite("", "Ana R.", convite)).toBe("Ana R.");
    expect(nomeDoAceite(" ", null, convite)).toBe("Ana");
    expect(nomeDoAceite("", undefined, { nome: "", email: "ana.ribeiro@itau.com.br" })).toBe("ana.ribeiro");
  });


});

describe("as mensagens da tela do convite", () => {
  function erro(code: string, message = "") {
    return Object.assign(new Error(message), { code });
  }

  it("os erros do login em português", () => {
    expect(mensagemDoConvite(erro("auth/invalid-credential"))).toBe(
      "Este e-mail já tem conta, e a senha não confere. Use a senha dela, ou Esqueci minha senha no login.",
    );
    expect(mensagemDoConvite(erro("auth/weak-password"))).toBe("Use uma senha com pelo menos 6 caracteres.");
    expect(mensagemDoConvite(erro("auth/too-many-requests"))).toBe("Muitas tentativas. Espere alguns minutos e tente de novo.");
    expect(mensagemDoConvite(erro("auth/network-request-failed"))).toBe("Sem conexão. Confira a internet e tente de novo.");
  });

  it("o envio mostra cooldown e falha recuperável sem expor erro do provedor", () => {
    expect(mensagemDoEnvioDeConfirmacao(erro("functions/resource-exhausted", "Aguarde um minuto antes de reenviar."))).toBe("Aguarde um minuto antes de reenviar.");
    for (const code of ["functions/unavailable", "functions/internal", "functions/deadline-exceeded"]) {
      expect(mensagemDoEnvioDeConfirmacao(erro(code, "provider secret raw error"))).toBe(
        "Não foi possível enviar o e-mail de confirmação. Use Reenviar e-mail para tentar novamente.",
      );
    }
  });

  it("a recusa do servidor chega como ele escreveu; o erro interno, não", () => {
    expect(mensagemDoConvite(erro("functions/failed-precondition", "Confirme seu e-mail antes de aceitar o convite."))).toBe(
      "Confirme seu e-mail antes de aceitar o convite.",
    );
    expect(mensagemDoConvite(erro("functions/permission-denied", "Este convite é de outro e-mail."))).toBe("Este convite é de outro e-mail.");
    expect(mensagemDoConvite(erro("functions/internal", "INTERNAL"))).toBe("Não foi possível aceitar o convite. Tente de novo.");
    expect(mensagemDoConvite(new Error("qualquer"))).toBe("Não foi possível aceitar o convite. Tente de novo.");
  });
});
