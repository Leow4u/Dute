import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Reports() {
  const [type, setType] = useState("products");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async (format: 'json' | 'csv') => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.append("type", type);
      if (dateFrom) params.append("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.append("date_to", new Date(dateTo).toISOString());
      
      const response = await fetch(`/api/reports/export?${params.toString()}`);
      
      if (!response.ok) throw new Error("Export failed");
      
      const data = await response.json();
      
      let blob;
      let filename;
      
      if (format === 'json') {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `btg_export_${type}_${new Date().toISOString().split('T')[0]}.json`;
      } else {
        // Very basic CSV converter
        const items = data.data || [];
        if (items.length === 0) {
          toast({ title: "No data to export" });
          setIsExporting(false);
          return;
        }
        const headers = Object.keys(items[0]).join(',');
        const rows = items.map((item: any) => Object.values(item).map(val => `"${val}"`).join(','));
        const csv = [headers, ...rows].join('\n');
        blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        filename = `btg_export_${type}_${new Date().toISOString().split('T')[0]}.csv`;
      }
      
      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      
      toast({ title: "Export completed successfully" });
    } catch (err) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">Data Export & Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">Generate and download data extracts for offline analysis.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="border-border shadow-sm">
          <CardHeader className="bg-gray-50/50 border-b border-border">
            <CardTitle className="text-lg">Custom Export</CardTitle>
            <CardDescription>Select dataset and timeframe to export.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Dataset</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="products">Products Master Catalog</SelectItem>
                  <SelectItem value="skus">SKUs & Locations</SelectItem>
                  <SelectItem value="movements">Kardex Movements</SelectItem>
                  <SelectItem value="orders">Orders History</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Date From (Optional)</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            
            <div className="space-y-2">
              <Label>Date To (Optional)</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            
            <div className="pt-4 flex gap-3">
              <Button 
                variant="outline" 
                className="w-full flex items-center justify-center gap-2"
                onClick={() => handleExport('csv')}
                disabled={isExporting}
              >
                <FileSpreadsheet className="h-4 w-4" /> CSV
              </Button>
              <Button 
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90"
                onClick={() => handleExport('json')}
                disabled={isExporting}
              >
                <FileJson className="h-4 w-4" /> JSON
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="bg-gray-50/50 border-b border-border">
            <CardTitle className="text-lg">Quick Reports</CardTitle>
            <CardDescription>Pre-configured standard exports.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 flex flex-col gap-3">
            <Button variant="outline" className="justify-start text-left h-12" onClick={() => { setType('products'); handleExport('csv'); }}>
              <Download className="mr-3 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-semibold text-sm">Full Inventory Valuation</div>
                <div className="text-xs text-muted-foreground font-normal">All products with total cost</div>
              </div>
            </Button>
            
            <Button variant="outline" className="justify-start text-left h-12" onClick={() => { setType('movements'); handleExport('csv'); }}>
              <Download className="mr-3 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-semibold text-sm">All Time Movements</div>
                <div className="text-xs text-muted-foreground font-normal">Complete kardex log</div>
              </div>
            </Button>
            
            <Button variant="outline" className="justify-start text-left h-12" onClick={() => { setType('skus'); handleExport('csv'); }}>
              <Download className="mr-3 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-semibold text-sm">Warehouse Locations map</div>
                <div className="text-xs text-muted-foreground font-normal">SKUs with Rua/Prat/Caixa</div>
              </div>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
