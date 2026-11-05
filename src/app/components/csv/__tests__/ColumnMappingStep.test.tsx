import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/csvMapper", async (orig) => ({
  ...(await orig<typeof import("@/services/csvMapper")>()),
  confirmMapping: async () => undefined,
}));
vi.mock("@/services/templateStorage", () => ({
  getAllTemplates: async () => [],
  saveTemplate: async () => undefined,
  touchTemplate: async () => undefined,
  removeTemplate: async () => undefined,
}));

import ColumnMappingStep from "../ColumnMappingStep";
import type { ColumnMapping, RiderFieldKey } from "@/types/csv.types";

const mapping = (sourceColumn: string, targetField: RiderFieldKey | null): ColumnMapping =>
  ({ sourceColumn, targetField, confidence: targetField ? 90 : 0, isAutoMapped: !!targetField, needsConfirmation: false }) as ColumnMapping;

const setup = (mappings: ColumnMapping[]) => {
  const onConfirm = vi.fn();
  const headers = mappings.map((m) => m.sourceColumn);
  const rows = [["11", "Dana", "Blue"], ["12", "Avi", "Red"], ["13", "", "Green"]].map((r) => r.slice(0, headers.length));
  render(
    <ColumnMappingStep headers={headers} mappings={mappings} sampleRows={rows.slice(0, 2)} allRows={rows} onConfirm={onConfirm} onBack={vi.fn()} />
  );
  return { user: userEvent.setup(), onConfirm };
};

const notUsed = () => within(screen.getByTestId("map-not-used"));
const used = () => within(screen.getByTestId("map-used"));

describe("ColumnMappingStep", () => {
  it("lists recognised columns as imported and the rest as not imported", () => {
    setup([mapping("Plate", "bibNumber"), mapping("Who", "firstName"), mapping("Colour", null)]);
    expect(used().getByText("Plate")).toBeInTheDocument();
    expect(used().getByText("Who")).toBeInTheDocument();
    expect(notUsed().getByText("Colour")).toBeInTheDocument();
    expect(screen.getByTestId("map-count")).toHaveTextContent("2 of 3 imported");
  });

  it("puts imported columns above the rest, with X only on top and + only below", () => {
    setup([mapping("Plate", "bibNumber"), mapping("Colour", null)]);
    const usedBox = screen.getByTestId("map-used");
    const notUsedBox = screen.getByTestId("map-not-used");
    expect(usedBox.compareDocumentPosition(notUsedBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(used().getByText("App field")).toBeInTheDocument();
    expect(notUsed().queryByText("App field")).not.toBeInTheDocument();
    expect(used().getByRole("button", { name: "Don't import Plate" })).toBeInTheDocument();
    expect(used().queryByRole("button", { name: /^Import / })).not.toBeInTheDocument();
    expect(notUsed().getByRole("button", { name: "Import Colour" })).toBeInTheDocument();
    expect(notUsed().queryByRole("button", { name: /^Don't import/ })).not.toBeInTheDocument();
    expect(used().getByRole("button", { name: "Show data of Plate" })).toBeInTheDocument();
    expect(notUsed().getByRole("button", { name: "Show data of Colour" })).toBeInTheDocument();
  });

  it("moves a column across through the field picker, and back with the X", async () => {
    const { user, onConfirm } = setup([mapping("Plate", "bibNumber"), mapping("Who", null), mapping("Colour", null)]);

    await user.click(screen.getByRole("button", { name: "Import Who" }));
    await user.click(within(screen.getByTestId("map-picker")).getByTestId("map-field-firstName"));
    expect(screen.queryByTestId("map-picker")).not.toBeInTheDocument();
    expect(used().getByRole("button", { name: "App field for Who: First Name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Don't import Who" }));
    expect(notUsed().getByText("Who")).toBeInTheDocument();

    await user.click(screen.getByTestId("map-continue"));
    const sent = onConfirm.mock.calls[0][0] as ColumnMapping[];
    expect(sent.map((m) => m.targetField)).toEqual(["bibNumber", null, null]);
  });

  it("gives a field to one column only: taking it frees the previous column", async () => {
    const { user } = setup([mapping("Plate", "bibNumber"), mapping("Number", null)]);
    await user.click(screen.getByRole("button", { name: "Import Number" }));
    const picker = within(screen.getByTestId("map-picker"));
    expect(picker.getByTestId("map-field-bibNumber")).toHaveTextContent("Now: Plate");
    await user.click(picker.getByTestId("map-field-bibNumber"));
    expect(notUsed().getByText("Plate")).toBeInTheDocument();
    expect(used().getByText("Number")).toBeInTheDocument();
  });

  it("lets several columns be kept as info", async () => {
    const { user } = setup([mapping("Plate", "bibNumber"), mapping("A", "infoField"), mapping("B", null)]);
    await user.click(screen.getByRole("button", { name: "Import B" }));
    await user.click(screen.getByTestId("map-field-infoField"));
    expect(used().getByText("A")).toBeInTheDocument();
    expect(used().getByText("B")).toBeInTheDocument();
  });

  it("expands a column to show its data and rules", async () => {
    const { user } = setup([mapping("Plate", "bibNumber"), mapping("Who", "firstName")]);
    expect(screen.queryByTestId("map-data-1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show data of Who" }));
    const data = within(screen.getByTestId("map-data-1"));
    expect(data.getByText("2 of 3 rows filled")).toBeInTheDocument();
    expect(data.getByText("Examples")).toBeInTheDocument();
    expect(data.getByText("Avi")).toBeInTheDocument();
    expect(data.getByLabelText("Required")).toBeInTheDocument();
  });

  it("refuses to continue without a bib column, inline", async () => {
    const { user, onConfirm } = setup([mapping("Who", "firstName")]);
    await user.click(screen.getByTestId("map-continue"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Bib/);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("never offers an ID column for import", () => {
    setup([mapping("Plate", "bibNumber"), mapping("תעודת זהות", null)]);
    expect(screen.getByTestId("id-column-skipped")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import תעודת זהות" })).not.toBeInTheDocument();
  });
});
