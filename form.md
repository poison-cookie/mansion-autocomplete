# 管理会社サイト共通検索パネル 実装仕様書

## 目的

管理会社サイトごとに異なる検索欄・検索ボタン・検索URLの違いを吸収し、対象サイト内のどのページからでも物件名検索を実行できる Tampermonkey 用ユーザースクリプトを作成する。

主な目的は以下。

* 検索ページまで戻る手間を減らす
* スクロールして検索欄まで戻る手間を減らす
* どのページからでも物件名検索できるようにする
* 管理会社サイトごとの違いを設定で吸収する

## 実装形式

* Tampermonkey / Violentmonkey 用ユーザースクリプト
* JavaScriptのみ
* 外部ライブラリは使用しない
* 全サイト共通スクリプトとして作成
* 実際に動作させるサイトはサイト設定で制御する

## 基本仕様

対象サイトを開いたとき、画面左下に検索パネルを固定表示する。

検索パネルには以下を表示する。

* キーワード入力欄
* 検索ボタン
* 閉じる / 最小化ボタン
* 現在の対象サイト名

検索実行時は、対象サイトの設定に従って検索を行う。

## 検索方式

検索方式は以下の2パターンに対応する。

### 方式1：検索URLへ直接遷移

検索結果URLにキーワードを渡せるサイトでは、URLを組み立てて直接遷移する。

例：

```js
location.href = `https://example.com/search?keyword=${encodeURIComponent(keyword)}`;
```

この方式では、サイト内のどのページにいても検索可能。

### 方式2：検索ページへ移動してから検索実行

検索URLにキーワードを渡せないサイトでは、一度検索ページへ遷移し、検索ページ側で元の検索欄に値をセットして検索ボタンをクリックする。

流れ：

```text
検索パネルでキーワード入力
↓
キーワードを一時保存
↓
検索ページへ遷移
↓
検索ページ側で保存キーワードを取得
↓
元の検索inputへ値をセット
↓
input / change イベントを発火
↓
元の検索ボタンを click()
```

## サイト別設定

サイトごとの差異は `siteConfigs` で吸収する。

設定例：

```js
const siteConfigs = [
  {
    name: '管理会社A',
    host: 'example-a.com',
    mode: 'url',
    searchUrlBuilder(keyword) {
      return `https://example-a.com/search?keyword=${encodeURIComponent(keyword)}`;
    },
  },
  {
    name: '管理会社B',
    host: 'example-b.com',
    mode: 'form',
    searchPageUrl: 'https://example-b.com/properties',
    keywordSelector: 'input[placeholder*="物件名"]',
    buttonSelector: 'button[type="submit"]',
    buttonText: '検索',
  },
];
```

## 設定項目

### name

管理会社名またはサイト名。

```js
name: '管理会社A'
```

### host

対象ドメイン。

```js
host: 'example.com'
```

サブドメイン対応が必要な場合は `location.hostname.endsWith(config.host)` で判定する。

### mode

検索方式。

```js
mode: 'url'
```

または

```js
mode: 'form'
```

### searchUrlBuilder

`mode: 'url'` の場合に使用する。
キーワードを受け取り、検索結果URLを返す。

```js
searchUrlBuilder(keyword) {
  return `/search?keyword=${encodeURIComponent(keyword)}`;
}
```

### searchPageUrl

`mode: 'form'` の場合に使用する。
検索フォームが存在するページURL。

```js
searchPageUrl: 'https://example.com/search'
```

### keywordSelector

検索ページ上の検索inputを取得するCSSセレクタ。

```js
keywordSelector: 'input[name="keyword"]'
```

### buttonSelector

検索ボタンを取得するCSSセレクタ。

```js
buttonSelector: 'button[type="submit"]'
```

### buttonText

`buttonSelector` で見つからない場合、ボタン文言で検索ボタンを探す。

```js
buttonText: '検索'
```

## 検索実行ロジック

### 共通処理

```text
1. 検索パネルの入力値を取得
2. 空文字なら何もしない
3. 現在のhostに対応するsiteConfigを取得
4. configがなければ何もしない
5. modeに応じて検索処理を分岐
```

### mode: url

```text
1. searchUrlBuilder(keyword) でURL生成
2. location.href で遷移
```

### mode: form

```text
1. 現在ページが searchPageUrl でなければ、キーワードを一時保存して searchPageUrl へ遷移
2. 検索ページで一時保存キーワードを取得
3. keywordSelector で検索欄を取得
4. 検索欄へ値をセット
5. input / change イベントを発火
6. buttonSelector または buttonText で検索ボタンを取得
7. 検索ボタンを click()
8. 一時保存キーワードを削除
```

## 一時保存

Tampermonkey の `GM_setValue` / `GM_getValue` を使用する。

```js
const PENDING_KEYWORD_KEY = 'floatingSearch:pendingKeyword';
```

保存内容：

```js
GM_setValue(PENDING_KEYWORD_KEY, {
  host: location.hostname,
  keyword,
  createdAt: Date.now(),
});
```

読み取り時は、hostが一致する場合のみ使用する。
古いデータが残るのを防ぐため、10分以上前のデータは無視する。

## 入力イベント発火

React / Vue / 独自JS画面でも反応しやすいように、値セット後に以下を発火する。

```js
input.value = keyword;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

必要に応じて `KeyboardEvent` は後続対応とする。

## 検索ボタン探索

優先順位は以下。

```text
1. buttonSelector で取得
2. form内の submit button を取得
3. buttonText に一致するボタンを取得
4. 「検索」「絞り込み」「表示」「この条件で検索」を含むボタンを取得
```

対象要素：

```js
button,
input[type="button"],
input[type="submit"]
```

## UI仕様

### 表示位置

左下固定。

```css
position: fixed;
left: 14px;
bottom: 14px;
z-index: 2147483647;
```

### パネル内容

```text
管理会社共通検索
[キーワード入力欄] [検索]
[閉じる]
```

### 最小化

最小化ボタンを押すと、パネルを小さくする。
最小化状態は `GM_setValue` で保存する。

### ショートカット

任意実装。
`Ctrl + /` で検索欄にフォーカスする。

```js
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === '/') {
    event.preventDefault();
    document.querySelector('#floating-search-keyword')?.focus();
  }
});
```

## 除外・注意

以下は初期版では対象外。

* 複数条件検索
* ログイン処理
* 自動連続検索
* 検索結果の自動取得
* サイトへの大量アクセス
* 図面OCR
* 物件情報の自動保存

このスクリプトは、あくまでブラウザ上の検索操作を補助する用途とする。

## 初期実装の優先範囲

初期版では以下のみ実装する。

```text
1. siteConfigsによるサイト別設定
2. 左下検索パネル表示
3. mode: url 検索
4. mode: form 検索
5. 検索ページ遷移後の自動検索
6. 検索ボタンclick対応
7. 最小化機能
```

## 将来的な拡張

必要に応じて以下を追加する。

```text
・サイト設定を画面上から追加、編集
・CSV/JSONでサイト設定インポート
・検索種別切替：物件名 / 電話番号 / 管理番号
・検索履歴
・よく使う検索語句
・対象サイトごとのON/OFF
・検索パネル位置の変更
・イタンジ専用アダプター
・管理会社ごとの個別アダプター
```

## 想定ファイル名

```text
floating-property-search.user.js
```

## 開発時の確認項目

各サイトごとに以下を確認する。

```text
1. 検索結果URLにキーワードが含まれるか
2. 検索ページURL
3. 検索inputのセレクタ
4. 検索ボタンのセレクタ
5. Enter検索が効くか
6. ボタンクリックで検索できるか
7. React / Vue系の入力欄か
8. 検索ページ以外から検索できるか
```

## 完了条件

以下を満たせば初期版完了とする。

```text
・対象サイト内の任意ページで左下検索パネルが表示される
・検索語句を入力して検索ボタンを押せる
・URL検索対応サイトでは検索結果ページへ直接遷移する
・フォーム検索対応サイトでは検索ページへ移動後、自動で検索が実行される
・検索欄への値セット後に input / change イベントが発火する
・検索ボタンがクリックされる
・最小化状態が保存される
・未設定サイトでは何もしない
```
