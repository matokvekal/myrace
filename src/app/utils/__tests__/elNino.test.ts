import { describe, expect, it } from "vitest";
import { elNinoUrl, parseElNinoEventId } from "../elNino";

const ID = "c3b1b6a1-15f4-4570-b790-e384ca144583";

describe("parseElNinoEventId", () => {
  it("accepts a bare id or a link on El Niño's events path", () => {
    expect(parseElNinoEventId(ID)).toBe(ID);
    expect(parseElNinoEventId(` ${ID.toUpperCase()} `)).toBe(ID);
    expect(parseElNinoEventId(`https://el-nino.site/events/${ID}`)).toBe(ID);
    expect(parseElNinoEventId(`el-nino.site/events/${ID}/`)).toBe(ID);
    expect(parseElNinoEventId(`https://el-nino.site/events/${ID}?ref=qr`)).toBe(ID);
  });

  it("refuses anything that could change where the link goes", () => {
    expect(parseElNinoEventId(`https://evil.example/events/${ID}`)).toBeNull();
    expect(parseElNinoEventId(`https://el-nino.site.evil.example/events/${ID}`)).toBeNull();
    expect(parseElNinoEventId(`https://el-nino.site@evil.example/events/${ID}`)).toBeNull();
    expect(parseElNinoEventId(`https://el-nino.site/login/${ID}`)).toBeNull();
    expect(parseElNinoEventId("https://el-nino.site/events/new")).toBeNull();
    expect(parseElNinoEventId(`javascript:alert("${ID}")`)).toBeNull();
    expect(parseElNinoEventId("../../login")).toBeNull();
    expect(parseElNinoEventId("")).toBeNull();
  });
});

describe("elNinoUrl", () => {
  it("is the event page, or El Niño's home page by default", () => {
    expect(elNinoUrl(ID)).toBe(`https://el-nino.site/events/${ID}`);
    expect(elNinoUrl(null)).toBe("https://el-nino.site");
    expect(elNinoUrl("https://evil.example/x")).toBe("https://el-nino.site");
  });
});
