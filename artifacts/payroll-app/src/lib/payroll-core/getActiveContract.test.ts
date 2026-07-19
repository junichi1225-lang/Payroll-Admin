import { describe, it, expect } from "vitest";
import { getActiveContract, type ContractHistoryInput } from "./index";

const c = (o: Partial<ContractHistoryInput> & Pick<ContractHistoryInput, "id" | "effectiveFrom">): ContractHistoryInput => ({
  employeeId: "e1",
  workplaceId: null,
  wageType: "hourly",
  wageAmount: 1200,
  effectiveTo: null,
  ...o,
});

describe("getActiveContract", () => {
  const contracts: ContractHistoryInput[] = [
    c({ id: "c1", effectiveFrom: "2024-01-01", effectiveTo: "2025-03-31", wageAmount: 1100 }),
    c({ id: "c2", effectiveFrom: "2025-04-01", wageAmount: 1200 }),
    c({ id: "c3", effectiveFrom: "2025-04-01", workplaceId: "wpA", wageAmount: 1500 }),
    c({ id: "other", effectiveFrom: "2020-01-01", employeeId: "e2" }),
  ];

  it("対象日で有効な基本契約を引く", () => {
    expect(getActiveContract(contracts, "e1", "2025-01-15")?.id).toBe("c1");
    expect(getActiveContract(contracts, "e1", "2025-04-01")?.id).toBe("c2");
  });

  it("期間境界: effectiveTo 当日は有効、翌日は無効", () => {
    expect(getActiveContract(contracts, "e1", "2025-03-31")?.id).toBe("c1");
  });

  it("職場指定時はその職場の契約を優先する", () => {
    expect(getActiveContract(contracts, "e1", "2025-05-01", "wpA")?.id).toBe("c3");
  });

  it("職場指定でも該当職場契約が無ければ基本契約へフォールバック", () => {
    expect(getActiveContract(contracts, "e1", "2025-05-01", "wpB")?.id).toBe("c2");
  });

  it("該当なしは null", () => {
    expect(getActiveContract(contracts, "e1", "2023-12-31")).toBeNull();
    expect(getActiveContract(contracts, "e9", "2025-05-01")).toBeNull();
  });

  it("他従業員の契約は引かない", () => {
    expect(getActiveContract(contracts, "e2", "2025-05-01")?.id).toBe("other");
  });

  it("複数該当時は effectiveFrom が最新のものを採用", () => {
    const overlapping = [
      c({ id: "a", effectiveFrom: "2024-01-01" }),
      c({ id: "b", effectiveFrom: "2024-06-01" }),
    ];
    expect(getActiveContract(overlapping, "e1", "2024-07-01")?.id).toBe("b");
  });
});
