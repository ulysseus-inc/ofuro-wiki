import { BrowserWarning } from '@ofuro/component/affine-banner';
import { Trans, useI18n } from '@ofuro/i18n';
import { useState } from 'react';

const minimumChromeVersion = 106;

const shouldShowWarning = (() => {
  if (BUILD_CONFIG.isElectron) {
    // even though desktop has compatibility issues,
    //  we don't want to show the warning
    return false;
  }
  if (BUILD_CONFIG.isMobileEdition) {
    return true;
  }
  if (environment.isChrome && environment.chromeVersion) {
    return environment.chromeVersion < minimumChromeVersion;
  }
  return false;
})();

const OSWarningMessage = () => {
  const t = useI18n();
  const notChrome = !environment.isChrome;
  const notGoodVersion =
    environment.isChrome &&
    environment.chromeVersion &&
    environment.chromeVersion < minimumChromeVersion;

  // TODO(@L-Sun): remove this message when mobile version is able to edit.
  if (environment.isMobile) {
    return <span>{t['com.affine.top-tip.mobile']()}</span>;
  }

  if (notChrome) {
    return (
      <span>
        <Trans i18nKey="recommendBrowser">
          We recommend the <strong>Chrome</strong> browser for an optimal
          experience.
        </Trans>
      </span>
    );
  } else if (notGoodVersion) {
    return <span>{t['upgradeBrowser']()}</span>;
  }

  return null;
};

export const TopTip = () => {
  const [showWarning, setShowWarning] = useState(shouldShowWarning);

  return (
    <BrowserWarning
      show={showWarning}
      message={<OSWarningMessage />}
      onClose={() => {
        setShowWarning(false);
      }}
    />
  );
};
