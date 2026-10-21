import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { cn } from "@/lib/utils";

/** Selection is limited to persisted, active shelves in the current customer's zone. */
export function eligibleShelfPositions(positions: WarehousePosition[], customerCode: string) {
  if (!customerCode) return [];
  return positions
    .filter((position) => Boolean(position.code) && position.customer_code === customerCode && (position.status ?? "active") === "active")
    .sort((left, right) =>
      (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
      left.code.localeCompare(right.code, "pt-BR", { numeric: true }),
    );
}

/** An old response cannot unlock storage for a different box, client or measured draft. */
export function isCurrentShelfPreview(
  response: { generation: number; contextKey: string },
  current: { generation: number; contextKey: string },
) {
  return response.generation === current.generation && response.contextKey === current.contextKey;
}

export function ShelfPicker({
  positions,
  value,
  onSelect,
  disabled = false,
  loading = false,
}: {
  positions: WarehousePosition[];
  value: string;
  onSelect: (code: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected = positions.find((position) => position.code === value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Prateleira cadastrada</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" role="combobox" aria-expanded={open} variant="outline"
            disabled={disabled || loading} className="w-full justify-between bg-card font-normal">
            <span>{loading ? "Carregando prateleiras…" : selected?.code || "Selecione uma prateleira"}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput placeholder="Buscar prateleira…" aria-label="Buscar prateleira cadastrada" />
            <CommandList>
              <CommandEmpty>Nenhuma prateleira cadastrada nesta busca.</CommandEmpty>
              <CommandGroup>
                {positions.map((position) => (
                  <CommandItem key={position.code} value={position.code} onSelect={() => {
                    onSelect(position.code);
                    setOpen(false);
                  }}>
                    <span className="flex-1">{position.code}</span>
                    <Check className={cn("ml-2 size-4", value === position.code ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {!loading && positions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma prateleira ativa cadastrada na zona deste cliente.</p> : null}
    </div>
  );
}
