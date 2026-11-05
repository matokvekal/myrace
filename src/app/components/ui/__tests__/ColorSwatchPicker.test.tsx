import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColorSwatchPicker, { PRESET_COLORS } from "../ColorSwatchPicker";

const renderPicker = (value: string | null, onPick = vi.fn()) => {
  render(<ColorSwatchPicker value={value} onPick={onPick} onCancel={vi.fn()} inputTestId="in" saveTestId="save" />);
  return onPick;
};

describe("ColorSwatchPicker", () => {
  it("offers 20 distinct presets and highlights the current one (case-insensitive)", () => {
    renderPicker("#1e88e5");
    expect(PRESET_COLORS).toHaveLength(20);
    expect(new Set(PRESET_COLORS.map((p) => p.code.toLowerCase())).size).toBe(20);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a swatch picks its colour at once", async () => {
    const onPick = renderPicker("#E53935");
    await userEvent.setup().click(screen.getByRole("button", { name: "Teal" }));
    expect(onPick).toHaveBeenCalledWith("#00897B");
  });

  it("keeps a custom colour that is not a preset, and Custom Color… saves the native picker's value", async () => {
    const user = userEvent.setup();
    const onPick = renderPicker("#123456");
    expect(screen.getByTestId("custom-current")).toHaveTextContent("Custom #123456");
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    await user.click(screen.getByTestId("custom-color"));
    const input = screen.getByTestId("in") as HTMLInputElement;
    expect(input.value).toBe("#123456");
    fireEvent.change(input, { target: { value: "#abcdef" } });
    await user.click(screen.getByTestId("save"));
    expect(onPick).toHaveBeenCalledWith("#abcdef");
  });
});
