import { LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <div className="px-4 py-16">
      <EmptyState title="Not found" action={<LinkButton href="/orders">Go to orders</LinkButton>}>
        That page or record doesn&apos;t exist, or hasn&apos;t been synced yet.
      </EmptyState>
    </div>
  );
}
