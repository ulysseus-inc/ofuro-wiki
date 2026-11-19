import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

/** M3: 画面はエラーの name で「登録されていません」を見分ける（docs/signin-registration.md 4.1） */
describe('HttpExceptionFilter の name', () => {
  function respond(exception: any) {
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/api/auth/sign-in' }),
        getResponse: () => res,
      }),
    };
    new HttpExceptionFilter().catch(exception, host as never);
    return json.mock.calls[0][0];
  }

  it('例外が name を持てば、それを返す', () => {
    const body = respond(
      new UnauthorizedException({ message: 'Account not found', name: 'USER_NOT_FOUND' }),
    );

    expect(body).toMatchObject({
      status: 401,
      name: 'USER_NOT_FOUND',
      type: 'USER_NOT_FOUND',
      message: 'Account not found',
    });
  });

  it('name が無ければ、今までどおりステータスから決める', () => {
    expect(respond(new UnauthorizedException('Invalid credentials')).name).toBe(
      'UNAUTHORIZED',
    );
    expect(respond(new NotFoundException()).name).toBe('NOT_FOUND');
  });
});
