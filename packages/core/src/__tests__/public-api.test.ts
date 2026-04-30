// packages/core/src/__tests__/public-api.test.ts
import { describe, it, expect } from "vitest";
import * as core from "../index";

describe("public API", () => {
  it("exports the expected names", () => {
    expect(core.Kryton).toBeDefined();
    expect(core.EventBus).toBeDefined();
    expect(core.KrytonError).toBeDefined();
    expect(core.KrytonStorageError).toBeDefined();
    expect(core.KrytonSyncError).toBeDefined();
    expect(core.KrytonConflictError).toBeDefined();
    expect(core.KrytonYjsError).toBeDefined();
    expect(core.KrytonAuthError).toBeDefined();
    expect(core.applySchema).toBeDefined();
    expect(core.LocalStorage).toBeDefined();
    expect(core.isCompatibleVersion).toBeDefined();
    expect(core.KRYTON_CORE_VERSION).toBeDefined();
    expect(core.NotesRepository).toBeDefined();
    expect(core.FoldersRepository).toBeDefined();
    expect(core.TagsRepository).toBeDefined();
    expect(core.SettingsRepository).toBeDefined();
    expect(core.NoteSharesRepository).toBeDefined();
    expect(core.TrashItemsRepository).toBeDefined();
    expect(core.GraphEdgesRepository).toBeDefined();
    expect(core.InstalledPluginsRepository).toBeDefined();
    expect(core.BaseRepository).toBeDefined();
    expect(core.HttpSyncClient).toBeDefined();
    expect(core.SyncOrchestrator).toBeDefined();
  });
});
