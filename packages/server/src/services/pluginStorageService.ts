import { AppDataSource } from "../data-source";
import { PluginStorage } from "../entities/PluginStorage";

const GLOBAL_USER = "";

export async function getStorageValue(
  pluginId: string,
  key: string,
  userId?: string
): Promise<unknown> {
  const repo = AppDataSource.getRepository(PluginStorage);
  const entry = await repo.findOneBy({
    pluginId,
    key,
    userId: userId ?? GLOBAL_USER,
  });
  return entry?.value ?? null;
}

export async function setStorageValue(
  pluginId: string,
  key: string,
  value: unknown,
  userId?: string
): Promise<void> {
  const repo = AppDataSource.getRepository(PluginStorage);
  await repo.upsert(
    {
      pluginId,
      key,
      userId: userId ?? GLOBAL_USER,
      value,
    } as Parameters<typeof repo.upsert>[0],
    ["pluginId", "key", "userId"]
  );
}

export async function deleteStorageValue(
  pluginId: string,
  key: string,
  userId?: string
): Promise<void> {
  const repo = AppDataSource.getRepository(PluginStorage);
  await repo.delete({
    pluginId,
    key,
    userId: userId ?? GLOBAL_USER,
  });
}

export async function listStorageEntries(
  pluginId: string,
  prefix?: string,
  userId?: string
): Promise<Array<{ key: string; value: unknown; userId: string | null }>> {
  const repo = AppDataSource.getRepository(PluginStorage);
  const qb = repo
    .createQueryBuilder("ps")
    .where("ps.pluginId = :pluginId", { pluginId });

  if (userId !== undefined) {
    qb.andWhere("ps.userId = :userId", { userId });
  }
  if (prefix) {
    qb.andWhere("ps.key LIKE :prefix", { prefix: `${prefix}%` });
  }

  const entries = await qb.getMany();
  return entries.map((e) => ({
    key: e.key,
    value: e.value,
    userId: e.userId || null,
  }));
}
