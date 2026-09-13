import { Controller, Get, UseGuards } from '@nestjs/common';
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
import { MatchListItemDto } from './dto/match-response.dto';
import { MatchService } from './matches.service';

/**
 * The current user's matches. Served under the global prefix, i.e.
 * `/api/v1/matches`. Every route requires a valid access token; a user only ever
 * sees matches they are a participant in.
 */
@ApiTags('Matches')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchService) {}

  @Get()
  @ApiOperation({
    summary: 'List the current user\u2019s matches',
    description:
      'Returns the caller\u2019s active matches, newest first, each with the other ' +
      'participant\u2019s safe profile. Matches persist after the users leave the 250 m radius.',
  })
  @ApiOkResponse({ type: [MatchListItemDto] })
  list(@CurrentUserId() userId: string): Promise<MatchListItemDto[]> {
    return this.matches.listForUser(userId);
  }
}
