import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { keyframes, style } from '@vanilla-extract/css';

export const adminPanel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
});

export const searchBar = style({
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  marginBottom: '8px',
});

export const searchInput = style({
  flex: 1,
  padding: '8px 12px',
  borderRadius: '8px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  fontSize: cssVar('fontSm'),
  outline: 'none',
  color: cssVarV2('text/primary'),
  selectors: {
    '&:focus': {
      borderColor: cssVarV2('button/primary'),
    },
    '&::placeholder': {
      color: cssVarV2('text/placeholder'),
    },
  },
});

export const userTable = style({
  borderRadius: '12px',
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflow: 'hidden',
});

export const userRow = style({
  padding: '12px 16px',
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:not(:last-of-type)': {
      borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const userInfo = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  marginLeft: '12px',
  overflow: 'hidden',
});

export const userName = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: '22px',
});

export const userEmail = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: '20px',
});

export const userActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginLeft: '12px',
  flexShrink: 0,
});

export const adminBadge = style({
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  background: cssVarV2('button/primary'),
  color: cssVarV2('button/pureWhiteText'),
});

export const pagination = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 0',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
});

export const paginationButtons = style({
  display: 'flex',
  gap: '8px',
});

export const createUserForm = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '16px',
  borderRadius: '12px',
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const formRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
});

export const formLabel = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  fontWeight: 500,
});

export const formInput = style({
  padding: '8px 12px',
  borderRadius: '8px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  fontSize: cssVar('fontSm'),
  outline: 'none',
  color: cssVarV2('text/primary'),
  selectors: {
    '&:focus': {
      borderColor: cssVarV2('button/primary'),
    },
  },
});

export const formActions = style({
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
  marginTop: '4px',
});

export const settingItem = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 16px',
  selectors: {
    '&:not(:last-of-type)': {
      borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const settingLabel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
});

export const settingName = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  fontWeight: 500,
});

export const settingDesc = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
});

export const emptyState = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '32px',
  color: cssVarV2('text/secondary'),
  fontSize: cssVar('fontSm'),
});

export const backupTable = style({
  borderRadius: '12px',
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflow: 'hidden',
});

export const backupRow = style({
  padding: '12px 16px',
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  gap: '16px',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:not(:last-of-type)': {
      borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const backupInfo = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const backupName = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: '22px',
});

export const backupMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: '20px',
});

export const backupActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginLeft: '12px',
  flexShrink: 0,
});

export const statusBadge = style({
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
});

export const statusCompleted = style({
  background: '#e6f4ea',
  color: '#1e7e34',
});

export const statusFailed = style({
  background: '#fce8e6',
  color: '#c5221f',
});

export const restoreProgress = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '24px 16px',
  justifyContent: 'center',
});

const spin = keyframes({
  to: { transform: 'rotate(360deg)' },
});

export const restoreSpinner = style({
  width: '20px',
  height: '20px',
  border: `2px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderTopColor: cssVarV2('button/primary'),
  borderRadius: '50%',
  animation: `${spin} 0.8s linear infinite`,
});

export const restoreStepText = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
});
