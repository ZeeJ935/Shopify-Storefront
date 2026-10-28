import type { ComponentPropsWithoutRef, ReactNode } from "react";

type SiteContainerProps = {
  children: ReactNode;
  className?: string;
  /** Account / forms (~960px). */
  narrow?: boolean;
  /** Cart / bag (max-w-7xl). */
  boxed?: boolean;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">;

const PAD = "px-4 sm:px-6 lg:px-10 2xl:px-12";

export default function SiteContainer({
  children,
  className = "",
  narrow = false,
  boxed = false,
  ...rest
}: SiteContainerProps) {
  const width = narrow
    ? `mx-auto w-full max-w-[960px] ${PAD}`
    : boxed
      ? `mx-auto w-full max-w-7xl ${PAD}`
      : `w-full ${PAD}`;

  return (
    <div className={`${width} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
