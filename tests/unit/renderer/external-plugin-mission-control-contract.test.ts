import type {
  MissionControlWidgetComponentProps as ExternalMissionControlWidgetComponentProps,
  MissionControlWidgetSettingsProps as ExternalMissionControlWidgetSettingsProps,
} from "@pier/plugin-api/renderer";
import type {
  MissionControlWidgetComponentProps as HostMissionControlWidgetComponentProps,
  MissionControlWidgetSettingsProps as HostMissionControlWidgetSettingsProps,
} from "@plugins/api/renderer.ts";
import { describe, expectTypeOf, it } from "vitest";

describe("external plugin Mission Control contract", () => {
  it("keeps public widget component props aligned with the host contract", () => {
    expectTypeOf<ExternalMissionControlWidgetComponentProps>().toEqualTypeOf<HostMissionControlWidgetComponentProps>();
    const externalProps =
      null as unknown as ExternalMissionControlWidgetComponentProps;
    const hostProps = null as unknown as HostMissionControlWidgetComponentProps;
    const acceptsExternal = (
      _props: ExternalMissionControlWidgetComponentProps
    ) => undefined;
    const acceptsHost = (_props: HostMissionControlWidgetComponentProps) =>
      undefined;

    acceptsExternal(hostProps);
    acceptsHost(externalProps);
  });

  it("keeps public widget settings props aligned with the host contract", () => {
    expectTypeOf<ExternalMissionControlWidgetSettingsProps>().toEqualTypeOf<HostMissionControlWidgetSettingsProps>();
    const externalProps =
      null as unknown as ExternalMissionControlWidgetSettingsProps;
    const hostProps = null as unknown as HostMissionControlWidgetSettingsProps;
    const acceptsExternal = (
      _props: ExternalMissionControlWidgetSettingsProps
    ) => undefined;
    const acceptsHost = (_props: HostMissionControlWidgetSettingsProps) =>
      undefined;

    acceptsExternal(hostProps);
    acceptsHost(externalProps);
  });
});
