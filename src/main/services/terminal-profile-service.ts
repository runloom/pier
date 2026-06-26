import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";
import {
  deleteTerminalProfile,
  readTerminalProfile,
  readTerminalProfiles,
  upsertTerminalProfile,
} from "../state/terminal-profile-state.ts";

export interface TerminalProfileService {
  delete(profileId: string): Promise<boolean>;
  list(): Promise<Record<string, ResolvedTerminalLaunchOptions>>;
  read(profileId: string): Promise<ResolvedTerminalLaunchOptions | null>;
  resolve(profileId: string): Promise<ResolvedTerminalLaunchOptions | null>;
  upsert(
    profileId: string,
    profile: ResolvedTerminalLaunchOptions
  ): Promise<ResolvedTerminalLaunchOptions>;
}

export interface CreateTerminalProfileServiceArgs {
  deleteProfile?: (profileId: string) => Promise<boolean>;
  readProfile?: (
    profileId: string
  ) => Promise<ResolvedTerminalLaunchOptions | null>;
  readProfiles?: () => Promise<{
    profiles: Record<string, ResolvedTerminalLaunchOptions>;
  }>;
  upsertProfile?: (
    profileId: string,
    profile: ResolvedTerminalLaunchOptions
  ) => Promise<ResolvedTerminalLaunchOptions>;
}

export function createTerminalProfileService({
  deleteProfile = deleteTerminalProfile,
  readProfile = readTerminalProfile,
  readProfiles = readTerminalProfiles,
  upsertProfile = upsertTerminalProfile,
}: CreateTerminalProfileServiceArgs = {}): TerminalProfileService {
  return {
    delete: (profileId) => deleteProfile(profileId),
    async list() {
      const state = await readProfiles();
      return {
        default: state.profiles.default ?? {},
        ...state.profiles,
      };
    },
    read(profileId) {
      if (profileId === "default") {
        return readProfile(profileId).then((profile) => profile ?? {});
      }
      return readProfile(profileId);
    },
    resolve(profileId) {
      if (profileId === "default") {
        return readProfile(profileId).then((profile) => profile ?? {});
      }
      return readProfile(profileId);
    },
    upsert: (profileId, profile) => upsertProfile(profileId, profile),
  };
}
