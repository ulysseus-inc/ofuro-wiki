import { Resolver, Mutation } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeleteAccountResult } from '../user/user.model';

@Resolver()
@UseGuards(JwtAuthGuard)
export class AuthResolver {
  constructor(private authService: AuthService) {}

  @Mutation(() => DeleteAccountResult)
  async deleteAccount(
    @CurrentUser() user: { id: string },
  ) {
    const success = await this.authService.deleteAccount(user.id);
    return { success };
  }
}
