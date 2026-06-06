import { EmployeeRecord } from "@/lib/dummy-data";
import { Badge } from "@/components/ui/badge";
import { motion, type Variants } from "framer-motion";
import { Building2, Briefcase, Calendar as CalendarIcon, MoreHorizontal } from "lucide-react";

interface EmployeeListProps {
  data: EmployeeRecord[];
  isLoading: boolean;
}

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const item: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export function EmployeeList({ data, isLoading }: EmployeeListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-40 bg-card/50 border border-border/40 rounded-2xl animate-pulse"></div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table View (hidden on small screens) */}
      <div className="hidden lg:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4 rounded-tl-2xl">社員</th>
                <th className="px-6 py-4">社員番号</th>
                <th className="px-6 py-4">部署</th>
                <th className="px-6 py-4">役職</th>
                <th className="px-6 py-4">入社日</th>
                <th className="px-6 py-4">ステータス</th>
                <th className="px-6 py-4 rounded-tr-2xl"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.map((emp) => (
                <tr key={emp.id} className="hover:bg-secondary/30 transition-colors group">
                  <td className="px-6 py-4 font-medium text-foreground flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-blue-50 text-indigo-700 flex items-center justify-center font-bold text-xs border border-indigo-100">
                      {emp.name.substring(0, 1)}
                    </div>
                    {emp.name}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{emp.employeeNumber}</td>
                  <td className="px-6 py-4 text-foreground/80">{emp.department}</td>
                  <td className="px-6 py-4 text-foreground/80">{emp.position}</td>
                  <td className="px-6 py-4 text-muted-foreground">{emp.joinDate}</td>
                  <td className="px-6 py-4">
                    <Badge variant={emp.status === "在籍中" ? "success" : "secondary"}>
                      {emp.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 rounded-lg hover:bg-secondary text-muted-foreground opacity-0 group-hover:opacity-100 transition-all">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile/Tablet Card View */}
      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:hidden"
      >
        {data.map((emp) => (
          <motion.div 
            key={emp.id}
            variants={item}
            className="bg-card rounded-2xl border border-border shadow-sm p-5 hover:shadow-md transition-shadow relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 p-5">
              <Badge variant={emp.status === "在籍中" ? "success" : "secondary"} className="shadow-sm">
                {emp.status}
              </Badge>
            </div>
            
            <div className="flex items-center gap-4 mb-5">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/10 to-indigo-100 text-primary flex items-center justify-center font-bold text-lg border border-primary/20 shadow-inner">
                {emp.name.substring(0, 1)}
              </div>
              <div>
                <h4 className="font-bold text-foreground text-lg">{emp.name}</h4>
                <p className="text-sm text-muted-foreground font-mono mt-0.5">{emp.employeeNumber}</p>
              </div>
            </div>

            <div className="space-y-3 border-t border-border/50 pt-4">
              <div className="flex items-center text-sm">
                <div className="w-6 flex justify-center mr-2">
                  <Building2 className="w-4 h-4 text-muted-foreground/70" />
                </div>
                <span className="text-muted-foreground w-16">部署:</span>
                <span className="font-medium text-foreground">{emp.department}</span>
              </div>
              <div className="flex items-center text-sm">
                <div className="w-6 flex justify-center mr-2">
                  <Briefcase className="w-4 h-4 text-muted-foreground/70" />
                </div>
                <span className="text-muted-foreground w-16">役職:</span>
                <span className="font-medium text-foreground">{emp.position}</span>
              </div>
              <div className="flex items-center text-sm">
                <div className="w-6 flex justify-center mr-2">
                  <CalendarIcon className="w-4 h-4 text-muted-foreground/70" />
                </div>
                <span className="text-muted-foreground w-16">入社:</span>
                <span className="font-medium text-foreground">{emp.joinDate}</span>
              </div>
            </div>
            
            <div className="mt-5 pt-4 border-t border-border/50 flex justify-end">
              <button className="text-sm font-medium text-primary hover:text-indigo-700 transition-colors py-1 px-3 rounded-lg hover:bg-primary/5 active:bg-primary/10">
                詳細を見る
              </button>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}
