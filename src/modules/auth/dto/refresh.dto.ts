import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Body for `POST /api/v1/auth/refresh`. */
export class RefreshDto {
  @ApiProperty({
    description: 'The refresh token issued by register/login (or a previous refresh)',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
