import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
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
 * The single-user view of discovery — `GET /api/v1/users/:userId`.
 *
 * It lives beside the discovery service (rather than in a generic users module)
 * because it is *exactly* the same query narrowed to one id: the requested user
 * must still be actively discoverable and within 250 m. That reuse is what makes
 * the 250 m rule impossible to bypass with a direct id lookup.
 */
@ApiTags('Discovery')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('users')
export class EligibleUsersController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get(':userId')
  @ApiOperation({
    summary: 'View an eligible user\u2019s profile',
    description:
      'Returns the same safe profile as discovery, but for a single user id. ' +
      'Responds 404 whenever that user is not currently discoverable by the caller ' +
      '(out of range, not in Nearby Mode, or without a profile), so the endpoint ' +
      'cannot be used to probe for accounts.',
  })
  @ApiOkResponse({ type: NearbyProfileDto })
  @ApiNotFoundResponse({ description: 'The user is not currently discoverable by the caller' })
  @ApiConflictResponse({
    description: 'Nearby Mode is not active, or the caller has no fresh location',
  })
  async get(
    @CurrentUserId() userId: string,
    @Param('userId') targetUserId: string,
  ): Promise<NearbyProfileDto> {
    const profile = await this.discovery.findEligibleProfile(userId, targetUserId);
    if (!profile) {
      throw new NotFoundException('User not found');
    }
    return profile;
  }
}
