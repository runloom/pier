import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ResolvedTerminalLaunchOptions,
  resolvedTerminalLaunchOptionsSchema,
} from "@shared/contracts/terminal-launch.ts";
import { app } from "electron";
import { z } from "zod";

const terminalProfilesStateSchema = z
  .object({
    profiles: z
      .record(z.string().min(1), resolvedTerminalLaunchOptionsSchema)
      .default({}),
  })
  .default({ profiles: {} });

export interface TerminalProfilesState {
  profiles: Record<string, ResolvedTerminalLaunchOptions>;
}

function resolveFilePath(): string {
  return join(app.getPath("userData"), "terminal-profiles.json");
}

export async function readTerminalProfiles(
  filePath = resolveFilePath()
): Promise<TerminalProfilesState> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    return terminalProfilesStateSchema.parse(raw);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return { profiles: {} };
    }
    console.warn("[terminal-profiles] parse failed, ignoring profiles:", err);
    return { profiles: {} };
  }
}

export async function readTerminalProfile(
  profileId: string,
  filePath = resolveFilePath()
): Promise<ResolvedTerminalLaunchOptions | null> {
  const state = await readTerminalProfiles(filePath);
  return state.profiles[profileId] ?? null;
}

export async function writeTerminalProfiles(
  state: TerminalProfilesState,
  filePath = resolveFilePath()
): Promise<TerminalProfilesState> {
  const parsed = terminalProfilesStateSchema.parse(state);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export async function upsertTerminalProfile(
  profileId: string,
  profile: ResolvedTerminalLaunchOptions,
  filePath = resolveFilePath()
): Promise<ResolvedTerminalLaunchOptions> {
  const state = await readTerminalProfiles(filePath);
  const parsedProfile = resolvedTerminalLaunchOptionsSchema.parse(profile);
  await writeTerminalProfiles(
    {
      profiles: {
        ...state.profiles,
        [profileId]: parsedProfile,
      },
    },
    filePath
  );
  return parsedProfile;
}

export async function deleteTerminalProfile(
  profileId: string,
  filePath = resolveFilePath()
): Promise<boolean> {
  const state = await readTerminalProfiles(filePath);
  if (!(profileId in state.profiles)) {
    return false;
  }
  const { [profileId]: _removed, ...profiles } = state.profiles;
  await writeTerminalProfiles({ profiles }, filePath);
  return true;
}
