import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, Boxes, ShieldCheck, Warehouse, Zap, BarChart3, Network, Lock, ChevronRight, Sparkles } from "lucide-react";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const features = [
    { icon: <Bot className="h-6 w-6 text-primary" />, title: "Agente IA Operacional", description: "Interaja com nosso Agente Dutelog via chat para consultar estoque, faturamentos e movimentações." },
    { icon: <Warehouse className="h-6 w-6 text-primary" />, title: "WMS de Performance", description: "Controle as etapas do armazém como recebimento, qualidade e expedição em tempo real." },
    { icon: <ShieldCheck className="h-6 w-6 text-primary" />, title: "Auditoria & Compliance", description: "Controle rigoroso e logs completos de conformidade para o ecossistema BTG Pactual." }
  ];
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-primary selection:text-primary-foreground overflow-x-hidden">
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/dutelog-logo.png" alt="Dutelog Logo" className="h-10 w-auto object-contain" />
            <span className="hidden sm:inline text-xs font-semibold bg-white/5 border border-white/10 rounded-full py-1 px-3 text-slate-400">Estoque BTG</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/5" onClick={() => setLocation("/sign-in")}>Sign In</Button>
            <Button className="bg-primary hover:bg-primary/90 text-white font-medium shadow-lg shadow-primary/20 flex items-center gap-2" onClick={() => setLocation("/sign-in")}>Acessar Estoque <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto space-y-8">
            <div className="inline-flex items-center gap-2 bg-gradient-to-r from-sky-500/10 to-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-xs text-slate-300 font-medium tracking-wide whitespace-nowrap">
              <Sparkles className="h-3.5 w-3.5 text-sky-400" /><span>Plataforma Oficial de Inventário & Armazenagem</span>
            </div>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-transparent leading-none">
              A evolução do WMS operada por <span className="bg-gradient-to-r from-sky-400 via-primary to-indigo-500 bg-clip-text text-transparent">Agentes de Inteligência Artificial</span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Dutelog unifica operações complexas de armazém, faturamento estruturado, controle de SKUs e auditorias financeiras sob as demandas exigentes do ecossistema BTG Pactual.
            </p>
            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-sky-500 to-primary hover:opacity-90 font-semibold px-8 h-14 text-white text-base shadow-lg shadow-sky-500/20" onClick={() => setLocation("/sign-in")}>Começar Agora</Button>
            </div>
          </div>
        </div>
      </section>
      <footer className="py-12 border-t border-white/5 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center sm:flex sm:items-center sm:justify-between">
          <img src="/dutelog-logo.png" alt="Dutelog Logo" className="h-10 w-auto object-contain mx-auto sm:mx-0" />
          <p className="text-sm text-slate-500">&copy; {new Date().getFullYear()} Dutelog. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}