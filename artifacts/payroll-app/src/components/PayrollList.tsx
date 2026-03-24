import { formatCurrency } from "@/lib/utils";
import { PayrollRecord } from "@/lib/dummy-data";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Banknote, FileText, CheckCircle2, AlertCircle } from "lucide-react";

interface PayrollListProps {
  data: PayrollRecord[];
  isLoading: boolean;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const item = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export function PayrollList({ data, isLoading }: PayrollListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 sm:space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 sm:h-20 bg-card/50 border border-border/40 rounded-2xl animate-pulse"></div>
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-card rounded-3xl border border-border/50 border-dashed">
        <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <h3 className="text-lg font-bold text-foreground">データがありません</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          選択された月の給与データはまだ登録されていません。
        </p>
      </div>
    );
  }

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-3 sm:space-y-4"
    >
      {data.map((record) => (
        <motion.div 
          key={record.id}
          variants={item}
          className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 bg-card rounded-2xl border border-border shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300 relative overflow-hidden"
        >
          {/* Subtle gradient hover effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/0 to-primary/[0.02] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

          {/* User Info & Status */}
          <div className="flex items-center justify-between sm:justify-start gap-4 mb-4 sm:mb-0 sm:w-[28%] relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold text-sm border border-border/50">
                {record.name.substring(0, 1)}
              </div>
              <div>
                <h4 className="font-bold text-foreground text-sm sm:text-base whitespace-nowrap">{record.name}</h4>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">EMP-{record.employeeId}</p>
              </div>
            </div>
            
            <div className="sm:hidden">
              <Badge variant={record.status === "確定済み" ? "success" : "warning"} className="px-2.5 py-1">
                {record.status === "確定済み" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                {record.status}
              </Badge>
            </div>
          </div>

          {/* Breakdown Stats */}
          <div className="flex-1 grid grid-cols-3 gap-2 sm:gap-6 lg:gap-8 border-t border-border/40 pt-3 sm:pt-0 sm:border-0 relative z-10">
            <div className="flex flex-col">
              <span className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">基本給</span>
              <span className="text-xs sm:text-sm font-semibold text-foreground/90">{formatCurrency(record.baseSalary)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">手当</span>
              <span className="text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400">+{formatCurrency(record.allowances)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">控除</span>
              <span className="text-xs sm:text-sm font-semibold text-destructive dark:text-red-400">-{formatCurrency(record.deductions)}</span>
            </div>
          </div>

          {/* Total & Desktop Status */}
          <div className="flex items-center justify-between sm:justify-end gap-6 mt-4 pt-4 border-t border-border/40 sm:mt-0 sm:pt-0 sm:border-0 sm:min-w-[220px] relative z-10">
            <div className="flex flex-col items-start sm:items-end">
              <span className="text-[10px] sm:text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">支給総額</span>
              <div className="flex items-center gap-1.5">
                <Banknote className="w-4 h-4 text-primary/60 hidden sm:block" />
                <span className="text-lg sm:text-xl font-bold text-foreground tracking-tight">
                  {formatCurrency(record.netPay)}
                </span>
              </div>
            </div>
            
            <div className="hidden sm:block">
              <Badge variant={record.status === "確定済み" ? "success" : "warning"} className="px-2.5 py-1">
                {record.status === "確定済み" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                {record.status}
              </Badge>
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
