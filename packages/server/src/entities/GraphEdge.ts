import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

@Entity()
export class GraphEdge {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("text")
  fromPath: string;

  @Column("text")
  toPath: string;

  @Index()
  @Column("text")
  fromNoteId: string;

  @Index()
  @Column("text")
  toNoteId: string;

  @Index()
  @Column("text")
  userId: string;
}
