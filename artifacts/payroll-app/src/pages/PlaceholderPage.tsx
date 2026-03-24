import { AppLayout } from "@/components/layout/AppLayout";
import { Construction } from "lucide-react";

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
        <div className="w-20 h-20 bg-secondary rounded-3xl flex items-center justify-center mb-6 shadow-sm border border-border/50 rotate-3">
          <Construction className="w-10 h-10 text-primary opacity-80" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">{title}</h2>
        <p className="text-muted-foreground max-w-md">
          このページは現在プロトタイプ開発中です。今後のアップデートで機能が追加される予定です。
        </p>
      </div>
    </AppLayout>
  );
}
