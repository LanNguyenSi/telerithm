import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaginationControls } from "@/components/ui/pagination-controls";

afterEach(() => cleanup());

describe("PaginationControls", () => {
  it("renders page info", () => {
    render(
      <PaginationControls
        page={2}
        pageSize={50}
        total={150}
        onPageChange={() => {}}
      />,
    );

    // Should show "Page 2 of 3"
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
  });

  it("calls onPageChange when clicking previous", () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        page={2}
        pageSize={50}
        total={150}
        onPageChange={onPageChange}
      />,
    );

    const prevBtn = screen.getByRole("button", { name: /Prev/i });
    fireEvent.click(prevBtn);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange when clicking next", () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        page={1}
        pageSize={50}
        total={150}
        onPageChange={onPageChange}
      />,
    );

    const nextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("disables previous button on first page", () => {
    render(
      <PaginationControls
        page={1}
        pageSize={50}
        total={150}
        onPageChange={() => {}}
      />,
    );

    const prevBtn = screen.getByRole("button", { name: /Prev/i });
    expect(prevBtn).toBeDisabled();
  });

  it("disables next button on last page", () => {
    render(
      <PaginationControls
        page={3}
        pageSize={50}
        total={150}
        onPageChange={() => {}}
      />,
    );

    const nextBtn = screen.getByRole("button", { name: /Next/i });
    expect(nextBtn).toBeDisabled();
  });

  it("renders with single page total", () => {
    render(
      <PaginationControls
        page={1}
        pageSize={50}
        total={30}
        onPageChange={() => {}}
      />,
    );

    const nextBtn = screen.getByRole("button", { name: /Next/i });
    expect(nextBtn).toBeDisabled();
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
  });
});
