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

# Pier 이 기기 CLI 사용 설명서

`pier`는 이 기기의 Pier를 제어합니다. 프로젝트 열기, 윈도우와 패널 찾기, 터미널 조작, 에이전트 상태 보기, git 작업 트리 관리가 대상입니다. 원격 API가 아니며 Claude Code, Codex, OpenCode 등 각 도구 본래의 명령줄을 대체하지 않습니다.

> 이 페이지는 GitHub에서 바로 읽는 입구입니다. 앱 안 검색 가능한 설명서는 [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx)와 [`data.json`](./data.json)입니다(현재는 간체 중국어). 여기 있는 응답 예시는 읽기용입니다. 스크립트는 현재 `--json` 응답의 `ok`, `data`, `error`를 확인하세요.

## 60초 시작

정식 설치 패키지의 `pier`는 앱이 실행 중이 아니면 먼저 시작한 뒤 실행합니다. 릴리스는 Shell `PATH`를 바꾸지 않습니다. Pier가 기본 `/Applications`에 있으면, 현재 터미널에서 먼저 실행하세요.

```bash
export PATH="/Applications/Pier.app/Contents/Resources/bin:$PATH"
```

앱이 `~/Applications`에 있으면 경로를 `$HOME/Applications/Pier.app/Contents/Resources/bin`으로 바꿉니다. 그다음 실행합니다.

```bash
# 1. 이 기기 Pier에 연결되었는지 확인
pier status --json

# 2. 현재 프로젝트를 Pier에서 열기(같은 작업 디렉터리의 일반 터미널이 있으면 포커스)
pier . --json

# 3. 윈도우와 패널 보기
pier windows list --json
pier panels list --json

# 4. Pier가 아는 제품과 실행 중인 에이전트 보기
pier agents catalog --json
pier agents list --json
```

`PATH`를 바꾸지 않고 `/Applications/Pier.app/Contents/Resources/bin/pier <명령…>`을 직접 실행해도 됩니다. 소스에서 개발할 때는:

```bash
pnpm --silent cli:dev -- status --json
```

`node ./bin/pier.mjs <명령…>`을 직접 실행할 수도 있습니다.

## 자주 쓰는 옵션

| 옵션 | 의미 |
| --- | --- |
| `--json` | 안정적인 JSON을 출력합니다. 스크립트는 항상 붙이세요 |
| `--print-envelope` | 보낼 요청만 인쇄하고 실행하지 않습니다 |
| `--no-focus` | Pier 윈도우를 앞으로 가져오지 않으려고 합니다 |
| `--window <id>` | 윈도우를 지정합니다. 먼저 `pier windows list --json`으로 조회하세요 |

성공 응답에는 `ok: true`와 `data`가 있습니다. 실패 응답에는 `ok: false`, 오류 코드, 사람이 읽을 수 있는 메시지가 있습니다.

## 프로젝트 열기와 패널 정리

```bash
# 현재 디렉터리를 엽니다. 같은 작업 디렉터리의 일반 터미널이 있으면 포커스, 없으면 새로 만듭니다
pier . --json

# 지정 디렉터리를 엽니다. 현재 배치 오른쪽에 분할을 더할 수도 있습니다
pier open /path/to/repo --json
pier open . --split right --json

# 파일을 엽니다(이미 열려 있으면 탭을 재사용. :행[:열]을 붙일 수 있음)
pier src/app.ts:12 --json

# 패널을 찾아 포커스
pier panels list --json
pier panels focus <panelId> --json

# 터미널을 새로 엽니다(항상 새로 만듭니다. 재사용하지 않음)
pier terminal open --cwd . --json
pier terminal open --cwd . --json -- claude
```

터미널을 찾는 명령은 터미널 전체 내용을 반환하지 않습니다.

```bash
pier terminal list --json
pier terminal get --panel <panelId> --json
```

일반 Shell 터미널에는 텍스트나 키를 보낼 수 있습니다.

```bash
pier terminal send --panel <panelId> --text "pnpm test" --json
pier terminal key --panel <panelId> --key enter --json
```

에이전트 패널에서는 다음 절의 `agents turn`, `agents interrupt`, `agents terminate`를 쓰세요. 일반 터미널 명령으로 실행 상태를 우회하지 마세요.

## 에이전트 실행과 조회

먼저 Pier가 아는 에이전트 목록을 본 다음, 계속 실행되는 세션을 시작합니다.

```bash
pier agents catalog --json
pier agents start --agent codex --cwd . --json
```

`agents start`는 `bootId`, `runtimeId`, `generation`, `panelId`를 반환합니다. 이후 명령은 이 실행 참조를 사용합니다.

```bash
pier agents turn \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --text "현재 변경을 확인하고 테스트를 실행" \
  --json

pier agents wait \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --until attention \
  --json
```

자주 쓰는 조회와 제어는 아래와 같습니다. 표의 `<실행 참조>`는 같은 `--boot <bootId> --runtime <runtimeId> --generation <generation>` 묶음입니다.

| 명령 | 용도 |
| --- | --- |
| `pier agents list --json` | 실행 중인 에이전트 패널 목록 |
| `pier agents get --panel <panelId> --json` | 실행 인스턴스 하나 조회 |
| `pier agents screen <실행 참조> --json` | 지금 보이는 터미널 영역을 읽습니다. 대화 전체가 아닙니다 |
| `pier agents watch <실행 참조> --json` | 실행 상태 변화를 계속 받습니다 |
| `pier agents focus <실행 참조> --json` | 해당 패널로 돌아갑니다 |
| `pier agents interrupt <실행 참조> --json` | 현재 실행을 중단합니다 |
| `pier agents terminate <실행 참조> --json` | 그 실행 인스턴스를 종료합니다 |

`accepted: true`는 입력이 전달되었다는 뜻일 뿐, 작업이 끝났다는 뜻이 아닙니다. `agents wait`는 `ready`, `waiting`, `exited`, `attention`을 기다립니다. `agents watch`는 상태 변화를 관찰합니다. 최종 결과는 여전히 에이전트 자신의 출력입니다.

## git 작업 트리

```bash
# 저장소의 작업 트리 조회
pier worktrees list --path /path/to/repo --json

# 독립 작업 트리를 만들고 열기
pier worktrees create \
  --path /path/to/repo \
  --name retry-policy \
  --branch feature/retry-policy \
  --base main \
  --json
pier worktrees open /path/to/retry-policy --json

# 작업 트리 검사 또는 조회
pier worktrees check --path /path/to/retry-policy --json
pier worktrees get --path /path/to/retry-policy --json
```

Pier가 관리하는 작업 트리를 제거하기 전에, Pier는 활성 실행과 커밋하지 않은 변경을 확인합니다.

```bash
pier worktrees remove --path /path/to/retry-policy --json
```

## Shell 작업

여기 작업은 프로젝트에 설정한 build, test 같은 Shell 실행입니다. 작업 대장이나 자동 스케줄러가 아닙니다.

```bash
pier tasks list --path . --json
pier tasks run <taskId> --path . --json
pier tasks status <runId> --json
pier tasks output <runId> --json
pier tasks stop <runId> --json
pier tasks cancel <runId> --json
```

## 알림, 설정, 플러그인

```bash
# 알림
pier notifications list --unread --json
pier notifications get --id <id> --json
pier notifications focus --id <id> --json
pier notifications mark-read --id <id> --json

# 읽기 전용 설정과 플러그인 정보
pier preferences read --json
pier plugins list --json
pier plugins inspect <pluginId> --json
```

플러그인 사용/중지는 Pier의 「설정 → 플러그인」에서 하세요. 이 기기 CLI에는 그 쓰기 권한이 없습니다.

## 연결 문제 해결

- Pier 앱이 실행 중인지 확인하세요. `pier` 명령만 설치된 것으로는 부족합니다.
- 개발 중에는 `pnpm --silent cli:dev -- <명령…>`을 써서 설치본에 잘못 연결하지 마세요.
- 윈도우가 여러 개이면 먼저 `pier windows list --json`을 실행한 뒤 `--window <id>`를 넘기세요.
- 스크립트는 `ok`와 `error.code`를 읽으세요. 사람용 출력 텍스트에 의존하지 마세요.
- `agents wait` 시간 초과는 에이전트가 실패한 것과 같지 않습니다. `agents get` 또는 `agents watch`로 상태를 계속 조회할 수 있습니다.

더 자세한 명령 그룹과 상태는 [`data.json`](./data.json)을 보세요. Pier Files 패널에서 [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx)를 열면 검색 가능한 앱 안 설명서도 쓸 수 있습니다.
