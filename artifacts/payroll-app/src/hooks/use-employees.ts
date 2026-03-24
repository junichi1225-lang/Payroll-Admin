import { useQuery } from "@tanstack/react-query";
import { DUMMY_EMPLOYEE_DATA, EmployeeRecord } from "@/lib/dummy-data";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      await delay(500); // Fake network latency
      return [...DUMMY_EMPLOYEE_DATA];
    },
  });
}
