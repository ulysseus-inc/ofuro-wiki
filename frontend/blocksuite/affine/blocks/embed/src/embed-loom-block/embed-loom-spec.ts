import { EmbedLoomBlockSchema } from '@blocksuite/affine-model';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';

import { createBuiltinToolbarConfigExtension } from '../configs/toolbar';
import { EmbedLoomBlockInteraction } from './embed-edgeless-loom-bock';
import { EmbedLoomBlockComponent } from './embed-loom-block';
import {
  EmbedLoomBlockOptionConfig,
  EmbedLoomBlockService,
} from './embed-loom-service';

const flavour = EmbedLoomBlockSchema.model.flavour;

export const EmbedLoomViewExtensions: ExtensionType[] = [
  FlavourExtension(flavour),
  EmbedLoomBlockService,
  BlockViewExtension(flavour, model => {
    return model.parent?.flavour === 'affine:surface'
      ? literal`affine-embed-edgeless-loom-block`
      : literal`affine-embed-loom-block`;
  }),
  EmbedLoomBlockOptionConfig,
  createBuiltinToolbarConfigExtension(flavour, EmbedLoomBlockComponent),
  // Loom は日本の社内利用ではニッチなため「/」スラッシュメニューから除外する。
  // ブロック定義・既存埋め込みの描画は維持（互換のため flavour は残す）。
  EmbedLoomBlockInteraction,
].flat();
