import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class SearchIndex {
  @PrimaryColumn()
  notePath: string;

  @Column("text")
  title: string;

  @Column("text")
  content: string;

  @Column("simple-array")
  tags: string[];

  @Column()
  modifiedAt: Date;
}
