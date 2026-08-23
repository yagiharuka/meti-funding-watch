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
    <nav className="search-page-nav" aria-label="検索ページ">
      <span className="search-page-nav-label">検索方法</span>
      <div className="search-page-nav-links">
        <a className={active === "gbiz" ? "active" : undefined} href={href("gbiz")} aria-current={active === "gbiz" ? "page" : undefined}>
          <span>企業名・事業名で</span><strong>かんたん検索</strong>
        </a>
        <a className={active === "review" ? "active" : undefined} href={href("review")} aria-current={active === "review" ? "page" : undefined}>
          <span>支出先・資金経路で</span><strong>行政事業レビュー詳細</strong>
        </a>
      </div>
    </nav>
  );
}
