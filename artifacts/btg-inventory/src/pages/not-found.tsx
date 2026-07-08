import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col items-center justify-center space-y-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-2">404</h1>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-[500px]">
          A página que você procura não existe ou foi movida.
        </p>
      </div>
      <Link href="/dashboard">
        <Button variant="default">Voltar ao Painel</Button>
      </Link>
    </div>
  );
}
