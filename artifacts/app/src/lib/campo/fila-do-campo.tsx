import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ref, uploadBytes } from "firebase/storage";

import { useAppUser } from "../auth";
import { firebaseStorage } from "../firebase";
import { chamarOperacao, mensagemDoErro, novaChave } from "../operacao/api";
import { adiado, avisoDaFila, destinoDoErro, enfileirar, faltaParaEnviar, registroNovo, type NovoRegistro, type RegistroNaFila } from "./fila";
import { armazemNoAparelho, type ArmazemDaFila } from "./fila-guardada";

/**
 * A fila do campo no aparelho (partes 3.8b e 3.8c): envia um registro de cada
 * vez, na ordem; sem sinal, espera e tenta de novo; recusado pela callable,
 * sai da fila e aparece como falha. A fila fica guardada no IndexedDB (por
 * pessoa): fechar o app sem sinal não perde nada, e ela volta ao abrir. Nada
 * sai antes de a fila guardada carregar, para a ordem continuar a dos toques.
 */

export type FalhaDaFila = { chave: string; rotulo: string; mensagem: string };

type ContextoDaFila = {
  pendentes: readonly RegistroNaFila[];
  falhas: readonly FalhaDaFila[];
  online: boolean;
  aviso: string | null;
  enviar: (novo: NovoRegistro) => void;
  dispensarFalha: (chave: string) => void;
};

const Contexto = createContext<ContextoDaFila | null>(null);

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const ligar = () => setOnline(true);
    const desligar = () => setOnline(false);
    window.addEventListener("online", ligar);
    window.addEventListener("offline", desligar);
    return () => {
      window.removeEventListener("online", ligar);
      window.removeEventListener("offline", desligar);
    };
  }, []);
  return online;
}

async function enviarRegistro(registro: RegistroNaFila): Promise<void> {
  if (registro.foto) {
    if (!firebaseStorage) throw new Error("Firebase não configurado.");
    await uploadBytes(ref(firebaseStorage, registro.foto.caminho), registro.foto.arquivo, { contentType: registro.foto.contentType }).catch((error: unknown) => {
      // Já subiu numa tentativa anterior: o storage.rules não deixa sobrescrever.
      if ((error as { code?: string })?.code !== "storage/unauthorized") throw error;
    });
  }
  await chamarOperacao(registro.callable, registro.dados);
}

export function FilaDoCampoProvider({ children, armazem: armazemDado }: { children: ReactNode; armazem?: ArmazemDaFila }) {
  const online = useOnline();
  const { user } = useAppUser();
  const uid = user?.uid ?? null;
  const armazem = useMemo(() => armazemDado ?? armazemNoAparelho(), [armazemDado]);
  const [fila, setFila] = useState<RegistroNaFila[]>([]);
  const [carregada, setCarregada] = useState(false);
  const [falhas, setFalhas] = useState<FalhaDaFila[]>([]);
  const [relogio, setRelogio] = useState(0);
  const enviando = useRef<string | null>(null);

  // Ao abrir: a fila guardada da pessoa vem antes do que já foi tocado agora.
  useEffect(() => {
    if (!uid) return undefined;
    let vivo = true;
    setCarregada(false);
    void armazem
      .carregar(uid)
      .catch(() => [] as RegistroNaFila[])
      .then((guardada) => {
        if (!vivo) return;
        setFila((atual) => [...guardada, ...atual.filter((registro) => !guardada.some((outro) => outro.chave === registro.chave))]);
        setCarregada(true);
      });
    return () => {
      vivo = false;
    };
  }, [armazem, uid]);

  // A cada mudança, a fila guardada passa a ser a atual (o que chegou sai).
  useEffect(() => {
    if (!uid || !carregada) return;
    void armazem.guardar(uid, fila).catch(() => undefined);
  }, [armazem, uid, carregada, fila]);

  const enviar = useCallback((novo: NovoRegistro) => {
    setFila((atual) => enfileirar(atual, registroNovo(novo, novaChave(), new Date()), enviando.current));
  }, []);

  useEffect(() => {
    const proximo = fila[0];
    if (!carregada || !online || !proximo || enviando.current) return undefined;
    // Depois de uma falha de rede, espera a vez dele (o sinal voltando também dispara).
    const falta = faltaParaEnviar(proximo, new Date());
    if (falta > 0) {
      const espera = window.setTimeout(() => setRelogio((valor) => valor + 1), falta);
      return () => window.clearTimeout(espera);
    }
    enviando.current = proximo.chave;
    void enviarRegistro(proximo)
      .then(() => setFila((atual) => atual.filter((item) => item.chave !== proximo.chave)))
      .catch((error: unknown) => {
        if (destinoDoErro(error) === "desistir") {
          setFila((atual) => atual.filter((item) => item.chave !== proximo.chave));
          setFalhas((atual) => [...atual, { chave: proximo.chave, rotulo: proximo.rotulo, mensagem: mensagemDoErro(error) }]);
          return;
        }
        setFila((atual) => atual.map((item) => (item.chave === proximo.chave ? adiado(item, new Date()) : item)));
      })
      .finally(() => {
        enviando.current = null;
        setRelogio((valor) => valor + 1);
      });
    return undefined;
    // O relógio dispara a próxima tentativa; a fila e o sinal, o próximo envio.
  }, [fila, online, relogio, carregada]);

  // O sinal voltou: quem esperava a vez tenta já.
  useEffect(() => {
    if (online) setFila((atual) => (atual.some((item) => item.esperarAte) ? atual.map((item) => ({ ...item, esperarAte: null })) : atual));
  }, [online]);

  const valor = useMemo<ContextoDaFila>(
    () => ({
      pendentes: fila,
      falhas,
      online,
      aviso: avisoDaFila(fila.length, online),
      enviar,
      dispensarFalha: (chave) => setFalhas((atual) => atual.filter((falha) => falha.chave !== chave)),
    }),
    [fila, falhas, online, enviar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useFilaDoCampo(): ContextoDaFila {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useFilaDoCampo deve ser usado dentro de FilaDoCampoProvider.");
  return valor;
}
