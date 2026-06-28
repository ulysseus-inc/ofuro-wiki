import { style } from '@vanilla-extract/css';

export const root = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: -1,
});

export const warmBg = style({
  height: '100%',
  width: '100%',
  position: 'absolute',
  zIndex: -1,
  top: 0,
  left: 0,
  backgroundColor: '#fef7f0',
});
