import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body for `POST /api/v1/auth/login`. */
export class LoginDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: 254, description: 'Account email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Sunshine123', description: 'Account password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
