# 業務語彙（Gyomu Vocabulary）

日本の会社の業務を、機械で読める形で書くための語彙と、標準の業務のデータです。

業務を、部署・ワークフロー・段階・工程の4つの層で書きます。工程ごとに、次のことを持ちます。

- 担い手（誰が行うか）
- 受け取る物と、渡す物（帳票、データ、文書、連絡）
- 判断があるか
- 取り消せない操作を含むか
- 人が行う必要があるか
- 関係する制度（根拠の法令と、役所の説明のページ）

AIに業務を渡す前の、共通の言葉として使えます。

- 見る：https://furuchanchan.github.io/gyomu-vocab/
- URI：https://w3id.org/gyomu/ （語彙は `https://w3id.org/gyomu/ns#`、データは `https://w3id.org/gyomu/id/...`）
- 中身（2026-09-30 の版）：部署 10、ワークフロー 55、工程 492、担い手 55、物 544、制度 68（法令 43、条 181、役所のページ 35）

| 部署 | ワークフロー |
| --- | --- |
| 経理・財務 | 取引先への支払、請求と入金の確認、経費の精算、月次決算、年次決算と税の申告 |
| 人事・労務 | 採用、入社の手続き、勤怠の集計と給与計算、年末調整、算定基礎届と年度更新、退職の手続き、36協定と就業規則 |
| 営業 | 見込み客の獲得から商談まで、提案と見積、稟議と契約、受注から請求の依頼まで、既存の顧客のフォロー |
| マーケティング | 施策の企画と予算、コンテンツとWebサイトの制作・公開、見込み客の獲得と営業への引き渡し、メールでの配信、展示会やセミナーの運営 |
| カスタマーサポート | 問い合わせの対応、苦情・クレームの対応、よくある質問と手順書の整備、要望と不具合の製品側への引き渡し、契約とアカウントの変更の受け付け |
| 総務・法務 | 定時株主総会の運営、取締役会の運営、登記の変更、契約書の審査と管理、備品・オフィス・固定資産の管理、社内規程の整備、文書の保存と廃棄 |
| 情報システム | アカウントの発行と削除、端末の調達・貸与・回収、権限とセキュリティの運用、障害とセキュリティ事故の対応、システムの導入と変更、バックアップと復旧 |
| 購買・調達 | 購入の申請から発注まで、取引先の登録と評価、業務の委託（外注）の管理、物品の受け入れと検収、定期の契約の見直し |
| 製造 | 生産計画、製造の指示と実行、検査と不良の処理、設備の点検と保全、作業の安全と教育 |
| 物流 | 出荷、入荷と保管、在庫の管理と棚卸、返品の受け入れ、運送の手配と運送会社の管理 |

## 中身

| 場所 | 中身 |
| --- | --- |
| `vocab/gyomu.ttl` | 語彙の定義（クラスと性質） |
| `vocab/shapes.ttl` | データが満たす決まり（SHACL） |
| `vocab/context.jsonld` | JSON-LD の文脈 |
| `data/departments/` | 部署ごとの、ワークフロー・段階・工程 |
| `data/roles/` `data/artifacts/` `data/regulations/` `data/tool-kinds/` | 担い手、物、制度、道具の種類 |
| `data/external/` | つなげている外の分類（統計LOD の職業分類と産業分類、APQC PCF の要素） |
| `verification/latest.json` | 制度の根拠を、一次情報に照らして確かめた記録 |

## 使い方

```bash
npm install
```

```bash
npm run build
```

`dist/` に、Turtle・N-Triples・JSON-LD と、URIごとのページが出ます。

```bash
npm test
```

## 検査

データは、公開の前に次の検査を通します。

1. つじつまの検査（`scripts/load.mjs`）。受け取る物は、社外から届くか、どこかの工程が作っていること。判断がある工程には、判断の中身が書かれていること。使われていない定義が無いこと。
2. SHACL の検査（`vocab/shapes.ttl`）。
3. 出した Turtle・N-Triples・JSON-LD を読み直し、同じ中身であること。
4. 制度の根拠の照合（`scripts/verify-sources.mjs`）。法令の条は e-Gov 法令API から取り出し、法令の名前と、期限などの語が本文にあることを確かめます。役所のページも、同じように確かめます。

```bash
node scripts/verify-sources.mjs
```

## AIとの分担の目安

工程ごとの「AIとの分担の目安」は、書き手が決めるのではなく、3つの事実から決まった規則で導きます。

| 人が行う必要がある | 判断がある、または取り消せない操作を含む | 目安 |
| --- | --- | --- |
| はい | （どちらでも） | 人が行う |
| いいえ | はい | AIが下書きし、人が確かめる |
| いいえ | いいえ | AIに任せられる |

目安であり、個別の会社での分担を決めるものではありません。

## 制度についての注意

制度の中身は、`verifiedOn` の日に、法令の本文と役所のページに照らして確かめたものです。法令は改正されます。実務の判断には、必ず最新の法令と役所の案内を確かめ、必要に応じて専門家に相談してください。このデータは、法律や税務の助言ではありません。

## ライセンスと出典

- データと語彙：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- プログラム（`scripts/`、`test/`）：MIT License
- 職業分類と産業分類の項目は、政府統計の総合窓口(e-Stat)の統計LOD（https://data.e-stat.go.jp/lodw/ 、CC BY 4.0）のURIを参照しています。
- 法令は、e-Gov 法令検索（https://laws.e-gov.go.jp/）を参照しています。
- 業務の分類の一部は、APQC Process Classification Framework の要素を参照しています。

> APQC's Process Classification Framework® (PCF) is an open standard developed by APQC, a nonprofit that promotes benchmarking and best practices worldwide. The PCF is intended to facilitate organizational improvement through process management and benchmarking, regardless of industry, size, or geography. To download the full PCF or industry-specific versions of the PCF, as well as associated measures and benchmarking, please visit www.apqc.org/pcf.

## 直し方と足し方

`data/` の YAML を直して、`node scripts/check.mjs` → `node scripts/verify-sources.mjs <ファイル名>` → `npm run build` → `npm test` の順に通してください。誤りの指摘や追加の提案は、GitHub の Issue か Pull Request でお願いします。制度を足すときは、条と役所のページの照合が通ることが条件です。

## 作った人

古野光太朗（株式会社TechWorker）
