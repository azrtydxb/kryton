import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

export default class Setting extends Model {
  static table = "settings";

  @field("key") key!: string;
  @field("value") value!: string;
}
