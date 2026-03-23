import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

@Entity()
export class GraphEdge {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  fromPath: string;

  @Column()
  toPath: string;

  @Index()
  @Column()
  fromNoteId: string;

  @Index()
  @Column()
  toNoteId: string;
}
