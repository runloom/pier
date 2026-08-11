const ALLOWED_PIER_OWNERSHIP = new Set([
  "agent-caller-identity",
  "one-shot-agent-invocation",
  "bounded-agent-screen",
  "agent-runtime-observation",
  "terminal-control",
  "panel-focus",
  "worktree-guard",
  "shell-task-runs",
  "attention-routing",
  "local-control-transport",
  "local-control-authorization",
]);

const ALLOWED_OWNERSHIP_LAYERS = new Set([
  "调用方编排语义",
  "智能体调用身份",
  "一次性智能体调用",
  "本机控制传输",
  "本机控制授权",
  "终端运行控制",
  "窗口与面板",
  "运行事实",
  "工作树",
  "shell 执行",
  "注意力与界面",
]);

const ALLOWED_ENTITY_NAMES = new Set([
  "AgentCallerCredential",
  "InvocationReply",
  "AccessGrantRef",
  "CapabilityRef",
  "AgentRef",
  "WindowRef",
  "PanelRef",
  "RuntimeRef",
  "ProviderSessionRef",
  "ForegroundActivitySnapshot",
  "AgentRuntimeIndexEntry",
  "WorktreeRef",
  "TaskRunRef",
  "NotificationRef",
]);

const ALLOWED_STATE_MACHINE_ENTITIES = new Set([
  "调用方任务（非 Pier）",
  "Agent caller credential",
  "Agent invocation（一次性）",
  "Access connection",
  "Access request",
  "Access grant",
  "Agent activity projection",
  "Terminal runtime",
  "Window surface",
  "Panel surface",
  "Worktree",
  "TaskRun（shell）",
  "Notification",
]);

/**
 * English multi-agent product-boundary tokens:
 * - PascalCase `MultiAgent` / `MultiAgentRun` / … (`(?![a-z])` keeps CamelCase types)
 * - lowercase only as orchestration compounds with an explicit separator
 *   (`multi-agent run`, `multi-agent-task`, …)
 * Bare nicknames / canvas paths stay clean: `multi-agent gold`,
 * `multi-agent-orchestration-gold` (`gold` / `orchestration` are not domain
 * suffixes). Separate tokens still cover task-orchestration / orchestration-ledger.
 */
const FORBIDDEN_MULTI_AGENT_EN =
  String.raw`MultiAgent(?![a-z])|multi-agent(?:[-_]+|\s+)(?:task|run|schedul|ledger|board|dag|lifecycle|work-?item)`;

const FORBIDDEN_OWNERSHIP_CLAIM = new RegExp(
  `${FORBIDDEN_MULTI_AGENT_EN}|task-ledger|task-lifecycle|task-dag|task-board|task-orchestration|task-scheduler|orchestration-ledger|orchestration-database|completion-authority|auto-schedul|WorkItem|Attempt|Gate|Result|多智能体任务|任务生命周期|任务状态机|任务台账|任务队列|任务调度|目标分解|重试状态|工作看板|工作 DAG|编排数据库|编排账本|审批中心|自动调度|完成权`,
  "u",
);

const FORBIDDEN_DOMAIN = new RegExp(
  `${FORBIDDEN_MULTI_AGENT_EN}|task-ledger|task-lifecycle|task-dag|task-board|task-orchestration|task-scheduler|orchestration-ledger|orchestration-database|completion-authority|auto-schedul|kanban|WorkItem|Attempt|Gate|Delivery|Result|多智能体任务(?:生命周期|台账|工作项)?|任务生命周期|任务状态机|任务台账|任务队列|任务调度|目标分解|任务依赖|重试状态|工作看板|工作 DAG|编排数据库|编排账本|审批中心|自动调度|完成权`,
  "gu",
);

const PIER_SUBJECT_ALIAS_SOURCE = String.raw`(?:Pier|宿主|本产品)`;
const PIER_SUBJECT_ALIAS = new RegExp(PIER_SUBJECT_ALIAS_SOURCE, "u");
const EXTERNALIZED_PIER_SUBJECT_ALIAS = new RegExp(
  String.raw`非\s*${PIER_SUBJECT_ALIAS_SOURCE}|Pier\s*(?:进程|宿主|产品)?\s*之外|(?:宿主|本产品)(?:\s*进程)?\s*之外`,
  "gu",
);
const REVERSED_PIER_EXCLUSION = new RegExp(
  String.raw`^(?:[^\s，,;；。]{0,10})(?:为\s*0|等于\s*0|分离|与\s*${PIER_SUBJECT_ALIAS_SOURCE}\s*分层|留在外部|归外部|不由\s*${PIER_SUBJECT_ALIAS_SOURCE}|不归\s*${PIER_SUBJECT_ALIAS_SOURCE}|不属于\s*${PIER_SUBJECT_ALIAS_SOURCE})`,
  "u",
);

const CLAIM_BOUNDARY =
  /[。；;\n]|[，,](?=\s*(?:但|但是|然而|却|而是|不过))|并(?:且)?/u;
const NEGATION_TOKEN = /没有|不能|不会|不得|禁止|拒绝|避免|防止|不(?!仅|只|止|但|得不|能不|是不)|未|无/gu;
const NEGATION_REVERSAL = /不仅|不只|不止|不但|不得不|不能不|不是不|并非不/u;
const MAX_NEGATION_DISTANCE = 18;

function isExplicitlyExcluded(clause: string, domainIndex: number, domainLength: number): boolean {
  const before = clause.slice(Math.max(0, domainIndex - 36), domainIndex);
  const localBefore = before.slice(Math.max(before.lastIndexOf("，"), before.lastIndexOf(",")) + 1);
  const after = clause.slice(domainIndex + domainLength, domainIndex + domainLength + 18);
  const nearby = `${localBefore}${after}`;
  if (NEGATION_REVERSAL.test(nearby)) {
    return false;
  }

  const tokens = [...localBefore.matchAll(NEGATION_TOKEN)];
  const lastToken = tokens.at(-1);
  if (lastToken?.index !== undefined) {
    const distance = localBefore.length - (lastToken.index + lastToken[0].length);
    if (distance <= MAX_NEGATION_DISTANCE) {
      return true;
    }
  }

  return REVERSED_PIER_EXCLUSION.test(after);
}

function hasAffirmativeForbiddenClaim(value: string): boolean {
  const clauses = value.split(CLAIM_BOUNDARY);
  for (const clause of clauses) {
    const domains = [...clause.matchAll(FORBIDDEN_DOMAIN)];
    let excludedList = false;
    let previousDomainEnd = 0;
    for (const domain of domains) {
      const domainIndex = domain.index ?? 0;
      if (isExplicitlyExcluded(clause, domainIndex, domain[0].length)) {
        excludedList = true;
        previousDomainEnd = domainIndex + domain[0].length;
        continue;
      }
      const betweenDomains = clause.slice(previousDomainEnd, domainIndex);
      if (excludedList && !PIER_SUBJECT_ALIAS.test(betweenDomains)) {
        previousDomainEnd = domainIndex + domain[0].length;
        continue;
      }
      return true;
    }
  }
  return false;
}

function hasAffirmativePierClaimInExternalContext(value: string): boolean {
  const clauses = value.split(CLAIM_BOUNDARY);
  for (const rawClause of clauses) {
    const clause = rawClause.replace(EXTERNALIZED_PIER_SUBJECT_ALIAS, "");
    if (!PIER_SUBJECT_ALIAS.test(clause)) {
      continue;
    }
    const domains = [...clause.matchAll(FORBIDDEN_DOMAIN)];
    for (const domain of domains) {
      const domainIndex = domain.index ?? 0;
      if (!isExplicitlyExcluded(clause, domainIndex, domain[0].length)) {
        return true;
      }
    }
  }
  return false;
}

export type PierScopeContract = {
  pierOwns: string[];
};

export type PierArchitectureContract = {
  ownershipLayers: string[];
  ownershipClaims: string[];
  entityNames: string[];
  stateMachineEntities: string[];
  supportingClaims: {
    ordinary: string[];
    externalResearch: string[];
    externalOwnership: string[];
    explicitNonGoals: string[];
    antiPatterns: string[];
  };
};

export function validatePierArchitectureContract(input: PierArchitectureContract) {
  const unexpectedOwnershipLayers = input.ownershipLayers.filter(
    (item) => !ALLOWED_OWNERSHIP_LAYERS.has(item),
  );
  const forbiddenOwnershipClaims = input.ownershipClaims.filter((item) =>
    FORBIDDEN_OWNERSHIP_CLAIM.test(item),
  );
  const unexpectedEntities = input.entityNames.filter((item) => !ALLOWED_ENTITY_NAMES.has(item));
  const unexpectedStateMachines = input.stateMachineEntities.filter(
    (item) => !ALLOWED_STATE_MACHINE_ENTITIES.has(item),
  );
  const forbiddenSupportingClaims = [
    ...input.supportingClaims.ordinary.filter(hasAffirmativeForbiddenClaim),
    ...input.supportingClaims.externalResearch.filter(hasAffirmativePierClaimInExternalContext),
    ...input.supportingClaims.externalOwnership.filter(
      hasAffirmativePierClaimInExternalContext,
    ),
  ];
  return {
    valid:
      unexpectedOwnershipLayers.length === 0 &&
      forbiddenOwnershipClaims.length === 0 &&
      unexpectedEntities.length === 0 &&
      unexpectedStateMachines.length === 0 &&
      forbiddenSupportingClaims.length === 0,
    unexpectedOwnershipLayers,
    forbiddenOwnershipClaims,
    unexpectedEntities,
    unexpectedStateMachines,
    forbiddenSupportingClaims,
  };
}

export function validatePierScopeContract(input: PierScopeContract) {
  const forbiddenPierOwnership = [
    ...new Set(input.pierOwns.filter((item) => !ALLOWED_PIER_OWNERSHIP.has(item))),
  ];
  return {
    valid: forbiddenPierOwnership.length === 0,
    forbiddenPierOwnership,
  };
}
