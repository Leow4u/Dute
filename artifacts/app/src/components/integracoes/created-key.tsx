import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CreatedIntegration } from "@/lib/integracoes/model";

export function CreatedKey({ credential, onDone }: { credential: CreatedIntegration; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  async function copy() {
    setError("");
    try { await navigator.clipboard.writeText(credential.token); setCopied(true); }
    catch { setError("Selecione e copie a chave manualmente. A cópia automática não está disponível."); }
  }
  return (
    <section className="max-w-2xl space-y-6" aria-labelledby="created-key-title">
      <div>
        <h1 id="created-key-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Chave criada</h1>
        <p className="mt-2 text-sm text-muted-foreground">Copie e guarde a chave agora. Ela não será exibida novamente.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="created-integration-key">Chave da integração</Label>
        <Textarea id="created-integration-key" readOnly value={credential.token} autoComplete="off" spellCheck={false} className="min-h-24 break-all font-mono text-base md:text-sm" onFocus={(e) => e.target.select()} />
        <p className="text-xs text-muted-foreground">Válida até {new Date(credential.expires_at).toLocaleDateString("pt-BR")}.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copiada" : "Copiar chave"}</Button>
        <Button type="button" onClick={onDone}>Concluir</Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">{copied ? "Chave copiada." : "Entregue a chave ao desenvolvedor por um canal seguro."}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
