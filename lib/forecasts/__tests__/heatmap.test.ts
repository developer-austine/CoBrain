import { describe, expect, it } from "vitest";
import { bucketRows, BANDS, DAYS } from "../heatmap";

/**
 * Heatmap bucketing.
 *
 * Postgres `EXTRACT(DOW)` is 0=Sunday..6=Saturday while the grid runs Mon-first,
 * so every cell placement passes through an index shift. Getting it wrong moves
 * the hotspot by a day, which is both wrong and completely invisible — the grid
 * still looks like a plausible week.
 */

const cell = (h: ReturnType<typeof bucketRows>, band: string, day: string) =>
  h.cells[h.bands.indexOf(band)][h.days.indexOf(day)];

describe("day-of-week mapping", () => {
  it("places Monday evening in the Monday column", () => {
    // dow=1 is Monday in Postgres.
    const h = bucketRows([{ dow: 1, hour: 19, n: 5 }], 0);
    expect(cell(h, "6–9pm", "Mon")).toBe(5);
    expect(h.total).toBe(5);
  });

  it("places Friday evening in the Friday column", () => {
    const h = bucketRows([{ dow: 5, hour: 22, n: 3 }], 0);
    expect(cell(h, "9pm–12am", "Fri")).toBe(3);
  });

  it("folds Saturday and Sunday into one weekend column", () => {
    const h = bucketRows(
      [
        { dow: 6, hour: 19, n: 2 }, // Saturday
        { dow: 0, hour: 19, n: 4 }, // Sunday
      ],
      0
    );
    expect(cell(h, "6–9pm", "Sat–Sun")).toBe(6);
  });

  it("never puts weekend work in a weekday column", () => {
    const h = bucketRows([{ dow: 0, hour: 20, n: 9 }], 0);
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(cell(h, "6–9pm", day)).toBe(0);
    }
  });
});

describe("band boundaries", () => {
  it.each([
    [17, false], // still working hours
    [18, true],
    [20, true],
    [21, true], // start of the late band
    [23, true],
  ])("weekday hour %s counted: %s", (hour, counted) => {
    const h = bucketRows([{ dow: 2, hour, n: 1 }], 0);
    expect(h.total).toBe(counted ? 1 : 0);
  });

  it("splits the two evening bands at 21:00", () => {
    const h = bucketRows(
      [
        { dow: 3, hour: 20, n: 1 },
        { dow: 3, hour: 21, n: 1 },
      ],
      0
    );
    expect(cell(h, "6–9pm", "Wed")).toBe(1);
    expect(cell(h, "9pm–12am", "Wed")).toBe(1);
  });

  it("drops weekday daytime activity entirely", () => {
    // 10am on a Tuesday is not after-hours; counting it would make the whole
    // panel a measure of "when this team works" rather than late work.
    const h = bucketRows([{ dow: 2, hour: 10, n: 100 }], 0);
    expect(h.total).toBe(0);
    expect(h.hotspot).toBeNull();
  });

  it("keeps weekend daytime work, which is still weekend work", () => {
    const h = bucketRows([{ dow: 6, hour: 11, n: 7 }], 0);
    expect(h.total).toBe(7);
    expect(cell(h, "6–9pm", "Sat–Sun")).toBe(7);
  });
});

describe("hotspot", () => {
  it("names the busiest cell", () => {
    const h = bucketRows(
      [
        { dow: 1, hour: 19, n: 3 },
        { dow: 4, hour: 22, n: 11 },
        { dow: 5, hour: 19, n: 6 },
      ],
      0
    );
    expect(h.hotspot).toEqual({ day: "Thu", band: "9pm–12am", count: 11 });
  });

  it("is null when nothing was recorded", () => {
    const h = bucketRows([], 0);
    expect(h.hotspot).toBeNull();
    expect(h.total).toBe(0);
    // The grid still has its full shape so the component can render an
    // explicit empty state rather than crashing on a missing row.
    expect(h.cells).toHaveLength(BANDS.length);
    expect(h.cells[0]).toHaveLength(DAYS.length);
  });
});

describe("robustness", () => {
  it("ignores zero and negative counts", () => {
    const h = bucketRows(
      [
        { dow: 1, hour: 19, n: 0 },
        { dow: 1, hour: 20, n: -4 },
      ],
      0
    );
    expect(h.total).toBe(0);
  });

  it("accepts bigint counts, which is what COUNT(*) returns", () => {
    const h = bucketRows([{ dow: 1, hour: 19, n: BigInt(42) }], 0);
    expect(cell(h, "6–9pm", "Mon")).toBe(42);
  });

  it("reports the offset it was given, for the caption", () => {
    expect(bucketRows([], 180).utcOffsetMinutes).toBe(180);
  });
});
