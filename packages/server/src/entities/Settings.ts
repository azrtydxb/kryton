import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class Settings {
  @PrimaryColumn()
  key: string;

  @Column()
  value: string;
}
