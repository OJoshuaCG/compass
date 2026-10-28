-- 0012: a WebAuthn challenge issued to re-authenticate (step-up, ADR 0033) gets its own purpose, so a
-- sign-in challenge can never be redeemed as a re-authentication and the other way around.
alter table webauthn_challenges drop constraint webauthn_challenges_purpose_check;
alter table webauthn_challenges add constraint webauthn_challenges_purpose_check
  check (purpose in ('registration', 'authentication', 'reauthentication'));
