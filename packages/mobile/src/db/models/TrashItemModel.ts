import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

export default class TrashItemModel extends Model {
  static table = "trash_items";

  @field("original_path") originalPath!: string;
  @date("trashed_at") trashedAt!: Date;
}
