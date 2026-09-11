import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /api/v1/auth/register`.
 *
 * Signup is intentionally minimal — email + password only. Name, age, gender,
 * photo and bio are collected later on the Profile/Preferences screens.
 */
export class RegisterDto {
  @ApiProperty({
    example: 'ada@example.com',
    maxLength: 254,
    description: 'Account email; also used as the login identifier',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Sunshine123',
    minLength: 8,
    maxLength: 128,
    description: 'At least 8 characters, including one letter and one number',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @ApiProperty({
    example: 'Sunshine123',
    description: 'Must match `password` exactly',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword!: string;
}
