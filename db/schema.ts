import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const boards = sqliteTable('boards', {
  userId: text('user_id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const boardOperations = sqliteTable('board_operations', {
  boardId:text('board_id').notNull(),
  operationId:text('operation_id').notNull(),
  actorId:text('actor_id').notNull(),
  payloadHash:text('payload_hash').notNull(),
  resultRevision:integer('result_revision').notNull(),
  createdAt:text('created_at').notNull(),
}, table=>[primaryKey({columns:[table.boardId,table.operationId]})]);

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  ownerEmail: text('owner_email').notNull(),
  ownerName: text('owner_name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const members = sqliteTable('members', {
  email: text('email').primaryKey(),
  userId: text('user_id').unique(),
  name: text('name').notNull().default(''),
  role: text('role').notNull(),
  active: integer('active').notNull().default(1),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastSeenAt: text('last_seen_at'),
});
