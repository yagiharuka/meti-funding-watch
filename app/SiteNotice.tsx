const CORRECTIONS_URL = "https://yagiharuka.github.io/meti-funding-watch/corrections/";

export default function SiteNotice() {
  return (
    <aside className="site-notice" role="note" aria-label="非公式サイトについて">
      <strong>非公式サイト</strong>
      <span>経済産業省・GビズINFOその他の公表元が運営するサイトではありません。掲載値は原資料で確認してください。</span>
      <a href={CORRECTIONS_URL}>訂正・確認の方針</a>
    </aside>
  );
}
