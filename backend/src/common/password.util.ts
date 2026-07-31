import { BadRequestException } from '@nestjs/common';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../modules/auth/dto/auth.dto';

/**
 * パスワード強度の検証。**パスワードを保存する経路はすべてここを通す。**
 *
 * サインアップ・本人による変更・Admin による再設定で判定がばらつくと、
 * 「ある経路からだけポリシーより弱いパスワードを設定できる」状態になる。
 * 実装を1か所に集約し、方針を変えるときの変更漏れを防ぐ。
 */
export function validatePasswordStrength(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new BadRequestException(
      `パスワードは${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字にしてください`,
    );
  }
}
