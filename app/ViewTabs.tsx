type ViewTabsProps = {
  active: "gbiz" | "adoptions";
};

export default function ViewTabs({ active }: ViewTabsProps) {
  return (
    <nav className="view-tabs" aria-label="表示する情報">
      <a
        className={active === "gbiz" ? "active" : undefined}
        href={active === "adoptions" ? "../" : "#top"}
        aria-current={active === "gbiz" ? "page" : undefined}
      >
        <strong>調達（委託を含む）・補助金</strong>
        <span>GビズINFO</span>
      </a>
    </nav>
  );
}
