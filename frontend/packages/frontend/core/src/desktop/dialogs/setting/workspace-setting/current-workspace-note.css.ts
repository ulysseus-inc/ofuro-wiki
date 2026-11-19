import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const note = style({
  marginBottom: '16px',
});

export const current = style({
  fontSize: '14px',
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const hint = style({
  marginTop: '2px',
  fontSize: '12px',
  color: cssVarV2('text/secondary'),
});
