type SpinnerProps = {
  className?: string;
  size?: "sm" | "md";
};

export default function Spinner({ className = "", size = "md" }: SpinnerProps) {
  return (
    <span
      className={`spinner ${size === "sm" ? "spinner-sm" : ""} ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
