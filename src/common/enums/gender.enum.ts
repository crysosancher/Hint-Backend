/**
 * Self-identified gender. Shared by the profile (own gender) and preference
 * (preferred genders) documents; stored as a snake_case string.
 */
export enum Gender {
  Woman = 'woman',
  Man = 'man',
  NonBinary = 'non_binary',
}
