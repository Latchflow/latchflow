import { describe, it, expect } from "vitest";
import { createExpressServer } from "../../src/http/express-server.js";

describe("express adapter", () => {
  it("creates a server with routing methods", () => {
    const server = createExpressServer();
    expect(typeof server.get).toBe("function");
    expect(typeof server.post).toBe("function");
    expect(typeof server.listen).toBe("function");
  });
});
