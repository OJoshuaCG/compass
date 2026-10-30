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
export type {
  DirectoryPage,
  DirectoryQuery,
  DirectoryRow,
  ManagedPage,
  ManagedRow,
  NewUser,
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
