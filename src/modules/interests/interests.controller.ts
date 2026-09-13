import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
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
import {
  AcceptInterestResponseDto,
  InterestListItemDto,
  InterestResponseDto,
} from './dto/interest-response.dto';
import { InterestsService } from './interests.service';

/**
 * The interest lifecycle. Served under the global prefix, i.e.
 * `/api/v1/interests`. Every route requires a valid access token; the sender is
 * always the authenticated caller and only the receiver may respond.
 */
@ApiTags('Interests')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('interests')
export class InterestsController {
  constructor(private readonly interests: InterestsService) {}

  @Post(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an interest',
    description:
      'Sends an interest to another user. Both users must be in Nearby Mode with a ' +
      'fresh location within 250 m (verified server-side). Self-interests and ' +
      'duplicate pending interests are rejected.',
  })
  @ApiOkResponse({ type: InterestResponseDto })
  @ApiBadRequestResponse({ description: 'Cannot send an interest to yourself' })
  @ApiConflictResponse({
    description:
      'Not mutually discoverable (inactive, stale location, out of radius or unprofiled), ' +
      'or an interest already exists with this user',
  })
  send(
    @CurrentUserId() userId: string,
    @Param('userId') receiverId: string,
  ): Promise<InterestResponseDto> {
    return this.interests.send(userId, receiverId);
  }

  @Get('incoming')
  @ApiOperation({ summary: 'List received interests that are still actionable' })
  @ApiOkResponse({ type: [InterestListItemDto] })
  incoming(@CurrentUserId() userId: string): Promise<InterestListItemDto[]> {
    return this.interests.listIncoming(userId);
  }

  @Get('outgoing')
  @ApiOperation({ summary: 'List sent interests that are still pending' })
  @ApiOkResponse({ type: [InterestListItemDto] })
  outgoing(@CurrentUserId() userId: string): Promise<InterestListItemDto[]> {
    return this.interests.listOutgoing(userId);
  }

  @Post(':interestId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an interest',
    description:
      'Marks the received interest accepted and creates the persistent match. ' +
      'The match survives the users leaving the 250 m radius.',
  })
  @ApiOkResponse({ type: AcceptInterestResponseDto })
  @ApiNotFoundResponse({ description: 'Interest not found or not addressed to the caller' })
  @ApiConflictResponse({ description: 'The interest was already resolved or has expired' })
  accept(
    @CurrentUserId() userId: string,
    @Param('interestId') interestId: string,
  ): Promise<AcceptInterestResponseDto> {
    return this.interests.accept(userId, interestId);
  }

  @Post(':interestId/ignore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ignore an interest',
    description: 'Marks the received interest ignored. No match is created.',
  })
  @ApiOkResponse({ type: InterestResponseDto })
  @ApiNotFoundResponse({ description: 'Interest not found or not addressed to the caller' })
  @ApiConflictResponse({ description: 'The interest was already resolved or has expired' })
  ignore(
    @CurrentUserId() userId: string,
    @Param('interestId') interestId: string,
  ): Promise<InterestResponseDto> {
    return this.interests.ignore(userId, interestId);
  }
}
