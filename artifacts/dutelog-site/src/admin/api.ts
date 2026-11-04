import type { FirebaseOptions } from "firebase/app";
import type {
  BlogActor,
  BlogDraft,
  BlogMedia,
  BlogRecord,
} from "../blog/model";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export type Session = {
  user: BlogActor | null;
  firebaseConfig: FirebaseOptions | null;
  authEmulatorUrl?: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/blog${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", ...options.headers },
    });
  } catch {
    throw new ApiError(
      0,
      "network",
      "Não foi possível conectar. Confira sua conexão e tente novamente. Suas alterações continuam aqui.",
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== "/session")
      window.dispatchEvent(new Event("blog-session-expired"));
    throw new ApiError(
      response.status,
      result?.error?.code || "request_failed",
      result?.error?.message ||
        "Não foi possível concluir esta ação. Tente novamente.",
    );
  }
  return result as T;
}
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const blogApi = {
  session: () => request<Session>("/session"),
  login: (idToken: string) =>
    request<{ user: BlogActor }>("/session", json("POST", { idToken })),
  logout: () => request<unknown>("/session", json("DELETE")),
  drafts: () =>
    request<{ items: BlogRecord[]; initialized?: boolean }>("/drafts"),
  draft: (id: string) =>
    request<{ item: BlogRecord }>(`/drafts/${encodeURIComponent(id)}`),
  save: (draft: BlogDraft, record: BlogRecord | null) =>
    record
      ? request<{ item: BlogRecord }>(
          `/drafts/${encodeURIComponent(record.id)}`,
          json("PUT", { draft, revision: record.revision }),
        )
      : request<{ item: BlogRecord }>("/drafts", json("POST", { draft })),
  importExisting: () => request<unknown>("/import-existing", json("POST", {})),
  publish: (record: BlogRecord) =>
    request<{ item: BlogRecord }>(
      `/drafts/${encodeURIComponent(record.id)}/publish`,
      json("POST", { revision: record.revision }),
    ),
  unpublish: (record: BlogRecord) =>
    request<{ item: BlogRecord }>(
      `/drafts/${encodeURIComponent(record.id)}/unpublish`,
      json("POST", { revision: record.revision }),
    ),
  media: () => request<{ items: BlogMedia[] }>("/media"),
  upload: (file: File, alt: string) =>
    request<{ item: BlogMedia }>("/media", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name),
        "X-Image-Alt": encodeURIComponent(alt),
      },
      body: file,
    }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Sua sessão expirou. Entre novamente para continuar; o texto aberto permanece no editor.";
    if (error.status === 403)
      return "Seu acesso não permite esta ação. Fale com o administrador da Dutelog.";
    if (error.status === 409)
      return "Este artigo foi alterado em outro acesso. Suas alterações continuam neste editor. Reabra a versão salva apenas se quiser descartar o texto atual.";
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir esta ação. Tente novamente.";
}
