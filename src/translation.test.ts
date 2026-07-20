import { describe, expect, it } from "vitest";
import { translatedTitle } from "./translation";

describe("translatedTitle", () => {
  it("returns the translated title when it differs", () => {
    expect(translatedTitle("La Camisa Negra", "The Black Shirt")).toBe(
      "The Black Shirt"
    );
  });

  it("suppresses an identical title, ignoring case and whitespace", () => {
    expect(translatedTitle("Corazon", "Corazon")).toBeNull();
    expect(translatedTitle("Corazon", "corazon")).toBeNull();
    expect(translatedTitle(" Corazon ", "CORAZON  ")).toBeNull();
  });

  it("suppresses a missing or empty translation", () => {
    expect(translatedTitle("Corazon", undefined)).toBeNull();
    expect(translatedTitle("Corazon", "")).toBeNull();
    expect(translatedTitle("Corazon", "   ")).toBeNull();
  });
});
