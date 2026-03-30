import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Globe, Fingerprint, ArrowRight, Building2 } from "lucide-react";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);

  const handleEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">

      {/* 背景の装飾グラデーション */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-100/60 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-sm relative z-10"
      >
        {/* ブランドロゴ */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-2xl shadow-lg shadow-primary/25 mb-4">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">PayPro</h1>
          <p className="text-sm text-muted-foreground mt-1">給与・人事管理プラットフォーム</p>
        </div>

        {/* ログインカード */}
        <div className="bg-white rounded-2xl border border-border/60 shadow-xl shadow-slate-200/80 p-6 space-y-5">

          {/* カードヘッダー */}
          <div className="text-center pb-1">
            <h2 className="text-base font-bold text-foreground">アカウントにログインしてください</h2>
            <p className="text-xs text-muted-foreground mt-0.5">以下の方法でご利用いただけます</p>
          </div>

          {/* メールアドレス入力 */}
          <form onSubmit={handleEmailLogin} className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground" htmlFor="email">
                メールアドレス
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  placeholder="you@company.com"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border bg-background text-sm text-foreground placeholder:text-muted-foreground/40 transition-all outline-none"
                  style={{
                    borderColor: emailFocused ? "#3b82f6" : undefined,
                    boxShadow: emailFocused ? "0 0 0 3px rgba(59,130,246,0.15)" : undefined,
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold py-2.5 rounded-xl transition-all shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/20 active:scale-[0.98]"
            >
              <span>ログインリンクを送信</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* セパレーター */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium px-1">または</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* ソーシャル / パスキーログイン */}
          <div className="space-y-2.5">

            {/* Google ログイン */}
            <button
              onClick={onLogin}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-white hover:bg-slate-50 text-sm font-medium text-foreground transition-all hover:border-slate-300 active:scale-[0.98] group"
            >
              {/* Google "G" ロゴ風のSVG */}
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="flex-1 text-left">Googleでログイン</span>
            </button>

            {/* 顔認証 / パスキー */}
            <button
              onClick={onLogin}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-white hover:bg-slate-50 text-sm font-medium text-foreground transition-all hover:border-slate-300 active:scale-[0.98]"
            >
              <Fingerprint className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">顔認証 / パスキーでログイン</span>
            </button>

          </div>
        </div>

        {/* フッター */}
        <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
          ログインすることで、
          <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">利用規約</span>
          および
          <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">プライバシーポリシー</span>
          に同意したものとみなされます。
        </p>
      </motion.div>
    </div>
  );
}
