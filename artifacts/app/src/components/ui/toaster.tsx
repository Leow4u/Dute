import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

export function Toaster() {
  const { toasts } = useToast();

  // Os rótulos do leitor de tela em pt-BR, no lugar do "Notification" do Radix:
  // ele ouve "Aviso" antes da mensagem, e a região se chama "Avisos (F8)".
  return (
    <ToastProvider label="Aviso">
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport label="Avisos ({hotkey})" />
    </ToastProvider>
  );
}
