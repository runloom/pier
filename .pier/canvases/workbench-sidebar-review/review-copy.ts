import type { Locale } from "./copy.ts";
import type { UpdatePhase } from "./footer-copy.ts";

export const REVIEW_LANGUAGES: { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

export const REVIEW_COPY: Record<
  Locale,
  {
    title: string;
    options: string;
    height: string;
    updateState: string;
    peeksWorktree: string;
    peeksNote: string;
    updates: Record<UpdatePhase, string>;
  }
> = {
  "zh-CN": {
    title: "侧边栏",
    options: "画板选项",
    height: "高度",
    updateState: "更新状态",
    peeksWorktree: "工作树悬停卡片",
    peeksNote:
      "只有工作树有悬停。卡片补路径、分支和 GIT；增删用产品同款绿/红色。会话行不悬停。",
    updates: {
      none: "无更新",
      available: "可下载",
      downloading: "下载中",
      downloaded: "待重启",
    },
  },
  en: {
    title: "Sidebar",
    options: "Artboard options",
    height: "Height",
    updateState: "Update state",
    peeksWorktree: "Worktree hover cards",
    peeksNote:
      "Only worktrees hover. The card adds path, branch, and GIT. Additions and deletions use the product green and red. Sessions do not hover.",
    updates: {
      none: "No update",
      available: "Available",
      downloading: "Downloading",
      downloaded: "Ready to restart",
    },
  },
  ja: {
    title: "サイドバー",
    options: "アートボードの設定",
    height: "高さ",
    updateState: "更新状態",
    peeksWorktree: "ワークツリーのホバーカード",
    peeksNote:
      "ホバーはワークツリーのみです。カードはパス、ブランチ、GIT を補い、増減は製品と同じ緑と赤です。セッションはホバーしません。",
    updates: {
      none: "更新なし",
      available: "ダウンロード可能",
      downloading: "ダウンロード中",
      downloaded: "再起動待ち",
    },
  },
  ko: {
    title: "사이드바",
    options: "아트보드 설정",
    height: "높이",
    updateState: "업데이트 상태",
    peeksWorktree: "작업 트리 호버 카드",
    peeksNote:
      "호버는 작업 트리만 있습니다. 카드는 경로, 브랜치, GIT을 보강하고 증감은 제품과 같은 초록/빨강입니다. 세션은 호버하지 않습니다.",
    updates: {
      none: "업데이트 없음",
      available: "다운로드 가능",
      downloading: "다운로드 중",
      downloaded: "재시작 대기",
    },
  },
};
