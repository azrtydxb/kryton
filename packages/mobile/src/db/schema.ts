import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: "notes",
      columns: [
        { name: "path", type: "string" },
        { name: "title", type: "string" },
        { name: "content", type: "string" },
        { name: "tags", type: "string" },
        { name: "modified_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "settings",
      columns: [
        { name: "key", type: "string" },
        { name: "value", type: "string" },
      ],
    }),
    tableSchema({
      name: "note_shares",
      columns: [
        { name: "owner_user_id", type: "string" },
        { name: "path", type: "string" },
        { name: "is_folder", type: "boolean" },
        { name: "permission", type: "string" },
        { name: "shared_with_user_id", type: "string" },
      ],
    }),
    tableSchema({
      name: "trash_items",
      columns: [
        { name: "original_path", type: "string" },
        { name: "trashed_at", type: "number" },
      ],
    }),
  ],
});
