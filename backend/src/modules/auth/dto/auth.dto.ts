import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// パスワードポリシー（サインアップ・変更時に適用）
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export class SignInDto {
  @IsEmail({}, { message: 'メールアドレスの形式が正しくありません' })
  email: string;

  // サインインは既存ユーザーの認証。長さポリシーは課さず、空でないことのみ検証する。
  @IsString()
  @IsNotEmpty({ message: 'パスワードを入力してください' })
  password: string;
}

export class SignUpDto {
  @IsEmail({}, { message: 'メールアドレスの形式が正しくありません' })
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `パスワードは${PASSWORD_MAX_LENGTH}文字以下にしてください`,
  })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class PreflightDto {
  @IsEmail({}, { message: 'メールアドレスの形式が正しくありません' })
  email: string;
}
