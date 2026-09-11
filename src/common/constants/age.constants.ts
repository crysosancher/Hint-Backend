/**
 * Age bounds shared by the profile (a user's own age) and the preference age
 * range, so validation and schema constraints can never drift apart.
 */
export const MIN_AGE = 13;
export const MAX_AGE = 100;

/** Defaults for the preference range (the setup slider's starting position). */
export const DEFAULT_AGE_MIN = 18;
export const DEFAULT_AGE_MAX = 50;
