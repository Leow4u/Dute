import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatarData } from "@/lib/operacao/cadastro";
import {
  equipeDe,
  nomeDe,
  placaDe,
  quando,
  rotuloDaDemandaFora,
  type AgendaEmEdicao,
  type DemandaParaAbrir,
  type OsDaFila,
  type QuadroDoDia,
} from "@/lib/operacao/fila";

/** Fila do dia (docs/plataforma/fase-3-operacao.md, parte 3). Sem preço. */

export type EstadoDaFila = "carregando" | "erro" | "pronto";

export type PessoaDaEquipe = { id: string; nome: string; funcao: string; ativo: boolean };

export type VeiculoDaAgenda = { id: string; placa: string; tipo: string; ativo: boolean };

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Cartao({
  os,
  cliente,
  pessoas,
  placas,
  onAbrir,
}: {
  os: OsDaFila;
  cliente: string;
  pessoas: Readonly<Record<string, string>>;
  placas: Readonly<Record<string, string>>;
  onAbrir: (os: OsDaFila) => void;
}) {
  const item = os.itens[0];
  const servico = item ? (item.quantidade ? `${item.item} · ${item.quantidade}` : item.item) : "Sem item";
  const escala = os.agenda
    ? [quando(os.agenda), equipeDe(os.agenda.equipe, pessoas), placaDe(os.agenda.veiculo_id, placas)].filter(Boolean).join(" · ")
    : "";
  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(os)}
        className="flex w-full flex-col items-start gap-1 rounded-md border border-border bg-card px-4 py-3 text-left hover:bg-surface-hover"
      >
        <span className="text-sm font-medium text-foreground">{os.numero}</span>
        {os.demandaFora ? <span className="text-sm font-medium text-destructive">{rotuloDaDemandaFora(os.demandaFora)}</span> : null}
        <span className="text-sm text-foreground">{cliente}</span>
        <span className="text-sm text-muted-foreground">{servico}</span>
        {escala ? <span className="text-sm text-muted-foreground">{escala}</span> : null}
      </button>
    </li>
  );
}

function Coluna({
  titulo,
  ordens,
  nomesClientes,
  nomesPessoas,
  placas,
  vazio,
  onAbrir,
}: {
  titulo: string;
  ordens: readonly OsDaFila[];
  nomesClientes: Readonly<Record<string, string>>;
  nomesPessoas: Readonly<Record<string, string>>;
  placas: Readonly<Record<string, string>>;
  vazio: string;
  onAbrir: (os: OsDaFila) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        <span className="text-sm text-muted-foreground">{ordens.length}</span>
      </header>
      {ordens.length === 0 ? <p className="text-sm text-muted-foreground">{vazio}</p> : null}
      <ul className="flex flex-col gap-3">
        {ordens.map((os) => (
          <Cartao
            key={os.numero}
            os={os}
            cliente={nomeDe(os.customer_code, nomesClientes)}
            pessoas={nomesPessoas}
            placas={placas}
            onAbrir={onAbrir}
          />
        ))}
      </ul>
    </section>
  );
}

function Ficha({
  os,
  cliente,
  pessoas,
  veiculos,
  agenda,
  onAgenda,
  onVoltar,
  onSalvar,
  onCancelar,
  ocupado,
  erro,
}: {
  os: OsDaFila;
  cliente: string;
  pessoas: readonly PessoaDaEquipe[];
  veiculos: readonly VeiculoDaAgenda[];
  agenda: AgendaEmEdicao;
  onAgenda: (agenda: AgendaEmEdicao) => void;
  onVoltar: () => void;
  onSalvar: () => void;
  onCancelar: () => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const item = os.itens[0]?.item;
  const fora = os.demandaFora ?? null;
  const podeSalvar = !fora && Boolean(agenda.data && agenda.equipe.length > 0 && agenda.veiculoId);
  function alternar(id: string, marcado: boolean) {
    const equipe = marcado ? [...agenda.equipe, id] : agenda.equipe.filter((atual) => atual !== id);
    onAgenda({ ...agenda, equipe });
  }
  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (podeSalvar) onSalvar();
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold text-foreground">{os.numero}</h2>
          {fora ? <p className="text-sm font-medium text-destructive">{rotuloDaDemandaFora(fora)}</p> : null}
          <p className="text-sm text-foreground">{cliente}</p>
          {item ? <p className="text-sm text-muted-foreground">{item}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={onVoltar}>Voltar</Button>
          {fora ? null : <Button type="submit" disabled={ocupado || !podeSalvar}>Salvar</Button>}
        </div>
      </header>
      {erro ? <p role="alert" className="text-sm text-destructive">{erro}</p> : null}
      {fora ? null : (
        <>
          <Campo id="os-data" rotulo="Data">
            <Input id="os-data" type="date" value={agenda.data} onChange={(event) => onAgenda({ ...agenda, data: event.target.value })} />
          </Campo>
          <Campo id="os-hora" rotulo="Hora">
            <Input id="os-hora" type="time" value={agenda.hora} onChange={(event) => onAgenda({ ...agenda, hora: event.target.value })} />
          </Campo>
          <div className="flex flex-col gap-2">
            <p id="os-equipe" className="text-sm font-medium text-foreground">Equipe</p>
            {pessoas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum colaborador ativo.</p> : null}
            <ul aria-labelledby="os-equipe" className="flex flex-col gap-2">
              {pessoas.map((pessoa) => (
                <li key={pessoa.id}>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={agenda.equipe.includes(pessoa.id)}
                      onChange={(event) => alternar(pessoa.id, event.target.checked)}
                    />
                    <span>{pessoa.nome}</span>
                    <span className="text-muted-foreground">{pessoa.funcao}</span>
                    {pessoa.ativo ? null : <span className="text-muted-foreground">Desativado</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <Campo id="os-veiculo" rotulo="Veículo">
            <select
              id="os-veiculo"
              className={campoClasse}
              value={agenda.veiculoId}
              onChange={(event) => onAgenda({ ...agenda, veiculoId: event.target.value })}
            >
              <option value="">Escolha</option>
              {veiculos.map((veiculo) => (
                <option key={veiculo.id} value={veiculo.id}>
                  {veiculo.ativo ? `${veiculo.placa} · ${veiculo.tipo}` : `${veiculo.placa} · ${veiculo.tipo} · Desativado`}
                </option>
              ))}
            </select>
          </Campo>
        </>
      )}
      <Campo id="os-motivo" rotulo="Motivo">
        <Input id="os-motivo" value={agenda.motivo} onChange={(event) => onAgenda({ ...agenda, motivo: event.target.value })} />
      </Campo>
      <Button type="button" variant="destructive" disabled={ocupado || agenda.motivo.trim().length < 3} onClick={onCancelar}>
        Cancelar OS
      </Button>
    </form>
  );
}

export function FilaView({
  estado,
  hoje,
  demandas,
  quadro,
  nomesClientes,
  nomesPessoas,
  placas,
  pessoas,
  veiculos,
  os,
  agenda,
  onAgenda,
  onAbrirDemanda,
  onAbrirOs,
  onVoltar,
  onSalvar,
  onCancelar,
  ocupado,
  erro,
}: {
  estado: EstadoDaFila;
  hoje: string;
  demandas: readonly DemandaParaAbrir[];
  quadro: QuadroDoDia;
  nomesClientes: Readonly<Record<string, string>>;
  nomesPessoas: Readonly<Record<string, string>>;
  placas: Readonly<Record<string, string>>;
  pessoas: readonly PessoaDaEquipe[];
  veiculos: readonly VeiculoDaAgenda[];
  os: OsDaFila | null;
  agenda: AgendaEmEdicao | null;
  onAgenda: (agenda: AgendaEmEdicao) => void;
  onAbrirDemanda: (numero: string) => void;
  onAbrirOs: (os: OsDaFila) => void;
  onVoltar: () => void;
  onSalvar: () => void;
  onCancelar: () => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const colunas = [
    { titulo: "Para agendar", ordens: quadro.paraAgendar, vazio: "Nenhuma OS aberta" },
    { titulo: "Agendadas hoje", ordens: quadro.agendadasHoje, vazio: "Nenhuma OS hoje" },
    { titulo: "Outros dias", ordens: quadro.outrosDias, vazio: "Nenhuma OS em outro dia" },
  ];
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Hoje</h1>
        <p className="text-sm text-muted-foreground">{formatarData(hoje)}</p>
      </header>
      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar a fila.</p> : null}
      {estado === "pronto" ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">Para abrir</h2>
            {demandas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma demanda em Para planejar</p> : null}
            <ul className="flex flex-col gap-3">
              {demandas.map((demanda) => (
                <li key={demanda.numero} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">{demanda.numero}</span>
                    <span className="text-sm text-foreground">{nomeDe(demanda.customer_code, nomesClientes)}</span>
                    {demanda.titulo ? <span className="text-sm text-muted-foreground">{demanda.titulo}</span> : null}
                    {demanda.os_numeros.length > 0 ? (
                      <span className="text-sm text-muted-foreground">{demanda.os_numeros.join(", ")}</span>
                    ) : null}
                  </div>
                  <Button type="button" variant="secondary" disabled={ocupado} onClick={() => onAbrirDemanda(demanda.numero)}>
                    Abrir OS
                  </Button>
                </li>
              ))}
            </ul>
          </section>
          {os && agenda ? (
            <Ficha
              os={os}
              cliente={nomeDe(os.customer_code, nomesClientes)}
              pessoas={pessoas}
              veiculos={veiculos}
              agenda={agenda}
              onAgenda={onAgenda}
              onVoltar={onVoltar}
              onSalvar={onSalvar}
              onCancelar={onCancelar}
              ocupado={ocupado}
              erro={erro}
            />
          ) : (
            <>
              {erro ? <p role="alert" className="text-sm text-destructive">{erro}</p> : null}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {colunas.map((coluna) => (
                  <Coluna
                    key={coluna.titulo}
                    titulo={coluna.titulo}
                    ordens={coluna.ordens}
                    nomesClientes={nomesClientes}
                    nomesPessoas={nomesPessoas}
                    placas={placas}
                    vazio={coluna.vazio}
                    onAbrir={onAbrirOs}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
