import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DUMMY_PAYROLL_DATA, PayrollRecord } from "@/lib/dummy-data";

// Simulating network delay for realistic feel
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function usePayrollRecords(monthStr: string) {
  return useQuery({
    queryKey: ['payroll', monthStr],
    queryFn: async () => {
      await delay(600); // Fake network latency
      // In a real app, we'd fetch data specific to the month
      return [...DUMMY_PAYROLL_DATA];
    },
  });
}

export function useUpdatePayrollStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, status }: { id: string, status: "確定済み" | "未確定" }) => {
      await delay(400);
      // Mock update
      const index = DUMMY_PAYROLL_DATA.findIndex(p => p.id === id);
      if (index !== -1) {
        DUMMY_PAYROLL_DATA[index].status = status;
      }
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
    }
  });
}
