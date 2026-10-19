# Poker 100 Survival — カード演出プロトタイプ

スマートフォン縦画面向けのテキサスホールデム × 100人サバイバルの演出プロトタイプ。

```bash
npm install
npm run dev        # http://localhost:5173 (?seed=123 で乱数シード固定)
npm run typecheck
npm test
npm run build
npm run build:single  # 1ファイルの HTML（スマホ配布用）→ dist-single/
```

## ルール（HP＝チップ）

- 毎ラウンド両者が参加費（アンティ）を払う。4ラウンドごとに +2
- ベットは2回：手札が配られた後と、フロップの後
  - 自分の番：チェック / ベット½ / ポット / オールイン
  - 相手がベットしてきたら：フォールド / コール
- 勝者はポットの HP を奪う。ショーダウンで勝つと役に応じた追加ダメージ（`logic/combat.ts` の `HAND_BONUS`）
- HP 0 で脱落。相手を倒すと次の挑戦者が現れる。最後の 1 人になれば勝利
- 相手 AI は自分の手札と見えている場札だけで判断（`logic/ai.ts`）。シード乱数でブラフもする

## 設計

**ゲーム結果は先に確定し、演出はそれを表示するだけ。**

| 層 | 場所 | 役割 |
| --- | --- | --- |
| ロジック | `src/logic/` | 純粋関数のみ。DOM / GSAP 非依存 |
| 操作 | `src/game/controller.ts` | 「配る」「ベット」などの操作ごとに純粋関数（`startHand` / `playerAct`）で状態を確定。演出中なら先にスキップ |
| 演出 | `src/presentation/director.ts` | ロジックが出したイベント列を GSAP で再生。`view.ts` の純粋なリデューサーで「この時点の盤面」を求め、開始時・スキップ時・終了時はそこへスナップする |
| 表示 | `src/ui/` | レイアウトのみ。動きは `data-*` 属性経由で Director が付与 |
| 効果音 | `src/audio/` | ID ベースの `SoundBus`。`soundMap.ts` にファイルを登録すれば鳴る |

ロジック関数:

- `logic/deck.ts` — 52枚デッキ生成・Fisher–Yates シャッフル・重複検査
- `logic/dealer.ts` — 配布（手札 2×2、バーン、共通カード 5）
- `logic/handEvaluator.ts` — 7枚から最強の5枚を判定（ホイール含む）・比較
- `logic/combat.ts` — ダメージ計算と演出ティア
- `logic/hp.ts` — HP 更新・脱落判定
- `logic/game.ts` — ハンドの進行（同じシード＋同じ操作 → 同じ結果）
- `logic/ai.ts` — 相手の判断（モンテカルロ勝率＋ポットオッズ）

## 演出

- 配布は 1 枚ずつ時差、`power3.out` で山札から飛ぶ
- 反転は Y 軸 0→90° でフェイスを切り替え → 90→180°（`backface-visibility` と併用し表裏が同時に見えない）
- フロップ → ターン → リバー → ショーダウンの順
- 役のティア 0〜4 で粒子数・画面揺れ・フラッシュ・バナー装飾が段階的に強くなる
- 攻撃エフェクト → 被弾揺れ → ダメージ数値 → HP の数値とバーを同じ値から描画 → 脱落スタンプ
- `prefers-reduced-motion` 時は移動・揺れ・粒子なし、短いフェードのみ
- 再生速度 ×1/×2、スキップ、リプレイ

## 効果音の追加

`public/sfx/` に音声を置き、`src/audio/soundMap.ts` に `deal: '/sfx/deal.mp3'` のように追記する。
ID: `deal, flip, check, chips, fold, reveal, handMinor, handMajor, handLegendary, attack, hit, ko, win, lose`
