import { DataSource } from "typeorm";
import { GraphEdge } from "./entities/GraphEdge";
import { SearchIndex } from "./entities/SearchIndex";
import { Settings } from "./entities/Settings";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/mnemo";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: DATABASE_URL,
  synchronize: true,
  logging: false,
  entities: [GraphEdge, SearchIndex, Settings],
});
