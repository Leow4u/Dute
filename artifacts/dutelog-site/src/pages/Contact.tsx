import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Arrow, Breadcrumbs, Photo, TextLink } from "../components/ui";
import { company } from "../content";
import {
  contactLimits,
  contactOptions,
  parseContactService,
  prepareContactEmail,
  type ContactErrors,
  type ContactValues,
  type PreparedContact,
} from "../lib/contact";

const initialValues: ContactValues = {
  nome: "",
  empresa: "",
  email: "",
  telefone: "",
  servico: "",
  mensagem: "",
};
type Review = Extract<PreparedContact, { ok: true }>;

export function ContactPage() {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [review, setReview] = useState<Review | null>(null);
  const [ready, setReady] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [showCopyText, setShowCopyText] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const copyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValues((current) => ({
      ...current,
      servico: parseContactService(window.location.search),
    }));
    setReady(true);
  }, []);

  useEffect(() => {
    if (review) reviewHeadingRef.current?.focus();
  }, [review]);

  useEffect(() => {
    if (showCopyText) {
      copyRef.current?.focus();
      copyRef.current?.select();
    }
  }, [showCopyText]);

  function update(
    event: ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    const field = event.currentTarget.name as keyof ContactValues;
    const value = event.currentTarget.value;
    event.currentTarget.setCustomValidity("");
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prepared = prepareContactEmail(values, company.email);
    if (!prepared.ok) {
      setErrors(prepared.errors);
      const firstField = Object.keys(prepared.errors)[0] as keyof ContactValues;
      const input = formRef.current?.elements.namedItem(firstField) as
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (input) {
        input.setCustomValidity(
          prepared.errors[firstField] || "Confira este campo.",
        );
        input.reportValidity();
      }
      return;
    }
    setErrors({});
    setValues(prepared.values);
    setReview(prepared);
  }

  function edit() {
    setReview(null);
    setCopyStatus("");
    setShowCopyText(false);
    setHandoff(false);
    requestAnimationFrame(() =>
      (
        formRef.current?.elements.namedItem("nome") as HTMLInputElement | null
      )?.focus(),
    );
  }

  async function copyMessage() {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(
        `Para: ${company.email}\nAssunto: ${review.email.subject}\n\n${review.email.body}`,
      );
      setCopyStatus(
        "Mensagem copiada. Cole no seu e-mail e envie para a Dutelog.",
      );
    } catch {
      setShowCopyText(true);
      setCopyStatus("Copie o texto abaixo e cole no seu e-mail para enviar.");
    }
  }

  const selectedService = review
    ? contactOptions.find((option) => option.value === review.values.servico)
        ?.label
    : "";
  const summary = review
    ? [
        ["Nome", review.values.nome],
        ["Empresa", review.values.empresa],
        ["E-mail corporativo", review.values.email],
        ["Telefone", review.values.telefone || "Não informado"],
        ["Solução", selectedService],
        ["Necessidade", review.values.mensagem],
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Contato" }]} />
      <section className="contact-section container">
        <div className="contact-intro">
          <h1>
            Vamos planejar
            <br />o seu próximo
            <br />
            <em>movimento.</em>
          </h1>
          <p>
            Conte o que está mudando.
            <br />A conversa começa pelo seu cenário.
          </p>
          <div className="contact-steps">
            <div>
              <span>01</span>
              <p>
                Você compartilha
                <br />
                sua necessidade.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                Conversamos sobre
                <br />o escopo do projeto.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                Definimos os
                <br />
                próximos passos.
              </p>
            </div>
          </div>
          <div className="contact-photo">
            <Photo
              name="detail"
              alt="Cena ilustrativa de organização de equipamentos"
            />
          </div>
          <div className="contact-channels" aria-label="Canais de contato">
            <p className="form-note">Prefere conversar diretamente?</p>
            <TextLink href={`mailto:${company.email}`}>
              {company.email}
            </TextLink>
            <br />
            <TextLink href={company.phoneHref}>{company.phone}</TextLink>
            <p className="form-note">
              Já é cliente? <a href={company.portal}>Acesse o portal Dutelog</a>
              .
            </p>
          </div>
        </div>
        <div className="contact-form-wrap">
          <noscript>
            <p>
              Para preparar sua mensagem nesta página, ative o JavaScript. Você
              também pode escrever para{" "}
              <a href={`mailto:${company.email}`}>{company.email}</a> ou ligar
              para <a href={company.phoneHref}>{company.phone}</a>.
            </p>
          </noscript>
          <form id="project-form" ref={formRef} onSubmit={submit}>
            <div id="form-step-1" hidden={review !== null}>
              <div className="form-heading">
                <span>01 / 02</span>
                <h2>Conte sobre seu projeto.</h2>
                <p>Os campos com * são obrigatórios.</p>
              </div>
              <fieldset
                disabled={!ready}
                style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
              >
                <div className="form-row">
                  <label>
                    Seu nome *
                    <input
                      name="nome"
                      autoComplete="name"
                      required
                      maxLength={contactLimits.nome}
                      value={values.nome}
                      onChange={update}
                      aria-invalid={!!errors.nome}
                      placeholder="Como podemos chamar você?"
                    />
                  </label>
                  <label>
                    Empresa *
                    <input
                      name="empresa"
                      autoComplete="organization"
                      required
                      maxLength={contactLimits.empresa}
                      value={values.empresa}
                      onChange={update}
                      aria-invalid={!!errors.empresa}
                      placeholder="Nome da empresa"
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    E-mail corporativo *
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={contactLimits.email}
                      value={values.email}
                      onChange={update}
                      aria-invalid={!!errors.email}
                      placeholder="voce@empresa.com.br"
                    />
                  </label>
                  <label>
                    Telefone <span>(opcional)</span>
                    <input
                      name="telefone"
                      type="tel"
                      autoComplete="tel"
                      maxLength={contactLimits.telefone}
                      value={values.telefone}
                      onChange={update}
                      aria-invalid={!!errors.telefone}
                      placeholder="DDD + número"
                    />
                  </label>
                </div>
                <label>
                  Qual solução você procura? *
                  <select
                    name="servico"
                    required
                    value={values.servico}
                    onChange={update}
                    aria-invalid={!!errors.servico}
                  >
                    <option value="">Selecione uma solução</option>
                    {contactOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  O que sua empresa precisa? *
                  <textarea
                    name="mensagem"
                    rows={5}
                    required
                    minLength={10}
                    maxLength={contactLimits.mensagem}
                    value={values.mensagem}
                    onChange={update}
                    aria-invalid={!!errors.mensagem}
                    aria-describedby="message-limit"
                    placeholder="Conte sobre os locais, os itens, a data desejada e o que precisa mudar."
                  />
                </label>
                <p className="form-note" id="message-limit">
                  De 10 a {contactLimits.mensagem} caracteres. Se precisar,
                  inclua mais detalhes no e-mail.
                </p>
                <p className="form-note">
                  Você revisará a mensagem e continuará no seu aplicativo de
                  e-mail para enviá-la. Os dados ficam apenas nesta página até
                  você escolher continuar.
                </p>
                <button type="submit" className="button button-red">
                  <span>Revisar solicitação</span>
                  <Arrow />
                </button>
              </fieldset>
            </div>
            {review ? (
              <div id="form-step-2">
                <div className="form-heading">
                  <span>02 / 02</span>
                  <h2 ref={reviewHeadingRef} tabIndex={-1}>
                    Seu próximo movimento.
                  </h2>
                  <p>Confira as informações antes de continuar por e-mail.</p>
                </div>
                <dl id="project-summary">
                  {summary.map(([label, value]) => (
                    <div className="summary-row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="form-note" id="email-handoff-note">
                  O próximo passo abre seu aplicativo de e-mail com a mensagem
                  preparada para <strong>{company.email}</strong>. Você precisa
                  clicar em enviar no aplicativo para concluir o contato.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={edit}
                  >
                    Voltar e editar
                  </button>
                  <a
                    className="button button-red"
                    href={review.email.href}
                    aria-describedby="email-handoff-note"
                    onClick={() => setHandoff(true)}
                  >
                    <span>Continuar por e-mail</span>
                    <Arrow />
                  </a>
                </div>
                {handoff ? (
                  <p className="form-note" role="status">
                    Se o aplicativo abriu, confira a mensagem e clique em enviar
                    por lá. Esta página não confirma o envio. Se não abriu,
                    copie a mensagem abaixo.
                  </p>
                ) : null}
                <p className="form-note">
                  Usa webmail ou o aplicativo não abriu?
                </p>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={copyMessage}
                >
                  <span>Copiar mensagem</span>
                  <Arrow />
                </button>
                <p className="form-note" role="status">
                  {copyStatus}
                </p>
                {showCopyText ? (
                  <label>
                    Mensagem para copiar
                    <textarea
                      ref={copyRef}
                      readOnly
                      rows={10}
                      value={`Para: ${company.email}\nAssunto: ${review.email.subject}\n\n${review.email.body}`}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </form>
        </div>
      </section>
    </>
  );
}
