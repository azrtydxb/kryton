import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from "typeorm";

@Entity()
@Unique(["key", "userId"])
export class Settings {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("text")
  key: string;

  @Column("text")
  value: string;

  @Index()
  @Column("text", { nullable: true })
  userId: string | null;
}
