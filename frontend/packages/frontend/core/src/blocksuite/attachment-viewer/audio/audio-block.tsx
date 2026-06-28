import { AudioPlayer } from '@ofuro/component/ui/audio-player';
import { useSeekTime } from '@ofuro/core/components/hooks/use-seek-time';
import type { AudioAttachmentBlock } from '@ofuro/core/modules/media/entities/audio-attachment-block';
import { AudioAttachmentService } from '@ofuro/core/modules/media/services/audio-attachment';
import type { AttachmentBlockModel } from '@blocksuite/affine/model';
import { ResetIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import bytes from 'bytes';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AttachmentViewerProps } from '../types';
import * as styles from './audio-block.css';
import { TranscriptionBlock } from './transcription-block';

const AttachmentAudioPlayer = ({ block }: { block: AudioAttachmentBlock }) => {
  const audioMedia = block.audioMedia;
  const playbackState = useLiveData(audioMedia.playbackState$);
  const stats = useLiveData(audioMedia.stats$);
  const expanded = useLiveData(block.expanded$);
  const loading = useLiveData(audioMedia.loading$);
  const loadingError = useLiveData(audioMedia.loadError$);
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);
  const seekTime = useSeekTime(playbackState, stats.duration);

  const handlePlay = useCallback(() => {
    audioMedia?.play();
  }, [audioMedia]);

  const handlePause = useCallback(() => {
    audioMedia?.pause();
  }, [audioMedia]);

  const handleStop = useCallback(() => {
    audioMedia?.stop();
  }, [audioMedia]);

  const handleSeek = useCallback(
    (time: number) => {
      audioMedia?.seekTo(time);
    },
    [audioMedia]
  );

  const handlePlaybackRateChange = useCallback(
    (rate: number) => {
      audioMedia?.setPlaybackRate(rate);
    },
    [audioMedia]
  );

  const reload = useCallback(() => {
    audioMedia?.revalidateBuffer();
  }, [audioMedia]);

  const descriptionEntry = useMemo(() => {
    if (loadingError) {
      return (
        <>
          <div className={styles.error}>{loadingError.message}</div>
          <button className={styles.reloadButton} onClick={reload}>
            <ResetIcon className={styles.reloadButtonIcon} />
            Reload
          </button>
        </>
      );
    }

    return <>{bytes(block.props.props.size)}</>;
  }, [loadingError, reload, block.props.props.size]);

  return (
    <AudioPlayer
      name={block.props.props.name}
      description={descriptionEntry}
      loading={stats.duration === 0}
      playbackState={playbackState?.state || 'idle'}
      waveform={stats.waveform}
      seekTime={seekTime}
      duration={stats.duration}
      onClick={handleClick}
      onPlay={handlePlay}
      onPause={handlePause}
      onStop={handleStop}
      onSeek={handleSeek}
      playbackRate={playbackState?.playbackRate || 1.0}
      onPlaybackRateChange={handlePlaybackRateChange}
    />
  );
};

const useAttachmentMediaBlock = (model: AttachmentBlockModel) => {
  const audioAttachmentService = useService(AudioAttachmentService);
  const [audioAttachmentBlock, setAttachmentMedia] = useState<
    AudioAttachmentBlock | undefined
  >(undefined);

  useEffect(() => {
    if (!model.props.sourceId) {
      return;
    }
    const entity = audioAttachmentService.get(model);
    if (!entity) {
      return;
    }
    const audioAttachmentBlock = entity.obj;
    setAttachmentMedia(audioAttachmentBlock);
    audioAttachmentBlock.mount();
    return () => {
      audioAttachmentBlock.unmount();
      entity.release();
    };
  }, [audioAttachmentService, model]);
  return audioAttachmentBlock;
};

export const AudioBlockEmbedded = ({ model }: AttachmentViewerProps) => {
  const audioAttachmentBlock = useAttachmentMediaBlock(model);
  const transcriptionBlock = useLiveData(
    audioAttachmentBlock?.transcriptionBlock$
  );
  const expanded = useLiveData(audioAttachmentBlock?.expanded$);
  return (
    <div className={styles.root}>
      {audioAttachmentBlock && (
        <AttachmentAudioPlayer block={audioAttachmentBlock} />
      )}
      {transcriptionBlock && expanded && (
        <TranscriptionBlock block={transcriptionBlock} />
      )}
    </div>
  );
};
