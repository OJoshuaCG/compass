import { Client } from 'pg';

export interface BootstrapOptions {
  /** Connection string of an administrator (CREATEROLE + ownership of the database). */
  connectionString: string;
}

/**
 * Provisions the cluster-level roles once, with an admin connection. Idempotent. Roles are
 * created NOLOGIN: operations assigns LOGIN and a password from the secrets manager, so no
 * credential ever lives in this repository.
 *
 *  - iam_migrator    owns every object; runs migrations; subject to FORCE'd RLS like anyone.
 *  - iam_app         the application; no BYPASSRLS, not an owner, no DDL.
 *  - iam_auth_reader owner of the auth.* SECURITY DEFINER functions; no BYPASSRLS, no login.
 *  - iam_inbound_worker the inbound-codes worker process (ADR 0045); no BYPASSRLS, not an owner, no DDL.
 */
export async function bootstrapRoles(options: BootstrapOptions): Promise<void> {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query(`
      do $$
      declare
        r text;
      begin
        foreach r in array array['iam_migrator', 'iam_app', 'iam_auth_reader', 'iam_inbound_worker'] loop
          if not exists (select 1 from pg_roles where rolname = r) then
            execute format('create role %I nologin nosuperuser nocreatedb nocreaterole nobypassrls', r);
          end if;
        end loop;
        -- The migrator must be able to hand function ownership to iam_auth_reader.
        if not pg_has_role('iam_migrator', 'iam_auth_reader', 'member') then
          grant iam_auth_reader to iam_migrator;
        end if;
        execute format('grant connect on database %I to iam_migrator, iam_app, iam_inbound_worker', current_database());
        execute format('grant create on database %I to iam_migrator', current_database());
        execute format('revoke temporary on database %I from public', current_database());
      end
      $$;
      grant usage, create on schema public to iam_migrator;
      grant usage on schema public to iam_app, iam_auth_reader, iam_inbound_worker;
    `);
  } finally {
    await client.end();
  }
}
