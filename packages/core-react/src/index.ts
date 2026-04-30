// packages/core-react/src/index.ts
export const KRYTON_CORE_REACT_VERSION = "4.4.0-pre.0";

export { KrytonProvider, useKryton, type KrytonInstance } from "./provider";
export {
  useNote,
  useNotes,
  useFolders,
  useTags,
  useSettings,
  useSyncStatus,
  useYjsDoc,
  type SyncStatus,
} from "./hooks";
