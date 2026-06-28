import { applyDecorators, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../guards/admin.guard';

export function AdminOnly() {
  return applyDecorators(UseGuards(AdminGuard));
}
