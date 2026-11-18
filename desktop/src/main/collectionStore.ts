import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { ApiCollectionFile } from "../shared/apiWorkbenchTypes";
import { getRepoRoot } from "./repo";

function collectionsDir(projectId: string): string {
  return path.join(getRepoRoot(), "projects", projectId, "collections");
}

function collectionPath(projectId: string, collectionId: string): string {
  return path.join(collectionsDir(projectId), `${collectionId}.json`);
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

export async function listCollections(
  projectId: string,
): Promise<Array<{ id: string; name: string; requestCount: number }>> {
  const dir = collectionsDir(projectId);
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ id: string; name: string; requestCount: number }> = [];
  for (const f of files.filter((x) => x.endsWith(".json"))) {
    const id = f.replace(/\.json$/, "");
    try {
      const text = await fs.readFile(path.join(dir, f), "utf8");
      const doc = JSON.parse(text) as ApiCollectionFile;
      out.push({
        id: doc.id ?? id,
        name: doc.name ?? id,
        requestCount: doc.requests?.length ?? 0,
      });
    } catch {
      out.push({ id, name: id, requestCount: 0 });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return out;
}

export async function getCollection(
  projectId: string,
  collectionId: string,
): Promise<ApiCollectionFile | null> {
  try {
    const text = await fs.readFile(collectionPath(projectId, collectionId), "utf8");
    return JSON.parse(text) as ApiCollectionFile;
  } catch {
    return null;
  }
}

export async function saveCollection(projectId: string, collection: ApiCollectionFile): Promise<{ ok: boolean }> {
  const dir = collectionsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const normalized: ApiCollectionFile = {
    ...collection,
    id: collection.id || "default",
    name: collection.name || collection.id,
    folders: collection.folders ?? [],
    requests: collection.requests ?? [],
  };
  await fs.writeFile(
    collectionPath(projectId, normalized.id),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return { ok: true };
}

export async function ensureCollection(projectId: string, collectionId: string): Promise<ApiCollectionFile> {
  const existing = await getCollection(projectId, collectionId);
  if (existing) return existing;
  const created: ApiCollectionFile = {
    id: collectionId,
    name: collectionId === "default" ? "默认模块" : collectionId,
    folders: [],
    requests: [],
  };
  await saveCollection(projectId, created);
  return created;
}

export function makeRequestId(): string {
  return newId();
}

export async function deleteCollection(
  projectId: string,
  collectionId: string,
): Promise<{ ok: boolean; error?: string; recreatedDefault?: boolean }> {
  const list = await listCollections(projectId);
  const target = list.find((c) => c.id === collectionId);
  if (!target) {
    return { ok: false, error: "集合不存在" };
  }
  try {
    await fs.unlink(collectionPath(projectId, collectionId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("ENOENT") ? "集合不存在" : msg };
  }
  const after = await listCollections(projectId);
  if (!after.length) {
    await ensureCollection(projectId, "default");
    return { ok: true, recreatedDefault: true };
  }
  return { ok: true };
}