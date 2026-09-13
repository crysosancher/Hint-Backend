import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { LocationResponseDto } from './dto/location-response.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationService } from './location.service';

/**
 * Location ingestion. Served under the global prefix, i.e.
 * `/api/v1/location`. Every route requires a valid access token and only ever
 * exposes the caller's own coordinates.
 */
@ApiTags('Location')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update the current location',
    description:
      'Ingests the caller\u2019s latest GPS fix. Requires an active Nearby Mode ' +
      'session and an accuracy within the configured maximum.',
  })
  @ApiOkResponse({ type: LocationResponseDto })
  @ApiBadRequestResponse({ description: 'Coordinates out of range or accuracy too poor' })
  @ApiConflictResponse({ description: 'Nearby Mode is not active' })
  update(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationResponseDto> {
    return this.locations.update(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get the current user\u2019s latest location' })
  @ApiOkResponse({ type: LocationResponseDto })
  @ApiNotFoundResponse({ description: 'No location has been ingested yet' })
  async get(@CurrentUserId() userId: string): Promise<LocationResponseDto> {
    const location = await this.locations.get(userId);
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    return location;
  }
}
