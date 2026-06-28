import { Controller, Post, HttpCode } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/telemetry')
export class TelemetryController {
  @Post('collect')
  @Public()
  @HttpCode(200)
  collect() {
    // No-op stub - telemetry disabled for selfhost
    return {};
  }
}
