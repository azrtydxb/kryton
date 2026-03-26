import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { schema } from "./schema";
import Note from "./models/Note";
import Setting from "./models/Setting";
import NoteShareModel from "./models/NoteShareModel";
import TrashItemModel from "./models/TrashItemModel";

const adapter = new SQLiteAdapter({ schema, jsi: true });

export const database = new Database({
  adapter,
  modelClasses: [Note, Setting, NoteShareModel, TrashItemModel],
});
