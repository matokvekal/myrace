import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BibConflictStep from "../BibConflictStep";
import { findBibConflicts, type ImportBibRow } from "@/utils/bibConflicts";

const rows: ImportBibRow[] = [
  { index: 0, row: 2, bib: 21, name: "Dana Levi", category: "Elite", heat: 1 },
  { index: 1, row: 3, bib: 21, name: "Avi Cohen", category: "Kids", heat: 3 },
  { index: 2, row: 4, bib: 189, name: "Noa Bar", category: "Elite", heat: 1 },
];
const existing = [{ bib: 189, name: "Old Rider", heat: 2 }];

const setup = () => {
  const groups = findBibConflicts(rows, existing);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<BibConflictStep groups={groups} rows={rows} existing={existing} onConfirm={onConfirm} onCancel={onCancel} />);
  return { user: userEvent.setup(), onConfirm, onCancel };
};

describe("BibConflictStep", () => {
  it("lists in-file and existing clashes with the proposed numbers", () => {
    setup();
    expect(screen.getByTestId("bib-group-21")).toHaveTextContent("2 rows in the file");
    expect(screen.getByTestId("bib-group-189")).toHaveTextContent("Already in this race: Old Rider");
    expect(screen.getByTestId("bib-choice-0")).toHaveValue("21");
    expect(screen.getByTestId("bib-choice-1")).toHaveValue("1021");
    expect(screen.getByTestId("bib-choice-2")).toHaveValue("1189");
  });

  it("confirm sends only the changed numbers, with original and reason", async () => {
    const { user, onConfirm } = setup();
    await user.click(screen.getByTestId("bib-conflicts-confirm"));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ index: 1, originalBib: 21, correctedBib: 1021 }),
      expect.objectContaining({ index: 2, originalBib: 189, correctedBib: 1189, reason: expect.stringContaining("Old Rider") }),
    ]);
  });

  it("a manual number that collides blocks the confirm until it is fixed", async () => {
    const { user, onConfirm } = setup();
    const input = screen.getByTestId("bib-choice-1");
    await user.clear(input);
    await user.type(input, "189"); // the existing rider's bib
    const confirm = screen.getByTestId("bib-conflicts-confirm");
    expect(confirm).toBeDisabled();
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Old Rider");
    await user.clear(input);
    await user.type(input, "555");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm.mock.calls[0][0][0]).toMatchObject({ index: 1, correctedBib: 555 });
  });

  it("Back cancels without confirming anything", async () => {
    const { user, onConfirm, onCancel } = setup();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
