/**
 * Lifecycle of an interest sent from one user toward another.
 *
 * `Sent` is the only non-terminal state; `Accepted`, `Ignored` and `Expired`
 * are terminal. Acceptance creates a persistent `Match` (see the Match
 * module): the 250 m rule governs *initiating* an interest, but once a match
 * exists it survives the participants leaving the radius.
 */
export enum InterestStatus {
  Sent = 'sent',
  Accepted = 'accepted',
  Ignored = 'ignored',
  Expired = 'expired',
}
