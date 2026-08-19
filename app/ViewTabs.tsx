type ViewTabsProps = {
  active: "gbiz" | "adoptions" | "official" | "review";
};

export default function ViewTabs({ active }: ViewTabsProps) {
  const href = (target: "gbiz" | "review") => {
    if (active === target) return "#top";
    if (target === "gbiz") return active === "gbiz" ? "#top" : "../";
    return active === "gbiz" ? "review/" : "../review/";
  };

  return (
    <nav className="view-tabs" aria-label="表示する情報">
      <a className={active === "gbiz" ? "active" : undefined} href={href("gbiz")} aria-current={active === "gbiz" ? "page" : undefined}>
        <strong>企業検索</strong><span>GビズINFO＋行政事業レビューを同時表示</span>
      </a>
      <a className={active === "review" ? "active" : undefined} href={href("review")} aria-current={active === "review" ? "page" : undefined}>
        <strong>行政事業レビュー詳細</strong><span>事業・予算執行・支出経路を詳しく見る</span>
      </a>
    </nav>
  );
}
