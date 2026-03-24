import { DataSource } from "typeorm";
import { AccessRequest } from "./entities/AccessRequest";
import { AuthProvider } from "./entities/AuthProvider";
import { GraphEdge } from "./entities/GraphEdge";
import { InviteCode } from "./entities/InviteCode";
import { NoteShare } from "./entities/NoteShare";
import { RefreshToken } from "./entities/RefreshToken";
import { SearchIndex } from "./entities/SearchIndex";
import { Settings } from "./entities/Settings";
import { PasswordResetToken } from "./entities/PasswordResetToken";
import { User } from "./entities/User";
import { PluginStorage } from "./entities/PluginStorage";
import { InstalledPlugin } from "./entities/InstalledPlugin";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/mnemo";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: DATABASE_URL,
  synchronize: true,
  logging: false,
  entities: [AccessRequest, AuthProvider, GraphEdge, InviteCode, InstalledPlugin, NoteShare, PasswordResetToken, PluginStorage, RefreshToken, SearchIndex, Settings, User],
});
