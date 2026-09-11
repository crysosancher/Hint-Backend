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
import { PreferencesResponseDto } from './dto/preferences-response.dto';
import { UpsertPreferencesDto } from './dto/upsert-preferences.dto';
import { PreferencesService } from './preferences.service';

/**
 * The current user's matching preferences. Served at `/api/v1/preferences`.
 * Every route requires a valid access token.
 */
@ApiTags('Preferences')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user preferences' })
  @ApiOkResponse({ type: PreferencesResponseDto })
  @ApiNotFoundResponse({ description: 'The user has not set preferences yet' })
  async get(@CurrentUserId() userId: string): Promise<PreferencesResponseDto> {
    const preferences = await this.preferences.get(userId);
    if (!preferences) {
      throw new NotFoundException('Preferences not found');
    }
    return preferences;
  }

  @Patch()
  @ApiOperation({
    summary: 'Create or update the current user preferences',
    description:
      'Upserts partially: omitted fields keep their stored value (or the default on first write).',
  })
  @ApiOkResponse({ type: PreferencesResponseDto })
  upsert(
    @CurrentUserId() userId: string,
    @Body() dto: UpsertPreferencesDto,
  ): Promise<PreferencesResponseDto> {
    return this.preferences.upsert(userId, dto);
  }
}
