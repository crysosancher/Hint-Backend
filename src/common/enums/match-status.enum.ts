/**
 * Lifecycle of a persistent mutual match.
 *
 * The MVP only ever creates `Active` matches; `Closed` and `Blocked` are
 * reserved for the Moderation module so the vocabulary exists before it is
 * needed. A match is deliberately permanent across the 250 m boundary.
 */
export enum MatchStatus {
  Active = 'active',
  Closed = 'closed',
  Blocked = 'blocked',
}
