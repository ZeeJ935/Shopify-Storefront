type SkeletonProps = {
  className?: string;
};

export default function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <span
      className={`skeleton skeleton-shimmer ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
