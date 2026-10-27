import { unstable_rethrow } from "next/navigation";
import ProfileForm from "@/app/account/components/profile-form";
import { getCustomerProfile } from "@/lib/customer-account/api";

export const instant = false;

export default async function AccountProfilePage() {
  let profile;
  try {
    profile = await getCustomerProfile();
  } catch (error) {
    unstable_rethrow(error);
    return (
      <div className="rounded-xl border border-mist bg-snow p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">Profile</h2>
        <p className="mt-2 text-sm text-steel">
          We couldn’t load your profile. Please try again later.
        </p>
      </div>
    );
  }

  return <ProfileForm profile={profile} />;
}
