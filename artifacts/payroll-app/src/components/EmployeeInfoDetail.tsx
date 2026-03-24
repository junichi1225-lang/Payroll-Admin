import { EmployeeRecord } from "@/lib/dummy-data";
import { Badge } from "@/components/ui/badge";
import { Building2, Briefcase, Calendar, Hash, User } from "lucide-react";

interface EmployeeInfoDetailProps {
  employee: EmployeeRecord;
}

export function EmployeeInfoDetail({ employee }: EmployeeInfoDetailProps) {
  const fields = [
    { icon: Hash, label: "社員番号", value: employee.employeeNumber },
    { icon: User, label: "氏名", value: employee.name },
    { icon: Building2, label: "部署", value: employee.department },
    { icon: Briefcase, label: "役職", value: employee.position },
    { icon: Calendar, label: "入社日", value: employee.joinDate },
  ];

  return (
    <div className="space-y-6">
      {/* Avatar + Name Header Card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-center sm:items-start gap-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-indigo-100 text-primary flex items-center justify-center font-bold text-3xl border-2 border-primary/20 shadow-md flex-shrink-0">
          {employee.name.substring(0, 1)}
        </div>
        <div className="text-center sm:text-left">
          <h3 className="text-2xl font-bold text-foreground">{employee.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">{employee.position} &middot; {employee.department}</p>
          <div className="mt-3">
            <Badge variant={employee.status === "在籍中" ? "success" : "secondary"} className="px-3 py-1 text-sm">
              {employee.status}
            </Badge>
          </div>
        </div>
      </div>

      {/* Details Card */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground">基本情報</h3>
        </div>
        <div className="divide-y divide-border/50">
          {fields.map((field) => (
            <div key={field.label} className="flex items-center gap-4 px-5 py-4">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <field.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 flex items-center justify-between gap-4 min-w-0">
                <span className="text-sm text-muted-foreground w-24 flex-shrink-0">{field.label}</span>
                <span className="text-sm font-semibold text-foreground text-right truncate">{field.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Placeholder for future sections */}
      <div className="bg-secondary/40 border border-border/50 border-dashed rounded-2xl p-8 text-center">
        <p className="text-sm text-muted-foreground">追加情報（緊急連絡先、スキル、評価など）は今後実装予定です。</p>
      </div>
    </div>
  );
}
