/** Fachada pública del módulo `directory`. */
export { CreateUser } from './application/create-user.js';
export type { CreateUserCommand } from './application/create-user.js';
export { ListManaged } from './application/list-managed.js';
export { ManageUsers } from './application/manage-users.js';
export type {
  InvitationRevoker,
  RankChangeOutcome,
  SessionRevoker,
} from './application/manage-users.js';
export type {
  AssignedRoleRevoker,
  RoleAdjustment,
  RoleSummary,
} from './application/ports/assigned-role-revoker.js';
export type {
  RankChangeNotice,
  RankChangeNoticeQueue,
} from './application/ports/rank-change-notice-queue.js';
export type {
  SharedAccountSummary,
  SharedAccountsSummaryPage,
  SharedByLister,
} from './application/ports/shared-by-lister.js';
export { ReassignOffboardedAccounts } from './application/reassign-offboarded-accounts.js';
export {
  OFFBOARDING_ROTATION_DEADLINE_HOURS,
  OffboardAccounts,
} from './application/offboard-accounts.js';
export type {
  OffboardAccountsDeps,
  OffboardAccountsReport,
} from './application/offboard-accounts.js';
export type {
  AccountReassignment,
  OffboardedAccountsReport,
  OffboardingReceiver,
  ReassignOffboardedAccountsDeps,
} from './application/reassign-offboarded-accounts.js';
export { NotifyRankChanged } from './application/notify-rank-changed.js';
export type {
  NotifyRankChangedDeps,
  RankChangeNoticeDeliveries,
  RankChangeNoticeEvent,
} from './application/notify-rank-changed.js';
export {
  RANK_CHANGE_NOTICE_EVENT_TYPE,
  RankChangeNoticeDeliveryError,
  RankChangeNoticePayloadError,
  rankChangeNoticeHandlerKey,
} from './domain/rank-change-notice.js';
export { PgRankChangeNoticeQueue } from './infrastructure/pg-rank-change-notice-queue.js';
export { ListDirectory } from './application/list-directory.js';
export type { ListDirectoryQuery } from './application/list-directory.js';
export type { CandidatePermissionChecker } from './application/ports/candidate-permission-checker.js';
export type { OffboardingAccessCleanup } from './application/ports/offboarding-access-cleanup.js';
export type {
  LiveCredentialRef,
  NewOffboardingRotationTask,
  OffboardingRotationPriority,
  OffboardingRotationStore,
} from './application/ports/offboarding-rotation-store.js';
export type {
  ManagementGrantOutcome,
  OffboardingAccountStore,
} from './application/ports/offboarding-account-store.js';
export type {
  DirectoryPage,
  DirectoryQuery,
  DirectoryRow,
  ManagedPage,
  ManagedRow,
  NewUser,
  SuperiorLink,
  UserDirectory,
} from './application/ports/user-directory.js';
export {
  canChangeRank,
  canCreateRank,
  canManage,
  canTransferManager,
  isRankPromotion,
  wouldLeaveNoActiveAdministrator,
} from './domain/management-policy.js';
export type { UserRecord, UserStatus, UserSubject } from './domain/user.js';
export { PgUserDirectory } from './infrastructure/pg-user-directory.js';

export {
  NotifyOffboarding,
  offboardingNoticeDeliveriesOver,
} from './application/notify-offboarding.js';
export type { OffboardingNoticeDeliveries } from './application/notify-offboarding.js';
export type { OffboardingNoticeQueue } from './application/ports/offboarding-notice-queue.js';
export { PgOffboardingNoticeQueue } from './infrastructure/pg-offboarding-notice-queue.js';
export {
  OFFBOARDING_NOTICE_EVENT_TYPE,
  OffboardingNoticeDeliveryError,
  OffboardingNoticePayloadError,
} from './domain/offboarding-notice.js';
export type { OffboardingNoticePayload } from './domain/offboarding-notice.js';

export { CompleteRootTransfers } from './application/complete-root-transfers.js';
export { ManageRootTransfer } from './application/manage-root-transfer.js';
export type {
  ManageRootTransferDeps,
  RootTransferView,
} from './application/manage-root-transfer.js';
export { RootTransferFinalizer } from './application/root-transfer-finalizer.js';
export type {
  EmergencyCodeInvalidator,
  RootAccessRevoker,
  RootHierarchySwap,
  RootRoleHandover,
} from './application/ports/root-handover.js';
export type { RootTransferNoticeQueue } from './application/ports/root-transfer-notice-queue.js';
export type { RootTransferStore } from './application/ports/root-transfer-store.js';
export { PgRootTransferNoticeQueue } from './infrastructure/pg-root-transfer-notice-queue.js';
export { PgRootTransferStore } from './infrastructure/pg-root-transfer-store.js';
export type { RootTransferRecord } from './domain/root-transfer.js';
export type { RootTransferNoticePayload } from './domain/root-transfer-notice.js';
export { NotifyRootTransfer } from './application/notify-root-transfer.js';
export type { RootTransferNoticeReceipts } from './application/notify-root-transfer.js';
export {
  ROOT_TRANSFER_NOTICE_EVENT_TYPE,
  RootTransferNoticeDeliveryError,
  RootTransferNoticePayloadError,
} from './domain/root-transfer-notice.js';
