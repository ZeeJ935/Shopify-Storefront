import { unstable_rethrow } from "next/navigation";
import AddressesManager from "@/app/account/components/addresses-manager";
import { getCustomerAddresses } from "@/lib/customer-account/api";


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

  return <AddressesManager addresses={addresses} />;
}
