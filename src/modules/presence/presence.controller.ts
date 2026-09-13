import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SWAGGER_BEARER_AUTH } from '../../config/swagger.setup';
import { NearbySessionResponseDto } from './dto/nearby-session-response.dto';
import { PresenceService } from './presence.service';

/**
 * Nearby Mode ("presence"). Served under the global prefix, i.e.
 * `/api/v1/nearby`. Every route requires a valid access token; the session
 * always belongs to the authenticated user.
 */
@ApiTags('Presence')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('nearby')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate Nearby Mode',
    description:
      'Starts (or renews) the caller\u2019s discovery session. It expires ' +
      'automatically after the configured TTL; calling this again extends it.',
  })
  @ApiOkResponse({ type: NearbySessionResponseDto })
  activate(@CurrentUserId() userId: string): Promise<NearbySessionResponseDto> {
    return this.presence.activate(userId);
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate Nearby Mode',
    description: 'Stops the caller\u2019s discovery session, removing them from active discovery.',
  })
  @ApiOkResponse({ type: NearbySessionResponseDto })
  deactivate(@CurrentUserId() userId: string): Promise<NearbySessionResponseDto> {
    return this.presence.deactivate(userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get the current Nearby Mode state' })
  @ApiOkResponse({ type: NearbySessionResponseDto })
  status(@CurrentUserId() userId: string): Promise<NearbySessionResponseDto> {
    return this.presence.getStatus(userId);
  }
}
