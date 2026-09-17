import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const container = style({
  fontSize: cssVar('fontBase'),
  color: cssVar('textPrimaryColor'),
  height: '100%',
  width: '100%',
  padding: '0 20px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '24px',
  textAlign: 'center',
});

export const title = style({
  fontSize: cssVar('fontH5'),
  fontWeight: 600,
});

export const hint = style({
  maxWidth: '520px',
  color: cssVar('textSecondaryColor'),
  lineHeight: 1.6,
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  justifyContent: 'center',
});
