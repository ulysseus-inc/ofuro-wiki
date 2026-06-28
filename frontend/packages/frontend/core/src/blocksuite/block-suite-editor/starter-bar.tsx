import { MenuSeparator } from '@ofuro/component';
import { DocsService } from '@ofuro/core/modules/doc';
import { EditorService } from '@ofuro/core/modules/editor';
import { TemplateDocService } from '@ofuro/core/modules/template-doc';
import {
  TemplateListMenu,
  TemplateListMenuAdd,
} from '@ofuro/core/modules/template-doc/view/template-list-menu';
import { useI18n } from '@ofuro/i18n';
import track from '@ofuro/track';

import type { Store } from '@blocksuite/affine/store';
import {
  EdgelessIcon,
  TemplateColoredIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAsyncCallback } from '../../components/hooks/affine-async-hooks';
import * as styles from './starter-bar.css';

const Badge = forwardRef<
  HTMLLIElement,
  HTMLAttributes<HTMLLIElement> & {
    icon: React.ReactNode;
    text: string;
    active?: boolean;
  }
>(function Badge({ icon, text, className, active, ...attrs }, ref) {
  return (
    <li
      data-active={active}
      className={clsx(styles.badge, className)}
      ref={ref}
      {...attrs}
    >
      <span className={styles.badgeText}>{text}</span>
      <span className={styles.badgeIcon}>{icon}</span>
    </li>
  );
});

const StarterBarNotEmpty = ({ doc }: { doc: Store }) => {
  const t = useI18n();

  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);
  const editorService = useService(EditorService);

  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const isTemplate = useLiveData(
    useMemo(
      () => templateDocService.list.isTemplate$(doc.id),
      [doc.id, templateDocService.list]
    )
  );
  const handleSelectTemplate = useAsyncCallback(
    async (templateId: string) => {
      await docsService.duplicateFromTemplate(templateId, doc.id);
      track.doc.editor.starterBar.quickStart({ with: 'template' });
    },
    [doc.id, docsService]
  );

  const startWithEdgeless = useCallback(() => {
    const record = docsService.list.doc$(doc.id).value;
    record?.setPrimaryMode('edgeless');
    editorService.editor.setMode('edgeless');
  }, [doc.id, docsService.list, editorService.editor]);

  const onTemplateMenuOpenChange = useCallback((open: boolean) => {
    if (open) track.doc.editor.starterBar.openTemplateListMenu();
    setTemplateMenuOpen(open);
  }, []);

  const showTemplate = !isTemplate;

  if (!showTemplate) {
    return null;
  }

  return (
    <div className={styles.root} data-testid="starter-bar">
      {t['com.affine.page-starter-bar.start']()}
      <ul className={styles.badges}>
        {showTemplate ? (
          <TemplateListMenu
            onSelect={handleSelectTemplate}
            rootOptions={{
              open: templateMenuOpen,
              onOpenChange: onTemplateMenuOpenChange,
            }}
            suffixItems={
              <>
                <MenuSeparator />
                <TemplateListMenuAdd />
              </>
            }
          >
            <Badge
              data-testid="template-docs-badge"
              icon={<TemplateColoredIcon />}
              text={t['com.affine.page-starter-bar.template']()}
              active={templateMenuOpen}
            />
          </TemplateListMenu>
        ) : null}

        <Badge
          icon={<EdgelessIcon />}
          text={t['com.affine.page-starter-bar.edgeless']()}
          onClick={startWithEdgeless}
        />
      </ul>
    </div>
  );
};

export const StarterBar = ({ doc }: { doc: Store }) => {
  const [isEmpty, setIsEmpty] = useState(doc.isEmpty);
  const templateDocService = useService(TemplateDocService);

  const isTemplate = useLiveData(
    useMemo(
      () => templateDocService.list.isTemplate$(doc.id),
      [doc.id, templateDocService.list]
    )
  );

  useEffect(() => {
    return doc.isEmpty$.subscribe(value => {
      setIsEmpty(value);
    });
  }, [doc]);

  if (!isEmpty || isTemplate) return null;

  return <StarterBarNotEmpty doc={doc} />;
};
