import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  Eye,
  FileText,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Save,
  Send,
  Upload,
} from "lucide-react";
import {
  BLOG_CATEGORIES,
  BLOG_SERVICES,
  draftFingerprint,
  emptyDraft,
  slugify,
  validatePublication,
  type BlogDraft,
  type BlogRecord,
} from "../blog/model";
import Preview from "../blog/Preview";
import { blogApi, errorMessage, ApiError, type Session } from "./api";
import { loginWithPassword } from "./auth";
import Dialog from "./Dialog";
import VisualEditor from "./Editor";
import MediaPicker, { MediaLibrary } from "./MediaLibrary";
import {
  publishActionLabel,
  publishBlockReason,
  saveStatusLabel,
} from "./save-state";
import "./admin.css";
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");

function LoginForm({
  session,
  onSuccess,
}: {
  session: Session;
  onSuccess: (session: Session) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session.firebaseConfig || busy) return;
    setBusy(true);
    setError("");
    try {
      const { user } = await loginWithPassword(
        session.firebaseConfig,
        email,
        password,
        session.authEmulatorUrl,
      );
      setPassword("");
      onSuccess({ ...session, user });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="editorial-login-form" onSubmit={submit}>
      <p>Use seu acesso administrativo da Dutelog.</p>
      <label className="editorial-field">
        E-mail
        <input
          autoComplete="username"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={busy}
          placeholder="seuemail@dutelog.com.br"
        />
      </label>
      <label className="editorial-field">
        Senha
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={busy}
        />
      </label>
      {error && (
        <div className="editorial-alert editorial-error" role="alert">
          {error}
        </div>
      )}
      {!session.firebaseConfig && (
        <div className="editorial-alert editorial-error" role="alert">
          O acesso ao painel ainda não está disponível neste ambiente.
        </div>
      )}
      <button
        type="submit"
        className="editorial-button editorial-primary"
        disabled={busy || !session.firebaseConfig}
      >
        {busy ? (
          <LoaderCircle className="editorial-spin" size={18} />
        ) : (
          <ArrowUpRight size={18} />
        )}
        {busy ? "Entrando…" : "Entrar no painel"}
      </button>
    </form>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootError, setBootError] = useState("");
  const [items, setItems] = useState<BlogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [view, setView] = useState<"articles" | "media" | "editor">("articles");
  const [record, setRecord] = useState<BlogRecord | null>(null);
  const [draft, setDraft] = useState<BlogDraft | null>(null);
  const [saved, setSaved] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [coverPicker, setCoverPicker] = useState(false);
  const [preview, setPreview] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [publishDialog, setPublishDialog] = useState<
    "publish" | "unpublish" | null
  >(null);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const busyRef = useRef(false);
  const publishNeedsSave = useRef(false);
  const dirty = draft !== null && draftFingerprint(draft) !== saved;
  const needsSave = dirty || !record;
  const publishIssue = draft ? publishBlockReason(draft) : null;
  const busy = saving || publishing;

  const bootstrap = useCallback(() => {
    setBootError("");
    blogApi
      .session()
      .then(setSession)
      .catch((reason) => setBootError(errorMessage(reason)));
  }, []);
  useEffect(bootstrap, [bootstrap]);
  useEffect(() => {
    document.title = "Painel do Blog | Dutelog";
    const expired = () => setReauth(true);
    window.addEventListener("blog-session-expired", expired);
    return () => window.removeEventListener("blog-session-expired", expired);
  }, []);
  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await blogApi.drafts();
      setItems(result.items);
      setInitialized(result.initialized !== false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (session?.user) void loadArticles();
  }, [session?.user?.uid, loadArticles]);
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty]);

  function leave(action: () => void) {
    if (busy) return;
    if (dirty) setLeaveAction(() => action);
    else action();
  }
  function clearFeedback() {
    setError("");
    setMessage("");
    setConflict(false);
  }
  function listView(next: "articles" | "media") {
    leave(() => {
      setView(next);
      setDraft(null);
      setRecord(null);
      clearFeedback();
    });
  }
  function newArticle() {
    leave(() => {
      const next = emptyDraft();
      setRecord(null);
      setDraft(next);
      setSaved(draftFingerprint(next));
      setEditorKey((value) => value + 1);
      setSlugEdited(false);
      setView("editor");
      clearFeedback();
    });
  }
  function openArticle(item: BlogRecord) {
    leave(() => {
      setRecord(item);
      setDraft(item.draft);
      setSaved(draftFingerprint(item.draft));
      setEditorKey((value) => value + 1);
      setSlugEdited(true);
      setView("editor");
      clearFeedback();
    });
  }
  function replaceRecord(item: BlogRecord) {
    setRecord(item);
    setDraft(item.draft);
    setSaved(draftFingerprint(item.draft));
    setItems((current) => [
      item,
      ...current.filter((entry) => entry.id !== item.id),
    ]);
  }
  async function persistDraft(
    current: BlogDraft,
    existing: BlogRecord | null,
  ): Promise<BlogRecord | null> {
    setSaving(true);
    try {
      const { item } = await blogApi.save(current, existing);
      replaceRecord(item);
      return item;
    } catch (reason) {
      setError(errorMessage(reason));
      setConflict(reason instanceof ApiError && reason.status === 409);
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function saveArticle() {
    if (!draft || busyRef.current) return;
    busyRef.current = true;
    clearFeedback();
    const item = await persistDraft(draft, record);
    if (item)
      setMessage(
        "Rascunho salvo. A versão do site só muda quando você publicar.",
      );
    busyRef.current = false;
  }
  async function reloadRecord() {
    if (!record) return;
    leave(() => {
      setLoading(true);
      blogApi
        .draft(record.id)
        .then(({ item }) => {
          replaceRecord(item);
          setEditorKey((value) => value + 1);
          clearFeedback();
        })
        .catch((reason) => setError(errorMessage(reason)))
        .finally(() => setLoading(false));
    });
  }
  async function importArticles() {
    if (importing) return;
    setImporting(true);
    clearFeedback();
    try {
      await blogApi.importExisting();
      await loadArticles();
      setMessage(
        "Os artigos do site estão disponíveis para edição. O conteúdo já editado foi preservado.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setImporting(false);
    }
  }
  function requestPublish() {
    if (!draft || busy) return;
    try {
      validatePublication(draft);
      clearFeedback();
      publishNeedsSave.current = dirty || !record;
      setPublishDialog("publish");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  async function publishArticle() {
    if (!draft || !publishDialog || busyRef.current) return;
    const action = publishDialog;
    if (action === "unpublish" && !record) return;
    busyRef.current = true;
    setPublishing(true);
    clearFeedback();
    try {
      let target = record;
      if (action === "publish") {
        validatePublication(draft);
        if (!target || draftFingerprint(draft) !== saved) {
          const item = await persistDraft(draft, target);
          if (!item) {
            setPublishDialog(null);
            return;
          }
          target = item;
        }
      }
      if (!target) return;
      const { item } =
        action === "publish"
          ? await blogApi.publish(target)
          : await blogApi.unpublish(target);
      replaceRecord(item);
      setPublishDialog(null);
      setMessage(
        action === "publish"
          ? "Artigo publicado no Blog."
          : "Artigo retirado do site. Seu rascunho foi preservado.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
      setPublishDialog(null);
      setConflict(reason instanceof ApiError && reason.status === 409);
    } finally {
      setPublishing(false);
      busyRef.current = false;
    }
  }
  async function logout() {
    try {
      await blogApi.logout();
      setSession((current) => (current ? { ...current, user: null } : null));
      setDraft(null);
      setRecord(null);
      setItems([]);
      setView("articles");
      clearFeedback();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (!session)
    return (
      <div className="editorial-app editorial-login">
        <div className="editorial-login-box">
          <img src="/dutelog-logo.png" alt="Dutelog" />
          <h1>Painel do Blog</h1>
          {bootError ? (
            <>
              <p role="alert">{bootError}</p>
              <button
                type="button"
                className="editorial-button editorial-primary"
                onClick={bootstrap}
              >
                Tentar novamente
              </button>
            </>
          ) : (
            <p role="status">
              <LoaderCircle className="editorial-spin" size={18} /> Preparando
              seu espaço de criação…
            </p>
          )}
        </div>
      </div>
    );
  if (!session.user)
    return (
      <div className="editorial-app editorial-login">
        <div className="editorial-login-story">
          <a href="/" aria-label="Dutelog — início">
            <img src="/dutelog-logo-light.png" alt="Dutelog" />
          </a>
          <span className="editorial-eyebrow">BLOG DUTELOG</span>
          <h1>
            Boas ideias.
            <br />
            <em>Novos movimentos.</em>
          </h1>
          <p>
            Um espaço para criar, revisar e compartilhar o que move a nossa
            empresa.
          </p>
          <small>Conteúdo com o olhar da Dutelog.</small>
        </div>
        <div className="editorial-login-box">
          <span className="editorial-eyebrow">PAINEL EDITORIAL</span>
          <h2>Vamos criar?</h2>
          <LoginForm session={session} onSuccess={setSession} />
          <a href="/" className="editorial-back-link">
            <ArrowLeft size={16} /> Voltar ao site
          </a>
        </div>
      </div>
    );

  const shown = items.filter(
    (item) =>
      normalize(
        `${item.draft.title} ${item.draft.excerpt} ${item.draft.category}`,
      ).includes(normalize(query)) &&
      (filter === "all" ||
        (filter === "published"
          ? Boolean(item.publishedAt)
          : !item.publishedAt)),
  );
  const publishedCount = items.filter((item) => item.publishedAt).length;
  const status = (item: BlogRecord) =>
    item.publishedAt
      ? item.revision !== item.publishedRevision
        ? "Alterações em rascunho"
        : "Publicado"
      : "Rascunho";
  return (
    <div className="editorial-app">
      <aside className="editorial-sidebar">
        <a
          className="editorial-brand"
          href="/"
          target="_blank"
          rel="noreferrer"
        >
          <img src="/dutelog-logo.png" alt="Dutelog — abrir site" />
        </a>
        <div className="editorial-workspace">
          <span className="editorial-workspace-icon">
            <BookOpen size={19} />
          </span>
          <div>
            <strong>Blog Dutelog</strong>
            <span>Painel editorial</span>
          </div>
        </div>
        <nav aria-label="Painel editorial">
          <button
            className={view !== "media" ? "is-current" : ""}
            onClick={() => listView("articles")}
          >
            <FileText size={18} /> Artigos <span>{items.length}</span>
          </button>
          <button
            className={view === "media" ? "is-current" : ""}
            onClick={() => listView("media")}
          >
            <ImagePlus size={18} /> Imagens
          </button>
          <a href="/blog/" target="_blank" rel="noreferrer">
            <ArrowUpRight size={18} /> Ver Blog no site
          </a>
        </nav>
        <div className="editorial-sidebar-note">
          <span className="editorial-eyebrow">DO RASCUNHO AO MUNDO</span>
          <p>
            Cada boa ideia
            <br />
            merece espaço.
          </p>
          <span className="editorial-note-line" />
        </div>
        <div className="editorial-account">
          <span className="editorial-avatar">
            {(session.user.name || session.user.email || "D")
              .slice(0, 1)
              .toUpperCase()}
          </span>
          <div>
            <strong>{session.user.name || "Administrador"}</strong>
            <small>{session.user.email}</small>
          </div>
          <button
            className="editorial-icon"
            aria-label="Sair do painel"
            title="Sair do painel"
            onClick={() =>
              leave(() => {
                void logout();
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="editorial-main" id="editorial-main">
        <header className="editorial-topbar">
          <div>
            <span>Blog Dutelog</span>
            <ChevronRight size={14} />
            <strong>
              {view === "editor"
                ? record
                  ? "Editar artigo"
                  : "Novo artigo"
                : view === "media"
                  ? "Biblioteca de imagens"
                  : "Artigos"}
            </strong>
          </div>
          <span className="editorial-access-label">
            <Circle size={7} fill="currentColor" /> Acesso administrativo
          </span>
        </header>
        {view === "editor" && draft ? (
          <>
            <div className="editorial-edit-header">
              <div>
                <button
                  className="editorial-back-link"
                  onClick={() => listView("articles")}
                >
                  <ArrowLeft size={16} /> Todos os artigos
                </button>
                <h1>
                  {record
                    ? "Dê forma à sua ideia."
                    : "Comece uma boa história."}
                </h1>
                <p className="editorial-save-state" role="status">
                  {saveStatusLabel({
                    saving,
                    dirty,
                    savedAt: record?.updatedAt,
                  })}
                </p>
              </div>
              <div className="editorial-edit-actions">
                <button
                  className="editorial-button"
                  disabled={busy}
                  onClick={() => setPreview(true)}
                >
                  <Eye size={17} /> Prévia
                </button>
                <button
                  className="editorial-button"
                  disabled={busy || (Boolean(record) && !dirty)}
                  onClick={() => void saveArticle()}
                >
                  {saving ? (
                    <LoaderCircle className="editorial-spin" size={17} />
                  ) : (
                    <Save size={17} />
                  )}{" "}
                  {saving ? "Salvando…" : "Salvar rascunho"}
                </button>
                <button
                  className="editorial-button editorial-primary"
                  disabled={busy || Boolean(publishIssue)}
                  aria-describedby={
                    publishIssue ? "publish-block-reason" : undefined
                  }
                  onClick={requestPublish}
                >
                  <Send size={17} />{" "}
                  {publishActionLabel(needsSave, Boolean(record?.publishedAt))}
                </button>
                {publishIssue && (
                  <p
                    id="publish-block-reason"
                    className="editorial-publish-reason"
                    role="status"
                  >
                    {publishIssue}
                  </p>
                )}
              </div>
            </div>
            {(error || message) && (
              <div className="editorial-feedback">
                {error && (
                  <div className="editorial-alert editorial-error" role="alert">
                    {error}
                    {conflict && (
                      <button type="button" onClick={() => void reloadRecord()}>
                        Reabrir versão salva
                      </button>
                    )}
                  </div>
                )}
                {message && (
                  <div
                    className="editorial-alert editorial-success"
                    role="status"
                  >
                    <Check size={16} /> {message}
                  </div>
                )}
              </div>
            )}
            <div className="editorial-edit-grid">
              <section
                className="editorial-writing-panel"
                aria-label="Texto do artigo"
              >
                <label className="editorial-title-label">
                  <span>TÍTULO DO ARTIGO</span>
                  <textarea
                    aria-label="Título do artigo"
                    placeholder="Qual é a sua próxima ideia?"
                    value={draft.title}
                    maxLength={180}
                    rows={2}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              title: value,
                              slug: slugEdited ? current.slug : slugify(value),
                            }
                          : null,
                      );
                    }}
                  />
                </label>
                <label className="editorial-excerpt-label">
                  <span>RESUMO</span>
                  <textarea
                    aria-label="Resumo do artigo"
                    placeholder="Apresente a ideia em poucas linhas. Este texto aparece na listagem do Blog."
                    value={draft.excerpt}
                    rows={3}
                    maxLength={500}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, excerpt: event.target.value })
                    }
                  />
                  <small>{draft.excerpt.length}/500</small>
                </label>
                <VisualEditor
                  key={editorKey}
                  content={draft.body}
                  disabled={busy}
                  onChange={(body) =>
                    setDraft((current) => {
                      if (
                        !current ||
                        JSON.stringify(current.body) === JSON.stringify(body)
                      )
                        return current;
                      return { ...current, body };
                    })
                  }
                />
              </section>
              <aside
                className="editorial-settings"
                aria-label="Configurações do artigo"
              >
                <section className="editorial-settings-card">
                  <h2>Organização</h2>
                  <label className="editorial-field">
                    Categoria
                    <select
                      value={draft.category}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft({ ...draft, category: event.target.value })
                      }
                    >
                      {BLOG_CATEGORIES.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label className="editorial-field">
                    Solução relacionada
                    <select
                      value={draft.service}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft({ ...draft, service: event.target.value })
                      }
                    >
                      {BLOG_SERVICES.map((service) => (
                        <option key={service.slug} value={service.slug}>
                          {service.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="editorial-field">
                    Endereço do artigo
                    <input
                      value={draft.slug}
                      maxLength={120}
                      disabled={busy || Boolean(record?.publishedSlug)}
                      onChange={(event) => {
                        setSlugEdited(true);
                        setDraft({ ...draft, slug: event.target.value });
                      }}
                      onBlur={() =>
                        setDraft((current) =>
                          current
                            ? { ...current, slug: slugify(current.slug) }
                            : null,
                        )
                      }
                    />
                  </label>
                  <p className="editorial-url">
                    /blog/{draft.slug || "endereco-do-artigo"}/
                  </p>
                  {record?.publishedSlug && (
                    <p className="editorial-hint">
                      O endereço é preservado para manter os links do artigo
                      funcionando.
                    </p>
                  )}
                </section>
                <section className="editorial-settings-card">
                  <h2>Capa do artigo</h2>
                  <button
                    className={`editorial-cover-picker${draft.cover.src ? " has-image" : ""}`}
                    type="button"
                    disabled={busy}
                    onClick={() => setCoverPicker(true)}
                  >
                    {draft.cover.src ? (
                      <>
                        <img
                          src={draft.cover.src}
                          alt={draft.cover.alt || "Capa do artigo"}
                        />
                        <span>Trocar imagem</span>
                      </>
                    ) : (
                      <>
                        <ImagePlus size={26} />
                        <strong>Escolher imagem</strong>
                        <span>Da biblioteca ou do seu computador</span>
                      </>
                    )}
                  </button>
                  {draft.cover.src && (
                    <>
                      <label className="editorial-field">
                        Descrição da capa
                        <textarea
                          value={draft.cover.alt}
                          rows={2}
                          maxLength={300}
                          disabled={busy}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              cover: {
                                ...draft.cover,
                                alt: event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <button
                        className="editorial-text-button"
                        disabled={busy}
                        onClick={() =>
                          setDraft({ ...draft, cover: { src: "", alt: "" } })
                        }
                      >
                        Remover capa
                      </button>
                    </>
                  )}
                </section>
                <section className="editorial-settings-card">
                  <h2>Publicação</h2>
                  <span
                    className={`editorial-badge${record?.publishedAt ? " is-published" : ""}`}
                  >
                    {record ? status(record) : "Rascunho"}
                  </span>
                  <p className="editorial-hint">
                    Salvar mantém o texto em rascunho. Você decide quando
                    publicar.
                  </p>
                  {record?.publishedAt && (
                    <>
                      <a
                        className="editorial-back-link"
                        href={`/blog/${record.publishedSlug}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir artigo no site <ArrowUpRight size={15} />
                      </a>
                      <button
                        className="editorial-text-button editorial-danger-text"
                        disabled={busy || dirty}
                        onClick={() => setPublishDialog("unpublish")}
                      >
                        Retirar do ar
                      </button>
                    </>
                  )}
                </section>
              </aside>
            </div>
          </>
        ) : view === "media" ? (
          <div className="editorial-page">
            <div className="editorial-page-heading">
              <span className="editorial-eyebrow">BIBLIOTECA</span>
              <h1>Imagens que contam.</h1>
              <p>Organize as imagens que dão vida aos seus artigos.</p>
            </div>
            <div className="editorial-library-panel">
              <MediaLibrary />
            </div>
          </div>
        ) : (
          <div className="editorial-page">
            <div className="editorial-list-heading">
              <div>
                <span className="editorial-eyebrow">SEU ESPAÇO DE CRIAÇÃO</span>
                <h1>Ideias em movimento.</h1>
                <p>Crie, revise e publique no seu ritmo.</p>
              </div>
              <button
                className="editorial-button editorial-primary"
                disabled={!initialized || importing}
                onClick={newArticle}
              >
                <Plus size={19} /> Novo artigo
              </button>
            </div>
            {error && (
              <div className="editorial-alert editorial-error" role="alert">
                {error}
                <button onClick={() => void loadArticles()}>
                  Tentar novamente
                </button>
              </div>
            )}
            {message && (
              <div className="editorial-alert editorial-success" role="status">
                <Check size={16} /> {message}
              </div>
            )}
            {!initialized && (
              <section className="editorial-import">
                <BookOpen size={26} />
                <div>
                  <h2>Traga seus artigos para o painel.</h2>
                  <p>
                    Importe o conteúdo que já está no Blog para começar a
                    gerenciar tudo por aqui.
                  </p>
                </div>
                <button
                  className="editorial-button editorial-primary"
                  disabled={importing}
                  onClick={() => void importArticles()}
                >
                  {importing ? (
                    <LoaderCircle className="editorial-spin" size={17} />
                  ) : (
                    <Upload size={17} />
                  )}
                  {importing ? "Importando…" : "Importar artigos do site"}
                </button>
              </section>
            )}
            <div className="editorial-stats">
              <div>
                <span>Todos os artigos</span>
                <strong>{items.length.toString().padStart(2, "0")}</strong>
                <FileText size={21} />
              </div>
              <div>
                <span>Rascunhos</span>
                <strong>
                  {(items.length - publishedCount).toString().padStart(2, "0")}
                </strong>
                <BookOpen size={21} />
              </div>
              <div>
                <span>Publicados</span>
                <strong>{publishedCount.toString().padStart(2, "0")}</strong>
                <ArrowUpRight size={21} />
              </div>
            </div>
            <section
              className="editorial-article-list"
              aria-label="Artigos do Blog"
            >
              <div className="editorial-list-controls">
                <div
                  className="editorial-tabs"
                  role="group"
                  aria-label="Filtrar artigos"
                >
                  {[
                    ["all", "Todos"],
                    ["drafts", "Rascunhos"],
                    ["published", "Publicados"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={filter === value}
                      className={filter === value ? "is-current" : ""}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="editorial-search">
                  <Search size={17} />
                  <input
                    type="search"
                    aria-label="Buscar artigos"
                    placeholder="Buscar artigo"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              {loading ? (
                <div className="editorial-empty" role="status">
                  <LoaderCircle className="editorial-spin" />
                  <p>Carregando seus artigos…</p>
                </div>
              ) : shown.length === 0 ? (
                <div className="editorial-empty">
                  <BookOpen size={32} />
                  <h2>
                    {query || filter !== "all"
                      ? "Nenhum artigo por aqui"
                      : "Qual será a primeira ideia?"}
                  </h2>
                  <p>
                    {query || filter !== "all"
                      ? "Tente outra busca ou escolha um filtro diferente."
                      : "Comece um rascunho e transforme conhecimento em conteúdo."}
                  </p>
                  {initialized && !query && filter === "all" && (
                    <button className="editorial-button" onClick={newArticle}>
                      <Plus size={17} /> Criar artigo
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="editorial-list-columns">
                    <span>ARTIGO</span>
                    <span>ESTADO</span>
                    <span>ÚLTIMA EDIÇÃO</span>
                  </div>
                  {shown.map((item) => (
                    <button
                      type="button"
                      className="editorial-article-row"
                      key={item.id}
                      onClick={() => openArticle(item)}
                    >
                      <div className="editorial-article-summary">
                        <span className="editorial-article-thumb">
                          {item.draft.cover.src ? (
                            <img
                              src={item.draft.cover.src}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <FileText size={22} />
                          )}
                        </span>
                        <span>
                          <small>{item.draft.category}</small>
                          <strong>
                            {item.draft.title || "Artigo sem título"}
                          </strong>
                          <span>/blog/{item.draft.slug || "novo-artigo"}/</span>
                        </span>
                      </div>
                      <span
                        className={`editorial-badge${item.publishedAt ? " is-published" : ""}`}
                      >
                        {status(item)}
                      </span>
                      <time dateTime={item.updatedAt}>
                        {date(item.updatedAt)}
                      </time>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </>
              )}
            </section>
          </div>
        )}
      </main>
      {coverPicker && draft && (
        <MediaPicker
          onClose={() => setCoverPicker(false)}
          onSelect={(image) => {
            setDraft({ ...draft, cover: { src: image.src, alt: image.alt } });
            setCoverPicker(false);
          }}
        />
      )}
      {preview && draft && (
        <Dialog title="Prévia do artigo" wide onClose={() => setPreview(false)}>
          <div className="editorial-preview-note">
            <Eye size={16} /> Esta prévia é privada. Mostra o texto aberto no
            editor, mesmo antes de salvar.
          </div>
          <div className="editorial-preview-content">
            <Preview draft={draft} />
          </div>
        </Dialog>
      )}
      {reauth && (
        <Dialog
          title="Entre novamente para continuar"
          onClose={() => setReauth(false)}
        >
          <div className="editorial-dialog-form">
            <p>
              Seu texto continua no editor. Confirme seu acesso para salvar.
            </p>
            <LoginForm
              session={session}
              onSuccess={(next) => {
                setSession(next);
                setReauth(false);
                setError("");
              }}
            />
          </div>
        </Dialog>
      )}
      {leaveAction && (
        <Dialog
          title="Você tem alterações não salvas"
          onClose={() => setLeaveAction(null)}
        >
          <div className="editorial-dialog-form">
            <p>
              Continue editando para salvar seu trabalho ou descarte as
              alterações desta tela.
            </p>
            <div className="editorial-inline-actions">
              <button
                className="editorial-button editorial-primary"
                onClick={() => setLeaveAction(null)}
              >
                Continuar editando
              </button>
              <button
                className="editorial-button"
                onClick={() => {
                  const action = leaveAction;
                  setLeaveAction(null);
                  action();
                }}
              >
                Descartar alterações
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {publishDialog &&
        ((publishDialog === "publish" && draft) ||
          (publishDialog === "unpublish" && record)) && (
        <Dialog
          title={
            publishDialog === "publish"
              ? publishNeedsSave.current
                ? record?.publishedAt
                  ? "Salvar e atualizar o artigo?"
                  : "Salvar e publicar o artigo?"
                : record?.publishedAt
                  ? "Atualizar artigo no site?"
                  : "Publicar artigo?"
              : "Retirar artigo do ar?"
          }
          onClose={() => {
            if (!publishing) setPublishDialog(null);
          }}
        >
          <div className="editorial-dialog-form">
            <p>
              {publishDialog === "publish"
                ? publishNeedsSave.current
                  ? "A versão atual será salva e ficará disponível para todos os visitantes do Blog."
                  : "A versão salva ficará disponível para todos os visitantes do Blog."
                : "O artigo deixará de aparecer no Blog. O rascunho continuará disponível neste painel."}
            </p>
            <div className="editorial-publish-review">
              <strong>
                {(publishDialog === "publish" ? draft : record?.draft)?.title}
              </strong>
              <span>
                {(publishDialog === "publish" ? draft : record?.draft)?.category}
              </span>
              <small>
                /blog/
                {record?.publishedSlug ||
                  draft?.slug ||
                  record?.draft.slug ||
                  "endereco-do-artigo"}
                /
              </small>
            </div>
            <div className="editorial-inline-actions">
              <button
                className="editorial-button editorial-primary"
                disabled={publishing}
                onClick={() => void publishArticle()}
              >
                {publishing && (
                  <LoaderCircle className="editorial-spin" size={16} />
                )}
                {publishing
                  ? "Concluindo…"
                  : publishDialog === "publish"
                    ? publishNeedsSave.current
                      ? publishActionLabel(true, Boolean(record?.publishedAt))
                      : "Confirmar publicação"
                    : "Retirar do ar"}
              </button>
              <button
                className="editorial-button"
                disabled={publishing}
                onClick={() => setPublishDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
