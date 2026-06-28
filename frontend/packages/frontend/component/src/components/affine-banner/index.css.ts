import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';
export const browserWarningStyle = style({
  backgroundColor: cssVar('backgroundWarningColor'),
  color: cssVar('warningColor'),
  width: '100%',
  padding: '8px 16px',
  fontSize: cssVar('fontSm'),
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  position: 'absolute',
  zIndex: 1,
});
export const closeButtonStyle = style({
  width: '36px',
  height: '36px',
  color: cssVar('iconColor'),
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  position: 'absolute',
  right: '16px',
});
export const closeIconStyle = style({
  width: '15px',
  height: '15px',
  position: 'relative',
  zIndex: 1,
});
