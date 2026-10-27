"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomerProfile } from "@/lib/customer-account/api";
import { updateProfileAction } from "@/app/account/(protected)/profile/actions";
import { useToast } from "./toast";

type ProfileFormProps = {
  profile: CustomerProfile;
};

export default function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  return (
    <form
      className="max-w-lg space-y-5 rounded-xl border border-mist bg-snow p-5 shadow-sm sm:p-6"
      action={(formData) => {
        startTransition(async () => {
          const result = await updateProfileAction(formData);
          if (!result.ok) {
            setFieldErrors(
              result.fieldErrors ?? { _form: result.message ?? "Error" },
            );
            pushToast(result.message ?? "Could not save profile.", "error");
            return;
          }
          setFieldErrors({});
          pushToast(result.message ?? "Profile saved.", "success");
          router.refresh();
        });
      }}
    >
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Profile
        </h2>
        <p className="mt-1 text-sm text-steel">
          Update the name on your account.
        </p>
      </div>

      <div>
        <label
          htmlFor="profile-email"
          className="mb-1.5 block text-sm font-medium text-ink"
        >
          Email
        </label>
        <input
          id="profile-email"
          type="email"
          value={profile.email ?? ""}
          disabled
          className="field"
          aria-describedby="profile-email-help"
        />
        <p id="profile-email-help" className="mt-1 text-xs text-steel">
          Email is managed through Shopify login and can’t be edited here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="profile-firstName"
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            First name <span className="text-danger">*</span>
          </label>
          <input
            id="profile-firstName"
            name="firstName"
            defaultValue={profile.firstName ?? ""}
            required
            autoComplete="given-name"
            className={`field ${fieldErrors.firstName ? "border-danger" : ""}`}
            aria-invalid={fieldErrors.firstName ? true : undefined}
          />
          {fieldErrors.firstName ? (
            <p className="mt-1 text-xs text-danger">{fieldErrors.firstName}</p>
          ) : null}
        </div>
        <div>
          <label
            htmlFor="profile-lastName"
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            Last name <span className="text-danger">*</span>
          </label>
          <input
            id="profile-lastName"
            name="lastName"
            defaultValue={profile.lastName ?? ""}
            required
            autoComplete="family-name"
            className={`field ${fieldErrors.lastName ? "border-danger" : ""}`}
            aria-invalid={fieldErrors.lastName ? true : undefined}
          />
          {fieldErrors.lastName ? (
            <p className="mt-1 text-xs text-danger">{fieldErrors.lastName}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label
          htmlFor="profile-phone"
          className="mb-1.5 block text-sm font-medium text-ink"
        >
          Phone
        </label>
        <input
          id="profile-phone"
          type="tel"
          value={profile.phone ?? ""}
          disabled
          className="field"
          aria-describedby="profile-phone-help"
        />
        <p id="profile-phone-help" className="mt-1 text-xs text-steel">
          Phone updates aren’t supported via this storefront yet.
        </p>
      </div>

      {fieldErrors._form ? (
        <p className="text-sm text-danger" role="alert">
          {fieldErrors._form}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
