import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import { authMiddleware, requireScope, requireSession } from "../auth.js";

// We test requireScope and requireSession as unit functions.
// Full bearer token integration is tested via route tests.

describe("requireScope", () => {
  function makeReq(apiKey?: { id: string; scope: string }): Request {
    return { apiKey } as unknown as Request;
  }

  it("passes when no apiKey (session auth)", () => {
    expect(() => requireScope(makeReq(), "read-write")).not.toThrow();
  });

  it("passes when apiKey scope matches", () => {
    expect(() => requireScope(makeReq({ id: "k1", scope: "read-write" }), "read-write")).not.toThrow();
  });

  it("passes when apiKey is read-write and required is read-only", () => {
    expect(() => requireScope(makeReq({ id: "k1", scope: "read-write" }), "read-only")).not.toThrow();
  });

  it("throws when apiKey is read-only and required is read-write", () => {
    expect(() => requireScope(makeReq({ id: "k1", scope: "read-only" }), "read-write"))
      .toThrow("Insufficient API key scope");
  });
});

describe("requireSession", () => {
  it("passes when no apiKey (session auth)", () => {
    const req = {} as Request;
    expect(() => requireSession(req)).not.toThrow();
  });

  it("throws when apiKey is present", () => {
    const req = { apiKey: { id: "k1", scope: "read-only" } } as unknown as Request;
    expect(() => requireSession(req)).toThrow("This endpoint requires browser session authentication");
  });
});
