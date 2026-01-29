<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# MuseGacha - AI執筆アシスタント

**Gemini 1.5 Pro/Flash を活用した、マルチモーダルAIディベート＆執筆支援プラットフォーム**

[View in AI Studio](https://ai.studio/apps/drive/1MdzI8GvoW0t6C3nwi0Mv4H2N0bQzKrKo)

</div>

---

## 🚀 Overview

MuseGachaは、ユーザーのアイデア出しや執筆活動を支援するAIアプリケーションです。複数のAIキャラクター（Host, Guest, Muse, Sageなど）がディベートを行い、多角的な視点からテーマを深掘りします。

### ✨ Latest Updates (v2.0 Reinvention)
*   **Premium Character Redesign**: 主要キャラクター（Host, Guest, Muse, Sage）のアートスタイルを一新。より没入感のある高品質なビジュアルへ。
*   **Dynamic Debate UI**: 話者切り替え時の「リボルバーアニメーション」や、ステージテーマに合わせた背景エフェクトを実装。
*   **Enhanced Reporting**: ディベート終了後のレポート画面を強化。より詳細な分析と視覚的なフィードバックを提供。

---

## 🌟 Key Features

*   **Interactive Debate Session**: AIキャラクターたちが自律的に議論を展開。
*   **Multi-modal Experience**: テキストだけでなく、音声（TTS）によるリアルな会話体験。
*   **Smart Report Generation**: 議論の内容を要約し、執筆に役立つ構成案やアイデアを自動生成。
*   **Character Variety**: 個性豊かなキャラクターたちが、それぞれの性格に基づいた発言を行います。

## 🛠 Tech Stack

*   **Frontend**: React, Vite, TypeScript
*   **Styling**: TailwindCSS, CSS Modules (Phone-first responsive design)
*   **AI**: Google Gemini API (Multimodal generation)
*   **Audio**: ElevenLabs / Gemini TTS integration
*   **Backend/Services**: Firebase (Firestore) integration ready

---

## 💻 Run Locally

**Prerequisites:** Node.js

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Setup Environment:**
   Set the `GEMINI_API_KEY` in `.env.local` to your Gemini API key.

3. **Run the app:**
   ```bash
   npm run dev
   ```
