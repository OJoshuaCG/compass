-- 0009: replay protection for the system's own TOTP second factor.
-- A TOTP code is valid for its whole time step (and one step of clock skew), so without a record of
-- the last accepted step the same code could be replayed by someone who watched it being typed.
-- The application only accepts a code whose step is strictly greater than this value.
alter table user_totp_factors
  add column last_used_step bigint check (last_used_step is null or last_used_step >= 0);
