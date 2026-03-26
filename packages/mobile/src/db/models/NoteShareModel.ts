import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

export default class NoteShareModel extends Model {
  static table = "note_shares";

  @field("owner_user_id") ownerUserId!: string;
  @field("path") path!: string;
  @field("is_folder") isFolder!: boolean;
  @field("permission") permission!: string;
  @field("shared_with_user_id") sharedWithUserId!: string;
}
