import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const banner = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 16px',
  margin: '0 auto',
  maxWidth: 'var(--affine-editor-width)',
  width: '100%',
  fontSize: 'var(--affine-font-sm)',
  color: cssVarV2.text.secondary,
  backgroundColor: cssVarV2.layer.background.secondary,
  borderRadius: '8px',
  boxSizing: 'border-box',
});

export const icon = style({
  fontSize: 16,
  color: cssVarV2.icon.primary,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
});

export const message = style({
  flex: 1,
});
