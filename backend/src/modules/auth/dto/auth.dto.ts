import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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

  /** #293: 「作りますか」で承認した。無ければアカウントを作らない */
  @IsOptional()
  @IsBoolean()
  create?: boolean;

  /** #195: 招待のページから来た（本人宛てのメール招待なら、閉じた環境でも作れる） */
  @IsOptional()
  @IsUUID()
  inviteId?: string;
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
