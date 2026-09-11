import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../users/user.schema';

/** Public representation of an account — never exposes the password hash. */
export class SafeUserDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'User id' })
  id!: string;

  @ApiProperty({ example: 'ada@example.com', description: 'Account email' })
  email!: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.Active, description: 'Account status' })
  status!: UserStatus;

  @ApiProperty({ example: '2026-09-11T00:00:00.000Z', description: 'Account creation time' })
  createdAt!: string;
}

/** Response returned by register, login and refresh. */
export class AuthResponseDto {
  @ApiProperty({ type: SafeUserDto })
  user!: SafeUserDto;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Short-lived bearer token for the Authorization header',
  })
  accessToken!: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Long-lived token used at POST /auth/refresh',
  })
  refreshToken!: string;
}
