import Link from "next/link";

type EmptyBagProps = {
  title: string;
  description: string;
};

export default function EmptyBag({ title, description }: EmptyBagProps) {
  return (
    <div className="mx-auto max-w-lg text-center">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 text-base text-steel">{description}</p>
      <Link href="/collections/all" className="btn btn-primary mt-8">
        Continue shopping
      </Link>
    </div>
  );
}
