/** Skills section copy (design v9 §7); split from settings.ts (file-size cap). */
export const settingsSkills = {
  description:
    "이 프로젝트의 에이전트 스킬을 관리합니다. 이 Mac 전체 스킬 폴더는 바뀌지 않습니다.",
  emptyTitle: "프로젝트 스킬이 없습니다",
  detailEmptyTitle: "이 프로젝트에는 아직 스킬이 없습니다",
  detailEmptyDescription:
    "폴더를 가져오거나 스킬을 추가하세요. 상세에서 켜야 에이전트가 쓸 수 있습니다. 디스크에 이미 있는 스킬은 「프로젝트 안」에 표시됩니다.",
  emptyDescription: "프로젝트를 고른 다음, 로컬 스킬 디렉터리를 가져오세요.",
  searchPlaceholder: "스킬 검색",
  filterAll: "모두",
  filterGroupLabel: "출처로 스킬 필터",
  filterManaged: "내가 관리",
  filterProject: "프로젝트 안",
  filterUserGlobal: "이 Mac",
  contentTitle: "SKILL.md 내용",
  contentSkillMdOnlyNotice:
    "여기에서는 SKILL.md만 엽니다. 다른 파일은 스킬 폴더에 남습니다. 보거나 편집하려면 그 폴더를 여세요.",
  metadataTitle: "상세",
  metadataCompanionHint:
    "폴더의 다른 파일도 포함합니다. 여기에서는 SKILL.md만 엽니다.",
  policyTitle: "정책",
  removeTitle: "제거",
  removeBody:
    "이 스킬을 프로젝트에서 제거합니다(되돌릴 수 없음). 잠시 멈추려면 상세에서 설치 위치를 끄세요.",
  removeLibraryBody:
    "이 Mac의 Pier 라이브러리에서 이 스킬을 삭제합니다. 되돌릴 수 없습니다.",

  matrixNotInstalled_one:
    "설치되지 않은 에이전트 {{count}}개는 숨겨져 있습니다.",
  matrixNotInstalled_other:
    "설치되지 않은 에이전트 {{count}}개는 숨겨져 있습니다.",
  matrixAllSameState_one: "설치된 에이전트는 {{state}}입니다.",
  matrixAllSameState_other:
    "설치된 에이전트 {{count}}개는 모두 {{state}}입니다.",
  matrixGroupState_one: "에이전트 {{count}}개: {{state}}",
  matrixGroupState_other: "에이전트 {{count}}개: {{state}}",
  contentUnavailable: "이 스킬의 내용을 읽지 못했습니다.",
  contentTruncated: "내용이 1MB를 넘어 앞부분만 표시합니다.",
  readOnlyNotice: "자체 폴더에서 유지됩니다. Pier는 바꾸지 않습니다.",
  reload: "다시 불러오기",
  reloadRequired: "스킬이 Pier 밖에서 변경되었습니다.",
  reloadRequiredHint: "다시 시도하기 전에 현재 파일을 다시 불러오세요.",
  repairFailed: "모든 에이전트가 스킬을 쓰도록 하지 못했습니다",
  repairFailedBody:
    "복구가 끝나지 않았습니다. 다시 시도하세요. 계속되면 프로젝트를 다시 불러오세요.",
  importTitle: "스킬 추가",
  previewTemplateTitle: "새 스킬 미리보기",
  importCancel: "취소",
  importFailed: "스킬을 가져오지 못했습니다",
  importInvalid: "가져오기 결과가 올바르지 않습니다. 다시 시도하세요.",
  launchBlockedTitle: "스킬이 아직 준비되지 않았습니다",
  launchBlockedBody:
    "준비되지 않은 스킬이 있습니다. 스킬 설정을 열어 고치세요.",
  launchOperationBusy:
    "다른 스킬 업데이트가 아직 끝나지 않았습니다. 잠시 후 다시 시도하세요.",
  launchIssueProjection:
    "에이전트가 아직 {{skill}}을(를) 쓸 수 없습니다. 스킬 설정을 열고 다시 시도하세요.",
  launchIssueTargetModified:
    "{{target}}이(가) Pier 밖에서 변경되었습니다. 스킬 설정을 열어 해결하세요.",
  launchIssueDuplicate:
    "에이전트가 같은 스킬을 여러 폴더에서 찾을 수 있습니다. 스킬 설정을 열어 출처를 하나만 고르세요.",
  launchOpenSettings: "스킬 설정 열기",
  launchAnyway: "그래도 시작",
  launchCancel: "취소",
  backToList: "프로젝트 목록으로",
  currentBadge: "현재",
  deleteSkill: "이 스킬 삭제",
  enableSkill: "스킬 사용",
  enableSkillLabel: "이 스킬 사용",
  enableSkillHint: "켜면 설치된 에이전트가 이 스킬을 찾아 쓸 수 있습니다.",
  enableSkillHintPending:
    "저장하면 적용됩니다. 켜면 설치된 에이전트가 이 스킬을 찾아 쓸 수 있습니다.",
  deliveryClaude: "Claude Code에도 제공",
  deliveryClaudeHint:
    "켠 스킬은 평소 에이전트에 이미 전달됩니다. 이것을 켜면 Claude Code에도 전달됩니다.",
  listTitle_one: "스킬({{count}})",
  listTitle_other: "스킬({{count}})",
  skillCount_one: "관리 스킬 {{count}}개",
  skillCount_other: "관리 스킬 {{count}}개",
  loadFailed: "스킬을 불러오지 못했습니다",
  projectsTitle: "프로젝트",
  addProject: "프로젝트 추가",
  addProjectFailed: "프로젝트를 추가하지 못했습니다",
  addProjectFailedBody: "프로젝트 폴더를 다시 고른 뒤 다시 시도하세요.",
  projectsLoadFailed: "프로젝트를 불러오지 못했습니다",
  projectsLoadFailedBody: "다시 시도해 프로젝트 목록을 불러오세요.",
  noResultsTitle: "일치하는 스킬이 없습니다",
  noResultsDescription: "검색이나 필터를 바꿔 더 많은 스킬을 보세요.",
  clearFilters: "검색과 필터 지우기",
  resultCount_one: "스킬 {{shown}} / {{total}}개",
  resultCount_other: "스킬 {{shown}} / {{total}}개",
  addSkill: "스킬 추가",
  addFromFolder: "폴더에서 가져오기",
  addBlank: "새 스킬 추가",
  blankIdTitle: "이름",
  blankIdBody: "소문자, 숫자, 하이픈(예: review-guide).",
  blankIdInvalid:
    "소문자, 숫자, 하이픈만 쓰고, 처음은 글자 또는 숫자여야 합니다.",
  blankIdReserved:
    "「pier-」로 시작하는 이름은 Pier 시스템 스킬용으로 예약되어 있습니다.",
  blankIdTaken: "이 이름의 스킬이 이미 있습니다. 다른 이름을 고르세요.",
  confirmAdd: "추가",
  createFailed: "스킬을 추가하지 못했습니다",
  createFailedBody: "스킬을 추가하는 중 문제가 생겼습니다. 다시 시도하세요.",
  createSkillMdInvalid:
    "SKILL.md frontmatter를 고치세요. 위 칸과 같은 name과 description이 필요합니다.",
  createContentSaveFailedBody:
    "스킬은 추가했지만 SKILL.md 내용을 저장하지 못했습니다. 스킬을 열어 다시 편집하세요.",
  open: "열기",
  unmanagedBadge: "프로젝트 안",
  userGlobalBadge: "이 Mac",
  importAsManaged: "Pier로 관리",
  systemBadge: "Pier 시스템",
  unmanagedConflictBadge: "경로 사용 중",
  unmanagedConflictHelpLabel: "경로 사용 중 안내",
  unmanagedConflictHint:
    "{{target}}에 이미 내용이 있습니다. Pier는 덮어쓰지 않습니다. Pier 복사본을 쓰려면 먼저 그 경로를 옮기세요.",
  pierLibraryBadge: "Pier",
  pierBoundBadge: "Pier",
  alwaysIncludeBadge: "항상 포함",
  removeFromProject: "이 프로젝트에서 제거",
  removeFromProjectFailed: "이 프로젝트에서 Pier 스킬을 제거하지 못했습니다",
  bindFromLibrary: "Pier 라이브러리에서 추가",
  bindFromLibraryTitle: "Pier 라이브러리에서 추가",
  bindFromLibraryAdd: "프로젝트에 추가",
  bindFromLibraryFailed: "라이브러리 스킬을 이 프로젝트에 추가하지 못했습니다",
  bindFromLibraryEmptyTitle: "추가할 항목이 없습니다",
  bindFromLibraryEmptyBody:
    "먼저 Pier 홈에서 스킬을 추가하세요. 이미 추가됐거나 항상 포함일 수 있습니다.",
  bindAlsoClaude: "Claude Code에도 제공",
  bindAlsoClaudeHint:
    "Claude Code에도 설치합니다. 이후 라이브러리 편집은 프로젝트 복사본에도 반영됩니다.",
  managedSource: {
    localImport: "이 Mac에서 추가",
    projectDiscoveryImport: "프로젝트에서 가져옴",
    gitDeclared: "저장소에 선언됨",
    pierHome: "Pier 홈에서 설치됨",
    pierSystem: "Pier 내장",
  },
  effectDiscoverable: "발견 가능",
  effectNotProjected: "사용 안 함",
  effectShadowed: "이 Mac의 같은 이름 스킬에 가려짐",
  effectOverridden: "다른 복사본이 우선함",
  effectDuplicate: "여러 곳에서 발견됨",
  effectRootNotScanned: "이 폴더를 찾지 않음",
  effectNotInstalled: "설치되지 않음",
  effectUnknownVersion: "버전 확인이 필요함",
  skillOn: "켜짐",
  skillOff: "꺼짐",
  leaveEditTitle: "저장하지 않은 스킬 편집을 버릴까요?",
  leaveEditBody: "저장하지 않은 스킬 내용 변경은 사라집니다.",
  confirmGitDeleteTitle: "{{target}}의 에이전트 스킬 폴더를 삭제할까요?",
  confirmGitDeleteBody:
    "이 경로는 Git이 추적합니다. 삭제하면 저장소 변경에 삭제로 나타납니다.",
  confirmContentDeleteTitle: "스킬 {{skill}}을(를) 삭제할까요?",
  confirmContentDeleteBody:
    "이 프로젝트에서 스킬을 제거합니다. 스위치를 끄는 것은 에이전트에게만 숨깁니다. 되돌릴 수 없습니다.",
  confirmUnmanagedReplaceTitle: "{{target}}의 기존 내용을 바꿀까요?",
  confirmUnmanagedReplaceBody:
    "그 경로에는 Pier가 관리하지 않는 내용이 있습니다. 계속하면 있는 내용을 지우고 Pier 스킬 링크를 설치합니다.",
  confirmUnmanagedReplaceAction: "바꾸고 계속",
  confirmSkillsStateResetTitle: "이 프로젝트의 스킬 기록을 다시 만들까요?",
  confirmSkillsStateResetBody:
    "이 프로젝트의 스킬 기록이 손상되었습니다. 계속하면 쓸 수 있는 목록을 다시 만들고, 복구할 수 없는 데이터는 버립니다.",
  confirmSkillsStateResetAction: "다시 만들고 계속",
  issueUnmanagedConflict:
    "{{target}}에 이미 같은 이름 내용이 있습니다. 사용하면 Pier 버전으로 바꿀지 확인합니다.",
  issueDuplicateDiscovery:
    "Claude Code 제공이 켜져 있으면 {{agent}}이(가) 여러 디렉터리에서 같은 이름 스킬을 찾습니다. Claude Code 제공을 끄면 해결됩니다.",
  issueIdentityChanged:
    "프로젝트 디렉터리가 이동됐거나 바뀌었습니다. 프로젝트 목록으로 돌아가 다시 여세요.",
  issueMissingSource:
    "{{skill}}의 라이브러리 내용이 없습니다(.pier/skills/library/{{skill}}). 스킬을 삭제하거나 다시 가져오세요.",
  issueInvalidManifest:
    "이 프로젝트의 스킬 목록이 손상되었습니다. 스킬 설정을 고친 뒤 다시 불러오세요.",
  issueLedgerCorrupt:
    "이 프로젝트의 Pier 로컬 스킬 기록이 손상되었습니다. 프로젝트를 다시 불러오거나, 손상된 기록을 지운 뒤 다시 시도하세요.",
  issueRecoveryBlocked:
    "이전 스킬 변경이 깨끗이 끝나지 않았습니다. 다시 시도하거나 프로젝트를 다시 불러오세요.",
  issueGeneric:
    "에이전트가 영향받은 스킬을 아직 쓸 수 없습니다. 표시된 문제를 해결한 뒤 다시 시도하세요.",
  missingBadge: "내용 없음",
  actionFailed: "이 작업을 완료하지 못했습니다",
  actionFailedBody: "프로젝트를 다시 불러온 뒤 다시 시도하세요.",
  actionBlockedTitle: "이 작업을 완료할 수 없습니다",
  actionBlockedBody: "이 스킬에 표시된 문제를 해결한 다음 다시 시도하세요.",
  actionDangerConfirmTitle: "이 변경을 계속할까요?",
  actionDangerConfirmBody:
    "Pier가 관리하는 파일이 바뀝니다. 계속하기 전에 영향받는 스킬을 확인하세요.",
  projectionIncomplete: "아직 준비되지 않은 에이전트가 있습니다",
  projectionIncompleteBody:
    "스킬은 저장했지만 일부 에이전트는 아직 쓸 수 없습니다. 다시 시도하세요. 계속되면 프로젝트를 다시 불러오세요.",
  retry: "다시 시도",
  operationNotApplied:
    "이전 작업이 끝나지 않았습니다. 프로젝트를 다시 불러온 다음 그 작업을 다시 하세요.",
  applyIndeterminate:
    "디스크 상태를 확인하는 중… 끝날 때까지 편집이 일시 중지됩니다.",
  skillDetailBack: "스킬 목록으로",
  editSave: "변경 저장",
  editDiscard: "변경 버리기",
  editFailed: "스킬을 저장하지 못했습니다",
  matrixTitle: "이 스킬을 쓸 수 있는 에이전트",
  discoveryChannelsHint: "저장하면 변경이 적용됩니다.",
  discoveryChannelsHintAdd: "선택한 경로는 스킬을 추가하면 적용됩니다.",
  metadataFiles_one: "파일 {{count}}개 · {{size}}",
  metadataFiles_other: "파일 {{count}}개 · {{size}}",
  riskTitle: "위험 안내",
  riskExecutables_one: "실행 파일 {{count}}개",
  riskExecutables_other: "실행 파일 {{count}}개",
  riskDynamic_one: "동적 명령 흔적 {{count}}개",
  riskDynamic_other: "동적 명령 흔적 {{count}}개",
  riskFrontmatter: "{{keys}} 선언",
  riskDisclaimer:
    "Pier는 구조만 확인합니다. 이 내용이 안전한지는 검증하지 않습니다.",
  copyPath: "라이브러리 경로 복사",
  copySuccess: "복사함",
  copyFailed: "복사하지 못했습니다",
  importSource: "출처: {{path}}",
  importReadOnlyCopy:
    "읽기 전용 복사본입니다. 원본 디렉터리는 바꾸거나 삭제하지 않습니다.",
  importExpired: "이 가져오기는 만료되었습니다. 출처를 다시 고르세요.",
  candidateExpiredBody: "돌아가 출처를 다시 골라 새 미리보기를 만드세요.",
  conflictExists:
    "id가 {{id}}인 관리 스킬이 이미 있습니다. 덮어쓰기나 이름 변경은 지원하지 않습니다.",
  conflictExistsBody:
    "스킬 목록으로 돌아가 기존 스킬을 열거나, 다른 출처를 고르세요.",
  conflictReloadBody:
    "이 작업을 연 동안 파일이 변경되었습니다. 스킬 목록을 다시 불러온 다음 작업을 다시 고르세요.",
  identityChangedBody:
    "프로젝트 목록으로 돌아가 이 프로젝트를 다시 연 다음 다시 시도하세요.",
  reloadAndReturn: "다시 불러오고 돌아가기",
  addSkillCommit: "스킬 추가",
  leaveBlocked: "아직 디스크 상태를 확인 중입니다. 잠시 후 다시 나가 보세요.",
  confirmDeleteAction: "삭제",
  launchCancelledPanel:
    "시작을 취소했습니다. 이 프로젝트의 스킬이 아직 준비되지 않았습니다. 스킬 설정을 연 다음 새 터미널을 시작하세요.",
  sourceTemplate: "이 Mac에서 추가",
  blankDefaultDescription: "에이전트가 이 스킬을 써야 하는 때를 적어 주세요.",
  discoveryChannelSummary_one: "에이전트 {{count}}개 · {{path}}",
  discoveryChannelSummary_other: "에이전트 {{count}}개 · {{path}}",
  discoveryChannelSummaryNoPath_one: "에이전트 {{count}}개",
  discoveryChannelSummaryNoPath_other: "에이전트 {{count}}개",
  effectSummaryNone: "에이전트가 쓸 수 없음",
  openProjectMissing: "프로젝트 스킬을 열지 못했습니다",
  importFailedBody: "스킬 출처를 다시 고른 뒤 다시 시도하세요.",
  loadFailedBody: "프로젝트를 다시 불러오거나 프로젝트 목록으로 돌아가세요.",
} as const;
