import type { CustomersRepo } from "../src/db/client.js";
import type { FavouritesRepo } from "../src/db/favourites.js";

/** In-memory customers repo. */
export function fakeCustomers(): CustomersRepo & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    async touch(customerId) {
      touched.push(customerId);
      return { customerId, firstSeenAt: new Date("2026-01-01T00:00:00Z") };
    },
  };
}

/** In-memory favourites repo with the same rules as the Postgres one. */
export function fakeFavourites(): FavouritesRepo & { lists: Map<string, string[]>; importedSet: Set<string> } {
  const lists = new Map<string, string[]>();
  const importedSet = new Set<string>();
  const get = (id: string) => lists.get(id) ?? [];
  return {
    lists,
    importedSet,
    async list(customerId) {
      return { ids: get(customerId), imported: importedSet.has(customerId) };
    },
    async replace(customerId, ids) {
      // Existing favourites keep their place; new ones go to the end.
      const kept = get(customerId).filter((id) => ids.includes(id));
      const next = [...kept, ...ids.filter((id) => !kept.includes(id))];
      lists.set(customerId, next);
      importedSet.add(customerId);
      return next;
    },
    async importOnce(customerId, ids) {
      if (importedSet.has(customerId)) return { ids: get(customerId), imported: false };
      lists.set(customerId, [...new Set([...get(customerId), ...ids])]);
      importedSet.add(customerId);
      return { ids: get(customerId), imported: true };
    },
  };
}
