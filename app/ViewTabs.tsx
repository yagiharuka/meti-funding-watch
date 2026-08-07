type ViewTabsProps = {
  active: "gbiz" | "adoptions";
};

export default function ViewTabs({ active }: ViewTabsProps) {
  const onAdoptions = active === "adoptions";

  return (
    <nav className="view-tabs" aria-label="表示する情報">
      <a
        className={active === "gbiz" ? "active" : undefined}
        href={onAdoptions ? "../" : "#top"}
        aria-current={active === "gbiz" ? "page" : undefined}
      >
        <strong>調達・委託・補助金</strong>
        <span>GビズINFO</span>
      </a>
      <a
        className={onAdoptions ? "active" : undefined}
        href={onAdoptions ? "#top" : "adoptions/"}
        aria-current={onAdoptions ? "page" : undefined}
      >
        <strong>補助金採択者情報</strong>
        <span>中小企業庁</span>
      </a>
    </nav>
  );
}
