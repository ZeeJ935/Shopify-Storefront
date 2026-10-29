import { unstable_rethrow } from "next/navigation";
import AddressesManager from "@/app/account/components/addresses-manager";
import { getCustomerAddresses } from "@/lib/customer-account/api";
import { getShippingCountries } from "@/lib/localization";


export default async function AccountAddressesPage() {
  let addresses;
  try {
    addresses = await getCustomerAddresses();
  } catch (error) {
    unstable_rethrow(error);
    return (
      <div className="rounded-xl border border-mist bg-snow p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">
          Addresses
        </h2>
        <p className="mt-2 text-sm text-steel">
          We couldn’t load your addresses. Please try again later.
        </p>
      </div>
    );
  }

  // Optional: without it the form falls back to a typed country code.
  const { countries, defaultCountry } = await getShippingCountries().catch(
    (error) => {
      console.error("[account/addresses] countries", error);
      return { countries: [], defaultCountry: null };
    },
  );

  return (
    <AddressesManager
      addresses={addresses}
      countries={countries}
      defaultCountry={defaultCountry}
    />
  );
}
