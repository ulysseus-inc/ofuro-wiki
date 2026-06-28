import { keyframes, style } from '@vanilla-extract/css';

const float1 = keyframes({
  '0%, 100%': { transform: 'translateY(0) scale(1)', opacity: '0.18' },
  '50%': { transform: 'translateY(-60px) scale(1.15)', opacity: '0.08' },
});

const float2 = keyframes({
  '0%, 100%': { transform: 'translateY(0) scale(1)', opacity: '0.14' },
  '50%': { transform: 'translateY(-80px) scale(1.1)', opacity: '0.05' },
});

const float3 = keyframes({
  '0%, 100%': { transform: 'translateY(0) scale(1)', opacity: '0.12' },
  '50%': { transform: 'translateY(-50px) scale(1.2)', opacity: '0.04' },
});

export const wrapper = style({
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 0,
});

export const steamOrb1 = style({
  position: 'absolute',
  width: '400px',
  height: '400px',
  borderRadius: '50%',
  background:
    'radial-gradient(circle, rgba(210, 160, 110, 0.18) 0%, rgba(210, 160, 110, 0) 70%)',
  bottom: '10%',
  right: '5%',
  animation: `${float1} 8s ease-in-out infinite`,
});

export const steamOrb2 = style({
  position: 'absolute',
  width: '300px',
  height: '300px',
  borderRadius: '50%',
  background:
    'radial-gradient(circle, rgba(190, 140, 90, 0.14) 0%, rgba(190, 140, 90, 0) 70%)',
  bottom: '20%',
  right: '15%',
  animation: `${float2} 10s ease-in-out infinite`,
  animationDelay: '-3s',
});

export const steamOrb3 = style({
  position: 'absolute',
  width: '250px',
  height: '250px',
  borderRadius: '50%',
  background:
    'radial-gradient(circle, rgba(220, 180, 130, 0.12) 0%, rgba(220, 180, 130, 0) 70%)',
  bottom: '5%',
  right: '25%',
  animation: `${float3} 12s ease-in-out infinite`,
  animationDelay: '-6s',
});
