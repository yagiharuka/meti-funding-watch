export default function DataReadingGuide() {
  return (
    <details className="data-reading-guide" id="data-reading-guide">
      <summary>このデータの読み方</summary>
      <div className="data-reading-guide-body">
        <p>
          <strong>GビズINFOの補助金：</strong>
          同一補助金の交付決定・確定等が別行で掲載される場合があるため、掲載額は行をまたいで合計しません。
          掲載先が執行団体・事務局等の場合は下流へ支出する原資を含むことがあり、掲載法人自身の収益・最終受益額を示すものではありません。
        </p>
        <p>
          <strong>行政事業レビュー：</strong>
          同じ支出が別レビューシート年度に再掲される場合があるため、掲載行・レビュー年度をまたぐ金額合計は表示しません。
        </p>
        <p>
          <strong>系列間の金額：</strong>
          GビズINFO、行政事業レビュー、公式資料では、交付決定額・契約額・レビュー掲載の支出先額など金額の意味や公表時点が異なるため、相互に合算しません。
        </p>
        <p>
          <strong>資金経路：</strong>
          行政事業レビューに明示された経路だけを表示します。経路が表示されないことは、実際に資金経路が存在しないことを意味しません。
        </p>
      </div>
    </details>
  );
}
