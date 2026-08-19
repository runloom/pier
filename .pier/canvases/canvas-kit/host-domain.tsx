import { Stack, Text } from "pier/canvas";
import { host } from "pier/host";
import { DocCode, DocSection, FieldTable } from "./host-docs.tsx";

type InspectDomain = ReturnType<typeof host.inspect>["domains"][number];
type InspectCommand = InspectDomain["commands"][number];

function isRequiredField(field: InspectCommand["fields"][number]): boolean {
  return !field.optional;
}

function invokeUsage(command: InspectCommand): string {
  const required = command.fields.filter(isRequiredField);
  if (required.length === 0) {
    return `await host.invoke({ type: ${JSON.stringify(command.type)} })`;
  }
  return [
    "await host.invoke({",
    `  type: ${JSON.stringify(command.type)},`,
    ...required.map((field) => `  ${field.name}: …,`),
    "})",
  ].join("\n");
}

function payloadType(command: InspectCommand): string {
  if (command.fields.length === 0) {
    return `{ type: ${JSON.stringify(command.type)} }`;
  }
  const body = command.fields
    .map((field) => `${field.name}: ${field.type}`)
    .join("; ");
  return `{ type: ${JSON.stringify(command.type)}; ${body} }`;
}

function domainImport(domain: InspectDomain): string {
  if (domain.snapshots.length > 0) {
    return 'import { host, useHostSnapshot } from "pier/host"';
  }
  return 'import { host } from "pier/host"';
}

function domainCommand(domain: InspectDomain): InspectCommand | undefined {
  if (domain.exemplar) {
    const found = domain.commands.find(
      (command) => command.type === domain.exemplar
    );
    if (found) {
      return found;
    }
  }
  return domain.commands[0];
}

function domainUsage(domain: InspectDomain): string {
  const lines: string[] = [];
  const command = domainCommand(domain);
  if (command) {
    lines.push(invokeUsage(command));
  }
  const snapshot = domain.snapshots[0];
  if (snapshot) {
    lines.push(`const state = useHostSnapshot(${JSON.stringify(snapshot)})`);
    lines.push("if (state.status !== \"ready\") {");
    lines.push("  return");
    lines.push("}");
  }
  const channel = domain.channels[0];
  if (channel) {
    lines.push(
      `const stop = host.subscribe(${JSON.stringify(channel)}, listener)`
    );
    lines.push("return stop");
  }
  return lines.join("\n");
}

function domainSignature(domain: InspectDomain): string {
  const lines: string[] = [];
  if (domain.commands.length > 0) {
    lines.push("host.invoke(command: CanvasHostCommand): Promise<unknown>");
  }
  if (domain.snapshots.length > 0) {
    lines.push(
      "function useHostSnapshot(target: CanvasHostWatchTarget): HostSnapshotState"
    );
    lines.push("host.snapshot(id: CanvasHostSnapshotId): Promise<unknown>");
  }
  if (domain.channels.length > 0) {
    lines.push(
      "host.subscribe(channel: CanvasHostChannel, listener: (payload: unknown) => void): () => void"
    );
  }
  return lines.join("\n");
}

export function HostDomainDocs({ domain }: { domain: InspectDomain }) {
  const usage = domainUsage(domain);
  const signature = domainSignature(domain);
  return (
    <Stack gap={16}>
      {signature ? (
        <DocSection title="签名">
          <DocCode>{signature}</DocCode>
        </DocSection>
      ) : null}
      <DocSection title="安装">
        <DocCode>{domainImport(domain)}</DocCode>
      </DocSection>
      {usage ? (
        <DocSection title="用法">
          <DocCode>{usage}</DocCode>
        </DocSection>
      ) : null}
      {domain.commands.length > 0 ? (
        <DocSection title="命令">
          <Text className="text-sm leading-relaxed">
            `command.type` 必须是下列允许值。其余字段随 type 变化。
          </Text>
          <FieldTable
            rows={domain.commands.map((command) => ({
              name: command.type,
              type: payloadType(command),
            }))}
          />
        </DocSection>
      ) : null}
      {domain.snapshots.length > 0 ? (
        <DocSection title="快照">
          <Text className="text-sm leading-relaxed">
            payload 是 `unknown`。用 `useHostSnapshot` 或 `host.snapshot`。
          </Text>
          <FieldTable
            rows={domain.snapshots.map((id) => ({
              name: id,
              type: "CanvasHostSnapshotId",
            }))}
          />
        </DocSection>
      ) : null}
      {domain.channels.length > 0 ? (
        <DocSection title="广播">
          <Text className="text-sm leading-relaxed">
            `host.subscribe(channel, listener)` 返回取消函数。
          </Text>
          <FieldTable
            rows={domain.channels.map((channel) => ({
              name: channel,
              type: "CanvasHostChannel",
            }))}
          />
        </DocSection>
      ) : null}
    </Stack>
  );
}
