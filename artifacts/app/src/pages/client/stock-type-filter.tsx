import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type StockTypeFilterProps = {
  categories: Array<{ value: string; label: string; count: number }>;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  resetKey?: number;
};

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function StockTypeFilter({ categories, selectedValues, onChange, resetKey }: StockTypeFilterProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSearch("");
    setExpanded(false);
  }, [resetKey]);

  const types = categories.filter((category) => category.value !== "todos");
  const firstTypes = types.slice(0, 3);
  const query = normalizeSearch(search);
  const visibleTypes = query
    ? types.filter((category) => normalizeSearch(category.label).includes(query))
    : expanded ? types : firstTypes;
  const hiddenSelectionCount = !expanded && !query
    ? selectedValues.filter((value) => !firstTypes.some((category) => category.value === value)).length
    : 0;
  const listId = `${id}-types`;
  const hiddenSelectionId = `${id}-hidden-selection`;

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-sm font-semibold text-foreground">Tipo de produto</legend>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar tipo"
          aria-label="Buscar tipo de produto"
          className="h-11 pl-9"
        />
      </div>
      <div className="flex min-h-9 items-center gap-3 px-1">
        <Checkbox id={`${id}-all`} checked={selectedValues.length === 0} onCheckedChange={() => onChange([])} />
        <Label htmlFor={`${id}-all`} className="flex-1 cursor-pointer py-2 leading-5">Todos os tipos</Label>
      </div>
      <div id={listId} className={cn("space-y-1 px-1", (expanded || query) && "max-h-40 overflow-y-auto overscroll-contain")}>
        {visibleTypes.map((category) => {
          const selected = selectedValues.includes(category.value);
          const checkboxId = `${id}-type-${category.value}`;
          return (
            <div key={category.value} className="flex min-h-9 items-center gap-3">
              <Checkbox
                id={checkboxId}
                checked={selected}
                onCheckedChange={(checked) => onChange(checked === true
                  ? [...selectedValues, category.value]
                  : selectedValues.filter((value) => value !== category.value))}
              />
              <Label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer py-2 leading-5">{category.label}</Label>
            </div>
          );
        })}
        {visibleTypes.length === 0 ? <p role="status" className="py-3 text-sm text-muted-foreground">Nenhum tipo encontrado.</p> : null}
      </div>
      {!query && types.length > 3 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-1 text-primary"
            aria-controls={listId}
            aria-expanded={expanded}
            aria-describedby={hiddenSelectionCount ? hiddenSelectionId : undefined}
            onClick={() => {
              setExpanded((value) => !value);
              setSearch("");
            }}
          >
            {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            {expanded ? "Ver menos tipos" : "Ver mais tipos"}
          </Button>
          {hiddenSelectionCount ? (
            <span id={hiddenSelectionId} className="text-xs text-muted-foreground">
              {hiddenSelectionCount} {hiddenSelectionCount === 1 ? "selecionado" : "selecionados"} fora da lista
            </span>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
