import type { NaverAccount, Post, PublishRecord } from "../types.js";
import { PATHS } from "../paths.js";
import { readJson, writeJson } from "./json.js";

interface Db {
  posts: Post[];
  publishes: PublishRecord[];
  account: NaverAccount;
}

const EMPTY: Db = {
  posts: [],
  publishes: [],
  account: { loggedIn: false, blogId: null, nickname: null, checkedAt: null },
};

function read(): Db {
  return { ...EMPTY, ...readJson<Partial<Db>>(PATHS.db, {}) };
}

function write(db: Db): void {
  writeJson(PATHS.db, db);
}

export function listPosts(): Post[] {
  return read().posts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPost(id: string): Post | null {
  return read().posts.find((p) => p.id === id) ?? null;
}

export function upsertPost(post: Post): Post {
  const db = read();
  const index = db.posts.findIndex((p) => p.id === post.id);
  const next = { ...post, updatedAt: new Date().toISOString() };
  if (index >= 0) db.posts[index] = next;
  else db.posts.push(next);
  write(db);
  return next;
}

export function recordPublish(record: PublishRecord): void {
  const db = read();
  db.publishes.push(record);
  write(db);
}

export function listPublishes(): PublishRecord[] {
  return read().publishes.slice().sort((a, b) => b.at.localeCompare(a.at));
}

export function getAccount(): NaverAccount {
  return read().account;
}

export function setAccount(account: NaverAccount): void {
  const db = read();
  db.account = account;
  write(db);
}
