import type { ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  MODOS_DE_ENTREGA,
  MODO_ROTULO,
  type FormularioDaEntrega,
  type ModoDeEntrega,
  type ProblemasDaEntrega,
} from "@/lib/warehouse-ops/entrega";

/**
 * A entrega do pedido de saída (parte 4.5c; docs/mockups/WmsExpedicao.dc.html):
 * a escolha entre a entrega pela Dutelog e a retirada pelo cliente e os
 * campos de cada uma, para o diálogo de Pedidos. Só apresentação: o estado e
 * a gravação ficam em pages/pedidos.tsx. Sem legenda.
 */

function Campo({ id, rotulo, problema, children }: { id: string; rotulo: string; problema?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {problema ? (
        <p id={`${id}-problema`} className="text-xs font-medium text-destructive">
          {problema}
        </p>
      ) : null}
    </div>
  );
}

function invalido(problema: string | undefined, id: string) {
  return problema ? { "aria-invalid": true, "aria-describedby": `${id}-problema` } : {};
}

export function FormularioDaEntregaView({
  form,
  problemas,
  onForm,
}: {
  form: FormularioDaEntrega;
  /** O que falta, mostrado depois da primeira tentativa de salvar. */
  problemas: ProblemasDaEntrega;
  onForm: (form: FormularioDaEntrega) => void;
}) {
  const set = <K extends keyof FormularioDaEntrega>(campo: K, valor: FormularioDaEntrega[K]) => onForm({ ...form, [campo]: valor });
  return (
    <div className="grid gap-4">
      <Segmented<ModoDeEntrega>
        aria-label="Entrega"
        className="self-start"
        options={MODOS_DE_ENTREGA.map((modo) => ({ value: modo, label: MODO_ROTULO[modo] }))}
        value={form.modo}
        onChange={(modo) => set("modo", modo)}
      />
      {form.modo === "dutelog" ? (
        <Campo id="entrega-destino" rotulo="Destino" problema={problemas.destino}>
          <Input id="entrega-destino" value={form.destino} onChange={(event) => set("destino", event.target.value)} {...invalido(problemas.destino, "entrega-destino")} />
        </Campo>
      ) : null}
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-3">
          <Campo id="entrega-data" rotulo={form.modo === "dutelog" ? "Data" : "Retirada em"}>
            <Input id="entrega-data" type="date" value={form.data} onChange={(event) => set("data", event.target.value)} {...invalido(problemas.quando, "entrega-quando")} />
          </Campo>
          <Campo id="entrega-hora" rotulo="Hora">
            <Input id="entrega-hora" type="time" value={form.hora} onChange={(event) => set("hora", event.target.value)} {...invalido(problemas.quando, "entrega-quando")} />
          </Campo>
        </div>
        {problemas.quando ? (
          <p id="entrega-quando-problema" className="text-xs font-medium text-destructive">
            {problemas.quando}
          </p>
        ) : null}
      </div>
      {form.modo === "dutelog" ? (
        <>
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-3">
              <Campo id="entrega-contato" rotulo="Contato">
                <Input id="entrega-contato" value={form.contatoNome} onChange={(event) => set("contatoNome", event.target.value)} {...invalido(problemas.contato, "entrega-contato-tel")} />
              </Campo>
              <Campo id="entrega-contato-telefone" rotulo="Telefone">
                <Input id="entrega-contato-telefone" type="tel" value={form.contatoTelefone} onChange={(event) => set("contatoTelefone", event.target.value)} {...invalido(problemas.contato, "entrega-contato-tel")} />
              </Campo>
            </div>
            {problemas.contato ? (
              <p id="entrega-contato-tel-problema" className="text-xs font-medium text-destructive">
                {problemas.contato}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox checked={form.montagem} onCheckedChange={(valor) => set("montagem", valor === true)} />
              Montagem
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox checked={form.comRetorno} onCheckedChange={(valor) => set("comRetorno", valor === true)} />
              Desmontagem e retorno
            </label>
          </div>
          {form.comRetorno ? (
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-3">
                <Campo id="entrega-retorno-data" rotulo="Retorno em">
                  <Input id="entrega-retorno-data" type="date" value={form.retornoData} onChange={(event) => set("retornoData", event.target.value)} {...invalido(problemas.retorno, "entrega-retorno")} />
                </Campo>
                <Campo id="entrega-retorno-hora" rotulo="Hora">
                  <Input id="entrega-retorno-hora" type="time" value={form.retornoHora} onChange={(event) => set("retornoHora", event.target.value)} {...invalido(problemas.retorno, "entrega-retorno")} />
                </Campo>
              </div>
              {problemas.retorno ? (
                <p id="entrega-retorno-problema" className="text-xs font-medium text-destructive">
                  {problemas.retorno}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="entrega-quem" rotulo="Quem retira" problema={problemas.quemRetira}>
              <Input id="entrega-quem" value={form.quemRetira} onChange={(event) => set("quemRetira", event.target.value)} {...invalido(problemas.quemRetira, "entrega-quem")} />
            </Campo>
            <Campo id="entrega-placa" rotulo="Placa do veículo" problema={problemas.placa}>
              <Input id="entrega-placa" value={form.placa} onChange={(event) => set("placa", event.target.value)} {...invalido(problemas.placa, "entrega-placa")} />
            </Campo>
          </div>
        </>
      )}
    </div>
  );
}
