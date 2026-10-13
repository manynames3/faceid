import { describe, expect, it } from "vitest";
import { routeForPath } from "./router";

describe("public and account routes", () => {
  it("keeps guest previews and capability routes separate from the owner workspace", () => {
    expect(routeForPath("/demo/guest")).toBe("guest-preview");
    expect(routeForPath("/demo/guest/")).toBe("guest-preview");
    expect(routeForPath("/guest")).toBe("guest");
    expect(routeForPath("/gallery")).toBe("gallery");
    expect(routeForPath("/gallery/")).toBe("gallery");
    expect(routeForPath("/demo/gallery")).toBe("gallery-preview");
    expect(routeForPath("/demo/gallery/")).toBe("gallery-preview");
    expect(routeForPath("/app")).toBe("app");
    expect(routeForPath("/demo")).toBe("demo");
    expect(routeForPath("/missing")).toBe("not-found");
  });
});
