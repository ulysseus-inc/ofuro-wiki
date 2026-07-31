import { UserFriendlyError } from '@ofuro/error';
import type { PasswordLimitsFragment } from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import type { FC } from 'react';
import { useCallback, useState } from 'react';

import { Button } from '../../ui/button';
import { notify } from '../../ui/notification';
import { AuthPageContainer } from './auth-page-container';
import { SetPassword } from './set-password';

export const ChangePasswordPage: FC<{
  passwordLimits: PasswordLimitsFragment;
  onSetPassword: (password: string) => Promise<void>;
  onOpenAffine: () => void;
}> = ({ passwordLimits, onSetPassword: propsOnSetPassword, onOpenAffine }) => {
  const t = useI18n();
  const [hasSetUp, setHasSetUp] = useState(false);

  const onSetPassword = useCallback(
    (passWord: string) => {
      propsOnSetPassword(passWord)
        .then(() => setHasSetUp(true))
        .catch(e => {
          // 使用済み・期限切れの URL で送信したときにここへ来る。
          // サーバーは言語に依存しないエラー名（INVALID_EMAIL_TOKEN 等）を返すので、
          // 利用者の言語の文言に差し替える。生の英語メッセージは出さない。
          const error = UserFriendlyError.fromAny(e);
          const i18nKey = `error.${error.name}`;
          const translated = t[i18nKey](error.data);
          // ⚠️ 翻訳が無いキーを引くと、i18n は**キー文字列をそのまま返す**。
          // そのまま表示すると `error.undefined` 等が利用者に見えてしまうため、
          // 「返り値がキーと同じ＝翻訳が無い」とみなして元のメッセージを出す。
          // エラー名を持たない例外（サーバーが文章を返すもの）もここに来る。
          // ※ `i18nKey in t` で判定しないのは、i18n が Proxy 実装で
          //    `has` の挙動に依存したくないため（返り値だけを見れば足りる）。
          notify.error({
            title: t['com.affine.auth.password.set-failed'](),
            message:
              translated === i18nKey ? error.message || String(e) : translated,
          });
        });
    },
    [propsOnSetPassword, t]
  );

  return (
    <AuthPageContainer
      title={
        hasSetUp
          ? t['com.affine.auth.reset.password.page.success']()
          : t['com.affine.auth.reset.password.page.title']()
      }
      subtitle={
        hasSetUp
          ? t['com.affine.auth.sent.reset.password.success.message']()
          : t['com.affine.auth.page.sent.email.subtitle']({
              min: String(passwordLimits.minLength),
              max: String(passwordLimits.maxLength),
            })
      }
    >
      {hasSetUp ? (
        <Button variant="primary" size="large" onClick={onOpenAffine}>
          {t['com.affine.auth.open.affine']()}
        </Button>
      ) : (
        <SetPassword
          passwordLimits={passwordLimits}
          onSetPassword={onSetPassword}
        />
      )}
    </AuthPageContainer>
  );
};
