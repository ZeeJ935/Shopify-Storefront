"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomerAddress } from "@/lib/customer-account/api";
import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
  updateAddressAction,
} from "@/app/account/(protected)/addresses/actions";
import AccountModal from "./account-modal";
import AddressCard from "./address-card";
import AddressForm from "./address-form";
import { useToast } from "./toast";

type AddressesManagerProps = {
  addresses: CustomerAddress[];
};

export default function AddressesManager({ addresses }: AddressesManagerProps) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerAddress | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function closeModal() {
    setModal(null);
    setEditing(null);
    setFieldErrors({});
  }

  function refresh() {
    router.refresh();
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result =
        modal === "edit"
          ? await updateAddressAction(formData)
          : await createAddressAction(formData);

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? { _form: result.message ?? "Error" });
        pushToast(result.message ?? "Something went wrong.", "error");
        return;
      }

      pushToast(result.message ?? "Saved.", "success");
      closeModal();
      refresh();
    });
  }

  function onSetDefault(address: CustomerAddress) {
    startTransition(async () => {
      const result = await setDefaultAddressAction(address.id);
      if (!result.ok) {
        pushToast(result.message ?? "Could not update default.", "error");
        return;
      }
      pushToast(result.message ?? "Default updated.", "success");
      refresh();
    });
  }

  function onConfirmDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    startTransition(async () => {
      const result = await deleteAddressAction(id);
      setConfirmDelete(null);
      if (!result.ok) {
        pushToast(result.message ?? "Could not delete address.", "error");
        return;
      }
      pushToast(result.message ?? "Address deleted.", "success");
      refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Addresses
          </h2>
          <p className="mt-1 text-sm text-steel">
            Manage shipping addresses for faster checkout.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setFieldErrors({});
            setModal("add");
          }}
        >
          + Add new address
        </button>
      </div>

      {addresses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-mist bg-snow px-6 py-14 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            No saved addresses
          </p>
          <p className="mt-2 text-sm text-steel">
            Add an address to use at checkout.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-6"
            onClick={() => setModal("add")}
          >
            Add address
          </button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id}>
              <AddressCard
                address={address}
                busy={pending}
                onEdit={(a) => {
                  setEditing(a);
                  setFieldErrors({});
                  setModal("edit");
                }}
                onDelete={setConfirmDelete}
                onSetDefault={onSetDefault}
              />
            </li>
          ))}
        </ul>
      )}

      <AccountModal
        open={modal !== null}
        title={modal === "edit" ? "Edit address" : "Add address"}
        onClose={closeModal}
        wide
      >
        <form
          action={(fd) => onSubmit(fd)}
          className="space-y-5"
        >
          <AddressForm
            address={editing}
            fieldErrors={fieldErrors}
            pending={pending}
            idPrefix={modal === "edit" ? "edit" : "add"}
          />
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save address"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={closeModal}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </form>
      </AccountModal>

      <AccountModal
        open={Boolean(confirmDelete)}
        title="Delete address?"
        onClose={() => setConfirmDelete(null)}
      >
        <p className="text-sm text-steel">
          This removes the address from your account. This can’t be undone.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={onConfirmDelete}
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => setConfirmDelete(null)}
          >
            Cancel
          </button>
        </div>
      </AccountModal>
    </div>
  );
}
