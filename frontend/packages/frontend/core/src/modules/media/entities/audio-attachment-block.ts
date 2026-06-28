import type { AttachmentBlockModel } from '@blocksuite/affine/model';
import type { BlockModel } from '@blocksuite/affine/store';
import { computed } from '@preact/signals-core';
import { Entity, LiveData } from '@toeverything/infra';

import type { WorkspaceService } from '../../workspace';
import type { AudioMediaManagerService } from '../services/audio-media-manager';
import type { MeetingSettingsService } from '../services/meeting-settings';
import type { AudioMedia } from './audio-media';

export class AudioAttachmentBlock extends Entity<AttachmentBlockModel> {
  private readonly refCount$ = new LiveData<number>(0);
  readonly audioMedia: AudioMedia;
  constructor(
    readonly audioMediaManagerService: AudioMediaManagerService,
    readonly workspaceService: WorkspaceService,
    readonly meetingSettingsService: MeetingSettingsService
  ) {
    super();
    const mediaRef = audioMediaManagerService.ensureMediaEntity(this.props);
    this.audioMedia = mediaRef.media;
    this.disposables.push(() => mediaRef.release());
  }

  // rendering means the attachment is visible in the editor
  // it is used to determine if we should show show the audio player on the sidebar
  rendering$ = this.refCount$.map(refCount => refCount > 0);
  expanded$ = new LiveData<boolean>(true);

  readonly transcriptionBlock$ = LiveData.fromSignal(
    computed(() => {
      for (const key of [...this.props.childMap.value.keys()].reverse()) {
        const block = this.props.store.getBlock$(key);
        if (block?.flavour === 'affine:transcription') {
          return block.model as unknown as BlockModel;
        }
      }
      return null;
    })
  );

  hasTranscription$ = LiveData.computed(get => {
    const transcriptionBlock = get(this.transcriptionBlock$);
    if (!transcriptionBlock) {
      return null;
    }
    const childMap = get(LiveData.fromSignal(transcriptionBlock.childMap));
    return childMap.size > 0;
  });

  mount() {
    this.refCount$.setValue(this.refCount$.value + 1);
  }

  unmount() {
    this.refCount$.setValue(this.refCount$.value - 1);
  }
}
