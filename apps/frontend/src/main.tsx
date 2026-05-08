import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Auth } from "./Auth";
import { useAuthStore } from "./store/useAuthStore";
import "./index.css";

function Root() {
  const { token, user, isLoading, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return <div className="h-screen w-full bg-zinc-900 flex items-center justify-center text-[#5865f2] font-bold">Yükleniyor...</div>;
  }

  if (!token || !user) {
    return <Auth />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root />
);
