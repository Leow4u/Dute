import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[16px] text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[2]",
  {
    variants: {
      variant: {
        default:
          "border border-primary/20 bg-[hsl(var(--primary-soft))] text-primary shadow-[0_8px_24px_rgba(15,23,42,.04)] hover:bg-[hsl(var(--primary-soft-hover))] active:bg-[hsl(var(--primary-soft-pressed))]",
        destructive:
          "border border-destructive/15 bg-destructive/10 text-destructive shadow-[0_8px_24px_rgba(15,23,42,.04)] hover:bg-destructive/15",
        outline:
          "border border-border bg-card/70 text-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[24px] hover:bg-surface-hover active:bg-surface-pressed",
        secondary:
          "border border-border bg-card/70 text-secondary-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[24px] hover:bg-surface-hover active:bg-surface-pressed",
        ghost: "border border-transparent bg-transparent text-foreground hover:bg-surface-hover active:bg-surface-pressed",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-10 px-5 py-2.5",
        sm: "min-h-9 rounded-[14px] px-4 text-xs",
        lg: "min-h-11 rounded-[18px] px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
