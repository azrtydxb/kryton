import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class InstalledPlugin {
  @PrimaryColumn("text")
  id: string;

  @Column("text")
  name: string;

  @Column("text")
  version: string;

  @Column("text")
  description: string;

  @Column("text")
  author: string;

  @Column("text", { default: "installed" })
  state: string;

  @Column("text", { nullable: true })
  error: string | null;

  @Column("jsonb", { nullable: true })
  manifest: unknown;

  @Column("boolean", { default: true })
  enabled: boolean;

  @CreateDateColumn()
  installedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
