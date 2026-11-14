import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
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

/** Clouds a member may see and edit. Admins and the owner see every cloud without rows here. */
export const cloudAccess = sqliteTable('cloud_access', {
  memberEmail: text('member_email').notNull(),
  noteId: text('note_id').notNull(),
  createdAt: text('created_at').notNull(),
}, table=>[primaryKey({columns:[table.memberEmail,table.noteId]})]);

/** Comments and material metadata stay outside the single-row board payload. */
export const taskMaterials=sqliteTable('task_materials',{
 id:text('id').primaryKey(),boardId:text('board_id').notNull(),taskId:text('task_id').notNull(),kind:text('kind').notNull(),
 text:text('text').notNull().default(''),title:text('title').notNull().default(''),source:text('source').notNull().default('other'),sourceUrl:text('source_url').notNull().default(''),url:text('url').notNull().default(''),
 fileKey:text('file_key'),fileName:text('file_name'),fileSize:integer('file_size'),authorId:text('author_id').notNull(),authorName:text('author_name').notNull(),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),revision:integer('revision').notNull().default(1),
},table=>[index('task_materials_task').on(table.boardId,table.taskId,table.createdAt)]);

/** Google credentials never enter the board or its downloadable backups. */
export const calendarConnections=sqliteTable('calendar_connections',{
 boardId:text('board_id').primaryKey(),ownerId:text('owner_id').notNull(),calendarId:text('calendar_id'),
 refreshToken:text('refresh_token'),timeZone:text('time_zone').notNull().default('UTC'),enabled:integer('enabled').notNull().default(0),
 lastSync:text('last_sync'),error:text('error'),lease:text('lease'),leaseUntil:integer('lease_until').notNull().default(0),
});
export const calendarLinks=sqliteTable('calendar_links',{
 boardId:text('board_id').notNull(),taskId:text('task_id').notNull(),eventId:text('event_id').notNull(),
 generation:integer('generation').notNull().default(0),baseline:text('baseline').notNull().default('null'),
 pending:text('pending'),conflict:text('conflict'),resolution:text('resolution'),checkedAt:integer('checked_at').notNull().default(0),
},table=>[primaryKey({columns:[table.boardId,table.taskId]}),index('calendar_links_event').on(table.boardId,table.eventId)]);
export const calendarOauth=sqliteTable('calendar_oauth',{
 stateHash:text('state_hash').primaryKey(),boardId:text('board_id').notNull(),ownerId:text('owner_id').notNull(),
 verifier:text('verifier').notNull(),redirectUri:text('redirect_uri').notNull(),timeZone:text('time_zone').notNull(),expiresAt:integer('expires_at').notNull(),
});
