import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

export default class Note extends Model {
  static table = "notes";

  @field("path") path!: string;
  @field("title") title!: string;
  @field("content") content!: string;
  @field("tags") tags!: string;
  @date("modified_at") modifiedAt!: Date;
}
