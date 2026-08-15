import {
  CATALOG_DOMAIN_TTL,
  countFreshUpdateOffers,
  shouldSkipCatalogClass,
} from "@shared/contracts/host-catalog/freshness.ts";
import { describe, expect, it } from "vitest";

const NOW = 1_000_000;
const TEN_MIN = 10 * 60 * 1000;

const agentPolicy = CATALOG_DOMAIN_TTL["agent-cli"];

describe("shouldSkipCatalogClass", () => {
  it("never skips when force is true", () => {
    expect(
      shouldSkipCatalogClass({
        class: "local",
        force: true,
        now: NOW,
        policy: agentPolicy,
        state: {
          fingerprint: "a",
          hasItems: true,
          localProbedAt: NOW,
          remoteCheckedAt: NOW,
        },
      })
    ).toBe(false);
  });

  it("does not skip local when nothing has been probed yet", () => {
    expect(
      shouldSkipCatalogClass({
        class: "local",
        now: NOW,
        policy: agentPolicy,
        state: {
          fingerprint: null,
          hasItems: false,
          localProbedAt: null,
          remoteCheckedAt: null,
        },
      })
    ).toBe(false);
  });

  it("skips local when probed within TTL and fingerprint is unchanged", () => {
    expect(
      shouldSkipCatalogClass({
        class: "local",
        currentFingerprint: "path-a",
        now: NOW,
        policy: agentPolicy,
        state: {
          fingerprint: "path-a",
          hasItems: true,
          localProbedAt: NOW - TEN_MIN + 1,
          remoteCheckedAt: null,
        },
      })
    ).toBe(true);
  });

  it("does not skip local when PATH fingerprint changed", () => {
    expect(
      shouldSkipCatalogClass({
        class: "local",
        currentFingerprint: "path-b",
        now: NOW,
        policy: agentPolicy,
        state: {
          fingerprint: "path-a",
          hasItems: true,
          localProbedAt: NOW,
          remoteCheckedAt: NOW,
        },
      })
    ).toBe(false);
  });

  it("skips remote when remoteCheckedAt is fresh even if fingerprint changed", () => {
    expect(
      shouldSkipCatalogClass({
        class: "remote",
        currentFingerprint: "path-b",
        now: NOW,
        policy: agentPolicy,
        state: {
          fingerprint: "path-a",
          hasItems: true,
          localProbedAt: NOW,
          remoteCheckedAt: NOW - 1000,
        },
      })
    ).toBe(true);
  });

  it("does not skip remote when last check is older than TTL", () => {
    expect(
      shouldSkipCatalogClass({
        class: "remote",
        now: NOW,
        policy: agentPolicy,
        state: {
          fingerprint: "path-a",
          hasItems: true,
          localProbedAt: NOW,
          remoteCheckedAt: NOW - TEN_MIN - 1,
        },
      })
    ).toBe(false);
  });
});

describe("countFreshUpdateOffers", () => {
  it("counts updateOffered only while remote class is fresh", () => {
    expect(
      countFreshUpdateOffers({
        items: [{ updateOffered: true }, { updateOffered: true }],
        now: NOW,
        policy: agentPolicy,
        remoteCheckedAt: NOW - 1000,
      })
    ).toBe(2);
  });

  it("returns 0 when remote freshness has expired", () => {
    expect(
      countFreshUpdateOffers({
        items: [{ updateOffered: true }],
        now: NOW,
        policy: agentPolicy,
        remoteCheckedAt: NOW - TEN_MIN - 1,
      })
    ).toBe(0);
  });
});
