/**
 * P0: on a server error (e.g. 503 signing_key_missing) the Finish Race dialog stayed on
 * "Finishing…" with every button disabled. The failure must show, and the owner must be
 * able to retry or cancel; a second click while working must not send a second request.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import FinishRaceModal from "../FinishRaceModal";

const setup = (onConfirm: () => Promise<void>) => {
  const onCancel = vi.fn();
  render(<FinishRaceModal raceName="Demo" riders={[]} categories={[]} onConfirm={onConfirm} onCancel={onCancel} />);
  fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: "FINISH" } });
  return { onCancel, confirm: screen.getByTestId("finish-race-confirm") };
};

describe("FinishRaceModal failure and retry", () => {
  it("shows the error and re-enables Retry and Cancel", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error("The server can't sign official results yet")).mockResolvedValueOnce(undefined);
    const { onCancel, confirm } = setup(onConfirm);

    await act(async () => { fireEvent.click(confirm); });
    expect(await screen.findByText(/can't sign official results/)).toBeTruthy();
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    const cancel = screen.getByText("Cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(confirm); }); // retry
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("ignores repeated clicks while the request is in flight", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { confirm } = setup(onConfirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.textContent).toMatch(/Finishing/);
    await act(async () => resolve());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
