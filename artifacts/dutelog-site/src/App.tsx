import { motion } from "framer-motion";
import {
  ArrowRight,
  Box,
  Boxes,
  Building2,
  Check,
  ChevronRight,
  ExternalLink,
  Fingerprint,
  Linkedin,
  Mail,
  Menu,
  MoveRight,
  PackageCheck,
  Phone,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

const CLIENT_PORTAL = "https://app.dutelog.com.br";
const EMAIL = "comercial@dutelog.com.br";
const PHONE_LABEL = "(11) 5039-0681";
const PHONE_LINK = "tel:+551150390681";

const solutions = [
  {
    icon: Truck,
    number: "01",
    title: "Mobilidade corporativa",
    copy: "Planejamento, transporte e implantação para mudanças de escritórios, ativos e operações corporativas.",
    detail: "Do inventário de origem à entrega no destino.",
  },
  {
    icon: Warehouse,
    number: "02",
    title: "Armazenagem inteligente",
    copy: "Guarda organizada, operação WMS e atendimento sob demanda para manter seus ativos disponíveis e seguros.",
    detail: "Recebimento, guarda, separação e expedição.",
  },
  {
    icon: ScanLine,
    number: "03",
    title: "Inventário e rastreabilidade",
    copy: "Visibilidade do patrimônio físico com identificação individual, histórico de movimentações e evidências operacionais.",
    detail: "Informação confiável para decidir e agir.",
  },
];

const steps = [
  {
    title: "Entendemos a operação",
    copy: "Mapeamos volumes, locais, regras, riscos e o nível de serviço que o seu negócio precisa.",
  },
  {
    title: "Desenhamos o fluxo",
    copy: "Configuramos pessoas, processos e tecnologia em uma operação sob medida, sem atalhos genéricos.",
  },
  {
    title: "Executamos com evidência",
    copy: "Cada etapa relevante ganha status, responsável e trilha para acompanhamento operacional.",
  },
  {
    title: "Evoluímos continuamente",
    copy: "Dados reais orientam alertas, prioridades e melhorias na rotina logística.",
  },
];

const technology = [
  "Visibilidade operacional em tempo real",
  "Histórico de estoque e movimentações",
  "Fluxos WMS conectados de ponta a ponta",
  "Inteligência aplicada com supervisão humana",
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-shell">
      <header className={`site-header ${scrolled ? "site-header--scrolled" : ""}`}>
        <div className="header-inner">
          <a className="brand-link" href="#inicio" aria-label="Dutelog - início">
            <img src="/dutelog-logo.png" alt="Dutelog Soluções Logísticas" />
          </a>

          <nav className="desktop-nav" aria-label="Navegação principal">
            <a href="#solucoes">Soluções</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#tecnologia">Tecnologia</a>
            <a href="#empresa">Empresa</a>
          </nav>

          <div className="header-actions">
            <a className="contact-link" href={`mailto:${EMAIL}`}>
              <Mail size={17} aria-hidden="true" />
              Contato
            </a>
            <a className="client-area" href={CLIENT_PORTAL}>
              Área do cliente
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>

          <button
            className="menu-button"
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen && (
          <nav className="mobile-nav" aria-label="Navegação mobile">
            <a href="#solucoes" onClick={closeMenu}>Soluções</a>
            <a href="#como-funciona" onClick={closeMenu}>Como funciona</a>
            <a href="#tecnologia" onClick={closeMenu}>Tecnologia</a>
            <a href="#empresa" onClick={closeMenu}>Empresa</a>
            <a href={`mailto:${EMAIL}`} onClick={closeMenu}>Contato</a>
            <a className="mobile-client-area" href={CLIENT_PORTAL} onClick={closeMenu}>
              Área do cliente <ExternalLink size={16} />
            </a>
          </nav>
        )}
      </header>

      <main>
        <section className="hero" id="inicio" aria-labelledby="hero-title">
          <img
            className="hero-image"
            src="/hero-warehouse.png"
            alt="Profissional de logística conferindo uma operação de armazenagem"
          />
          <div className="hero-overlay" />
          <div className="hero-content page-container">
            <motion.div
              className="hero-copy"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 id="hero-title">Movemos, guardamos e rastreamos seu patrimônio</h1>
              <p>
                Operações logísticas sob medida, com visibilidade em tempo real e inteligência aplicada do recebimento à entrega.
              </p>
              <div className="hero-actions">
                <a className="button button--primary" href={`mailto:${EMAIL}?subject=Quero falar com a Dutelog`}>
                  Falar com a Dutelog <ArrowRight size={18} />
                </a>
                <a className="button button--ghost" href="#solucoes">
                  Conhecer soluções <ChevronRight size={18} />
                </a>
              </div>
              <div className="hero-proof">
                <ShieldCheck size={20} aria-hidden="true" />
                <span>Operação rastreável ponta a ponta</span>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="solutions-section section" id="solucoes" aria-labelledby="solutions-title">
          <div className="page-container">
            <div className="section-intro section-intro--split">
              <div>
                <span className="section-label">Soluções</span>
                <h2 id="solutions-title">Logística conectada ao que o seu negócio precisa preservar</h2>
              </div>
              <p>
                A Dutelog combina execução física, controle operacional e tecnologia em uma única jornada. Cada projeto nasce do contexto real da sua empresa.
              </p>
            </div>

            <div className="solutions-grid">
              {solutions.map(({ icon: Icon, number, title, copy, detail }, index) => (
                <motion.article
                  className="solution-card"
                  key={title}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                >
                  <div className="solution-topline">
                    <span className="solution-icon"><Icon size={22} /></span>
                    <span className="solution-number">{number}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  <span className="solution-detail"><Check size={16} /> {detail}</span>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="process-section section" id="como-funciona" aria-labelledby="process-title">
          <div className="page-container process-layout">
            <div className="process-heading">
              <span className="section-label">Como funciona</span>
              <h2 id="process-title">Da complexidade física a uma operação que todos conseguem acompanhar</h2>
              <p>
                Um método simples para o cliente e rigoroso para a operação: entender, desenhar, executar e melhorar.
              </p>
              <a className="text-link" href={`mailto:${EMAIL}?subject=Quero desenhar uma operação com a Dutelog`}>
                Desenhar minha operação <MoveRight size={18} />
              </a>
            </div>
            <ol className="process-list">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="technology-section section" id="tecnologia" aria-labelledby="technology-title">
          <div className="page-container technology-layout">
            <div className="technology-visual">
              <img
                src="/ai-warehouse.jpg"
                alt="Tecnologia aplicada à operação de armazenagem Dutelog"
                loading="lazy"
              />
              <div className="technology-caption">
                <Sparkles size={18} />
                <span>Inteligência que acompanha a operação</span>
              </div>
            </div>
            <div className="technology-copy">
              <span className="section-label section-label--light">Tecnologia aplicada</span>
              <h2 id="technology-title">O físico e o digital trabalhando na mesma direção</h2>
              <p>
                Nossa plataforma conecta estoque, WMS, documentos e eventos operacionais. O Agent Dute transforma esse contexto em alertas e apoio à decisão, mantendo pessoas no controle das ações críticas.
              </p>
              <ul>
                {technology.map((item) => (
                  <li key={item}><Check size={17} /> {item}</li>
                ))}
              </ul>
              <a className="button button--light" href={`mailto:${EMAIL}?subject=Quero conhecer a tecnologia Dutelog`}>
                Conhecer a plataforma <ArrowRight size={18} />
              </a>
            </div>
          </div>
        </section>

        <section className="control-section section" aria-labelledby="control-title">
          <div className="page-container">
            <div className="section-intro section-intro--center">
              <span className="section-label">Uma visão, toda a operação</span>
              <h2 id="control-title">Mais clareza para o cliente. Mais controle para quem executa.</h2>
            </div>
            <div className="control-grid">
              <article>
                <PackageCheck size={24} />
                <h3>Fluxos conectados</h3>
                <p>Recebimento, armazenagem, separação e entrega compartilham a mesma trilha operacional.</p>
              </article>
              <article>
                <Fingerprint size={24} />
                <h3>Histórico confiável</h3>
                <p>Movimentações e decisões relevantes ficam registradas para consulta e auditoria.</p>
              </article>
              <article>
                <Boxes size={24} />
                <h3>Estoque disponível</h3>
                <p>Saldos e disponibilidade acompanham a realidade física conforme a operação avança.</p>
              </article>
              <article>
                <Sparkles size={24} />
                <h3>IA com contexto</h3>
                <p>O Agent Dute entende eventos e documentos para orientar prioridades sem inventar dados.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="company-section section" id="empresa" aria-labelledby="company-title">
          <div className="page-container company-layout">
            <div className="company-mark" aria-hidden="true">
              <Building2 size={34} />
            </div>
            <div className="company-copy">
              <span className="section-label">Dutelog</span>
              <h2 id="company-title">Logística feita com presença, método e responsabilidade</h2>
              <p>
                Cuidamos de ativos que sustentam o trabalho de outras empresas. Por isso, desenhamos operações próximas, transparentes e adaptadas à rotina de cada cliente.
              </p>
            </div>
            <div className="company-values" aria-label="Princípios da Dutelog">
              <span>Execução cuidadosa</span>
              <span>Informação acessível</span>
              <span>Evolução contínua</span>
            </div>
          </div>
        </section>

        <section className="contact-section" aria-labelledby="contact-title">
          <div className="page-container contact-layout">
            <div>
              <span className="section-label">Vamos conversar</span>
              <h2 id="contact-title">Sua operação pode ser mais simples de acompanhar</h2>
              <p>Conte o que precisa mover, guardar ou controlar. A gente começa entendendo.</p>
            </div>
            <div className="contact-actions">
              <a className="button button--primary" href={`mailto:${EMAIL}?subject=Quero falar com a Dutelog`}>
                Enviar mensagem <Mail size={18} />
              </a>
              <a className="button button--outline" href={PHONE_LINK}>
                {PHONE_LABEL} <Phone size={17} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-container footer-main">
          <div className="footer-brand">
            <img src="/dutelog-logo.png" alt="Dutelog Soluções Logísticas" />
            <p>Soluções logísticas para mover, armazenar e rastrear patrimônio físico.</p>
          </div>
          <div className="footer-links">
            <div>
              <h3>Navegação</h3>
              <a href="#solucoes">Soluções</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#tecnologia">Tecnologia</a>
            </div>
            <div>
              <h3>Contato</h3>
              <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
              <a href={PHONE_LINK}>{PHONE_LABEL}</a>
            </div>
            <div>
              <h3>Acesso</h3>
              <a href={CLIENT_PORTAL}>Área do cliente <ExternalLink size={14} /></a>
              <a href="https://www.linkedin.com/company/dutelog" target="_blank" rel="noreferrer">
                LinkedIn <Linkedin size={14} />
              </a>
            </div>
          </div>
        </div>
        <div className="page-container footer-bottom">
          <span>© {new Date().getFullYear()} Dutelog Soluções Logísticas.</span>
          <span>São Paulo, SP</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
