import assert from "node:assert/strict";
import test from "node:test";
import {
  contactOptions,
  parseContactService,
  prepareContactEmail,
} from "../src/lib/contact.ts";

const recipient = "comercial@dutelog.com.br";
const valid = {
  nome: "Ana Silva",
  empresa: "Empresa Exemplo",
  email: "ana@example.com",
  telefone: "",
  servico: "mudanca-corporativa",
  mensagem: "Mudança de escritório em São Paulo.",
};

test("prepares a readable message with trimmed fields and the actual service title", () => {
  const result = prepareContactEmail(
    {
      ...valid,
      nome: "  Ana Silva  ",
      empresa: " Empresa Exemplo ",
      mensagem: " Mudança de escritório em São Paulo. \n",
    },
    recipient,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.nome, "Ana Silva");
  assert.equal(
    result.email.subject,
    "Projeto — Mudança Corporativa | Empresa Exemplo",
  );
  assert.equal(
    result.email.body,
    "Olá, equipe Dutelog!\r\n\r\nGostaria de conversar sobre o seguinte projeto:\r\n\r\nNome: Ana Silva\r\nEmpresa: Empresa Exemplo\r\nE-mail: ana@example.com\r\nTelefone: Não informado\r\nSolução: Mudança Corporativa\r\n\r\nNecessidade:\r\nMudança de escritório em São Paulo.",
  );
});

test("encodes special characters without creating additional mail headers", () => {
  const result = prepareContactEmail(
    {
      ...valid,
      nome: "João & Ana",
      empresa: "A+B & C? #1",
      email: "ana+projeto@example.com",
      mensagem:
        "Itens: 50% mesas & cadeiras?\nDestino: São Paulo #2\n&bcc=intruso@example.com",
    },
    recipient,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const url = new URL(result.email.href);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, recipient);
  assert.deepEqual([...url.searchParams.keys()], ["subject", "body"]);
  assert.equal(
    url.searchParams.get("subject"),
    "Projeto — Mudança Corporativa | A+B & C? #1",
  );
  assert.match(
    url.searchParams.get("body")!,
    /E-mail: ana\+projeto@example\.com/,
  );
  assert.match(
    url.searchParams.get("body")!,
    /50% mesas & cadeiras\?\r\nDestino: São Paulo #2\r\n&bcc=intruso@example\.com$/,
  );
  assert.equal(url.hash, "");
});

test("accepts only real options when preselecting a service from the URL", () => {
  for (const option of contactOptions) {
    assert.equal(
      parseContactService(`?servico=${encodeURIComponent(option.value)}`),
      option.value,
    );
  }
  assert.equal(parseContactService("?servico=armazenagem"), "armazenagem");
  assert.equal(parseContactService("?servico=servico-inexistente"), "");
  assert.equal(parseContactService("?servico=%3Cscript%3E"), "");
  assert.equal(parseContactService("?outro=mudanca-corporativa"), "");
  assert.equal(parseContactService(""), "");
});

test("rejects unknown service submissions as well as unknown URL values", () => {
  const result = prepareContactEmail(
    { ...valid, servico: "frete-inventado" },
    recipient,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.servico);
});

test("rejects required values containing only whitespace", () => {
  for (const field of [
    "nome",
    "empresa",
    "email",
    "servico",
    "mensagem",
  ] as const) {
    const result = prepareContactEmail(
      { ...valid, [field]: "  \t  " },
      recipient,
    );
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.ok(result.errors[field], field);
  }
});

test("rejects malformed email and line breaks in single-line fields", () => {
  for (const email of [
    "ana",
    "ana@@example.com",
    "ana @example.com",
    "ana<>@example.com",
  ]) {
    const result = prepareContactEmail({ ...valid, email }, recipient);
    assert.equal(result.ok, false, email);
    if (!result.ok) assert.ok(result.errors.email);
  }
  for (const field of ["nome", "empresa", "email", "telefone"] as const) {
    const result = prepareContactEmail(
      { ...valid, [field]: "abc\r\nBcc: other@example.com" },
      recipient,
    );
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.ok(result.errors[field]);
  }
});

test("enforces field limits and a meaningful trimmed message length", () => {
  const boundaries = {
    nome: 80,
    empresa: 120,
    email: 254,
    telefone: 32,
    mensagem: 1200,
  };
  for (const [field, limit] of Object.entries(boundaries)) {
    const result = prepareContactEmail(
      { ...valid, [field]: "a".repeat(limit + 1) },
      recipient,
    );
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.ok(result.errors[field as keyof typeof boundaries]);
  }
  const tooShort = prepareContactEmail(
    { ...valid, mensagem: "   123456789   " },
    recipient,
  );
  assert.equal(tooShort.ok, false);
  if (!tooShort.ok) assert.ok(tooShort.errors.mensagem);
  const boundary = prepareContactEmail(
    {
      ...valid,
      nome: "a".repeat(80),
      empresa: "b".repeat(120),
      telefone: "+55 (11) 91234-5678",
      mensagem: "m".repeat(1200),
    },
    recipient,
  );
  assert.equal(boundary.ok, true);
});

test("keeps the optional phone out of validation when empty and includes it when provided", () => {
  const empty = prepareContactEmail({ ...valid, telefone: "   " }, recipient);
  assert.equal(empty.ok, true);
  const filled = prepareContactEmail(
    { ...valid, telefone: "  +55 (11) 91234-5678  " },
    recipient,
  );
  assert.equal(filled.ok, true);
  if (filled.ok)
    assert.match(filled.email.body, /Telefone: \+55 \(11\) 91234-5678\r\n/);
});
