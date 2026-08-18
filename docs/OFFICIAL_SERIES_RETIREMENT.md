# 機関公表資料を照合用へ変更した記録

変更日: 2026-08-18

## 運用上の位置づけ

- GビズINFOと行政事業レビューを週次自動更新する主系列とする。
- 機関公表資料はGビズINFO掲載値を確認するための照合資料とし、外部取得とURL探索は手動実行に限定する。
- 既存の `data/official/`、取得証跡、parserは削除しない。
- 沖縄総合事務局は収録・照合の対象外とする。既存取得データは履歴として保持する。

## 削除・停止した指標と検証

- `data/official-source-registry.json` の `collectionStatus`
- `fullyReconciledCells`、`registeredEndpoints`、`partial_detail`
- 機関公表資料の公開用全件ファイル生成と、releaseへの行数・ID集合・manifest SHA記録
- `update-status.json` の機関公表資料更新結果と鮮度状態
- 公開後検証における機関公表資料の更新成否・行数・ID集合・manifest SHA検査
- 公開workflow内の機関公表資料取得、取得停止検知、失敗時の前回データ復元、更新commit
- 旧「機関公表資料の明細検索」UIコンポーネント
- 通常CIから、照合対象外資料だけを対象とする次の検証を除外
  - 全機関の履歴資料・WARP保存資料を前提としたgolden/receipt検証
  - 特許庁、近畿・九州局、本省・資源エネルギー庁、沖縄、その他地域局、中小企業庁の履歴資料検証
  - 全機関公表資料を公開検索用データとして検証する試験

## 残した検証

- 中部経済産業局・令和4年度上期の掲載順先頭50行の照合データ検証
- 上記資料のhuman-reviewed golden値
- 50件すべての原典行ID、GビズINFO行ID、掲載額、判定内訳44/4/2/0の整合性
- 機関公表資料parserの共通PDF試験
- 手動取得時のfetch/retry安全試験
- 手動URL探索workflowのdispatch-only検証

## 公開成果物

機関公表資料の全件JSONはGitHub Pages成果物へコピーしない。照合ページに必要な50件は
`data/official-reconciliation.json` からアプリに組み込み、各件に原典URLとGビズINFO掲載行へのリンクを付ける。
