import { render, screen } from "@testing-library/react";
import SharedDocument from "./page";

describe("SharedDocument", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/d");
  });

  it("points users to saved Passage share links", async () => {
    render(<SharedDocument />);

    expect(await screen.findByText("Shared documents now use saved Passage links.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=/write");
  });
});
