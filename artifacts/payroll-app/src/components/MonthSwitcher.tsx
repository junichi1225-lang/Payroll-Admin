import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { format, addMonths, subMonths } from "date-fns";
import { ja } from "date-fns/locale";

interface MonthSwitcherProps {
  currentDate: Date;
  onChange: (date: Date) => void;
}

export function MonthSwitcher({ currentDate, onChange }: MonthSwitcherProps) {
  const handlePrev = () => onChange(subMonths(currentDate, 1));
  const handleNext = () => onChange(addMonths(currentDate, 1));

  return (
    <div className="flex items-center justify-center py-6 px-4">
      <div className="inline-flex items-center bg-card rounded-2xl shadow-sm border border-border/60 p-1">
        <button 
          onClick={handlePrev}
          className="p-2 sm:p-3 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors active:scale-95"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        <div className="flex items-center justify-center gap-2.5 min-w-[160px] sm:min-w-[180px] px-2 sm:px-4">
          <CalendarIcon className="w-4 h-4 text-primary opacity-80" />
          <span className="text-base sm:text-lg font-bold text-foreground tracking-tight select-none">
            {format(currentDate, "yyyy年 M月", { locale: ja })}
          </span>
        </div>
        
        <button 
          onClick={handleNext}
          className="p-2 sm:p-3 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors active:scale-95"
          aria-label="Next month"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
