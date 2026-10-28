-- 0013: custody group of the emergency codes (ADR 0037).
-- The two custodians of the Root each hold the papers of ONE group ('A' or 'B'). Recovering the Root
-- requires one valid code from each group, so a single custodian can never act alone. Ordinary
-- recovery codes keep the column null; emergency codes created before this migration also stay null
-- and therefore cannot satisfy the dual control until they are reissued.
alter table user_recovery_codes
  add column custody_group text check (custody_group in ('A', 'B')),
  add constraint user_recovery_codes_custody_group_only_emergency
    check (custody_group is null or kind = 'emergency');

comment on column user_recovery_codes.custody_group is
  'Custodian whose papers hold this emergency code (A or B); null for ordinary recovery codes and for emergency codes issued before ADR 0037.';
