import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Wallet, 
  Users, 
  FileBarChart, 
  Settings, 
  Menu,
  Bell,
  Search,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

const navItems = [
  { name: "ダッシュボード", icon: LayoutDashboard, path: "/dashboard" },
  { name: "給与管理", icon: Wallet, path: "/" }, // Default view for this prototype
  { name: "社員管理", icon: Users, path: "/employees" },
  { name: "レポート", icon: FileBarChart, path: "/reports" },
  { name: "設定", icon: Settings, path: "/settings" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Consider "/" and "/dashboard" related for this prototype's active state logic
  const isActive = (path: string) => {
    if (path === "/") return location === "/" || location === "/payroll";
    return location.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden text-foreground selection:bg-primary/20">
      
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-card border-r border-border shadow-sm z-20">
        <div className="h-16 flex items-center px-6 border-b border-border/50">
          <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-indigo-400 flex items-center justify-center text-white shadow-md shadow-primary/20">
              <Wallet className="w-4 h-4" />
            </div>
            PayPro
          </div>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-3">
            メインメニュー
          </div>
          {navItems.map((item) => (
            <Link key={item.name} href={item.path}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group",
                  isActive(item.path)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn(
                  "w-5 h-5 transition-colors", 
                  isActive(item.path) ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.name}
              </div>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary cursor-pointer transition-colors">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-100 to-blue-50 text-indigo-700 flex items-center justify-center font-bold text-sm border border-indigo-200 shadow-sm">
              MS
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-foreground truncate">管理者 ユーザー</p>
              <p className="text-xs text-muted-foreground truncate">admin@paypro.jp</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-3/4 max-w-sm bg-card border-r border-border shadow-2xl z-50 flex flex-col md:hidden"
            >
              <div className="h-16 flex items-center justify-between px-4 border-b border-border/50">
                <div className="flex items-center gap-2 text-primary font-bold text-lg">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-indigo-400 flex items-center justify-center text-white">
                    <Wallet className="w-3.5 h-3.5" />
                  </div>
                  PayPro
                </div>
                <button 
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <nav className="flex-1 py-4 px-2 space-y-1">
                {navItems.map((item) => (
                  <Link key={item.name} href={item.path}>
                    <div
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-colors",
                        isActive(item.path)
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </div>
                  </Link>
                ))}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col w-full overflow-hidden relative">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -ml-2 rounded-lg hover:bg-secondary md:hidden text-foreground"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-bold text-lg md:text-xl text-foreground hidden sm:block">
              {navItems.find(i => isActive(i.path))?.name || "給与管理"}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex items-center relative group">
              <Search className="w-4 h-4 absolute left-3 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input 
                type="text" 
                placeholder="社員を検索..." 
                className="pl-9 pr-4 py-2 rounded-full bg-secondary/50 border border-transparent focus:bg-background focus:border-primary/30 focus:ring-2 focus:ring-primary/10 text-sm outline-none transition-all w-48 lg:w-64"
              />
            </div>
            
            <button className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground relative transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-2 w-2 h-2 bg-destructive rounded-full border-2 border-card"></span>
            </button>
            
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-100 to-blue-50 text-indigo-700 flex items-center justify-center font-bold text-xs border border-indigo-200 md:hidden">
              MS
            </div>
          </div>
        </header>

        {/* Page Content Scrollable Area */}
        <main className="flex-1 overflow-y-auto bg-background/50">
          <div className="w-full h-full max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
