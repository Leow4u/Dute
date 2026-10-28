import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

// Sem o Firebase de verdade: a capa mostra o aviso de configuração só quando falta.
vi.mock("@/lib/firebase", () => ({ firebaseConfigError: null, firebaseAuth: null, firebaseApp: null, firestore: null }));

import type { ConviteLido } from "@/lib/convite";

import { ConviteView, type AcoesDoConvite, type TelaDoConvite } from "./convite";

const CONVITE: ConviteLido = {
  token: "3f9c2a7be1d04c58a6f1e2d3c4b5a69788aa",
  email: "ana.ribeiro@itau.com.br",
  nome: "Ana Ribeiro",
  role: "cliente",
  cliente: "Itaú Unibanco",
};

const NADA = () => undefined;
const ACOES: AcoesDoConvite = {
  nome: NADA,
  senha: NADA,
  aceitar: NADA,
  jaConfirmei: NADA,
  reenviar: NADA,
  sair: NADA,
  jaTenhoConta: NADA,
  voltarAoLogin: NADA,
  sairDaOutraConta: NADA,
  voltarAoSistema: NADA,
};

function render(estado: TelaDoConvite, extra: { erro?: string | null; ocupado?: boolean } = {}) {
  return renderToStaticMarkup(
    <ConviteView estado={estado} nome="Ana Ribeiro" senha="" erro={extra.erro ?? null} ocupado={extra.ocupado ?? false} acoes={ACOES} />,
  );
}

const RODAPE = /^© \d{4} Dutelog Soluções Logísticas$/;

describe("aceitar convite com o e-mail confirmado (pergunta 68)", () => {
  it("passo 1: o nome, o e-mail do convite só para ler, o perfil com o cliente e a senha", () => {
    const html = render({ tela: "formulario", convite: CONVITE });
    expect(html).toContain("Aceitar convite");
    expect(html).toMatch(/<input[^>]*id="convite-email"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*id="convite-email"/);
    expect(html).toContain('value="ana.ribeiro@itau.com.br"');
    expect(html).toContain("Perfil do convite: Cliente · Itaú Unibanco");
    expect(html).toMatch(/<input[^>]*type="password"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Aceitar convite<\/button>/);
    expect(
      textosForaDaLista(html, [
        "Aceitar convite",
        "Crie sua senha para acessar",
        "Nome",
        "E-mail",
        "Perfil do convite: Cliente · Itaú Unibanco",
        "Senha",
        "Já tenho conta",
        RODAPE,
      ]),
    ).toEqual([]);
  });

  it("passo 2: o link enviado para o e-mail, Já confirmei, Reenviar e-mail e Sair", () => {
    const html = render({ tela: "confirmar", convite: CONVITE, reenviado: false, enviado: true });
    expect(html).toContain("Confirme seu e-mail");
    expect(html).not.toContain("Link reenviado.");
    expect(
      textosForaDaLista(html, [
        "Confirme seu e-mail",
        "Enviamos um link para",
        "ana.ribeiro@itau.com.br",
        ".",
        "Já confirmei",
        "Reenviar e-mail",
        "Sair",
        RODAPE,
      ]),
    ).toEqual([]);

    const reenviado = render({ tela: "confirmar", convite: CONVITE, reenviado: true, enviado: true });
    expect(reenviado).toMatch(/<p role="status"[^>]*>Link reenviado\.<\/p>/);

    const semConfirmar = render({ tela: "confirmar", convite: CONVITE, reenviado: false, enviado: true }, { erro: "Seu e-mail ainda não foi confirmado. Abra o link que enviamos." });
    expect(semConfirmar).toContain('role="alert"');
    expect(semConfirmar).toContain("Seu e-mail ainda não foi confirmado. Abra o link que enviamos.");
  });

  it("envio ainda não confirmado mantém reenvio sem afirmar que enviou", () => {
    const html = render({ tela: "confirmar", convite: CONVITE, reenviado: false, enviado: false }, { erro: "Não foi possível enviar o e-mail de confirmação." });
    expect(html).toContain("Confirme o endereço");
    expect(html).not.toContain("Enviamos um link");
    expect(html).toContain("Reenviar e-mail");
    expect(html).toContain('role="alert"');
    expect(textosForaDaLista(html, ["Confirme seu e-mail", "Confirme o endereço", "ana.ribeiro@itau.com.br", ".", "Não foi possível enviar o e-mail de confirmação.", "Já confirmei", "Reenviar e-mail", "Sair", RODAPE])).toEqual([]);
  });

  it("passo 3: e-mail confirmado, o perfil e Entrar, um link que recarrega o app", () => {
    const html = render({ tela: "confirmado", convite: CONVITE });
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Entrar<\/a>/);
    expect(textosForaDaLista(html, ["E-mail confirmado", "Cliente · Itaú Unibanco", "Entrar", RODAPE])).toEqual([]);
  });

  it("o convite da equipe mostra o papel, sem cliente", () => {
    const html = render({ tela: "formulario", convite: { ...CONVITE, role: "interno", cliente: null, email: "rafa@dutelog.com.br" } });
    expect(html).toContain("Perfil do convite: Coordenação");
  });

  it("sem convite, a conta de outra pessoa e a leitura do convite", () => {
    expect(textosForaDaLista(render({ tela: "sem_convite", motivo: "invalido" }), ["Convite necessário", "Convite inválido ou não encontrado.", "Voltar para login", RODAPE])).toEqual([]);
    expect(render({ tela: "sem_convite", motivo: "sem_link" })).toContain("Este cadastro só funciona por link de convite.");
    expect(
      textosForaDaLista(render({ tela: "outra_conta", email: "joao@dutelog.com.br" }), [
        "Você já está conectado",
        "joao@dutelog.com.br",
        "Sair e continuar com o convite",
        "Voltar ao sistema",
        RODAPE,
      ]),
    ).toEqual([]);
    expect(textosForaDaLista(render({ tela: "carregando" }), ["Validando convite", "Conferindo seu convite...", RODAPE])).toEqual([]);
  });

  it("ocupado, o botão diz o que está fazendo e não aceita outro clique", () => {
    expect(render({ tela: "formulario", convite: CONVITE }, { ocupado: true })).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Aceitando...<\/button>/);
    expect(render({ tela: "confirmar", convite: CONVITE, reenviado: false, enviado: true }, { ocupado: true })).toContain("Conferindo...");
  });

  it("passa no axe (WCAG 2.1 A e AA) em cada passo", async () => {
    const telas: TelaDoConvite[] = [
      { tela: "formulario", convite: CONVITE },
      { tela: "confirmar", convite: CONVITE, reenviado: true, enviado: true },
      { tela: "confirmar", convite: CONVITE, reenviado: false, enviado: false },
      { tela: "confirmado", convite: CONVITE },
      { tela: "sem_convite", motivo: "invalido" },
      { tela: "outra_conta", email: "joao@dutelog.com.br" },
      { tela: "carregando" },
    ];
    for (const estado of telas) {
      expect(await violacoesDeAcessibilidade(render(estado, { erro: estado.tela === "formulario" ? "Use uma senha com pelo menos 6 caracteres." : null }))).toEqual([]);
    }
  });
});
