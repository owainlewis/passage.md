import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./markdown-view";

describe("MarkdownView", () => {
  it("renders Markdown while stripping unsafe HTML", () => {
    const { container } = render(
      <MarkdownView source={`# Safe document\n\n<img src="x" onerror="alert(1)">\n\n<script>alert(1)</script>`} />
    );

    expect(screen.getByRole("heading", { name: "Safe document" })).toBeInTheDocument();
    expect(container.querySelector("article")).toHaveClass("markdown", "markdownView");
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("onerror");
  });
});
