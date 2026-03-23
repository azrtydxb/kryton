import { Entity, PrimaryColumn, Column, Index } from "typeorm";

@Entity()
export class SearchIndex {
  @PrimaryColumn("text")
  notePath: string;

  @Index()
  @PrimaryColumn("text")
  userId: string;

  @Column("text")
  title: string;

  @Column("text")
  content: string;

  @Column("simple-array")
  tags: string[];

  @Column("timestamp")
  modifiedAt: Date;
}
