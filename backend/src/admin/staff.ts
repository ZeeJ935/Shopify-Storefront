import type pg from "pg";
import type { StaffRole } from "./allowlist.js";

export type StaffStore = {
  /** Creates or updates the staff row on sign-in; returns its id. */
  upsertOnLogin(identity: { email: string; googleSub: string; role: StaffRole }): Promise<number>;
  /** True when the staff row still exists with this email (refresh / every request). */
  exists(staffId: number, email: string): Promise<boolean>;
};

export function createStaffStore(pool: pg.Pool): StaffStore {
  return {
    async upsertOnLogin({ email, googleSub, role }) {
      // Same Google account (sub) with a changed email: update in place.
      const bySub = await pool.query<{ id: string }>(
        `update staff set email = $1, role_at_last_login = $3, last_login_at = now() where google_sub = $2 returning id`,
        [email, googleSub, role],
      );
      if (bySub.rows[0]) return Number(bySub.rows[0].id);
      const { rows } = await pool.query<{ id: string }>(
        `insert into staff (email, google_sub, role_at_last_login) values ($1, $2, $3)
         on conflict (email) do update set google_sub = excluded.google_sub,
           role_at_last_login = excluded.role_at_last_login, last_login_at = now()
         returning id`,
        [email, googleSub, role],
      );
      return Number(rows[0].id);
    },
    async exists(staffId, email) {
      const { rowCount } = await pool.query("select 1 from staff where id = $1 and email = $2", [staffId, email]);
      return (rowCount ?? 0) > 0;
    },
  };
}
