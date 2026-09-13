import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SWAGGER_BEARER_AUTH } from '../../config/swagger.setup';
import { DiscoveryService } from './discovery.service';
import { NearbyProfileDto } from './dto/discovery-response.dto';

/**
 * Discoverable users within 250 m. Served under the global prefix, i.e.
 * `/api/v1/discovery`. Every route requires a valid access token; the caller's
 * own identity always comes from that token, never from the request body.
 */
@ApiTags('Discovery')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('nearby')
  @ApiOperation({
    summary: 'Find eligible nearby users',
    description:
      'Returns users who are currently in Nearby Mode, have a profile and whose ' +
      'latest valid location is within the configured radius (250 m by default). ' +
      'The distance check is server-authoritative and only a coarse distance is returned.',
  })
  @ApiOkResponse({ type: [NearbyProfileDto], description: 'Nearest eligible users first' })
  @ApiConflictResponse({
    description: 'Nearby Mode is not active, or the caller has no fresh location',
  })
  findNearby(@CurrentUserId() userId: string): Promise<NearbyProfileDto[]> {
    return this.discovery.findNearby(userId);
  }
}
