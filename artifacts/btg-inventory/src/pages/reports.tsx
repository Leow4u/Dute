import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileJson,
  FileSpreadsheet,
  MapPinned,
  PackageSearch,
  RefreshCcw,
  Rows3,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ReportType = "products" | "skus" | "movements" | "orders";
type ExportFormat = "json" | "csv";

const reportCatalog: Array<{
  value: ReportType;
  label: string;
  description: string;
  cadence: string;
  fields: string[];
  icon: typeof Database;
}> = [
  {
    value: "products",
    label: "Catálogo Mestre de Produtos",
    description: "Base de itens BTG para conferência, valoração e saneamento cadastral.",
    cadence: "Operacional diário",
    fields: ["SKU", "Produto", "Categoria", "Custo", "Saldo"],
    icon: PackageSearch,
  },
  {
    value: "skus",
    label: "SKUs e Localizações",
    description: "Mapa de posições para leitura rápida de rua, prateleira, caixa e estoque.",
    cadence: "Atualização de armazém",
    fields: ["SKU", "Local", "Rua", "Prateleira", "Caixa"],
    icon: MapPinned,
  },
  {
    value: "movements",
    label: "Movimentações Kardex",
    description: "Linha do tempo de entradas, saídas e ajustes para rastreabilidade.",
    cadence: "Auditoria contínua",
    fields: ["Data", "Tipo", "Origem", "Quantidade", "Saldo"],
    icon: Rows3,
  },
  {
    value: "orders",
    label: "Histórico de Pedidos",
    description: "Pedidos exportáveis para conciliação de atendimento e expedição.",
    cadence: "Fechamento por período",
    fields: ["Pedido", "Cliente", "Status", "Data", "Itens"],
    icon: Truck,
  },
];

const quickReports = [
  {
    title: "Valoração Completa do Estoque",
    description: "Catálogo e saldos para fechamento financeiro.",
    type: "products" as ReportType,
    icon: ShieldCheck,
  },
  {
    title: "Todas as Movimentações",
    description: "Kardex completo para auditoria operacional.",
    type: "movements" as ReportType,
    icon: Rows3,
  },
  {
    title: "Mapa de Localizações do Armazém",
    description: "Endereçamento de SKUs por posição física.",
    type: "skus" as ReportType,
    icon: MapPinned,
  },
];

function formatDateLabel(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default function Reports() {
  const [type, setType] = useState<ReportType>("products");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const selectedReport = useMemo(
    () => reportCatalog.find((report) => report.value === type) ?? reportCatalog[0],
    [type],
  );

  const periodLabel = useMemo(() => {
    if (dateFrom && dateTo) {
      return `${formatDateLabel(dateFrom)} até ${formatDateLabel(dateTo)}`;
    }
    if (dateFrom) return `A partir de ${formatDateLabel(dateFrom)}`;
    if (dateTo) return `Até ${formatDateLabel(dateTo)}`;
    return "Sem filtro de data";
  }, [dateFrom, dateTo]);

  const setPresetRange = (days: number) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    setDateFrom(start.toISOString().slice(0, 10));
    setDateTo(today.toISOString().slice(0, 10));
  };

  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
  };

  const handleExport = async (format: ExportFormat, exportType: ReportType = type) => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.append("type", exportType);
      if (dateFrom) params.append("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.append("date_to", new Date(dateTo).toISOString());

      const response = await fetch(`/api/reports/export?${params.toString()}`);

      if (!response.ok) throw new Error("Falha na exportação");

      const data = await response.json();

      let blob;
      let filename;

      if (format === "json") {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        filename = `btg_export_${exportType}_${new Date().toISOString().split("T")[0]}.json`;
      } else {
        const items = data.data || [];
        if (items.length === 0) {
          toast({ title: "Nenhum dado para exportar" });
          setIsExporting(false);
          return;
        }
        const headers = Object.keys(items[0]).join(",");
        const rows = items.map((item: any) =>
          Object.values(item)
            .map((val) => `"${val}"`)
            .join(","),
        );
        const csv = [headers, ...rows].join("\n");
        blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        filename = `btg_export_${exportType}_${new Date().toISOString().split("T")[0]}.csv`;
      }

      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      toast({ title: "Exportação concluída com sucesso" });
    } catch {
      toast({ title: "Falha na exportação", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const SelectedIcon = selectedReport.icon;

  return (
    <div className="space-y-5">
      <section className="glass-surface overflow-hidden rounded-[28px] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-primary/20 bg-primary/10 text-primary">
              <Database className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground md:text-2xl">
                Relatórios e exportação
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Badge variant="secondary" className="justify-center gap-1.5 py-1.5">
              <CheckCircle2 className="size-3.5 text-primary" />
              CSV
            </Badge>
            <Badge variant="secondary" className="justify-center gap-1.5 py-1.5">
              <FileJson className="size-3.5 text-primary" />
              JSON
            </Badge>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="border-b border-border/70 bg-white/35 pb-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-lg">Montar exportação</CardTitle>
              </div>
              <Badge variant="outline" className="w-fit gap-1.5">
                <Clock3 className="size-3.5 text-primary" />
                {periodLabel}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-5 md:pt-6">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
              <div className="space-y-2">
                <Label htmlFor="dataset">Conjunto de dados</Label>
                <Select value={type} onValueChange={(value) => setType(value as ReportType)}>
                  <SelectTrigger id="dataset" className="h-11 w-full bg-white/70">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reportCatalog.map((report) => (
                      <SelectItem key={report.value} value={report.value}>
                        {report.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date-from">Data inicial</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="h-11 bg-white/70"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="date-to">Data final</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="h-11 bg-white/70"
                />
              </div>
            </div>

            <div className="soft-panel rounded-[22px] p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <CalendarDays className="size-4 text-primary" />
                  Atalhos de período
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button variant="outline" size="sm" onClick={() => setPresetRange(1)}>
                    Hoje
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPresetRange(7)}>
                    7 dias
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPresetRange(30)}>
                    30 dias
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearDates}>
                    <RefreshCcw />
                    Limpar
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/70 bg-white/35 pb-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/65 text-primary">
                <SelectedIcon className="size-4" />
              </div>
              <div>
                <CardTitle className="text-lg">Prévia do pacote</CardTitle>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-5 pt-5 md:pt-6">
            <div>
              <div className="text-sm font-semibold text-foreground">{selectedReport.label}</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-border/75 bg-white/50 p-4">
                <div className="text-xs font-medium text-muted-foreground">Cadência</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {selectedReport.cadence}
                </div>
              </div>
              <div className="rounded-[20px] border border-border/75 bg-white/50 p-4">
                <div className="text-xs font-medium text-muted-foreground">Período</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{periodLabel}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Campos esperados</div>
              <div className="flex flex-wrap gap-2">
                {selectedReport.fields.map((field) => (
                  <Badge key={field} variant="outline">
                    {field}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                className="h-11 justify-center"
                onClick={() => handleExport("csv")}
                disabled={isExporting}
              >
                <FileSpreadsheet className="size-4" />
                Exportar CSV
              </Button>
              <Button
                className="h-11 justify-center"
                onClick={() => handleExport("json")}
                disabled={isExporting}
              >
                <FileJson className="size-4" />
                Exportar JSON
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Relatórios rápidos</h2>
            <p className="text-sm text-muted-foreground">
              Saídas recorrentes em CSV para rotinas de conferência e fechamento.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {quickReports.map((report) => {
            const Icon = report.icon;
            const isActive = report.type === type;

            return (
              <button
                key={report.title}
                type="button"
                onClick={() => {
                  setType(report.type);
                  handleExport("csv", report.type);
                }}
                disabled={isExporting}
                className={cn(
                  "soft-panel group flex min-h-[154px] flex-col justify-between rounded-[22px] p-4 text-left outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60",
                  "hover:-translate-y-0.5 hover:border-primary/25 hover:bg-white/70 hover:shadow-[0_18px_60px_rgba(15,23,42,.07)]",
                  isActive && "border-primary/25 bg-white/72",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <Badge variant={isActive ? "default" : "outline"}>CSV</Badge>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold leading-5 text-foreground">
                    {report.title}
                  </div>
                  <p className="text-sm leading-5 text-muted-foreground">{report.description}</p>
                </div>

                <div className="flex items-center justify-between text-xs font-medium text-primary">
                  Baixar agora
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
