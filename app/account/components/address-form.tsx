"use client";

import type { CustomerAddress } from "@/lib/customer-account/api";
import type { ShippingCountry } from "@/lib/localization";

type AddressFormProps = {
  address?: CustomerAddress | null;
  /** The store's markets; empty falls back to a typed 2-letter code. */
  countries?: ShippingCountry[];
  fieldErrors?: Record<string, string>;
  pending?: boolean;
  idPrefix?: string;
};

function Field({
  id,
  label,
  name,
  defaultValue,
  error,
  required,
  autoComplete,
  type = "text",
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: string | null;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`field ${error ? "border-danger" : ""}`}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CountryField({
  id,
  countries,
  defaultValue,
  error,
}: {
  id: string;
  countries: ShippingCountry[];
  defaultValue: string | null | undefined;
  error?: string;
}) {
  const current = defaultValue?.toUpperCase() || "";
  // Keep an existing address's country selectable even if the store no
  // longer sells there, so editing never silently changes it.
  const options =
    current && !countries.some((country) => country.isoCode === current)
      ? [...countries, { isoCode: current, name: current }]
      : countries;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        Country<span className="text-danger"> *</span>
      </label>
      <select
        id={id}
        name="countryCode"
        defaultValue={current || options[0]?.isoCode}
        required
        autoComplete="country"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`field ${error ? "border-danger" : ""}`}
      >
        {options.map((country) => (
          <option key={country.isoCode} value={country.isoCode}>
            {country.name}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function AddressForm({
  address,
  countries = [],
  fieldErrors = {},
  pending = false,
  idPrefix = "address",
}: AddressFormProps) {
  return (
    <div className="space-y-4">
      {address ? (
        <input type="hidden" name="addressId" value={address.id} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-firstName`}
          label="First name"
          name="firstName"
          defaultValue={address?.firstName}
          error={fieldErrors.firstName}
          required
          autoComplete="given-name"
        />
        <Field
          id={`${idPrefix}-lastName`}
          label="Last name"
          name="lastName"
          defaultValue={address?.lastName}
          error={fieldErrors.lastName}
          required
          autoComplete="family-name"
        />
      </div>
      <Field
        id={`${idPrefix}-company`}
        label="Company (optional)"
        name="company"
        defaultValue={address?.company}
        error={fieldErrors.company}
        autoComplete="organization"
      />
      <Field
        id={`${idPrefix}-address1`}
        label="Address line 1"
        name="address1"
        defaultValue={address?.address1}
        error={fieldErrors.address1}
        required
        autoComplete="address-line1"
      />
      <Field
        id={`${idPrefix}-address2`}
        label="Address line 2"
        name="address2"
        defaultValue={address?.address2}
        error={fieldErrors.address2}
        autoComplete="address-line2"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-city`}
          label="City"
          name="city"
          defaultValue={address?.city}
          error={fieldErrors.city}
          required
          autoComplete="address-level2"
        />
        <Field
          id={`${idPrefix}-zip`}
          label="ZIP / postal code"
          name="zip"
          defaultValue={address?.zip}
          error={fieldErrors.zip}
          required
          autoComplete="postal-code"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {countries.length > 0 ? (
          <CountryField
            id={`${idPrefix}-countryCode`}
            countries={countries}
            defaultValue={address?.country}
            error={fieldErrors.countryCode}
          />
        ) : (
          <Field
            id={`${idPrefix}-countryCode`}
            label="Country code"
            name="countryCode"
            defaultValue={address?.country ?? "US"}
            error={fieldErrors.countryCode}
            required
            autoComplete="country"
          />
        )}
        <Field
          id={`${idPrefix}-zoneCode`}
          label="Province / state code (e.g. CA, ON, PB)"
          name="zoneCode"
          defaultValue={address?.province}
          error={fieldErrors.zoneCode}
          autoComplete="address-level1"
        />
      </div>
      <Field
        id={`${idPrefix}-phone`}
        label="Phone"
        name="phoneNumber"
        type="tel"
        defaultValue={address?.phoneNumber}
        error={fieldErrors.phoneNumber}
        autoComplete="tel"
      />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="defaultAddress"
          defaultChecked={address?.isDefault ?? false}
          disabled={pending}
          className="h-4 w-4 rounded border-mist"
        />
        Set as default address
      </label>
      {fieldErrors._form ? (
        <p className="text-sm text-danger" role="alert">
          {fieldErrors._form}
        </p>
      ) : null}
    </div>
  );
}
