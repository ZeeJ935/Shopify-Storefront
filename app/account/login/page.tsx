import Link from "next/link";
import { redirect } from "next/navigation";
import { hasCustomerSession } from "@/lib/customer-account/session";
import { safeReturnTo } from "@/lib/favourites";
import LoginIntentCapture from "./login-intent-capture";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; returnTo?: string; add?: string }>;
};

function errorMessage(code?: string) {
  switch (code) {
    case "cancelled":
      return "Sign-in was cancelled. You can try again when you’re ready.";
    case "config":
      return "Customer accounts aren’t configured yet. Check environment variables and Shopify Admin settings.";
    case "oauth":
      return "We couldn’t complete sign-in. Please try again.";
    default:
      return null;
  }
}

export default async function AccountLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const add = params.add?.trim() || undefined;

  if (await hasCustomerSession()) {
    redirect(returnTo);
  }

  const message = errorMessage(params.error);
  const authorizeHref = `/account/authorize?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
      <LoginIntentCapture returnTo={returnTo} addProductId={add} />
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
        Account
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Log in or sign up
      </h1>
      <p className="mt-4 text-base text-steel">
        Use Shopify Customer Accounts to securely access your orders, profile,
        and addresses. Creating an account and signing in happen through the
        same Shopify login.
      </p>

      {message ? (
        <p
          role="alert"
          className="mt-6 border border-mist bg-mist/40 px-4 py-3 text-sm text-danger"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-8 space-y-3">
        <Link href={authorizeHref} className="btn btn-primary w-full">
          Continue with Shopify
        </Link>
        <Link
          href="/collections/all"
          className="flex min-h-11 items-center justify-center text-sm font-medium text-steel underline-offset-4 hover:text-ink hover:underline"
        >
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
