import type { ReactNode } from "react";
import {
  articles,
  articleHref,
  serviceHref,
  type Article,
  type ImageName,
  type Service,
} from "../content";

export function Arrow({
  diagonal = false,
  className = "",
}: {
  diagonal?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h15M13 5l7 7-7 7"} />
    </svg>
  );
}
export function Photo({
  name,
  alt,
  className = "",
  eager = false,
}: {
  name: ImageName;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <img
      className={className}
      src={`/images/${name}.webp`}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      width={name === "corporate" ? 1672 : 1536}
      height={name === "corporate" ? 941 : 1024}
    />
  );
}
export function Button({
  children,
  href,
  variant = "red",
}: {
  children: ReactNode;
  href: string;
  variant?: "red" | "black" | "outline" | "white";
}) {
  return (
    <a className={`button button-${variant}`} href={href}>
      <span>{children}</span>
      <Arrow />
    </a>
  );
}
export function TextLink({
  children,
  href,
  className = "text-link",
}: {
  children: ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <a className={className} href={href}>
      <span>{children}</span>
      <Arrow />
    </a>
  );
}
export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="breadcrumbs" aria-label="Caminho da página">
      <a href="/">Início</a>
      {items.map((item, index) => (
        <span className="breadcrumb-item" key={index}>
          <span aria-hidden="true">/</span>
          {item.href ? (
            <a href={item.href}>{item.label}</a>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
export function ClosingCta({
  title = (
    <>
      Qual é o próximo
      <br /> movimento?
    </>
  ),
  description = (
    <>
      Uma mudança, um novo espaço, uma operação.
      <br /> Vamos entender o que a sua empresa precisa.
    </>
  ),
  href = "/contato/",
}: {
  title?: ReactNode;
  description?: ReactNode;
  href?: string;
}) {
  return (
    <section className="closing-cta">
      <div className="container closing-grid">
        <h2 className="reveal">{title}</h2>
        <div>
          <p>{description}</p>
          <Button href={href} variant="black">
            Conversar sobre um projeto
          </Button>
        </div>
      </div>
    </section>
  );
}
export function ArticleCard({
  article,
  compact = false,
}: {
  article: Article;
  compact?: boolean;
}) {
  return (
    <article className={`article-card ${compact ? "compact" : ""}`}>
      <a className="article-image" href={articleHref(article.slug)}>
        <Photo
          name={article.image}
          alt={`Cena ilustrativa de ${article.category.toLocaleLowerCase("pt-BR")}`}
        />
        <span className="image-arrow">
          <Arrow diagonal />
        </span>
      </a>
      <div className="article-copy">
        <div className="meta">
          <a href={`/blog/?categoria=${encodeURIComponent(article.category)}`}>
            {article.category}
          </a>
          <span>{article.readTime} de leitura</span>
        </div>
        <h3>
          <a href={articleHref(article.slug)}>{article.title}</a>
        </h3>
        <p>{article.excerpt}</p>
        <TextLink href={articleHref(article.slug)}>Ler artigo</TextLink>
      </div>
    </article>
  );
}
export function Journal({
  items = articles.slice(0, 3),
}: {
  items?: Article[];
}) {
  if (!items.length) return null;
  return (
    <section className="section journal">
      <div className="container">
        <div className="section-heading">
          <div>
            <span className="section-label">Blog Dutelog</span>
            <h2>
              Ideias que colocam
              <br /> sua empresa em movimento.
            </h2>
          </div>
          <TextLink href="/blog/">Todos os artigos</TextLink>
        </div>
        <div className="journal-layout">
          <ArticleCard article={items[0]} />
          <div className="journal-side">
            {items.slice(1, 3).map((article) => (
              <ArticleCard key={article.slug} article={article} compact />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
export function ServiceRows({ items }: { items: Service[] }) {
  return (
    <div className="service-list">
      {items.map((service, i) => (
        <a
          className="service-row reveal"
          href={serviceHref(service.slug)}
          key={service.slug}
        >
          <span className="row-number">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <h3>{service.title}</h3>
            <p>{service.short}</p>
          </div>
          <span className="row-arrow">
            <Arrow diagonal />
          </span>
        </a>
      ))}
    </div>
  );
}
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <section className="section faq-section">
      <div className="container faq-grid">
        <div>
          <span className="section-label">Antes do próximo passo</span>
          <h2>
            Perguntas
            <br /> que ajudam.
          </h2>
          <p>
            Detalhes fazem diferença.
            <br /> Converse sobre o seu cenário.
          </p>
        </div>
        <div>
          {items.map((item) => (
            <details className="faq" key={item.q}>
              <summary>
                {item.q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
