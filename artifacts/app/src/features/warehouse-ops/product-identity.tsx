import { useEffect, useState } from "react";
import { CheckCircle2, ImageOff, PackageSearch } from "lucide-react";
import { problemaDoNome, type ProblemaDoNome } from "@workspace/dominio";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Checkbox } from "@/components/ui/checkbox";
import { FalhaNaLeitura, type LeituraQueFalhou } from "@/components/ui/erro-na-leitura";
import { Label } from "@/components/ui/label";
import { useEspera } from "@/lib/carregando/use-espera";
import type { ProductLookupItem } from "./shared";

export function ProductIdentityCard({
  product,
  matchLabel,
  selected = false,
  onSelect,
}: {
  product: ProductLookupItem;
  matchLabel?: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  const details = [
    ["Cód. cliente", product.clientCode],
    ["SKU", product.skuCode],
    ["Tamanho", product.size],
    ["Cor", product.color],
    ["Marca", product.brand],
    ["Código de barras", product.barcode],
  ];
  return (
    <section aria-label="Cadastro encontrado" className="@container rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        <span>{selected ? "Cadastro selecionado" : "Cadastro encontrado"}{matchLabel ? ` ${matchLabel}` : ""}</span>
      </div>
      <div className="flex flex-col gap-4 @sm:flex-row">
        {product.photoUrl ? (
          <img src={product.photoUrl} alt={product.productName} className="size-24 shrink-0 rounded-md border border-border bg-card object-contain" />
        ) : (
          <div className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted text-xs text-muted-foreground">
            <ImageOff className="size-6" aria-hidden="true" />
            Sem foto
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <h3 className="break-words text-base font-semibold text-foreground">{product.productName}</h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 @sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words text-sm text-foreground">{value || "Não informado"}</dd>
              </div>
            ))}
          </dl>
          <Button type="button" variant="outline" disabled={selected} onClick={onSelect}>
            {selected ? "Cadastro selecionado" : "Usar este cadastro"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function NewProductNotice({
  confirmed,
  disabled = false,
  note,
  title,
  onToggle,
}: {
  confirmed: boolean;
  disabled?: boolean;
  note: string;
  title?: string;
  onToggle: () => void;
}) {
  const Icon = confirmed ? CheckCircle2 : PackageSearch;
  return (
    <div role="status" className="@container rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{confirmed ? "Produto novo confirmado" : title ?? "Produto não localizado pelo código informado"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={disabled} onClick={onToggle}>
          {confirmed ? "Rever identificação" : "Cadastrar como novo"}
        </Button>
      </div>
    </div>
  );
}

const LISTA = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

/**
 * O código novo de uma família que já está no cadastro (A.02.0809.002.GG com
 * o P, o M e o G cadastrados): no lugar do aviso de produto novo, o cartão diz
 * a família e os tamanhos dela, e o mesmo controle de cadastrar como novo
 * (docs/mockups/NomeWmsContagem.dc.html).
 */
export function FamiliaNoCadastroCard({
  id,
  familia,
  nome,
  tamanhos,
  tamanho,
  fotoUrl,
  confirmed,
  disabled = false,
  note,
  onToggle,
}: {
  id: string;
  /** O código sem o tamanho: "A.02.0809.002". */
  familia: string;
  /** O nome da família no padrão. */
  nome: string;
  /** Os tamanhos já cadastrados, na ordem natural. */
  tamanhos: string[];
  /** O tamanho novo, o do código digitado. */
  tamanho: string;
  fotoUrl?: string;
  confirmed: boolean;
  disabled?: boolean;
  /** O bloqueio que a tela informa (sem a sigla do SKU, por exemplo). */
  note?: string;
  onToggle: (confirmed: boolean) => void;
}) {
  const titulo = `Família ${familia} · ${tamanhos.length} ${tamanhos.length === 1 ? "tamanho" : "tamanhos"} no cadastro`;
  const linha = [nome, LISTA.format(tamanhos), `tamanho ${tamanho} novo`].filter(Boolean).join(" · ");
  return (
    <div role="status" className="@container rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center">
        {fotoUrl ? (
          <img src={fotoUrl} alt="Foto da família" className="size-14 shrink-0 rounded-md border border-border bg-card object-contain" />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <PackageSearch className="size-5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-foreground">{titulo}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{linha}</p>
          {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Checkbox id={id} checked={confirmed} disabled={disabled} onCheckedChange={(checked) => onToggle(checked === true)} />
          <Label htmlFor={id} className="leading-5">{`Cadastrar o tamanho ${tamanho} como novo`}</Label>
        </div>
      </div>
    </div>
  );
}

/**
 * O campo depois da sugestão da tela (o Tamanho pelo código, os dados da
 * família): a sugestão entra no campo vazio e no que a própria tela pôs, que
 * acompanha o código digitado letra a letra ("…G" e depois "…GG"); o que a
 * pessoa digitou fica. `posto` é o que a tela deixou no campo.
 */
export function seguirSugestao(atual: string, posto: string, sugerido: string): { valor: string; posto: string } {
  const daTela = !atual.trim() || (posto !== "" && atual === posto);
  return daTela ? { valor: sugerido, posto: sugerido } : { valor: atual, posto: "" };
}

/** Onde a tela mostra o problema do nome: no Tamanho quando o campo contradiz o código; no nome nos outros casos. */
export function campoDoProblemaDoNome(problema: Pick<ProblemaDoNome, "tipo">): "nome" | "tamanho" {
  return problema.tipo === "campo_com_outro_tamanho" ? "tamanho" : "nome";
}

/** O campo com problema: inválido e descrito pela mensagem embaixo dele (`<id>-problema`). */
export function atributosDoProblema(problema: unknown, id: string) {
  return problema ? { "aria-invalid": true as const, "aria-describedby": `${id}-problema` } : {};
}

const texto = (valor: unknown) => String(valor ?? "").trim();

/**
 * O que o Catálogo recusa antes de enviar, pelo padrão do nome de 06/11/2026
 * (lib/dominio, nome-do-produto.ts): o nome de um produto novo, ou o nome e o
 * tamanho que mudaram na edição. Editar outra coisa de um produto cujo nome
 * antigo ainda tem o tamanho não trava: o nome não mudou, e os nomes antigos
 * mudam no passo 3.
 */
export function problemaDoNomeNoCadastro(
  dados: { produto?: unknown; cod_cliente?: unknown; tamanho?: unknown },
  antes?: { produto?: unknown; tamanho?: unknown },
): { campo: "produto" | "tamanho"; problema: ProblemaDoNome } | null {
  if (antes && texto(dados.produto) === texto(antes.produto)) {
    if (texto(dados.tamanho) === texto(antes.tamanho)) return null;
    // Só o Tamanho mudou: o nome antigo fica até o passo 3; o que trava é o
    // Tamanho que contradiz o código (o mesmo que o servidor confere).
    const doTamanho = problemaDoNome({ nome: "Produto", codigo: dados.cod_cliente, tamanho: dados.tamanho });
    return doTamanho?.tipo === "campo_com_outro_tamanho" ? { campo: "tamanho", problema: doTamanho } : null;
  }
  const problema = problemaDoNome({ nome: dados.produto, codigo: dados.cod_cliente, tamanho: dados.tamanho });
  if (!problema) return null;
  return { campo: campoDoProblemaDoNome(problema) === "tamanho" ? "tamanho" : "produto", problema };
}

/**
 * O problema do nome que a tela mostra embaixo do campo: o de agora, depois
 * de um instante parado. Enquanto a pessoa digita, o "P" de "Polo" não acende
 * "O nome do produto não pode ser só o tamanho."; o botão já fica desligado
 * pelo problema de agora. Resolvido, some na hora. `chave` separa os campos
 * de linhas diferentes.
 */
export function useProblemaAoParar<T extends { mensagem: string }>(problema: T | null, chave = "", espera = 600): T | null {
  const assinatura = problema ? `${chave}\n${problema.mensagem}` : "";
  const [assentada, setAssentada] = useState("");
  useEffect(() => {
    if (!assinatura) return undefined;
    const relogio = setTimeout(() => setAssentada(assinatura), espera);
    return () => clearTimeout(relogio);
  }, [assinatura, espera]);
  return problema && assentada === assinatura ? problema : null;
}

/**
 * O catálogo do cliente ainda não chegou: a tela não diz que o produto não
 * existe nem oferece o cadastro novo antes de ler
 * (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026). É a
 * espera em bloco do carregamento v2 (parte 13c): nada antes de 300 ms, a
 * caixa de 24 px e "Verificando o catálogo…", com o anúncio pelo Anunciador;
 * sem região viva solta. A mesma na chegada avulsa, nas Devoluções e na
 * contagem cíclica; a abertura usa a mesma `CarregandoNaRegiao`.
 */
export function CatalogoVerificando({ className }: { className?: string }) {
  return <CarregandoNaRegiao rotulo="Verificando o catálogo…" className={className} />;
}

/**
 * O catálogo não veio: a falha no lugar do cadastro achado, com a nova
 * tentativa, e nada de "não localizado" nem de cadastro novo, que fica
 * bloqueado (o PR 2 da seção 6 do diagnóstico, parte 13c). É a
 * `FalhaNaLeitura`: a falha fica na tela enquanto tenta de novo (`erro`, da
 * cópia da `useLeituraComFalha`), "Tentando de novo…" só na nova tentativa que
 * a pessoa pede, a falta de conexão como "Sem conexão." ou "Reconectando…" e,
 * quando o catálogo chega com o foco no aviso, o foco vai ao código digitado
 * (`focoAoSair`).
 */
export function CatalogoIndisponivel({
  leitura,
  erro,
  mensagem = "Não consegui carregar o catálogo.",
  focoAoSair,
  className,
}: {
  leitura: LeituraQueFalhou;
  erro?: unknown;
  mensagem?: string;
  focoAoSair?: string;
  className?: string;
}) {
  return <FalhaNaLeitura leitura={leitura} erro={erro} mensagem={mensagem} focoAoSair={focoAoSair} className={className} />;
}

/**
 * A falha do catálogo na tela (o PR 2 da seção 6 do diagnóstico, parte 13c):
 * o "Verificando o catálogo…" que já apareceu fica o mínimo de 500 ms antes de
 * a falha tomar o lugar dele (o relógio da espera, seção 3), e a pessoa não vê
 * a caixa piscar e virar o alerta. A falha que chega antes de 300 ms entra na
 * hora. `esperando`: a tela mostra a espera do catálogo (há código digitado e
 * ele ainda não chegou). O catálogo que chega não espera nada.
 */
export function useFalhaDoCatalogo(falhou: boolean, esperando: boolean): boolean {
  const espera = useEspera(esperando && !falhou, { segurarMinimo: true });
  return falhou && !espera.visivel;
}
