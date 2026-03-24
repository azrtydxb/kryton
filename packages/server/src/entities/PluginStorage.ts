import { Entity, Column, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class PluginStorage {
  @PrimaryColumn("text")
  pluginId: string;

  @PrimaryColumn("text")
  key: string;

  @PrimaryColumn("text", { default: "" })
  userId: string;

  @Column("jsonb")
  value: unknown;

  @UpdateDateColumn()
  updatedAt: Date;
}
