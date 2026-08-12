type ViewTabsProps = {
  active: "gbiz" | "adoptions" | "official";
};

export default function ViewTabs({ active }: ViewTabsProps) {
  const gbizHref = active === "gbiz" ? "#top" : "../";
  const officialHref = active === "official"
    ? "#top"
    : active === "gbiz" ? "official/" : "../official/";

  return (
    <nav className="view-tabs" aria-label="表示する情報">
      <a
        className={active === "gbiz" ? "active" : undefined}
        href={gbizHref}
        aria-current={active === "gbiz" ? "page" : undefined}
      >
        <strong>調達（委託を含む）・補助金</strong>
        <span>GビズINFO</span>
      </a>
      <a
        className={active === "official" ? "active" : undefined}
        href={officialHref}
        aria-current={active === "official" ? "page" : undefined}
      >
        <strong>契約結果・交付決定</strong>
        <span>経産省・各機関の公式資料</span>
      </a>
    </nav>
  );
}
