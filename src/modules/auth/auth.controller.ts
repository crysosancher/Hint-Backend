import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * Authentication endpoints. Served under the global `api/v1` prefix, i.e.
 * `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Registers a new account and returns an access/refresh token pair, so the ' +
      'client is signed in immediately (no separate login step).',
  })
  @ApiCreatedResponse({ type: AuthResponseDto, description: 'Account created and signed in' })
  @ApiBadRequestResponse({ description: 'Validation failed or passwords do not match' })
  @ApiConflictResponse({ description: 'An account with this email already exists' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate', description: 'Exchanges credentials for a token pair.' })
  @ApiOkResponse({ type: AuthResponseDto, description: 'Authenticated' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or inactive account' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Consumes the supplied refresh token and issues a new access/refresh pair. ' +
      'Tokens are single-use, so a rotated token can never be replayed.',
  })
  @ApiOkResponse({ type: AuthResponseDto, description: 'New token pair issued' })
  @ApiUnauthorizedResponse({ description: 'Refresh token is invalid, expired or already used' })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return this.auth.refresh(dto);
  }
}
