import Link from "next/link";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "plain" | "critical" | "tertiary";
type Common = { variant?: Variant; size?: "slim" | "medium" | "large"; fullWidth?: boolean; className?: string; children: React.ReactNode };

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover shadow-button",
  secondary: "bg-surface text-fg hover:bg-surface-hover shadow-button",
  critical: "bg-critical text-white hover:opacity-90 shadow-button",
  tertiary: "bg-transparent text-fg hover:bg-surface-hover",
  plain: "bg-transparent text-link hover:underline px-0! shadow-none",
};
const sizes = { slim: "h-7 px-2.5 text-xs", medium: "h-8 px-3 text-[13px]", large: "h-9 px-4 text-sm" };

export function buttonClass({ variant = "secondary", size = "medium", fullWidth, className }: Omit<Common, "children">) {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    className,
  );
}

export function Button({ variant, size, fullWidth, className, children, ...rest }: Common & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClass({ variant, size, fullWidth, className })} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({ href, variant, size, fullWidth, className, children }: Common & { href: string }) {
  return (
    <Link href={href} className={buttonClass({ variant, size, fullWidth, className })}>
      {children}
    </Link>
  );
}
