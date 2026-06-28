const lastUpdated = '2025-02-11';

export const Component = () => {
  return (
    <div
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '40px 24px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#333',
        lineHeight: 1.7,
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <img
          src="/favicon-96.png"
          alt="ofuro-wiki"
          width={48}
          height={48}
          style={{ borderRadius: 10, marginBottom: 12 }}
        />
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>
          ofuro-wiki 利用規約
        </h1>
        <p style={{ color: '#888', fontSize: 14 }}>
          最終更新日: {lastUpdated}
        </p>
      </div>

      <Section title="1. はじめに">
        <p>
          本利用規約（以下「本規約」）は、ofuro-wiki（以下「本サービス」）の利用条件を定めるものです。
          本サービスを利用することにより、利用者は本規約に同意したものとみなされます。
        </p>
      </Section>

      <Section title="2. サービスの概要">
        <p>
          本サービスは、組織内のナレッジ共有を目的としたWikiプラットフォームです。
          ドキュメントの作成、編集、共有、および全文検索機能を提供します。
        </p>
      </Section>

      <Section title="3. アカウントと利用資格">
        <p>
          本サービスの利用には、管理者によるアカウントの発行が必要です。
          利用者は、自身のアカウント情報（メールアドレス、パスワード等）を適切に管理し、
          第三者への開示・共有を行わないものとします。
        </p>
        <p>
          アカウントの不正利用が疑われる場合、管理者はアカウントを停止する権利を有します。
        </p>
      </Section>

      <Section title="4. コンテンツの取り扱い">
        <p>
          利用者が本サービスに投稿・作成したコンテンツ（文書、画像、その他の素材）の
          著作権は、原則として作成者に帰属します。
        </p>
        <p>
          ただし、利用者は本サービスの運用に必要な範囲において、
          コンテンツの保存、バックアップ、同期、表示に関するライセンスを本サービスに付与するものとします。
        </p>
      </Section>

      <Section title="5. 禁止事項">
        <p>利用者は、以下の行為を行ってはなりません。</p>
        <ul>
          <li>法令または公序良俗に反する内容の投稿</li>
          <li>他者の知的財産権、プライバシー、その他の権利を侵害する行為</li>
          <li>マルウェア、ウイルス等の有害なプログラムのアップロード</li>
          <li>
            本サービスのインフラストラクチャに過度な負荷をかける行為（自動化されたスクレイピング等）
          </li>
          <li>本サービスのセキュリティを損なう行為</li>
          <li>その他、管理者が不適切と判断する行為</li>
        </ul>
      </Section>

      <Section title="6. サービスの提供と変更">
        <p>
          本サービスは「現状のまま」提供されます。
          管理者は、事前の通知なく本サービスの内容を変更、または一時的に停止する場合があります。
        </p>
        <p>
          定期メンテナンスやシステムアップデートにより、
          一時的にサービスが利用できない場合がありますが、
          可能な限り事前に通知するよう努めます。
        </p>
      </Section>

      <Section title="7. データの保全">
        <p>
          管理者は、利用者のデータの保全に合理的な努力を行いますが、
          データの完全性、可用性について保証するものではありません。
        </p>
        <p>
          重要なデータについては、利用者自身でもバックアップを取ることを推奨します。
        </p>
      </Section>

      <Section title="8. 免責事項">
        <p>
          本サービスの利用により生じた損害について、
          管理者は故意または重大な過失がある場合を除き、一切の責任を負いません。
        </p>
        <p>
          本サービスは、特定の目的への適合性、商品性、正確性、信頼性について
          明示的または黙示的な保証を行いません。
        </p>
      </Section>

      <Section title="9. 規約の変更">
        <p>
          管理者は、必要に応じて本規約を変更することがあります。
          変更後の規約は、本ページに掲載された時点で効力を生じるものとします。
          重要な変更がある場合は、本サービス内で通知するよう努めます。
        </p>
      </Section>

      <Section title="10. お問い合わせ">
        <p>
          本規約に関するお問い合わせは、組織内の管理者までご連絡ください。
        </p>
      </Section>

      <div
        style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: '1px solid #eee',
          textAlign: 'center',
        }}
      >
        <a
          href="/"
          style={{
            color: '#C47A2A',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          ofuro-wiki に戻る
        </a>
      </div>
    </div>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section style={{ marginBottom: 28 }}>
    <h2
      style={{
        fontSize: 18,
        fontWeight: 600,
        marginBottom: 8,
        color: '#3C2415',
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);
