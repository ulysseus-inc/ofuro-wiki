import { memo } from 'react';

export default memo(function Logo() {
  return (
    <img
      src="/favicon-192.png"
      alt="ofuro-wiki"
      width={120}
      height={120}
      style={{ borderRadius: '24px' }}
    />
  );
});
