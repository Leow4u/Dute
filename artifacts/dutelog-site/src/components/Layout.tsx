import { useEffect, useRef, useState, type ReactNode } from "react";
import { company, services, serviceHref } from "../content";
import { Arrow, Button, TextLink } from "./ui";

export function Layout({
  children,
  pathname,
  home = false,
}: {
  children: ReactNode;
  pathname: string;
  home?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mega, setMega] = useState(false);
  const header = useRef<HTMLElement>(null);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const megaToggle = useRef<HTMLButtonElement>(null);
  const mobilePanel = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 30);
    update();
    window.addEventListener("scroll", update, { passive: true });
    const onResize = () => {
      if (window.innerWidth >= 900) setMobile(false);
      else setMega(false);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("menu-open", mobile);
    if (mobile)
      mobilePanel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (mobile || mega)) {
        setMobile(false);
        setMega(false);
        (mobile ? mobileToggle : megaToggle).current?.focus();
      }
      if (mobile && event.key === "Tab") {
        const links = Array.from(
          mobilePanel.current?.querySelectorAll<HTMLElement>("a,button") || [],
        );
        const first = mobileToggle.current;
        const last = links.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const outside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setMega(false);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.body.classList.remove("menu-open");
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside);
    };
  }, [mobile, mega]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("js");
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    document
      .querySelectorAll(".reveal")
      .forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("js");
    };
  }, []);

  const navLink = (label: string, href: string) => (
    <a
      href={href}
      aria-current={pathname.startsWith(href) ? "page" : undefined}
    >
      {label}
    </a>
  );
  return (
    <div className={`site-shell ${home ? "home" : ""}`}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header
        ref={header}
        id="site-header"
        className={`${scrolled ? "scrolled" : ""} ${mega ? "mega-is-open" : ""}`}
      >
        <div className="header-inner">
          <a href="/" className="brand" aria-label="Dutelog — início">
            <img
              className="brand-dark"
              src="/dutelog-logo.png"
              alt="Dutelog — Soluções Logísticas"
              width="240"
              height="72"
            />
            <img
              className="brand-light"
              src="/dutelog-logo-light.png"
              alt=""
              aria-hidden="true"
              width="240"
              height="72"
            />
          </a>
          <nav className="desktop-nav" aria-label="Navegação principal">
            <button
              data-mega-toggle
              ref={megaToggle}
              onClick={() => setMega(!mega)}
              aria-controls="mega-menu"
              aria-expanded={mega}
              className="nav-trigger"
            >
              Soluções
              <svg
                className="nav-chevron"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 7.5 5 5 5-5" />
              </svg>
            </button>
            {navLink("A Dutelog", "/a-dutelog/")}
            {navLink("Blog", "/blog/")}
            {navLink("Contato", "/contato/")}
          </nav>
          <div className="header-actions">
            <a className="header-cta" href="/contato/">
              Vamos conversar <Arrow diagonal />
            </a>
            <button
              data-menu-toggle
              ref={mobileToggle}
              className="menu-toggle"
              onClick={() => {
                if (mobile) mobileToggle.current?.focus();
                setMobile(!mobile);
              }}
              aria-label={mobile ? "Fechar menu" : "Abrir menu"}
              aria-controls="mobile-menu"
              aria-expanded={mobile}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d={mobile ? "M5 5l14 14M19 5 5 19" : "M3 8h18M3 16h18"} />
              </svg>
            </button>
            <a className="header-client" href={company.portal}>
              Área do cliente <Arrow diagonal />
            </a>
          </div>
        </div>
        <div id="mega-menu" hidden={!mega}>
          <div className="mega-grid">
            <div>
              <span className="section-label">O que sua empresa precisa?</span>
              <h2>
                Um movimento.
                <br /> Muitas possibilidades.
              </h2>
              <TextLink href="/solucoes/">Conheça todas as soluções</TextLink>
            </div>
            <div className="mega-primary">
              <a className="mega-title" href="/logistica-corporativa/">
                Logística Corporativa <Arrow diagonal />
              </a>
              <div className="mega-services">
                {services
                  .filter((s) => s.group === "corporativa")
                  .map((s) => (
                    <a key={s.slug} href={serviceHref(s.slug)}>
                      {s.title}
                    </a>
                  ))}
              </div>
            </div>
            <div className="mega-secondary">
              <a href="/transporte-de-cargas/">
                Transporte de Cargas <Arrow diagonal />
                <small>Dedicado e Fracionado</small>
              </a>
              <a href="/armazenagem/">
                Armazenagem <Arrow diagonal />
                <small>Espaço para o próximo passo</small>
              </a>
            </div>
          </div>
        </div>
        <nav
          ref={mobilePanel}
          id="mobile-menu"
          role="dialog"
          aria-modal={mobile ? true : undefined}
          aria-label="Menu para celular"
          hidden={!mobile}
        >
          {[
            ["Todas as soluções", "/solucoes/"],
            ["Logística Corporativa", "/logistica-corporativa/"],
            ["Transporte de Cargas", "/transporte-de-cargas/"],
            ["Armazenagem", "/armazenagem/"],
            ["A Dutelog", "/a-dutelog/"],
            ["Blog", "/blog/"],
          ].map(([label, href]) => (
            <a href={href} key={href}>
              {label}
              <Arrow />
            </a>
          ))}
          <Button href="/contato/">Vamos conversar</Button>
          <a className="mobile-sitemap" href={company.portal}>
            Área do cliente <Arrow diagonal />
          </a>
        </nav>
      </header>
      <noscript>
        <nav className="no-script-nav" aria-label="Navegação">
          <a href="/solucoes/">Soluções</a>
          <a href="/a-dutelog/">A Dutelog</a>
          <a href="/blog/">Blog</a>
          <a href="/contato/">Contato</a>
        </nav>
      </noscript>
      <main id="conteudo" inert={mobile}>
        {children}
      </main>
      <footer className="footer" inert={mobile}>
        <div className="container">
          <div className="footer-top">
            <a href="/">
              <img
                src="/dutelog-logo-light.png"
                alt="Dutelog — Soluções Logísticas"
                width="210"
                height="63"
              />
            </a>
            <p>
              Cada movimento abre
              <br /> uma nova possibilidade.
            </p>
            <button
              className="back-top"
              aria-label="Voltar ao topo"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                })
              }
            >
              <Arrow diagonal />
            </button>
          </div>
          <div className="footer-links">
            <div>
              <span>Soluções</span>
              <a href="/logistica-corporativa/">Logística Corporativa</a>
              <a href="/transporte-de-cargas/">Transporte de Cargas</a>
              <a href="/armazenagem/">Armazenagem</a>
            </div>
            <div>
              <span>Explore</span>
              <a href="/a-dutelog/">A Dutelog</a>
              <a href="/blog/">Blog</a>
              <a href="/contato/">Contato</a>
              <a href={company.portal}>Área do cliente ↗</a>
            </div>
            <div>
              <span>Comece uma conversa</span>
              <a href={`mailto:${company.email}`}>{company.email}</a>
              <a href={company.phoneHref}>{company.phone}</a>
              <TextLink href="/contato/">Planejar meu projeto</TextLink>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© Dutelog · Soluções Logísticas</span>
            <a href="/mapa-do-site/">
              Mapa do site <Arrow diagonal />
            </a>
            <span>Imagens ilustrativas de IA</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
