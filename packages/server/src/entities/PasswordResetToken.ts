import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class PasswordResetToken {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  user: User;

  @Column("text")
  userId: string;

  @Column("text")
  tokenHash: string;

  @Column("timestamp")
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
