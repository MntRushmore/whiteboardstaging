export type {
  BackupPayload,
  BuildResult,
  DirtyToken,
  DirtyTracker,
  LocalBackup,
  MergeResult,
  PersistResult,
  RemotePlan,
  SaveQueue,
  SaveQueueDeps,
  SyncState,
  SyncStatus,
} from "./types";
export { createDirtyTracker } from "./dirtyTracker";
export { mergeDocumentRecords, SESSION_TYPE_NAMES, type MergeArgs } from "./mergeDocumentRecords";
export { applyRemotePlan, type ApplyReport } from "./applyRemotePlan";
export {
  createLocalStorageBackup,
  isBackupPayload,
  backupKey,
  newTabId,
  BACKUP_KEY_PREFIX,
  BACKUP_MAX_BYTES,
  type DeviceBackups,
  type StoredBackup,
} from "./localBackup";
export {
  createSaveQueue,
  backoffDelay,
  extractStoreMap,
  DEFAULT_DEBOUNCE_MS,
  BACKUP_DEBOUNCE_MS,
  MAX_SAVE_WAIT_MS,
  MAX_BACKUP_WAIT_MS,
  RETRY_BACKOFF_MS,
  MAX_CONFLICT_ROUNDS,
  PERSIST_TIMEOUT_MS,
  persistTimeoutMs,
  MSG_BOARD_GONE,
  MSG_MERGE_FAILED,
  MSG_OFFLINE,
  MSG_SAVE_FAILED,
  MSG_SAVE_TIMEOUT,
} from "./saveQueue";
export { holdTabLock } from "./tabLock";
