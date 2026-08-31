<!-- source: README.md (zh-CN). Keep the same section order; do not add or drop headings. -->

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <a href="README.en.md">English</a>
  ·
  <a href="README.ja.md">日本語</a>
  ·
  <strong>한국어</strong>
</p>

<h1 align="center">Pier</h1>

<p align="center">
  <strong>여러 AI 터미널이 열려 있어도, 처리가 필요한 상대를 한눈에 볼 수 있습니다.</strong><br />
  Claude Code와 Codex는 원래 터미널에 그대로 있습니다. 파일 수정과 git 확인은 바로 옆에서.
</p>

<p align="center">
  <a href="https://pier.codes">웹사이트</a> ·
  <a href="https://github.com/runloom/pier/releases">다운로드</a> ·
  <a href="docs/README.md">문서</a> ·
  <a href=".pier/canvases/pier-cli-user-manual/README.ko.md">CLI 매뉴얼</a> ·
  <a href="CONTRIBUTING.md">기여</a> ·
  <a href="CHANGELOG.md">변경 로그</a>
</p>

> 데스크톱 앱은 현재 **macOS**만 지원합니다(Apple Silicon / Intel).

## 왜 Pier인가

**원래 터미널 그대로입니다.** 또 다른 채팅 창이 아닙니다. 계정과 구독은 그대로입니다. Claude Code, Codex, OpenCode는 각자 터미널에서 계속 실행됩니다.

**처리가 필요한 상대가 보입니다.** 실행 중, 처리 필요, 오류 세션을 한곳에서 봅니다. 탭을 뒤지지 말고, 클릭하면 원래 터미널로 돌아갑니다.

**파일과 git을 위해 다른 창을 열지 않습니다.** 파일을 열어 고치고, 파일 또는 조각 단위로 스테이징한 뒤 커밋, 푸시합니다. 한 줄 수정이나 일상적인 git이라면 다른 편집기로 바꿀 필요가 없습니다.

## 핵심 흐름

1. 프로젝트 또는 git 작업 트리에서 Claude Code, Codex 또는 다른 명령줄을 엽니다.
2. 여러 세션이 동시에 돌 때, 누가 실행 중인지, 누가 처리가 필요한지, 누가 오류인지 봅니다.
3. 그 행을 눌러 원래 터미널로 돌아가 확인하거나 이어서 씁니다.
4. 터미널은 계속 실행됩니다. 파일을 열어 고치고, diff를 본 다음 커밋합니다.

## 핵심 능력

- **네이티브 터미널** — 프로젝트 또는 작업 트리에서 Shell과 명령줄 프로그래밍 에이전트를 실행합니다. 화면을 다시 불러온 뒤에도 실행 중인 터미널은 그대로 쓸 수 있습니다
- **세션 상태** — 실행 중, 처리 필요, 오류 세션을 한곳에서 보고, 클릭하면 해당 터미널로 돌아갑니다
- **작업마다 다른 디렉터리** — 작업마다 독립된 프로젝트 디렉터리(git 작업 트리)를 열어 파일 변경이 서로 겹치지 않게 합니다
- **파일, 편집, git** — 프로젝트 파일을 열고 편집합니다. diff를 심사하고, 파일 또는 조각 단위로 스테이징합니다. 커밋, 푸시, 브랜치, 스태시는 명령 팔레트에서 할 수 있습니다
- **Canvas** — 프로젝트에 저장되는 페이지는 이미 쓸 수 있습니다. 터미널과 상태로 칸반과 실행 그림을 만드는 작업은 아직 진행 중입니다
- **저장되는 배치** — 탭, 분할, 플로팅 패널로 터미널, 편집기, 변경을 정리합니다. 배치는 자동 저장됩니다

## 기타 능력

- **프로젝트 내용 미리보기** — Markdown, 이미지, 그 밖에 지원하는 프로젝트 파일을 미리 봅니다
- **이 기기 CLI** — `pier`로 프로젝트를 열고, 윈도우와 패널을 찾고, 터미널을 열어 텍스트나 키를 보내며, 에이전트와 작업 트리를 조회합니다. 이 기기에서 실행 중인 Pier에만 연결합니다
- **플러그인** — 내장 플러그인과 공식 서명·검증·버전 관리 플러그인을 쓸 수 있습니다. 이후 더 많은 출처를 지원할 예정입니다. 현재 설치 범위는 [`docs/plugins.md`](docs/plugins.md)를 보세요

## 제품 경계

앱 자체에는 작업 대장이나 자동 스케줄러가 없습니다. 칸반과 실행 그림은 터미널과 상태를 Canvas에서 조립하며, 이 작업은 아직 진행 중입니다.

채팅 창으로 만들지 않습니다. 떠난 뒤에도 원래 명령줄, 계정, 저장소는 그대로 동작합니다.

## 설치

### 릴리스 사용

[GitHub Releases](https://github.com/runloom/pier/releases)에서 Apple Silicon 또는 Intel용 현재 macOS 버전을 받습니다. Pier를 열고 프로젝트 폴더를 고르면 터미널에서 에이전트를 실행하고, 파일을 보며, 변경을 심사할 수 있습니다.

릴리스를 실행한 뒤 디렉터리가 쓰기 가능하면 `pier`를 `PATH`에 넣으려고 합니다. 설정 → 터미널에서 설치하거나, `/Applications/Pier.app/Contents/Resources/bin/pier`를 직접 실행하거나, [CLI 매뉴얼](.pier/canvases/pier-cli-user-manual/README.ko.md)대로 그 디렉터리를 현재 터미널 `PATH`에 넣을 수도 있습니다.

### 소스에서 실행

Node.js `^24.15.0`, pnpm `>=11.12.0`, Xcode Command Line Tools, Homebrew, `zig@0.15`가 필요합니다. 저장소는 `packageManager`로 pnpm `11.18.0`을 고정합니다.

```bash
git clone https://github.com/runloom/pier.git
cd pier
pnpm bootstrap
pnpm dev
```

이미 있는 git 작업 트리에 처음 들어갈 때는 먼저 `pnpm setup:worktree`를 실행하세요. 의존성 확인, 흔한 문제, 빌드 방법은 [`docs/development.md`](docs/development.md)를 보세요.

## 이 기기 CLI

정식 설치 패키지의 `pier`는 앱이 실행 중이 아니면 먼저 시작합니다. CLI는 이 기기의 Pier를 제어합니다. 원격 API가 아닙니다.

```bash
pier status --json
pier . --json
pier panels list --json
```

자주 쓰는 명령, 개발 시 호출 방법, 상태 의미는 [CLI 사용자 매뉴얼](.pier/canvases/pier-cli-user-manual/README.ko.md)을 보세요.

## 문서

- [개발 가이드](docs/development.md) — 환경, 작업 트리, 검사와 빌드
- [CLI 사용자 매뉴얼](.pier/canvases/pier-cli-user-manual/README.ko.md) — 실행 중인 이 기기 Pier 제어
- [공식 플러그인](docs/plugins.md) — 범위, 개발, 검증
- [릴리스 가이드](docs/release.md) — 유지 관리자 배포 절차
- [변경 로그](CHANGELOG.md) — 이미 나온 변화와 아직 나오지 않은 변화
- [전체 문서 색인](docs/README.md) — 사용자, 기여자, 유지 관리자별로 자료 찾기

## 기여

Issue와 Pull Request를 환영합니다. 시작하기 전에 [`CONTRIBUTING.md`](CONTRIBUTING.md)를 읽으세요. 작은 문서 수정을 제외하면, 병합 전에 기여자 허가가 필요합니다.

제출 전에 실행하세요:

```bash
pnpm check
```

## 보안과 라이선스

보안 문제는 [`SECURITY.md`](SECURITY.md)에 따라 비공개로 보고하세요. 공개 Issue로 제출하지 마세요.

- 소스는 [`AGPL-3.0-only`](LICENSE)로 배포됩니다
- 클로즈드 소스 배포, 화이트 라벨, 기업 지원, 또는 AGPLv3 밖의 권한은 별도의 상업 계약이 필요합니다
- 상표와 제3자 자산은 [`TRADEMARKS.md`](TRADEMARKS.md), [`NOTICE`](NOTICE), [`docs/legal/licensing.md`](docs/legal/licensing.md)를 보세요
