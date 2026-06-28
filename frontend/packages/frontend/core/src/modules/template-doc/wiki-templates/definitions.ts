import { Text } from '@blocksuite/affine/store';
import type { Store } from '@blocksuite/affine/store';

export interface WikiTemplate {
  title: { ja: string; en: string };
  build: (doc: Store, noteId: string, lang: 'ja' | 'en') => void;
}

// Helper: add heading + empty paragraph
function h2(doc: Store, noteId: string, text: string) {
  doc.addBlock('affine:paragraph', { type: 'h2', text: new Text(text) }, noteId);
}

function divider(doc: Store, noteId: string) {
  doc.addBlock('affine:divider', {}, noteId);
}

function empty(doc: Store, noteId: string) {
  doc.addBlock('affine:paragraph', { text: new Text('') }, noteId);
}

function bullet(doc: Store, noteId: string, text = '') {
  doc.addBlock('affine:list', { type: 'bulleted', text: new Text(text) }, noteId);
}

function numbered(doc: Store, noteId: string, text = '') {
  doc.addBlock('affine:list', { type: 'numbered', text: new Text(text) }, noteId);
}

function todo(doc: Store, noteId: string, text = '') {
  doc.addBlock('affine:list', { type: 'todo', text: new Text(text) }, noteId);
}

function quote(doc: Store, noteId: string, text = '') {
  doc.addBlock('affine:paragraph', { type: 'quote', text: new Text(text) }, noteId);
}

// --- Template definitions ---

const meetingNotes: WikiTemplate = {
  title: { ja: '議事録', en: 'Meeting Notes' },
  build: (doc, noteId, lang) => {
    if (lang === 'ja') {
      h2(doc, noteId, '日時');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '参加者');
      bullet(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '議題');
      numbered(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '議論内容');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'アクションアイテム');
      todo(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '次回予定');
      empty(doc, noteId);
    } else {
      h2(doc, noteId, 'Date & Time');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Attendees');
      bullet(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Agenda');
      numbered(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Discussion');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Action Items');
      todo(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Next Meeting');
      empty(doc, noteId);
    }
  },
};

const knowledgeBase: WikiTemplate = {
  title: { ja: 'ナレッジベース記事', en: 'Knowledge Base Article' },
  build: (doc, noteId, lang) => {
    if (lang === 'ja') {
      h2(doc, noteId, '概要');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '詳細');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '関連ドキュメント');
      bullet(doc, noteId);
    } else {
      h2(doc, noteId, 'Overview');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Details');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Related Documents');
      bullet(doc, noteId);
    }
  },
};

const procedure: WikiTemplate = {
  title: { ja: '手順書/マニュアル', en: 'Procedure / Manual' },
  build: (doc, noteId, lang) => {
    if (lang === 'ja') {
      h2(doc, noteId, '目的');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '前提条件');
      bullet(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '手順');
      numbered(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '注意事項');
      quote(doc, noteId);
    } else {
      h2(doc, noteId, 'Purpose');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Prerequisites');
      bullet(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Steps');
      numbered(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Notes');
      quote(doc, noteId);
    }
  },
};

const weeklyReport: WikiTemplate = {
  title: { ja: '週報/日報', en: 'Weekly / Daily Report' },
  build: (doc, noteId, lang) => {
    if (lang === 'ja') {
      h2(doc, noteId, '期間');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '完了タスク');
      todo(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '進行中');
      todo(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '課題・ブロッカー');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '次の計画');
      bullet(doc, noteId);
    } else {
      h2(doc, noteId, 'Period');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Completed Tasks');
      todo(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'In Progress');
      todo(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Issues / Blockers');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Next Plans');
      bullet(doc, noteId);
    }
  },
};

const projectOverview: WikiTemplate = {
  title: { ja: 'プロジェクト概要', en: 'Project Overview' },
  build: (doc, noteId, lang) => {
    if (lang === 'ja') {
      h2(doc, noteId, '背景');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, '目的');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'スコープ');
      bullet(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'スケジュール');
      bullet(doc, noteId, 'マイルストーン: 期日 / 状態');
      divider(doc, noteId);
      h2(doc, noteId, 'チーム');
      bullet(doc, noteId, '名前: 役割');
      divider(doc, noteId);
      h2(doc, noteId, 'リスク');
      bullet(doc, noteId);
    } else {
      h2(doc, noteId, 'Background');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Objective');
      empty(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Scope');
      bullet(doc, noteId);
      divider(doc, noteId);
      h2(doc, noteId, 'Schedule');
      bullet(doc, noteId, 'Milestone: Due Date / Status');
      divider(doc, noteId);
      h2(doc, noteId, 'Team');
      bullet(doc, noteId, 'Name: Role');
      divider(doc, noteId);
      h2(doc, noteId, 'Risks');
      bullet(doc, noteId);
    }
  },
};

const faq: WikiTemplate = {
  title: { ja: 'FAQ', en: 'FAQ' },
  build: (doc, noteId, lang) => {
    if (lang === 'ja') {
      for (let i = 0; i < 3; i++) {
        if (i > 0) divider(doc, noteId);
        h2(doc, noteId, 'Q: (質問を入力)');
        doc.addBlock(
          'affine:paragraph',
          { text: new Text('A: (回答を入力)') },
          noteId
        );
      }
    } else {
      for (let i = 0; i < 3; i++) {
        if (i > 0) divider(doc, noteId);
        h2(doc, noteId, 'Q: (Enter your question)');
        doc.addBlock(
          'affine:paragraph',
          { text: new Text('A: (Enter your answer)') },
          noteId
        );
      }
    }
  },
};

export const wikiTemplates: WikiTemplate[] = [
  meetingNotes,
  knowledgeBase,
  procedure,
  weeklyReport,
  projectOverview,
  faq,
];
