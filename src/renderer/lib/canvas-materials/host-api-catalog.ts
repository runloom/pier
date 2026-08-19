import { canvasHostExemplarCommandType } from "@shared/contracts/canvas-host.ts";
import {
  canvasHostApiDomains,
  type HostApiCommand,
  type HostApiDomain,
  type HostApiEvent,
} from "@/lib/canvas-host/domains.ts";
import type {
  CanvasMaterialCatalogEntry,
  CanvasMaterialNestedType,
  CanvasMaterialProp,
  CanvasSystemMaterial,
} from "./types.ts";

const COMMAND_PROP: Pick<CanvasMaterialProp, "descriptionKey"> = {
  descriptionKey: "settings.materials.prop.hostCommand",
};

const EVENT_PROP: Pick<CanvasMaterialProp, "descriptionKey"> = {
  descriptionKey: "settings.materials.prop.hostEvent",
};

const SNAPSHOT_PROP: Pick<CanvasMaterialProp, "descriptionKey"> = {
  descriptionKey: "settings.materials.prop.hostSnapshot",
};

function requestType(command: HostApiCommand): string {
  if (command.fields.length === 0) {
    return `{ type: ${JSON.stringify(command.type)} }`;
  }
  const body = command.fields
    .map((field) => `${field.name}: ${field.type}`)
    .join("; ");
  return `{ type: ${JSON.stringify(command.type)}; ${body} }`;
}

function commandUnion(domain: HostApiDomain): string {
  const name = `${pascalDomain(domain.id)}Command`;
  if (domain.commands.length === 0) {
    return `type ${name} = never`;
  }
  const lines = domain.commands.map(
    (command) => `  | ${JSON.stringify(command.type)}`
  );
  return [`type ${name} =`, ...lines].join("\n");
}

function pascalDomain(id: string): string {
  return id
    .split(/[-.]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function commandProps(domain: HostApiDomain): CanvasMaterialProp[] {
  return domain.commands.map((command) => ({
    ...COMMAND_PROP,
    name: command.type,
    type: requestType(command),
  }));
}

function eventProps(domain: HostApiDomain): CanvasMaterialProp[] {
  return domain.events.map((event) => ({
    ...(event.kind === "snapshot" ? SNAPSHOT_PROP : EVENT_PROP),
    name: event.channel,
    type: event.kind,
  }));
}

function eventNestedType(event: HostApiEvent): CanvasMaterialNestedType {
  if (event.kind === "snapshot") {
    return {
      name: event.channel,
      props: [
        {
          ...SNAPSHOT_PROP,
          name: "id",
          type: JSON.stringify(event.channel),
        },
      ],
      signature: `host.snapshot(${JSON.stringify(event.channel)})`,
    };
  }
  return {
    name: event.channel,
    props: [
      {
        ...EVENT_PROP,
        name: "channel",
        type: JSON.stringify(event.channel),
      },
    ],
    signature: `host.subscribe(${JSON.stringify(event.channel)}, listener)`,
  };
}

function signatureFor(domain: HostApiDomain): string {
  const commandName = `${pascalDomain(domain.id)}Command`;
  const lines: string[] = [];
  if (domain.commands.length > 0) {
    lines.push(`host.invoke(command: ${commandName}): Promise<unknown>`);
  }
  if (domain.events.some((event) => event.kind === "broadcast")) {
    lines.push("host.subscribe(channel, listener)");
  }
  if (domain.events.some((event) => event.kind === "snapshot")) {
    lines.push(`host.snapshot(${JSON.stringify(domain.id)})`);
    lines.push(`useHostSnapshot(${JSON.stringify(domain.id)})`);
  }
  return lines.join("\n");
}

function usageFor(domain: HostApiDomain): string {
  const exemplar = canvasHostExemplarCommandType(
    domain.id,
    domain.commands.map((command) => command.type)
  );
  const command =
    domain.commands.find((item) => item.type === exemplar) ??
    domain.commands[0];
  if (command) {
    const extras = command.fields
      .filter((field) => !field.optional)
      .map((field) => `  ${field.name}: …,`);
    if (extras.length === 0) {
      return `host.invoke({ type: ${JSON.stringify(command.type)} })`;
    }
    return [
      "host.invoke({",
      `  type: ${JSON.stringify(command.type)},`,
      ...extras,
      "})",
    ].join("\n");
  }
  if (domain.events.some((event) => event.kind === "snapshot")) {
    return `const snapshot = useHostSnapshot(${JSON.stringify(domain.id)})`;
  }
  const broadcast = domain.events.find((event) => event.kind === "broadcast");
  if (broadcast) {
    return `host.subscribe(${JSON.stringify(broadcast.channel)}, listener)`;
  }
  return `host.invoke({ type: ${JSON.stringify(`${domain.id}.*`)} })`;
}

function hostImportLine(usage: string): string {
  const names: string[] = [];
  if (/\bhost\./.test(usage)) {
    names.push("host");
  }
  if (usage.includes("useHostSnapshot")) {
    names.push("useHostSnapshot");
  }
  if (names.length === 0) {
    names.push("host");
  }
  return `import { ${names.join(", ")} } from "pier/host"`;
}

function catalogFromDomain(domain: HostApiDomain): CanvasMaterialCatalogEntry {
  const commandRows = commandProps(domain);
  const eventRows = eventProps(domain);
  return {
    nestedTypes: domain.events.map(eventNestedType),
    parameters: [],
    props: commandRows.length > 0 ? commandRows : eventRows,
    returnsSignature: commandUnion(domain),
    signature: signatureFor(domain),
    usage: usageFor(domain),
  };
}

export function hostApiSystemMaterials(): CanvasSystemMaterial[] {
  return canvasHostApiDomains().map((domain) => {
    const catalog = catalogFromDomain(domain);
    return {
      commandCount: domain.commands.length,
      eventCount: domain.events.length,
      exportName: domain.id,
      family: "data",
      id: domain.id,
      importLine: hostImportLine(catalog.usage),
      memberExports: [
        ...domain.commands.map((command) => command.type),
        ...domain.events.map((event) => event.channel),
      ],
      nestedTypes: catalog.nestedTypes ?? [],
      parameters: catalog.parameters ?? [],
      props: catalog.props,
      returnsSignature: catalog.returnsSignature ?? "",
      signature: catalog.signature ?? "",
      surface: "host-api",
      usage: catalog.usage,
    };
  });
}

export function hostApiDomainIds(): string[] {
  return canvasHostApiDomains().map((domain) => domain.id);
}
