import type { Framework } from '@toeverything/infra';

import { configureBrowserVirtualKeyboardProvider } from './impls/browser';
import { VirtualKeyboardProvider } from './providers/virtual-keyboard';
import { VirtualKeyboardService } from './services/virtual-keyboard';

export { configureBrowserVirtualKeyboardProvider };
export { VirtualKeyboardProvider, VirtualKeyboardService };

export function configureMobileVirtualKeyboardModule(framework: Framework) {
  framework.service(VirtualKeyboardService, [VirtualKeyboardProvider]);
}
