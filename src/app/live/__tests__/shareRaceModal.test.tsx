import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

type State = {
  user: null | { id: string };
  publishErrors: Record<string, string>;
  access: Record<string, { isOwner: boolean }>;
  sync: Record<string, { pending: number }>;
  socketConnected: boolean;
  online: boolean;
};
const live = vi.hoisted(() => ({
  state: {} as State,
  linked: new Set<string>(),
  saveRaceToServer: vi.fn(),
  shareLink: vi.fn(),
  setRacePublished: vi.fn(),
}));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (s: State) => unknown) => sel(live.state),
  isPendingPublish: () => false,
  saveRaceToServer: (id: string) => live.saveRaceToServer(id),
  shareLink: (id: string) => live.shareLink(id),
  setRacePublished: (id: string, p: boolean) => live.setRacePublished(id, p),
  openLiveRace: async () => {},
}));
vi.mock("@/services/live/liveBridge", () => ({
  isLiveRace: (id: string) => live.linked.has(id),
  LIVE_ACCESS_EVENT: "commissaire-live-access",
}));

import ShareRace from "../ShareRace";

const RACE = "race-1";
const URL1 = "https://commissaire.us/share/tok";
const open = async () => {
  render(
    <MemoryRouter>
      <ShareRace raceUuid={RACE} raceName="Test" />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByTestId("share-race-btn"));
};

beforeEach(() => {
  live.state = { user: { id: "u1" }, publishErrors: {}, access: {}, sync: {}, socketConnected: true, online: true };
  live.linked.clear();
  live.saveRaceToServer.mockReset();
  live.shareLink.mockReset();
  live.setRacePublished.mockReset();
});

describe("Share Race modal", () => {
  it("local race: no share API call, 'Race not uploaded yet' with Upload", async () => {
    await open();
    const modal = screen.getByTestId("share-race-modal");
    expect(modal).toHaveTextContent("Race not uploaded yet");
    expect(modal).toHaveTextContent("To share this race with others, you first need to upload it to the server.");
    expect(modal).not.toHaveTextContent("Not found");
    expect(screen.getByTestId("race-upload-btn")).toHaveTextContent("Upload Race to Server");
    expect(live.shareLink).not.toHaveBeenCalled();
  });

  it("upload in the modal → the link loads in place; publish and copy without reopening", async () => {
    live.saveRaceToServer.mockImplementation(async () => {
      live.linked.add(RACE);
      live.state.access = { [RACE]: { isOwner: true } };
      return "srv-1";
    });
    live.shareLink.mockResolvedValue({ url: URL1, published: false });
    live.setRacePublished.mockImplementation(async (_id: string, p: boolean) => ({ url: URL1, published: p }));
    await open();
    await userEvent.click(screen.getByTestId("race-upload-btn"));
    await waitFor(() => expect(screen.getByTestId("race-share-status")).toHaveTextContent("Not published"));
    expect(screen.getByTestId("share-race-modal")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("race-share-publish"));
    await waitFor(() => expect(screen.getByTestId("race-share-copy")).toBeEnabled());
    expect(screen.getByTestId("race-share-url")).toHaveValue(URL1);
  });

  it("upload failure: the reason, and Retry upload", async () => {
    live.saveRaceToServer.mockImplementation(async () => {
      live.state.publishErrors = { [RACE]: "No connection to the server" };
      throw new Error("No connection to the server");
    });
    await open();
    await userEvent.click(screen.getByTestId("race-upload-btn"));
    // the store change is read on the next render
    await userEvent.click(screen.getByTestId("share-race-modal"));
    await waitFor(() => expect(screen.getByTestId("race-upload-btn")).toHaveTextContent("Retry upload"));
    expect(screen.getByTestId("race-upload-error")).toHaveTextContent("No connection to the server");
  });

  it("linked race: the button is the red/green publish status; a 404 is explained in the modal", async () => {
    live.linked.add(RACE);
    live.state.access = { [RACE]: { isOwner: true } };
    live.shareLink.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    render(
      <MemoryRouter>
        <ShareRace raceUuid={RACE} raceName="Test" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("share-race-btn")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("race-publish-status")).toHaveAttribute("data-state", "error"));
    await userEvent.click(screen.getByTestId("race-publish-status"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not open sharing"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("Not found");
  });

  it("linked race, published: green 'Published'", async () => {
    live.linked.add(RACE);
    live.state.access = { [RACE]: { isOwner: true } };
    live.shareLink.mockResolvedValue({ url: URL1, published: true });
    render(
      <MemoryRouter>
        <ShareRace raceUuid={RACE} raceName="Test" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("race-publish-status")).toHaveAttribute("data-state", "on"));
    expect(screen.getByTestId("race-publish-status")).toHaveTextContent("Published");
  });

  it("linked race, not the owner: no Share button", () => {
    live.linked.add(RACE);
    live.state.access = { [RACE]: { isOwner: false } };
    render(
      <MemoryRouter>
        <ShareRace raceUuid={RACE} raceName="Test" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("share-race-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("race-publish-status")).not.toBeInTheDocument();
  });
});
