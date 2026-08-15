import { describe, it, expect, vi } from "vitest";
import { showToast } from "@/lib/toast";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

describe("showToast", () => {
  it("should trigger toast.success with message", () => {
    showToast.success("Success message");
    expect(toast.success).toHaveBeenCalledWith("Success message");
  });

  it("should trigger toast.error with message", () => {
    showToast.error("Error message");
    expect(toast.error).toHaveBeenCalledWith("Error message");
  });

  it("should trigger toast.info with message", () => {
    showToast.info("Info message");
    expect(toast.info).toHaveBeenCalledWith("Info message");
  });

  it("should trigger toast.warning with message", () => {
    showToast.warning("Warning message");
    expect(toast.warning).toHaveBeenCalledWith("Warning message");
  });

  it("should trigger toast.loading with message", () => {
    showToast.loading("Loading message");
    expect(toast.loading).toHaveBeenCalledWith("Loading message");
  });
});
