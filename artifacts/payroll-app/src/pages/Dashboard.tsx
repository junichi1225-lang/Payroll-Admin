import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { PayrollList } from "@/components/PayrollList";
import { EmployeeList } from "@/components/EmployeeList";
import { usePayrollRecords } from "@/hooks/use-payroll";
import { useEmployees } from "@/hooks/use-employees";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Download, Plus } from "lucide-react";

type TabType = "payroll" | "employees";

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 2, 1)); // March 2026 default
  const [activeTab, setActiveTab] = useState<TabType>("payroll");

  // Fetch mock data
  const { data: payrollData = [], isLoading: isPayrollLoading } = usePayrollRecords(currentDate.toISOString());
  const { data: employeeData = [], isLoading: isEmployeesLoading } = useEmployees();

  return (
    <AppLayout>
      <div className="px-4 py-2 sm:px-6 lg:px-8 max-w-6xl mx-auto pb-24">
        
        {/* Month Navigation */}
        <MonthSwitcher currentDate={currentDate} onChange={setCurrentDate} />

        {/* Top Action Bar & Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          
          {/* Custom Animated Tabs */}
          <div className="inline-flex bg-secondary/80 p-1 rounded-2xl shadow-inner border border-border/50 self-start">
            <button
              onClick={() => setActiveTab("payroll")}
              className={cn(
                "relative px-5 sm:px-8 py-2.5 text-sm font-semibold rounded-xl transition-colors z-10",
                activeTab === "payroll" ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {activeTab === "payroll" && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-primary rounded-xl shadow-md"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-20 tracking-wide">給与情報</span>
            </button>
            <button
              onClick={() => setActiveTab("employees")}
              className={cn(
                "relative px-5 sm:px-8 py-2.5 text-sm font-semibold rounded-xl transition-colors z-10",
                activeTab === "employees" ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {activeTab === "employees" && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-primary rounded-xl shadow-md"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-20 tracking-wide">社員情報</span>
            </button>
          </div>

          {/* Context Actions */}
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-card hover:bg-secondary border border-border text-foreground text-sm font-medium rounded-xl shadow-sm transition-all active:scale-95">
              <Download className="w-4 h-4 text-muted-foreground" />
              <span className="hidden sm:inline">エクスポート</span>
            </button>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-foreground hover:bg-foreground/90 text-background text-sm font-medium rounded-xl shadow-md transition-all active:scale-95">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">新規追加</span>
              <span className="sm:hidden">追加</span>
            </button>
          </div>
        </div>

        {/* Main Content Area with simple enter animation */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full"
        >
          {activeTab === "payroll" ? (
            <PayrollList data={payrollData} isLoading={isPayrollLoading} />
          ) : (
            <EmployeeList data={employeeData} isLoading={isEmployeesLoading} />
          )}
        </motion.div>

      </div>
    </AppLayout>
  );
}
