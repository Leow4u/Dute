import {
  createUserWithEmailAndPassword,
  reload,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { Check, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppUser } from "@/lib/auth";
import {
  MENSAGENS_DO_CONVITE,
  conviteLido,
  mensagemDoConvite,
  mensagemDoEnvioDeConfirmacao,
  nomeDoAceite,
  perfilDoConvite,
  type ConviteLido,
} from "@/lib/convite";
import { firebaseApp, firebaseAuth, firebaseConfigError } from "@/lib/firebase";
import { functionsDoApp } from "@/lib/firebase-functions";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Aceitar convite (pergunta 68, canvas "Telas das decisões de 26/10", item 9):
 * a pessoa cria a senha, confirma o e-mail pelo link que chega na caixa dela
 * e só então entra, com o perfil do convite. O aceite é do servidor
 * (`acceptInvite`); enquanto o e-mail não é confirmado, o convite continua
 * valendo, e "Reenviar e-mail" manda o link de novo.
 */

export type TelaDoConvite =
  | { tela: "carregando" }
  | { tela: "sem_convite"; motivo: "sem_link" | "invalido" }
  | { tela: "outra_conta"; email: string }
  | { tela: "formulario"; convite: ConviteLido }
  | { tela: "confirmar"; convite: ConviteLido; reenviado: boolean; enviado: boolean }
  | { tela: "confirmado"; convite: ConviteLido };

export type AcoesDoConvite = {
  nome: (valor: string) => void;
  senha: (valor: string) => void;
  aceitar: () => void;
  jaConfirmei: () => void;
  reenviar: () => void;
  sair: () => void;
  jaTenhoConta: () => void;
  voltarAoLogin: () => void;
  sairDaOutraConta: () => void;
  voltarAoSistema: () => void;
};

function Erro({ erro }: { erro: string | null }) {
  return erro ? (
    <Alert variant="destructive">
      <AlertDescription>{erro}</AlertDescription>
    </Alert>
  ) : null;
}

export function ConviteView({
  estado,
  nome,
  senha,
  erro,
  ocupado,
  acoes,
}: {
  estado: TelaDoConvite;
  nome: string;
  senha: string;
  erro: string | null;
  ocupado: boolean;
  acoes: AcoesDoConvite;
}) {
  if (estado.tela === "carregando") {
    return (
      <AuthShell title="Validando convite">
        <p role="status" className="text-center text-sm text-muted-foreground">
          Conferindo seu convite...
        </p>
      </AuthShell>
    );
  }

  if (estado.tela === "sem_convite") {
    return (
      <AuthShell title="Convite necessário">
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              {estado.motivo === "sem_link" ? "Este cadastro só funciona por link de convite." : "Convite inválido ou não encontrado."}
            </AlertDescription>
          </Alert>
          <Button type="button" variant="outline" className="w-full" onClick={acoes.voltarAoLogin}>
            Voltar para login
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (estado.tela === "outra_conta") {
    return (
      <AuthShell title="Você já está conectado">
        <div className="space-y-4">
          <p className="break-all font-semibold">{estado.email}</p>
          <Erro erro={erro} />
          <Button type="button" className="w-full" disabled={ocupado} onClick={acoes.sairDaOutraConta}>
            {ocupado ? "Saindo..." : "Sair e continuar com o convite"}
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={acoes.voltarAoSistema}>
            Voltar ao sistema
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (estado.tela === "confirmar") {
    return (
      <AuthShell title="Confirme seu e-mail">
        <div className="space-y-4">
          <span aria-hidden className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-info-soft text-info-soft-foreground">
            <Mail className="h-7 w-7" />
          </span>
          <p className="font-semibold">
            {estado.enviado ? "Enviamos um link para " : "Confirme o endereço "}<strong className="break-all">{estado.convite.email}</strong>.
          </p>
          {estado.reenviado ? (
            <p role="status" className="font-semibold text-success-soft-foreground">
              {MENSAGENS_DO_CONVITE.reenviado}
            </p>
          ) : null}
          <Erro erro={erro} />
          <Button type="button" className="w-full" disabled={ocupado} onClick={acoes.jaConfirmei}>
            {ocupado ? "Conferindo..." : "Já confirmei"}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={ocupado} onClick={acoes.reenviar}>
            Reenviar e-mail
          </Button>
          <button type="button" className="w-full text-sm font-medium text-primary hover:underline" onClick={acoes.sair}>
            Sair
          </button>
        </div>
      </AuthShell>
    );
  }

  if (estado.tela === "confirmado") {
    return (
      <AuthShell title="E-mail confirmado" subtitle={perfilDoConvite(estado.convite)}>
        <div className="space-y-4">
          <span aria-hidden className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-success-soft text-success-soft-foreground">
            <Check className="h-7 w-7" />
          </span>
          {/* Uma carga nova do app: a porta lê o perfil que o aceite criou. */}
          <Button asChild className="w-full">
            <a href={`${basePath}/`}>Entrar</a>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const { convite } = estado;
  return (
    <AuthShell title="Aceitar convite" subtitle="Crie sua senha para acessar">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          acoes.aceitar();
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="convite-nome">Nome</Label>
          <Input
            id="convite-nome"
            autoComplete="name"
            value={nome}
            onChange={(event) => acoes.nome(event.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="convite-email">E-mail</Label>
          <Input id="convite-email" type="email" autoComplete="email" value={convite.email} readOnly />
        </div>
        <p className="font-semibold">{`Perfil do convite: ${perfilDoConvite(convite)}`}</p>
        <div className="space-y-2">
          <Label htmlFor="convite-senha">Senha</Label>
          <Input
            id="convite-senha"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={senha}
            onChange={(event) => acoes.senha(event.target.value)}
            required
          />
        </div>
        <Erro erro={erro} />
        <Button type="submit" className="w-full" disabled={ocupado || Boolean(firebaseConfigError)}>
          {ocupado ? "Aceitando..." : "Aceitar convite"}
        </Button>
      </form>
      <button type="button" className="mt-4 w-full text-sm font-medium text-primary hover:underline" onClick={acoes.jaTenhoConta}>
        Já tenho conta
      </button>
    </AuthShell>
  );
}

async function lerConvite(token: string): Promise<ConviteLido | null> {
  if (!firebaseApp) return null;
  const procurar = httpsCallable<{ token: string }, unknown>(functionsDoApp(firebaseApp), "lookupInvite");
  return conviteLido(token, (await procurar({ token })).data);
}

async function aceitarNoServidor(token: string, nome: string): Promise<void> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const aceitar = httpsCallable<{ token: string; nome: string }, unknown>(functionsDoApp(firebaseApp), "acceptInvite");
  await aceitar({ token, nome });
}

type ResultadoDoEnvio = { ok: true; status: "sent" | "already_verified" };

async function enviarConfirmacao(token: string): Promise<ResultadoDoEnvio> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const enviar = httpsCallable<{ token: string }, ResultadoDoEnvio>(functionsDoApp(firebaseApp), "sendInviteEmailVerification");
  const { data } = await enviar({ token });
  if (data?.ok !== true || !["sent", "already_verified"].includes(data.status)) throw new Error("Resposta de envio inválida.");
  return data;
}

export default function ConvitePage() {
  const [, setLocation] = useLocation();
  const { user, firebaseUser, isLoaded } = useAppUser();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("invite")?.trim() ?? "");
  const [leitura, setLeitura] = useState<"carregando" | "sem_link" | "invalido" | ConviteLido>(token ? "carregando" : "sem_link");
  const [passo, setPasso] = useState<"formulario" | "confirmar" | "confirmado">("formulario");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  // O "Aceitar convite" cria a conta, e a conta nova muda a sessão no meio dele.
  const emAndamento = useRef(false);
  const convite = typeof leitura === "object" ? leitura : null;

  useEffect(() => {
    if (!token) return;
    let ativo = true;
    lerConvite(token)
      .then((lido) => {
        if (!ativo) return;
        setLeitura(lido ?? "invalido");
        if (lido) setNome((atual) => atual || lido.nome);
      })
      .catch(() => {
        if (ativo) setLeitura("invalido");
      });
    return () => {
      ativo = false;
    };
  }, [token]);

  async function aceitarConfirmado(usuario: User) {
    if (!convite) return;
    // O token novo leva o e-mail confirmado ao servidor.
    await usuario.getIdToken(true);
    await aceitarNoServidor(convite.token, nomeDoAceite(nome, usuario.displayName, convite));
    setPasso("confirmado");
  }

  async function solicitarConfirmacao(usuario: User, reenvio = false) {
    if (!convite) return;
    // A conta já existe mesmo se o provedor falhar. Mantém o reenvio disponível.
    setPasso("confirmar");
    setEnviado(false);
    setReenviado(false);
    let resultado: ResultadoDoEnvio;
    try {
      resultado = await enviarConfirmacao(convite.token);
    } catch (falha) {
      setErro(mensagemDoEnvioDeConfirmacao(falha));
      return;
    }
    if (resultado.status === "already_verified") {
      await reload(usuario);
      if (usuario.emailVerified) await aceitarConfirmado(usuario);
      else setErro(MENSAGENS_DO_CONVITE.semConfirmacao);
      return;
    }
    setEnviado(true);
    setReenviado(reenvio);
  }

  /** Com a conta do convite na janela: aceita se o e-mail já está confirmado, ou pede a confirmação. */
  async function seguir(usuario: User, enviar: boolean) {
    if (!convite) return;
    await reload(usuario);
    if (usuario.emailVerified) {
      await aceitarConfirmado(usuario);
      return;
    }
    setPasso("confirmar");
    if (enviar) await solicitarConfirmacao(usuario);
  }

  async function executar(acao: () => Promise<void>) {
    emAndamento.current = true;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
    } catch (falha) {
      setErro(mensagemDoConvite(falha));
    } finally {
      emAndamento.current = false;
      setOcupado(false);
    }
  }

  // Voltou pelo link do e-mail, ou recarregou a página: segue de onde parou, sem mandar outro e-mail.
  const contaDoConvite = firebaseUser && convite && !user && (firebaseUser.email ?? "").toLowerCase() === convite.email ? firebaseUser : null;
  useEffect(() => {
    if (!contaDoConvite || passo !== "formulario" || emAndamento.current) return;
    void executar(() => seguir(contaDoConvite, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaDoConvite, passo]);

  const acoes: AcoesDoConvite = {
    nome: setNome,
    senha: setSenha,
    aceitar: () =>
      void executar(async () => {
        if (!firebaseAuth || !convite) return;
        let usuario: User;
        try {
          usuario = (await createUserWithEmailAndPassword(firebaseAuth, convite.email, senha)).user;
          await updateProfile(usuario, { displayName: nomeDoAceite(nome, null, convite) });
        } catch (falha) {
          if ((falha as { code?: unknown }).code !== "auth/email-already-in-use") throw falha;
          usuario = (await signInWithEmailAndPassword(firebaseAuth, convite.email, senha)).user;
        }
        await seguir(usuario, true);
      }),
    jaConfirmei: () =>
      void executar(async () => {
        const usuario = firebaseAuth?.currentUser;
        if (!usuario) {
          setPasso("formulario");
          return;
        }
        await reload(usuario);
        if (!usuario.emailVerified) {
          setErro(MENSAGENS_DO_CONVITE.semConfirmacao);
          return;
        }
        await aceitarConfirmado(usuario);
      }),
    reenviar: () =>
      void executar(async () => {
        const usuario = firebaseAuth?.currentUser;
        if (!usuario || !convite) return;
        await solicitarConfirmacao(usuario, true);
      }),
    sair: () =>
      void executar(async () => {
        if (firebaseAuth) await signOut(firebaseAuth);
        setSenha("");
        setEnviado(false);
        setReenviado(false);
        setPasso("formulario");
      }),
    jaTenhoConta: () => setLocation("/sign-in"),
    voltarAoLogin: () => setLocation("/sign-in"),
    sairDaOutraConta: () =>
      void executar(async () => {
        if (firebaseAuth) await signOut(firebaseAuth);
      }),
    voltarAoSistema: () => setLocation("/"),
  };

  const estado: TelaDoConvite =
    // O aceite feito vale mais que a sessão: a conta nova pode já ter o perfil.
    passo === "confirmado" && convite
      ? { tela: "confirmado", convite }
      : isLoaded && user
        ? { tela: "outra_conta", email: user.primaryEmailAddress.emailAddress }
        : leitura === "carregando"
          ? { tela: "carregando" }
          : leitura === "sem_link" || leitura === "invalido"
            ? { tela: "sem_convite", motivo: leitura }
            : passo === "confirmar"
              ? { tela: "confirmar", convite: leitura, reenviado, enviado }
              : { tela: "formulario", convite: leitura };

  return <ConviteView estado={estado} nome={nome} senha={senha} erro={erro} ocupado={ocupado} acoes={acoes} />;
}
