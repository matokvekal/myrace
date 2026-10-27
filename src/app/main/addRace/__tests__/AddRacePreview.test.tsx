import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveRace = vi.fn().mockResolvedValue(undefined);
vi.mock("@/utils/saveRace", () => ({ saveRace: (...a: unknown[]) => saveRace(...a) }));

import AddRace from "../AddRace";

/** Create Race: a start list is previewed (with warnings) and must be confirmed before saving. */
describe("Create Race → start-list preview", () => {
  it("shows what will be created and enables Done only after Confirm import", async () => {
    const user = userEvent.setup();
    render(<AddRace setAddNewwRace={() => {}} />);
    const csv = "Bib,First Name,Last Name,Category,Heat\n101,Dana,Levi,Elite,1\nBib,First Name,Last Name,Category,Heat\n201,Noa,Bar,Juniors,2\n";
    await user.upload(document.getElementById("ridersFileUpload") as HTMLInputElement, new File([csv], "start.csv", { type: "text/csv" }));

    const preview = await screen.findByTestId("import-preview");
    expect(preview).toHaveTextContent("2 riders · 2 categories · 2 waves (wave column) · 1 row(s) skipped");
    expect(screen.getByTestId("import-preview-warnings")).toHaveTextContent(/repeated header/);
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();

    await user.click(screen.getByTestId("import-preview-confirm"));
    expect(done).toBeEnabled();
    await user.click(done);
    await waitFor(() => expect(saveRace).toHaveBeenCalledTimes(1));
  });
});
