import serviceData from "../content/services.json" with { type: "json" };

export const contactOptions = [
  {
    value: "logistica-corporativa",
    label: "Logística Corporativa — quero orientação",
  },
  ...serviceData.map((service) => ({
    value: service.slug,
    label: service.title,
  })),
  {
    value: "transporte-de-cargas",
    label: "Transporte de Cargas — quero orientação",
  },
  { value: "armazenagem", label: "Armazenagem" },
];

export const contactLimits = {
  nome: 80,
  empresa: 120,
  email: 254,
  telefone: 32,
  mensagem: 1200,
};
export type ContactValues = {
  nome: string;
  empresa: string;
  email: string;
  telefone: string;
  servico: string;
  mensagem: string;
};
export type ContactErrors = Partial<Record<keyof ContactValues, string>>;
export type PreparedContact =
  | {
      ok: true;
      values: ContactValues;
      email: { subject: string; body: string; href: string };
    }
  | { ok: false; errors: ContactErrors };

export function parseContactService(search: string): string {
  const value = new URLSearchParams(search).get("servico");
  return contactOptions.some((option) => option.value === value) ? value! : "";
}

export function prepareContactEmail(
  input: ContactValues,
  recipient: string,
): PreparedContact {
  const values: ContactValues = {
    nome: input.nome.trim(),
    empresa: input.empresa.trim(),
    email: input.email.trim(),
    telefone: input.telefone.trim(),
    servico: input.servico.trim(),
    mensagem: input.mensagem.trim(),
  };
  const errors: ContactErrors = {};
  const labels = {
    nome: "Seu nome",
    empresa: "Empresa",
    email: "E-mail corporativo",
    telefone: "Telefone",
    mensagem: "Sua mensagem",
  };
  for (const field of Object.keys(
    contactLimits,
  ) as (keyof typeof contactLimits)[]) {
    if (field !== "telefone" && !values[field])
      errors[field] = "Preencha este campo.";
    else if (values[field].length > contactLimits[field])
      errors[field] =
        `${labels[field]} deve ter até ${contactLimits[field]} caracteres.`;
    else if (
      field !== "mensagem" &&
      /[\r\n\u0000-\u001f\u007f]/.test(values[field])
    )
      errors[field] = "Use apenas uma linha neste campo.";
  }
  // Matches the native email input grammar, including plus-addressed mailboxes.
  const emailPattern =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!errors.email && !emailPattern.test(values.email))
    errors.email = "Informe um endereço de e-mail válido.";
  if (!errors.mensagem && values.mensagem.length < 10)
    errors.mensagem = "Conte um pouco mais: escreva pelo menos 10 caracteres.";
  const service = contactOptions.find(
    (option) => option.value === values.servico,
  );
  if (!service) errors.servico = "Selecione uma das soluções disponíveis.";
  if (Object.keys(errors).length || !service) return { ok: false, errors };

  const subject = `Projeto — ${service.label} | ${values.empresa}`;
  const body = [
    "Olá, equipe Dutelog!",
    "",
    "Gostaria de conversar sobre o seguinte projeto:",
    "",
    `Nome: ${values.nome}`,
    `Empresa: ${values.empresa}`,
    `E-mail: ${values.email}`,
    `Telefone: ${values.telefone || "Não informado"}`,
    `Solução: ${service.label}`,
    "",
    "Necessidade:",
    values.mensagem.replace(/\r\n|\r|\n/g, "\r\n"),
  ].join("\r\n");
  return {
    ok: true,
    values,
    email: {
      subject,
      body,
      href: `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    },
  };
}
