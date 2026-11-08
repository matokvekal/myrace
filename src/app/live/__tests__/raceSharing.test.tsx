import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** 0.3.2 race sharing: Invite Judges (working access) vs Share public Board/Results (read-only). */
const s = vi.hoisted(() => ({
  isOwner: true,
  linked: true,
  invite: vi.fn(async () => ({ invitations: [{ id: "inv1", email: null, userId: null, link: true, url: "https://commissaire.us/invite/SECRET", qrSvg: "" }] })),
  setMemberWrites: vi.fn(async () => undefined),
  members: vi.fn(async () => ({ members: [
    { userId: "o", name: "Owner", email: null, roles: [], permissions: {}, isOwner: true, revokedAt: null },
    { userId: "j1", name: "Judge One", email: "j1@x.test", roles: ["counter"], permissions: {}, isOwner: false, revokedAt: null },
  ] })),
  removeMember: vi.fn(async () => undefined),
  revokeInvitation: vi.fn(async () => undefined),
  shareLink: vi.fn(async () => ({ token: "TOK", url: "https://commissaire.us/share/TOK", published: true })),
}));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (st: unknown) => unknown) => sel({ access: { r1: { isOwner: s.isOwner } } }),
  team: { invite: s.invite, setMemberWrites: s.setMemberWrites, members: s.members, removeMember: s.removeMember, revokeInvitation: s.revokeInvitation },
  shareLink: s.shareLink,
  setRacePublished: vi.fn(),
}));
vi.mock("@/services/live/liveBridge", async (orig) => ({
  ...(await orig<typeof import("@/services/live/liveBridge")>()),
  isLiveRace: () => s.linked,
}));
vi.mock("../RaceServerAction", () => ({ UploadPrompt: () => <p data-testid="upload-prompt">upload</p> }));

import InviteJudges, { JUDGE_ROLES } from "../InviteJudges";
import PublicShareButton from "../PublicShareButton";

beforeEach(() => {
  s.isOwner = true;
  s.linked = true;
  vi.clearAllMocks();
});

describe("Invite Judges", () => {
  it("only the owner of a shared race sees it", () => {
    s.isOwner = false;
    render(<InviteJudges raceUuid="r1" raceName="Race" />);
    expect(screen.queryByTestId("invite-judges-btn")).toBeNull();
  });

  it("creates a revocable link with the operational roles only, and lets judges record in THIS race", async () => {
    render(<InviteJudges raceUuid="r1" raceName="Race" />);
    await userEvent.click(screen.getByTestId("invite-judges-btn"));
    await userEvent.click(await screen.findByTestId("judge-link-create"));
    await waitFor(() => expect((screen.getByTestId("judge-link-url") as HTMLInputElement).value).toContain("/invite/SECRET"));
    expect(s.invite).toHaveBeenCalledWith("r1", expect.objectContaining({ link: true, roles: ["start", "counter", "checkin"], sendEmail: false }));
    expect(JUDGE_ROLES).not.toContain("admin");
    expect(s.setMemberWrites).toHaveBeenCalledWith("r1", true);
    await userEvent.click(screen.getByTestId("judge-link-stop"));
    expect(s.revokeInvitation).toHaveBeenCalledWith("r1", "inv1");
  });

  it("lists judges (not the owner) and the owner can remove one", async () => {
    render(<InviteJudges raceUuid="r1" raceName="Race" />);
    await userEvent.click(screen.getByTestId("invite-judges-btn"));
    expect((await screen.findByTestId("judge-list")).textContent).toContain("Judge One");
    expect(screen.getByTestId("judge-list").textContent).not.toContain("Owner");
    await userEvent.click(screen.getByTestId("judge-remove"));
    expect(s.removeMember).toHaveBeenCalledWith("r1", "j1");
  });

  it("a local race asks to upload first", async () => {
    s.linked = false;
    render(<InviteJudges raceUuid="r1" raceName="Race" />);
    await userEvent.click(screen.getByTestId("invite-judges-btn"));
    expect(screen.getByTestId("upload-prompt")).toBeTruthy();
    expect(s.invite).not.toHaveBeenCalled();
  });
});

describe("Share public Board / Results", () => {
  it("owner: the public link opens the shared screen", async () => {
    render(<PublicShareButton raceUuid="r1" raceName="Race" screen="results" />);
    await userEvent.click(screen.getByTestId("public-share-results"));
    await waitFor(() => expect((screen.getByTestId("race-share-url") as HTMLInputElement).value).toBe("https://commissaire.us/share/TOK?tab=results"));
  });

  it("owner: the Board's public link opens the spectator page on RACE (0.3.4)", async () => {
    render(<PublicShareButton raceUuid="r1" raceName="Race" screen="board" />);
    await userEvent.click(screen.getByTestId("public-share-board"));
    await waitFor(() => expect((screen.getByTestId("race-share-url") as HTMLInputElement).value).toBe("https://commissaire.us/share/TOK?tab=race"));
  });

  it("a judge can't publish: told to ask the organizer, no share API call", async () => {
    s.isOwner = false;
    render(<PublicShareButton raceUuid="r1" raceName="Race" screen="board" />);
    await userEvent.click(screen.getByTestId("public-share-board"));
    expect(screen.getByTestId("public-share-ask-owner")).toBeTruthy();
    expect(s.shareLink).not.toHaveBeenCalled();
  });
});
