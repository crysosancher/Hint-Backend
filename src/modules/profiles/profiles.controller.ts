import { Body, Controller, Get, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SWAGGER_BEARER_AUTH } from '../../config/swagger.setup';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { ProfilesService } from './profiles.service';

/**
 * The current user's profile. Served under the global prefix, i.e.
 * `/api/v1/profile`. Every route requires a valid access token.
 */
@ApiTags('Profiles')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiNotFoundResponse({ description: 'The user has not created a profile yet' })
  async get(@CurrentUserId() userId: string): Promise<ProfileResponseDto> {
    const profile = await this.profiles.get(userId);
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }

  @Patch()
  @ApiOperation({
    summary: 'Create or update the current user profile',
    description:
      'Upserts the profile for the authenticated user. The response is the stored profile.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  upsert(
    @CurrentUserId() userId: string,
    @Body() dto: UpsertProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profiles.upsert(userId, dto);
  }
}
