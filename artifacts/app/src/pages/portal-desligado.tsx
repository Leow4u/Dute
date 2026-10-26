import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { useOperationProfile } from "@/lib/operation-profile";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * O portal desligado (perguntas 69 e 71, canvas de 26/10/2026): a pessoa do
 * cliente arquivado ou "Sem portal" entra e vê só esta tela, com o nome do
 * cliente, o e-mail dela e Sair. O login fica, e o portal volta quando o
 * cadastro volta a ter portal.
 */
export function PortalDesligadoView({
  cliente,
  email,
  onSair,
}: {
  cliente: string;
  email: string | null;
  onSair: () => void;
}) {
  return (
    <AuthShell title="Portal desligado" subtitle={cliente}>
      <div className="space-y-4">
        {email ? <p className="break-all font-semibold">{email}</p> : null}
        <Button type="button" variant="outline" className="w-full" onClick={onSair}>
          Sair
        </Button>
      </div>
    </AuthShell>
  );
}

export default function PortalDesligadoPage() {
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const operation = useOperationProfile();
  return (
    <PortalDesligadoView
      cliente={operation.profile?.customerName ?? user?.publicMetadata.customer_code ?? "cliente"}
      email={user?.primaryEmailAddress?.emailAddress ?? null}
      onSair={() => {
        void signOut({ redirectUrl: basePath || "/" });
      }}
    />
  );
}
