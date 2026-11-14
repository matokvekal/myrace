import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportStages from "../ImportStages";
import ImportProgressStep from "../ImportProgressStep";

vi.mock("@/services/templateStorage", () => ({ getAllTemplates: async () => [] }));
import UploadStep from "../UploadStep";

const progress = { total: 10, processed: 0, successful: 0, failed: 0, status: "importing" as const };

describe("import loading feedback (Phase 2)", () => {
  it("marks the earlier stages done and the current one active", () => {
    render(<ImportStages stage="duplicates" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual(["done", "done", "done", "active", "todo"]);
    expect(screen.getByTestId("import-stage")).toHaveTextContent("Resolving duplicates…");
  });

  it("an unmeasurable step gets an indeterminate bar, never a fake 0 %", () => {
    render(<ImportStages stage="saving" detail="Saving 10 riders on this device…" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("data-indeterminate", "true");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("a measurable step shows the real percentage", () => {
    render(<ImportStages stage="saving" progress={{ done: 3, total: 4 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("saving: shows the stages instead of 0 / N (0%)", () => {
    render(<ImportProgressStep progress={progress} skippedIssues={[]} onClose={vi.fn()} stage="saving" stageDetail="Sending 10 riders to the server…" />);
    expect(screen.getByTestId("import-stage")).toHaveTextContent("Sending 10 riders to the server…");
    expect(screen.queryByText(/\(0%\)/)).toBeNull();
  });

  it("a refused import offers Back to preview (file and mapping kept)", async () => {
    const back = vi.fn();
    render(
      <ImportProgressStep
        progress={{ ...progress, status: "error" }}
        skippedIssues={[]}
        refusal={{ message: "Nothing was imported.", problems: ["Row 3: bib 21 is already in this race (Dana Levi)"] }}
        onClose={vi.fn()}
        onBackToPreview={back}
      />
    );
    expect(screen.getByTestId("import-refused")).toHaveTextContent("Row 3: bib 21");
    await userEvent.setup().click(screen.getByTestId("import-back-to-preview"));
    expect(back).toHaveBeenCalled();
  });

  it("while a file is being read, another drop / pick is ignored", async () => {
    const onFileUpload = vi.fn();
    const { container } = render(<UploadStep onFileUpload={onFileUpload} busy />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // The drop zone is not clickable while busy; even a change event reaching the input is ignored.
    fireEvent.change(input, { target: { files: [new File(["Bib\n1"], "a.csv", { type: "text/csv" })] } });
    expect(onFileUpload).not.toHaveBeenCalled();
  });
});
