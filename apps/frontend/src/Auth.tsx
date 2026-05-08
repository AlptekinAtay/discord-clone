import { useState } from "react";
import { useAuthStore } from "./store/useAuthStore";

export function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore(state => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = isLogin ? "/api/login" : "/api/register";
      const payload = isLogin ? { email, password } : { email, username, password };
      
      const res = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Bir hata oluştu");
      }
      
      setAuth(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-zinc-900 overflow-hidden font-sans relative">
      {/* Background Graphic */}
      <img className="absolute inset-0 w-full h-full object-cover opacity-20" src="https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?q=80&w=2000&auto=format&fit=crop" alt="Background" />
      
      <div className="relative z-10 bg-[#313338] w-full max-w-md p-8 rounded-lg shadow-2xl mx-4">
        <h2 className="text-center text-white text-2xl font-bold mb-2">
          {isLogin ? "Hoş Geldin!" : "Hesap Oluştur"}
        </h2>
        <p className="text-center text-[#b5bac1] text-sm mb-6">
          {isLogin ? "Seni tekrar görmek harika!" : "Discord evrenine katılmak için kayıt ol."}
        </p>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded mb-4 text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[#b5bac1] text-xs font-bold uppercase">E-posta</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="bg-[#1e1f22] text-white p-2.5 rounded border border-transparent focus:border-[#5865f2] focus:outline-none transition-colors"
            />
          </div>

          {!isLogin && (
            <div className="flex flex-col gap-1">
              <label className="text-[#b5bac1] text-xs font-bold uppercase">Kullanıcı Adı</label>
              <input 
                type="text" 
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="bg-[#1e1f22] text-white p-2.5 rounded border border-transparent focus:border-[#5865f2] focus:outline-none transition-colors"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[#b5bac1] text-xs font-bold uppercase">Şifre</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="bg-[#1e1f22] text-white p-2.5 rounded border border-transparent focus:border-[#5865f2] focus:outline-none transition-colors"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[#5865f2] hover:bg-[#4752c4] text-white font-medium py-3 rounded mt-2 transition-colors disabled:opacity-50"
          >
            {loading ? "Bekleniyor..." : (isLogin ? "Giriş Yap" : "Kayıt Ol")}
          </button>
        </form>

        <div className="mt-6 text-sm text-[#b5bac1]">
          {isLogin ? (
             <p>Hesabın yok mu? <span onClick={() => setIsLogin(false)} className="text-[#00a8fc] hover:underline cursor-pointer">Kayıt Ol</span></p>
          ) : (
             <p><span onClick={() => setIsLogin(true)} className="text-[#00a8fc] hover:underline cursor-pointer">Zaten hesabın var mı?</span></p>
          )}
        </div>
      </div>
    </div>
  );
}
