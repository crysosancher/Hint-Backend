/**
 * Names, ids and injection tokens for the BullMQ layer.
 *
 * Kept in one place so producers (API process) and consumers (worker process)
 * can never drift apart: both sides derive the queue names, job names and
 * scheduler ids from these constants.
 */

/** Injection token for the shared BullMQ connection options. */
export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');

/** Injection token for the interest-expiry queue producer. */
export const INTEREST_EXPIRY_QUEUE = Symbol('INTEREST_EXPIRY_QUEUE');

/** Injection token for the presence-expiry queue producer. */
export const PRESENCE_EXPIRY_QUEUE = Symbol('PRESENCE_EXPIRY_QUEUE');

/** Injection token for the location-cleanup queue producer. */
export const LOCATION_CLEANUP_QUEUE = Symbol('LOCATION_CLEANUP_QUEUE');

/** Redis-backed queue names (namespaced further by the configured prefix). */
export const QUEUE_NAMES = {
  interestExpiry: 'interest-expiry',
  presenceExpiry: 'presence-expiry',
  locationCleanup: 'location-cleanup',
} as const;

/** The job name each queue accepts. */
export const QUEUE_JOBS = {
  interestExpirySweep: 'sweep',
  presenceExpiry: 'expire',
  locationCleanupSweep: 'sweep',
} as const;

/** BullMQ Job Scheduler ids for the repeatable sweeps (one per queue). */
export const QUEUE_SCHEDULERS = {
  interestExpirySweep: 'interest-expiry-sweep',
  locationCleanupSweep: 'location-cleanup-sweep',
} as const;

/** Payload of a delayed presence-expiry job. */
export interface PresenceExpiryJobData {
  userId: string;
}

/**
 * Stable job id for a user's pending presence-expiry job.
 *
 * A user has at most one pending expiry, and a stable id is what lets
 * re-activation replace (rather than duplicate) it.
 */
export function presenceExpiryJobId(userId: string): string {
  return `presence-expiry:${userId}`;
}
