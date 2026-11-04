import { contactHref, serviceHref, services, type Service } from "../content";
import {
  Arrow,
  ArticleCard,
  Breadcrumbs,
  Button,
  ClosingCta,
  Faq,
  Journal,
  Photo,
  ServiceRows,
  TextLink,
} from "../components/ui";
import { useArticles } from "../blog/catalog";

const corporateServices = services.filter(
  (service) => service.group === "corporativa",
);
const transportServices = services.filter(
  (service) => service.group === "transporte",
);

export function SolutionsPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: "Soluções" }]} />
      <section className="page-intro container">
        <h1>
          Seu próximo movimento.
          <br />
          <span className="muted-word">Nossa conexão.</span>
        </h1>
        <div className="intro-bottom">
          <p>
            Três frentes de atuação. Um ponto de partida:
            <br /> o que a sua empresa precisa agora.
          </p>
          <a
            href="#solucoes"
            className="circle-link"
            aria-label="Explorar soluções"
          >
            <Arrow />
          </a>
        </div>
      </section>
      <section id="solucoes" className="container solutions-index">
        <a className="featured-solution" href="/logistica-corporativa/">
          <Photo
            name="corporate"
            alt="Cena ilustrativa de Logística Corporativa"
            eager
          />
          <div>
            <span>01 · Nossa especialidade em destaque</span>
            <h2>
              Logística
              <br /> Corporativa
            </h2>
            <p>
              Espaços que mudam. Bens que precisam de atenção.
              <br /> Sete soluções para a transformação da sua operação.
            </p>
            <strong>
              Explorar soluções <Arrow diagonal />
            </strong>
          </div>
        </a>
        <div className="solution-pair">
          <a className="solution-photo" href="/transporte-de-cargas/">
            <Photo
              name="transport"
              alt="Cena ilustrativa de transporte de cargas"
            />
            <div>
              <small>02 · Dedicado e Fracionado</small>
              <h3>Transporte de Cargas</h3>
              <span>
                <Arrow diagonal />
              </span>
            </div>
          </a>
          <a className="solution-photo" href={serviceHref("armazenagem")}>
            <Photo name="storage" alt="Cena ilustrativa de armazenagem" />
            <div>
              <small>03 · Espaço para cada fase</small>
              <h3>Armazenagem</h3>
              <span>
                <Arrow diagonal />
              </span>
            </div>
          </a>
        </div>
      </section>
      <ClosingCta
        title={
          <>
            Não sabe por
            <br /> onde começar?
          </>
        }
        description={
          <>
            Conte o que precisa mudar.
            <br /> Vamos encontrar o ponto de partida.
          </>
        }
      />
    </>
  );
}

export function CorporatePage() {
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Soluções", href: "/solucoes/" },
          { label: "Logística Corporativa" },
        ]}
      />
      <section className="corporate-hero container">
        <div>
          <h1>
            O espaço muda.
            <br /> A empresa
            <br />
            <em>segue em frente.</em>
          </h1>
          <p>
            Logística Corporativa para conectar mudanças, bens, tecnologia e
            novos ambientes.
          </p>
          <Button href={contactHref("logistica-corporativa")}>
            Conversar sobre meu projeto
          </Button>
        </div>
        <div className="corporate-frame">
          <Photo
            name="corporate"
            alt="Cena ilustrativa de movimentação em escritório"
            eager
          />
          <span className="photo-caption">Logística Corporativa · Dutelog</span>
        </div>
      </section>
      <section className="section services-directory" id="especialidades">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-label">
                Sete especialidades. Muitas conexões.
              </span>
              <h2>
                O que precisa
                <br /> mudar de lugar?
              </h2>
            </div>
            <p>
              Explore cada solução.
              <br /> Combine o que faz sentido para a sua operação.
            </p>
          </div>
          <ServiceRows items={corporateServices} />
        </div>
      </section>
      <section className="dark-feature">
        <div className="container dark-feature-grid">
          <Photo name="detail" alt="Cena ilustrativa de inventário" />
          <div>
            <span className="section-label">Antes de movimentar</span>
            <h2>
              Conhecer cada item
              <br /> muda o projeto inteiro.
            </h2>
            <p>
              O inventário conecta o que existe hoje ao destino de cada bem. Uma
              base para planejar mudanças, remanejamentos e gestão de
              mobiliário.
            </p>
            <Button href={serviceHref("inventario")} variant="white">
              Conhecer Inventário
            </Button>
          </div>
        </div>
      </section>
      <Journal />
      <ClosingCta href={contactHref("logistica-corporativa")} />
    </>
  );
}

const relatedArticleSlugs: Record<string, string> = {
  "gestao-de-mobiliario": "armazenagem-de-mobiliario",
  "montagem-e-desmontagem": "checklist-mudanca-corporativa",
  "mudancas-industriais": "inventario-antes-da-mudanca",
  "transporte-fracionado": "dedicado-ou-fracionado",
};

function ScopeItems({
  items,
  reveal = false,
}: {
  items: Service["scope"];
  reveal?: boolean;
}) {
  return (
    <div className="scope-items">
      {items.map((item, index) => (
        <article
          className={`scope-item${reveal ? " reveal" : ""}`}
          key={item.title}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  );
}

export function ServicePage({ service }: { service: Service }) {
  const articles = useArticles();
  const corporate = service.group === "corporativa";
  const hubHref = corporate
    ? "/logistica-corporativa/"
    : "/transporte-de-cargas/";
  const hubName = corporate ? "Logística Corporativa" : "Transporte de Cargas";
  const relatedServices = service.related.flatMap((slug) => {
    const related = services.find((item) => item.slug === slug);
    return related ? [related] : [];
  });
  const suggestedArticle = articles.find(
    (article) =>
      article.service === service.slug ||
      article.slug === relatedArticleSlugs[service.slug],
  );

  return (
    <>
      <Breadcrumbs
        items={[{ label: hubName, href: hubHref }, { label: service.title }]}
      />
      <section className="service-hero container">
        <div className="service-hero-top">
          <div>
            <span className="section-label">{service.title}</span>
            <h1>{service.headline}</h1>
          </div>
          <div>
            <p>{service.intro}</p>
            <Button href={contactHref(service.slug)}>
              Planejar este projeto
            </Button>
          </div>
        </div>
        <div className="service-panorama">
          <Photo
            name={service.image}
            alt={`Cena ilustrativa de ${service.title}`}
            eager
          />
          <div className="panorama-caption">
            <span>{hubName}</span>
            <span>{service.title}</span>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container scope-grid">
          <div className="scope-intro">
            <span className="section-label">Quando faz sentido</span>
            <h2>
              Encontre o seu
              <br /> cenário aqui.
            </h2>
            <ul className="scenario-list">
              {service.situations.map((situation) => (
                <li key={situation}>{situation}</li>
              ))}
            </ul>
          </div>
          <ScopeItems items={service.scope} reveal />
        </div>
      </section>
      <section className="service-process">
        <div className="container">
          <div className="section-heading">
            <h2>
              Uma conversa que
              <br /> vira um plano.
            </h2>
            <p>
              O escopo é construído a partir
              <br /> das particularidades do seu projeto.
            </p>
          </div>
          <div className="process-grid">
            {service.steps.map((step, index) => (
              <article key={step.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <Faq items={service.faq} />
      <section className="section related-services">
        <div className="container">
          <div className="section-heading">
            <h2>Conecte outras soluções.</h2>
            <TextLink href="/solucoes/">Ver todas</TextLink>
          </div>
          <ServiceRows items={relatedServices} />
        </div>
      </section>
      {suggestedArticle && (
        <section className="section article-suggestion">
          <div className="container">
            <span className="section-label">Para planejar melhor</span>
            <ArticleCard article={suggestedArticle} compact />
          </div>
        </section>
      )}
      <ClosingCta href={contactHref(service.slug)} />
    </>
  );
}

export function TransportPage() {
  const articles = useArticles();
  const reading = [
    ...articles.filter(
      (article) => article.category === "Transporte de Cargas",
    ),
    ...articles.filter(
      (article) => article.category !== "Transporte de Cargas",
    ),
  ].slice(0, 3);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Soluções", href: "/solucoes/" },
          { label: "Transporte de Cargas" },
        ]}
      />
      <section className="transport-hero">
        <div className="container">
          <h1>
            Entre a origem
            <br /> e o destino,
            <br />
            <em>o seu negócio.</em>
          </h1>
          <p>
            Transporte Dedicado e Fracionado.
            <br /> Encontre o formato que acompanha a sua carga.
          </p>
          <Button href={contactHref("transporte-de-cargas")}>
            Planejar um transporte
          </Button>
        </div>
        <Photo
          name="transport"
          alt="Cena ilustrativa de transporte de cargas"
          eager
        />
      </section>
      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>
              Uma carga.
              <br /> Dois caminhos.
            </h2>
            <p>
              A escolha começa pelo perfil do envio,
              <br /> pelo volume e pelas condições da operação.
            </p>
          </div>
          <div className="transport-comparison">
            {transportServices.map((service, index) => (
              <a href={serviceHref(service.slug)} key={service.slug}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{service.title}</h3>
                <p>{service.intro}</p>
                <strong>
                  Entender esta modalidade <Arrow />
                </strong>
              </a>
            ))}
          </div>
        </div>
      </section>
      <Journal items={reading} />
      <ClosingCta href={contactHref("transporte-de-cargas")} />
    </>
  );
}

const storageScope = [
  {
    title: "Entender os itens",
    text: "Características, quantidades, dimensões e condições de acondicionamento orientam a avaliação.",
  },
  {
    title: "Organizar a guarda",
    text: "Identificação, relação de bens e critérios de movimentação precisam estar definidos no escopo.",
  },
  {
    title: "Conectar o próximo destino",
    text: "Planeje como solicitar a retirada e quais etapas de transporte ou remanejamento serão necessárias.",
  },
];
const storageFaq = [
  {
    q: "O que preciso informar para avaliar a armazenagem?",
    a: "Relação dos bens, quantidades, dimensões aproximadas, condições de embalagem e período desejado. Itens com necessidades especiais precisam ser avaliados previamente.",
  },
  {
    q: "Posso conectar armazenagem e transporte?",
    a: "Apresente a origem, o destino previsto e as etapas que deseja incluir. A combinação de serviços deve constar no escopo da proposta.",
  },
  {
    q: "Como funciona a retirada dos itens?",
    a: "As condições de acesso, solicitação e retirada precisam ser combinadas conforme o projeto. Informe a frequência esperada de movimentação.",
  },
];

export function StoragePage() {
  const articles = useArticles();
  const reading = [
    ...articles.filter((article) => article.category === "Armazenagem"),
    ...articles.filter((article) => article.category !== "Armazenagem"),
  ].slice(0, 3);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Soluções", href: "/solucoes/" },
          { label: "Armazenagem" },
        ]}
      />
      <section className="storage-hero container">
        <div>
          <h1>
            Espaço para
            <br />
            <em>o que vem depois.</em>
          </h1>
          <p>
            Entre uma mudança e outra, entre o uso e o próximo destino.
            Armazenagem conectada ao momento da sua empresa.
          </p>
          <Button href={contactHref("armazenagem")}>
            Conversar sobre armazenagem
          </Button>
        </div>
        <div className="storage-photo">
          <Photo name="storage" alt="Cena ilustrativa de armazenagem" eager />
        </div>
      </section>
      <section className="section">
        <div className="container scope-grid">
          <div>
            <span className="section-label">Mais que guardar</span>
            <h2>
              O espaço é só
              <br /> o começo.
            </h2>
            <p className="body-large">
              O projeto considera os bens, o período de guarda e a forma como
              eles precisam voltar à operação.
            </p>
          </div>
          <ScopeItems items={storageScope} />
        </div>
      </section>
      <section className="dark-feature">
        <div className="container dark-feature-grid">
          <Photo name="detail" alt="Detalhe ilustrativo de identificação" />
          <div>
            <span className="section-label">Soluções que se conectam</span>
            <h2>
              Guardar começa
              <br /> por saber o que existe.
            </h2>
            <p>
              Conecte a armazenagem ao inventário e à gestão de mobiliário para
              organizar informações e decisões.
            </p>
            <Button href={serviceHref("gestao-de-mobiliario")} variant="white">
              Explorar gestão de mobiliário
            </Button>
          </div>
        </div>
      </section>
      <Faq items={storageFaq} />
      <Journal items={reading} />
      <ClosingCta href={contactHref("armazenagem")} />
    </>
  );
}
