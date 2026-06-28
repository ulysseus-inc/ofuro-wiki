import { cssVar } from '@toeverything/theme';
import { globalStyle, style, type StyleRule } from '@vanilla-extract/css';

export const docEditorRoot = style({
  overflowX: 'clip',
  display: 'flex',
  flexDirection: 'column',
});

export const affineDocViewport = style({
  height: '100%',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  paddingBottom: '100px',
});
export const affineEdgelessDocViewport = style({
  height: '100%',
  flex: 1,
});

export const docContainer = style({
  display: 'block',
  selectors: ['generating', 'finished', 'error'].reduce<
    NonNullable<StyleRule['selectors']>
  >((rules, state) => {
    rules[`&:has(affine-ai-panel-widget[data-state='${state}'])`] = {
      paddingBottom: '980px',
    };
    return rules;
  }, {}),
});

export const docEditorGap = style({
  display: 'block',
  width: '100%',
  margin: '0 auto',
  paddingTop: 50,
  paddingBottom: 50,
  cursor: 'text',
  flexGrow: 1,
});

const titleTagBasic = style({
  fontSize: cssVar('fontH4'),
  fontWeight: 600,
  padding: '0 4px',
  borderRadius: '4px',
  marginLeft: '4px',
  lineHeight: '0px',
});
export const titleDayTag = style([
  titleTagBasic,
  {
    color: cssVar('textSecondaryColor'),
  },
]);
export const titleTodayTag = style([
  titleTagBasic,
  {
    color: cssVar('brandColor'),
  },
]);
export const pageReferenceIcon = style({
  verticalAlign: 'middle',
  fontSize: '1.1em',
  transform: 'translate(2px, -1px)',
});

export const docTitleWithIcon = style({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  maxWidth: cssVar('editorWidth'),
  margin: '0 auto',
  paddingTop: 38,
  paddingLeft: cssVar('editorSidePadding', '24px'),
  paddingRight: cssVar('editorSidePadding', '24px'),
  boxSizing: 'border-box',
  gap: 12,
});

// アイコン付きタイトル: アイコンコンテナのパディング・マージンを除去
globalStyle(`.${docTitleWithIcon} .doc-icon-container`, {
  padding: 0,
  width: 'auto',
  maxWidth: 'none',
  marginLeft: 0,
  marginRight: 0,
  flexShrink: 0,
});

// アイコン付きタイトル: アイコンサイズを調整
globalStyle(`.${docTitleWithIcon} .doc-icon-container [data-icon-type="emoji"], .${docTitleWithIcon} .doc-icon-container [data-icon-type="affine-icon"]`, {
  width: 50,
  height: 50,
  fontSize: 46,
});

// アイコン付きタイトル: doc-title要素を伸縮させる
globalStyle(`.${docTitleWithIcon} doc-title`, {
  flex: 1,
  minWidth: 0,
});

// アイコン付きタイトル: タイトルのパディング・マージンを除去して左詰め
globalStyle(`.${docTitleWithIcon} .doc-title-container`, {
  padding: 0,
  width: '100%',
  maxWidth: 'none',
  marginLeft: 0,
  marginRight: 0,
});

export const docPropertiesTableContainer = style({
  display: 'flex',
  width: '100%',
  justifyContent: 'center',
});

export const docPropertiesTable = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: '100%',
  maxWidth: cssVar('editorWidth'),
  padding: `0 ${cssVar('editorSidePadding', '24px')}`,
  '@container': {
    [`viewport (width <= 640px)`]: {
      padding: '0 16px',
    },
  },
});
