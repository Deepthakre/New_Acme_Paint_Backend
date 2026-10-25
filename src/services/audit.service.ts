import type { ClientSession } from 'mongoose';
import { AuditLog, type IAuditLog } from '../models/AuditLog';

interface AuditInput {
  action: string;
  actorType: IAuditLog['actorType'];
  actorId: string;
  refType: string;
  refId: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** Writes an immutable audit row (part of the same transaction when a session is given). */
export async function audit(entry: AuditInput, session?: ClientSession): Promise<void> {
  await AuditLog.create(
    [{ ...entry, meta: entry.meta ?? {}, ip: entry.ip ?? null }],
    session ? { session } : undefined
  );
}
