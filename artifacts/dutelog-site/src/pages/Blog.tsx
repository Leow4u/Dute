import { useEffect, useRef, useState } from "react";
import {
  categories,
  filterArticles,
  serviceHref,
  type Article,
} from "../content";
import {
  Arrow,
  ArticleCard,
  ArticlePhoto,
  Breadcrumbs,
  Button,
  ClosingCta,
  TextLink,
} from "../components/ui";
import { RichText, richHeadings } from "../blog/RichText";
import { useArticles } from "../blog/catalog";

function readFilters() {
  const parameters = new URLSearchParams(window.location.search);
  const requestedCategory = parameters.get("categoria") ?? "Todos";
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  return {
    category:
      categories.find(
        (category) => normalize(category) === normalize(requestedCategory),
      ) ?? "Todos",
    query: parameters.get("q") ?? "",
  };
}

function updateFilterUrl(category: string, query: string) {
  const url = new URL(window.location.href);
  if (category === "Todos") url.searchParams.delete("categoria");
  else url.searchParams.set("categoria", category);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function BlogPage() {
  const articles = useArticles();
  // URL state is read after hydration so the server and initial client markup agree.
  const [category, setCategory] = useState("Todos");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const syncFilters = () => {
      const filters = readFilters();
      setCategory(filters.category);
      setQuery(filters.query);
    };
    syncFilters();
    window.addEventListener("popstate", syncFilters);
    return () => window.removeEventListener("popstate", syncFilters);
  }, []);

  const results = filterArticles(articles, query, category);

  function selectCategory(nextCategory: string) {
    setCategory(nextCategory);
    updateFilterUrl(nextCategory, query);
  }

  function searchArticles(nextQuery: string) {
    setQuery(nextQuery);
    updateFilterUrl(category, nextQuery);
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Blog" }]} />
      <section className="blog-intro container">
        <div>
          <span className="section-label">Blog Dutelog</span>
          <h1>
            Boas ideias.
            <br />
            <em>Novos movimentos.</em>
          </h1>
        </div>
        <p>
          Planejamento, organização e logística.
          <br /> Conteúdo para pensar o próximo passo
          <br /> da sua empresa.
        </p>
      </section>
      {articles.length > 0 && (
        <section
          className="container blog-featured"
          aria-label="Artigo em destaque"
        >
          <div className="featured-label">
            Em destaque <span>Planejamento na prática</span>
          </div>
          <ArticleCard article={articles[0]} />
        </section>
      )}
      <section
        className="section blog-library"
        id="artigos"
        aria-labelledby="library-heading"
      >
        <div className="container">
          <div className="library-header">
            <h2 id="library-heading">Explore os conteúdos.</h2>
            <label className="search-box">
              <span className="sr-only">Buscar artigos</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6.5" />
                <path d="m15 15 6 6" />
              </svg>
              <input
                data-blog-search
                type="search"
                placeholder="O que você quer descobrir?"
                value={query}
                onChange={(event) => searchArticles(event.target.value)}
                aria-controls="blog-results"
              />
            </label>
          </div>
          <div
            className="filter-bar"
            role="group"
            aria-label="Filtrar artigos por categoria"
          >
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={`filter-button${category === item ? " active is-active" : ""}`}
                data-category={item}
                aria-pressed={category === item}
                aria-controls="blog-results"
                onClick={() => selectCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div
            className="results-count"
            data-results-count
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {results.length} {results.length === 1 ? "artigo" : "artigos"}
          </div>
          <div id="blog-results">
            <div className="blog-grid">
              {results.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
            {results.length === 0 && (
              <div className="blog-empty" data-blog-empty>
                <h3>Nenhum artigo por aqui.</h3>
                <p>Tente outro termo ou escolha uma categoria diferente.</p>
              </div>
            )}
          </div>
        </div>
      </section>
      <ClosingCta
        title={
          <>
            Uma ideia.
            <br /> Um próximo passo.
          </>
        }
        description={
          <>
            Conecte o conteúdo ao seu projeto.
            <br /> Vamos conversar sobre o que você precisa.
          </>
        }
      />
    </>
  );
}

export function ArticlePage({
  article,
  preview = false,
}: {
  article: Article;
  preview?: boolean;
}) {
  const articles = useArticles();
  const progressRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const mountedRef = useRef(false);
  const [copyMessage, setCopyMessage] = useState("");
  const related = articles
    .filter((item) => item.slug !== article.slug)
    .slice(0, 2);
  const solutionHref = article.service
    ? serviceHref(article.service)
    : "/solucoes/";
  const categoryHref = `/blog/?categoria=${encodeURIComponent(article.category)}`;
  const headings = article.body ? richHeadings(article.body) : article.sections;

  useEffect(() => {
    if (preview) return;
    mountedRef.current = true;
    let frame: number | undefined;
    const updateProgress = () => {
      frame = undefined;
      if (!progressRef.current) return;
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        maxScroll > 0
          ? Math.max(0, Math.min(1, window.scrollY / maxScroll))
          : 0;
      progressRef.current.style.width = `${(progress * 100).toFixed(2)}%`;
      progressRef.current.setAttribute(
        "aria-valuenow",
        String(Math.round(progress * 100)),
      );
    };
    const requestUpdate = () => {
      if (frame === undefined)
        frame = window.requestAnimationFrame(updateProgress);
    };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    window.addEventListener("load", requestUpdate);
    const sizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(requestUpdate);
    sizeObserver?.observe(document.documentElement);
    requestUpdate();
    return () => {
      mountedRef.current = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
      sizeObserver?.disconnect();
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      window.removeEventListener("load", requestUpdate);
    };
  }, [article.slug, preview]);

  async function copyLink() {
    let message = "Link copiado.";
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      message = "Copie o endereço pela barra do navegador.";
    }
    if (!mountedRef.current) return;
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
    setCopyMessage(message);
    toastTimer.current = setTimeout(() => setCopyMessage(""), 3500);
  }

  return (
    <>
      {!preview && (
        <div
          ref={progressRef}
          className="reading-progress"
          data-scroll-progress
          role="progressbar"
          aria-label="Progresso de leitura"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
        />
      )}
      <Breadcrumbs
        items={[
          { label: "Blog", href: "/blog/" },
          { label: article.category, href: categoryHref },
          { label: article.title },
        ]}
      />
      <article>
        <header className="article-header container">
          <div className="meta">
            <a href={categoryHref}>{article.category}</a>
            <span>{article.readTime} de leitura</span>
          </div>
          <h1>{article.title}</h1>
          <p>{article.excerpt}</p>
          {!preview && (
            <button
              type="button"
              className="text-link copy-link"
              data-copy-link
              onClick={copyLink}
            >
              <span>Copiar link</span>
              <Arrow diagonal />
            </button>
          )}
        </header>
        <div className="container article-cover">
          <ArticlePhoto article={article} eager />
        </div>
        <div className="container article-layout">
          <aside className="article-toc">
            {headings.length > 0 && (
              <>
                <span className="section-label">Neste artigo</span>
                <nav aria-label="Sumário do artigo">
                  {headings.map((section) => (
                    <a key={section.id} href={`#${section.id}`}>
                      {section.title}
                    </a>
                  ))}
                </nav>
              </>
            )}
            <div className="toc-contact">
              <p>
                Do planejamento
                <br /> ao próximo passo.
              </p>
              <TextLink href={solutionHref}>Conheça a solução</TextLink>
            </div>
          </aside>
          <div className="article-body">
            <p className="article-lead">{article.excerpt}</p>
            {article.body ? (
              <RichText document={article.body} />
            ) : (
              article.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  tabIndex={-1}
                  aria-labelledby={`${section.id}-heading`}
                >
                  <h2 id={`${section.id}-heading`}>{section.title}</h2>
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {section.bullets.length > 0 && (
                    <ul>
                      {section.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))
            )}
            <div className="article-inline-cta">
              <span className="section-label">
                O próximo movimento pode começar aqui
              </span>
              <h3>
                Leve o planejamento
                <br /> para a sua operação.
              </h3>
              <Button href={solutionHref} variant="black">
                Conhecer a solução
              </Button>
            </div>
          </div>
        </div>
      </article>
      {!preview && (
        <section
          className="section related-reading"
          aria-labelledby="related-heading"
        >
          <div className="container">
            <div className="section-heading">
              <h2 id="related-heading">Continue explorando.</h2>
              <TextLink href="/blog/">Voltar ao Blog</TextLink>
            </div>
            <div className="blog-grid two">
              {related.map((item) => (
                <ArticleCard key={item.slug} article={item} />
              ))}
            </div>
          </div>
        </section>
      )}
      <ClosingCta />
      <div
        className={`toast${copyMessage ? " is-visible" : ""}`}
        data-toast
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden={!copyMessage}
      >
        {copyMessage}
      </div>
    </>
  );
}
