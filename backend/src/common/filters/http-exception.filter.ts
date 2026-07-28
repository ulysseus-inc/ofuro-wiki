import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** #93: ステータスコードから機械可読なエラー名を決める */
const HTTP_ERROR_NAMES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
};

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      return; // Let GraphQL handle its own errors
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    this.logger.warn(
      `HTTP ${status}: ${request.method} ${request.url} - ${exception.message}`,
    );

    // #93: フロントエンドの UserFriendlyError.fromAny() は `type` / `name` / `message`
    // が揃っているときだけ status を保持する（欠けていると一律 500 の UnknownError に
    // 潰れる）。ステータスコードで分岐できるよう、その形に合わせて返す。
    // 例: 429 を「レート制限」として画面表示に反映するため。
    const name = HTTP_ERROR_NAMES[status] ?? 'HTTP_ERROR';

    response.status(status).json({
      // 既存の利用箇所のために従来のフィールドも残す
      statusCode: status,
      timestamp: new Date().toISOString(),
      // UserFriendlyErrorResponse 互換
      status,
      code: name,
      type: name,
      name,
      message: exception.message,
    });
  }
}
