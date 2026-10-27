-- 0010: emergency codes of the Root.
-- They live next to the ordinary recovery codes (same hashing, same single use) but are issued when
-- the organization is created, are printed and kept offline by the custodians, and are NOT replaced
-- when the person registers a new second factor: only the recovery codes are.
alter table user_recovery_codes
  add column kind text not null default 'recovery' check (kind in ('recovery', 'emergency'));
