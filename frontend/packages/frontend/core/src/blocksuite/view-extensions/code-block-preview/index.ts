import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine/ext-loader';
import { FrameworkProvider } from '@toeverything/infra';
import { z } from 'zod';

import {
  CodeBlockMermaidPreview,
  effects as mermaidPreviewEffects,
} from './mermaid-preview';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

export class CodeBlockPreviewViewExtension extends ViewExtensionProvider {
  override name = 'code-block-preview';

  override schema = optionsSchema;

  override effect() {
    super.effect();

    mermaidPreviewEffects();
  }

  override setup(
    context: ViewExtensionContext,
    options?: z.infer<typeof optionsSchema>
  ) {
    super.setup(context, options);
    context.register(CodeBlockMermaidPreview);
  }
}
