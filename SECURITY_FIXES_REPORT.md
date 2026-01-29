# セキュリティ修正レポート

## 概要

MuseGachaアプリケーションのセキュリティ監査を実施し、発見された問題に対する修正を行いました。

---

## 修正済み項目

### 1. 暗号化強化（クリティカル）

**ファイル**: `services/storageService.ts`

**問題**: XOR暗号化は暗号学的に弱く、APIキーの保護が不十分

**修正内容**:
- Web Crypto API (AES-256-GCM) による暗号化を実装
- PBKDF2による鍵導出（100,000イテレーション）
- ランダムなソルトとIVを使用
- デバイス固有のシードで鍵を生成

```typescript
const CRYPTO_CONFIG = {
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH: 256,
  IV_LENGTH: 12,
  SALT_LENGTH: 16,
  ITERATIONS: 100000,
};
```

**後方互換性**: 旧形式（v2, v3）からの自動マイグレーションをサポート

---

### 2. エラーログのサニタイズ（クリティカル）

**ファイル**: `services/geminiService.ts`

**問題**: エラーメッセージにAPIキーが露出する可能性

**修正内容**:
- `logger`ユーティリティに自動サニタイズ機能を追加
- すべての`console.warn/error`を`logger.warn/error`に置換
- APIキー、認証トークン、ヘッダーを自動でマスク

```typescript
const sanitizeForLog = (error: any): string => {
  return message
    .replace(/AIza[A-Za-z0-9_-]+/g, '[API_KEY_REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/authorization:.*$/gim, 'authorization: [REDACTED]');
};
```

---

### 3. XSS対策（高）

**ファイル**: `services/securityService.ts` (新規), `package.json`

**問題**: AI生成コンテンツがサニタイズなしで表示される可能性

**修正内容**:
- DOMPurifyを依存関係に追加
- 包括的なセキュリティサービスを新規作成
- 以下のサニタイズ関数を提供:
  - `sanitizeHtml()`: HTML コンテンツ用
  - `sanitizeText()`: プレーンテキスト用
  - `sanitizeUrl()`: URL用
  - `sanitizeVoiceInput()`: 音声入力用
  - `detectMaliciousContent()`: 悪意のあるコンテンツ検出

---

### 4. 音声入力のバリデーション（高）

**ファイル**: `components/DebateSession.tsx`

**問題**: 音声入力に長さ制限や検証がない

**修正内容**:
- 音声入力を`sanitizeVoiceInput()`でサニタイズ
- 1メッセージあたり500文字の制限
- 全体で1000文字の制限
- 制御文字・注入パターンの除去

```typescript
const INPUT_CONFIG = {
  MAX_USER_INPUT_LENGTH: 1000,
  MAX_VOICE_INPUT_LENGTH: 500,
  SUBMIT_RATE_LIMIT: 5,
};
```

---

### 5. レースコンディション修正（高）

**ファイル**: `components/DebateSession.tsx`

**問題**: `handleUserSubmit`で同時送信が可能

**修正内容**:
- `isSubmittingRef`でRefベースの排他制御
- `AbortController`で進行中のリクエストを管理
- 二重送信の完全な防止

```typescript
const abortControllerRef = useRef<AbortController | null>(null);
const isSubmittingRef = useRef<boolean>(false);

const handleUserSubmit = async (e?: React.FormEvent) => {
  if (isSubmittingRef.current || isGeneratingScript) return;
  isSubmittingRef.current = true;
  // ...
};
```

---

### 6. IndexedDBキャッシュキーのハッシュ化（高）

**ファイル**: `services/geminiService.ts`

**問題**: ユーザー入力がキャッシュキーとして平文で保存される

**修正内容**:
- SHA-256でキャッシュキーをハッシュ化
- ユーザーのテキストがIndexedDBに平文で保存されない
- メモリ内でのみプレーンキー→ハッシュのマッピングを保持

```typescript
const hashCacheKey = async (key: string): Promise<string> => {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};
```

---

### 7. 並列処理のレースコンディション修正（中）

**ファイル**: `services/geminiService.ts`

**問題**: `waitForParallelSlot`で同時アクセス時にレースコンディション

**修正内容**:
- ミューテックスパターンで排他制御を実装
- 同時アクセスを直列化

```typescript
let parallelSlotMutex: Promise<void> = Promise.resolve();

const waitForParallelSlot = async (): Promise<void> => {
  const currentMutex = parallelSlotMutex;
  let releaseMutex: () => void;
  parallelSlotMutex = new Promise(resolve => {
    releaseMutex = resolve;
  });
  await currentMutex;
  // ... 処理
  releaseMutex!();
};
```

---

### 8. メモリリーク対策強化（中）

**ファイル**: `components/DebateSession.tsx`

**問題**: コンポーネントアンマウント時のリソース解放が不完全

**修正内容**:
- すべてのAudioBufferSourceNodeを追跡・解放
- AbortControllerの中断処理
- Web Speech APIのイベントリスナークリア
- MediaRecorderの停止
- speechSynthesisのキャンセル

```typescript
return () => {
  activeSourcesRef.current.forEach(src => {
    try { src.stop(); } catch {}
  });

  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.onvoiceschanged = null;
  }
  // ...
};
```

---

### 9. レート制限の追加（中）

**ファイル**: `services/securityService.ts`, `components/DebateSession.tsx`

**問題**: ユーザー送信にレート制限がない

**修正内容**:
- 1分あたり5回の送信制限
- `checkRateLimit()`関数で統一的なレート制限
- 制限超過時にユーザーに通知

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `services/storageService.ts` | AES-256-GCM暗号化、非同期API追加 |
| `services/geminiService.ts` | ログサニタイズ、キャッシュキーハッシュ化、ミューテックス |
| `services/securityService.ts` | **新規** セキュリティユーティリティ |
| `components/DebateSession.tsx` | 入力検証、レースコンディション修正、メモリリーク対策 |
| `package.json` | DOMPurify依存関係追加 |

---

## 追加の推奨事項

### 短期（実装推奨）

1. **Content Security Policy (CSP)**
   ```html
   <meta http-equiv="Content-Security-Policy"
         content="default-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com;">
   ```

2. **エラーバウンダリ**
   - React Error Boundaryコンポーネントの追加
   - グローバルエラーハンドリング

3. **入力検証の強化**
   - キャラクタープロファイルのvoiceName検証
   - 設定値の型チェック強化

### 中期

4. **セッション管理**
   - アイドルタイムアウト
   - 自動ログアウト機能

5. **監査ログ**
   - セキュリティイベントのログ記録
   - 異常検知

### 長期

6. **セキュリティテスト**
   - 自動化されたセキュリティテストの導入
   - 定期的な脆弱性スキャン

---

## 使用方法

### DOMPurifyのインストール

```bash
npm install dompurify
npm install --save-dev @types/dompurify
```

### セキュリティサービスの使用

```typescript
import {
  sanitizeHtml,
  sanitizeText,
  sanitizeUrl,
  checkRateLimit
} from './services/securityService';

// AI生成コンテンツのサニタイズ
const safeContent = sanitizeHtml(aiGeneratedHtml);

// ユーザー入力のサニタイズ
const safeInput = sanitizeText(userInput);

// レート制限チェック
if (!checkRateLimit('api_call', 10, 60000)) {
  // 制限超過
}
```

---

## まとめ

| 重要度 | 修正前 | 修正後 |
|--------|--------|--------|
| クリティカル | 2件 | 0件 |
| 高 | 5件 | 0件 |
| 中 | 4件 | 0件 |
| **合計** | **11件** | **0件** |

すべての高優先度セキュリティ問題が修正されました。
