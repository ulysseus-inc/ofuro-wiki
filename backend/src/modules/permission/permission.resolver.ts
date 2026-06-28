import { Resolver, Query, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Resolver()
@UseGuards(JwtAuthGuard)
export class PermissionResolver {
  constructor(private permissionService: PermissionService) {}

  @Query(() => String, { nullable: true })
  async workspaceRole(
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.permissionService.getWorkspaceRole(workspaceId, user.id);
  }
}
