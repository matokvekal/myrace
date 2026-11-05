import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterAuthTarget } from "../authRedirect";

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  google: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));
vi.mock("@/services/live/liveClient", () => ({
  auth,
  LiveApiError: class extends Error { constructor(readonly status: number, readonly code: string, m: string) { super(m); } },
}));

import SignInForm from "../SignInForm";

const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
const renderForm = (next: string | null = null) =>
  render(
    <MemoryRouter initialEntries={[next ? `/account?next=${encodeURIComponent(next)}` : "/account"]}>
      <Routes>
        <Route path="*" element={<><SignInForm next={next} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

describe("afterAuthTarget", () => {
  it("All Races by default; a safe in-app next wins", () => {
    expect(afterAuthTarget(null)).toBe("/main");
    expect(afterAuthTarget("/race/abc?x=1")).toBe("/race/abc?x=1");
  });
  it("never another site and never back to the sign-in pages (no loops)", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/account", "/account?next=/main", "/login", "/otp", "race/x"]) {
      expect(afterAuthTarget(bad), bad).toBe("/main");
    }
  });
});

describe("Sign-in screen: where you land", () => {
  beforeEach(() => Object.values(auth).forEach((f) => f.mockReset()));

  it("successful login → All Races", async () => {
    auth.login.mockResolvedValue({ id: "u1" });
    renderForm();
    await userEvent.type(screen.getByPlaceholderText("Email"), "a@b.co");
    await userEvent.type(screen.getByPlaceholderText("Password"), "secret-123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/main$/));
  });

  it("failed login stays, with the error", async () => {
    auth.login.mockRejectedValue(new Error("Wrong email or password"));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText("Email"), "a@b.co");
    await userEvent.type(screen.getByPlaceholderText("Password"), "nope-nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/account$/);
  });

  it("new account → All Races; a safe ?next= page wins", async () => {
    auth.register.mockResolvedValue({ id: "u2" });
    renderForm("/race/r1");
    await userEvent.click(screen.getByRole("tab", { name: "New account" }));
    await userEvent.type(screen.getByPlaceholderText("Your name"), "Dana");
    await userEvent.type(screen.getByPlaceholderText("Email"), "d@b.co");
    await userEvent.type(screen.getByPlaceholderText("Password (8+ characters)"), "secret-123");
    await userEvent.type(screen.getByPlaceholderText("Repeat password"), "secret-123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/race\/r1$/));
  });

  it("password reset that signs in → All Races; asking for the code does not navigate", async () => {
    auth.requestPasswordReset.mockResolvedValue({ sent: true, remainingToday: 2, resendAfterSeconds: 60 });
    auth.confirmPasswordReset.mockResolvedValue({ id: "u3" });
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    await userEvent.type(screen.getByPlaceholderText("Email"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(await screen.findByText(/We sent a code to/)).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/account$/);
    await userEvent.type(screen.getByPlaceholderText("••••••"), "123456");
    await userEvent.type(screen.getByPlaceholderText("Password (8+ characters)"), "new-secret-1");
    await userEvent.type(screen.getByPlaceholderText("Repeat password"), "new-secret-1");
    await userEvent.click(screen.getByRole("button", { name: "Set new password and sign in" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/main$/));
  });
});
