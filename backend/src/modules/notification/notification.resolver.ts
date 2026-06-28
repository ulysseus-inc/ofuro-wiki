import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Resolver()
@UseGuards(JwtAuthGuard)
export class NotificationResolver {
  constructor(private notificationService: NotificationService) {}

  @Mutation(() => Boolean)
  async readNotification(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => String }) id: string,
  ) {
    return this.notificationService.readNotification(user.id, id);
  }

  @Mutation(() => Boolean)
  async readAllNotifications(@CurrentUser() user: { id: string }) {
    return this.notificationService.readAllNotifications(user.id);
  }
}
