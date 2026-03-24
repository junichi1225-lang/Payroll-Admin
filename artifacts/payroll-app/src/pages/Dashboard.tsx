import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { EmployeePayrollDetail } from "@/components/EmployeePayrollDetail";
import { EmployeeInfoDetail } from "@/components/EmployeeInfoDetail";
import { DUMMY_EMPLOYEE_DATA, DUMMY_PAYROLL_DATA } from "@/lib/dummy-data";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

type TabType = "payroll" | "info";

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 2, 1));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(DUMMY_EMPLOYEE_DATA[0].id);
  const [activeTab, setActiveTab] = useState<TabType>("payroll");

  const selectedEmployee = DUMMY_EMPLOYEE_DATA.find((e) => e.id === selectedEmployeeId)!;
  const selectedPayroll = DUMMY_PAYROLL_DATA.find((p) => p.employeeId === selectedEmployeeId);

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Month Switcher */}
        <div className="px-4 pt-4 pb-2 sm:px-6">
          <MonthSwitcher currentDate={currentDate} onChange={setCurrentDate} />
        </div>

        {/* Mobile: Horizontal employee selector */}
        <div className="md:hidden px-4 pb-3 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1">
            {DUMMY_EMPLOYEE_DATA.map((emp) => (
              <button
                key={emp.id}
                onClick={() => setSelectedEmployeeId(emp.id)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all duration-200",
                  selectedEmployeeId === emp.id
                    ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20"
                    : "bg-card text-foreground border-border hover:border-primary/40 hover:bg-secondary"
                )}
              >
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                  selectedEmployeeId === emp.id
                    ? "bg-white/20 text-white"
                    : "bg-secondary text-foreground"
                )}>
                  {emp.name.substring(0, 1)}
                </div>
                {emp.name}
              </button>
            ))}
          </div>
        </div>

        {/* Main layout: sidebar + detail */}
        <div className="flex flex-1 overflow-hidden gap-0">
          
          {/* Desktop: Left employee selector panel */}
          <div className="hidden md:flex flex-col w-56 lg:w-64 border-r border-border bg-card/50 flex-shrink-0 overflow-y-auto">
            <div className="px-4 py-3 border-b border-border/50">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">従業員一覧</h2>
            </div>
            <nav className="flex-1 py-3 px-2 space-y-1">
              {DUMMY_EMPLOYEE_DATA.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmployeeId(emp.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 text-left group",
                    selectedEmployeeId === emp.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 border transition-colors",
                    selectedEmployeeId === emp.id
                      ? "bg-primary/20 text-primary border-primary/30"
                      : "bg-secondary text-foreground/70 border-border group-hover:border-primary/20"
                  )}>
                    {emp.name.substring(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "font-semibold truncate text-sm",
                      selectedEmployeeId === emp.id ? "text-primary" : "text-foreground"
                    )}>
                      {emp.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{emp.department}</p>
                  </div>
                  {selectedEmployeeId === emp.id && (
                    <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Right detail area */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedEmployeeId}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                <div className="px-4 py-4 sm:px-6 lg:px-8 max-w-4xl mx-auto pb-16">
                  
                  {/* Employee Header */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-indigo-100 text-primary flex items-center justify-center font-bold text-xl border border-primary/20 shadow-inner flex-shrink-0">
                      {selectedEmployee.name.substring(0, 1)}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">{selectedEmployee.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedEmployee.employeeNumber} &middot; {selectedEmployee.department} &middot; {selectedEmployee.position}
                      </p>
                    </div>
                  </div>

                  {/* Tab Switcher */}
                  <div className="inline-flex bg-secondary/80 p-1 rounded-2xl shadow-inner border border-border/50 mb-6">
                    <button
                      onClick={() => setActiveTab("payroll")}
                      className={cn(
                        "relative px-6 sm:px-8 py-2.5 text-sm font-semibold rounded-xl transition-colors z-10",
                        activeTab === "payroll" ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {activeTab === "payroll" && (
                        <motion.div
                          layoutId="detailTab"
                          className="absolute inset-0 bg-primary rounded-xl shadow-md"
                          transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                        />
                      )}
                      <span className="relative z-20">給与情報</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("info")}
                      className={cn(
                        "relative px-6 sm:px-8 py-2.5 text-sm font-semibold rounded-xl transition-colors z-10",
                        activeTab === "info" ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {activeTab === "info" && (
                        <motion.div
                          layoutId="detailTab"
                          className="absolute inset-0 bg-primary rounded-xl shadow-md"
                          transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                        />
                      )}
                      <span className="relative z-20">社員情報</span>
                    </button>
                  </div>

                  {/* Tab Content */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      {activeTab === "payroll" ? (
                        <EmployeePayrollDetail
                          payroll={selectedPayroll}
                          currentDate={currentDate}
                        />
                      ) : (
                        <EmployeeInfoDetail employee={selectedEmployee} />
                      )}
                    </motion.div>
                  </AnimatePresence>

                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
