import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confirmacaoEmailHtml } from "./convite-email-template.js";

describe("template de confirmação do e-mail", () => {
  it("mostra a confirmação com o logo oficial e o mesmo link Firebase no botão e na alternativa", () => {
    const link = "https://dute-prod.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=exemplo&lang=pt-BR";
    const html = confirmacaoEmailHtml({ nome: "Ana", email: "ana@example.com", link });
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

    assert.deepEqual(links, [link.replaceAll("&", "&amp;"), link.replaceAll("&", "&amp;")]);
    assert.match(html, /<title>Confirme seu e-mail · Dutelog<\/title>/);
    assert.match(html, />Confirmar e-mail<\/a>/);
    assert.match(html, /<img src="https:\/\/app\.dutelog\.com\.br\/dutelog-logo\.png"/);
    assert.match(html, /Depois de confirmar, volte à tela do convite para concluir seu acesso\./);
    assert.match(html, /Este link é pessoal\. Não compartilhe\./);
    assert.doesNotMatch(html, /Aceitar convite|definir sua senha|Você foi convidado/);
  });

  it("escapa nome, e-mail e link sem permitir marcação ou atributos injetados", () => {
    const html = confirmacaoEmailHtml({
      nome: '<img src=x onerror="alert(1)"> & Ana',
      email: 'ana"<script>alert(1)</script>@example.com',
      link: 'https://example.com/?value=" onmouseover="alert(1)&next=\'teste\'',
    });

    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; Ana/);
    assert.match(html, /ana&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;@example\.com/);
    assert.match(html, /value=&quot; onmouseover=&quot;alert\(1\)&amp;next=&#39;teste&#39;/);
    assert.equal(html.match(/<img\b/g)?.length, 1, "somente o logo oficial vira uma imagem");
    assert.doesNotMatch(html, /<script>|<img src=x|href="[^"]*" onmouseover=/);
  });

  it("usa uma saudação natural quando a conta ainda não tem nome", () => {
    const html = confirmacaoEmailHtml({ nome: "", email: "ana@example.com", link: "https://example.com/confirmar" });
    assert.match(html, />Olá\.<\/p>/);
    assert.doesNotMatch(html, /Olá, \./);
  });
});
